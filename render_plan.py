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

Every variant exports four aligned files: the mixed master plus the three
stems it was mixed from. The three stems stay in the project as tracks 0-2 and
the master is mixed into a fourth track, so the stems survive the mix and every
file is written from the same post-processed audio.  Loudness is measured once,
on the master, by the caller; the resulting fixed linear gain is then applied
identically to all four tracks through :meth:`RenderPlan.gain_commands`, which
is what keeps ``sum(stems) == master``.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import PurePath

STEMS: tuple[str, ...] = ("bed", "texture", "motion")
CHANNELS: tuple[str, ...] = ("l", "r")

#: Track holding the mixed master once the stems have been mixed into it.
MASTER_TRACK_INDEX: int = len(STEMS)

#: Suffix identifying the mixed master among a variant's four output files.
MASTER_SUFFIX: str = "_master"

#: ``stem_N`` key -> stem name.  Numbers are one-based and are part of the
#: published contract, so consumers never have to parse filenames.
STEM_MAP: Mapping[str, str] = {
    f"stem_{number}": stem for number, stem in enumerate(STEMS, start=1)
}

#: Extra audio generated beyond the cell length, consumed by the tail-to-head
#: crossfade that makes the cell loop seamlessly.
CROSSFADE_SECONDS: float = 2.0
MIN_CELL_SECONDS: int = 45
MAX_CELL_SECONDS: int = 75

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

#: Center frequencies of the 10-band FX graphic EQ. The two outer bands are
#: shelves; the eight inner bands are peaking filters.
EQ_BAND_HZ: tuple[float, ...] = (
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0
)

#: Quality factor of the eight inner peaking bands.
EQ_BAND_Q: float = 1.4

#: Per-band gain limit of the FX graphic EQ.
EQ_MAX_ABS_DB: float = 20.0

#: Master trim limit applied after the EQ stage.
FX_TRIM_MAX_ABS_DB: float = 12.0

#: Number of points describing the EQ response to Filter Curve EQ.
EQ_CURVE_POINTS: int = 61

#: Longest reverb tail appended past the nominal track length.
REVERB_TAIL_CAP_SECONDS: float = 8.0

#: Fade applied to the very end of the reverb tail so it never hard-cuts.
TAIL_FADE_SECONDS: float = 0.5

#: Audacity's Reverb effect accepts wet gains between -20 and +10 dB.
REVERB_WET_GAIN_MIN_DB: float = -20.0


class PlanError(ValueError):
    """Raised when a variant row cannot be turned into a render plan."""


def master_filename(track_name: str, suffix: str = ".wav") -> str:
    """Return the master filename for a variant's base track name."""
    return f"{track_name}{MASTER_SUFFIX}{suffix}"


def stem_filename(track_name: str, number: int, suffix: str = ".wav") -> str:
    """Return the filename of one one-based stem of a variant."""
    if not 1 <= number <= len(STEMS):
        raise PlanError(f"stem number out of range: {number}")
    return f"{track_name}_stem_{number}{suffix}"


def track_name_of_master(filename: str) -> str:
    """Return the base track name of a master filename."""
    stem, dot, _ = filename.rpartition(".")
    name = stem if dot else filename
    if not name.endswith(MASTER_SUFFIX):
        raise PlanError(f"not a master filename: {filename!r}")
    return name[: -len(MASTER_SUFFIX)]


def is_master_filename(filename: str) -> bool:
    """Return whether ``filename`` names a mixed master."""
    try:
        track_name_of_master(filename)
    except PlanError:
        return False
    return True


def stem_filenames(master: str) -> tuple[str, ...]:
    """Return the three stem filenames belonging to a master filename."""
    _, dot, extension = master.rpartition(".")
    suffix = f".{extension}" if dot else ""
    track_name = track_name_of_master(master)
    return tuple(
        stem_filename(track_name, number, suffix)
        for number in range(1, len(STEMS) + 1)
    )


def _stem_paths(master_path: str) -> tuple[str, ...]:
    path = PurePath(master_path)
    return tuple(
        str(path.with_name(name)) for name in stem_filenames(path.name)
    )


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
class EqFx:
    """The 10-band graphic EQ stage of a render's FX block."""

    preset: str
    gains_db: tuple[float, ...]
    trim_db: float

    @property
    def is_flat(self) -> bool:
        return self.trim_db == 0.0 and all(gain == 0.0 for gain in self.gains_db)


