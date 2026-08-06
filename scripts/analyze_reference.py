"""Chunked reference-audio analysis for noise-generation variants."""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from itertools import pairwise
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from reference_report import render_report
from scipy import signal

NOMINAL_CENTERS = np.array(
    [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
     500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
     6300, 8000, 10000, 12500, 16000], dtype=float
)


@dataclass
class BandMeasurement:
    center_hz: float
    low_hz: float
    high_hz: float
    relative_db: float | None
    skipped: bool


@dataclass
class SpectrumMeasurement:
    fit_low_hz: float
    fit_high_hz: float
    slope_db_per_oct: float | None
    fit_residual_rms_db: float | None
    r_squared: float | None
    note: str
    frequencies_hz: list[float]
    levels_db: list[float]


@dataclass
class LfoMeasurement:
    depth: float
    rate_hz: float | None
    confidence: float
    status: str
    times_s: list[float]
    rms: list[float]


@dataclass
class BellMeasurement:
    gain_db: float
    center_hz: float
    q: float


@dataclass
class AnalysisPass:
    rate: int
    channels: int
    duration_s: float
    rms: float
    peak: float
    correlation: float | None
    envelope_times: np.ndarray
    envelope_rms: np.ndarray
    lufs_audio: np.ndarray
    lufs_rate: int


@dataclass
class AudioMeasurement:
    path: str
    sample_rate: int
    channels: int
    duration_s: float
    broadband_rms_db: float
    integrated_lufs: float
    true_peak_dbtp: float
    crest_factor_db: float
    stereo_correlation: float | None
    stereo_width_target: float | None
    spectrum: SpectrumMeasurement
    third_octave: list[BandMeasurement]
    bell: BellMeasurement | None
    envelope_lfo: LfoMeasurement
    spectral_flux: float
    character: str


def db(value: float, floor: float = 1e-12) -> float:
    return float(20.0 * math.log10(max(abs(value), floor)))


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", Path(name).stem.lower()).strip("-")


def _third_octave_edges(center: float) -> tuple[float, float]:
    factor = 2.0 ** (1.0 / 6.0)
    return center / factor, center * factor


def _iter_blocks(path: Path, blocksize: int = 262144) -> Iterable[tuple[np.ndarray, int]]:
    with sf.SoundFile(path) as audio:
        for block in audio.blocks(blocksize=blocksize, dtype="float64", always_2d=True):
            yield block, audio.samplerate


def _spectrum(path: Path, sample_rate: int) -> tuple[SpectrumMeasurement, np.ndarray, np.ndarray]:
    nfft = min(65536, max(2048, 2 ** math.floor(math.log2(sample_rate))))
    psd_total: np.ndarray | None = None
    frequencies: np.ndarray | None = None
    count = 0
    for block, _ in _iter_blocks(path):
        mono = block.mean(axis=1)
        if len(mono) < nfft:
            continue
        frequencies, psd = signal.welch(
            mono, fs=sample_rate, nperseg=nfft, noverlap=nfft // 2, detrend="constant"
        )
        psd_total = psd if psd_total is None else psd_total + psd
        count += 1
    if frequencies is None or psd_total is None:
        raise ValueError(f"audio is shorter than analysis window: {path}")
    levels = 10.0 * np.log10(np.maximum(psd_total / count, 1e-30))
    fit_high = min(10000.0, sample_rate / 2.0)
    log_edges = 100.0 * 2.0 ** (np.arange(0, 41) / 6.0)
    log_edges = log_edges[log_edges <= fit_high * 2.0 ** (1.0 / 6.0)]
    fit_frequencies: list[float] = []
    fit_levels: list[float] = []
    for low, high in pairwise(log_edges):
        valid = (frequencies >= low) & (frequencies < min(high, fit_high))
        if np.any(valid):
            fit_frequencies.append(float(math.sqrt(low * high)))
            fit_levels.append(float(10.0 * math.log10(np.mean(10.0 ** (levels[valid] / 10.0)))))
    x = np.log2(np.asarray(fit_frequencies) / 100.0)
    y = np.asarray(fit_levels)
    if len(x) < 3:
        slope = residual = r_squared = None
        note = "Insufficient bandwidth for a power-law fit."
    else:
        coefficients = np.polyfit(x, y, 1)
        residuals = y - np.polyval(coefficients, x)
        slope = float(coefficients[0])
        residual = float(np.sqrt(np.mean(residuals ** 2)))
        total = float(np.sum((y - np.mean(y)) ** 2))
        r_squared = float(1.0 - np.sum(residuals ** 2) / total) if total else 1.0
        note = (f"Fit band is {100.0:g} Hz–{fit_high:g} Hz using equal-weight 1/6-octave bins. "
                "A high residual means the source isn't power-law shaped and the "
                "slope target is not meaningful.")
    keep = np.geomspace(max(20.0, frequencies[1]), frequencies[-1], 240)
    decimated = np.interp(np.log(keep), np.log(frequencies[1:]), levels[1:])
    return SpectrumMeasurement(
        100.0, fit_high, slope, residual, r_squared, note,
        keep.tolist(), decimated.tolist()
    ), frequencies, levels


