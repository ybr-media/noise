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
from checks import Sidecar, duration_format

from resampling import resample_stereo

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
        "expected_frames": CELL_FRAMES * REPEATS,
        "bit_depth": 24,
        "tilt_db_per_oct": 0,
        "audacity_version": "test",
        "render_timestamp": "2025-01-01T00:00:00Z",
        "loudness_gain_db": -3.0,
        "role": "master",
        "stem": None,
        "stem_filenames": [],
        "stem_map": {"stem_1": "bed", "stem_2": "texture", "stem_3": "motion"},
    }
    result.update(changes)
    return result


BELL_GAIN_DB = 6.0
BELL_CENTER_HZ = 500.0
BELL_Q = 1.0


def _peaking_response(frequencies: np.ndarray) -> np.ndarray:
    """Amplitude response of the peaking EQ the green sidecar specifies."""
    amplitude = 10 ** (BELL_GAIN_DB / 40.0)
    response = np.ones_like(frequencies)
    valid = frequencies > 0
    ratio = frequencies[valid] / BELL_CENTER_HZ
    detune = ratio - 1.0 / ratio
    numerator = detune**2 + (amplitude / BELL_Q) ** 2
    denominator = detune**2 + 1.0 / (amplitude * BELL_Q) ** 2
    response[valid] = np.sqrt(numerator / denominator)
    return response


def _belled(audio: np.ndarray) -> np.ndarray:
    frequencies = np.fft.rfftfreq(audio.shape[0], 1 / SAMPLE_RATE)
    response = _peaking_response(frequencies)
    shaped = np.empty_like(audio)
    for channel in range(audio.shape[1]):
        transformed = np.fft.rfft(audio[:, channel])
        shaped[:, channel] = np.fft.irfft(transformed * response, audio.shape[0])
    return shaped


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


#: Fractions of the master carried by each fixture stem.  Real stems are
#: independent sources; a QA fixture only has to sum back to its master.
STEM_WEIGHTS = (0.5, 0.3, 0.2)


def stem_paths(master: Path) -> list[Path]:
    base = master.name.removesuffix(".wav").removesuffix("_master")
    return [master.with_name(f"{base}_stem_{number}.wav") for number in (1, 2, 3)]


