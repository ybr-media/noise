"""Notify Noise Lab that a render completed without reddening the workflow."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def render_keys(output_dir: Path) -> list[str]:
    """Return master render keys whose variants completed in this output."""
    completed: set[str] = set()
    log = output_dir / "render_log.jsonl"
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict) and record.get("variant_id") and record.get("exit_state") in {"ok", "success", "done"}:
                completed.add(str(record["variant_id"]))
    manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    keys = []
    for artifact in manifest.get("artifacts", []):
        if not isinstance(artifact, dict):
            continue
        sidecar = artifact.get("sidecar") or {}
        filename = artifact.get("filename")
        variant_id = sidecar.get("variant_id") if isinstance(sidecar, dict) else None
        if isinstance(filename, str) and filename.endswith("_master.wav") and isinstance(variant_id, str) and variant_id in completed:
            keys.append(filename[: -len("_master.wav")])
    return keys


def build_payload(output_dir: Path, requested_by: str, run_id: str, finished_at: str | None = None) -> dict[str, object]:
    return {
        "kind": "render-complete",
        "requestedBy": requested_by,
        "renderKeys": render_keys(output_dir),
        "runId": run_id,
        "finishedAt": finished_at or datetime.now(timezone.utc).isoformat(),
    }


def request_bytes(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def signature(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def notify(payload: dict[str, object], app_url: str, secret: str) -> bool:
    body = request_bytes(payload)
    request = urllib.request.Request(
        app_url.rstrip("/") + "/api/renders/notify",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "X-Noise-Signature": signature(body, secret)},
    )
    for attempt, delay in enumerate((2, 4, 8)):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if 200 <= response.status < 300:
                    return True
                if response.status < 500:
                    return False
        except urllib.error.HTTPError as error:
            if error.code < 500:
                return False
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        if attempt < 2:
            time.sleep(delay)
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args(argv)
    try:
        app_url = os.environ.get("APP_URL", "").strip()
        secret = os.environ.get("NOTIFY_SECRET", "")
        requested_by = os.environ.get("REQUESTED_BY", "").strip()
        run_id = os.environ.get("RUN_ID", "").strip()
        if not app_url or not secret or not requested_by or not run_id:
            print("render notification skipped: configuration incomplete")
            return 0
        payload = build_payload(args.output_dir, requested_by, run_id)
        if not payload["renderKeys"]:
            print("render notification skipped: no completed masters")
            return 0
        if notify(payload, app_url, secret):
            print("render notification delivered")
        else:
            print("render notification failed", file=sys.stderr)
    except Exception as error:  # noqa: BLE001
        print(f"render notification failed: {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
