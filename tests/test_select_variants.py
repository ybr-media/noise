"""Tests for the select_variants CLI entry point."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
import yaml

SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "select_variants.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("select_variants", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not import {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


select_variants = _load()


def test_main_writes_filtered_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "selected.yaml"
    chosen = select_variants.select("pilot")["variants"][0]["variant_id"]
    assert select_variants.main([chosen, "--out", str(out)]) == 0
    written = yaml.safe_load(out.read_text(encoding="utf-8"))
    assert [row["variant_id"] for row in written["variants"]] == [chosen]
    # The rest of the matrix config rides along unchanged.
    full = select_variants.select("full")
    assert {key: written[key] for key in written if key != "variants"} == {
        key: full[key] for key in full if key != "variants"
    }
    assert capsys.readouterr().out.strip() == "count=1"


def test_main_accepts_full_and_pilot(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    for spec in ("full", "pilot"):
        out = tmp_path / f"{spec}.yaml"
        assert select_variants.main([spec, "--out", str(out)]) == 0
        expected = select_variants.select(spec)
        assert yaml.safe_load(out.read_text(encoding="utf-8")) == expected
    captured = capsys.readouterr().out.strip().splitlines()
    assert all(line.startswith("count=") for line in captured)


def test_main_selection_order_matches_spec(tmp_path: Path) -> None:
    full = select_variants.select("full")["variants"]
    first, second = full[0]["variant_id"], full[1]["variant_id"]
    out = tmp_path / "selected.yaml"
    assert select_variants.main([f"{second},{first}", "--out", str(out)]) == 0
    written = yaml.safe_load(out.read_text(encoding="utf-8"))
    assert [row["variant_id"] for row in written["variants"]] == [second, first]


def test_main_rejects_unknown_ids(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="Unknown variant id"):
        select_variants.main(["not_a_variant", "--out", str(tmp_path / "x.yaml")])


def test_main_requires_out(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        select_variants.main(["pilot"])
    assert "--out" in capsys.readouterr().err


def test_all_is_an_alias_for_full() -> None:
    assert select_variants.select("all") == select_variants.select("full")


def test_empty_selection_exits_nonzero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A spec matching nothing must fail loudly rather than render nothing."""
    monkeypatch.setattr(select_variants, "FULL", tmp_path / "empty.yaml")
    (tmp_path / "empty.yaml").write_text("variants: []\n", encoding="utf-8")
    assert select_variants.main(["full", "--out", str(tmp_path / "out.yaml")]) == 1
    assert "matched no variants" in capsys.readouterr().err