def _third_octave(frequencies: np.ndarray, levels: np.ndarray, broadband: float) -> list[BandMeasurement]:
    result: list[BandMeasurement] = []
    nyquist = frequencies[-1]
    for center in NOMINAL_CENTERS:
        low, high = _third_octave_edges(center)
        valid = (frequencies >= low) & (frequencies < high)
        if low >= nyquist or not np.any(valid):
            result.append(BandMeasurement(float(center), low, high, None, True))
            continue
        band_power = float(np.trapezoid(10.0 ** (levels[valid] / 10.0), frequencies[valid]))
        result.append(BandMeasurement(
            float(center), low, high, db(math.sqrt(band_power)) - broadband, False
        ))
    return result


def _analysis_pass(path: Path) -> AnalysisPass:
    with sf.SoundFile(path) as audio:
        rate, channels, frames = audio.samplerate, audio.channels, len(audio)
    sum_sq = 0.0
    peak = 0.0
    sum_l = sum_r = sum_l2 = sum_r2 = sum_lr = 0.0
    envelope_values: list[float] = []
    envelope_times: list[float] = []
    pending = np.empty(0, dtype=float)
    frame_size = max(1, round(rate * 0.05))
    lufs_rate = min(rate, 48000)
    lufs_chunks: list[np.ndarray] = []
    offset = 0
    for block, _ in _iter_blocks(path):
        mono = block.mean(axis=1)
        sum_sq += float(np.sum(mono * mono))
        peak = max(peak, float(np.max(np.abs(block))))
        if channels >= 2:
            left, right = block[:, 0], block[:, 1]
            sum_l += float(np.sum(left)); sum_r += float(np.sum(right))
            sum_l2 += float(np.sum(left * left)); sum_r2 += float(np.sum(right * right))
            sum_lr += float(np.sum(left * right))
        combined = np.concatenate((pending, mono))
        usable = len(combined) - len(combined) % frame_size
        if usable:
            frame_rms = np.sqrt(np.mean(combined[:usable].reshape(-1, frame_size) ** 2, axis=1))
            envelope_values.extend(frame_rms.tolist())
            envelope_times.extend(((offset + np.arange(len(frame_rms)) * frame_size) / rate).tolist())
        pending = combined[usable:]
        offset += len(mono)
        lufs_chunks.append(block if lufs_rate == rate else signal.resample_poly(block, lufs_rate, rate, axis=0))
    rms = math.sqrt(sum_sq / frames)
    correlation: float | None = None
    if channels >= 2:
        count = float(frames)
        numerator = sum_lr - sum_l * sum_r / count
        denominator = math.sqrt(max((sum_l2 - sum_l * sum_l / count) * (sum_r2 - sum_r * sum_r / count), 0.0))
        correlation = numerator / denominator if denominator else 0.0
    return AnalysisPass(
        rate, channels, frames / rate, rms, peak, correlation,
        np.asarray(envelope_times), np.asarray(envelope_values),
        np.concatenate(lufs_chunks), lufs_rate,
    )


