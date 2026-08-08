"""Process orchestration for Audacity-backed noise variant rendering."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

import yaml

from audacity_pipe import AudacityPipe, AudacityPipeError
from aup3_serializer import extract_to_wav
from render_plan import RenderPlan, build_plan

AUDACITY_VERSION = "3.7.8"
DEFAULT_VARIANTS_FILE = Path("config/variants.yaml")
DEFAULT_OUTPUT_DIR = Path("out")

#: Filtering and normalising four minutes of noise takes far longer than a
#: trivial scripting command, so the per-command deadline is generous.
DEFAULT_TIMEOUT_SECONDS = 300.0
ROOT = Path(__file__).resolve().parent


class Transport(Protocol):
    """The small interface required from an Audacity scripting transport."""

    def send(self, command: str, timeout: float) -> str:
        ...

    def close(self) -> None:
        ...


class ProcessHandle(Protocol):
    """The lifecycle interface required from a launched Audacity process."""

    def kill(self) -> None:
        ...

    def wait(self) -> None:
        ...


TransportFactory = Callable[[float], Transport]
ProcessFactory = Callable[[str], ProcessHandle]


class PipeTransport:
    """Adapt the Phase 1 context-managed client to the render transport."""

    def __init__(self, timeout: float) -> None:
        self._pipe = AudacityPipe(timeout=timeout)
        self._pipe.__enter__()

    def send(self, command: str, timeout: float) -> str:
        return self._pipe.command(command, timeout=timeout)

    def close(self) -> None:
        self._pipe.__exit__(None, None, None)


def default_transport(timeout: float) -> Transport:
    return PipeTransport(timeout)


def _pipe_timeout() -> float:
    """Launch budget; a cold, shared CI runner needs far longer than a dev box."""
    return float(os.environ.get("NOISEGEN_PIPE_TIMEOUT", "20"))


def _wait_for_pipes(
    timeout: float | None = None,
    process: subprocess.Popen[bytes] | None = None,
) -> None:
    uid = os.getuid()
    paths = [
        Path(f"/tmp/audacity_script_pipe.{direction}.{uid}")
        for direction in ("to", "from")
    ]
    deadline = time.monotonic() + (_pipe_timeout() if timeout is None else timeout)
    while time.monotonic() < deadline:
        if all(path.exists() for path in paths):
            return
        # A dead process will never open them, and its status says far more
        # than a timeout does.
        if process is not None and process.poll() is not None:
            raise AudacityPipeError(
                f"Audacity exited with status {process.returncode} "
                "before opening its script pipes"
            )
        time.sleep(0.05)
    raise AudacityPipeError(
        f"Timed out waiting for Audacity pipes: {', '.join(map(str, paths))}"
    )


class _AudacityProcess:
    def __init__(self, process: subprocess.Popen[bytes], home: Path) -> None:
        self._process = process
        self._home = home

    def kill(self) -> None:
        if self._process.poll() is None:
            os.killpg(self._process.pid, signal.SIGTERM)

    def wait(self) -> None:
        try:
            self._process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(self._process.pid, signal.SIGKILL)
            self._process.wait()
        finally:
            shutil.rmtree(self._home, ignore_errors=True)


def _default_binary() -> str:
    return os.environ.get("AUDACITY_BIN", str(ROOT / ".audacity/squashfs-root/AppRun"))


def _config_source() -> Path:
    """The audacity.cfg setup.sh generated, whose directory it records in audacity.env."""
    directory = os.environ.get("AUDACITY_CONFIG_DIR", str(ROOT / ".audacity-config"))
    return Path(directory) / "audacity.cfg"


def _launch(binary: str) -> ProcessHandle:
    uid = os.getuid()
    for path in (
        Path(f"/tmp/audacity_script_pipe.to.{uid}"),
        Path(f"/tmp/audacity_script_pipe.from.{uid}"),
    ):
        path.unlink(missing_ok=True)
    home = Path(tempfile.mkdtemp(prefix="noisegen-home-"))
    try:
        config_dir = home / ".config" / "audacity"
        config_dir.mkdir(parents=True)
        shutil.copy2(_config_source(), config_dir / "audacity.cfg")
        log_path = os.environ.get("NOISEGEN_AUDACITY_LOG")
        env = os.environ.copy()
        # An inherited XDG_CONFIG_HOME outranks HOME, so a host that sets one
        # (GitHub's runners do) sends Audacity looking for its settings
        # somewhere we never wrote them, and it starts without mod-script-pipe.
        env.update(
            HOME=str(home),
            XDG_CONFIG_HOME=str(home / ".config"),
            XDG_DATA_HOME=str(home / ".local/share"),
            XDG_CACHE_HOME=str(home / ".cache"),
            XDG_STATE_HOME=str(home / ".local/state"),
            ALSA_CONFIG_PATH=str(ROOT / ".asoundrc"),
            LD_LIBRARY_PATH=(
                f"{ROOT / '.audacity/squashfs-root/lib'}:"
                f"{ROOT / '.audacity/squashfs-root/fallback/libportaudio.so'}:"
                + os.environ.get("LD_LIBRARY_PATH", "")
            ),
            AUDACITY_LOG_LEVEL="INFO" if log_path else "WARN",
        )
        command = [
            "xvfb-run",
            "-a",
            "--server-args=-screen 0 1280x800x24",
            binary,
        ]
        # Audacity is chatty for the whole life of a render; nothing reads
        # these streams, so piping them would eventually block the process.
        # A file sink is the exception: it never fills, and it is the only way
        # to see why a launch failed on a machine with no display to watch.
        sink = subprocess.DEVNULL
        if log_path:
            destination = Path(log_path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            sink = destination.open("ab")
        try:
            process = subprocess.Popen(
                command,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=sink,
                stderr=subprocess.STDOUT if log_path else sink,
                start_new_session=True,
            )
        finally:
            if sink is not subprocess.DEVNULL:
                sink.close()
        try:
            _wait_for_pipes(process=process)
        except (OSError, TimeoutError, AudacityPipeError):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            process.wait()
            raise
        return _AudacityProcess(process, home)
    except BaseException:
        shutil.rmtree(home, ignore_errors=True)
        raise


def _load_matrix(path: Path) -> tuple[dict[str, object], list[dict[str, object]]]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise TypeError(f"{path}: root must be an object")
    output_raw = raw.get("output")
    variants_raw = raw.get("variants")
    if not isinstance(output_raw, dict) or not isinstance(variants_raw, list):
        raise TypeError(f"{path}: expected output and variants")
    variants: list[dict[str, object]] = []
    for index, item in enumerate(variants_raw):
        if not isinstance(item, dict):
            raise TypeError(f"{path}: variants[{index}] must be an object")
        variants.append({str(key): value for key, value in item.items()})
    return ({str(key): value for key, value in output_raw.items()}, variants)


def _read_successes(path: Path) -> set[str]:
    if not path.exists():
        return set()
    successes: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            variant_id = record.get("variant_id")
            state = record.get("exit_state")
            if isinstance(variant_id, str) and state == "success":
                successes.add(variant_id)
    return successes


def _variant_id(row: Mapping[str, object]) -> str:
    value = row.get("variant_id")
    if not isinstance(value, str) or not value:
        raise ValueError("variant is missing variant_id")
    return value


def _seed_list(plan: RenderPlan) -> list[int]:
    return [
        plan.variant.seed(stem, channel)
        for stem in ("bed", "texture", "motion")
        for channel in ("l", "r")
    ]


def _sidecar(plan: RenderPlan) -> dict[str, object]:
    variant = plan.variant
    return {
        "variant_id": variant.variant_id,
        "color": variant.color,
        "band": variant.band,
        "motion": variant.motion,
        "balance": variant.balance,
        "seeds": _seed_list(plan),
        "band_low_hz": variant.band_low_hz,
        "band_high_hz": variant.band_high_hz,
        "lfo_depth": variant.lfo_depth,
        "lfo_rate_hz": variant.lfo_rate_hz,
        "per_stem_gains": {
            "bed": variant.gain_bed_db,
            "texture": variant.gain_texture_db,
            "motion": variant.gain_motion_db,
        },
        "target_lufs": plan.output.target_lufs,
        "true_peak_max_dbtp": plan.output.true_peak_max_dbtp,
        "cell_seconds": plan.output.cell_seconds,
        "repeats": plan.output.repeats,
        "fade_seconds": plan.output.fade_seconds,
        "sample_rate": plan.output.sample_rate,
        "bit_depth": plan.output.bit_depth,
        "tilt_db_per_oct": variant.spectrum.tilt_db_per_oct,
        "bell": (
            {
                "gain_db": variant.spectrum.bell_gain_db,
                "center_hz": variant.spectrum.bell_center_hz,
                "q": variant.spectrum.bell_q,
            }
            if variant.spectrum.has_bell
            else None
        ),
        "audacity_version": AUDACITY_VERSION,
        "render_timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _log_record(
    plan: RenderPlan,
    variant_row: Mapping[str, object],
    output_row: Mapping[str, object],
    commands: Sequence[str],
    responses: Sequence[str],
    duration: float,
    exit_state: str,
) -> dict[str, object]:
    return {
        "variant_id": plan.variant.variant_id,
        "seeds": _seed_list(plan),
        "params": {"variant": dict(variant_row), "output": dict(output_row)},
        "commands": list(commands),
        "responses": list(responses),
        "wall_clock_seconds": duration,
        "exit_state": exit_state,
    }


def render_batch(
    variants_file: Path,
    output_dir: Path,
    audacity_bin: str,
    timeout: float,
    force: bool = False,
    limit: int | None = None,
    dry_run: bool = False,
    aup3_serializer: bool = False,
    project_xml: Path | None = None,
    transport_factory: TransportFactory = default_transport,
    process_factory: ProcessFactory = _launch,
) -> int:
    """Render all requested variants, returning the number of failures."""
    output_row, rows = _load_matrix(variants_file)
    if limit is not None:
        rows = rows[:limit]
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path = output_dir / "render_log.jsonl"
    completed = set() if force else _read_successes(log_path)
    failures = 0

    with log_path.open("a", encoding="utf-8") as log:
        for row in rows:
            variant_id = _variant_id(row)
            if variant_id in completed:
                continue
            filename = row.get("filename")
            if not isinstance(filename, str) or not filename:
                raise ValueError(f"{variant_id}: missing filename")
            export_path = output_dir / filename
            plan = build_plan(row, output_row, str(export_path))
            started = time.monotonic()
            commands = plan.commands
            responses: list[str] = []
            exit_state = "dry-run" if dry_run else "success"
            process: ProcessHandle | None = None
            transport: Transport | None = None
            try:
                if not dry_run:
                    process = process_factory(audacity_bin)
                    transport = transport_factory(timeout)
                    commands = (
                        plan.commands[:-1]
                        + (f'SaveProject2: Filename="{export_path.with_suffix(".aup3")}"',)
                        if aup3_serializer
                        else plan.commands
                    )
                    for command in commands:
                        responses.append(transport.send(command, timeout))
                    if aup3_serializer:
                        extract_to_wav(
                            export_path.with_suffix(".aup3"),
                            project_xml,
                            export_path,
                        )
                    export_path.with_suffix(".json").write_text(
                        json.dumps(_sidecar(plan), indent=2) + "\n",
                        encoding="utf-8",
                    )
            except (
                AudacityPipeError,
                OSError,
                RuntimeError,
                TimeoutError,
                ValueError,
            ) as exc:
                failures += 1
                exit_state = f"failure: {exc}"
            finally:
                try:
                    if transport is not None:
                        transport.close()
                finally:
                    if process is not None:
                        process.kill()
                        process.wait()
            duration = time.monotonic() - started
            log.write(
                json.dumps(
                    _log_record(
                        plan,
                        row,
                        output_row,
                        commands if not dry_run else plan.commands,
                        responses,
                        duration,
                        exit_state,
                    )
                )
                + "\n"
            )
            log.flush()
    return failures


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variants-file", type=Path, default=DEFAULT_VARIANTS_FILE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--audacity-bin", default=_default_binary())
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--aup3-serializer",
        action="store_true",
        help="opt in to SaveProject2 plus external AUP3-to-WAV serialization",
    )
    parser.add_argument(
        "--project-xml",
        type=Path,
        help="readable project XML for --aup3-serializer",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    failures = render_batch(
        variants_file=args.variants_file,
        output_dir=args.output_dir,
        audacity_bin=args.audacity_bin,
        timeout=args.timeout,
        force=args.force,
        limit=args.limit,
        dry_run=args.dry_run,
        aup3_serializer=args.aup3_serializer,
        project_xml=args.project_xml,
    )
    if failures:
        print(f"{failures} variant(s) failed")
    return min(failures, 255)


if __name__ == "__main__":
    raise SystemExit(main())
