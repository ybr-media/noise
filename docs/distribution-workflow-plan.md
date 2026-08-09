# Naming, Artwork & Distribution Workflow — Plan

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-09
**Code grounding:** `web/lib/naming.ts`, `web/app/api/names/{generate,approve}/route.ts`, `web/lib/library.ts`, `web/lib/artifacts.ts`, `web/app/noise-lab.tsx` (TrackCard), `web/lib/dispatch.ts`, `scripts/publish_artifacts.py`, `config/dimensions.yaml`

---

## 1. Problem statement

The pipeline ends at "144 QA'd WAV masters in a bucket." The commercial goal — these tracks live on Spotify/Apple Music via a distributor like DistroKid — needs three more steps, and today each one is stubbed, missing, or blocked:

1. **Naming is stub-quality, one-at-a-time, and can't be approved where the founder works.** The `local-stub` provider has three formulaic title patterns drawn from two dimensions each, so the 144-variant matrix collapses onto a few dozen titles — collisions are guaranteed and nothing checks. The flow is buried per-card in the Library (tap a track → Suggest → review → approve), so naming the catalogue is 144 separate interactions with no view of what's named versus not. Worst: `POST /api/names/approve` returns **503 on any hosted deployment** (`ARTIFACTS_ARE_REMOTE`), because approval rewrites the sidecar next to the master — which only exists on a render host. The hosted console is the deployment the founder actually uses, so today *no name can be approved from it at all*.
2. **Artwork doesn't exist.** No code, config, or doc anywhere in the repo touches cover art, and every store requires it per release.
3. **There is no "release."** The console's only units are *variant* and *master*. DistroKid's unit is a **release** (single/EP/album) carrying artist, genre, date, artwork, and an ordered tracklist. 144 tracks are not 144 singles; someone has to group, order, and package them, and the console has no concept for any of that. DistroKid also has **no public upload API**, so any "Upload to DistroKid" button would be a lie — the honest product is a package that makes the manual upload a five-minute copy-paste instead of an hour of ad-hoc file wrangling.

**The core simplification: track ≠ release.** Per-track work (naming) stays in the Library. A new *Release* entity — the unit that owns artwork and distributor metadata — gets its own tab and an export package that mirrors the DistroKid form field-for-field.

### User stories

1. **Name the catalogue in one sitting, from anywhere.** As a founder on the hosted console, I want to batch-generate distinctive, non-colliding titles for every unnamed master and approve them from a single review list — with a visible "N of M named" counter — so naming 144 tracks is an evening's review, not 144 pilgrimages to a machine that renders.
2. **Artwork without a designer.** As a solo founder, I want each release to get deterministic generative cover art derived from the same dimensions that shaped the audio (color/band/motion), rendered at store resolution, so the catalogue looks like one coherent label — and I can regenerate or override any cover I dislike.
3. **From release to DistroKid in minutes.** As the person doing the upload, I want to assemble a release from named, QA-passing tracks and download one package — audio files named by final title, `cover.png`, and a metadata sheet ordered exactly like DistroKid's form — so the manual upload is transcription, not decisions.

---

## 2. Information architecture

### Library tab (extended, not redesigned)

- **Heading gains a naming coverage line:** "Masters · 144 · **97 named**" plus a filter chip row: `All / Unnamed (47) / Named`. The counter is the single answer to "how much naming work is left?"
- **TrackCard naming UI is unchanged** for one-off edits; the batch flow (§3a) is the new primary path.

### Releases tab (new, fourth tab)

Top-to-bottom, mirroring the Queue tab's status-first pattern:

1. **Release list** — each row: cover thumbnail, release title, type chip (Single/EP/Album), track count, and a readiness state: `Draft` → `Ready to export` → `Exported`. Readiness is computed, never hand-set (§3c).
2. **Release detail** (tap a row) — metadata form (artist, title, type, genre, date, songwriter, language), ordered tracklist with add/remove/reorder, artwork panel (preview + Regenerate + Upload override), and the **Export package** action with a pre-flight checklist.
3. **New release** — floating action; the only creation inputs are title + type, everything else defaults.