def write_group(master: Path, audio: np.ndarray, rate: int) -> None:
    """Write a master and the three stems that sum back to it."""
    sf.write(master, audio, rate, subtype="PCM_24", format="WAV")
    metadata = json.loads(master.with_suffix(".json").read_text())
    names = [path.name for path in stem_paths(master)]
    metadata["stem_filenames"] = names
    master.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    for number, (path, weight) in enumerate(zip(stem_paths(master), STEM_WEIGHTS), start=1):
        sf.write(path, audio * weight, rate, subtype="PCM_24", format="WAV")
        path.with_suffix(".json").write_text(
            json.dumps({
                **metadata,
                "role": f"stem_{number}",
                "stem": ("bed", "texture", "motion")[number - 1],
            }),
            encoding="utf-8",
        )


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
        audio = _belled(audio)
    fade_frames = round(FADE_SECONDS * SAMPLE_RATE)
    fade = np.ones(audio.shape[0])
    fade[:fade_frames] = np.linspace(0, 1, fade_frames)
    fade[-fade_frames:] = np.linspace(1, 0, fade_frames)
    audio *= fade[:, None]
    audio -= np.mean(audio, axis=0)
    loudness = pyln.Meter(SAMPLE_RATE).integrated_loudness(audio)
    audio *= 10 ** ((-20 - loudness) / 20)
    path = directory / name
    metadata = sidecar(tilt_db_per_oct=slope)
    if bell:
        metadata["color"] = "green"
        metadata["bell"] = {"gain_db": BELL_GAIN_DB, "center_hz": BELL_CENTER_HZ, "q": BELL_Q}
    path.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    write_group(path, audio, SAMPLE_RATE)
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
    write_group(path, audio, rate)
    assert_only(path, "Loudness")

    path = make_track(tmp_path, "wn_white_full_static_balanced_s2.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio[100000, 0] = 1.0
    write_group(path, audio, rate)
    result = checks(path)
    failing = {name for name, check in result.items() if not check.passed}
    # A full-scale sample also necessarily exceeds the -3 dBTP true-peak limit.
    assert failing == {"Clipping", "True peak"}

    path = make_track(tmp_path, "wn_white_full_static_balanced_s3.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio += 0.001
    write_group(path, audio, rate)
    assert_only(path, "DC offset")

    path = make_track(tmp_path, "wn_white_full_static_balanced_s4.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    audio[:, 1] = audio[:, 0]
    write_group(path, audio, rate)
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
    write_group(path, audio, rate)
    assert_only(path, "Silence/dropout")

    path = make_track(tmp_path, "wn_white_full_static_balanced_s3.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    boundary = CELL_FRAMES
    audio[boundary, :] += 0.65
    write_group(path, audio, rate)
    assert_only(path, "Loop seam")


def test_loop_seam_negative_control_uncorrelated_splice(tmp_path: Path) -> None:
    path = make_track(tmp_path, "wn_white_full_static_balanced_s5.wav")
    audio, rate = sf.read(path, dtype="float64", always_2d=True)
    rng = np.random.default_rng(12345)
    audio[CELL_FRAMES : 2 * CELL_FRAMES] = rng.normal(
        0, 0.5, (CELL_FRAMES, 2)
    )
    write_group(path, audio, rate)
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


def test_duration_format_requires_exact_variant_frame_count(tmp_path: Path) -> None:
    track = make_track(tmp_path)
    with sf.SoundFile(track) as info:
        result = duration_format(info, Sidecar.from_json(track.with_suffix(".json")))
    assert result.passed
    altered = tmp_path / "altered.wav"
    sf.write(altered, np.zeros((CELL_FRAMES * REPEATS - 1, 2)), SAMPLE_RATE, subtype="PCM_24")
    with sf.SoundFile(altered) as info:
        result = duration_format(info, Sidecar.from_json(track.with_suffix(".json")))
    assert not result.passed


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
    write_group(path, audio, rate)
    assert qa_harness.run(tmp_path, None, report, result_path) != 0


def test_only_masters_are_graded_and_their_stems_must_sum(tmp_path: Path) -> None:
    master = make_track(tmp_path)
    assert len(list(tmp_path.glob("*.wav"))) == 4
    assert qa_harness.run(tmp_path, None, tmp_path / "r.html", tmp_path / "r.json") == 0
    payload = json.loads((tmp_path / "r.json").read_text())
    # The stems ride along with their master instead of being graded as
    # finished mixes of their own.
    assert [item["filename"] for item in payload["files"]] == [master.name]
    result = checks(master)["Stem sum"]
    assert result.passed
    assert result.details["stems"] == [path.name for path in stem_paths(master)]

    first = stem_paths(master)[0]
    audio, rate = sf.read(first, dtype="float64", always_2d=True)
    sf.write(first, audio * 1.01, rate, subtype="PCM_24", format="WAV")
    assert_only(master, "Stem sum")
    assert qa_harness.run(tmp_path, None, tmp_path / "r.html", tmp_path / "r.json") != 0

    first.unlink()
    stem_check = checks(master)["Stem sum"]
    assert not stem_check.passed
    assert first.name in stem_check.measured


def test_a_master_whose_stems_are_the_wrong_length_fails(tmp_path: Path) -> None:
    master = make_track(tmp_path)
    short = stem_paths(master)[1]
    audio, rate = sf.read(short, dtype="float64", always_2d=True)
    sf.write(short, audio[:-1], rate, subtype="PCM_24", format="WAV")
    assert_only(master, "Stem sum")


def test_different_rate_stem_sum_uses_resampled_null_depth(tmp_path: Path) -> None:
    rng = np.random.default_rng(19)
    source = rng.normal(0, 0.05, (96000 * CELL_SECONDS * REPEATS, 2))
    master = tmp_path / "wn_white_full_static_balanced_resampled.wav"
    metadata = sidecar(
        sample_rate=96000,
        expected_frames=source.shape[0],
        stem_filenames=[],
    )
    master.write_bytes(b"")
    master.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    sf.write(master, source, 96000, subtype="PCM_24", format="WAV")
    stems = []
    for number, weight in enumerate(STEM_WEIGHTS, start=1):
        path = master.with_name(f"{master.stem.removesuffix('_resampled')}_stem_{number}.wav")
        stems.append(path)
        sf.write(path, resample_stereo(source * weight, 96000, 48000), 48000, subtype="PCM_24", format="WAV")
    metadata["stem_filenames"] = [path.name for path in stems]
    master.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    for number, path in enumerate(stems, start=1):
        path.with_suffix(".json").write_text(
            json.dumps({**metadata, "role": f"stem_{number}", "stem": ("bed", "texture", "motion")[number - 1], "sample_rate": 48000, "expected_frames": source.shape[0] // 2}),
            encoding="utf-8",
        )
    assert checks(master)["Stem sum"].passed
    altered = sf.read(stems[0], dtype="float64", always_2d=True)[0]
    altered[10, 0] += 0.01
    sf.write(stems[0], altered, 48000, subtype="PCM_24", format="WAV")
    assert checks(master)["Stem sum"].passed is False


def test_duration_format_falls_back_for_legacy_sidecar(tmp_path: Path) -> None:
    path = make_track(tmp_path)
    metadata = json.loads(path.with_suffix(".json").read_text())
    metadata.pop("expected_frames")
    path.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    with sf.SoundFile(path) as info:
        assert duration_format(info, Sidecar.from_json(path.with_suffix(".json"))).passed


def _with_tail(audio: np.ndarray, tail_seconds: float) -> np.ndarray:
    tail_frames = round(tail_seconds * SAMPLE_RATE)
    rng = np.random.default_rng(9)
    tail = rng.normal(0, 0.005, (tail_frames, 2))
    tail *= np.linspace(1, 0, tail_frames)[:, None]
    return np.concatenate([audio, tail])


def test_a_reverb_tail_in_the_sidecar_extends_the_expected_duration(tmp_path: Path) -> None:
    path = make_track(tmp_path)
    audio, rate = sf.read(path)
    tailed = _with_tail(audio, 2.0)
    metadata = json.loads(path.with_suffix(".json").read_text())
    metadata["tail_seconds"] = 2.0
    metadata.pop("expected_frames")
    path.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    write_group(path, tailed, rate)
    result = checks(path)
    assert result["Duration/format"].passed
    # Without the metadata the same file must fail the duration check.
    metadata.pop("tail_seconds")
    path.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    write_group(path, tailed, rate)
    assert checks(path)["Duration/format"].passed is False


def test_fx_eq_metadata_normalises_the_measured_spectrum(tmp_path: Path) -> None:
    from render_plan import EqFx, eq_points

    gains = [0, 0, -1, -2, -4, -6, -9, -12, -15, -18]
    path = make_track(tmp_path)
    audio, rate = sf.read(path)
    spectrum = np.fft.rfft(audio, axis=0)
    frequencies = np.fft.rfftfreq(audio.shape[0], 1 / rate)
    points = eq_points(EqFx(preset="midnight", gains_db=tuple(gains), trim_db=0.0), rate)
    hz = np.array([point[0] for point in points])
    db = np.array([point[1] for point in points])
    response = np.interp(np.maximum(frequencies, hz[0]), hz, db)
    shaped = np.fft.irfft(spectrum * (10 ** (response / 20))[:, None], n=audio.shape[0], axis=0)
    metadata = json.loads(path.with_suffix(".json").read_text())
    metadata["fx"] = {"eq": {"preset": "midnight", "gains_db": gains, "trim_db": 0}}
    path.with_suffix(".json").write_text(json.dumps(metadata), encoding="utf-8")
    write_group(path, shaped, rate)
    result = checks(path)
    assert result["Spectral tilt"].passed
