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

from render_plan import (
    MASTER_TRACK_INDEX,
    MAX_CELL_SECONDS,
    MIN_CELL_SECONDS,
    STEM_HEADROOM_DB,
    STEM_MAP,
    PlanError,
    RenderPlan,
    build_plan,
    cell_frames_for_variant,
    stem_filenames,
)

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
    first_gain = next(index for index, command in enumerate(commands) if command.startswith("Amplify:"))
    repeat_index = next(index for index, command in enumerate(commands) if command.startswith("Repeat: Count="))
    fade_in = commands.index("FadeIn:")
    fade_out = commands.index("FadeOut:")
    mix = commands.index("MixAndRenderToNewTrack:")

    # The mix is last: the stems are fully processed before they are summed,
    # and nothing is exported until the caller has measured that mix.
    assert max(generation) < first_gain < repeat_index < fade_in < fade_out < mix
    assert mix == len(commands) - 1
    # `MixAndRender:` discards its sources, which would destroy the stems.
    assert "MixAndRender:" not in commands
    assert not any(command.startswith("LoudnessNormalization:") for command in commands)
    assert not any(command.startswith("Export2:") for command in commands)

    repeat_count = int(re.search(r"Count=(\d+)", commands[repeat_index]).group(1))
    assert repeat_count + 1 == plan.output.repeats == 4
    assert plan.output.cell_seconds * plan.output.sample_rate == round(
        plan.output.cell_seconds * plan.output.sample_rate
    )
    assert MIN_CELL_SECONDS <= plan.output.cell_seconds <= MAX_CELL_SECONDS
    assert plan.output.cell_seconds * plan.output.repeats == plan.total_seconds
    assert commands.count("Silence: Duration=1") == 3
    assert commands.count("Trim:") == 1
    assert commands.index("Trim:") < repeat_index


def _ratio_of(command: str) -> float:
    return float(re.search(r"Ratio=([-\d.e+]+)", command).group(1))


def test_gains_select_each_track_first() -> None:
    plan = _plan()
    for index, stem in enumerate(("bed", "texture", "motion")):
        expected = 10 ** ((plan.variant.gain_db(stem) + STEM_HEADROOM_DB) / 20)
        gain_index = next(
            i for i, command in enumerate(plan.commands)
            if command.startswith("Amplify:")
            and _ratio_of(command) == pytest.approx(expected, rel=1e-6)
        )
        selection = plan.commands[gain_index - 1]
        assert f"Track={index} TrackCount=1 Mode=Set" in selection
        assert "Track=" not in plan.commands[gain_index]
        # A stored-sample gain, not a track slider: the .aup3 serializer reads
        # samples and never sees a slider.
        assert not any(
            command.startswith("SetTrackAudio:") for command in plan.commands
        )


def test_stems_survive_the_mix_on_their_own_tracks() -> None:
    plan = _plan()
    # Three generated stems, then the mix into a fourth track.
    assert plan.commands.count("NewStereoTrack:") == 3
    assert MASTER_TRACK_INDEX == 3
    processing = [
        command
        for command in plan.commands
        if command.startswith("Select:")
        and command.rpartition("TrackCount=")[2].startswith("3")
    ]
    # Crossfade, trim, repeat, fades and the mix all run over all three stems
    # at once, so the stems stay sample-aligned with each other and the master.
    assert len(processing) >= 5
    assert all("Track=0 TrackCount=3" in command for command in processing)


def test_one_shared_gain_covers_master_and_stems() -> None:
    plan = _plan()
    commands = plan.gain_commands(-3.5)
    assert len(commands) == 2
    assert "Track=0 TrackCount=4" in commands[0]
    assert _ratio_of(commands[1]) == pytest.approx(10 ** (-3.5 / 20))
    assert commands[1].endswith("AllowClipping=1")


def test_four_outputs_are_named_and_exported_per_track() -> None:
    plan = _plan()
    assert plan.master_path == "/tmp/wn_white_mid_drift_balanced_s340383017_master.wav"
    assert [Path(path).name for path in plan.stem_paths] == [
        f"wn_white_mid_drift_balanced_s340383017_stem_{number}.wav"
        for number in (1, 2, 3)
    ]
    assert plan.stem_paths == tuple(
        f"/tmp/{name}" for name in stem_filenames(Path(plan.master_path).name)
    )
    assert list(STEM_MAP.items()) == [
        ("stem_1", "bed"),
        ("stem_2", "texture"),
        ("stem_3", "motion"),
    ]
    assert plan.track_paths == (*plan.stem_paths, plan.master_path)

    for index, path in enumerate(plan.track_paths):
        commands = plan.export_commands(index, path)
        # Export2 writes a mixdown of the unmuted tracks, so exporting one
        # track means muting the other three first.
        assert commands[1] == "SetTrack: Mute=1"
        assert "Track=0 TrackCount=4" in commands[0]
        assert f"Track={index} TrackCount=1" in commands[2]
        assert commands[3] == "SetTrack: Mute=0"
        assert commands[4] == f'Export2: Filename="{path}" NumChannels=2'
    with pytest.raises(PlanError):
        plan.export_commands(4, "/tmp/nope.wav")


