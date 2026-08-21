# "Your track is rendered" email — implementation spec

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-21
**Audience:** implementing agent (Devin) · **Status:** ready to build
**Code grounding:** `web/lib/auth.ts` (Resend send + email markup), `web/worker/queue-worker.ts`,
`web/lib/queue.ts`, `web/lib/queue-action.ts`, `web/lib/dispatch.ts`, `web/lib/library.ts`,
`web/lib/artifacts.ts`, `web/lib/fx.ts` (`eqResponseDb`, `fxBadges`), `web/lib/route.ts`,
`web/middleware.ts`, `web/app/noise-lab.tsx` (`drawEqCurve`, `Spectrum`, `TrackCard`),
`.github/workflows/render.yml`

---

## 1. Why

A render is the only thing in Noise Lab that takes minutes rather than
milliseconds, and it is the one thing the console cannot tell you about once you
close the tab. Today the *only* way to learn that a track finished is to reopen
the console and look at the header pill or the Library. A hosted render runs on a
GitHub Actions runner for 5–10 minutes; a full matrix runs far longer. The person
who pressed "Create track" has no reason to keep the tab open, and no reason to
come back at any particular moment.

So: when a render succeeds, email the person who asked for it. The email carries
the same visual language the console uses for that track — the EQ/response card —
and gives them the two things they could want next, in one tap each:

1. **Open it in Noise Lab** — deep-link into the Library, on that track.
2. **Download the master** — a direct link, no sign-in round trip.

### User stories

1. **Know without watching.** As a founder who queued a render from my phone and
   locked it, I want an email when the track is ready, so I never poll the
   console.
2. **Hear it in two taps.** As someone reading that email on a phone, I want a
   button that lands me on that exact track in the Library with its player and
   its recipe, not on the Library's top.
3. **Grab the file from the email.** As someone forwarding a master to a
   collaborator or dropping it into a DAW, I want the WAV without opening the
   console at all.
4. **Not get spammed.** As someone who just queued the full 144-variant matrix, I
   want one email about that batch, not 144 — and a way to turn the emails off.

---

## 2. Scope

**In scope**

- One email per completed render *request* (a local queue job, or one dispatched
  Actions run), addressed to the person who requested it.
- Successful renders only. QA verdict is reported honestly inside the email; a
  `FAIL` verdict does not withhold it (same principle as `render.yml`'s QA step:
  "A failing check is evidence to publish, not a reason to withhold the master").
- Both render modes: `local` (JSONL queue + `web/worker/queue-worker.ts`) and
  `dispatch` (GitHub Actions), through one shared send path.
- A hero image mirroring the console's EQ/response card, generated server-side as
  a PNG.
- Signed, expiring download links.
- One-click unsubscribe, and a per-user preference flag.

**Out of scope (name them in the PR, do not build them)**

- Failure emails. The send path takes a `kind` discriminator so a `render-failed`
  template can be added later, but this PR ships `render-complete` only.
- An in-console notification-preferences UI. The unsubscribe link is the control
  surface for now; the flag it writes is read by the send path.
- Digest scheduling, per-track subscriptions, push/SMS, stem-level emails.
- Attaching audio. A master is ~200 MB; Resend caps attachments at 40 MB. Links
  only, always.

---

## 3. What the email looks like

Mirror the auth email in `web/lib/auth.ts` (`emailTemplate`): a 520px white card,
24px radius, on `#eef0f6`, Arial stack, the bell mark in a `#ffdc4a` disc, one
pill CTA in `TOKENS.brand` (`#e2483b`). This email adds a hero image and a
secondary CTA.

Single-track layout, top to bottom:

1. **Bell mark + "Noise Lab"** wordmark (unchanged from the auth email).
2. **Headline:** `Your track is rendered.`
3. **Track line:** the SEO title when the sidecar has one, otherwise the
   `renderKey`. Below it, one muted line of facts:
   `4:00 · 96 kHz/24-bit · −20.1 LUFS · QA passed` (omit any fact that is
   `null`; render `QA not run` for `UNAVAILABLE`, `QA flagged — see checks` for
   `FAIL`).
