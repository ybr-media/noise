"""Pure builder for the Audacity scripting-command sequence of one variant.

This module performs no I/O and never talks to Audacity. It turns one variant
row (as emitted into ``config/variants.yaml``) plus the shared ``output`` block
into the ordered list of command strings that ``orchestrator.py`` sends over
the scripting pipe.

Determinism rules encoded here:

* All noise comes from ``NyquistPrompt:`` with an explicit ``(random-seed N)``.
  Audacity's built-in ``Noise:`` generator is unseeded and is never emitted.
* ``(random-seed N)`` -- not ``(seed-random N)`` -- is the function that exists
  in the Nyquist shipped with Audacity 3.7.8.
* Left and right are generated from separate seeds inside a single stereo
  Nyquist expression, so the two channels decorrelate.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

STEMS: tuple[str, ...] = ("bed", "texture", "motion")
CHANNELS: tuple[str, ...] = ("l", "r")

#: Extra audio generated beyond the cell length, consumed by the tail-to-head
#: crossfade that makes the cell loop seamlessly.
CROSSFADE_SECONDS: float = 2.0

# A Nyquist ``noise`` stem is approximately full scale.  The worst-case sum
# of three such stems is +9.54 dBFS, so this common offset leaves substantial
# headroom without changing the configured inter-stem balance.
STEM_HEADROOM_DB: float = -12.0

#: Reference frequency at which the spectral tilt curve is anchored.
TILT_REFERENCE_HZ: float = 1000.0

#: Number of points used to describe the tilt curve to Filter Curve EQ.
TILT_POINTS: int = 25

#: Half-width, in octaves, of the point grid describing a bell curve.
BELL_HALF_WIDTH_OCTAVES: float = 4.0

#: Spacing, in octaves, of the point grid describing a bell curve.
BELL_POINT_SPACING_OCTAVES: float = 0.5

#: Filter Curve EQ works on a 20 Hz - 20 kHz grid.
MIN_CURVE_HZ: float = 20.0
MAX_CURVE_HZ: float = 20000.0


class PlanError(ValueError):
    """Raised when a variant row cannot be turned into a render plan."""


@dataclass(frozen=True)
class Spectrum:
    """Spectral shaping applied to the bed stem."""

    tilt_db_per_oct: float
    tilt_low_hz: float
    tilt_high_hz: float
    bell_gain_db: float | None
    bell_center_hz: float | None
    bell_q: float | None

    @property
    def has_bell(self) -> bool:
        return (
            self.bell_gain_db is not None
            and self.bell_center_hz is not None
            and self.bell_q is not None
        )


@dataclass(frozen=True)
class Variant:
    """The subset of a variant row that the render plan depends on."""

    variant_id: str
    filename: str
    color: str
    band: str
    motion: str
    balance: str
    seeds: Mapping[str, int]
    band_low_hz: float
    band_high_hz: float
    lfo_depth: float
    lfo_rate_hz: float
    gain_bed_db: float
    gain_texture_db: float
    gain_motion_db: float
    spectrum: Spectrum

    def seed(self, stem: str, channel: str) -> int:
        key = f"{stem}_{channel}"
        try:
            return self.seeds[key]
        except KeyError as exc:
            raise PlanError(f"{self.variant_id}: missing seed {key!r}") from exc

    def gain_db(self, stem: str) -> float:
        gains = {
            "bed": self.gain_bed_db,
            "texture": self.gain_texture_db,
            "motion": self.gain_motion_db,
        }
        try:
            return gains[stem]
        except KeyError as exc:
            raise PlanError(f"{self.variant_id}: unknown stem {stem!r}") from exc


@dataclass(frozen=True)
class Output:
    """The shared ``output`` block of the variant matrix."""

    sample_rate: int
    bit_depth: int
    cell_seconds: float
    repeats: int
    fade_seconds: float
    target_lufs: float
    true_peak_max_dbtp: float


@dataclass(frozen=True)
class RenderPlan:
    """An ordered, side-effect-free description of one variant's render."""

    variant: Variant
    output: Output
    export_path: str
    commands: tuple[str, ...]

    @property
    def total_seconds(self) -> float:
        """Duration of the exported file, in seconds."""
        return self.output.cell_seconds * self.output.repeats