def test_seeded_noise_and_distinct_channels() -> None:
    output, rows = _pilot()
    for row in rows:
        plan = build_plan(row, output, "/tmp/out_master.wav")
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


def test_variant_duration_is_seeded_whole_sample_and_varies() -> None:
    output, rows = _pilot()
    plans = [build_plan(row, output, "/tmp/out_master.wav") for row in rows]
    durations = {plan.output.cell_seconds for plan in plans}
    assert len(durations) > 1
    for plan in plans:
        expected_frames = cell_frames_for_variant(plan.variant, plan.output.sample_rate)
        assert round(plan.output.cell_seconds * plan.output.sample_rate) == expected_frames
        assert MIN_CELL_SECONDS <= plan.output.cell_seconds <= MAX_CELL_SECONDS
        assert plan.total_seconds == plan.output.cell_seconds * 4
        total_text = f"End={plan.total_seconds:.6f}".rstrip("0").rstrip(".")
        assert any(total_text in command for command in plan.commands)


def test_motion_modulator_matches_stem_duration() -> None:
    plan = _plan()
    motion = next(
        command
        for command in plan.commands
        if "(force-srate *sound-srate* (lfo " in command
    )
    duration = _plan().output.cell_seconds + 2
    duration_text = f"{duration:.6f}".rstrip("0").rstrip(".")
    assert f"(stretch-abs {duration_text}" in motion
    assert (
        f"(abs-env (stretch-abs {duration_text} "
        "(force-srate *sound-srate* (lfo 0.02))))"
        in motion
    )


def test_spectrum_curves_and_motion_variants() -> None:
    output, rows = _pilot()
    plans = {row["color"]: build_plan(row, output, "/tmp/out_master.wav") for row in rows[:4]}
    assert not _filter_commands(plans["white"])

    pink_points = _curve_points(_filter_commands(plans["pink"])[0])
    brown_points = _curve_points(_filter_commands(plans["brown"])[0])
    assert [point[0] for point in pink_points[:4]] == [1.0, 5.0, 15.0, 30.0]
    assert all(left[1] > right[1] for left, right in pairwise(pink_points[3:]))
    assert all(left[1] > right[1] for left, right in pairwise(brown_points[3:]))

    for points, expected_slope in ((pink_points[3:], -3.0), (brown_points[3:], -6.0)):
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
    assert len(_filter_commands(plans["pink"])) == 3
    assert len(_filter_commands(plans["green"])) == 6

    still = build_plan(rows[6], output, "/tmp/out_master.wav")
    drift = build_plan(rows[0], output, "/tmp/out_master.wav")
    breathing = build_plan(rows[7], output, "/tmp/out_master.wav")
    still_motion = next(
        command for command in still.commands
        if f"(random-seed {still.variant.seed('motion', 'l')})" in command
    )
    assert "lfo" not in still_motion and "mult" not in still_motion
    assert "(noise " in still_motion
    assert "(lfo 0.02)" in "\n".join(drift.commands)
    assert "(lfo 0.08)" in "\n".join(breathing.commands)


def test_filter_curve_selection_covers_generated_stem() -> None:
    plan = _plan(1)
    filter_index = next(
        index
        for index, command in enumerate(plan.commands)
        if command.startswith("FilterCurve:")
    )
    stem_duration = plan.output.cell_seconds + 2
    duration_text = f"{stem_duration:.6f}".rstrip("0").rstrip(".")
    assert plan.commands[filter_index - 1].startswith(
        f"Select: Start=0 End={duration_text} Track=0 TrackCount=1"
    )


def test_band_edges_and_nyquist_expression() -> None:
    output, rows = _pilot()
    for row in rows:
        plan = build_plan(row, output, "/tmp/out_master.wav")
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
    assert crossfade.startswith('NyquistPrompt: Command="(abs-env (let*')
    assert "(multichan-expand #'sim seam body)" in crossfade
    assert " (extract-abs 0 (+ cell xf) *track*)" not in crossfade
    assert " (extract-abs 0 xf src)" not in crossfade


def test_project_rate_and_output_format() -> None:
    plan = _plan()
    assert "SetProject: Rate=48000" in plan.commands
    assert all(
        command.endswith("NumChannels=2")
        for path in plan.track_paths
        for command in plan.export_commands(plan.track_paths.index(path), path)
        if command.startswith("Export2:")
    )
    assert all(path.endswith(".wav") for path in plan.track_paths)
    # Export2 has no bit-depth parameter; 24-bit is represented by the
    # sidecar and Audacity's persisted export preferences, not this stream.
    assert plan.output.sample_rate == 48000
    assert plan.output.bit_depth == 24


def test_a_non_master_output_name_is_rejected() -> None:
    output, rows = _pilot()
    with pytest.raises(PlanError):
        build_plan(rows[0], output, "/tmp/wn_white_mid_drift_balanced.wav")