@dataclass(frozen=True)
class ReverbFx:
    """The freeverb-style reverb stage of a render's FX block.

    ``mix_percent`` is the single user-facing wet level: 100 puts the wet
    path at unity next to the always-unity dry path, 0 bypasses the stage.
    """

    preset: str
    room_size: float
    pre_delay_ms: float
    reverberance: float
    damping: float
    mix_percent: float

    @property
    def is_off(self) -> bool:
        return self.mix_percent <= 0.0

    @property
    def wet_gain_db(self) -> float:
        wet = 20.0 * math.log10(self.mix_percent / 100.0)
        return max(REVERB_WET_GAIN_MIN_DB, min(0.0, wet))


@dataclass(frozen=True)
class Fx:
    """Optional post-mix frequency shaping and spatial processing."""

    eq: EqFx | None
    reverb: ReverbFx | None

    @property
    def is_identity(self) -> bool:
        return (self.eq is None or self.eq.is_flat) and (
            self.reverb is None or self.reverb.is_off
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
    """An ordered, side-effect-free description of one variant's render.

    ``commands`` leaves the project with the three post-processed stems on
    tracks 0-2 and the mixed master on track 3, at its natural level.  The
    caller then measures the master, applies :meth:`gain_commands` once and
    writes the four files.
    """

    variant: Variant
    output: Output
    master_path: str
    stem_paths: tuple[str, ...]
    commands: tuple[str, ...]
    fx: Fx | None = None
    tail_seconds: float = 0.0

    @property
    def total_seconds(self) -> float:
        """Duration of the exported files, in seconds, including any FX tail."""
        return self.output.cell_seconds * self.output.repeats + self.tail_seconds

    @property
    def track_paths(self) -> tuple[str, ...]:
        """Output paths indexed by the project track they are written from."""
        return (*self.stem_paths, self.master_path)

    def gain_commands(self, gain_db: float) -> tuple[str, ...]:
        """Commands applying one fixed gain to the master and every stem.

        ``Amplify`` takes an absolute linear ratio, so a single command over
        the whole four-track selection scales every track by exactly the same
        factor and leaves the stem sum equal to the master.
        """
        return (
            self._select(0, len(self.track_paths)),
            f"Amplify: Ratio={_ratio(gain_db)} AllowClipping=1",
        )

    def export_commands(self, track_index: int, export_path: str) -> tuple[str, ...]:
        """Commands exporting one track of the finished project.

        ``Export2`` mixes down the unmuted tracks, so isolating a track means
        muting every other one first.
        """
        if not 0 <= track_index < len(self.track_paths):
            raise PlanError(f"track index out of range: {track_index}")
        return (
            self._select(0, len(self.track_paths)),
            "SetTrack: Mute=1",
            self._select(track_index, 1),
            "SetTrack: Mute=0",
            f"Export2: Filename={_quote(export_path)} NumChannels=2",
        )

    def _select(self, track_index: int, track_count: int) -> str:
        return (
            f"Select: Start=0 End={_seconds(self.total_seconds)} "
            f"Track={track_index} TrackCount={track_count} "
            "Mode=Set RelativeTo=ProjectStart"
        )


def _require(row: Mapping[str, object], key: str, context: str) -> object:
    if key not in row:
        raise PlanError(f"{context}: missing required key {key!r}")
    return row[key]


def _number(row: Mapping[str, object], key: str, context: str) -> float:
    value = _require(row, key, context)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PlanError(f"{context}: {key} must be numeric")
    return float(value)


def cell_frames_for_variant(variant: Variant, sample_rate: int) -> int:
    """Return the deterministic whole-sample cell length for one variant."""
    if sample_rate <= 0:
        raise PlanError("sample_rate must be positive")
    minimum = MIN_CELL_SECONDS * sample_rate
    span = (MAX_CELL_SECONDS - MIN_CELL_SECONDS) * sample_rate
    return minimum + variant.seed("bed", "l") % (span + 1)


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


def _bounded(value: float, low: float, high: float, name: str, context: str) -> float:
    if not low <= value <= high:
        raise PlanError(f"{context}: {name} must be between {low:g} and {high:g}")
    return value


def parse_fx(block: object, context: str) -> Fx | None:
    """Build an :class:`Fx` from a variant row's optional ``fx`` block."""
    if block is None:
        return None
    if not isinstance(block, Mapping):
        raise PlanError(f"{context}: fx must be a mapping")
    eq: EqFx | None = None
    reverb: ReverbFx | None = None
    fx_block = {str(name): item for name, item in block.items()}
    eq_raw = fx_block.get("eq")
    if eq_raw is not None:
        if not isinstance(eq_raw, Mapping):
            raise PlanError(f"{context}: fx.eq must be a mapping")
        eq_block = {str(name): item for name, item in eq_raw.items()}
        eq_context = f"{context}.fx.eq"
        gains_raw = _require(eq_block, "gains_db", eq_context)
        if not isinstance(gains_raw, Sequence) or isinstance(gains_raw, (str, bytes)):
            raise PlanError(f"{eq_context}: gains_db must be a list")
        if len(gains_raw) != len(EQ_BAND_HZ):
            raise PlanError(
                f"{eq_context}: gains_db must have {len(EQ_BAND_HZ)} entries"
            )
        gains: list[float] = []
        for gain in gains_raw:
            if isinstance(gain, bool) or not isinstance(gain, (int, float)):
                raise PlanError(f"{eq_context}: gains_db entries must be numeric")
            gains.append(_bounded(float(gain), -EQ_MAX_ABS_DB, EQ_MAX_ABS_DB, "gains_db", eq_context))
        trim = float(eq_block.get("trim_db", 0.0) or 0.0)
        eq = EqFx(
            preset=str(eq_block.get("preset", "custom")),
            gains_db=tuple(gains),
            trim_db=_bounded(trim, -FX_TRIM_MAX_ABS_DB, FX_TRIM_MAX_ABS_DB, "trim_db", eq_context),
        )
    reverb_raw = fx_block.get("reverb")
    if reverb_raw is not None:
        if not isinstance(reverb_raw, Mapping):
            raise PlanError(f"{context}: fx.reverb must be a mapping")
        reverb_block = {str(name): item for name, item in reverb_raw.items()}
        reverb_context = f"{context}.fx.reverb"
        reverb = ReverbFx(
            preset=str(reverb_block.get("preset", "custom")),
            room_size=_bounded(_number(reverb_block, "room_size", reverb_context), 0.0, 100.0, "room_size", reverb_context),
            pre_delay_ms=_bounded(_number(reverb_block, "pre_delay_ms", reverb_context), 0.0, 200.0, "pre_delay_ms", reverb_context),
            reverberance=_bounded(_number(reverb_block, "reverberance", reverb_context), 0.0, 100.0, "reverberance", reverb_context),
            damping=_bounded(_number(reverb_block, "damping", reverb_context), 0.0, 100.0, "damping", reverb_context),
            mix_percent=_bounded(_number(reverb_block, "mix_percent", reverb_context), 0.0, 100.0, "mix_percent", reverb_context),
        )
    if eq is None and reverb is None:
        return None
    return Fx(eq=eq, reverb=reverb)


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


def _ratio(gain_db: float) -> str:
    """Render a decibel gain as the linear ratio ``Amplify`` expects."""
    return f"{10.0 ** (gain_db / 20.0):.9g}"


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


def _clamped(expression: str, duration: float) -> str:
    """Clamp a stem expression to exactly ``duration`` seconds.

    Filters and modulators can leave a channel a sample longer or shorter
    than its siblings; stems of different lengths make later whole-track
    edits (crossfade, ``Trim:``, ``Repeat:``) leave stray clip fragments
    that abort the render.  Summing with silence pads a short expression and
    ``extract-abs`` trims a long one, so every stem lands on the same frame.
    """
    dur = _nyquist_number(duration)
    return f"(abs-env (extract-abs 0 {dur} (sim (s-rest {dur}) {expression})))"


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
        f"(abs-env (stretch-abs {_nyquist_number(duration)} "
        f"(force-srate *sound-srate* (lfo {_nyquist_number(rate_hz)}))))))"
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
        "FilterCurve: FilterLength=8191 InterpolateLin=1 "
        'InterpolationMethod="B-spline" ' + " ".join(parts)
    )