def _compact(values: np.ndarray, times: np.ndarray, limit: int = 300) -> tuple[list[float], list[float]]:
    if len(values) <= limit:
        return times.tolist(), values.tolist()
    indexes = np.linspace(0, len(values) - 1, limit).astype(int)
    return times[indexes].tolist(), values[indexes].tolist()


def _lfo(envelope: np.ndarray, times: np.ndarray) -> LfoMeasurement:
    if len(envelope) < 20:
        compact_times, compact_values = _compact(envelope, times)
        return LfoMeasurement(0.0, None, 0.0, "no coherent LFO detected", compact_times, compact_values)
    hop_s = float(np.median(np.diff(times)))
    smooth_window = max(3, round(2.0 / hop_s)) | 1
    smooth = signal.savgol_filter(envelope, smooth_window, 2) if len(envelope) > smooth_window + 3 else envelope
    sample_rate = min(20.0, 1.0 / hop_s)
    target_len = max(16, round(len(smooth) * sample_rate * hop_s))
    reduced = signal.resample(smooth, target_len)
    centered = reduced - np.mean(reduced)
    freqs, powers = signal.periodogram(centered, fs=sample_rate)
    candidates = (freqs >= 0.02) & (freqs <= 1.0)
    compact_times, compact_values = _compact(envelope, times)
    if not np.any(candidates):
        return LfoMeasurement(0.0, None, 0.0, "no coherent LFO detected", compact_times, compact_values)
    indexes = np.flatnonzero(candidates)
    peak_index = int(indexes[np.argmax(powers[indexes])])
    floor_mask = candidates.copy()
    floor_mask[max(0, peak_index - 2):min(len(powers), peak_index + 3)] = False
    floor = float(np.median(powers[floor_mask])) if np.any(floor_mask) else 0.0
    confidence = float(powers[peak_index] / max(floor, 1e-15))
    robust_low, robust_high = np.percentile(smooth, [5, 95])
    depth = float((robust_high - robust_low) / max(robust_high + robust_low, 1e-12))
    rate = float(freqs[peak_index])
    if confidence < 8.0 or depth < 0.1:
        return LfoMeasurement(depth, None, confidence, "no coherent LFO detected", compact_times, compact_values)
    return LfoMeasurement(depth, rate, confidence, "coherent LFO detected", compact_times, compact_values)


def _bell(bands: list[BandMeasurement], spectrum: SpectrumMeasurement) -> BellMeasurement | None:
    if spectrum.slope_db_per_oct is None:
        return None
    valid = [band for band in bands if band.relative_db is not None and 100 <= band.center_hz <= 10000]
    if len(valid) < 5:
        return None
    band_slope = spectrum.slope_db_per_oct + 3.0103
    intercept = float(np.median([
        band.relative_db - band_slope * math.log2(band.center_hz / 100.0)
        for band in valid
    ]))
    middle = [band for band in valid if 200 <= band.center_hz <= 2000]
    residuals = np.asarray([
        band.relative_db - (intercept + band_slope * math.log2(band.center_hz / 100.0))
        for band in middle
    ])
    if len(residuals) < 2:
        return None
    peak_index = int(np.argmax(residuals))
    adjacent = residuals >= max(3.0, residuals[peak_index] - 3.0)
    has_broad_peak = (
        0 < peak_index < len(residuals) - 1
        and residuals[peak_index - 1] >= residuals[peak_index] - 2.0
        and residuals[peak_index + 1] >= residuals[peak_index] - 2.0
    )
    if residuals[peak_index] < 3.0 or int(np.sum(adjacent)) < 2 or not has_broad_peak:
        return None
    elevated = [band for band, is_elevated in zip(middle, adjacent) if is_elevated]
    low = elevated[0].center_hz / 2.0 ** (1.0 / 12.0)
    high = elevated[-1].center_hz * 2.0 ** (1.0 / 12.0)
    width = max(high - low, elevated[0].center_hz / 3.0)
    return BellMeasurement(float(residuals[peak_index]), middle[peak_index].center_hz,
                           float(middle[peak_index].center_hz / width))