def _require(row: Mapping[str, object], key: str, context: str) -> object:
    if key not in row:
        raise PlanError(f"{context}: missing required key {key!r}")
    return row[key]


def _number(row: Mapping[str, object], key: str, context: str) -> float:
    value = _require(row, key, context)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PlanError(f"{context}: {key} must be numeric")
    return float(value)


def _integer(row: Mapping[str, object], key: str, context: str) -> int:
    value = _require(row, key, context)
    if isinstance(value, bool) or not isinstance(value, int):
        raise PlanError(f"{context}: {key} must be an integer")
    return value


def _text(row: Mapping[str, object], key: str, context: str) -> str:
    value = _require(row, key, context)
    if not isinstance(value, str) or not value:
        raise PlanError(f"{context}: {key} must be a non-empty string")
    return value


def _mapping(row: Mapping[str, object], key: str, context: str) -> Mapping[str, object]:
    value = _require(row, key, context)
    if not isinstance(value, dict):
        raise PlanError(f"{context}: {key} must be a mapping")
    return {str(name): item for name, item in value.items()}


def parse_spectrum(block: Mapping[str, object], context: str) -> Spectrum:
    """Build a :class:`Spectrum` from a variant row's ``spectrum`` block."""
    bell_raw = block.get("bell")
    if bell_raw is None:
        return Spectrum(
            tilt_db_per_oct=_number(block, "tilt_db_per_oct", context),
            tilt_low_hz=_number(block, "tilt_low_hz", context),
            tilt_high_hz=_number(block, "tilt_high_hz", context),
            bell_gain_db=None,
            bell_center_hz=None,
            bell_q=None,
        )
    if not isinstance(bell_raw, dict):
        raise PlanError(f"{context}: spectrum.bell must be a mapping")
    bell = {str(name): item for name, item in bell_raw.items()}
    bell_context = f"{context}.bell"
    return Spectrum(
        tilt_db_per_oct=_number(block, "tilt_db_per_oct", context),
        tilt_low_hz=_number(block, "tilt_low_hz", context),
        tilt_high_hz=_number(block, "tilt_high_hz", context),
        bell_gain_db=_number(bell, "gain_db", bell_context),
        bell_center_hz=_number(bell, "center_hz", bell_context),
        bell_q=_number(bell, "q", bell_context),
    )


def parse_variant(row: Mapping[str, object]) -> Variant:
    """Build a :class:`Variant` from one row of ``config/variants.yaml``."""
    context = str(row.get("variant_id", "<unknown variant>"))
    seeds_block = _mapping(row, "seeds", context)
    seeds: dict[str, int] = {}
    for stem in STEMS:
        for channel in CHANNELS:
            key = f"{stem}_{channel}"
            seeds[key] = _integer(seeds_block, key, f"{context}.seeds")
    return Variant(
        variant_id=_text(row, "variant_id", context),
        filename=_text(row, "filename", context),
        color=_text(row, "color", context),
        band=_text(row, "band", context),
        motion=_text(row, "motion", context),
        balance=_text(row, "balance", context),
        seeds=seeds,
        band_low_hz=_number(row, "band_low_hz", context),
        band_high_hz=_number(row, "band_high_hz", context),
        lfo_depth=_number(row, "lfo_depth", context),
        lfo_rate_hz=_number(row, "lfo_rate_hz", context),
        gain_bed_db=_number(row, "gain_bed_db", context),
        gain_texture_db=_number(row, "gain_texture_db", context),
        gain_motion_db=_number(row, "gain_motion_db", context),
        spectrum=parse_spectrum(_mapping(row, "spectrum", context), f"{context}.spectrum"),
    )