def _spectrum_commands(
    spectrum: Spectrum,
    track_index: int,
    duration: float,
    *,
    include_bell: bool = True,
) -> list[str]:
    if spectrum.tilt_db_per_oct == 0.0 and (
        not include_bell or not spectrum.has_bell
    ):
        return []
    commands = [
        (
            f"Select: Start=0 End={_seconds(duration)} "
            f"Track={track_index} TrackCount=1 Mode=Set RelativeTo=ProjectStart"
        )
    ]
    if spectrum.tilt_db_per_oct != 0.0:
        commands.append(_filter_curve(tilt_points(spectrum)))
    if include_bell and spectrum.has_bell:
        commands.append(_filter_curve(bell_points(spectrum)))
    return commands


def tilt_points(spectrum: Spectrum) -> list[tuple[float, float]]:
    """Point grid describing tilt with a sub-30 Hz high-pass rolloff."""
    corner_hz = 30.0
    frequencies = _log_spaced(spectrum.tilt_low_hz, spectrum.tilt_high_hz, TILT_POINTS)
    gains = [
        spectrum.tilt_db_per_oct * math.log2(hz / TILT_REFERENCE_HZ) for hz in frequencies
    ]
    ceiling = max(gains)
    points = [
        (hz, gain - ceiling)
        for hz, gain in zip(frequencies, gains, strict=True)
        if hz >= corner_hz
    ]
    at_corner = spectrum.tilt_db_per_oct * math.log2(corner_hz / TILT_REFERENCE_HZ) - ceiling
    return [
        (1.0, at_corner - 96.0),
        (5.0, at_corner - 60.0),
        (15.0, at_corner - 24.0),
        (corner_hz, at_corner),
        *points,
    ]


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