def _texture_band(bands: list[BandMeasurement]) -> tuple[float, float]:
    valid = [band for band in bands if band.relative_db is not None]
    peak = max(valid, key=lambda band: band.relative_db)
    peak_index = bands.index(peak)
    included = {peak_index}
    for direction in (-1, 1):
        index = peak_index + direction
        while 0 <= index < len(bands) and bands[index].relative_db is not None and bands[index].relative_db >= peak.relative_db - 6.0:
            included.add(index)
            index += direction
    return bands[min(included)].low_hz, bands[max(included)].high_hz


def analyze_file(path: Path) -> AudioMeasurement:
    analysis = _analysis_pass(path)
    spectrum, frequencies, levels = _spectrum(path, analysis.rate)
    broadband = db(analysis.rms)
    bands = _third_octave(frequencies, levels, broadband)
    meter = pyln.Meter(analysis.lufs_rate)
    lufs = float(meter.integrated_loudness(analysis.lufs_audio))
    oversampled_peak = analysis.peak
    if analysis.rate < 192000:
        for block, _ in _iter_blocks(path):
            oversampled_peak = max(oversampled_peak, float(np.max(np.abs(signal.resample_poly(block, 4, 1, axis=0)))))
    corr = None if analysis.channels < 2 else float(np.clip(analysis.correlation or 0.0, -1.0, 1.0))
    flux_values: list[float] = []
    previous: np.ndarray | None = None
    for block, _ in _iter_blocks(path):
        _, _, zxx = signal.stft(block.mean(axis=1), fs=analysis.rate, nperseg=4096, noverlap=2048, boundary=None)
        for frame in np.abs(zxx).T:
            if previous is not None:
                flux_values.append(float(np.linalg.norm(np.maximum(frame - previous, 0.0)) / (np.linalg.norm(previous) + 1e-12)))
            previous = frame
    flux = float(np.mean(flux_values)) if flux_values else 0.0
    lfo = _lfo(analysis.envelope_rms, analysis.envelope_times)
    character = "evolving" if flux >= 0.08 else "static"
    return AudioMeasurement(
        str(path), analysis.rate, analysis.channels, analysis.duration_s, broadband, lufs,
        db(oversampled_peak), db(oversampled_peak) - broadband, corr,
        None if corr is None else float(np.clip(1.0 - corr, 0.0, 1.0)),
        spectrum, bands, _bell(bands, spectrum), lfo, flux, character,
    )


def _yaml_value(value: float | None) -> str:
    return "null" if value is None else f"{value:.6g}"


def emit_variants(results: list[AudioMeasurement], destination: Path) -> None:
    lines: list[str] = []
    for result in results:
        low, high = _texture_band(result.third_octave)
        lines.extend([f"{slugify(result.path)}:", f"  variant_id: {slugify(result.path)}",
                      f"  tilt_db_per_oct: {_yaml_value(result.spectrum.slope_db_per_oct)}"])
        if result.bell is not None:
            lines.extend(["  bell:", f"    gain_db: {result.bell.gain_db:.3f}",
                          f"    center_hz: {result.bell.center_hz:g}", f"    q: {result.bell.q:.6g}"])
        lines.extend([f"  band_low_hz: {low:.6g}", f"  band_high_hz: {high:.6g}",
                      f"  lfo_depth: {result.envelope_lfo.depth:.6g}",
                      f"  lfo_rate_hz: {_yaml_value(result.envelope_lfo.rate_hz)}",
                      f"  target_lufs: {result.integrated_lufs:.6g}"])
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--emit-variants", type=Path)
    args = parser.parse_args(argv)
    paths = sorted(args.input.glob("*")) if args.input.is_dir() else [args.input]
    paths = [path for path in paths if path.suffix.lower() in {".wav", ".flac"}]
    results = [analyze_file(path) for path in paths]
    report_path = args.report or args.input.with_suffix(".html")
    json_path = args.json or args.input.with_suffix(".json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps([asdict(result) for result in results], indent=2), encoding="utf-8")
    render_report(results, report_path)
    if args.emit_variants:
        args.emit_variants.parent.mkdir(parents=True, exist_ok=True)
        emit_variants(results, args.emit_variants)
    return 0


if __name__ == "__main__":
    sys.exit(main())
