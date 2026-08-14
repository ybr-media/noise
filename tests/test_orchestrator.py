"""Audacity-free tests for orchestration, sidecars, and resume behavior."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import yaml

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "qa"))
sys.path.insert(0, str(ROOT))

from checks import Sidecar

import orchestrator
from orchestrator import render_batch
from render_plan import MASTER_TRACK_INDEX, build_plan

EXPORT_FILENAME = re.compile(r'Export2: Filename="([^"]+)"')
PROJECT_FILENAME = re.compile(r'SaveProject2: Filename="([^"]+)"')
MEASURED_LUFS = -14.0


def _fake_export(path: Path) -> None:
    """Stand in for Audacity's export with audio of a known, non-silent level."""
    generator = np.random.default_rng(0)
    samples = generator.normal(0.0, 0.05, size=(48000, 2))
    sf.write(path, samples, 48000, subtype="PCM_24")


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
        exported = EXPORT_FILENAME.match(command)
        if exported:
            _fake_export(Path(exported.group(1)))
        saved = PROJECT_FILENAME.match(command)
        if saved:
            for suffix in ("", "-wal", "-shm"):
                Path(f"{saved.group(1)}{suffix}").write_bytes(b"aup3")
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


def test_launch_ignores_an_inherited_xdg_config_home(monkeypatch, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    """XDG_CONFIG_HOME outranks HOME, so a host that sets one must not be obeyed."""
    (tmp_path / "audacity.cfg").write_text("PrefsVersion=1.1.1r1\n", encoding="utf-8")
    monkeypatch.setenv("AUDACITY_CONFIG_DIR", str(tmp_path))
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
    plan = build_plan(row, source["output"], str(output / row["filename"]))
    master_sidecar = Path(plan.master_path).with_suffix(".json")
    parsed = Sidecar.from_json(master_sidecar)
    assert parsed.variant_id
    assert parsed.is_master
    assert parsed.sample_rate == 96000
    assert parsed.expected_frames is not None
    sidecar_raw = json.loads(master_sidecar.read_text())
    assert sidecar_raw["audacity_version"] == "3.7.8"
    assert sidecar_raw["stem_filenames"] == [
        Path(path).name for path in plan.stem_paths
    ]
    assert sidecar_raw["stem_map"] == {
        "stem_1": "bed",
        "stem_2": "texture",
        "stem_3": "motion",
    }
    # One measured gain, recorded identically in all four sidecars.
    gain = sidecar_raw["loudness_gain_db"]
    for number, stem_path in enumerate(plan.stem_paths, start=1):
        stem_sidecar = json.loads(Path(stem_path).with_suffix(".json").read_text())
        assert stem_sidecar["role"] == f"stem_{number}"
        assert stem_sidecar["stem"] == ("bed", "texture", "motion")[number - 1]
        assert stem_sidecar["loudness_gain_db"] == gain
        assert stem_sidecar["sample_rate"] == 48000
        assert stem_sidecar["expected_frames"] * 2 == sidecar_raw["expected_frames"]
        assert not Sidecar.from_json(Path(stem_path).with_suffix(".json")).is_master
    assert len(list(output.glob("*.json"))) == 4

    log = json.loads((output / "render_log.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert log["variant_id"] == row["variant_id"]
    assert log["seeds"] == [
        row["seeds"][f"{stem}_{channel}"]
        for stem in ("bed", "texture", "motion")
        for channel in ("l", "r")
    ]
    assert all(isinstance(seed, int) for seed in log["seeds"])
    assert log["params"] == {"variant": row, "output": source["output"]}
    assert isinstance(log["wall_clock_seconds"], (int, float))
    commands = log["commands"]
    assert commands[: len(plan.commands)] == list(plan.commands)
    # The measurement export, the one shared gain, then the four outputs.
    exported = [EXPORT_FILENAME.match(command).group(1) for command in commands if command.startswith("Export2:")]
    assert exported[0].endswith(".measure.wav")
    assert exported[1] == plan.master_path
    assert all(path.endswith(".source.wav") for path in exported[2:])
    assert all(Path(path).parent != output for path in exported[2:])
    assert not Path(exported[0]).exists()
    gains = [command for command in commands if command.startswith("Amplify:")]
    assert gains[len(plan.stem_paths):] == list(plan.gain_commands(gain)[1:])
    assert len(log["responses"]) == len(commands)
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
    # Nothing reached Audacity, so the log records an empty exchange.
    assert record["commands"] == []
    assert record["responses"] == []


def test_aup3_serializer_measures_the_mix_and_writes_four_files(
    tmp_path: Path, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    matrix = _matrix(tmp_path, 1)
    output = tmp_path / "out"
    created: list[FakeTransport] = []

    def factory(timeout: float) -> FakeTransport:
        del timeout
        transport = FakeTransport(["OK"] * 100)
        created.append(transport)
        return transport

    def process_factory(binary: str) -> FakeProcess:
        del binary
        return FakeProcess()

    read: list[int] = []

    def fake_read(project: Path, project_xml: Path | None, index: int):  # type: ignore[no-untyped-def]
        del project, project_xml
        read.append(index)
        generator = np.random.default_rng(1)
        return generator.normal(0.0, 0.05, size=(48000, 2)), 48000

    written: list[tuple[Path, ...]] = []

    def fake_extract(
        project: Path,
        project_xml: Path | None,
        paths: tuple[Path, ...],
        *,
        stem_rate: int,
    ) -> None:
        del project, project_xml, stem_rate
        written.append(paths)
        for path in paths:
            _fake_export(path)

    monkeypatch.setattr(orchestrator, "read_stereo_track", fake_read)
    monkeypatch.setattr(orchestrator, "extract_stereo_tracks_to_wavs", fake_extract)

    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        aup3_serializer=True,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 0
    record = json.loads((output / "render_log.jsonl").read_text(encoding="utf-8").splitlines()[0])
    row = yaml.safe_load(matrix.read_text())["variants"][0]
    source = yaml.safe_load(matrix.read_text())
    plan = build_plan(row, source["output"], str(output / row["filename"]))
    # The master is measured from the saved project, amplified with the stems,
    # and only then re-saved for extraction.
    assert read == [MASTER_TRACK_INDEX]
    assert written == [tuple(Path(path) for path in plan.track_paths)]
    tail = record["commands"][len(plan.commands):]
    assert tail[0].startswith("SaveProject2:")
    assert tail[-1] == "Save:"
    assert any(command.startswith("Amplify:") for command in tail)
    assert not any(command.startswith("Export2:") for command in record["commands"])
    assert len(list(output.glob("*.wav"))) == 4
    # The project is another copy of all four outputs; it does not survive a
    # successful extraction.
    assert not list(output.glob("*.aup3*"))


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


def test_failure_continues_to_the_next_variant(tmp_path: Path) -> None:
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
        retries=0,
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
        retries=0,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 0
    assert len(created) == 3
    assert failed_sidecar.exists()


def test_flaky_variant_is_retried_in_a_fresh_process(tmp_path: Path) -> None:
    """A one-off Audacity failure heals on retry; the retry gets its own process."""
    matrix = _matrix(tmp_path, 1)
    output = tmp_path / "out"
    created: list[FakeTransport] = []
    processes: list[FakeProcess] = []

    def factory(timeout: float) -> FakeTransport:
        del timeout
        transport = FakeTransport(["OK"] * 100, fail_at=0 if not created else None)
        created.append(transport)
        return transport

    def process_factory(binary: str) -> FakeProcess:
        del binary
        process = FakeProcess()
        processes.append(process)
        return process

    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 0
    assert len(created) == 2 and len(processes) == 2
    assert all(process.killed and process.waited for process in processes)
    records = [json.loads(line) for line in (output / "render_log.jsonl").read_text().splitlines()]
    assert [record["exit_state"].split(":")[0] for record in records] == ["failure", "success"]
    assert records[0]["variant_id"] == records[1]["variant_id"]


def test_persistent_failure_exhausts_retries(tmp_path: Path) -> None:
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
        retries=2,
        transport_factory=factory,
        process_factory=process_factory,
    ) == 1
    assert len(created) == 3
    records = [json.loads(line) for line in (output / "render_log.jsonl").read_text().splitlines()]
    assert len(records) == 3
    assert all(record["exit_state"].startswith("failure:") for record in records)


def test_an_unusable_row_fails_only_itself(tmp_path: Path) -> None:
    """A bad row is that variant's failure; the rest of the matrix still renders."""
    source = yaml.safe_load((ROOT / "config" / "variants_pilot.yaml").read_text())
    good, broken = source["variants"][0], dict(source["variants"][1])
    broken["seeds"] = {}
    source["variants"] = [broken, good]
    matrix = tmp_path / "variants.yaml"
    matrix.write_text(yaml.safe_dump(source), encoding="utf-8")
    output = tmp_path / "out"

    def factory(timeout: float) -> FakeTransport:
        del timeout
        return FakeTransport(["OK"] * 100)

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
    records = [json.loads(line) for line in (output / "render_log.jsonl").read_text().splitlines()]
    assert [record["variant_id"] for record in records] == [broken["variant_id"], good["variant_id"]]
    assert records[0]["exit_state"].startswith("failure:")
    assert "seed" in records[0]["exit_state"]
    assert records[0]["commands"] == []
    assert records[1]["exit_state"] == "success"
    assert (output / str(good["filename"])).exists()


def test_a_row_without_a_filename_fails_only_itself(tmp_path: Path) -> None:
    source = yaml.safe_load((ROOT / "config" / "variants_pilot.yaml").read_text())
    broken = dict(source["variants"][0])
    broken.pop("filename")
    source["variants"] = [broken]
    matrix = tmp_path / "variants.yaml"
    matrix.write_text(yaml.safe_dump(source), encoding="utf-8")
    output = tmp_path / "out"

    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        transport_factory=lambda timeout: FakeTransport(["OK"] * 100),
        process_factory=lambda binary: FakeProcess(),
    ) == 1
    record = json.loads((output / "render_log.jsonl").read_text().splitlines()[0])
    assert "filename" in record["exit_state"]


def test_a_failed_row_is_retried_by_a_later_run(tmp_path: Path) -> None:
    """The resume path treats a row that never planned as unrendered."""
    source = yaml.safe_load((ROOT / "config" / "variants_pilot.yaml").read_text())
    row = dict(source["variants"][0])
    broken = {**row, "seeds": {}}
    matrix = tmp_path / "variants.yaml"
    output = tmp_path / "out"
    matrix.write_text(yaml.safe_dump({**source, "variants": [broken]}), encoding="utf-8")
    assert render_batch(matrix, output, "audacity", 3) == 1

    matrix.write_text(yaml.safe_dump({**source, "variants": [row]}), encoding="utf-8")
    assert render_batch(
        matrix,
        output,
        "audacity",
        3,
        transport_factory=lambda timeout: FakeTransport(["OK"] * 100),
        process_factory=lambda binary: FakeProcess(),
    ) == 0
    assert (output / str(row["filename"])).exists()