4. **Hero image** — the response card (§4). 520×300 CSS px, served at 2× and
   constrained with `width`/`height` attributes. `alt` repeats the FX summary in
   words (`"Frequency response — EQ: Telephone"`), because most clients block
   images by default.
5. **FX chips as text**, from `fxBadges(...)` — e.g. `EQ: Telephone · FX: Medium`
   (that helper's own wording; do not invent new labels). `LibraryRecipe` splits
   the block into `recipe.eq` / `recipe.reverb`, so reassemble
   `{ eq: recipe.eq ?? undefined, reverb: recipe.reverb ?? undefined }` before
   calling it. Omit the row when both are null (a flat, dry render).
6. **Primary CTA:** `Open in Noise Lab` → `${APP_URL}/#library/<renderKey>`.
7. **Secondary CTA:** `Download master (243 MB)` → the signed download URL (§6).
   Style it as a bordered/neutral pill, not a second brand pill, so the two CTAs
   read as primary/secondary.
8. **Footer:** `Rendered on <date> · <variantId>`, then
   `Stop these emails` (unsubscribe URL) in 12px `#8e8e93`.

Batch layout (a request that produced more than one track):

- Headline `8 tracks are rendered.`; subject `8 tracks are rendered`.
- Hero image of the **first** track only.
- List the first **3** tracks as `title — facts` lines, then
  `+5 more in your Library` when there are more.
- Primary CTA `Open Library` → `${APP_URL}/#library`; **no** per-track download
  button in batch mode (linking one of eight masters is arbitrary, and eight
  buttons is a wall).

Hard constraints, all of which the implementation must respect:

- Table-based layout, every style inline. No `<style>` blocks, no flexbox/grid,
  no web fonts, no CSS background images, no inline `<svg>` (Gmail strips it —
  this is exactly why the hero is a PNG).
- Always send a plaintext `text` alternative alongside `html`, carrying both URLs
  as bare links (Resend's payload already has the field; see `auth.ts`).
- The email must be fully usable with images disabled: every fact in the hero
  image also appears as text.
- Colors must be legible against a forced dark background (dark-mode clients
  invert the white card): keep text on explicit light backgrounds, never rely on
  a default-white body.

---

## 4. The hero image

The attachment that prompted this feature is the console's response card: a
rounded white card, a light grid, a logarithmic 30 Hz → 16 kHz axis, the EQ
response curve in `TOKENS.link` (`#007aff`) at 75% opacity with an 8% fill under
it, and a preset chip (`EQ: Telephone`) in the top-right. `drawEqCurve` in
`web/app/noise-lab.tsx:484` already draws exactly this on canvas, from
`eqResponseDb(gainsDb, hz)` in `web/lib/fx.ts:249`.

**Route:** `GET /api/og/track/[renderKey]` → `image/png`, via
`import { ImageResponse } from "next/og"` (bundled with Next 15.5; no new
dependency). 1040×600 px output, `Cache-Control: public, max-age=86400,
immutable`. Unauthenticated — mail clients fetch it through an image proxy with
no cookies — so add it to the middleware bypass (§8).

**Curve geometry must be shared, not re-derived.** Extract the point generation
out of `drawEqCurve` into `web/lib/eq-card.ts`:

```ts
export type EqCardPoint = { x: number; y: number };
export function eqCardPoints(gainsDb: number[], width: number, height: number): EqCardPoint[];
export function eqCardPath(points: EqCardPoint[]): string; // SVG "M…L…" path data
```

Keep the existing mapping: `hz = 30 * (16000/30) ** (x/width)`, sampled every 3
px, `y = mid - (db / EQ_MAX_ABS_DB) * span`. Then have `drawEqCurve` consume
`eqCardPoints` so the console and the email can never drift. A flat EQ renders
the flat separator line the console already draws, and the chip reads `EQ: Flat`.

**Rendering inside `ImageResponse`:** Satori supports a subset of SVG. Build the
card chrome (rounded card, grid lines, axis labels, chip) with divs, and the
curve as one `<img>` whose `src` is a `data:image/svg+xml;base64,…` string
containing the `<path>` from `eqCardPath` — this is the reliable path through
Satori and keeps the curve vector-crisp. If a plain inline `<svg><path/></svg>`
child renders correctly in the local build, that is acceptable too; verify by
eye, do not assume.

**Data source:** `libraryTracks()` → the track whose `renderKey` matches; use
`track.recipe.eq?.gains_db` (via `deriveRecipe`, which reads the sidecar's `fx`
block and keeps that block's snake_case field names) and `EQ_PRESET_LABELS` for
the chip. Unknown `renderKey` → 404. A track
that exists but has no recorded FX → the flat card.

---

## 5. Who gets the email, and how the send is triggered

The blocking gap today: **no render record names its requester.** `QueueJob`
(`web/lib/types.ts`) has no user field, and a dispatched run is identified only
by `display_title`. Fix that first; everything else depends on it.

### 5a. Record the requester

- Add `requestedBy?: string` to `QueueJob`.
- `submitQueueSelection` (`web/lib/queue-action.ts`) resolves the session email —
  reuse `resolveCurrentUser()` from `web/lib/me.ts`, and tolerate the
  no-auth-configured local case by leaving the field undefined — then:
  - **local:** pass it through `enqueue(...)` into the JSONL row.
  - **dispatch:** pass it to `dispatchRender(...)`, which sends it as a new
    `requested_by` workflow input.
- `.github/workflows/render.yml`: add the `requested_by` input (optional, default
  `''`). Do not put it in `run-name`; the run title is parsed back into
  `variantId` by `dispatchedQueue()` and must keep its current shape.

**Never fall back to "email the whole allowlist."** A render with no recorded
requester (someone dispatched the workflow by hand in the GitHub UI) sends no
email and logs one line saying so.

### 5b. One send path

Create `web/lib/render-notifications.ts`:

```ts
export type RenderNotification = {
  kind: "render-complete";
  requestedBy: string;
  renderKeys: string[];
  runId?: string;          // dispatch: Actions run id; local: queue job id
  finishedAt: string;
};
export async function notifyRenderComplete(notification: RenderNotification): Promise<"sent" | "skipped">;
```

It: validates the recipient with `isAllowedEmail` (`web/lib/allowlist.ts`);
checks the user's `renderEmails` flag (§7); claims an idempotency key (§5e);
resolves each `renderKey` through `libraryTracks()`; builds subject/HTML/text;
and sends through the new `web/lib/email.ts` helper. It returns `"skipped"` — it
never throws — for every one of: emails disabled, missing Resend config, missing
recipient, disallowed recipient, opted-out user, already-notified key, no
resolvable render keys.

Factor the raw Resend call out of `web/lib/auth.ts` into `web/lib/email.ts`:

```ts
export async function sendEmail(message: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }): Promise<void>;
```

and have `sendVerificationRequest` call it, so there is exactly one place that
knows the Resend endpoint, the `AUTH_RESEND_KEY` header and the `AUTH_EMAIL_FROM`
sender. Keep its current error behavior for auth (throw), and have
`notifyRenderComplete` catch.

### 5c. Local mode trigger

In `web/worker/queue-worker.ts`, after a job flips to `Done` and the jobs file is
written, call `notifyRenderComplete` with the job's `requestedBy`, the render key
the orchestrator produced, and `job.id` as the idempotency key. Wrap it so a mail
failure can never mark a successful render as failed — the status write happens
first, the notify is best-effort and only logs.

### 5d. Dispatch mode trigger

The console is serverless and cannot watch a run; the runner is the only thing
that knows the render finished. Add a final step to `render.yml`, after
**Publish to R2** (so the manifest the email reads from is already live):

```yaml
      - name: Notify the requester
        if: success() && inputs.requested_by != ''
        continue-on-error: true
        env:
          APP_URL: ${{ vars.NOISE_APP_URL }}
          NOTIFY_SECRET: ${{ secrets.NOISE_NOTIFY_SECRET }}
          REQUESTED_BY: ${{ inputs.requested_by }}
          RUN_ID: ${{ github.run_id }}
        run: .venv/bin/python scripts/notify_render.py out
```

`scripts/notify_render.py` (new, stdlib-only — it runs in the engine venv):
reads `out/manifest.json` for the masters produced by *this* run, POSTs
`{ kind, requestedBy, renderKeys, runId, finishedAt }` to
`${APP_URL}/api/renders/notify`, signs the body with
`X-Noise-Signature: sha256=<hmac-hex>` over the exact request bytes using
`NOISE_NOTIFY_SECRET`, and retries 3× with 2s/4s/8s backoff on 5xx or connection
errors. It exits 0 on any failure — an unsent email must never redden a green
render. Add `tests/test_notify_render.py` covering payload construction, the
signature, and the exit-0-on-failure contract.

`POST /api/renders/notify` (new route): constant-time-compare the HMAC over the
raw body before parsing; reject with 401 otherwise; reject bodies over 64 KB;
then call `notifyRenderComplete` and return `{ status: "sent" | "skipped" }` with
200. Unauthenticated at the middleware layer (the HMAC *is* the auth), so add it
to the bypass list (§8).

### 5e. Exactly once

Both triggers claim `render-notify:<runId>` in Upstash Redis (already a
dependency, `@upstash/redis`) with `SET … NX EX 2592000` (30 days). No claim → no
send. This makes the workflow's retries, an Actions re-run, and a worker restart
all safe.

### 5f. Manifest freshness

`artifactIndex()` caches the remote manifest for `NOISE_MANIFEST_TTL_MS`
(default 30s), so a notify arriving seconds after publish can miss the new
master. Export `invalidateArtifactCache()` from `web/lib/artifacts.ts` and call
it once at the top of `notifyRenderComplete` before resolving render keys. If a
key still does not resolve, skip that key (and skip the whole email when none
resolve) rather than sending a broken link.

---

## 6. Download links

`/api/bundle/*` is auth-guarded, and `/api/audio/*` is a permanent unauthenticated
URL keyed on a guessable filename. Neither is right for an email. Add
`web/lib/download-token.ts`:

```ts
export function signDownloadToken(filename: string, expiresAt: number): string;
export function verifyDownloadToken(token: string): { filename: string } | null;
```

`base64url(JSON.stringify({ f, e })) + "." + base64url(hmacSha256(payload, secret))`,
verified with `crypto.timingSafeEqual`, expiring 14 days out. Secret:
`NOISE_DOWNLOAD_SECRET`, falling back to `AUTH_SECRET`.

`GET /api/download/[token]` verifies, resolves through `audioAsset(filename)`,
then behaves exactly like `/api/audio/[filename]?download=1`: a 307 to
`artifactUrl(filename)` when `ARTIFACTS_ARE_REMOTE`, otherwise a
`Content-Disposition: attachment` stream from `RENDER_DIR`. Expired or tampered
token → 410 with a plain-text body pointing at the Library URL. Range support is
not required (a browser download of a redirect target gets it from R2 anyway).

The email's byte count comes from `track.sizeBytes`, formatted with the existing
`formatBytes` export in `web/lib/format.ts`.

---

## 7. Preferences and unsubscribe

- Extend the adapter user with `renderEmails?: boolean`. Default new users to
  `true` in `lazyAdapter()`'s `createUser` branch (`web/lib/auth.ts`), beside the
  existing `tutorialCompletedAt` / `tutorialVersion` defaults. Treat
  `undefined` as `true` for existing users — no backfill.
- `GET /api/notifications/unsubscribe?token=…` — token signed with the same
  helper as §6 over the email address, no expiry — sets `renderEmails: false`
  via `updateAuthUser` and returns a small styled HTML confirmation page with a
  link back to the console. It must be a **GET that a mail client can prefetch
  safely** in the sense that it is idempotent, and it must also accept `POST`
  for `List-Unsubscribe-Post`.
- Every render email carries `List-Unsubscribe: <url>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (Resend passes a
  `headers` object through), plus the visible footer link.
- `NOISE_RENDER_EMAILS=0` is a global kill switch checked first in
  `notifyRenderComplete`.

---

## 8. Middleware and env

`web/lib/middleware-access.ts` → `shouldBypassAuth` gains, and
`web/middleware.ts` → `config.matcher` excludes:

- `/api/og/` — mail clients fetch images without cookies.
- `/api/download/` — the signed token is the credential.
- `/api/renders/notify` — the HMAC is the credential.
- `/api/notifications/unsubscribe` — a person clicking from an inbox has no
  session.

Update `web/test/middleware.test.ts` for each. Nothing else may become public;
the matcher change must be additive and the existing cases must still pass.

New environment variables (document all of them in `web/README.md` beside the
existing auth block):

| Variable | Where | Purpose |
| --- | --- | --- |
| `NOISE_APP_URL` | Vercel + Actions repo variable | Absolute base for links and image URLs. Fall back to `AUTH_URL`, then `https://${VERCEL_URL}`. |
| `NOISE_NOTIFY_SECRET` | Vercel + Actions secret | HMAC key for the notify callback. |
| `NOISE_DOWNLOAD_SECRET` | Vercel | Download/unsubscribe token key; defaults to `AUTH_SECRET`. |
| `NOISE_RENDER_EMAILS` | Vercel | `0` disables all render emails. |

Reused as-is: `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `ALLOWED_EMAILS`, the Upstash
pair.

---

## 9. Files touched

New:

- `web/lib/email.ts` — the single Resend call.
- `web/lib/render-notifications.ts` — recipient resolution, gating, idempotency,
  send.
- `web/lib/render-email.ts` — subject/HTML/text builders, pure and testable.
- `web/lib/eq-card.ts` — shared curve geometry.
- `web/lib/download-token.ts` — sign/verify.
- `web/app/api/og/track/[renderKey]/route.tsx` — the PNG.
- `web/app/api/renders/notify/route.ts` — the callback.
- `web/app/api/download/[token]/route.ts` — the signed download.
- `web/app/api/notifications/unsubscribe/route.ts` — opt-out.
- `scripts/notify_render.py` — the workflow's caller.
- `web/test/render-email.test.ts`, `web/test/download-token.test.ts`,
  `web/test/eq-card.test.ts`, `tests/test_notify_render.py`.

Modified: `web/lib/types.ts`, `web/lib/queue.ts`, `web/lib/queue-action.ts`,
`web/lib/dispatch.ts`, `web/lib/artifacts.ts`, `web/lib/auth.ts`,
`web/lib/middleware-access.ts`, `web/middleware.ts`,
`web/worker/queue-worker.ts`, `web/app/noise-lab.tsx` (`drawEqCurve` delegates to
`eq-card.ts`), `web/test/middleware.test.ts`, `web/package.json` (test script),
`web/README.md`, `.github/workflows/render.yml`.

---

## 10. Tests

The repo runs `node --test` over an **explicit file list** in
`web/package.json`'s `test` script — every new test file must be added there or
CI will not run it. `.github/workflows/ci.yml` runs `npm run typecheck`,
`npm run lint`, `npm run check:tokens`, `npm test`, `npm run build`, plus
`pytest tests` for the engine; all must pass.

Unit coverage to write:

1. **Subject and body** — single-track subject uses the SEO title when present
   and the `renderKey` when not; batch subject pluralizes and counts; the facts
   line omits null facts; `QA flagged` copy appears for a `FAIL` verdict.
2. **CTAs** — the Library URL is `${APP_URL}/#library/<renderKey>` with the key
   percent-encoded (`serializeRoute` is the reference); the download URL carries
   a token that `verifyDownloadToken` accepts; batch mode emits no per-track
   download button.
3. **Images-off** — the plaintext alternative contains both URLs, and the HTML
   contains the FX summary as text as well as in `alt`.
4. **Gating** — `notifyRenderComplete` returns `"skipped"` and sends nothing for:
   no `requestedBy`, an address failing `isAllowedEmail`, `renderEmails: false`,
   `NOISE_RENDER_EMAILS=0`, an already-claimed idempotency key, and an
   unresolvable render key. Stub the Redis and Resend calls.
5. **Batch cap** — 8 render keys produce one email listing 3 tracks and
   `+5 more`.
6. **Download token** — round-trips; rejects a tampered payload, a tampered
   signature, and an expired token.
7. **EQ card geometry** — `eqCardPoints` maps `x=0 → 30 Hz` and `x=width →
   16 kHz`, a flat gain array yields a constant `y`, and the console's
   `drawEqCurve` consumes the same function.
8. **Middleware** — the four new paths bypass auth; a representative guarded path
   still redirects/401s.
9. **Python** — `tests/test_notify_render.py`: payload shape, HMAC over exact
   bytes, exit 0 when the endpoint is unreachable.

Manual verification, to be reported in the PR body with what was actually seen:

- `cd web && npm run dev`, then open
  `/api/og/track/<a rendered key>` and eyeball the card against the console's own
  Spectrum card for the same track — grid, curve, chip, axis labels.
- Add a dev-only `GET /api/renders/preview?renderKey=…` (auth-guarded, returns
  the HTML) and screenshot it at 375px wide.
- Send one real email to `austin@marlo.today` via a real `AUTH_RESEND_KEY` if
  credentials are available; otherwise say plainly that no live send was
  performed. Check the two CTAs, the footer, and rendering with images blocked.

---

## 11. Acceptance criteria

- [ ] A local-mode render queued by a signed-in user produces exactly one email
      to that user when the worker marks it `Done`.
- [ ] A dispatch-mode render produces exactly one email after **Publish to R2**,
      and re-running the workflow or retrying the callback produces none.
- [ ] The email's hero image renders the same response curve the console draws
      for that track, from shared code.
- [ ] `Open in Noise Lab` lands on the Library with that track's card open.
- [ ] `Download master` downloads the WAV in a browser with no Noise Lab session,
      and returns 410 after the token is edited.
- [ ] A render dispatched with no `requested_by` sends nothing and logs one line.
- [ ] A user who clicks `Stop these emails` receives no further render emails;
      the auth sign-in email is unaffected.
- [ ] A failed render sends nothing.
- [ ] A Resend outage, a missing `NOISE_APP_URL`, or an unreachable console
      leaves the render itself green and the artifacts published.
- [ ] `npm run typecheck`, `npm run lint`, `npm run check:tokens`, `npm test`,
      `npm run build`, and `pytest tests` all pass.

---

## 12. Rollout

1. Merge with `NOISE_RENDER_EMAILS` unset in production (emails on) but
   `NOISE_NOTIFY_SECRET` set only after the Vercel deploy is live — the workflow
   step no-ops without it.
2. First render after deploy: watch the Actions step's output and the Vercel
   function log for `sent` / `skipped` with a reason.
3. If anything misfires, set `NOISE_RENDER_EMAILS=0` in Vercel; renders keep
   working untouched.
