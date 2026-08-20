"""Rename one published master and its sidecar in object storage."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from publish_artifacts import client, published_manifest

FILENAME_PATTERN = re.compile(r"^[\w.-]+\.wav$", re.IGNORECASE)
MANIFEST_NAME = "manifest.json"


def validate_payload(payload: object) -> tuple[str, str]:
    if not isinstance(payload, dict):
        raise TypeError("Filename and title are required")
    filename = payload.get("filename")
    title = payload.get("title")
    if not isinstance(filename, str) or not isinstance(title, str) or not title.strip():
        raise ValueError("Filename and title are required")
    if not FILENAME_PATTERN.fullmatch(filename):
        raise ValueError("Invalid audio filename")
    return filename, title.strip()


def rename_manifest(manifest: dict[str, object], filename: str, title: str) -> dict[str, object]:
    filename, title = validate_payload({"filename": filename, "title": title})
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        raise TypeError("Published manifest has no artifacts")
    for index, artifact in enumerate(artifacts):
        if not isinstance(artifact, dict) or artifact.get("filename") != filename:
            continue
        sidecar = artifact.get("sidecar")
        if not isinstance(sidecar, dict) or sidecar.get("role") != "master":
            raise ValueError("Only a master can be named")
        updated_artifact = {**artifact, "sidecar": {**sidecar, "seo_title": title}}
        updated_artifacts = [*artifacts]
        updated_artifacts[index] = updated_artifact
        return {**manifest, "artifacts": updated_artifacts}
    raise ValueError("Audio filename was not found in the published manifest")


def key_for(name: str, prefix: str) -> str:
    prefix = prefix.strip("/")
    return f"{prefix}/{name}" if prefix else name


def missing_object(error: Exception) -> bool:
    response = getattr(error, "response", {})
    error_info = response.get("Error", {}) if isinstance(response, dict) else {}
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode") if isinstance(response, dict) else None
    code = error_info.get("Code") if isinstance(error_info, dict) else None
    return status == 404 or code in {"404", "NoSuchKey", "NotFound"}


def update_sidecar(s3, bucket: str, key: str, title: str) -> bool:
    try:
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    except s3.exceptions.ClientError as error:
        if missing_object(error):
            return False
        raise
    sidecar = json.loads(body)
    if not isinstance(sidecar, dict):
        raise TypeError("Published sidecar is not an object")
    sidecar["seo_title"] = title
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=f"{json.dumps(sidecar, indent=2)}\n".encode(),
        ContentType="application/json",
    )
    return True


def publish(payload: str, bucket: str, prefix: str) -> None:
    filename, title = validate_payload(json.loads(payload))
    manifest_key = key_for(MANIFEST_NAME, prefix)
    s3 = client()
    manifest = published_manifest(s3, bucket, manifest_key)
    updated = rename_manifest(manifest, filename, title)
    sidecar_key = key_for(Path(filename).with_suffix(".json").name, prefix)
    sidecar_updated = update_sidecar(s3, bucket, sidecar_key, title)
    s3.put_object(
        Bucket=bucket,
        Key=manifest_key,
        Body=f"{json.dumps(updated, indent=2)}\n".encode(),
        ContentType="application/json",
    )
    print(f"Updated manifest title for {filename} to {title!r}")
    if sidecar_updated:
        print(f"Updated sidecar {sidecar_key}")
    else:
        print(f"Sidecar {sidecar_key} was not present; manifest only")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("payload")
    parser.add_argument("--bucket", default=os.environ.get("R2_BUCKET", "noise-labs"))
    parser.add_argument("--prefix", default=os.environ.get("R2_PREFIX", ""))
    args = parser.parse_args(argv)
    publish(args.payload, args.bucket, args.prefix)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
