# Audacity noise generator — Phase 1

This directory contains only the Audacity setup and smoke test for PRD §4.
The pinned engine is **Audacity 3.7.8**, downloaded as the official Linux
`x64-22.04.AppImage` and unpacked with `--appimage-extract` (FUSE is not
required).

## Setup

From the repository root:

```sh
tools/noisegen/setup.sh
```

The script creates the ignored `.audacity/`, `.audacity-config/`, `.asoundrc`,
and `.venv/` directories/files. It installs the declared Python dependencies.
It does not download or modify the supplied reference audio.

## Smoke test

```sh
tools/noisegen/.venv/bin/python tools/noisegen/smoke_test.py
```

The test starts one fresh Audacity process under `xvfb-run -a`, verifies both
Linux script pipes, invokes `Help: Command=Help`, generates five seconds of
seeded Nyquist noise, exports a WAV, and checks actual samples for non-silence.

On Audacity 3.7.8, the Nyquist function is `(random-seed N)`; the PRD's
`(seed-random N)` spelling is not recognized by this release. The smoke test
uses the supported function and this discrepancy is recorded in
`docs/audacity-notes.md`.
