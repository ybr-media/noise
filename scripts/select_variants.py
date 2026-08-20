"""Write a variants file holding just the variants a render run asked for.

The orchestrator renders whatever a config file lists, so selecting a subset is
a matter of filtering the matrix rather than adding engine flags.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
FULL = ROOT / "config" / "variants.yaml"
PILOT = ROOT / "config" / "variants_pilot.yaml"
TAKE_MARKER_PATTERN = re.compile(r"^[a-z0-9]{1,32}$")
MASTER_FILENAME_PATTERN = re.compile(r"^[\w.-]+_master\.wav$")
MAX_REPEATS = 60
SEED_KEYS = ("bed_l", "bed_r", "texture_l", "texture_r", "motion_l", "motion_r")


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


def validate_repeats(repeats: int | None) -> int | None:
    if repeats is None:
        return None
    if isinstance(repeats, bool) or not isinstance(repeats, int) or not 1 <= repeats <= MAX_REPEATS:
        raise ValueError(f"repeats must be an integer between 1 and {MAX_REPEATS}")
    return repeats


def validate_take_marker(take_marker: str | None) -> str | None:
    if take_marker is None or not take_marker:
        return None
    if not TAKE_MARKER_PATTERN.fullmatch(take_marker):
        raise ValueError("take marker must use 1-32 lowercase letters and numbers")
    return take_marker


def validate_seeds(seeds: str | dict[str, object] | None) -> dict[str, int | float] | None:
    if seeds is None or seeds == "":
        return None
    value: object = seeds
    if isinstance(seeds, str):
        try:
            value = json.loads(seeds)
        except json.JSONDecodeError as error:
            raise ValueError(f"seeds are not valid JSON: {error}") from error
    if not isinstance(value, dict) or any(
        key not in value or isinstance(value[key], bool) or not isinstance(value[key], (int, float))
        for key in SEED_KEYS
    ):
        raise ValueError("seeds must contain six numeric values")
    return {key: value[key] for key in SEED_KEYS}  # type: ignore[return-value]


def rewrite_master_filename(filename: str, take_marker: str) -> str:
    if not MASTER_FILENAME_PATTERN.fullmatch(filename):
        raise ValueError(f"not a valid master filename: {filename!r}")
    rewritten = f"{filename[:-len('_master.wav')]}_{take_marker}_master.wav"
    if not MASTER_FILENAME_PATTERN.fullmatch(rewritten):
        raise ValueError(f"not a valid master filename: {rewritten!r}")
    return rewritten


def apply_render_overrides(
    selected: dict[str, object],
    repeats: int | None = None,
    take_marker: str | None = None,
    seeds: str | dict[str, object] | None = None,
) -> dict[str, object]:
    repeats = validate_repeats(repeats)
    take_marker = validate_take_marker(take_marker)
    seed_values = validate_seeds(seeds)
    if (repeats is None) != (take_marker is None):
        raise ValueError("repeats and take marker must be provided together")
    if repeats is None:
        if seed_values is not None:
            raise ValueError("seeds require repeats and take marker")
        return selected
    output = dict(selected.get("output", {})) if isinstance(selected.get("output"), dict) else {}
    output["repeats"] = repeats
    variants = selected.get("variants", [])
    if not isinstance(variants, list):
        raise TypeError("variants must be a list")
    rewritten_variants = []
    for row in variants:
        if not isinstance(row, dict) or not isinstance(row.get("filename"), str):
            raise TypeError("selected variants must contain master filenames")
        rewritten_variants.append({
            **row,
            "filename": rewrite_master_filename(row["filename"], take_marker),
            **({"seeds": seed_values} if seed_values is not None else {}),
        })
    return {**selected, "output": output, "variants": rewritten_variants}


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
    parser.add_argument("--repeats", type=int, default=None, help="Optional output repeat override for a new take")
    parser.add_argument("--take-marker", default=None, help="Optional lowercase marker inserted into master filenames")
    parser.add_argument("--seeds", default=None, help="Optional JSON seed mapping for a new take")
    args = parser.parse_args(argv)

    try:
        selected = apply_render_overrides(select(args.spec), args.repeats, args.take_marker, args.seeds)
    except ValueError as exc:
        parser.error(str(exc))
    selected = apply_fx(selected, args.fx)
    args.out.write_text(yaml.safe_dump(selected, sort_keys=False), encoding="utf-8")
    count = len(selected.get("variants", []))
    if not count:
        print("Selection matched no variants", file=sys.stderr)
        return 1
    print(f"count={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
