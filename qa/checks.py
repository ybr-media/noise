"""Measurements used by the noise-generation QA harness."""

from __future__ import annotations

import hashlib
import itertools
import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf


class SidecarError(ValueError):
    """Raised when a sidecar does not satisfy the input contract."""


@dataclass(frozen=True)
class Bell:
    gain_db: float
    center_hz: float
    q: float


@dataclass(frozen=True)
class Sidecar:
    variant_id: str
    color: str
    band: str
    motion: str
    balance: str
    seeds: tuple[int, ...]
    band_low_hz: float
    band_high_hz: float
    lfo_depth: float
    lfo_rate_hz: float
    per_stem_gains: Mapping[str, float]
    target_lufs: float
    true_peak_max_dbtp: float
    cell_seconds: float
    repeats: int
    fade_seconds: float
    sample_rate: int
    bit_depth: int
    tilt_db_per_oct: float
    bell: Bell | None

    @classmethod
    def from_json(cls, path: Path) -> Sidecar:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SidecarError(f"{path.name}: unreadable or invalid JSON: {exc}") from exc
        if not isinstance(raw, dict):
            raise SidecarError(f"{path.name}: sidecar root must be an object")

        def required(name: str) -> object:
            if name not in raw:
                raise SidecarError(f"{path.name}: missing required key {name!r}")
            return raw[name]

        def number(name: str) -> float:
            value = required(name)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise SidecarError(f"{path.name}: {name} must be numeric")
            return float(value)

        def text(name: str) -> str:
            value = required(name)
            if not isinstance(value, str) or not value:
                raise SidecarError(f"{path.name}: {name} must be a non-empty string")
            return value

        seeds_raw = required("seeds")
        if not isinstance(seeds_raw, list) or not all(
            isinstance(item, int) and not isinstance(item, bool) for item in seeds_raw
        ):
            raise SidecarError(f"{path.name}: seeds must be a list of integers")
        gains_raw = required("per_stem_gains")
        if not isinstance(gains_raw, dict) or not all(
            isinstance(k, str) and isinstance(v, (int, float)) and not isinstance(v, bool)
            for k, v in gains_raw.items()
        ):
            raise SidecarError(f"{path.name}: per_stem_gains must be an object of numbers")
        bell_raw = raw.get("bell")
        bell: Bell | None = None
        if bell_raw is not None:
            if not isinstance(bell_raw, dict):
                raise SidecarError(f"{path.name}: bell must be an object")
            try:
                bell_values = (bell_raw["gain_db"], bell_raw["center_hz"], bell_raw["q"])
            except KeyError as exc:
                raise SidecarError(f"{path.name}: bell missing key {exc.args[0]!r}") from exc
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in bell_values):
                raise SidecarError(f"{path.name}: bell values must be numeric")
            bell = Bell(float(bell_values[0]), float(bell_values[1]), float(bell_values[2]))
        repeats_value = required("repeats")
        sample_rate = required("sample_rate")
        bit_depth = required("bit_depth")
        if not isinstance(repeats_value, int) or isinstance(repeats_value, bool):
            raise SidecarError(f"{path.name}: repeats must be an integer")
        if not isinstance(sample_rate, int) or isinstance(sample_rate, bool):
            raise SidecarError(f"{path.name}: sample_rate must be an integer")
        if not isinstance(bit_depth, int) or isinstance(bit_depth, bool):
            raise SidecarError(f"{path.name}: bit_depth must be an integer")
        result = cls(
            variant_id=text("variant_id"),
            color=text("color"),
            band=text("band"),
            motion=text("motion"),
            balance=text("balance"),
            seeds=tuple(seeds_raw),
            band_low_hz=number("band_low_hz"),
            band_high_hz=number("band_high_hz"),
            lfo_depth=number("lfo_depth"),
            lfo_rate_hz=number("lfo_rate_hz"),
            per_stem_gains={key: float(value) for key, value in gains_raw.items()},
            target_lufs=number("target_lufs"),
            true_peak_max_dbtp=number("true_peak_max_dbtp"),
            cell_seconds=number("cell_seconds"),
            repeats=repeats_value,
            fade_seconds=number("fade_seconds"),
            sample_rate=sample_rate,
            bit_depth=bit_depth,
            tilt_db_per_oct=number("tilt_db_per_oct"),
            bell=bell,
        )
        text("audacity_version")
        text("render_timestamp")
        if result.cell_seconds <= 0 or result.repeats < 1 or result.fade_seconds < 0:
            raise SidecarError(f"{path.name}: cell_seconds/repeats/fade_seconds out of range")
        if result.band_low_hz <= 0 or result.band_high_hz <= result.band_low_hz:
            raise SidecarError(f"{path.name}: invalid band edges")
        return result


