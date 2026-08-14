"""Protocol tests for the script-pipe client, driven by a fake Audacity.

The client talks to two named pipes under ``/tmp`` whose names embed a uid, so
the tests stand a fake Audacity up on a uid nobody else is using rather than
mocking the transport away.
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

from audacity_pipe import AudacityPipe, AudacityPipeError

FINISHED = "BatchCommand finished: OK\n"


class FakeAudacity:
    """Serve the two script pipes for one uid, one scripted reply per command."""

    def __init__(
        self, uid: int, replies: list[str], greeting: str = "", linger: bool = False
    ) -> None:
        self.to_path = Path(f"/tmp/audacity_script_pipe.to.{uid}")
        self.from_path = Path(f"/tmp/audacity_script_pipe.from.{uid}")
        self.replies = replies
        self.greeting = greeting
        # A hung Audacity holds its pipes open and answers nothing; closing them
        # instead would be an EOF, which is a different failure.
        self.linger = linger
        self.commands: list[str] = []
        self._thread: threading.Thread | None = None

    def __enter__(self) -> FakeAudacity:
        for path in (self.to_path, self.from_path):
            path.unlink(missing_ok=True)
            os.mkfifo(path)
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._thread is not None:
            self._thread.join(timeout=5)
        for path in (self.to_path, self.from_path):
            path.unlink(missing_ok=True)

    def _serve(self) -> None:
        # Opening the read end blocks until the client opens the write end, so
        # this mirrors the order a real Audacity ends up in.
        with open(self.to_path, encoding="utf-8") as incoming:
            with open(self.from_path, "w", encoding="utf-8", buffering=1) as outgoing:
                if self.greeting:
                    outgoing.write(self.greeting)
                for reply in self.replies:
                    line = incoming.readline()
                    if not line:
                        return
                    self.commands.append(line.rstrip("\n"))
                    outgoing.write(reply)
                while self.linger:
                    line = incoming.readline()
                    if not line:
                        return
                    self.commands.append(line.rstrip("\n"))


@pytest.fixture()
def uid() -> int:
    """A uid nobody is serving, so the fake pipes cannot collide with a real one."""
    return 900000 + os.getpid() % 1000


def test_commands_round_trip_and_the_greeting_is_discarded(uid: int) -> None:
    with FakeAudacity(uid, [FINISHED, f"5\n{FINISHED}"], greeting="hello\n") as fake:
        with AudacityPipe(uid=uid, timeout=5) as pipe:
            assert pipe.command("SelectAll:") == FINISHED
            assert pipe.command("GetInfo: Type=Tracks") == f"5\n{FINISHED}"
    assert fake.commands == ["SelectAll:", "GetInfo: Type=Tracks"]


def test_a_rejected_command_raises_with_audacity_s_own_text(uid: int) -> None:
    with FakeAudacity(uid, ["BatchCommand failed: no such command\n"]):
        with AudacityPipe(uid=uid, timeout=5) as pipe:
            with pytest.raises(AudacityPipeError, match="no such command"):
                pipe.command("Nonsense:")


def test_an_error_line_raises_before_the_batch_summary_arrives(uid: int) -> None:
    with FakeAudacity(uid, ["Error: Nyquist returned no audio\n"]):
        with AudacityPipe(uid=uid, timeout=5) as pipe:
            with pytest.raises(AudacityPipeError, match="returned no audio"):
                pipe.command('NyquistPrompt: Command="(oops)"')


def test_a_finished_response_reporting_failure_still_raises(uid: int) -> None:
    # Audacity sometimes reports the problem only in the run's summary text.
    with FakeAudacity(uid, [f"the effect failed on track 1\n{FINISHED}"]):
        with AudacityPipe(uid=uid, timeout=5) as pipe:
            with pytest.raises(AudacityPipeError, match="failed on track 1"):
                pipe.command("Amplify: Ratio=2")


def test_a_silent_audacity_times_out_with_the_effective_budget(uid: int) -> None:
    with FakeAudacity(uid, [], linger=True):
        with AudacityPipe(uid=uid, timeout=30) as pipe:
            with pytest.raises(AudacityPipeError, match=r"Timed out after 0.2s"):
                pipe.command("Silence: Duration=5", timeout=0.2)


def test_using_the_client_outside_its_context_is_refused(uid: int) -> None:
    with pytest.raises(AudacityPipeError, match="context manager"):
        AudacityPipe(uid=uid).command("SelectAll:")


def test_missing_pipes_are_named_rather_than_blocking(uid: int) -> None:
    with pytest.raises(AudacityPipeError, match="missing"):
        AudacityPipe(uid=uid, timeout=1).__enter__()


def test_leaving_the_context_releases_both_descriptors(uid: int) -> None:
    with FakeAudacity(uid, [FINISHED]):
        pipe = AudacityPipe(uid=uid, timeout=5)
        with pipe:
            pipe.command("SelectAll:")
        assert pipe._to is None and pipe._from_fd is None
        # A leaked read descriptor would still be open on the closed pipe.
        with pytest.raises(AudacityPipeError, match="context manager"):
            pipe.command("SelectAll:")
