"""Write a variants file holding just the variants a render run asked for.

The orchestrator renders whatever a config file lists, so selecting a subset is
a matter of filtering the matrix rather than adding engine flags.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
FULL = ROOT / "config" / "variants.yaml"
PILOT = ROOT / "config" / "variants_pilot.yaml"


def select(spec: str) -> dict[str, object]:
    spec = spec.strip()
    if spec in {"full", "all"}:
        return yaml.safe_load(FULL.read_text(encoding="utf-8"))
    if spec == "pilot":
        return yaml.safe_load(PILOT.read_text(encoding="utf-8"))
    wanted = [item.strip() for item in spec.split(",") if item.strip()]
    matrix = yaml.safe_load(FULL.read_text(encoding="utf-8"))
    by_id = {row["variant_id"]: row for row in matrix.get("variants", [])}
    unknown = [item for item in wanted if item not in by_id]
    if unknown:
        raise SystemExit(f"Unknown variant id(s): {', '.join(unknown)}")
    return {**matrix, "variants": [by_id[item] for item in wanted]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", help='"full", "pilot", or a comma-separated list of variant ids')
    parser.add_argument("--out", type=Path, required=True, help="Where to write the filtered variants file")
    args = parser.parse_args(argv)

    selected = select(args.spec)
    args.out.write_text(yaml.safe_dump(selected, sort_keys=False), encoding="utf-8")
    count = len(selected.get("variants", []))
    if not count:
        print("Selection matched no variants", file=sys.stderr)
        return 1
    print(f"count={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