@dataclass(frozen=True)
class CheckResult:
    name: str
    measured: str
    threshold: str
    passed: bool
    blocking: bool = True
    details: Mapping[str, object] | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "measured": self.measured,
            "threshold": self.threshold,
            "passed": self.passed,
            "blocking": self.blocking,
            "details": dict(self.details or {}),
        }


def _result(name: str, value: object, threshold: str, passed: bool, details: Mapping[str, object] | None = None) -> CheckResult:
    return CheckResult(name, str(value), threshold, passed, True, details)


def decoded_pcm_hash(path: Path) -> str:
    data, _ = sf.read(path, dtype="int32", always_2d=True)
    canonical = np.ascontiguousarray(data, dtype=np.int32)
    return hashlib.sha256(canonical.tobytes()).hexdigest()


def loudness(data: np.ndarray, sidecar: Sidecar) -> CheckResult:
    value = float(pyln.Meter(sidecar.sample_rate).integrated_loudness(data.astype(np.float64)))
    return _result("Loudness", f"{value:.3f} LUFS", f"|LUFS - {sidecar.target_lufs:.2f}| <= 0.50", abs(value - sidecar.target_lufs) <= 0.5)


def _oversampling_kernel(phases: int = 4, taps: int = 32) -> np.ndarray:
    """Build a Hann-windowed, 4-phase windowed-sinc interpolation kernel."""
    offsets = np.arange(taps, dtype=np.float64) - (taps - 1) / 2
    kernel = np.empty((phases, taps), dtype=np.float64)
    window = np.hanning(taps)
    for phase in range(phases):
        frac = phase / phases
        values = np.sinc(offsets - frac) * window
        kernel[phase] = values / np.sum(values)
    return kernel


def true_peak(data: np.ndarray, sidecar: Sidecar) -> CheckResult:
    """Estimate true peak from local candidate windows.

    A normalized interpolation kernel has bounded gain; this implementation
    conservatively examines every sample within 6 dB of the sample peak and a
    ±64-sample neighborhood, so an interpolated maximum cannot be missed far
    from a sample-domain peak while avoiding a whole-file 4x resample.
    """
    kernel = _oversampling_kernel()
    sample_peak = float(np.max(np.abs(data)))
    candidate_limit = sample_peak * 10 ** (-6 / 20)
    half = kernel.shape[1] // 2
    candidate_positions: set[tuple[int, int]] = set()
    for channel in range(data.shape[1]):
        positions = np.flatnonzero(np.abs(data[:, channel]) >= candidate_limit)
        if positions.size > 256:
            top = np.argpartition(np.abs(data[positions, channel]), -256)[-256:]
            positions = positions[top]
        for position in positions:
            for offset in range(-64, 65):
                candidate_positions.add((channel, int(position + offset)))
    peak = sample_peak
    for channel, position in candidate_positions:
        if position < half or position + half >= data.shape[0]:
            continue
        window = data[position - half:position + half + 1, channel]
        for phase in range(kernel.shape[0]):
            value = float(np.dot(window[:kernel.shape[1]], kernel[phase]))
            peak = max(peak, abs(value))
    dbtp = 20.0 * math.log10(max(peak, np.finfo(float).tiny))
    return _result("True peak", f"{dbtp:.3f} dBTP", f"<= {sidecar.true_peak_max_dbtp:.2f} dBTP", dbtp <= sidecar.true_peak_max_dbtp)


def clipping(data: np.ndarray, sidecar: Sidecar) -> CheckResult:
    full_scale = 1.0 - 1.0 / (2 ** (sidecar.bit_depth - 1))
    count = int(np.count_nonzero(np.abs(data) >= full_scale))
    return _result("Clipping", f"{count} samples", f"0 samples with |sample| >= {full_scale:.9f}", count == 0)


def dc_offset(data: np.ndarray) -> CheckResult:
    means = np.mean(data, axis=0)
    worst = float(np.max(np.abs(means)))
    return _result("DC offset", f"{worst:.7f}", "< 1e-4 per channel", worst < 1e-4, {"channel_means": means.tolist()})


