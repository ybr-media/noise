"""Audacity-free tests for orchestration, sidecars, and resume behavior."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "qa"))
sys.path.insert(0, str(ROOT))

from checks import Sidecar

import orchestrator
from orchestrator import render_batch
from render_plan import build_plan


class FakeTransport:
    def __init__(self, responses: list[str], fail_at: int | None = None) -> None:
        self.responses = responses
        self.fail_at = fail_at
        self.commands: list[str] = []
        self.closed = False

    def send(self, command: str, timeout: float) -> str:
        del timeout
        index = len(self.commands)
        self.commands.append(command)
        if self.fail_at == index:
            raise RuntimeError("synthetic command failure")
        return self.responses[index] if index < len(self.responses) else "OK"

    def close(self) -> None:
        self.closed = True


class FakeProcess:
    def __init__(self) -> None:
        self.killed = False
        self.waited = False

    def kill(self) -> None:
        self.killed = True

    def wait(self) -> None:
        self.waited = True


def _matrix(tmp_path: Path, count: int = 2) -> Path:
    source = yaml.safe_load((ROOT / "config" / "variants_pilot.yaml").read_text())
    source["variants"] = source["variants"][:count]
    path = tmp_path / "variants.yaml"
    path.write_text(yaml.safe_dump(source), encoding="utf-8")
    return path


def test_launch_ignores_an_inherited_xdg_config_home(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """XDG_CONFIG_HOME outranks HOME, so a host that sets one must not be obeyed."""
    monkeypatch.setenv("XDG_CONFIG_HOME", "/somewhere/else")
    captured: dict[str, str] = {}

    class Recorder:
        pid = 1
        returncode = 0

        def __init__(self, command, env, **kwargs):  # type: ignore[no-untyped-def]
            del command, kwargs
            captured.update(env)

        def poll(self) -> None:
            return None

    monkeypatch.setattr(orchestrator.subprocess, "Popen", Recorder)
    monkeypatch.setattr(orchestrator, "_wait_for_pipes", lambda **kwargs: None)

    handle = orchestrator._launch("audacity")
    home = Path(captured["HOME"])
    assert captured["XDG_CONFIG_HOME"] == str(home / ".config")
    assert (home / ".config/audacity/audacity.cfg").exists()
    monkeypatch.setattr(orchestrator.os, "killpg", lambda pid, signal: None)
    handle.kill()


def test_sidecar_and_log_contract(tmp_path: Path) -> None:
    transports: list[FakeTransport] = []
    processes: list[FakeProcess] = []

    def transport_factory(timeout: float) -> FakeTransport:
        del timeout
        transport = FakeTransport(["OK"] * 100)
        transports.append(transport)
        return transport

    def process_factory(binary: str) -> FakeProcess:
        del binary
        process = FakeProcess()
        processes.append(process)
        return process

    output = tmp_path / "out"
    source = yaml.safe_load((_matrix(tmp_path, 1)).read_text())
    row = source["variants"][0]
    assert render_batch(
        tmp_path / "variants.yaml",
        output,
        "audacity",
        3,
        transport_factory=transport_factory,
        process_factory=process_factory,
    ) == 0
    sidecar = next(output.glob("*.json"))
    parsed = Sidecar.from_json(sidecar)
    assert parsed.variant_id
    sidecar_raw = json.loads(sidecar.read_text())
    assert sidecar_raw["audacity_version"] == "3.7.8"
    log = json.loads((output / "render_log.jsonl").read_text(encoding="utf-8").splitlines()[0])
    plan = build_plan(row, source["output"], str(output / row["filename"]))
    assert log["variant_id"] == row["variant_id"]
    assert log["seeds"] == [
        row["seeds"][f"{stem}_{channel}"]
        for stem in ("bed", "texture", "motion")
        for channel in ("l", "r")
    ]
    assert all(isinstance(seed, int) for seed in log["seeds"])
    assert log["params"] == {"variant": row, "output": source["output"]}
    assert isinstance(log["wall_clock_seconds"], (int, float))
    assert log["commands"] == list(plan.commands)
    assert log["responses"] == ["OK"] * len(plan.commands)
    assert log["exit_state"] == "success"
    assert transports[0].closed and processes[0].killed and processes[0].waited


def test_launch_failure_is_logged(tmp_path: Path) -> None:
    """A process that never starts must be reported as the render failure it is."""
    matrix = _matrix(tmp_path, 1)
    output = tmp_path / "out"

    def factory(timeout: float) -> FakeTransport:
        del timeout
        raise AssertionError("transport must not be created when launching fails")

    def process_factory(binary: str) -> FakeProcess:
        del binary
        raise RuntimeError("audacity did not open its pipes")

    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 1
    record = json.loads((output / "render_log.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert record["exit_state"] == "failure: audacity did not open its pipes"
    row = yaml.safe_load(matrix.read_text())["variants"][0]
    source = yaml.safe_load(matrix.read_text())
    plan = build_plan(row, source["output"], str(output / row["filename"]))
    assert record["commands"] == list(plan.commands)
    assert record["responses"] == []


def test_aup3_serializer_logs_the_commands_it_sent(tmp_path: Path) -> None:
    matrix = _matrix(tmp_path, 1)
    output = tmp_path / "out"
    created: list[FakeTransport] = []

    def factory(timeout: float) -> FakeTransport:
        del timeout
        transport = FakeTransport(["OK"] * 100, fail_at=0)
        created.append(transport)
        return transport

    def process_factory(binary: str) -> FakeProcess:
        del binary
        return FakeProcess()

    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        aup3_serializer=True,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 1
    record = json.loads((output / "render_log.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert record["commands"][-1].startswith("SaveProject2:")
    assert not any(command.startswith("Export2:") for command in record["commands"])


def test_resume_and_force(tmp_path: Path) -> None:
    matrix = _matrix(tmp_path, 2)
    output = tmp_path / "out"
    calls = 0

    def factory(timeout: float) -> FakeTransport:
        nonlocal calls
        del timeout
        calls += 1
        return FakeTransport(["OK"] * 100)

    def process_factory(binary: str) -> FakeProcess:
        del binary
        return FakeProcess()

    assert render_batch(matrix, output, "audacity", 3, transport_factory=factory, process_factory=process_factory) == 0
    assert calls == 2
    assert render_batch(matrix, output, "audacity", 3, transport_factory=factory, process_factory=process_factory) == 0
    assert calls == 2
    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        force=True,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 0
    assert calls == 4


def test_failure_continues_without_retry(tmp_path: Path) -> None:
    matrix = _matrix(tmp_path, 2)
    output = tmp_path / "out"
    created: list[FakeTransport] = []

    def factory(timeout: float) -> FakeTransport:
        del timeout
        transport = FakeTransport(["OK"] * 100, fail_at=2 if not created else None)
        created.append(transport)
        return transport

    def process_factory(binary: str) -> FakeProcess:
        del binary
        return FakeProcess()

    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 1
    assert len(created) == 2
    failed_variant = yaml.safe_load(matrix.read_text())["variants"][0]
    failed_sidecar = output / str(failed_variant["filename"]).replace(".wav", ".json")
    assert not failed_sidecar.exists()
    records = [json.loads(line) for line in (output / "render_log.jsonl").read_text().splitlines()]
    assert records[0]["exit_state"].startswith("failure:")
    assert records[1]["exit_state"] == "success"
    assert len(created[0].commands) == 3

    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 0
    assert len(created) == 3
    assert failed_sidecar.exists()
