#!/usr/bin/env python3
"""Minimal, timeout-bounded client for Audacity's Linux script pipes."""

from __future__ import annotations

import fcntl
import os
import select
import time
from pathlib import Path

from typing_extensions import Self


class AudacityPipeError(RuntimeError):
    """Raised when Audacity rejects a command or the pipe protocol fails."""


class AudacityPipe:
    def __init__(self, uid: int | None = None, timeout: float = 30.0):
        uid = os.getuid() if uid is None else uid
        self.to_path = Path(f"/tmp/audacity_script_pipe.to.{uid}")
        self.from_path = Path(f"/tmp/audacity_script_pipe.from.{uid}")
        self.timeout = timeout
        self._to = None
        self._from_fd = None

    def __enter__(self) -> Self:
        missing = [str(path) for path in (self.to_path, self.from_path) if not path.exists()]
        if missing:
            raise AudacityPipeError(f"Audacity script pipe(s) missing: {', '.join(missing)}")
        self._to = open(self.to_path, "w", encoding="utf-8", buffering=1)
        read_fd = os.open(self.from_path, os.O_RDONLY | os.O_NONBLOCK)
        # Consume Audacity's connection greeting before switching to the
        # blocking, line-oriented command protocol.
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            ready, _, _ = select.select([read_fd], [], [], 0.05)
            if not ready:
                continue
            try:
                while os.read(read_fd, 65536):
                    pass
            except BlockingIOError:
                pass
        flags = fcntl.fcntl(read_fd, fcntl.F_GETFL)
        fcntl.fcntl(read_fd, fcntl.F_SETFL, flags & ~os.O_NONBLOCK)
        self._from_fd = read_fd
        return self

    def __exit__(self, *_exc) -> None:
        if self._to is not None:
            self._to.close()
        if self._from_fd is not None:
            os.close(self._from_fd)

    def command(self, command: str, timeout: float | None = None) -> str:
        if self._to is None or self._from_fd is None:
            raise AudacityPipeError("AudacityPipe must be used as a context manager")
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
        self._to.write(command.rstrip("\n") + "\n")
        self._to.flush()
        lines: list[str] = []
        pending = b""
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AudacityPipeError(
                    f"Timed out after {timeout or self.timeout:.1f}s waiting for {command!r}; "
                    f"response so far: {''.join(lines)!r}"
                )
            ready, _, _ = select.select([self._from_fd], [], [], remaining)
            if not ready:
                raise AudacityPipeError(f"Timed out waiting for response to {command!r}")
            chunk = os.read(self._from_fd, 65536)
            if not chunk:
                raise AudacityPipeError("Audacity closed the script pipe")
            pending += chunk
            while b"\n" in pending:
                raw, pending = pending.split(b"\n", 1)
                line = raw.decode("utf-8", errors="replace") + "\n"
                if line == "\n" and not lines:
                    continue
                lines.append(line)
                if line.startswith(("BatchCommand failed:", "Error:")):
                    raise AudacityPipeError("".join(lines).strip())
                if line.startswith("BatchCommand finished:"):
                    response = "".join(lines)
                    if "failed" in response.lower() or "error:" in response.lower():
                        raise AudacityPipeError(response.strip())
                    return response
