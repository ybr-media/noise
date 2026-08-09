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

## Outputs per variant

Every variant renders four aligned 48 kHz/24-bit stereo WAVs:

```text
<track-name>_master.wav   the mixed master, and the library track
<track-name>_stem_1.wav   bed
<track-name>_stem_2.wav   texture
<track-name>_stem_3.wav   motion
```

The three stems are the same audio the master was mixed from, so they sum back
to it: QA's `Stem sum` check requires `max |sum(stems) - master| <= 1e-5`, and a
real render measures about `2.4e-7` (`-132 dBFS`), which is 24-bit
requantization of four files. That holds because loudness is measured once on
the mix and the resulting gain is applied to all four tracks; the stems are
never normalized on their own, and the finished-mix thresholds (loudness, true
peak, tilt, seam) still apply to the master alone.

Four files per variant is four times the bytes: about 260 MB per four-minute
variant, so the full 144-variant matrix is roughly 37 GB published. The renderer
deletes each variant's intermediate `.aup3` as soon as its outputs are
extracted, keeping the CI runner's working set to one variant.

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