**Eligibility guard (the quality gate):** only tracks with `qaVerdict === "PASS"` **and** an approved title can be added to a release. The picker shows ineligible tracks greyed with the reason ("No approved name", "QA failed"), which turns the Library's naming counter into a to-do list with a purpose.

---

## 3. Solutions

### (a) Naming v2 — real provider, uniqueness, batch review, hosted approval

**Provider.** `SeoNameProvider` is already the swap-in point (per `web/README.md`). Add an LLM-backed provider (Anthropic API, env-gated by `NOISE_NAMING_API_KEY`; model `claude-sonnet-5`) that receives the variant's full dimension tuple and the list of **already-approved titles** so it can steer away from collisions at generation time. The `local-stub` remains the no-key fallback and the test fixture. The provider tag in the sidecar (`seo_provider`) records which one produced the approved name.

**Uniqueness is enforced at approval, not just generation.** `approveName()` (and its hosted equivalent) rejects a title that case-insensitively matches any other approved title in the catalogue, returning the colliding variant id so the UI can show "Taken by `green-mid-drift-…`". This is the invariant; provider-side steering is just an optimization to make rejection rare.

**Batch flow.** Library gains "Name unnamed (N)": generates suggestions for every rendered, unnamed master (server-side, sequential with progress), then presents a review list — one row per track: variant id, editable title, editable description, per-row Approve, and Approve-all-reviewed. Rows with collisions or provider failures are flagged inline, never silently skipped. This reuses the existing generate/approve endpoints; it's a UI loop, not new machinery.

**Hosted approval path — the architectural fix.** The read path already works remotely: `library.ts` merges `seo_title`/`seo_title_approved` from the sidecar, and the published manifest carries sidecars verbatim, so a hosted console *displays* names fine. Only the write is missing. Options considered:

- *Console writes to R2 directly* — rejected: R2 credentials deliberately live in Actions secrets, not Vercel (`web/README.md`), and we're not moving write credentials into the web tier for this.
- *Separate metadata service / KV overlay* — rejected: new infrastructure and a second source of truth diverging from the sidecar.
- **Chosen: dispatch a metadata workflow**, reusing the exact machinery the Queue tab already trusts. A new lightweight workflow (`metadata.yml`) accepts a JSON payload of `{filename, title, description}` approvals, patches the sidecars in R2, and re-merges `manifest.json` — the publisher's merge semantics already guarantee a metadata-only republish never hides earlier renders. In dispatch mode, `POST /api/names/approve` batches pending approvals and dispatches; the console returns 202 and shows "Approval publishing… (~1 min)", flipping to the approved badge when the manifest refresh (existing 30 s TTL) reflects it. Local mode keeps today's direct sidecar write. Unavailable mode keeps the 503, with copy that now says why and what to do.

The batch flow makes the ~1 min dispatch latency irrelevant: one dispatch carries a whole review session's approvals.

### (b) Artwork — generative, per-release, store-compliant

- **One cover per release, not per track.** DistroKid attaches artwork to the release; per-track art is not a distributor concept (non-goal).
- **Deterministic generation.** `web/lib/artwork.ts` renders an SVG from the release's contents — palette keyed by the dominant `color` dimension (white/green/pink/brown each get a fixed scheme), texture density from `band`, waveform-like distortion from `motion` — plus release title and artist name as the only text. Seeded by release id + a bump-able `artSeed`, so **Regenerate** is one tap and reproducible. Server-side SVG→PNG at **3000×3000 px, RGB** via `sharp` (the repo's first image dependency; confined to `web`).
- **Compliance is linted, not remembered.** A pre-export check validates what DistroKid's artwork guidelines enumerate: exact square dimensions ≥3000×3000, RGB, file size in bounds, and — for uploaded overrides — a hard confirm that the image contains no URLs, social handles, or pricing text (that rule can't be machine-checked, so it's an explicit checkbox, not silence).
- **Override.** Upload a custom image per release; it goes through the same lint. Generated art is the default so zero-effort remains possible.
- Storage follows the metadata path: local mode writes `cover_<releaseId>.png` into `RENDER_DIR`; dispatch mode generates in the metadata workflow and publishes to R2 next to the masters.

