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
- `NOISE_RENDERING_AVAILABLE` (`0`/`1`) overrides whether the Render buttons
  can queue work. It defaults off on Vercel, where no worker can drain the
  queue, so a hosted deployment is browse-only.
- `NOISE_RENDER_DIR` points to the durable render output directory. It defaults
  to `$HOME/noisegen-out`.
- `NOISE_QUEUE_FILE` controls the JSONL queue path.

The Library reads sidecars, `qa_results.json`, and `render_log.jsonl`, streams
WAVs through a range-aware API route, and never loads a master into the client
bundle.

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
