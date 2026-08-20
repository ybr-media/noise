"""Validate, merge, and publish one release document to object storage."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from publish_artifacts import client, merged_releases, published_manifest

RELEASES_NAME = "releases.json"


def with_release(document: dict[str, object], release: dict[str, object]) -> dict[str, object]:
    """Add or replace one release in a releases document.

    The incoming payload is the newer edit, so it replaces any release already
    stored under the same id -- matching how the console merges a release it
    saves directly.
    """
    entries = {
        entry["id"]: entry
        for entry in document.get("releases", [])  # type: ignore[union-attr]
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    entries[str(release["id"])] = release
    return {**document, "releases": [entries[name] for name in sorted(entries)]}


def validate_release(release: object) -> dict[str, object]:
    if not isinstance(release, dict) or not isinstance(release.get("id"), str) or not release["id"]:
        raise ValueError("release id is required")
    if not isinstance(release.get("tracks"), list) or not release["tracks"]:
        raise ValueError("at least one release track is required")
    if any(not isinstance(track, dict) or not isinstance(track.get("variantId"), str) for track in release["tracks"]):
        raise ValueError("release tracks must have variantId")
    return release


def publish(payload: str, output_dir: Path, bucket: str, prefix: str) -> dict[str, object]:
    release = validate_release(json.loads(payload))
    output_dir.mkdir(parents=True, exist_ok=True)
    local_path = output_dir / RELEASES_NAME
    local = json.loads(local_path.read_text(encoding="utf-8")) if local_path.exists() else {"releases": []}
    if not isinstance(local, dict):
        local = {"releases": []}
    local = with_release(local, release)
    s3 = client()
    key = f"{prefix.strip('/')}/{RELEASES_NAME}" if prefix.strip("/") else RELEASES_NAME
    published = published_manifest(s3, bucket, key)
    document = merged_releases(local, published)
    local_path.write_text(json.dumps(document, indent=2), encoding="utf-8")
    s3.upload_file(str(local_path), bucket, key, ExtraArgs={"ContentType": "application/json"})
    return document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("payload")
    parser.add_argument("--output-dir", type=Path, default=Path("out"))
    parser.add_argument("--bucket", default=os.environ.get("R2_BUCKET", "noise-labs"))
    parser.add_argument("--prefix", default=os.environ.get("R2_PREFIX", ""))
    args = parser.parse_args(argv)
    publish(args.payload, args.output_dir, args.bucket, args.prefix)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
