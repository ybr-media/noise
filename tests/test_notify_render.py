from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("notify_render", Path(__file__).parents[1] / "scripts" / "notify_render.py")
assert SPEC and SPEC.loader
notify_render = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notify_render)


def test_payload_and_signature(tmp_path: Path) -> None:
    (tmp_path / "render_log.jsonl").write_text(json.dumps({"variant_id": "one", "exit_state": "ok"}), encoding="utf-8")
    (tmp_path / "manifest.json").write_text(json.dumps({"artifacts": [{"filename": "one_master.wav", "sidecar": {"variant_id": "one"}}]}), encoding="utf-8")
    payload = notify_render.build_payload(tmp_path, "austin@example.com", "run-1", "2026-08-21T00:00:00Z")
    assert payload == {
        "kind": "render-complete",
        "requestedBy": "austin@example.com",
        "renderKeys": ["one"],
        "runId": "run-1",
        "finishedAt": "2026-08-21T00:00:00Z",
    }
    body = notify_render.request_bytes(payload)
    assert notify_render.signature(body, "secret").startswith("sha256=")
    assert notify_render.signature(body, "secret") != notify_render.signature(body + b" ", "secret")


def test_main_exits_zero_when_endpoint_unreachable(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "render_log.jsonl").write_text(json.dumps({"variant_id": "one", "exit_state": "ok"}), encoding="utf-8")
    (tmp_path / "manifest.json").write_text(json.dumps({"artifacts": [{"filename": "one_master.wav", "sidecar": {"variant_id": "one"}}]}), encoding="utf-8")
    monkeypatch.setenv("APP_URL", "https://noise.example")
    monkeypatch.setenv("NOTIFY_SECRET", "secret")
    monkeypatch.setenv("REQUESTED_BY", "austin@example.com")
    monkeypatch.setenv("RUN_ID", "run-1")
    monkeypatch.setattr(notify_render, "notify", lambda *_args: False)
    assert notify_render.main([str(tmp_path)]) == 0


def test_notify_does_not_retry_client_errors(monkeypatch) -> None:
    attempts = 0

    def urlopen(_request, timeout):
        nonlocal attempts
        attempts += 1
        raise notify_render.urllib.error.HTTPError("https://noise.example", 401, "unauthorized", {}, None)

    monkeypatch.setattr(notify_render.urllib.request, "urlopen", urlopen)
    payload = {"kind": "render-complete", "requestedBy": "austin@example.com", "renderKeys": ["one"], "runId": "run-1", "finishedAt": "now"}
    assert notify_render.notify(payload, "https://noise.example", "secret") is False
    assert attempts == 1
