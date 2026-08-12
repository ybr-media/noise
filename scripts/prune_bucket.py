"""Keep the artifact bucket under its free-tier budget.

Two passes: delete stray objects the manifest no longer references, then, if
the referenced set itself is over budget, retire the oldest variants that no
release depends on and rewrite the manifest to match.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from publish_artifacts import (
    EVIDENCE_NAMES,
    MANIFEST_NAME,
    RELEASES_NAME,
    client,
    published_manifest,
)

GB = 1_000_000_000
MB = 1_000_000


def referenced_keys(manifest: dict[str, object]) -> set[str]:
    keys = {MANIFEST_NAME, RELEASES_NAME, *EVIDENCE_NAMES}
    for artifact in manifest.get("artifacts", []):  # type: ignore[union-attr]
        name = artifact["filename"]  # type: ignore[index]
        keys.add(name)
        keys.add(str(Path(name).with_suffix(".json")))
    return keys


def release_variants(releases: dict[str, object]) -> set[str]:
    variants: set[str] = set()
    for release in releases.get("releases", []):  # type: ignore[union-attr]
        for track in release.get("tracks", []):
            variant = track.get("variantId")
            if variant:
                variants.add(variant)
    return variants


def list_objects(s3, bucket: str, prefix: str) -> list[dict[str, object]]:
    objects: list[dict[str, object]] = []
    paginator = s3.get_paginator("list_objects_v2")
    kwargs = {"Bucket": bucket}
    if prefix:
        kwargs["Prefix"] = f"{prefix}/"
    for page in paginator.paginate(**kwargs):
        objects.extend(page.get("Contents", []))
    return objects


def variant_groups(manifest: dict[str, object]) -> list[dict[str, object]]:
    """Group manifest artifacts by variant so masters and stems retire together."""
    groups: dict[str, list[dict[str, object]]] = {}
    for artifact in manifest.get("artifacts", []):  # type: ignore[union-attr]
        variant = ((artifact.get("sidecar") or {}).get("variant_id")) or artifact["filename"]  # type: ignore[union-attr,index]
        groups.setdefault(variant, []).append(artifact)
    return [{"variant": variant, "artifacts": artifacts} for variant, artifacts in groups.items()]


def delete_keys(s3, bucket: str, keys: list[str], dry_run: bool) -> None:
    for start in range(0, len(keys), 1000):
        chunk = keys[start : start + 1000]
        if not dry_run:
            s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": key} for key in chunk], "Quiet": True})
        for key in chunk:
            print(f"{'would delete' if dry_run else 'deleted'} {key}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", default=os.environ.get("R2_BUCKET", "noise-labs"))
    parser.add_argument("--prefix", default=os.environ.get("R2_PREFIX", ""), help="Optional key prefix inside the bucket")
    parser.add_argument("--limit-gb", type=float, default=float(os.environ.get("R2_LIMIT_GB", "10")), help="Bucket size ceiling")
    parser.add_argument("--reserve-mb", type=float, default=float(os.environ.get("R2_RESERVE_MB", "500")), help="Space to keep free under the ceiling")
    parser.add_argument("--dry-run", action="store_true", help="Report what would be deleted without deleting")
    args = parser.parse_args(argv)

    budget = int(args.limit_gb * GB - args.reserve_mb * MB)
    prefix = args.prefix.strip("/")

    def key_for(name: str) -> str:
        return f"{prefix}/{name}" if prefix else name

    def name_for(key: str) -> str:
        return key[len(prefix) + 1 :] if prefix and key.startswith(f"{prefix}/") else key

    s3 = client()
    manifest = published_manifest(s3, args.bucket, key_for(MANIFEST_NAME))
    releases = published_manifest(s3, args.bucket, key_for(RELEASES_NAME))
    objects = list_objects(s3, args.bucket, prefix)
    sizes = {obj["Key"]: obj["Size"] for obj in objects}
    modified = {obj["Key"]: obj["LastModified"] for obj in objects}
    total = sum(sizes.values())
    print(f"{len(objects)} object(s), {total / GB:.2f} GB used, budget {budget / GB:.2f} GB")

    referenced = {key_for(name) for name in referenced_keys(manifest)}
    strays = sorted(key for key in sizes if key not in referenced)
    if strays:
        print(f"Pruning {len(strays)} unreferenced object(s) ({sum(sizes[key] for key in strays) / MB:.1f} MB)")
        delete_keys(s3, args.bucket, strays, args.dry_run)
        total -= sum(sizes[key] for key in strays)

    if total <= budget:
        print(f"{total / GB:.2f} GB used after pruning; within budget")
        return 0

    protected = release_variants(releases)
    epoch = datetime.fromtimestamp(0, timezone.utc)
    groups = [group for group in variant_groups(manifest) if group["variant"] not in protected]
    groups.sort(key=lambda group: min(
        (modified.get(key_for(artifact["filename"]), epoch) for artifact in group["artifacts"]),  # type: ignore[index]
        default=epoch,
    ))
    retired: set[str] = set()
    for group in groups:
        if total <= budget:
            break
        keys: list[str] = []
        for artifact in group["artifacts"]:  # type: ignore[union-attr]
            name = artifact["filename"]  # type: ignore[index]
            retired.add(name)
            for candidate in (key_for(name), key_for(str(Path(name).with_suffix(".json")))):
                if candidate in sizes:
                    keys.append(candidate)
                    total -= sizes[candidate]
        print(f"Retiring variant {group['variant']} ({len(keys)} object(s))")
        delete_keys(s3, args.bucket, keys, args.dry_run)

    if retired:
        manifest = {
            **manifest,
            "artifacts": [
                artifact for artifact in manifest.get("artifacts", [])  # type: ignore[union-attr]
                if artifact["filename"] not in retired  # type: ignore[index]
            ],
        }
        if not args.dry_run:
            s3.put_object(
                Bucket=args.bucket,
                Key=key_for(MANIFEST_NAME),
                Body=json.dumps(manifest, indent=2).encode("utf-8"),
                ContentType="application/json",
            )
        print(f"Manifest rewritten without {len(retired)} retired file(s)")

    if total > budget:
        print(
            f"Still {total / GB:.2f} GB used: every remaining variant is on a release; "
            "delete a release or raise the budget",
            file=sys.stderr,
        )
        return 1
    print(f"{total / GB:.2f} GB used after pruning; within budget")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
