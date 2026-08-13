"""Tests for the reference-analysis HTML report."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))

from analyze_reference import (
    AudioMeasurement,
    BandMeasurement,
    BellMeasurement,
    LfoMeasurement,
    SpectrumMeasurement,
)
from reference_report import render_report


def _measurement(
    path: str = "/refs/ocean.wav",
    *,
    slope: float | None = -3.0,
    residual: float | None = 1.2,
    bell: BellMeasurement | None = None,
    lfo_status: str = "coherent LFO",
    lfo_confidence: float = 12.0,
    note: str = "fit over 29 bands",
) -> AudioMeasurement:
    spectrum = SpectrumMeasurement(
        fit_low_hz=25.0,
        fit_high_hz=16000.0,
        slope_db_per_oct=slope,
        fit_residual_rms_db=residual,
        r_squared=0.98 if slope is not None else None,
        note=note,
        frequencies_hz=[25.0, 50.0, 100.0],
        levels_db=[-30.0, -33.0, -36.0],
    )
    third_octave = [
        BandMeasurement(center_hz=25.0, low_hz=22.4, high_hz=28.2, relative_db=-1.5, skipped=False),
        BandMeasurement(center_hz=16000.0, low_hz=14167.0, high_hz=17818.0, relative_db=None, skipped=True),
    ]
    lfo = LfoMeasurement(
        depth=0.12,
        rate_hz=0.4,
        confidence=lfo_confidence,
        status=lfo_status,
        times_s=[0.0, 0.5, 1.0],
        rms=[0.1, 0.12, 0.1],
    )
    return AudioMeasurement(
        path=path,
        sample_rate=48000,
        channels=2,
        duration_s=240.0,
        broadband_rms_db=-20.0,
        integrated_lufs=-18.5,
        true_peak_dbtp=-1.2,
        crest_factor_db=12.3,
        stereo_correlation=0.4,
        stereo_width_target=0.6,
        spectrum=spectrum,
        third_octave=third_octave,
        bell=bell,
        envelope_lfo=lfo,
        spectral_flux=0.01234,
        character="steady",
    )


def _render(tmp_path: Path, measurement: AudioMeasurement) -> str:
    destination = tmp_path / "report.html"
    render_report([measurement], destination)
    return destination.read_text(encoding="utf-8")


def test_report_contains_measurement_table_and_plots(tmp_path: Path) -> None:
    destination = tmp_path / "report.html"
    render_report([_measurement()], destination)
    page = destination.read_text(encoding="utf-8")
    assert "<h1>Reference analysis</h1>" in page
    assert "ocean.wav" in page
    assert "-18.50" in page  # integrated LUFS
    assert "-3.000 dB/oct" in page
    assert "residual 1.200 dB" in page
    assert "above Nyquist" in page  # the skipped 16 kHz band
    # Three plots per source, referenced relative to the report.
    for kind in ("spectrum", "third_octave", "envelope"):
        assert f"report_ocean_{kind}.png" in page
        assert (tmp_path / f"report_ocean_{kind}.png").exists()


def test_high_fit_residual_adds_a_caveat(tmp_path: Path) -> None:
    destination = tmp_path / "report.html"
    render_report([_measurement(residual=4.5)], destination)
    page = destination.read_text(encoding="utf-8")
    assert "4.50 dB" in page
    assert "not power-law shaped" in page


def test_low_residual_adds_no_caveat(tmp_path: Path) -> None:
    destination = tmp_path / "report.html"
    render_report([_measurement(residual=1.0)], destination)
    assert "not power-law shaped" not in destination.read_text(encoding="utf-8")


def test_rejected_lfo_peak_is_explained(tmp_path: Path) -> None:
    destination = tmp_path / "report.html"
    render_report(
        [_measurement(lfo_status="no coherent LFO detected", lfo_confidence=5.5)],
        destination,
    )
    page = destination.read_text(encoding="utf-8")
    assert "confidence was 5.50" in page
    assert "no coherent LFO target is reported" in page


def test_skipped_fit_is_reported_as_such(tmp_path: Path) -> None:
    destination = tmp_path / "report.html"
    render_report([_measurement(slope=None, residual=None, note="too short")], destination)
    page = destination.read_text(encoding="utf-8")
    assert "Spectrum fit skipped: too short" in page


def test_bell_absent_and_present(tmp_path: Path) -> None:
    assert "none detected" in _render(tmp_path, _measurement())
    bell = BellMeasurement(gain_db=6.5, center_hz=840.0, q=1.4)
    page = _render(tmp_path, _measurement(bell=bell))
    assert "6.50 dB at 840 Hz (Q 1.40)" in page


def test_html_is_escaped(tmp_path: Path) -> None:
    page = _render(tmp_path, _measurement(path="/refs/<img src=x onerror=alert(1)>.wav"))
    assert "<img src=x onerror=alert(1)>" not in page
    assert "&lt;img src=x onerror=alert(1)&gt;" in page


def test_empty_results_still_write_a_page(tmp_path: Path) -> None:
    destination = tmp_path / "nested" / "report.html"
    render_report([], destination)
    assert "<h1>Reference analysis</h1>" in destination.read_text(encoding="utf-8")


def test_multiple_sources_each_get_a_section(tmp_path: Path) -> None:
    destination = tmp_path / "report.html"
    render_report([_measurement("/refs/a.wav"), _measurement("/refs/b.wav")], destination)
    page = destination.read_text(encoding="utf-8")
    assert page.count("<h2>") == 2
    assert "a.wav" in page and "b.wav" in page
