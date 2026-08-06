"""Contract tests for the pure Audacity command planner."""

from __future__ import annotations

import math
import re
import sys
from itertools import pairwise
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parents[1]))

from render_plan import RenderPlan, build_plan

ROOT = Path(__file__).parents[1]
CURVE_VALUE = re.compile(r'([fv])(\d+)="([^"]+)"')


def _pilot() -> tuple[dict[str, object], list[dict[str, object]]]:
    raw = yaml.safe_load((ROOT / "config" / "variants_pilot.yaml").read_text())
    return raw["output"], raw["variants"]


def _plan(index: int = 0) -> RenderPlan:
    output, rows = _pilot()
    row = rows[index]
    return build_plan(row, output, f"/tmp/{row['filename']}")


def _filter_commands(plan: RenderPlan) -> list[str]:
    return [command for command in plan.commands if command.startswith("FilterCurve:")]


def _curve_points(command: str) -> list[tuple[float, float]]:
    frequencies: dict[int, float] = {}
    values: dict[int, float] = {}
    for kind, index_text, value_text in CURVE_VALUE.findall(command):
        if kind == "f":
            frequencies[int(index_text)] = float(value_text)
        else:
            values[int(index_text)] = float(value_text)
    return [(frequencies[index], values[index]) for index in sorted(frequencies)]


def test_order_duration_and_documented_command_names() -> None:
    plan = _plan()
    commands = plan.commands
    assert "FilterCurve2:" not in "\n".join(commands)
    assert all("Noise:" not in command for command in commands)

    generation = [
        index for index, command in enumerate(commands) if "(random-seed " in command
    ]
    first_gain = next(index for index, command in enumerate(commands) if command.startswith("SetTrackAudio:"))
    mix = commands.index("MixAndRender:")
    repeat_index = next(index for index, command in enumerate(commands) if command.startswith("Repeat: Count="))
    normalization = next(
        index for index, command in enumerate(commands)
        if command.startswith("LoudnessNormalization:")
    )
    normalization_command = commands[normalization]
    assert "LUFSLevel=-20" in normalization_command
    assert "NormalizeTo=0" in normalization_command
    assert "StereoIndependent=0" in normalization_command
    assert "DualMono=0" in normalization_command
    fade_in = commands.index("FadeIn:")
    fade_out = commands.index("FadeOut:")
    export = next(index for index, command in enumerate(commands) if command.startswith("Export2:"))

    assert max(generation) < first_gain < mix < repeat_index < normalization
    assert normalization < fade_in < fade_out < export

    repeat_count = int(re.search(r"Count=(\d+)", commands[repeat_index]).group(1))
    assert plan.output.cell_seconds * (repeat_count + 1) == plan.output.cell_seconds * plan.output.repeats == 240
    assert commands.count("Silence: Duration=1") == 3
    assert commands.count("Trim:") == 1
    assert commands.index("Trim:") < repeat_index


def test_gains_select_each_track_first() -> None:
    plan = _plan()
    for index, stem in enumerate(("bed", "texture", "motion")):
        gain_index = next(
            i for i, command in enumerate(plan.commands)
            if command.startswith("SetTrackAudio:")
            and f"Gain={plan.variant.gain_db(stem):g}" in command
        )
        selection = plan.commands[gain_index - 1]
        assert f"Track={index} TrackCount=1 Mode=Set" in selection
        assert "Track=" not in plan.commands[gain_index]


def test_seeded_noise_and_distinct_channels() -> None:
    output, rows = _pilot()
    for row in rows:
        plan = build_plan(row, output, "/tmp/out.flac")
        for stem in ("bed", "texture", "motion"):
            for channel in ("l", "r"):
                seed = plan.variant.seed(stem, channel)
                assert any(
                    f"(random-seed {seed})" in command
                    for command in plan.commands
                    if command.startswith("NyquistPrompt:") and "(noise " in command
                )
            assert plan.variant.seed(stem, "l") != plan.variant.seed(stem, "r")
        assert all("Noise:" not in command for command in plan.commands)
        assert all("(seed-random " not in command for command in plan.commands)


def test_motion_modulator_matches_stem_duration() -> None:
    plan = _plan()
    motion = next(
        command
        for command in plan.commands
        if "(force-srate *sound-srate* (lfo " in command
    )
    assert "(stretch-abs 62" in motion


