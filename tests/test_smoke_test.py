"""Tests for the smoke test's process and scratch-directory handling.

Launching Audacity needs a display and an installed AppImage, so these cover
the parts that run either side of it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

import smoke_test


def test_the_scratch_home_is_removed_after_a_successful_run(monkeypatch, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    homes: list[Path] = []

    def fake_run(binary: Path, output: Path, seed: int, home: Path) -> None:
        del binary, output, seed
        homes.append(home)
        assert home.is_dir()

    monkeypatch.setattr(smoke_test, "_run_in_home", fake_run)
    smoke_test.run(Path("audacity"), tmp_path / "out.wav", 1)
    assert homes and not homes[0].exists()


def test_the_scratch_home_is_removed_when_the_run_fails(monkeypatch, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    homes: list[Path] = []

    def fake_run(binary: Path, output: Path, seed: int, home: Path) -> None:
        del binary, output, seed
        homes.append(home)
        raise RuntimeError("launch failed")

    monkeypatch.setattr(smoke_test, "_run_in_home", fake_run)
    with pytest.raises(RuntimeError, match="launch failed"):
        smoke_test.run(Path("audacity"), tmp_path / "out.wav", 1)
    assert homes and not homes[0].exists()


def test_stale_script_pipes_are_cleared_before_launching(monkeypatch, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    uid = 900000 + (hash(tmp_path.name) % 1000)
    stale = [Path(f"/tmp/audacity_script_pipe.{end}.{uid}") for end in ("to", "from")]
    for path in stale:
        path.write_text("stale", encoding="utf-8")
    monkeypatch.setattr(smoke_test.os, "getuid", lambda: uid)
    monkeypatch.setattr(smoke_test, "_run_in_home", lambda *args: None)
    try:
        smoke_test.run(Path("audacity"), tmp_path / "out.wav", 1)
        assert not any(path.exists() for path in stale)
    finally:
        for path in stale:
            path.unlink(missing_ok=True)


def test_the_log_tail_is_bounded_and_survives_a_missing_file(tmp_path: Path) -> None:
    log = tmp_path / "audacity.log"
    log.write_bytes(b"x" * 100 + b"the end")
    assert smoke_test._tail(log, limit=7) == "the end"
    assert smoke_test._tail(tmp_path / "absent.log") == ""


def test_undecodable_log_bytes_do_not_hide_the_failure(tmp_path: Path) -> None:
    log = tmp_path / "audacity.log"
    log.write_bytes(b"\xff\xfe fatal: no display")
    assert "fatal: no display" in smoke_test._tail(log)


def test_a_missing_binary_is_reported_before_any_launch(monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("AUDACITY_BIN", "/nonexistent/audacity")
    monkeypatch.setattr(sys, "argv", ["smoke_test.py"])
    assert smoke_test.main() == 2
    assert "Run setup.sh first" in capsys.readouterr().err


def test_a_failed_run_is_reported_as_exit_code_one(monkeypatch, tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    binary = tmp_path / "audacity"
    binary.write_text("#!/bin/sh\n", encoding="utf-8")
    monkeypatch.setenv("AUDACITY_BIN", str(binary))
    monkeypatch.setattr(sys, "argv", ["smoke_test.py", "--output", str(tmp_path / "out.wav")])

    def fail(*args: object) -> None:
        raise smoke_test.AudacityPipeError("pipes never appeared")

    monkeypatch.setattr(smoke_test, "run", fail)
    assert smoke_test.main() == 1
    assert "pipes never appeared" in capsys.readouterr().err
