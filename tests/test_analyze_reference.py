from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from analyze_reference import _analysis_pass, analyze_file, main


def write_fixture(path: Path, data: np.ndarray, rate: int = 8000) -> Path:
    sf.write(path, data.astype(np.float32), rate, subtype="FLOAT")
    return path


def test_white_noise_slope(tmp_path: Path) -> None:
    rng = np.random.default_rng(1)
    result = analyze_file(write_fixture(tmp_path / "white.wav", rng.normal(size=160000)))
    assert abs(result.spectrum.slope_db_per_oct or 99) < 1.0


def test_tilted_noise_slopes(tmp_path: Path) -> None:
    rng = np.random.default_rng(2)
    rate = 16000
    white = rng.normal(size=262144)
    freqs = np.fft.rfftfreq(len(white), 1 / rate)
    spectrum = np.fft.rfft(white)
    for target in (-3.0, -6.0):
        shaped = np.fft.irfft(spectrum * np.maximum(freqs, 20) ** (target / (20 * np.log10(2))), len(white))
        result = analyze_file(write_fixture(tmp_path / f"tilt{target}.wav", shaped, rate))
        assert abs((result.spectrum.slope_db_per_oct or 99) - target) < 1.0


def test_bell_is_detected_in_third_octaves(tmp_path: Path) -> None:
    rng = np.random.default_rng(5)
    rate = 16000
    length = 262144
    white = rng.normal(size=length)
    frequencies = np.fft.rfftfreq(length, 1 / rate)
    bell_shape = np.exp(-0.5 * (np.log2(np.maximum(frequencies, 1) / 500.0) / 0.65) ** 2)
    shaped = np.fft.irfft(np.fft.rfft(white) * (1 + (10 ** (6 / 20) - 1) * bell_shape), length)
    result = analyze_file(write_fixture(tmp_path / "bell.wav", shaped, rate))
    emphasized = max((b for b in result.third_octave if b.relative_db is not None and 200 <= b.center_hz <= 2000), key=lambda b: b.relative_db)
    assert emphasized.center_hz in {400, 500, 630}
    assert result.bell is not None
    assert 400 <= result.bell.center_hz <= 630


def test_amplitude_modulation_and_no_lfo(tmp_path: Path) -> None:
    rng = np.random.default_rng(3)
    rate = 8000
    time = np.arange(rate * 120) / rate
    modulated = rng.normal(size=len(time)) * (1 + 0.2 * np.sin(2 * np.pi * 0.08 * time))
    result = analyze_file(write_fixture(tmp_path / "am.wav", modulated, rate))
    assert result.envelope_lfo.rate_hz is not None
    assert abs(result.envelope_lfo.rate_hz - 0.08) < 0.02
    assert 0.12 < result.envelope_lfo.depth < 0.3
    plain = analyze_file(write_fixture(tmp_path / "plain.wav", rng.normal(size=160000), rate))
    assert plain.envelope_lfo.rate_hz is None
    assert plain.envelope_lfo.status == "no coherent LFO detected"


def test_stereo_correlation_and_96k(tmp_path: Path) -> None:
    rng = np.random.default_rng(4)
    left = rng.normal(size=24000)
    independent = analyze_file(write_fixture(tmp_path / "ind.wav", np.column_stack((left, rng.normal(size=len(left))))))
    duplicate = analyze_file(write_fixture(tmp_path / "dup.wav", np.column_stack((left, left))))
    assert abs(independent.stereo_correlation or 1) < 0.1
    assert (duplicate.stereo_correlation or 0) > 0.99
    high_rate = analyze_file(write_fixture(tmp_path / "high.wav", rng.normal(size=96000), 96000))
    assert high_rate.sample_rate == 96000
    assert abs(high_rate.spectrum.slope_db_per_oct or 99) < 1.0
    assert not any(b.skipped for b in high_rate.third_octave)


def test_an_empty_file_names_itself(tmp_path: Path) -> None:
    """A zero-frame source must be reported, not divided by."""
    empty = write_fixture(tmp_path / "empty.wav", np.zeros(0))
    with pytest.raises(ValueError, match="no frames"):
        _analysis_pass(empty)


def test_the_json_and_report_directories_are_created(tmp_path: Path) -> None:
    rng = np.random.default_rng(7)
    source = write_fixture(tmp_path / "source.wav", rng.normal(size=160000))
    destination = tmp_path / "fresh" / "nested"
    assert main([
        str(source),
        "--report", str(destination / "report.html"),
        "--json", str(destination / "measurements.json"),
    ]) == 0
    assert (destination / "measurements.json").exists()
    assert (destination / "report.html").exists()
