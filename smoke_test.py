#!/usr/bin/env python3
"""One-process Audacity headless smoke test."""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from audacity_pipe import AudacityPipe, AudacityPipeError

ROOT = Path(__file__).resolve().parent


def wait_for_pipes(timeout: float = 20.0) -> None:
    uid = os.getuid()
    paths = [Path(f"/tmp/audacity_script_pipe.{direction}.{uid}") for direction in ("to", "from")]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if all(path.exists() for path in paths):
            return
        time.sleep(0.05)
    raise AudacityPipeError(f"Timed out waiting for Audacity pipes: {', '.join(map(str, paths))}")


def run(binary: Path, output: Path, seed: int) -> None:
    uid = os.getuid()
    for path in (Path(f"/tmp/audacity_script_pipe.to.{uid}"), Path(f"/tmp/audacity_script_pipe.from.{uid}")):
        path.unlink(missing_ok=True)
    home = Path(tempfile.mkdtemp(prefix="noisegen-home-"))
    config_dir = home / ".config" / "audacity"
    config_dir.mkdir(parents=True)
    shutil.copy2(ROOT / ".audacity-config/audacity.cfg", config_dir / "audacity.cfg")
    env = os.environ.copy()
    env.update(
        HOME=str(home),
        ALSA_CONFIG_PATH=str(ROOT / ".asoundrc"),
        LD_LIBRARY_PATH=f"{ROOT / '.audacity/squashfs-root/lib'}:"
        f"{ROOT / '.audacity/squashfs-root/fallback/libportaudio.so'}:"
        + os.environ.get("LD_LIBRARY_PATH", ""),
        AUDACITY_LOG_LEVEL="WARN",
    )
    command = ["xvfb-run", "-a", "--server-args=-screen 0 1280x800x24", str(binary)]
    process = subprocess.Popen(
        command,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        wait_for_pipes()
        with AudacityPipe(timeout=20) as pipe:
            pipe.command("Help: Command=Help", timeout=20)
            pipe.command("NewStereoTrack:")
            pipe.command("SelectTime: Start=0 End=5")
            pipe.command("Silence: Duration=5", timeout=20)
            pipe.command("SelectAll:")
            pipe.command(f'NyquistPrompt: Command="(random-seed {seed})(noise 5)"', timeout=20)
            pipe.command(f'Export2: Filename="{output}" NumChannels=2', timeout=20)
        if not output.exists() or output.stat().st_size == 0:
            raise AssertionError(f"Audacity did not export a non-empty WAV: {output}")
        samples, rate = sf.read(output, always_2d=True)
        if rate <= 0 or samples.size == 0 or float(np.max(np.abs(samples))) <= 1e-8:
            raise AssertionError("Exported WAV contains no non-zero samples")
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        if process.returncode not in (0, -signal.SIGTERM):
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"Audacity exited {process.returncode}: {stderr[-4000:]}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--seed", type=int, default=1042)
    args = parser.parse_args()
    binary = Path(os.environ.get("AUDACITY_BIN", ROOT / ".audacity/squashfs-root/AppRun"))
    if not binary.exists():
        print(f"Audacity not installed: {binary}. Run setup.sh first.", file=sys.stderr)
        return 2
    output = args.output or ROOT / "smoke-output.wav"
    try:
        run(binary, output, args.seed)
    except (AudacityPipeError, OSError, RuntimeError, TimeoutError, ValueError) as exc:
        print(f"smoke test failed: {exc}", file=sys.stderr)
        return 1
    finally:
        output.unlink(missing_ok=True)
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