def _biquad_response_db(
    b0: float, b1: float, b2: float, a0: float, a1: float, a2: float,
    hz: float, sample_rate: float,
) -> float:
    omega = 2.0 * math.pi * hz / sample_rate
    z1 = complex(math.cos(-omega), math.sin(-omega))
    z2 = z1 * z1
    numerator = b0 + b1 * z1 + b2 * z2
    denominator = a0 + a1 * z1 + a2 * z2
    magnitude = abs(numerator) / max(abs(denominator), 1e-30)
    return 20.0 * math.log10(max(magnitude, 1e-30))


def _shelf_coefficients(
    frequency: float, gain_db: float, sample_rate: float, *, high: bool
) -> tuple[float, float, float, float, float, float]:
    """RBJ shelf coefficients with S=1, matching Web Audio's BiquadFilterNode."""
    amplitude = 10.0 ** (gain_db / 40.0)
    omega = 2.0 * math.pi * frequency / sample_rate
    cos_w = math.cos(omega)
    alpha = math.sin(omega) / 2.0 * math.sqrt(amplitude + 1.0 / amplitude)
    two_sqrt_a_alpha = 2.0 * math.sqrt(amplitude) * alpha
    sign = 1.0 if high else -1.0
    b0 = amplitude * ((amplitude + 1) + sign * (amplitude - 1) * cos_w + two_sqrt_a_alpha)
    b1 = -2.0 * sign * amplitude * ((amplitude - 1) + sign * (amplitude + 1) * cos_w)
    b2 = amplitude * ((amplitude + 1) + sign * (amplitude - 1) * cos_w - two_sqrt_a_alpha)
    a0 = (amplitude + 1) - sign * (amplitude - 1) * cos_w + two_sqrt_a_alpha
    a1 = 2.0 * sign * ((amplitude - 1) - sign * (amplitude + 1) * cos_w)
    a2 = (amplitude + 1) - sign * (amplitude - 1) * cos_w - two_sqrt_a_alpha
    return b0, b1, b2, a0, a1, a2


def _peaking_coefficients(
    frequency: float, gain_db: float, quality: float, sample_rate: float
) -> tuple[float, float, float, float, float, float]:
    amplitude = 10.0 ** (gain_db / 40.0)
    omega = 2.0 * math.pi * frequency / sample_rate
    alpha = math.sin(omega) / (2.0 * quality)
    cos_w = math.cos(omega)
    return (
        1.0 + alpha * amplitude,
        -2.0 * cos_w,
        1.0 - alpha * amplitude,
        1.0 + alpha / amplitude,
        -2.0 * cos_w,
        1.0 - alpha / amplitude,
    )