def parse_output(block: Mapping[str, object]) -> Output:
    """Build an :class:`Output` from the matrix's ``output`` block."""
    context = "output"
    return Output(
        sample_rate=_integer(block, "sample_rate", context),
        bit_depth=_integer(block, "bit_depth", context),
        cell_seconds=_number(block, "cell_seconds", context),
        repeats=_integer(block, "repeats", context),
        fade_seconds=_number(block, "fade_seconds", context),
        target_lufs=_number(block, "target_lufs", context),
        true_peak_max_dbtp=_number(block, "true_peak_max_dbtp", context),
    )


def _quote(value: str) -> str:
    """Quote a scripting-command argument for Audacity's command parser."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _seconds(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _decibels(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def _nyquist_number(value: float) -> str:
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def nyquist_prompt(expression: str) -> str:
    """Wrap a one-line Nyquist expression in a ``NyquistPrompt:`` command."""
    if "\n" in expression:
        raise PlanError("Nyquist expressions must be a single line")
    return f"NyquistPrompt: Command={_quote(expression)} Version=3"


def _stereo(left: str, right: str) -> str:
    return f"(vector {left} {right})"


def _seeded_noise(seed: int, duration: float) -> str:
    return f"(progn (random-seed {seed}) (noise {_nyquist_number(duration)}))"


def _band_passed_noise(seed: int, duration: float, low_hz: float, high_hz: float) -> str:
    source = _seeded_noise(seed, duration)
    lowpassed = f"(lowpass8 {source} {_nyquist_number(high_hz)})"
    return f"(highpass8 {lowpassed} {_nyquist_number(low_hz)})"


def _modulated_noise(seed: int, duration: float, depth: float, rate_hz: float) -> str:
    source = _seeded_noise(seed, duration)
    if depth <= 0.0 or rate_hz <= 0.0:
        # `still`: keep the stem present so gain staging is unchanged, but emit
        # a static sound rather than a degenerate zero-rate modulator.
        return source
    offset = _nyquist_number(1.0 - depth)
    modulator = (
        f"(sum {offset} (mult {_nyquist_number(depth)} "
        f"(stretch-abs {_nyquist_number(duration)} "
        f"(force-srate *sound-srate* (lfo {_nyquist_number(rate_hz)})))))"
    )
    return f"(mult {source} {modulator})"


def _log_spaced(low_hz: float, high_hz: float, count: int) -> list[float]:
    if count < 2 or high_hz <= low_hz:
        raise PlanError("invalid frequency range for a filter curve")
    ratio = math.log2(high_hz / low_hz)
    return [low_hz * 2 ** (ratio * index / (count - 1)) for index in range(count)]


def _filter_curve(points: Sequence[tuple[float, float]]) -> str:
    """Render a Filter Curve EQ command from (frequency, gain) points."""
    if len(points) < 2:
        raise PlanError("a filter curve needs at least two points")
    parts = [f'f{index}={_quote(_seconds(hz))}' for index, (hz, _) in enumerate(points)]
    parts += [f'v{index}={_quote(_decibels(db))}' for index, (_, db) in enumerate(points)]
    return (
        "FilterCurve: FilterLength=8191 InterpolateLin=0 "
        'InterpolationMethod="B-spline" ' + " ".join(parts)
    )


def tilt_points(spectrum: Spectrum) -> list[tuple[float, float]]:
    """Point grid describing the spectral slope, normalised to 0 dB maximum."""
    frequencies = _log_spaced(spectrum.tilt_low_hz, spectrum.tilt_high_hz, TILT_POINTS)
    gains = [
        spectrum.tilt_db_per_oct * math.log2(hz / TILT_REFERENCE_HZ) for hz in frequencies
    ]
    ceiling = max(gains)
    return [(hz, gain - ceiling) for hz, gain in zip(frequencies, gains, strict=True)]


def bell_points(spectrum: Spectrum) -> list[tuple[float, float]]:
    """Point grid describing a peaking bell, sampled on octave fractions."""
    gain_db = spectrum.bell_gain_db
    center_hz = spectrum.bell_center_hz
    quality = spectrum.bell_q
    if gain_db is None or center_hz is None or quality is None:
        raise PlanError("spectrum has no bell block")
    if center_hz <= 0 or quality <= 0:
        raise PlanError("bell center_hz and q must be positive")
    amplitude = 10 ** (gain_db / 40.0)
    steps = round(2 * BELL_HALF_WIDTH_OCTAVES / BELL_POINT_SPACING_OCTAVES)
    points: list[tuple[float, float]] = []
    for index in range(steps + 1):
        octaves = -BELL_HALF_WIDTH_OCTAVES + index * BELL_POINT_SPACING_OCTAVES
        frequency = center_hz * 2**octaves
        if not MIN_CURVE_HZ <= frequency <= MAX_CURVE_HZ:
            continue
        ratio = frequency / center_hz
        detune = ratio - 1.0 / ratio
        numerator = detune**2 + (amplitude / quality) ** 2
        denominator = detune**2 + 1.0 / (amplitude * quality) ** 2
        points.append((frequency, 10.0 * math.log10(numerator / denominator)))
    return points


def _new_stereo_track(track_index: int, duration: float) -> list[str]:
    """Create a one-second Nyquist target track and select its placeholder."""
    del duration
    placeholder = "1"
    return [
        "NewStereoTrack:",
        (
            f"Select: Start=0 End={placeholder} "
            f"Track={track_index} TrackCount=1 Mode=Set RelativeTo=ProjectStart"
        ),
        f"Silence: Duration={placeholder}",
        (
            f"Select: Start=0 End={placeholder} "
            f"Track={track_index} TrackCount=1 Mode=Set RelativeTo=ProjectStart"
        ),
    ]


def _bed_commands(variant: Variant, track_index: int, duration: float) -> list[str]:
    spectrum = variant.spectrum
    commands = _new_stereo_track(track_index, duration)
    commands.append(
        nyquist_prompt(
            _stereo(
                _seeded_noise(variant.seed("bed", "l"), duration),
                _seeded_noise(variant.seed("bed", "r"), duration),
            )
        )
    )
    if spectrum.tilt_db_per_oct != 0.0:
        commands.append(_filter_curve(tilt_points(spectrum)))
    if spectrum.has_bell:
        commands.append(_filter_curve(bell_points(spectrum)))
    return commands


def _texture_commands(variant: Variant, track_index: int, duration: float) -> list[str]:
    commands = _new_stereo_track(track_index, duration)
    commands.append(
        nyquist_prompt(
            _stereo(
                _band_passed_noise(
                    variant.seed("texture", "l"),
                    duration,
                    variant.band_low_hz,
                    variant.band_high_hz,
                ),
                _band_passed_noise(
                    variant.seed("texture", "r"),
                    duration,
                    variant.band_low_hz,
                    variant.band_high_hz,
                ),
            )
        )
    )
    return commands


def _motion_commands(variant: Variant, track_index: int, duration: float) -> list[str]:
    commands = _new_stereo_track(track_index, duration)
    commands.append(
        nyquist_prompt(
            _stereo(
                _modulated_noise(
                    variant.seed("motion", "l"),
                    duration,
                    variant.lfo_depth,
                    variant.lfo_rate_hz,
                ),
                _modulated_noise(
                    variant.seed("motion", "r"),
                    duration,
                    variant.lfo_depth,
                    variant.lfo_rate_hz,
                ),
            )
        )
    )
    return commands


def _crossfade_expression(cell_seconds: float, crossfade_seconds: float) -> str:
    """Nyquist that folds the tail back over the head and trims to the cell.

    The stems are generated ``crossfade_seconds`` longer than the cell. This
    expression cross-fades that overhanging tail into the head and returns
    exactly ``cell_seconds`` of audio, so repeating the result is seam-free.
    """
    cell = _nyquist_number(cell_seconds)
    fade = _nyquist_number(crossfade_seconds)
    return (
        f"(let* ((cell {cell}) (xf {fade}) "
        "(src (multichan-expand #'extract-abs 0 (+ cell xf) *track*))"
        " (head (multichan-expand #'extract-abs 0 xf src))"
        " (tail (multichan-expand #'cue"
        " (multichan-expand #'extract-abs cell (+ cell xf) src)))"
        " (seam (multichan-expand #'sim"
        " (multichan-expand #'mult head (pwlv 1 xf 0))"
        " (multichan-expand #'mult tail (pwlv 0 xf 1))))"
        " (body (at-abs xf"
        " (multichan-expand #'cue"
        " (multichan-expand #'extract-abs xf cell src)))))"
        " (multichan-expand #'sim seam body))"
    )


def _fade_commands(output: Output, total_seconds: float) -> list[str]:
    fade = output.fade_seconds
    if fade <= 0:
        return []
    return [
        f"Select: Start=0 End={_seconds(fade)} Mode=Set RelativeTo=ProjectStart",
        "FadeIn:",
        (
            f"Select: Start={_seconds(total_seconds - fade)} "
            f"End={_seconds(total_seconds)} Mode=Set RelativeTo=ProjectStart"
        ),
        "FadeOut:",
        f"Select: Start=0 End={_seconds(total_seconds)} Mode=Set RelativeTo=ProjectStart",
    ]


def build_plan(
    variant_row: Mapping[str, object],
    output_row: Mapping[str, object],
    export_path: str,
    crossfade_seconds: float = CROSSFADE_SECONDS,
) -> RenderPlan:
    """Build the full command sequence for one variant.

    ``export_path`` is the absolute path Audacity writes the FLAC to; the
    caller is responsible for combining the output directory with the
    variant's ``filename``.
    """
    variant = parse_variant(variant_row)
    output = parse_output(output_row)
    if crossfade_seconds <= 0 or crossfade_seconds >= output.cell_seconds:
        raise PlanError("crossfade_seconds must be positive and shorter than the cell")
    if output.repeats < 1:
        raise PlanError("repeats must be at least 1")

    stem_seconds = output.cell_seconds + crossfade_seconds
    total_seconds = output.cell_seconds * output.repeats

    commands: list[str] = [
        "SelectAll:",
        "RemoveTracks:",
        f"SetProject: Rate={output.sample_rate}",
    ]
    commands += _bed_commands(variant, 0, stem_seconds)
    commands += _texture_commands(variant, 1, stem_seconds)
    commands += _motion_commands(variant, 2, stem_seconds)

    for index, stem in enumerate(STEMS):
        commands.append(
            f"Select: Track={index} TrackCount=1 Mode=Set "
            "RelativeTo=ProjectStart"
        )
        commands.append(
            f"SetTrackAudio: Volume={_decibels(variant.gain_db(stem) + STEM_HEADROOM_DB)}"
        )

    commands += [
        "SelectAll:",
        "MixAndRender:",
        (
            f"Select: Start=0 End={_seconds(stem_seconds)} "
            "Track=0 TrackCount=1 Mode=Set RelativeTo=ProjectStart"
        ),
        nyquist_prompt(_crossfade_expression(output.cell_seconds, crossfade_seconds)),
        (
            f"Select: Start=0 End={_seconds(output.cell_seconds)} "
            "Track=0 TrackCount=1 Mode=Set RelativeTo=ProjectStart"
        ),
        "Trim:",
    ]

    commands.append(
        "LoudnessNormalization: "
        f"LUFSLevel={_decibels(output.target_lufs)} NormalizeTo=0 "
        "StereoIndependent=0 DualMono=0"
    )

    # `Repeat: Count=N` appends N further copies of the normalized selection,
    # so the selection plus its copies is N + 1 cells long.
    if output.repeats > 1:
        commands.append(f"Repeat: Count={output.repeats - 1}")

    commands += [
        f"Select: Start=0 End={_seconds(total_seconds)} Mode=Set RelativeTo=ProjectStart",
    ]
    commands += _fade_commands(output, total_seconds)
    commands.append(f"Export2: Filename={_quote(export_path)} NumChannels=2")

    return RenderPlan(
        variant=variant,
        output=output,
        export_path=export_path,
        commands=tuple(commands),
    )
