"""Synthetic, Audacity-free coverage for the noise QA harness."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parents[1] / "qa"))

import qa_harness

SAMPLE_RATE = 48000
CELL_SECONDS = 2
REPEATS = 4
FADE_SECONDS = 0.2
CELL_FRAMES = SAMPLE_RATE * CELL_SECONDS


def sidecar(**changes: object) -> dict[str, object]:
    result: dict[str, object] = {
        "variant_id": "wn_white_full_static_balanced_s1",
        "color": "white",
        "band": "full",
        "motion": "static",
        "balance": "balanced",
        "seeds": [1, 2],
        "band_low_hz": 100,
        "band_high_hz": 10000,
        "lfo_depth": 0,
        "lfo_rate_hz": 0,
        "per_stem_gains": {"left": 0, "right": 0},
        "target_lufs": -20,
        "true_peak_max_dbtp": -3,
        "cell_seconds": CELL_SECONDS,
        "repeats": REPEATS,
        "fade_seconds": FADE_SECONDS,
        "sample_rate": SAMPLE_RATE,
        "bit_depth": 24,
        "tilt_db_per_oct": 0,
        "audacity_version": "test",
        "render_timestamp": "2025-01-01T00:00:00Z",
    }
    result.update(changes)
    return result


def _tilted_cell(rng: np.random.Generator, slope: float = 0) -> np.ndarray:
    cell = rng.normal(0, 0.08, (CELL_FRAMES, 2))
    if slope:
        frequencies = np.fft.rfftfreq(CELL_FRAMES, 1 / SAMPLE_RATE)
        scale = np.ones_like(frequencies)
        valid = frequencies > 0
        scale[valid] = (frequencies[valid] / 1000) ** (slope / (20 * np.log10(2)))
        for channel in range(2):
            transformed = np.fft.rfft(cell[:, channel])
            cell[:, channel] = np.fft.irfft(transformed * scale, CELL_FRAMES)
        cell *= 0.08 / max(float(np.max(np.abs(cell))), np.finfo(float).tiny)
    cell -= np.mean(cell, axis=0)
    return cell


def make_track(
    directory: Path,
    name: str = "wn_white_full_static_balanced_s1.wav",
    *,
    slope: float = 0,
    bell: bool = False,
) -> Path:
    rng = np.random.default_rng(5)
    cell = _tilted_cell(rng, slope)
    audio = np.tile(cell, (REPEATS, 1))
    if bell:
        time = np.arange(audio.shape[0]) / SAMPLE_RATE
        audio += 0.035 * np.sin(2 * np.pi * 500 * time)[:, None]
    fade_frames = round(FADE_SECONDS * SAMPLE_RATE)
    fade = np.ones(audio.shape[0])
    fade[:fade_frames] = np.linspace(0, 1, fade_frames)
    fade[-fade_frames:] = np.linspace(1, 0, fade_frames)
    audio *= fade[:, None]
    audio -= np.mean(audio, axis=0)
    loudness = pyln.Meter(SAMPLE_RATE).integrated_loudness(audio)
    audio *= 10 ** ((-20 - loudness) / 20)
    path = directory / name
    sf.write(path, audio, SAMPLE_RATE, subtype="PCM_24", format="WAV")
    metadata = sidecar(tilt_db_per_oct=slope)
    if bell:
        metadata["color"] = "green"
        metadata["bell"] = {"gain_db": 6, "center_hz": 500, "q": 1}
    path.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    return path


def checks(path: Path) -> dict[str, object]:
    report = qa_harness.inspect_file(path)
    return {check.name: check for check in report.checks}


def assert_only(path: Path, failing: str) -> None:
    result = checks(path)
    assert result[failing].passed is False
    assert all(check.passed for name, check in result.items() if name != failing)


def test_known_good_and_realistic_fades(tmp_path: Path) -> None:
    path = make_track(tmp_path)
    result = checks(path)
    assert all(check.passed for check in result.values())


def test_targeted_basic_failures(tmp_path: Path) -> None:
    path = make_track(tmp_path)
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio *= 2
    sf.write(path, audio, rate, subtype="PCM_24", format="WAV")
    assert_only(path, "Loudness")

    path = make_track(tmp_path, "wn_white_full_static_balanced_s2.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio[100000, 0] = 1.0
    sf.write(path, audio, rate, subtype="PCM_24", format="WAV")
    result = checks(path)
    failing = {name for name, check in result.items() if not check.passed}
    # A full-scale sample also necessarily exceeds the -3 dBTP true-peak limit.
    assert failing == {"Clipping", "True peak"}

    path = make_track(tmp_path, "wn_white_full_static_balanced_s3.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio += 0.001
    sf.write(path, audio, rate, subtype="PCM_24", format="WAV")
    assert_only(path, "DC offset")

    path = make_track(tmp_path, "wn_white_full_static_balanced_s4.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio[:, 1] = audio[:, 0]
    sf.write(path, audio, rate, subtype="PCM_24", format="WAV")
    assert_only(path, "Stereo decorrelation")


def test_tilts_and_green_bell(tmp_path: Path) -> None:
    pink = make_track(tmp_path, "wn_pink_full_static_balanced_s1.wav", slope=-3)
    brown = make_track(tmp_path, "wn_brown_full_static_balanced_s1.wav", slope=-6)
    assert checks(pink)["Spectral tilt"].passed
    assert checks(brown)["Spectral tilt"].passed
    pink_metadata = json.loads(pink.with_suffix(".json").read_text())
    pink_metadata["color"] = "green"
    pink_metadata["bell"] = {"gain_db": 6, "center_hz": 500, "q": 1}
    pink.with_suffix(".json").write_text(json.dumps(pink_metadata))
    pink_green = checks(pink)["Green bell"]
    assert pink_green.passed is False
    assert float(pink_green.measured.split()[0]) < 1.0
    assert pink_green.details["raw_ratio_db"] > 6.0
    green = make_track(tmp_path, "wn_green_full_static_balanced_s1.wav", bell=True)
    assert checks(green)["Green bell"].passed
    missing = make_track(tmp_path, "wn_green_full_static_balanced_s2.wav")
    metadata = json.loads(missing.with_suffix(".json").read_text())
    metadata["color"] = "green"
    metadata["bell"] = {"gain_db": 6, "center_hz": 500, "q": 1}
    missing.with_suffix(".json").write_text(json.dumps(metadata))
    assert_only(missing, "Green bell")


def test_wrong_tilt_gap_and_first_seam_click(tmp_path: Path) -> None:
    path = make_track(tmp_path, slope=-3)
    metadata = json.loads(path.with_suffix(".json").read_text())
    metadata["tilt_db_per_oct"] = 0
    path.with_suffix(".json").write_text(json.dumps(metadata))
    assert_only(path, "Spectral tilt")

    path = make_track(tmp_path, "wn_white_full_static_balanced_s2.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio[150000:150000 + round(0.2 * rate)] = 0
    sf.write(path, audio, rate, subtype="PCM_24", format="WAV")
    assert_only(path, "Silence/dropout")

    path = make_track(tmp_path, "wn_white_full_static_balanced_s3.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    boundary = CELL_FRAMES
    audio[boundary, :] += 0.65
    sf.write(path, audio, rate, subtype="PCM_24", format="WAV")
    assert_only(path, "Loop seam")


def test_loop_seam_negative_control_uncorrelated_splice(tmp_path: Path) -> None:
    path = make_track(tmp_path, "wn_white_full_static_balanced_s5.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    rng = np.random.default_rng(12345)
    audio[CELL_FRAMES : 2 * CELL_FRAMES] = rng.normal(
        0, 0.5, (CELL_FRAMES, 2)
    )
    sf.write(path, audio, rate, subtype="PCM_24", format="WAV")
    assert not checks(path)["Loop seam"].passed


def test_uniqueness_and_input_errors_do_not_abort_good_file(tmp_path: Path) -> None:
    first = make_track(tmp_path)
    second = tmp_path / "wn_white_full_static_balanced_s2.wav"
    shutil.copyfile(first, second)
    shutil.copyfile(first.with_suffix(".json"), second.with_suffix(".json"))
    missing = tmp_path / "wn_white_full_static_balanced_s3.wav"
    shutil.copyfile(first, missing)
    malformed = tmp_path / "wn_white_full_static_balanced_s4.wav"
    shutil.copyfile(first, malformed)
    malformed.with_suffix(".json").write_text("{")
    missing_key = tmp_path / "wn_white_full_static_balanced_s5.wav"
    shutil.copyfile(first, missing_key)
    incomplete = sidecar()
    incomplete.pop("sample_rate")
    missing_key.with_suffix(".json").write_text(json.dumps(incomplete))
    result = qa_harness.run(tmp_path, None, tmp_path / "report.html", tmp_path / "results.json")
    assert result != 0
    payload = json.loads((tmp_path / "results.json").read_text())
    reports = {item["filename"]: item for item in payload["files"]}
    for filename in (missing.name, malformed.name, missing_key.name):
        input_checks = [check for check in reports[filename]["checks"] if check["name"] == "Input"]
        assert len(input_checks) == 1 and not input_checks[0]["passed"]
    expected_good_checks = {
        "Loudness", "True peak", "Clipping", "DC offset", "Loop seam",
        "Spectral tilt", "Green bell", "Silence/dropout",
        "Stereo decorrelation", "Duration/format", "Uniqueness",
    }
    good_checks = {check["name"] for check in reports[first.name]["checks"]}
    assert expected_good_checks <= good_checks
    uniqueness = {
        item["filename"]: next(check for check in item["checks"] if check["name"] == "Uniqueness")
        for item in payload["files"]
    }
    assert not uniqueness[first.name]["passed"]
    assert not uniqueness[second.name]["passed"]


def test_comparison_missing_and_empty_dirs(tmp_path: Path) -> None:
    left = tmp_path / "left"
    right = tmp_path / "right"
    left.mkdir()
    right.mkdir()
    make_track(left)
    shutil.copytree(left, right, dirs_exist_ok=True)
    assert qa_harness.compare_dirs(left, right).passed
    altered, rate = sf.read(right / "wn_white_full_static_balanced_s1.wav", dtype="float64", always_2d=True)
    altered[100, 0] += 0.01
    sf.write(right / "wn_white_full_static_balanced_s1.wav", altered, rate, subtype="PCM_24", format="WAV")
    assert not qa_harness.compare_dirs(left, right).passed
    shutil.copyfile(left / "wn_white_full_static_balanced_s1.wav", right / "wn_white_full_static_balanced_s1.wav")
    (right / "extra.wav").write_bytes(b"")
    assert not qa_harness.compare_dirs(left, right).passed
    empty = tmp_path / "empty"
    empty.mkdir()
    assert qa_harness.run(empty, None, tmp_path / "empty.html", tmp_path / "empty.json") != 0
    assert qa_harness.run(left, empty, tmp_path / "compare.html", tmp_path / "compare.json") != 0


def test_cli_exit_codes_reports_and_read_only(tmp_path: Path) -> None:
    path = make_track(tmp_path)
    before = {item.name: item.stat().st_mtime_ns for item in tmp_path.iterdir()}
    report = tmp_path.parent / "noisegen-test-report.html"
    result_path = tmp_path.parent / "noisegen-test-results.json"
    assert qa_harness.run(tmp_path, None, report, result_path) == 0
    assert report.exists() and result_path.exists()
    after = {item.name: item.stat().st_mtime_ns for item in tmp_path.iterdir()}
    assert before == after
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio[:, 1] = audio[:, 0]
    sf.write(path, audio, rate, subtype="PCM_24", format="WAV")
    assert qa_harness.run(tmp_path, None, report, result_path) != 0
