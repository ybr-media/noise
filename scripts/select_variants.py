"""Write a variants file holding just the variants a render run asked for.

The orchestrator renders whatever a config file lists, so selecting a subset is
a matter of filtering the matrix rather than adding engine flags.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
FULL = ROOT / "config" / "variants.yaml"
PILOT = ROOT / "config" / "variants_pilot.yaml"


def apply_fx(selected: dict[str, object], fx_json: str | None) -> dict[str, object]:
    """Attach one FX block to every selected variant row."""
    if not fx_json or not fx_json.strip():
        return selected
    try:
        fx = json.loads(fx_json)
    except json.JSONDecodeError as error:
        raise SystemExit(f"--fx is not valid JSON: {error}") from error
    if not isinstance(fx, dict):
        raise SystemExit("--fx must be a JSON object")
    variants = [dict(row, fx=fx) for row in selected.get("variants", [])]
    return {**selected, "variants": variants}


def _matrix(path: Path) -> dict[str, object]:
    loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise SystemExit(f"{path}: variants file must be a mapping")
    variants = loaded.get("variants", [])
    if not isinstance(variants, list) or not all(
        isinstance(row, dict) and isinstance(row.get("variant_id"), str)
        for row in variants
    ):
        raise SystemExit(f"{path}: every variant needs a variant_id")
    return loaded


def select(spec: str) -> dict[str, object]:
    spec = spec.strip()
    if spec in {"full", "all"}:
        return _matrix(FULL)
    if spec == "pilot":
        return _matrix(PILOT)
    # A repeated id is a typo in a dispatch field, not a request to render the
    # same four files twice, so the first mention wins and the order is kept.
    wanted = list(dict.fromkeys(item.strip() for item in spec.split(",") if item.strip()))
    matrix = _matrix(FULL)
    by_id = {row["variant_id"]: row for row in matrix["variants"]}  # type: ignore[union-attr]
    unknown = [item for item in wanted if item not in by_id]
    if unknown:
        raise SystemExit(f"Unknown variant id(s): {', '.join(unknown)}")
    return {**matrix, "variants": [by_id[item] for item in wanted]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", help='"full", "pilot", or a comma-separated list of variant ids')
    parser.add_argument("--out", type=Path, required=True, help="Where to write the filtered variants file")
    parser.add_argument("--fx", default="", help="Optional JSON FX block applied to every selected variant")
    args = parser.parse_args(argv)

    selected = apply_fx(select(args.spec), args.fx)
    args.out.write_text(yaml.safe_dump(selected, sort_keys=False), encoding="utf-8")
    count = len(selected.get("variants", []))
    if not count:
        print("Selection matched no variants", file=sys.stderr)
        return 1
    print(f"count={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