def eq_response_db(
    gains_db: Sequence[float], hz: float, sample_rate: float
) -> float:
    """Combined response of the 10-band EQ at one frequency.

    The low and high bands are shelves and the inner bands peaking filters,
    mirroring the Web Audio preview chain node for node, so the rendered curve
    and the previewed curve are the same function.
    """
    total = 0.0
    for band_hz, gain_db in zip(EQ_BAND_HZ, gains_db, strict=True):
        if gain_db == 0.0:
            continue
        if band_hz == EQ_BAND_HZ[0]:
            coefficients = _shelf_coefficients(band_hz, gain_db, sample_rate, high=False)
        elif band_hz == EQ_BAND_HZ[-1]:
            coefficients = _shelf_coefficients(band_hz, gain_db, sample_rate, high=True)
        else:
            coefficients = _peaking_coefficients(band_hz, gain_db, EQ_BAND_Q, sample_rate)
        total += _biquad_response_db(*coefficients, hz, sample_rate)
    return total


def eq_points(eq: EqFx, sample_rate: float) -> list[tuple[float, float]]:
    """Point grid describing the EQ (plus trim) to Filter Curve EQ."""
    frequencies = _log_spaced(MIN_CURVE_HZ, MAX_CURVE_HZ, EQ_CURVE_POINTS)
    return [
        (hz, eq_response_db(eq.gains_db, hz, sample_rate) + eq.trim_db)
        for hz in frequencies
    ]


def reverb_tail_seconds(reverb: ReverbFx | None, sample_rate: int) -> float:
    """Whole-sample tail length appended so the reverb decays naturally.

    The estimate approximates freeverb's RT60 from reverberance and room
    size, plus the pre-delay, capped at :data:`REVERB_TAIL_CAP_SECONDS`.
    """
    if reverb is None or reverb.is_off:
        return 0.0
    rt60 = (reverb.reverberance / 100.0) ** 1.5 * (
        2.0 + 6.0 * reverb.room_size / 100.0
    )
    tail = min(REVERB_TAIL_CAP_SECONDS, 0.15 + rt60 + reverb.pre_delay_ms / 1000.0)
    return round(tail * sample_rate) / sample_rate


def _fx_commands(
    fx: Fx | None,
    total_seconds: float,
    tail_seconds: float,
    track_count: int,
    sample_rate: float,
) -> list[str]:
    """Post-mix FX applied identically to the master and every stem.

    Both stages are linear and time-invariant, so applying the same chain to
    each of the four tracks keeps ``sum(stems) == master`` exactly.
    """
    if fx is None or fx.is_identity:
        return []

    def select(start: float, end: float) -> str:
        return (
            f"Select: Start={_seconds(start)} End={_seconds(end)} "
            f"Track=0 TrackCount={track_count} Mode=Set RelativeTo=ProjectStart"
        )

    commands: list[str] = []
    if fx.eq is not None and not fx.eq.is_flat:
        commands.append(select(0, total_seconds))
        commands.append(_filter_curve(eq_points(fx.eq, sample_rate)))
    reverb = fx.reverb
    if reverb is not None and not reverb.is_off:
        end = total_seconds + tail_seconds
        commands += [
            select(total_seconds, end),
            f"Silence: Duration={_seconds(tail_seconds)}",
            select(0, end),
            (
                "Reverb: "
                f"RoomSize={_decibels(reverb.room_size)} "
                f"Delay={_decibels(reverb.pre_delay_ms)} "
                f"Reverberance={_decibels(reverb.reverberance)} "
                f"HfDamping={_decibels(reverb.damping)} "
                "ToneLow=100 ToneHigh=100 "
                f"WetGain={_decibels(reverb.wet_gain_db)} "
                "DryGain=0 StereoWidth=100 WetOnly=0"
            ),
            select(end - TAIL_FADE_SECONDS, end),
            "FadeOut:",
        ]
    return commands


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
                _clamped(_seeded_noise(variant.seed("bed", "l"), duration), duration),
                _clamped(_seeded_noise(variant.seed("bed", "r"), duration), duration),
            )
        )
    )
    commands.extend(_spectrum_commands(spectrum, track_index, duration))
    return commands


def _texture_commands(variant: Variant, track_index: int, duration: float) -> list[str]:
    commands = _new_stereo_track(track_index, duration)
    commands.append(
        nyquist_prompt(
            _stereo(
                _clamped(
                    _band_passed_noise(
                        variant.seed("texture", "l"),
                        duration,
                        variant.band_low_hz,
                        variant.band_high_hz,
                    ),
                    duration,
                ),
                _clamped(
                    _band_passed_noise(
                        variant.seed("texture", "r"),
                        duration,
                        variant.band_low_hz,
                        variant.band_high_hz,
                    ),
                    duration,
                ),
            )
        )
    )
    commands.extend(_spectrum_commands(variant.spectrum, track_index, duration))
    return commands