### (c) Releases and the DistroKid export package

- **Storage:** a single `releases.json` beside the masters (local: `RENDER_DIR`; hosted: R2 object, written by the same metadata workflow, read through the same fetch-with-TTL pattern as the manifest). Fields mirror the DistroKid form: artist name, release title, type, primary/secondary genre, release date, label, language, `explicit: false`, and per-track: ordered position, track title (frozen copy of the approved title at add-time, revalidated at export), songwriter legal name (one default for the whole catalogue, editable per release), `instrumental: true` (skips the lyrics requirement).
- **Readiness** is computed: `Ready to export` requires ≥1 track, every track still QA-PASS and title-approved, artwork passing lint, and all required form fields non-empty. The detail view shows the failing conditions as a checklist, not a disabled button with no explanation.
- **Export package** — one zip per release:
  - `01 <Track Title>.wav`, `02 …` — the masters, copied byte-for-byte (DistroKid accepts 48 kHz/24-bit stereo WAV; **no transcode step**, the QA'd master is the deliverable).
  - `cover.png` — the 3000×3000 artwork.
  - `metadata.csv` + `UPLOAD.md` — every DistroKid form field in the form's order, with per-track rows; `UPLOAD.md` is a human checklist ("paste artist → paste title → …") so the upload session needs zero judgement calls.
- **Assembly location:** a 15-track album is ~1 GB of WAV, which cannot be assembled in a serverless function. Local mode streams the zip from an API route. Dispatch mode reuses the metadata workflow: it assembles the zip on the runner, publishes it to R2, and the release row's Export action becomes a direct download link when the object appears. Same honest-async pattern as rendering itself.
- **Marking exported:** downloading the package sets `Exported` with a timestamp on the release; editing anything after that flips it back to `Ready to export` with an "edited since export" note — the state answers "is what's on DistroKid what's in the console?"

---

## 4. Non-goals / out of scope

- **Automating the DistroKid upload itself** — no public API exists; browser automation is fragile and against their terms. The export package *is* the integration.
- **Per-track artwork**, video/Canvas assets, or marketing material beyond the cover.
- **Changing the mastering target.** Masters are −20 LUFS / −3 dBTP by PRD design (sleep/focus content); whether that's right for streaming normalization is a mastering decision, flagged as an open question, not smuggled into this workflow. No transcoding, no re-render.
- **Lyrics, explicit flags, featured artists, royalty splits** — the catalogue is instrumental noise by a single artist; the form fields exist in `releases.json` only where DistroKid requires them.
- **Other distributors** (CD Baby, LANDR, …) — though the export package is deliberately distributor-agnostic CSV+assets, only the DistroKid form ordering is maintained.
- **Release scheduling/calendar, pre-save campaigns, analytics.**
- **Naming provider fine-tuning or A/B testing**; one good provider behind the existing interface.

---

## 5. Task breakdown for Devin (prioritized, dependency-ordered)

**T1. Naming coverage counts and title-uniqueness invariant**
Add named/unnamed counts to `GET /api/library` (derivable from existing `titleApproved`); enforce case-insensitive catalogue-wide title uniqueness in `approveName()`, returning the colliding variant id in the error; surface counter + `All/Unnamed/Named` filter chips in the Library heading.
*Files:* `web/lib/naming.ts`, `web/lib/library.ts`, `web/app/api/library/route.ts`, `web/app/noise-lab.tsx`, `web/lib/types.ts`.
*AC:* Approving a duplicate title fails with a message naming the holder; counts match `titleApproved` across the manifest; chips filter the rendered list; existing per-card naming flow unaffected.

**T2. LLM naming provider behind `SeoNameProvider`**
Add an Anthropic-backed provider selected when `NOISE_NAMING_API_KEY` is set, receiving the variant tuple and the approved-title list to steer away from collisions; `local-stub` remains fallback and test double; `seo_provider` records the actual source.
*Files:* `web/lib/naming.ts`, `web/app/api/names/generate/route.ts`, `web/test/web.test.ts`.
*AC:* With a key, suggestions vary across variants that the stub collides on; without a key, behavior is byte-identical to today; provider errors return a 502 with a retryable message, never a stub result silently pretending.

**T3. Batch naming review flow** *(depends on T1; better with T2)*
"Name unnamed (N)" action in the Library: sequential server-side generation with progress, review list with editable title/description per row, per-row Approve and Approve-all-reviewed, inline collision/failure flags.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* From a library with ≥3 unnamed rendered tracks, one session can approve all of them without leaving the view; a collision shows inline and does not block other rows; refresh mid-review loses nothing already approved.

**T4. Hosted metadata write path (`metadata.yml` dispatch)** *(depends on T1)*
New workflow accepting an approvals JSON payload; patches sidecars in R2 and re-merges `manifest.json` via the existing publisher merge; `POST /api/names/approve` in dispatch mode batches and dispatches, returning 202; console shows "publishing" state until the manifest TTL refresh reflects approval; local mode unchanged; unavailable mode 503 with explanatory copy.
*Files:* `.github/workflows/metadata.yml`, `scripts/publish_artifacts.py` (or a sibling patch script), `web/app/api/names/approve/route.ts`, `web/lib/dispatch.ts`, `web/app/noise-lab.tsx`.
*AC:* On a hosted console with dispatch configured, approving a name results — within one manifest TTL after the workflow completes — in the approved badge, with no local machine involved; a metadata-only publish leaves every existing master and QA record visible; uniqueness (T1) is enforced inside the workflow too, since the console's view may be stale.

**T5. Release entity and Releases tab** *(depends on T1)*
`releases.json` read/write (local dir / R2-via-T4-workflow), CRUD API, fourth tab with release list, detail form, ordered track picker enforcing the QA-PASS + approved-title eligibility guard (ineligible rows greyed with reason), computed readiness checklist.
*Files:* `web/lib/releases.ts` (new), `web/app/api/releases/route.ts` (new), `web/app/noise-lab.tsx`, `web/lib/types.ts`, `web/app/globals.css`.
*AC:* A release survives reload in both modes; an unnamed or QA-failing track cannot be added and shows why; readiness recomputes live as fields fill; track order is editable and persisted.

**T6. Generative artwork** *(depends on T5)*
`web/lib/artwork.ts`: seeded SVG from release contents (palette←color, density←band, distortion←motion, title+artist text only), server-side render to 3000×3000 RGB PNG via `sharp`; Regenerate bumps `artSeed`; upload override; compliance lint (dimensions/RGB/size + the manual no-promo-text confirm for uploads).
*Files:* `web/lib/artwork.ts` (new), `web/app/api/releases/artwork/route.ts` (new), `web/app/noise-lab.tsx`, `web/package.json`.
*AC:* Same release + seed always renders an identical PNG; two releases dominated by different colors are visually distinct at thumbnail size; lint blocks a non-square or sub-3000px override with a specific message; generated art passes its own lint.

**T7. Export package** *(depends on T5, T6)*
Zip assembly — ordered retitled WAVs (byte-identical copies), `cover.png`, `metadata.csv`, `UPLOAD.md` in DistroKid form order. Local: streaming zip route. Dispatch: assembled by the T4 workflow, published to R2, release row links the object when present. Export sets `Exported`; subsequent edits flip to "edited since export".
*Files:* `web/app/api/releases/export/route.ts` (new), `.github/workflows/metadata.yml`, `web/lib/releases.ts`, `web/app/noise-lab.tsx`.
*AC:* Extracted zip plays; WAV bytes match the masters; `metadata.csv` fields cover every required DistroKid form field with no empties for a Ready release; a release that lost eligibility (name un-approved, QA regressed) cannot export and says why.

**T8. Copy, a11y, and pre-flight polish**
Sweep the new surfaces: readiness checklist as a real list with per-item state, `aria-live` on batch-naming progress, ≥44 px targets, empty states for the Releases tab ("No releases yet — a release is what you upload to a distributor"), and consistent "honest async" copy for every dispatched write.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* No new axe violations; every async state (publishing approval, assembling export) has visible pending copy; nothing clipped at 320 px.

**Shipping order:** T1 → (T2, T3) → T4 → T5 → T6 → T7 → T8. T1–T3 ship value alone (better naming locally); T4 unblocks the hosted founder; T5–T7 are the release train.

---

## 6. Success metrics

- **Naming throughput:** the full 144-track catalogue nameable in ≤2 hours of review from the hosted console (today: impossible remotely; locally ~144 separate card interactions). Proxy: approvals per session in batch flow vs. per-card flow.
- **Zero title collisions** in approved metadata, enforced (count of uniqueness rejections is telemetry, not failure).
- **Release-to-form time:** from "release marked Ready" to "DistroKid form fully submitted" ≤30 minutes for a 15-track album, with **zero** fields requiring a decision not already in `metadata.csv`.
- **Package correctness:** 100% of exported packages accepted by the DistroKid form without edits — no artwork bounces (dimensions/format), no metadata bounces (missing songwriter, duplicate titles).
- **Coverage visibility:** the founder can answer, from one screenshot each of Library and Releases, "how much of the catalogue is named, what's grouped into releases, and what's actually live" — the three questions that today require a spreadsheet nobody has built.
- **Qualitative:** the first real release (pilot set, 8 tracks) goes from unnamed masters to a submitted DistroKid release in one sitting using only the console and the DistroKid website.

---

## Key implementation facts (verified in code)

- The stub's three title patterns draw on only `color`+`band` or `color`+`motion` (`web/lib/naming.ts:29-33`): 4 colors × 4 bands = at most 16 distinct candidate-0 titles across 144 variants — collisions guaranteed, and no code checks titles for uniqueness anywhere.
- Hosted approval is a hard 503: `web/app/api/names/approve/route.ts:8-10` gates on `ARTIFACTS_ARE_REMOTE` because `approveName()` rewrites the sidecar on local disk (`web/lib/naming.ts:42-55`).
- The **read** path already works remotely: sidecars travel inside `manifest.json` (`scripts/publish_artifacts.py:65-72`, `web/lib/artifacts.ts:95-103`) and `library.ts:62-64` merges `seo_title`/`seo_title_approved` from them — so hosted naming only lacks a write path.
- Only masters are nameable (`web/lib/naming.ts:48`); stems carry no name — release tracklists therefore reference masters only.
- The publisher merges with the bucket's existing manifest, so a partial or metadata-only publish never hides earlier renders (`README.md` "Publishing renders"; `scripts/publish_artifacts.py`).
- Dispatch machinery to reuse for hosted writes: `web/lib/dispatch.ts:29-31` (workflow-dispatch POST) and the run-mirroring pattern the Queue tab already uses.
- Masters are 48 kHz/24-bit stereo at −20 LUFS / −3 dBTP (`config/dimensions.yaml` `output:`), ~65 MB per 4-minute master — a 15-track export zip is ~1 GB and must be assembled off-serverless.
- No artwork, cover, release, or distributor concept exists in any source file today (repo-wide grep).
- Manifest reads are cached for 30 s (`web/lib/artifacts.ts:13`), which sets the floor on how quickly a dispatched approval can appear as a badge.