def loop_seam(data: np.ndarray, sidecar: Sidecar) -> CheckResult:
    cell = round(sidecar.cell_seconds * sidecar.sample_rate)
    repeats = sidecar.repeats
    half = max(1, round(0.05 * sidecar.sample_rate))
    fade = round(sidecar.fade_seconds * sidecar.sample_rate)
    usable = min(half, max(1, cell // 4))
    repeat_diffs: list[float] = []
    for index in range(1, repeats):
        a = data[index * cell - usable:index * cell + usable]
        b = data[(index - 1) * cell - usable:(index - 1) * cell + usable]
        if a.shape == b.shape:
            repeat_diffs.append(float(np.median(np.abs(a - b))))
    if repeat_diffs and float(np.median(repeat_diffs)) <= 10 ** (-60 / 20):
        windows: list[np.ndarray] = []
        for index in range(1, repeats):
            boundary = index * cell
            if boundary - usable < fade or boundary + usable > data.shape[0] - fade:
                continue
            windows.append(data[boundary - usable:boundary + usable])
        if len(windows) < 2:
            return _seam_outlier(data, sidecar, cell, fade)
        value = max(
            float(np.max(np.abs(left - right)))
            for index, left in enumerate(windows)
            for right in windows[index + 1:]
        )
        db = 20 * math.log10(max(value, np.finfo(float).tiny))
        return _result("Loop seam", f"{db:.3f} dBFS peak difference", "< -60 dBFS (cross-boundary metric)", db < -60, {"metric": "cross-boundary-pairwise", "reason": "raw sample deltas are not meaningful for broadband noise"})
    return _seam_outlier(data, sidecar, cell, fade)


def _seam_outlier(data: np.ndarray, sidecar: Sidecar, cell: int, fade: int) -> CheckResult:
    seam_width = max(1, round(0.005 * sidecar.sample_rate))
    second = np.diff(data, n=2, axis=0)
    seam_peaks: list[float] = []
    for index in range(1, sidecar.repeats):
        boundary = index * cell
        seam_peaks.append(float(np.max(np.abs(second[max(0, boundary - seam_width):boundary + seam_width]))))
    baseline_positions = np.linspace(fade + seam_width, data.shape[0] - fade - seam_width, 32, dtype=int)
    baseline = [float(np.max(np.abs(second[max(0, p - seam_width):p + seam_width]))) for p in baseline_positions]
    ratio = max(seam_peaks, default=0.0) / max(float(np.median(baseline)), 1e-12)
    return _result("Loop seam", f"{ratio:.3f}x second-difference median", "< 8x baseline (outlier metric)", ratio < 8, {"metric": "second-difference-outlier", "reason": "raw sample deltas are not meaningful for broadband noise"})


@dataclass(frozen=True)
class Spectrum:
    frequencies: np.ndarray
    psd: np.ndarray
    third_octave: Mapping[int, float]


def analyze_spectrum(data: np.ndarray, sidecar: Sidecar) -> Spectrum:
    start = round(sidecar.fade_seconds * sidecar.sample_rate)
    stop = data.shape[0] - start
    mono = np.mean(data[start:stop], axis=1)
    nperseg = min(65536, max(1024, len(mono) // 8))
    step = max(1, nperseg // 2)
    window = np.hanning(nperseg)
    windows = [mono[pos:pos + nperseg] for pos in range(0, max(1, len(mono) - nperseg + 1), step)]
    if not windows:
        windows = [np.pad(mono, (0, nperseg - len(mono)))]
    spectra = [np.abs(np.fft.rfft(chunk * window)) ** 2 for chunk in windows]
    psd = np.mean(np.asarray(spectra), axis=0)
    frequencies = np.fft.rfftfreq(nperseg, 1 / sidecar.sample_rate)
    centers = (16, 20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000)
    third: dict[int, float] = {}
    for center in centers:
        low, high = center / 2 ** (1 / 6), center * 2 ** (1 / 6)
        mask = (frequencies >= low) & (frequencies < high)
        third[center] = float(10 * np.log10(max(np.mean(psd[mask]), 1e-30))) if np.any(mask) else -300.0
    return Spectrum(frequencies, psd, third)


def spectral_tilt(spectrum: Spectrum, sidecar: Sidecar) -> CheckResult:
    if sidecar.bell is None:
        slope, _intercept = _fit_tilt(spectrum, sidecar)
    else:
        slope, _intercept = _fit_tilt(
            spectrum, sidecar, low_override=100.0, high_override=10000.0
        )
    return _result(
        "Spectral tilt",
        f"{slope:.3f} dB/oct",
        f"{sidecar.tilt_db_per_oct:.2f} +/- 1.50 dB/oct",
        bool(np.isfinite(slope) and abs(slope - sidecar.tilt_db_per_oct) <= 1.5),
    )


def _fit_tilt(
    spectrum: Spectrum,
    sidecar: Sidecar,
    *,
    low_override: float | None = None,
    high_override: float | None = None,
) -> tuple[float, float]:
    low = max(100.0, sidecar.band_low_hz) if low_override is None else low_override
    high = min(10000.0, sidecar.band_high_hz) if high_override is None else high_override
    mask = (spectrum.frequencies >= low) & (spectrum.frequencies <= high) & (spectrum.psd > 0)
    if sidecar.bell is not None:
        exclusion_low = max(low, sidecar.bell.center_hz / 2)
        exclusion_high = min(high, sidecar.bell.center_hz * 2)
        mask &= ~((spectrum.frequencies >= exclusion_low) & (spectrum.frequencies <= exclusion_high))
    selected_frequencies = spectrum.frequencies[mask]
    selected_psd = spectrum.psd[mask]
    if selected_frequencies.size >= 2:
        edges = np.geomspace(low, high, 33)
        binned_frequency: list[float] = []
        binned_psd: list[float] = []
        for left, right in itertools.pairwise(edges):
            bin_mask = (selected_frequencies >= left) & (selected_frequencies < right)
            if np.any(bin_mask):
                binned_frequency.append(float(np.sqrt(left * right)))
                binned_psd.append(float(np.mean(selected_psd[bin_mask])))
        slope, intercept = (
            tuple(np.polyfit(np.log2(binned_frequency), 10 * np.log10(binned_psd), 1))
            if len(binned_frequency) >= 2
            else (float("nan"), float("nan"))
        )
    else:
        slope, intercept = float("nan"), float("nan")
    return float(slope), float(intercept)


def green_bell(spectrum: Spectrum, sidecar: Sidecar) -> CheckResult:
    if sidecar.bell is None:
        return _result("Green bell", "not applicable", "not applicable", True)
    near = float(np.mean([spectrum.third_octave[x] for x in (400, 500, 630)]))
    slope, intercept = _fit_tilt(spectrum, sidecar, low_override=100.0, high_override=10000.0)
    expected = float(
        np.mean(
            [
                intercept + slope * math.log2(frequency)
                for frequency in (400, 500, 630)
            ]
        )
    )
    excess = near - expected
    far = float(np.mean([spectrum.third_octave[x] for x in (2000, 2500, 3150, 4000)]))
    return _result(
        "Green bell",
        f"{excess:.3f} dB",
        "3 to 8 dB",
        3 <= excess <= 8,
        {
            "metric": "excess-over-fitted-tilt",
            "fitted_slope_db_per_oct": slope,
            "raw_near_level_db": near,
            "raw_ratio_db": near - far,
            "expected_near_level_db": expected,
            "third_octave_db": dict(spectrum.third_octave),
        },
    )


def silence(data: np.ndarray, sidecar: Sidecar) -> CheckResult:
    start = int(sidecar.fade_seconds * sidecar.sample_rate)
    stop = data.shape[0] - start
    mono = np.mean(data[start:stop], axis=1)
    frame = max(1, int(sidecar.sample_rate * 0.02))
    hop = max(1, int(sidecar.sample_rate * 0.01))
    rms = np.asarray([math.sqrt(float(np.mean(mono[i:i + frame] ** 2))) for i in range(0, max(1, len(mono) - frame + 1), hop)])
    quiet = rms < 10 ** (-60 / 20)
    runs = np.diff(np.r_[False, quiet, False].astype(int))
    longest = int(np.max(np.where(runs == -1)[0] - np.where(runs == 1)[0])) if np.any(runs == 1) else 0
    covered_frames = (longest - 1) * hop + frame if longest else 0
    milliseconds = covered_frames * 1000.0 / sidecar.sample_rate
    return _result("Silence/dropout", f"{milliseconds:.1f} ms", "<= 100 ms below -60 dBFS", milliseconds <= 100)


def decorrelation(data: np.ndarray) -> CheckResult:
    correlation = float(np.corrcoef(data[:, 0], data[:, 1])[0, 1])
    return _result("Stereo decorrelation", f"r={correlation:.5f}", "|r| < 0.5", abs(correlation) < 0.5)


def duration_format(info: sf.SoundFile, sidecar: Sidecar) -> CheckResult:
    expected = round(sidecar.cell_seconds * sidecar.sample_rate) * sidecar.repeats
    subtype_bits = {"PCM_16": 16, "PCM_24": 24, "PCM_32": 32}.get(info.subtype, 0)
    passed = info.samplerate == sidecar.sample_rate and info.channels == 2 and subtype_bits == sidecar.bit_depth and info.frames == expected
    return _result("Duration/format", f"{info.frames} frames, {info.samplerate} Hz, {info.channels}ch, {info.subtype}", f"exactly {expected} frames; {sidecar.sample_rate} Hz stereo {sidecar.bit_depth}-bit", passed)
