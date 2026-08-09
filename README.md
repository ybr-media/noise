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

## R2 cost monitoring

R2 bills for three meters: storage (10 GB-month free, then $0.015/GB-month),
Class A operations — writes/lists (1M/month free, then $4.50/million), and
Class B operations — reads (10M/month free, then $0.36/million). Egress and
deletes are free. Because published manifests are merged rather than pruned
(see above), storage is the meter most likely to grow over time; the render
workflow only publishes on manual dispatch, so operations are unlikely to
spike on their own.

`.github/workflows/r2-cost-monitor.yml` runs daily, reads current-month usage
from Cloudflare's GraphQL Analytics API, and emails an alert via
[Resend](https://resend.com) once any meter reaches 80% of its free tier
(`vars.ALERT_THRESHOLD_PCT`). `scripts/check_r2_usage.py` can be run locally
with `--dry-run` to print the same report without sending mail, or
`--force-alert` to send regardless of thresholds (useful for testing
delivery end to end).

Beyond the existing `R2_ACCOUNT_ID` and `R2_BUCKET`, it needs:

- `CLOUDFLARE_API_TOKEN` (repository secret) — an API token scoped to
  **Account Analytics: Read** for the account that owns the bucket.
- `RESEND_API_KEY` (repository secret) — a Resend API key.
- `ALERT_EMAIL_FROM` (repository variable) — sender address on a domain
  verified in Resend, e.g. `"R2 Alerts <alerts@yourdomain.com>"`.
- `ALERT_EMAIL_TO` (repository variable, optional) — defaults to
  `austin@marlo.today`.
- `ALERT_EMAIL_CC` (repository variable, optional) — comma-separated
  addresses to cc.