def _motion_commands(variant: Variant, track_index: int, duration: float) -> list[str]:
    commands = _new_stereo_track(track_index, duration)
    commands.append(
        nyquist_prompt(
            _stereo(
                _clamped(
                    _modulated_noise(
                        variant.seed("motion", "l"),
                        duration,
                        variant.lfo_depth,
                        variant.lfo_rate_hz,
                    ),
                    duration,
                ),
                _clamped(
                    _modulated_noise(
                        variant.seed("motion", "r"),
                        duration,
                        variant.lfo_depth,
                        variant.lfo_rate_hz,
                    ),
                    duration,
                ),
            )
        )
    )
    commands.extend(_spectrum_commands(variant.spectrum, track_index, duration))
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
        f"(abs-env (let* ((cell {cell}) (xf {fade}) "
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
        " (multichan-expand #'sim seam body)))"
    )


def _stem_selection(start: float, end: float) -> str:
    """Select one time range across all three stem tracks."""
    return (
        f"Select: Start={_seconds(start)} End={_seconds(end)} "
        f"Track=0 TrackCount={len(STEMS)} Mode=Set RelativeTo=ProjectStart"
    )


def _fade_commands(output: Output, total_seconds: float) -> list[str]:
    fade = output.fade_seconds
    if fade <= 0:
        return []
    return [
        _stem_selection(0, fade),
        "FadeIn:",
        _stem_selection(total_seconds - fade, total_seconds),
        "FadeOut:",
        _stem_selection(0, total_seconds),
    ]


def build_plan(
    variant_row: Mapping[str, object],
    output_row: Mapping[str, object],
    master_path: str,
    crossfade_seconds: float = CROSSFADE_SECONDS,
) -> RenderPlan:
    """Build the render command sequence for one variant.

    ``master_path`` is the absolute path of the mixed master; the caller is
    responsible for combining the output directory with the variant's
    ``filename``.  The three stem paths are derived from it, so the master
    filename is the single source of truth for a variant's file group.
    """
    variant = parse_variant(variant_row)
    output = parse_output(output_row)
    fx = parse_fx(variant_row.get("fx"), variant.variant_id)
    cell_frames = cell_frames_for_variant(variant, output.sample_rate)
    output = replace(output, cell_seconds=cell_frames / output.sample_rate)
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

    # Bake the balance into the samples rather than riding the track's volume
    # slider: a slider only affects what Audacity itself mixes and exports,
    # while the .aup3 serializer reads the stored samples.
    for index, stem in enumerate(STEMS):
        commands.append(
            f"Select: Start=0 End={_seconds(stem_seconds)} "
            f"Track={index} TrackCount=1 Mode=Set RelativeTo=ProjectStart"
        )
        commands.append(
            "Amplify: "
            f"Ratio={_ratio(variant.gain_db(stem) + STEM_HEADROOM_DB)} "
            "AllowClipping=1"
        )

    # Every stem is looped, trimmed and faded identically, so the stems stay
    # sample-aligned with each other and with the master mixed from them.
    commands += [
        _stem_selection(0, stem_seconds),
        nyquist_prompt(_crossfade_expression(output.cell_seconds, crossfade_seconds)),
        _stem_selection(0, output.cell_seconds),
        "Trim:",
    ]

    # `Repeat: Count=N` appends N further copies of the selection, so the
    # selection plus its copies is N + 1 cells long.
    if output.repeats > 1:
        commands.append(f"Repeat: Count={output.repeats - 1}")

    commands.append(_stem_selection(0, total_seconds))
    commands += _fade_commands(output, total_seconds)

    # `MixAndRenderToNewTrack` keeps its sources, unlike `MixAndRender`, so
    # the three stems remain exportable next to the master they sum to.
    commands += [
        _stem_selection(0, total_seconds),
        "MixAndRenderToNewTrack:",
    ]

    tail_seconds = reverb_tail_seconds(
        fx.reverb if fx is not None else None, output.sample_rate
    )
    commands += _fx_commands(
        fx, total_seconds, tail_seconds, len(STEMS) + 1, output.sample_rate
    )

    return RenderPlan(
        variant=variant,
        output=output,
        master_path=master_path,
        stem_paths=_stem_paths(master_path),
        commands=tuple(commands),
        fx=fx,
        tail_seconds=tail_seconds,
    )