def test_spectrum_curves_and_motion_variants() -> None:
    output, rows = _pilot()
    plans = {row["color"]: build_plan(row, output, "/tmp/out.flac") for row in rows[:4]}
    assert not _filter_commands(plans["white"])

    pink_points = _curve_points(_filter_commands(plans["pink"])[0])
    brown_points = _curve_points(_filter_commands(plans["brown"])[0])
    assert all(left[1] > right[1] for left, right in pairwise(pink_points))
    assert all(left[1] > right[1] for left, right in pairwise(brown_points))

    for points, expected_slope in ((pink_points, -3.0), (brown_points, -6.0)):
        first_frequency, first_gain = points[0]
        _, octave_gain = min(
            points[1:],
            key=lambda point: abs(point[0] - first_frequency * 2),
        )
        octave_frequency = min(
            points[1:],
            key=lambda point: abs(point[0] - first_frequency * 2),
        )[0]
        measured_slope = (octave_gain - first_gain) / (
            math.log2(octave_frequency / first_frequency)
        )
        assert measured_slope == pytest.approx(expected_slope, abs=0.1)

    green_points = _curve_points(_filter_commands(plans["green"])[1])
    center_gain = next(gain for frequency, gain in green_points if frequency == 500)
    assert center_gain == pytest.approx(6.0)
    assert center_gain == max(gain for _, gain in green_points)
    assert len(_filter_commands(plans["pink"])) == 1

    still = build_plan(rows[6], output, "/tmp/out.flac")
    drift = build_plan(rows[0], output, "/tmp/out.flac")
    breathing = build_plan(rows[7], output, "/tmp/out.flac")
    still_motion = next(
        command for command in still.commands
        if f"(random-seed {still.variant.seed('motion', 'l')})" in command
    )
    assert "lfo" not in still_motion and "mult" not in still_motion
    assert "(noise " in still_motion
    assert "(lfo 0.02)" in "\n".join(drift.commands)
    assert "(lfo 0.08)" in "\n".join(breathing.commands)


def test_band_edges_and_nyquist_expression() -> None:
    output, rows = _pilot()
    for row in rows:
        plan = build_plan(row, output, "/tmp/out.flac")
        texture = next(command for command in plan.commands if "(lowpass8" in command)
        assert str(row["band_high_hz"]) in texture
        assert str(row["band_low_hz"]) in texture
    expressions = [command for command in _plan().commands if command.startswith("NyquistPrompt:")]
    assert all(" track)" not in command for command in expressions)
    assert all(" s)" not in command for command in expressions)
    assert all("Version=3" in command for command in expressions)
    crossfade = next(
        command
        for command in expressions
        if "(src (multichan-expand #'extract-abs 0 (+ cell xf) *track*))"
        in command
    )
    assert "(head (multichan-expand #'extract-abs 0 xf src))" in crossfade
    assert (
        "(tail (multichan-expand #'cue"
        " (multichan-expand #'extract-abs cell (+ cell xf) src)))"
    ) in crossfade
    assert (
        "(body (at-abs xf"
        " (multichan-expand #'cue"
        " (multichan-expand #'extract-abs xf cell src))))"
    ) in crossfade
    assert "(multichan-expand #'mult head (pwlv 1 xf 0))" in crossfade
    assert "(multichan-expand #'mult tail (pwlv 0 xf 1))" in crossfade
    assert "(multichan-expand #'sim seam body)" in crossfade
    assert " (extract-abs 0 (+ cell xf) *track*)" not in crossfade
    assert " (extract-abs 0 xf src)" not in crossfade


def test_project_rate_export_and_order() -> None:
    plan = _plan()
    commands = plan.commands
    assert "SetProject: Rate=48000" in commands
    export = commands[-1]
    assert export.startswith("Export2:")
    assert 'Filename="/tmp/wn_white_mid_drift_balanced_s340383017.flac"' in export
    assert export.endswith("NumChannels=2")
    assert all(
        command.endswith("NumChannels=2")
        for command in plan.commands
        if command.startswith("Export2:")
    )
    assert export.split("Filename=", 1)[1].split('"', 2)[1].endswith(".flac")
    # Export2 has no bit-depth parameter; 24-bit is represented by the
    # sidecar and Audacity's persisted export preferences, not this stream.
    assert plan.output.sample_rate == 48000
    assert plan.output.bit_depth == 24
