"""Unit tests for turning a dispatch spec into a filtered variants file."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
import yaml

ROOT = Path(__file__).parents[1]


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    if spec is None or spec.loader is None:
        raise ImportError(f"could not import {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


select_variants = _load("select_variants")


def _ids(selected: dict[str, object]) -> list[str]:
    return [row["variant_id"] for row in selected["variants"]]  # type: ignore[index,union-attr]


def _first_ids(count: int) -> list[str]:
    return _ids(select_variants.select("full"))[:count]


def test_full_and_all_name_the_same_matrix() -> None:
    assert _ids(select_variants.select("full")) == _ids(select_variants.select("all"))


def test_the_selection_keeps_the_matrix_output_block() -> None:
    selected = select_variants.select("pilot")
    assert selected["output"] == yaml.safe_load(
        (ROOT / "config" / "variants_pilot.yaml").read_text(encoding="utf-8")
    )["output"]


def test_explicit_ids_keep_the_order_they_were_requested_in() -> None:
    first, second, third = _first_ids(3)
    assert _ids(select_variants.select(f"{third}, {first},{second}")) == [third, first, second]


def test_a_repeated_id_is_rendered_once() -> None:
    first, second = _first_ids(2)
    assert _ids(select_variants.select(f"{first},{second},{first}")) == [first, second]


def test_one_unknown_id_names_itself_and_fails_the_whole_selection() -> None:
    known = _first_ids(1)[0]
    with pytest.raises(SystemExit, match="not_a_variant"):
        select_variants.select(f"{known},not_a_variant")


def test_a_matrix_without_variant_ids_is_rejected(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    broken = tmp_path / "variants.yaml"
    broken.write_text(yaml.safe_dump({"output": {}, "variants": [{"filename": "x.wav"}]}), encoding="utf-8")
    monkeypatch.setattr(select_variants, "FULL", broken)
    with pytest.raises(SystemExit, match="variant_id"):
        select_variants.select("full")


def test_a_matrix_that_is_not_a_mapping_is_rejected(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    broken = tmp_path / "variants.yaml"
    broken.write_text("- just\n- a list\n", encoding="utf-8")
    monkeypatch.setattr(select_variants, "PILOT", broken)
    with pytest.raises(SystemExit, match="mapping"):
        select_variants.select("pilot")


def test_an_fx_block_is_attached_to_every_selected_row() -> None:
    selected = select_variants.apply_fx(
        select_variants.select("pilot"), '{"reverb": {"mix_percent": 20}}'
    )
    assert all(row["fx"] == {"reverb": {"mix_percent": 20}} for row in selected["variants"])  # type: ignore[index,union-attr]


def test_an_empty_fx_argument_leaves_the_selection_untouched() -> None:
    selected = select_variants.select("pilot")
    assert select_variants.apply_fx(selected, "   ") is selected
    assert select_variants.apply_fx(selected, None) is selected


@pytest.mark.parametrize("payload", ["{not json", '"a string"', "[1, 2]"])
def test_an_fx_argument_that_is_not_a_json_object_is_refused(payload: str) -> None:
    with pytest.raises(SystemExit):
        select_variants.apply_fx(select_variants.select("pilot"), payload)


def test_the_cli_writes_a_loadable_file_and_reports_the_count(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    out = tmp_path / "selected.yaml"
    first, second = _first_ids(2)
    assert select_variants.main([f"{first},{second}", "--out", str(out)]) == 0
    assert _ids(yaml.safe_load(out.read_text(encoding="utf-8"))) == [first, second]
    assert "count=2" in capsys.readouterr().out


def test_the_cli_fails_when_the_spec_selects_nothing(tmp_path: Path) -> None:
    out = tmp_path / "selected.yaml"
    assert select_variants.main([",", "--out", str(out)]) == 1
