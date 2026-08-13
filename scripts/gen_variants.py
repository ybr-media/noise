"""Generate deterministic noise-generator variant manifests.

The default command writes ``config/variants.yaml``.  The manifest has an
``output`` block copied from dimensions.yaml and a ``variants`` list containing
one row for every ordered combination in ``dimension_order``.  ``--pilot``
writes the ordered subset in the YAML ``pilot`` block instead.
"""

from __future__ import annotations

import argparse
import hashlib
from collections.abc import Mapping, Sequence
from itertools import product
from pathlib import Path
from typing import cast

import yaml

Scalar = str | int | float | bool | None
YamlValue = Scalar | Mapping[str, "YamlValue"] | Sequence["YamlValue"]
YamlMapping = dict[str, YamlValue]

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR.parent / "config" / "dimensions.yaml"
DEFAULT_OUTPUT_PATH = SCRIPT_DIR.parent / "config" / "variants.yaml"
PILOT_OUTPUT_PATH = SCRIPT_DIR.parent / "config" / "variants_pilot.yaml"


def _mapping(value: object, context: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise TypeError(f"{context} must be a mapping")
    return cast(Mapping[str, object], value)


def load_dimensions(path: Path = CONFIG_PATH) -> Mapping[str, object]:
    """Load and validate the dimensions document."""
    with path.open(encoding="utf-8") as stream:
        loaded = yaml.safe_load(stream)
    return _mapping(loaded, str(path))


def _merge_mapping(target: YamlMapping, source: Mapping[str, object]) -> None:
    for key, value in source.items():
        if isinstance(value, Mapping):
            existing = target.get(key)
            if existing is None:
                nested: YamlMapping = {}
                target[key] = nested
            elif isinstance(existing, dict):
                nested = existing
            else:
                raise ValueError(f"cannot merge mapping into scalar key {key!r}")
            _merge_mapping(nested, _mapping(value, f"parameter {key!r}"))
        else:
            target[key] = cast(YamlValue, value)


def _seed(variant_id: str, stem: str, channel: str) -> int:
    material = f"{variant_id}:{stem}:{channel}".encode()
    value = int.from_bytes(hashlib.blake2b(material, digest_size=8).digest(), "big")
    return (value & 0x7FFFFFFF) or 1


def _value_combinations(
    config: Mapping[str, object], pilot: bool
) -> list[tuple[str, ...]]:
    dimensions = _mapping(config["dimensions"], "dimensions")
    order = [str(item) for item in cast(Sequence[object], config["dimension_order"])]
    if pilot:
        pilot_rows = cast(Sequence[object], config["pilot"])
        return [
            tuple(str(_mapping(row, "pilot row")[name]) for name in order)
            for row in pilot_rows
        ]
    choices = []
    for name in order:
        values = _mapping(dimensions[name], f"dimension {name!r}")
        choices.append(tuple(str(value) for value in values))
    return [tuple(choice) for choice in product(*choices)]


def build_variants(config: Mapping[str, object], pilot: bool = False) -> list[YamlMapping]:
    """Build either the complete matrix or the configured pilot subset."""
    dimensions = _mapping(config["dimensions"], "dimensions")
    order = [str(item) for item in cast(Sequence[object], config["dimension_order"])]
    stems = [str(item) for item in cast(Sequence[object], config["stems"])]
    channels = [str(item) for item in cast(Sequence[object], config["channels"])]
    rows: list[YamlMapping] = []

    for combination in _value_combinations(config, pilot):
        variant_id = "wn_" + "_".join(combination)
        row: YamlMapping = {
            "variant_id": variant_id,
            **dict(zip(order, combination)),
        }
        for dimension_name, value_name in zip(order, combination):
            values = _mapping(dimensions[dimension_name], f"dimension {dimension_name!r}")
            parameters = _mapping(
                values[value_name],
                f"value {dimension_name!r}/{value_name!r}",
            )
            _merge_mapping(row, parameters)

        seeds: YamlMapping = {}
        for stem in stems:
            for channel in channels:
                seeds[f"{stem}_{channel}"] = _seed(variant_id, stem, channel)
        row["seeds"] = seeds
        # The renderer derives the three stem filenames from this one by
        # replacing the "_master" suffix with "_stem_1".."_stem_3".
        row["filename"] = f"{variant_id}_s{seeds['bed_l']}_master.wav"
        rows.append(row)
    return rows


def write_variants(
    config_path: Path = CONFIG_PATH,
    output_path: Path = DEFAULT_OUTPUT_PATH,
    pilot: bool = False,
) -> None:
    """Generate and write a stable YAML manifest."""
    config = load_dimensions(config_path)
    document: YamlMapping = {
        "output": cast(YamlMapping, dict(_mapping(config["output"], "output"))),
        "variants": build_variants(config, pilot=pilot),
    }
    rendered = yaml.safe_dump(
        document,
        allow_unicode=False,
        default_flow_style=False,
        explicit_start=False,
        sort_keys=True,
        width=120,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pilot",
        action="store_true",
        help="write the ordered pilot subset instead of the full matrix",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="override the output manifest path",
    )
    args = parser.parse_args()
    output_path = args.output or (PILOT_OUTPUT_PATH if args.pilot else DEFAULT_OUTPUT_PATH)
    write_variants(output_path=output_path, pilot=args.pilot)


if __name__ == "__main__":
    main()
