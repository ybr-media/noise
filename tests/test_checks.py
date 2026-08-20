"""Unit tests for individual QA measurements and their input contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "qa"))
sys.path.insert(0, str(ROOT))

import checks
from checks import EQ_BAND_HZ, FxEq, Sidecar, SidecarError
from report import FileReport, RunReport, RunSummary, write_reports

SIDECAR: dict[str, object] = {
    "variant_id": "wn_test",
    "color": "white",
    "band": "wide",
    "motion": "still",
    "balance": "even",
    "seeds": [1, 2, 3, 4, 5, 6],
    "band_low_hz": 100.0,
    "band_high_hz": 8000.0,
    "lfo_depth": 0.0,
    "lfo_rate_hz": 0.0,
    "per_stem_gains": {"bed": 0.0, "texture": -3.0, "motion": -6.0},
    "target_lufs": -20.0,
    "true_peak_max_dbtp": -1.0,
    "cell_seconds": 1.0,
    "repeats": 2,
    "fade_seconds": 0.1,
    "sample_rate": 48000,
    "bit_depth": 24,
    "tilt_db_per_oct": 0.0,
    "bell": None,
    "role": "master",
    "stem": None,
    "stem_filenames": ["wn_test_stem_1.wav"],
    "audacity_version": "3.7.8",
    "render_timestamp": "2026-01-01T00:00:00+00:00",
}


def _sidecar(tmp_path: Path, **overrides: object) -> Sidecar:
    path = tmp_path / "sidecar.json"
    path.write_text(json.dumps({**SIDECAR, **overrides}), encoding="utf-8")
    return Sidecar.from_json(path)


def _noise(frames: int, seed: int = 0) -> np.ndarray:
    generator = np.random.default_rng(seed)
    return generator.normal(0.0, 0.05, size=(frames, 2))


def test_audio_shorter_than_one_analysis_window_is_still_measured(tmp_path: Path) -> None:
    """A truncated render must be graded, not reported as an internal error."""
    sidecar = _sidecar(tmp_path, cell_seconds=0.005, repeats=1, fade_seconds=0.0)
    spectrum = checks.analyze_spectrum(_noise(500), sidecar)
    assert spectrum.psd.size == 513
    assert np.all(np.isfinite(spectrum.psd))
    assert set(spectrum.third_octave) >= {1000, 16000}


def test_a_file_shorter_than_its_own_fades_measures_the_whole_file(tmp_path: Path) -> None:
    sidecar = _sidecar(tmp_path, fade_seconds=5.0, cell_seconds=0.02, repeats=1)
    data = _noise(4000)
    assert checks._body(data, sidecar).shape == data.shape
    assert checks.silence(data, sidecar).passed
    assert checks.loop_seam(data, sidecar).passed


def test_the_seam_check_survives_a_file_with_no_interior_to_sample(tmp_path: Path) -> None:
    sidecar = _sidecar(tmp_path, cell_seconds=0.02, repeats=3, fade_seconds=1.0)
    result = checks.loop_seam(_noise(2000), sidecar)
    assert result.name == "Loop seam"
    assert result.details is not None
    assert result.details["metric"] == "second-difference-outlier"


def test_the_analysis_region_excludes_the_fades_and_the_reverb_tail(tmp_path: Path) -> None:
    sidecar = _sidecar(tmp_path, fade_seconds=0.1, tail_seconds=0.2, cell_seconds=1.0, repeats=2)
    data = _noise(96000)
    body = checks._body(data, sidecar)
    assert body.shape[0] == 96000 - 4800 - 4800 - 9600
    assert np.array_equal(body, data[4800:96000 - 4800 - 9600])


@pytest.mark.parametrize("field", ["sample_rate", "bit_depth"])
def test_a_nonpositive_rate_or_depth_is_an_input_error_not_a_crash(tmp_path: Path, field: str) -> None:
    with pytest.raises(SidecarError, match="positive"):
        _sidecar(tmp_path, **{field: 0})


def test_a_negative_frame_count_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(SidecarError, match="expected_frames"):
        _sidecar(tmp_path, expected_frames=-1)


def test_a_valid_sidecar_round_trips_its_declared_fields(tmp_path: Path) -> None:
    sidecar = _sidecar(tmp_path, expected_frames=96000)
    assert (sidecar.variant_id, sidecar.sample_rate, sidecar.expected_frames) == ("wn_test", 48000, 96000)
    assert sidecar.is_master and sidecar.tail_frames == 0


def test_an_eq_block_with_the_wrong_band_count_never_reaches_the_response(tmp_path: Path) -> None:
    with pytest.raises(SidecarError, match="gains_db"):
        _sidecar(tmp_path, fx={"eq": {"gains_db": [0.0, 1.0], "trim_db": 0.0}})
    with pytest.raises(ValueError):
        checks.eq_response_db(FxEq((0.0, 1.0), 0.0), np.array([1000.0]), 48000)


def test_the_eq_response_is_flat_when_every_band_is_zero() -> None:
    frequencies = np.geomspace(20.0, 20000.0, 64)
    response = checks.eq_response_db(FxEq((0.0,) * len(EQ_BAND_HZ), -3.0), frequencies, 48000)
    assert np.allclose(response, -3.0)


def test_a_boosted_band_raises_the_response_around_its_center() -> None:
    gains = [0.0] * len(EQ_BAND_HZ)
    gains[EQ_BAND_HZ.index(1000.0)] = 6.0
    frequencies = np.array([1000.0, 62.0])
    response = checks.eq_response_db(FxEq(tuple(gains), 0.0), frequencies, 48000)
    assert response[0] == pytest.approx(6.0, abs=0.2)
    assert response[1] == pytest.approx(0.0, abs=0.5)


def test_clipping_counts_samples_at_the_bit_depth_s_full_scale(tmp_path: Path) -> None:
    sidecar = _sidecar(tmp_path)
    data = np.zeros((16, 2))
    assert checks.clipping(data, sidecar).passed
    data[3, 1] = 1.0
    result = checks.clipping(data, sidecar)
    assert not result.passed and result.measured == "1 samples"


def test_dc_offset_reports_the_worst_channel(tmp_path: Path) -> None:
    data = np.zeros((1000, 2))
    data[:, 1] = 0.01
    result = checks.dc_offset(data)
    assert not result.passed
    assert result.details is not None
    assert result.details["channel_means"] == [0.0, pytest.approx(0.01)]


def test_decorrelation_separates_a_duplicated_channel_from_independent_noise() -> None:
    independent = _noise(48000)
    assert checks.decorrelation(independent).passed
    duplicated = np.column_stack((independent[:, 0], independent[:, 0]))
    assert not checks.decorrelation(duplicated).passed


def test_true_peak_sees_between_the_samples(tmp_path: Path) -> None:
    sidecar = _sidecar(tmp_path, true_peak_max_dbtp=-1.0)
    # A quarter-rate sine offset by an eighth of a cycle never lands on its own
    # crest, so every stored sample sits 3 dB below the peak a converter
    # reconstructs.
    phase = 2 * np.pi * np.arange(4096) / 4 + np.pi / 4
    signal = 0.9 * np.sin(phase)
    result = checks.true_peak(np.column_stack((signal, signal)), sidecar)
    measured = float(result.measured.split()[0])
    assert measured == pytest.approx(20 * np.log10(0.9), abs=0.05)
    assert measured > 20 * np.log10(float(np.max(np.abs(signal)))) + 2.0
    assert not result.passed


def test_reports_are_written_into_a_directory_that_does_not_exist_yet(tmp_path: Path) -> None:
    report = RunReport(RunSummary(1, 1, 0, (), "PASS"), (FileReport("one.wav", ()),))
    destination = tmp_path / "fresh" / "nested"
    write_reports(destination / "qa.html", destination / "qa.json", report)
    assert "Noise QA: PASS" in (destination / "qa.html").read_text(encoding="utf-8")
    assert json.loads((destination / "qa.json").read_text(encoding="utf-8"))["summary"]["passed"] == 1
