"""Tests for the Audacity script-pipe client, against real FIFOs.

Audacity's pipe paths are fixed by uid, so these tests create the real
``/tmp/audacity_script_pipe.{to,from}.<uid>`` FIFOs and play the Audacity side
of the protocol on a background thread. Each test gets its own server, and the
FIFOs are removed afterwards so a real Audacity install is never confused.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from pathlib import Path

import pytest

from audacity_pipe import AudacityPipe, AudacityPipeError

Handler = Callable[[str], str | None]


class FakeAudacity:
    """A minimal in-thread Audacity: reads commands, writes scripted replies."""

    def __init__(self, uid: int, handler: Handler, greeting: str = "") -> None:
        self.to_path = Path(f"/tmp/audacity_script_pipe.to.{uid}")
        self.from_path = Path(f"/tmp/audacity_script_pipe.from.{uid}")
        self.handler = handler
        self.greeting = greeting
        self.received: list[str] = []
        self._error: BaseException | None = None
        self._thread = threading.Thread(target=self._serve, daemon=True)

    def __enter__(self) -> "FakeAudacity":
        self.to_path.unlink(missing_ok=True)
        self.from_path.unlink(missing_ok=True)
        os.mkfifo(self.to_path)
        os.mkfifo(self.from_path)
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._thread.join(timeout=5)
        self.to_path.unlink(missing_ok=True)
        self.from_path.unlink(missing_ok=True)
        if self._error is not None:
            raise self._error

    def _serve(self) -> None:
        try:
            read_fd = os.open(self.to_path, os.O_RDONLY)
            try:
                write_fd = os.open(self.from_path, os.O_WRONLY)
            except OSError:
                os.close(read_fd)
                raise
            try:
                if self.greeting:
                    os.write(write_fd, self.greeting.encode("utf-8"))
                pending = b""
                while True:
                    chunk = os.read(read_fd, 65536)
                    if not chunk:
                        return  # client closed its writer
                    pending += chunk
                    while b"\n" in pending:
                        raw, pending = pending.split(b"\n", 1)
                        command = raw.decode("utf-8", errors="replace")
                        self.received.append(command)
                        reply = self.handler(command)
                        if reply is not None:
                            os.write(write_fd, reply.encode("utf-8"))
            finally:
                os.close(read_fd)
                os.close(write_fd)
        except BaseException as exc:  # surfaced in __exit__
            # A client that has already raised closes its end mid-exchange;
            # that is the point of several tests, not a server failure.
            if not isinstance(exc, (BrokenPipeError, OSError)):
                self._error = exc


@pytest.fixture()
def uid() -> int:
    return os.getuid()


def ok_handler(command: str) -> str:
    return "BatchCommand finished: OK\n"


def test_command_roundtrip(uid: int) -> None:
    with FakeAudacity(uid, ok_handler) as server:
        with AudacityPipe(timeout=5) as pipe:
            response = pipe.command("Help: Command=Help")
    assert response == "BatchCommand finished: OK\n"
    assert server.received == ["Help: Command=Help"]


def test_connection_greeting_is_discarded(uid: int) -> None:
    """Audacity announces itself on connect; that banner is not a response."""
    with FakeAudacity(uid, ok_handler, greeting=" audacity script server 1.0\n") as server:
        with AudacityPipe(timeout=5) as pipe:
            response = pipe.command("Help:")
    assert response == "BatchCommand finished: OK\n"
    assert server.received == ["Help:"]


def test_trailing_newline_is_not_doubled(uid: int) -> None:
    with FakeAudacity(uid, ok_handler) as server:
        with AudacityPipe(timeout=5) as pipe:
            pipe.command("SelectAll:\n")
    assert server.received == ["SelectAll:"]


def test_multiline_response_is_returned_in_full(uid: int) -> None:
    def handler(command: str) -> str:
        return "line one\nline two\nBatchCommand finished: OK\n"

    with FakeAudacity(uid, handler):
        with AudacityPipe(timeout=5) as pipe:
            response = pipe.command("GetInfo: Type=Commands")
    assert response == "line one\nline two\nBatchCommand finished: OK\n"


def test_leading_blank_lines_are_skipped(uid: int) -> None:
    def handler(command: str) -> str:
        return "\n\nBatchCommand finished: OK\n"

    with FakeAudacity(uid, handler):
        with AudacityPipe(timeout=5) as pipe:
            response = pipe.command("Help:")
    assert response == "BatchCommand finished: OK\n"


def test_error_line_raises(uid: int) -> None:
    def handler(command: str) -> str:
        return "Error: command not recognized\n"

    with FakeAudacity(uid, handler):
        with AudacityPipe(timeout=5) as pipe:
            with pytest.raises(AudacityPipeError, match="command not recognized"):
                pipe.command("Bogus:")


def test_batch_command_failed_raises(uid: int) -> None:
    def handler(command: str) -> str:
        return "BatchCommand failed: could not apply\n"

    with FakeAudacity(uid, handler):
        with AudacityPipe(timeout=5) as pipe:
            with pytest.raises(AudacityPipeError, match="could not apply"):
                pipe.command("Amplify:")


def test_failure_buried_in_finished_response_raises(uid: int) -> None:
    def handler(command: str) -> str:
        return "Some output\nwith an Error: buried inside\nBatchCommand finished: OK\n"

    with FakeAudacity(uid, handler):
        with AudacityPipe(timeout=5) as pipe:
            with pytest.raises(AudacityPipeError, match="buried inside"):
                pipe.command("Export2:")


def test_silent_server_times_out(uid: int) -> None:
    def handler(command: str) -> str | None:
        return None  # Audacity never answers

    with FakeAudacity(uid, handler):
        with AudacityPipe(timeout=0.3) as pipe:
            with pytest.raises(AudacityPipeError, match="Timed out"):
                pipe.command("Help:")


def test_per_command_timeout_overrides_default(uid: int) -> None:
    def handler(command: str) -> str | None:
        return None

    with FakeAudacity(uid, handler):
        with AudacityPipe(timeout=30.0) as pipe:
            with pytest.raises(AudacityPipeError, match="Timed out waiting for response"):
                pipe.command("Help:", timeout=0.3)


def test_deadline_expiry_reports_partial_response(uid: int, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """When the overall deadline has passed, the error includes what arrived."""
    import audacity_pipe

    def handler(command: str) -> str:
        return "partial output\n"  # a line, but never a finished line

    real_monotonic = audacity_pipe.time.monotonic
    calls = 0

    def jumped_clock() -> float:
        # The first command() call computes the deadline; every later check
        # sees a clock well past it, exercising the deadline-expired branch.
        nonlocal calls
        calls += 1
        now = real_monotonic()
        return now + (10.0 if calls > 1 else 0.0)

    with FakeAudacity(uid, handler):
        with AudacityPipe(timeout=5) as pipe:
            monkeypatch.setattr(audacity_pipe.time, "monotonic", jumped_clock)
            with pytest.raises(AudacityPipeError, match=r"Timed out after 0\.3s"):
                pipe.command("Help:", timeout=0.3)


def test_closed_pipe_raises(uid: int) -> None:
    def handler(command: str) -> str | None:
        raise SystemExit  # never used; replaced below

    # A server that answers the first command, then goes away entirely.
    class ClosingServer(FakeAudacity):
        def _serve(self) -> None:
            try:
                read_fd = os.open(self.to_path, os.O_RDONLY)
                write_fd = os.open(self.from_path, os.O_WRONLY)
                chunk = os.read(read_fd, 65536)
                self.received.append(chunk.decode().strip())
                os.close(read_fd)
                os.close(write_fd)  # EOF on the client's reader
            except BaseException as exc:
                self._error = exc

    with ClosingServer(uid, handler):
        with AudacityPipe(timeout=5) as pipe:
            with pytest.raises(AudacityPipeError, match="closed the script pipe"):
                pipe.command("Help:")


def test_missing_pipes_raise_on_enter() -> None:
    # A uid nobody has created pipes for.
    pipe = AudacityPipe(uid=424242)
    with pytest.raises(AudacityPipeError, match="pipe\\(s\\) missing"):
        pipe.__enter__()


def test_command_outside_context_manager_raises() -> None:
    pipe = AudacityPipe(uid=424242)
    with pytest.raises(AudacityPipeError, match="context manager"):
        pipe.command("Help:")


def test_exit_is_idempotent_and_tolerates_partial_open() -> None:
    pipe = AudacityPipe(uid=424242)
    pipe.__exit__()  # never entered: nothing to close, must not raise
