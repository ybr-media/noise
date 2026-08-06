"""HTML report rendering for reference measurements."""
from __future__ import annotations

import html
from collections.abc import Sequence
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from analyze_reference import AudioMeasurement

try:
    import matplotlib.pyplot as plt
except ImportError:  # pragma: no cover
    plt = None


def _plot(result: AudioMeasurement, destination: Path) -> list[str]:
    if plt is None:
        return []
    stem = destination.with_suffix("")
    spectrum_path = stem.parent / f"{stem.name}_{Path(result.path).stem}_spectrum.png"
    bands_path = stem.parent / f"{stem.name}_{Path(result.path).stem}_third_octave.png"
    envelope_path = stem.parent / f"{stem.name}_{Path(result.path).stem}_envelope.png"
    plt.figure(figsize=(9, 4))
    plt.semilogx(result.spectrum.frequencies_hz, result.spectrum.levels_db)
    plt.xlabel("Frequency (Hz)"); plt.ylabel("PSD (dB)"); plt.grid(True, which="both")
    plt.tight_layout(); plt.savefig(spectrum_path, dpi=120); plt.close()
    valid = [band for band in result.third_octave if band.relative_db is not None]
    plt.figure(figsize=(9, 4))
    plt.bar([band.center_hz for band in valid], [band.relative_db for band in valid], width=0.12)
    plt.xscale("log"); plt.xlabel("Nominal center (Hz)"); plt.ylabel("Relative dB")
    plt.grid(True, axis="y"); plt.tight_layout(); plt.savefig(bands_path, dpi=120); plt.close()
    plt.figure(figsize=(9, 3))
    plt.plot(result.envelope_lfo.times_s or range(len(result.envelope_lfo.rms)), result.envelope_lfo.rms)
    plt.xlabel("Time (s)"); plt.ylabel("RMS"); plt.tight_layout(); plt.savefig(envelope_path, dpi=120); plt.close()
    return [str(path) for path in (spectrum_path, bands_path, envelope_path)]


def render_report(results: Sequence[AudioMeasurement], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    sections: list[str] = [
        "<!doctype html><meta charset='utf-8'><title>Reference analysis</title>",
        ("<style>body{font:14px sans-serif;max-width:1200px;margin:2em auto} "
         "table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px} "
         "img{max-width:100%}</style><h1>Reference analysis</h1>"),
    ]
    for result in results:
        plots = _plot(result, destination)
        sections.append(f"<h2>{html.escape(Path(result.path).name)}</h2>")
        caveats: list[str] = []
        residual = result.spectrum.fit_residual_rms_db
        if residual is not None and residual > 3.0:
            caveats.append(
                f"The 1/6-octave fit residual is {residual:.2f} dB, so this source is "
                "not power-law shaped and the tilt target is not a meaningful noise-bed target."
            )
        if result.envelope_lfo.status == "no coherent LFO detected" and 0.0 < result.envelope_lfo.confidence < 8.0:
            caveats.append(
                f"An envelope peak was rejected because its confidence was "
                f"{result.envelope_lfo.confidence:.2f}; no coherent LFO target is reported."
            )
        sections.append("<p>" + html.escape(result.spectrum.note) + "</p>")
        if caveats:
            sections.append("<ul>" + "".join(f"<li>{html.escape(caveat)}</li>" for caveat in caveats) + "</ul>")
        bell_text = "none detected" if result.bell is None else (
            f"{result.bell.gain_db:.2f} dB at {result.bell.center_hz:g} Hz (Q {result.bell.q:.2f})"
        )
        rows = [("Sample rate", f"{result.sample_rate} Hz"), ("Duration", f"{result.duration_s:.2f} s"),
                ("Integrated LUFS", f"{result.integrated_lufs:.2f}"), ("True peak", f"{result.true_peak_dbtp:.2f} dBTP"),
                ("Crest factor", f"{result.crest_factor_db:.2f} dB"), ("Stereo correlation", str(result.stereo_correlation)),
                ("Stereo width target", str(result.stereo_width_target)), ("Spectral flux", f"{result.spectral_flux:.5f} ({result.character})"),
                ("Bell", bell_text), ("LFO", f"{result.envelope_lfo.status}; rate={result.envelope_lfo.rate_hz}, depth={result.envelope_lfo.depth:.3f}, confidence={result.envelope_lfo.confidence:.2f}")]
        sections.append("<table>" + "".join(f"<tr><th>{html.escape(k)}</th><td>{html.escape(v)}</td></tr>" for k, v in rows) + "</table>")
        if result.spectrum.slope_db_per_oct is None:
            fit_text = "Spectrum fit skipped: " + result.spectrum.note
        else:
            fit_text = (f"Spectrum fit ({result.spectrum.fit_low_hz:g}–{result.spectrum.fit_high_hz:g} Hz): "
                        f"{result.spectrum.slope_db_per_oct:.3f} dB/oct, "
                        f"residual {result.spectrum.fit_residual_rms_db:.3f} dB, "
                        f"r² {result.spectrum.r_squared:.4f}")
        sections.append(f"<h3>{html.escape(fit_text)}</h3>")
        sections.append("<table><tr><th>Center Hz</th><th>Low</th><th>High</th><th>Relative dB</th></tr>" +
                        "".join(f"<tr><td>{band.center_hz:g}</td><td>{band.low_hz:.1f}</td><td>{band.high_hz:.1f}</td><td>{band.relative_db if band.relative_db is not None else 'above Nyquist'}</td></tr>" for band in result.third_octave) + "</table>")
        sections.extend(f"<p><img src='{html.escape(Path(plot).name)}' alt='plot'></p>" for plot in plots)
    destination.write_text("\n".join(sections), encoding="utf-8")
