"""Publish rendered masters, sidecars, and QA evidence to an S3-compatible bucket.

The Noise Lab console reads a single manifest instead of listing the bucket, so
the browse path costs one request no matter how large the matrix grows.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

MANIFEST_NAME = "manifest.json"
RELEASES_NAME = "releases.json"
EVIDENCE_NAMES = ("qa_results.json", "render_log.jsonl")


def render_statuses(output_dir: Path) -> dict[str, str]:
    """Map variant id to its most recent exit state from the render log."""
    log = output_dir / "render_log.jsonl"
    statuses: dict[str, str] = {}
    if not log.exists():
        return statuses
    for line in log.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, dict):
            continue
        variant_id = record.get("variant_id")
        exit_state = record.get("exit_state")
        if variant_id and exit_state:
            statuses[variant_id] = exit_state
    return statuses


def qa_checks(output_dir: Path) -> dict[str, list[dict[str, object]]]:
    """Per-file QA evidence, if the harness left a readable report behind.

    The evidence decorates the manifest; a report that is missing, truncated or
    the wrong shape leaves the manifest undecorated rather than stopping the
    upload that carries the renders themselves.
    """
    path = output_dir / "qa_results.json"
    if not path.exists():
        return {}
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    files = report.get("files", []) if isinstance(report, dict) else []
    if not isinstance(files, list):
        return {}
    return {
        entry["filename"]: entry.get("checks", [])
        for entry in files
        if isinstance(entry, dict) and isinstance(entry.get("filename"), str)
    }


def master_count(manifest: dict[str, object]) -> int:
    """Count released tracks, which are masters; the stems ride along with them."""
    artifacts: list[dict[str, object]] = manifest["artifacts"]  # type: ignore[assignment]
    return sum(
        1 for artifact in artifacts if (artifact["sidecar"] or {}).get("role") == "master"  # type: ignore[union-attr]
    )


def build_manifest(output_dir: Path) -> dict[str, object]:
    statuses = render_statuses(output_dir)
    checks = qa_checks(output_dir)
    artifacts = []
    for wav in sorted(output_dir.glob("*.wav")):
        sidecar_path = wav.with_suffix(".json")
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8")) if sidecar_path.exists() else None
        variant_id = (sidecar or {}).get("variant_id", "")
        artifacts.append(
            {
                "filename": wav.name,
                "sizeBytes": wav.stat().st_size,
                "sidecar": sidecar,
                "qaChecks": checks.get(wav.name, []),
                "renderStatus": statuses.get(variant_id, "Not rendered"),
            }
        )
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "artifacts": artifacts,
    }


def uploads(output_dir: Path, manifest: dict[str, object]) -> list[tuple[Path, str]]:
    files: list[tuple[Path, str]] = []
    for artifact in manifest["artifacts"]:  # type: ignore[index]
        name = artifact["filename"]  # type: ignore[index]
        files.append((output_dir / name, "audio/wav"))
        sidecar = output_dir / Path(name).with_suffix(".json").name
        if sidecar.exists():
            files.append((sidecar, "application/json"))
    for name in EVIDENCE_NAMES:
        path = output_dir / name
        if path.exists():
            files.append((path, "application/x-ndjson" if path.suffix == ".jsonl" else "application/json"))
    releases = output_dir / RELEASES_NAME
    if releases.exists():
        files.append((releases, "application/json"))
    return files


def _keyed(document: dict[str, object], section: str, key: str) -> dict[str, object]:
    """Index one document section by a key, skipping entries that lack it.

    The published copy is written by earlier runs and can be older, partial, or
    hand-edited; an entry that cannot be identified is dropped rather than
    aborting the publish that would have replaced it.
    """
    entries = document.get(section, [])
    if not isinstance(entries, list):
        return {}
    return {
        entry[key]: entry
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get(key), str)
    }


def merged_releases(local: dict[str, object], published: dict[str, object]) -> dict[str, object]:
    """Keep releases that were published by earlier render runs."""
    entries = _keyed(published, "releases", "id")
    entries.update(_keyed(local, "releases", "id"))
    return {**local, "releases": [entries[name] for name in sorted(entries)]}


def merged(local: dict[str, object], published: dict[str, object]) -> dict[str, object]:
    """Keep already-published masters that this run did not re-render."""
    entries = _keyed(published, "artifacts", "filename")
    entries.update(_keyed(local, "artifacts", "filename"))
    return {**local, "artifacts": [entries[name] for name in sorted(entries)]}


def published_manifest(s3, bucket: str, key: str) -> dict[str, object]:
    """Read the manifest already in the bucket, treating a first publish as empty.

    A missing object is the first publish; a truncated or non-object body is a
    bucket that cannot be merged into, and is treated the same way so this run
    republishes a complete document instead of failing.
    """
    try:
        document = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    except (s3.exceptions.ClientError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return document if isinstance(document, dict) else {}


def client():
    import boto3  # imported lazily so building a manifest needs no AWS SDK

    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("R2_ENDPOINT") or f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path, help="Directory holding rendered WAVs and sidecars")
    parser.add_argument("--bucket", default=os.environ.get("R2_BUCKET", "noise-labs"))
    parser.add_argument("--prefix", default=os.environ.get("R2_PREFIX", ""), help="Optional key prefix inside the bucket")
    parser.add_argument("--dry-run", action="store_true", help="Write the manifest locally without uploading")
    args = parser.parse_args(argv)

    output_dir: Path = args.output_dir
    if not output_dir.is_dir():
        print(f"No such output directory: {output_dir}", file=sys.stderr)
        return 2

    manifest = build_manifest(output_dir)
    releases_path = output_dir / RELEASES_NAME
    releases = json.loads(releases_path.read_text(encoding="utf-8")) if releases_path.exists() else None
    manifest_path = output_dir / MANIFEST_NAME
    local_files = len(manifest["artifacts"])  # type: ignore[arg-type]
    local_count = master_count(manifest)
    if args.dry_run:
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"Manifest describes {local_count} master(s) in {local_files} file(s) -> {manifest_path}")
        return 0
    if not local_files and releases is None:
        print("Nothing rendered to publish", file=sys.stderr)
        return 1

    bucket = args.bucket
    prefix = args.prefix.strip("/")

    def key_for(name: str) -> str:
        return f"{prefix}/{name}" if prefix else name

    s3 = client()
    payload = merged(manifest, published_manifest(s3, bucket, key_for(MANIFEST_NAME)))
    manifest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if releases is not None:
        published_releases = published_manifest(s3, bucket, key_for(RELEASES_NAME))
        releases = merged_releases(releases, published_releases)
        releases_path.write_text(json.dumps(releases, indent=2), encoding="utf-8")
    print(
        f"Publishing {local_count} master(s) and stems in {local_files} file(s); "
        f"manifest now lists {len(payload['artifacts'])}"  # type: ignore[arg-type]
    )
    for path, content_type in [*uploads(output_dir, manifest), (manifest_path, "application/json")]:
        s3.upload_file(str(path), bucket, key_for(path.name), ExtraArgs={"ContentType": content_type})
        print(f"uploaded {key_for(path.name)} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
