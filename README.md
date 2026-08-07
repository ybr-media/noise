# Audacity noise generator — Phase 1

This repository contains the Audacity setup and smoke test for PRD §4.
The pinned engine is **Audacity 3.7.8**, downloaded as the official Linux
`x64-22.04.AppImage` and unpacked with `--appimage-extract` (FUSE is not
required).

## Setup

From the repository root:

```sh
./setup.sh
```

The script creates the ignored `.audacity/`, `.audacity-config/`, `.asoundrc`,
and `.venv/` directories/files. It installs the declared Python dependencies.
It does not download or modify the supplied reference audio.

## Smoke test

```sh
.venv/bin/python smoke_test.py
```

The test starts one fresh Audacity process under `xvfb-run -a`, verifies both
Linux script pipes, invokes `Help: Command=Help`, generates five seconds of
seeded Nyquist noise, exports a WAV, and checks actual samples for non-silence.

On Audacity 3.7.8, the Nyquist function is `(random-seed N)`; the PRD's
`(seed-random N)` spelling is not recognized by this release. The smoke test
uses the supported function and this discrepancy is recorded in
`docs/audacity-notes.md`.

## Publishing renders

Masters, sidecars, and QA evidence are published to an S3-compatible bucket
(Cloudflare R2) so the hosted console can browse and stream them without a
persistent disk:

```sh
.venv/bin/pip install -r requirements-publish.txt
R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... make publish OUT=out
```

The publisher writes a single `manifest.json` describing every published master,
merging it with whatever the bucket already lists, so publishing a subset never
hides earlier renders. `--dry-run` builds that manifest locally without
credentials.

## Remote rendering

`.github/workflows/render.yml` installs Audacity, renders a selection, runs QA,
and publishes the result. Dispatch it with `pilot`, `full`, or a comma-separated
list of variant ids; `scripts/select_variants.py` turns that into a filtered
matrix for the orchestrator. The workflow needs `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` as repository secrets, and reads
an optional `R2_BUCKET` repository variable.

At roughly 3.5 s per variant, the full 144-variant matrix is about 9 minutes of
runner time plus setup.
