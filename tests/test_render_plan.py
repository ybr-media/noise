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
    assert plan.output.cell_seconds * plan.output.master_sample_rate == round(
        plan.output.cell_seconds * plan.output.master_sample_rate
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
        stem_frames = cell_frames_for_variant(plan.variant, plan.output.stem_sample_rate)
        master_frames = cell_frames_for_variant(plan.variant, plan.output.master_sample_rate)
        reference_frames = MIN_CELL_SECONDS * 48000 + plan.variant.seed("bed", "l") % (
            (MAX_CELL_SECONDS - MIN_CELL_SECONDS) * 48000 + 1
        )
        assert plan.output.cell_seconds == reference_frames / 48000
        assert round(plan.output.cell_seconds * plan.output.stem_sample_rate) == stem_frames
        assert master_frames == stem_frames * 2
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
    assert "SetProject: Rate=96000" in plan.commands
    assert all(
        command.endswith("NumChannels=2")
        for path in plan.track_paths
        for command in plan.export_commands(plan.track_paths.index(path), path)
        if command.startswith("Export2:")
    )
    assert all(path.endswith(".wav") for path in plan.track_paths)
    # Export2 has no bit-depth parameter; 24-bit is represented by the
    # sidecar and Audacity's persisted export preferences, not this stream.
    assert plan.output.master_sample_rate == 96000
    assert plan.output.stem_sample_rate == 48000
    assert plan.output.bit_depth == 24


def test_a_non_master_output_name_is_rejected() -> None:
    output, rows = _pilot()
    with pytest.raises(PlanError):
        build_plan(rows[0], output, "/tmp/wn_white_mid_drift_balanced.wav")


def _fx_row(index: int = 0, **fx: object) -> tuple[dict[str, object], dict[str, object]]:
    output, rows = _pilot()
    row = dict(rows[index])
    row["fx"] = fx
    return row, output


def _fx_plan(**fx: object) -> RenderPlan:
    row, output = _fx_row(**fx)
    return build_plan(row, output, f"/tmp/{row['filename']}")


WARM_BED = [0, 1, 2, 2, 1, 0, -1, -3, -6, -9]
CATHEDRAL = {
    "preset": "cathedral",
    "room_size": 95,
    "pre_delay_ms": 35,
    "reverberance": 90,
    "damping": 25,
    "mix_percent": 45,
}


def test_fx_free_plan_is_unchanged() -> None:
    plain = _plan()
    assert plain.fx is None
    assert plain.tail_seconds == 0
    assert plain.commands[-1] == "MixAndRenderToNewTrack:"
    identity = _fx_plan(eq={"preset": "flat", "gains_db": [0] * 10, "trim_db": 0})
    assert identity.commands == plain.commands
    assert identity.tail_seconds == 0


def test_fx_eq_appends_a_post_mix_filter_curve_over_all_tracks() -> None:
    plan = _fx_plan(eq={"preset": "warm-bed", "gains_db": WARM_BED, "trim_db": 0})
    mix = plan.commands.index("MixAndRenderToNewTrack:")
    curve_index = next(
        index for index, command in enumerate(plan.commands)
        if index > mix and command.startswith("FilterCurve:")
    )
    assert "Track=0 TrackCount=4 Mode=Set" in plan.commands[curve_index - 1]
    assert plan.tail_seconds == 0
    points = _curve_points(plan.commands[curve_index])
    # Warm Bed cuts the top shelf hard, so the curve must fall at the top.
    top = [db for hz, db in points if hz > 12000]
    assert all(db < -2 for db in top)
    mids = [db for hz, db in points if 200 < hz < 350]
    assert all(1 < db < 3 for db in mids)


def test_fx_reverb_appends_tail_reverb_and_final_fade() -> None:
    plan = _fx_plan(reverb=CATHEDRAL)
    assert 0 < plan.tail_seconds <= 8
    assert plan.tail_seconds * plan.output.master_sample_rate == round(
        plan.tail_seconds * plan.output.master_sample_rate
    )
    nominal = plan.output.cell_seconds * plan.output.repeats
    assert plan.total_seconds == nominal + plan.tail_seconds
    mix = plan.commands.index("MixAndRenderToNewTrack:")
    tail = [command for command in plan.commands[mix:] if command.startswith("Silence: Duration=")]
    assert len(tail) == 1
    reverb = next(command for command in plan.commands[mix:] if command.startswith("Reverb:"))
    assert "RoomSize=95" in reverb
    assert "Reverberance=90" in reverb
    assert "WetOnly=0" in reverb
    assert "DryGain=0" in reverb
    assert plan.commands[-1] == "FadeOut:"
    assert f"Start={plan.total_seconds - 0.5:g}" in plan.commands[-2]


def test_fx_tail_grows_with_the_room() -> None:
    small = _fx_plan(reverb={"preset": "small-room", "room_size": 25, "pre_delay_ms": 5, "reverberance": 25, "damping": 50, "mix_percent": 20})
    cathedral = _fx_plan(reverb=CATHEDRAL)
    assert small.tail_seconds < cathedral.tail_seconds


def test_fx_validation_rejects_bad_blocks() -> None:
    with pytest.raises(PlanError):
        _fx_plan(eq={"preset": "custom", "gains_db": [0] * 9, "trim_db": 0})
    with pytest.raises(PlanError):
        _fx_plan(eq={"preset": "custom", "gains_db": [0] * 9 + [25], "trim_db": 0})
    with pytest.raises(PlanError):
        _fx_plan(reverb={**CATHEDRAL, "mix_percent": 120})
    row, output = _fx_row()
    row["fx"] = "cathedral"
    with pytest.raises(PlanError):
        build_plan(row, output, f"/tmp/{row['filename']}")


def test_fx_eq_response_is_zero_when_flat() -> None:
    from render_plan import eq_response_db

    for hz in (31, 500, 16000):
        assert eq_response_db([0.0] * 10, hz, 48000) == 0.0


def test_a_non_numeric_trim_is_a_plan_error_not_a_conversion_error() -> None:
    for trim in ("loud", [0], True, {}):
        with pytest.raises(PlanError, match="trim_db"):
            _fx_plan(eq={"preset": "custom", "gains_db": [0] * 10, "trim_db": trim})


def test_an_absent_or_null_trim_means_no_trim() -> None:
    for block in ({"gains_db": [1] * 10}, {"gains_db": [1] * 10, "trim_db": None}):
        plan = _fx_plan(eq=block)
        assert plan.fx is not None and plan.fx.eq is not None
        assert plan.fx.eq.trim_db == 0.0


def test_an_out_of_range_trim_is_still_rejected() -> None:
    with pytest.raises(PlanError, match="trim_db"):
        _fx_plan(eq={"preset": "custom", "gains_db": [0] * 10, "trim_db": 40})


def test_a_silent_reverb_reports_its_floor_rather_than_failing() -> None:
    from render_plan import REVERB_WET_GAIN_MIN_DB, ReverbFx

    off = ReverbFx("off", room_size=50, pre_delay_ms=0, reverberance=50, damping=50, mix_percent=0)
    assert off.is_off
    assert off.wet_gain_db == REVERB_WET_GAIN_MIN_DB
    # A bypassed reverb contributes no commands and no tail.
    plan = _fx_plan(reverb={**CATHEDRAL, "mix_percent": 0})
    assert plan.tail_seconds == 0
    assert not any(command.startswith("Reverb:") for command in plan.commands)


def test_wet_gain_tracks_the_mix_level_between_its_bounds() -> None:
    from render_plan import ReverbFx

    def wet(mix: float) -> float:
        return ReverbFx("p", 50, 0, 50, 50, mix).wet_gain_db

    assert wet(100) == 0.0
    assert wet(50) == pytest.approx(-6.02, abs=0.01)
    assert wet(1) == -20.0


@pytest.mark.parametrize(
    "override",
    [{"master_sample_rate": -48000}, {"stem_sample_rate": 0}, {"bit_depth": 0}],
)
def test_an_unusable_output_block_is_rejected(override: dict[str, object]) -> None:
    output, rows = _pilot()
    row = rows[0]
    with pytest.raises(PlanError):
        build_plan(row, {**output, **override}, f"/tmp/{row['filename']}")


def test_a_legacy_single_sample_rate_is_validated_too() -> None:
    output, rows = _pilot()
    row = rows[0]
    legacy = {key: value for key, value in output.items() if not key.endswith("_sample_rate")}
    plan = build_plan(row, {**legacy, "sample_rate": 48000}, f"/tmp/{row['filename']}")
    assert plan.output.master_sample_rate == plan.output.stem_sample_rate == 48000
    with pytest.raises(PlanError, match="positive"):
        build_plan(row, {**legacy, "sample_rate": 0}, f"/tmp/{row['filename']}")


def test_a_master_filename_without_a_track_name_is_rejected() -> None:
    from render_plan import is_master_filename, track_name_of_master

    with pytest.raises(PlanError):
        track_name_of_master("_master.wav")
    assert not is_master_filename("_master.wav")
    assert track_name_of_master("wn_a_master.wav") == "wn_a"
    assert stem_filenames("wn_a_master.wav")[0] == "wn_a_stem_1.wav"
