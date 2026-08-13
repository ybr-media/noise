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

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
import yaml

from audacity_pipe import AudacityPipe, AudacityPipeError
from aup3_serializer import extract_stereo_tracks_to_wavs, read_stereo_track
from render_plan import (
    MASTER_TRACK_INDEX,
    STEM_MAP,
    Fx,
    RenderPlan,
    build_plan,
)
from resampling import resample_stereo

AUDACITY_VERSION = "3.7.8"
DEFAULT_VARIANTS_FILE = Path("config/variants.yaml")
DEFAULT_OUTPUT_DIR = Path("out")

#: Filtering and normalising four minutes of noise takes far longer than a
#: trivial scripting command, so the per-command deadline is generous.
DEFAULT_TIMEOUT_SECONDS = 300.0

#: A headless Audacity occasionally hangs before its first response or fails a
#: command it normally accepts, so each variant is retried in a fresh process.
DEFAULT_RETRIES = 2
ROOT = Path(__file__).resolve().parent


def _expected_frames(plan: RenderPlan, sample_rate: int) -> int:
    """Return the exact sidecar frame count for one output rate."""
    return round(plan.output.cell_seconds * sample_rate) * plan.output.repeats + round(
        plan.tail_seconds * sample_rate
    )


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


def _integrated_loudness(samples: np.ndarray, sample_rate: int) -> float:
    """Measure one buffer the same way the QA harness measures the master."""
    return float(
        pyln.Meter(sample_rate).integrated_loudness(samples.astype(np.float64))
    )


def _fx_block(fx: Fx | None) -> dict[str, object] | None:
    if fx is None or fx.is_identity:
        return None
    block: dict[str, object] = {}
    if fx.eq is not None and not fx.eq.is_flat:
        block["eq"] = {
            "preset": fx.eq.preset,
            "gains_db": list(fx.eq.gains_db),
            "trim_db": fx.eq.trim_db,
        }
    if fx.reverb is not None and not fx.reverb.is_off:
        block["reverb"] = {
            "preset": fx.reverb.preset,
            "room_size": fx.reverb.room_size,
            "pre_delay_ms": fx.reverb.pre_delay_ms,
            "reverberance": fx.reverb.reverberance,
            "damping": fx.reverb.damping,
            "mix_percent": fx.reverb.mix_percent,
        }
    return block or None


def _sidecar(plan: RenderPlan, loudness_gain_db: float) -> dict[str, object]:
    variant = plan.variant
    master = Path(plan.master_path)
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
        "sample_rate": plan.output.master_sample_rate,
        "bit_depth": plan.output.bit_depth,
        "expected_frames": _expected_frames(plan, plan.output.master_sample_rate),
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
        "fx": _fx_block(plan.fx),
        "tail_seconds": plan.tail_seconds,
        "audacity_version": AUDACITY_VERSION,
        "render_timestamp": datetime.now(timezone.utc).isoformat(),
        # One measurement of the mix, applied unchanged to all four outputs.
        "loudness_gain_db": loudness_gain_db,
        "master_filename": master.name,
        "stem_filenames": [Path(path).name for path in plan.stem_paths],
        "stem_map": dict(STEM_MAP),
    }


def _output_sidecars(
    plan: RenderPlan, loudness_gain_db: float
) -> dict[Path, dict[str, object]]:
    """Sidecar metadata per output file, keyed by that file's path.

    Every sidecar names the role of its own file, so nothing downstream has to
    infer a stem from a filename.
    """
    shared = _sidecar(plan, loudness_gain_db)
    master_sidecar = {**shared, "role": "master", "stem": None}
    sidecars = {Path(plan.master_path): master_sidecar}
    for number, (path, stem) in enumerate(
        zip(plan.stem_paths, STEM_MAP.values()), start=1
    ):
        sidecars[Path(path)] = {
            **shared,
            "sample_rate": plan.output.stem_sample_rate,
            "expected_frames": _expected_frames(plan, plan.output.stem_sample_rate),
            "role": f"stem_{number}",
            "stem": stem,
        }
    return sidecars


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


