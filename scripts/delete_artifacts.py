"""Delete published artifacts for the given variants from the bucket.

Dismissing a failed render in the Noise Lab console archives the queue entry
and dispatches this cleanup, which removes the variants' published masters,
stems, and sidecars and prunes them from the manifest the console reads.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from publish_artifacts import MANIFEST_NAME, client, published_manifest


def keys_for(artifact: dict[str, object]) -> list[str]:
    """An artifact's object keys: the WAV plus its sidecar, when one exists."""
    filename = str(artifact["filename"])
    keys = [filename]
    if artifact.get("sidecar") is not None:
        keys.append(str(Path(filename).with_suffix(".json")))
    return keys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("variants", help="Comma-separated variant ids to delete")
    parser.add_argument("--bucket", default=os.environ.get("R2_BUCKET", "noise-labs"))
    parser.add_argument("--prefix", default=os.environ.get("R2_PREFIX", ""), help="Optional key prefix inside the bucket")
    args = parser.parse_args(argv)

    variant_ids = {part.strip() for part in args.variants.split(",") if part.strip()}
    if not variant_ids:
        print("No variants named for deletion", file=sys.stderr)
        return 2

    prefix = args.prefix.strip("/")

    def key_for(name: str) -> str:
        return f"{prefix}/{name}" if prefix else name

    s3 = client()
    manifest = published_manifest(s3, args.bucket, key_for(MANIFEST_NAME))
    artifacts: list[dict[str, object]] = manifest.get("artifacts", [])  # type: ignore[assignment]
    doomed = [
        artifact
        for artifact in artifacts
        if (artifact.get("sidecar") or {}).get("variant_id") in variant_ids  # type: ignore[union-attr]
    ]
    if not doomed:
        print("No published artifacts match the named variants; nothing to delete")
        return 0

    doomed_names = {str(artifact["filename"]) for artifact in doomed}
    remaining = [artifact for artifact in artifacts if str(artifact["filename"]) not in doomed_names]
    manifest["artifacts"] = remaining
    for artifact in doomed:
        for name in keys_for(artifact):
            s3.delete_object(Bucket=args.bucket, Key=key_for(name))
            print(f"deleted {key_for(name)}")
    body = json.dumps(manifest, indent=2).encode("utf-8")
    s3.put_object(Bucket=args.bucket, Key=key_for(MANIFEST_NAME), Body=body, ContentType="application/json")
    print(f"manifest now lists {len(remaining)} artifact(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
