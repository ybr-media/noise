from __future__ import annotations

import importlib.util
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import cast

import yaml

SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "gen_variants.py"
SPEC = importlib.util.spec_from_file_location("gen_variants", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise ImportError(f"could not import {SCRIPT_PATH}")
GENERATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GENERATOR)


CONFIG_PATH = SCRIPT_PATH.parents[1] / "config" / "dimensions.yaml"
FULL_PATH = SCRIPT_PATH.parents[1] / "config" / "variants.yaml"
PILOT_PATH = SCRIPT_PATH.parents[1] / "config" / "variants_pilot.yaml"


def _read_rows(path: Path) -> list[Mapping[str, object]]:
    with path.open(encoding="utf-8") as stream:
        document = cast(Mapping[str, object], yaml.safe_load(stream))
    return cast(list[Mapping[str, object]], document["variants"])


def test_full_matrix_has_unique_rows() -> None:
    rows = _read_rows(FULL_PATH)
    assert len(rows) == 144
    assert len({row["variant_id"] for row in rows}) == 144
    assert len({row["filename"] for row in rows}) == 144


def test_generation_is_byte_deterministic(tmp_path: Path) -> None:
    first = tmp_path / "first.yaml"
    second = tmp_path / "second.yaml"
    GENERATOR.write_variants(output_path=first)
    GENERATOR.write_variants(output_path=second)
    assert first.read_bytes() == second.read_bytes()


def test_seed_sets_are_unique_and_members_are_distinct() -> None:
    rows = _read_rows(FULL_PATH)
    seed_sets = []
    for row in rows:
        seeds = cast(Mapping[str, int], row["seeds"])
        values = list(seeds.values())
        assert len(values) == 6
        assert len(set(values)) == 6
        seed_sets.append(tuple(sorted(values)))
    assert len(set(seed_sets)) == len(seed_sets)


def test_adding_dimension_value_requires_no_code_change(tmp_path: Path) -> None:
    copied_config = tmp_path / "dimensions.yaml"
    shutil.copyfile(CONFIG_PATH, copied_config)
    config = GENERATOR.load_dimensions(copied_config)
    dimensions = cast(dict[str, object], config["dimensions"])
    colors = cast(dict[str, object], dimensions["color"])
    colors["ultraviolet"] = colors["white"]
    copied_config.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    output = tmp_path / "variants.yaml"
    GENERATOR.write_variants(config_path=copied_config, output_path=output)
    assert len(_read_rows(output)) == 180


def test_pilot_is_expected_ordered_subset() -> None:
    expected = [
        "wn_white_mid_drift_balanced",
        "wn_green_mid_drift_balanced",
        "wn_pink_mid_drift_balanced",
        "wn_brown_mid_drift_balanced",
        "wn_pink_low-mid_drift_balanced",
        "wn_pink_high_drift_balanced",
        "wn_pink_mid_still_balanced",
        "wn_pink_mid_breathing_texture-forward",
    ]
    pilot_ids = [str(row["variant_id"]) for row in _read_rows(PILOT_PATH)]
    full_ids = {str(row["variant_id"]) for row in _read_rows(FULL_PATH)}
    assert pilot_ids == expected
    assert set(pilot_ids) <= full_ids