def _render_variant(
    plan: RenderPlan,
    transport: Transport,
    timeout: float,
    aup3_serializer: bool,
    project_xml: Path | None,
    sent: list[str],
    responses: list[str],
) -> float:
    """Render one variant's four files, returning the shared loudness gain.

    Both routes measure the finished mix once and then apply that one gain to
    the master and all three stems, so the stems keep summing to the master.
    ``sent`` and ``responses`` accumulate the exchange, so a failure part way
    through still leaves the caller with everything that was sent.
    """

    def send(command: str) -> None:
        sent.append(command)
        responses.append(transport.send(command, timeout))

    for command in plan.commands:
        send(command)

    master_path = Path(plan.master_path)
    output_paths = tuple(Path(path) for path in plan.track_paths)
    if aup3_serializer:
        project = master_path.with_suffix(".aup3")
        # A failed attempt keeps its project as evidence; clear it so this
        # attempt saves into a fresh file rather than a stale one.
        for path in (project, *(Path(f"{project}{tail}") for tail in ("-wal", "-shm"))):
            path.unlink(missing_ok=True)
        send(f'SaveProject2: Filename="{project}"')
        samples, sample_rate = read_stereo_track(
            project, project_xml, MASTER_TRACK_INDEX
        )
        gain_db = plan.output.target_lufs - _integrated_loudness(samples, sample_rate)
        for command in plan.gain_commands(gain_db):
            send(command)
        # `Save:` rewrites the project that `SaveProject2:` named, so the
        # amplified samples are the ones the serializer reads back.
        send("Save:")
        extract_stereo_tracks_to_wavs(
            project,
            project_xml,
            output_paths,
            stem_rate=plan.output.stem_sample_rate,
        )
        # Four outputs per variant already multiply the render's footprint, and
        # the project holds another copy of all of them. It is only kept when
        # extraction fails, where it is the evidence.
        for path in (project, *(Path(f"{project}{tail}") for tail in ("-wal", "-shm"))):
            path.unlink(missing_ok=True)
        return gain_db

    probe_path = master_path.with_name(f"{master_path.stem}.measure.wav")
    try:
        for command in plan.export_commands(MASTER_TRACK_INDEX, str(probe_path)):
            send(command)
        samples, sample_rate = sf.read(probe_path, always_2d=True)
    finally:
        probe_path.unlink(missing_ok=True)
    gain_db = plan.output.target_lufs - _integrated_loudness(samples, sample_rate)
    for command in plan.gain_commands(gain_db):
        send(command)
    with tempfile.TemporaryDirectory(
        prefix=f"{master_path.stem}-", dir=master_path.parent
    ) as temp_dir:
        source_stem_paths = tuple(
            Path(temp_dir) / f"{Path(path).stem}.source.wav"
            for path in plan.stem_paths
        )
        exports = (
            (MASTER_TRACK_INDEX, master_path),
            *((index, path) for index, path in enumerate(source_stem_paths)),
        )
        for track_index, output_path in exports:
            for command in plan.export_commands(track_index, str(output_path)):
                send(command)
        for source_path, output_path in zip(source_stem_paths, plan.stem_paths):
            samples, sample_rate = sf.read(source_path, always_2d=True)
            converted = resample_stereo(
                samples, sample_rate, plan.output.stem_sample_rate
            )
            sf.write(
                output_path,
                converted,
                plan.output.stem_sample_rate,
                format="WAV",
                subtype="PCM_24",
            )
    return gain_db


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
    retries: int = DEFAULT_RETRIES,
    transport_factory: TransportFactory = default_transport,
    process_factory: ProcessFactory = _launch,
) -> int:
    """Render all requested variants, returning the number of failures.

    A failed variant is retried up to ``retries`` further times, each in a
    fresh Audacity process; every attempt is logged, and later log entries
    supersede earlier ones for the same variant.
    """
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
            plan = build_plan(row, output_row, str(output_dir / filename))
            for attempt in range(max(0, retries) + 1):
                started = time.monotonic()
                commands: list[str] = []
                responses: list[str] = []
                exit_state = "dry-run" if dry_run else "success"
                process: ProcessHandle | None = None
                transport: Transport | None = None
                try:
                    if not dry_run:
                        process = process_factory(audacity_bin)
                        transport = transport_factory(timeout)
                        gain_db = _render_variant(
                            plan,
                            transport,
                            timeout,
                            aup3_serializer,
                            project_xml,
                            commands,
                            responses,
                        )
                        for path, sidecar in _output_sidecars(plan, gain_db).items():
                            path.with_suffix(".json").write_text(
                                json.dumps(sidecar, indent=2) + "\n",
                                encoding="utf-8",
                            )
                except (
                    AudacityPipeError,
                    OSError,
                    RuntimeError,
                    TimeoutError,
                    ValueError,
                ) as exc:
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
                            plan.commands if dry_run else commands,
                            responses,
                            duration,
                            exit_state,
                        )
                    )
                    + "\n"
                )
                log.flush()
                if not exit_state.startswith("failure:"):
                    break
            else:
                failures += 1
    return failures


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variants-file", type=Path, default=DEFAULT_VARIANTS_FILE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--audacity-bin", default=_default_binary())
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument(
        "--retries",
        type=int,
        default=DEFAULT_RETRIES,
        help="further attempts per failed variant, each in a fresh Audacity",
    )
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
        retries=args.retries,
    )
    if failures:
        print(f"{failures} variant(s) failed")
    return min(failures, 255)


if __name__ == "__main__":
    raise SystemExit(main())
