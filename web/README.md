# Noise Lab console

Self-contained Next.js console for the Audacity noise engine. It follows the
Noise Lab prototype's iOS-flavoured visual language while keeping the browser
preview explicitly separate from Audacity's rendered masters.

## Run

```bash
npm install
NOISE_RENDER_DIR="$HOME/noisegen-out" npm run dev
```

Configuration:

- `NOISE_VARIANTS_FILE` points to `../config/variants.yaml`. When the app is
  deployed on its own, a copy of the engine's `config/` beside `app/` is used
  instead.
- `NOISE_RENDERING_AVAILABLE` (`0`/`1`) forces the local worker on or rendering
  off, overriding the mode detection below.
- `NOISE_RENDER_DIR` points to the durable render output directory. It defaults
  to `$HOME/noisegen-out`.
- `NOISE_QUEUE_FILE` controls the JSONL queue path.
- `NOISE_ARTIFACTS_BASE_URL` points at published artifacts in object storage.
  When set, the Library reads `manifest.json` from that base instead of the
  local disk and audio requests redirect straight to storage.
- `NOISE_MANIFEST_TTL_MS` caches that manifest (default 30s).
- `NOISE_DISPATCH_REPO`, `NOISE_DISPATCH_TOKEN`, `NOISE_DISPATCH_WORKFLOW`
  (default `render.yml`), and `NOISE_DISPATCH_REF` (default `main`) let a hosted
  console trigger the GitHub Actions renderer.

The Library reads sidecars, `qa_results.json`, and `render_log.jsonl`, streams
local WAVs through a range-aware API route, and never loads a master into the
client bundle.

One library track is one variant's master. The master's sidecar names the three
stems it was mixed from, which the card offers as extra downloads through the
same audio route; only the master is playable, QA'd, and nameable.

## Render modes

The console reports one of three modes and never accepts work it cannot run:

- `local` — beside the Python tree, so Render appends to the JSONL queue that
  the worker below drains.
- `dispatch` — hosted with `NOISE_DISPATCH_*` configured, so Render triggers a
  GitHub Actions run and the queue tab mirrors that run's status.
- `unavailable` — hosted with no renderer configured; Render returns 503 and
  the console browses published masters only.

## Hosting on Vercel

The repository root is the Python engine, so the Vercel project's **Root
Directory** must be `web` and its framework preset **Next.js**; otherwise the
build looks for a Python entrypoint and fails. `prebuild` stages
`../config/*.yaml` into `web/config` so the deployment carries the variant
matrix.

A hosted console needs `NOISE_ARTIFACTS_BASE_URL` to browse anything and the
`NOISE_DISPATCH_*` variables to render; the renderer's own credentials
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) live in GitHub
Actions secrets, not in Vercel.

## Queue worker

The API only appends jobs to JSONL. It does not block an HTTP request on
Audacity. Start the separate worker when renders should be drained:

```bash
NOISE_RENDER_DIR="$HOME/noisegen-out" npm run worker
```

The worker creates a one-row temporary YAML matrix and invokes the existing
Python orchestrator. Job status is persisted as `Queued`, `Rendering`, `Done`,
or `Failed`; no fake percentage progress is shown.

## SEO naming

`lib/naming.ts` defines the `SeoNameProvider` interface and currently exposes a
deterministic `local-stub` provider. Its prompt is visible in the generated
response and is the swap-in point for a future OpenAI provider. Suggestions are
editable and require explicit approval before the title and description are
written to the matching sidecar. The internal parameter fingerprint remains
the filename and `variant_id`.
