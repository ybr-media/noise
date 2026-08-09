# Release & Distribution Workflow — Plan

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-09
**Code grounding:** `web/app/noise-lab.tsx` (Library / TrackCard), `web/lib/naming.ts`, `web/lib/library.ts`, `web/lib/artifacts.ts`, `web/app/api/names/approve/route.ts`, `web/app/api/names/generate/route.ts`, `web/lib/types.ts`

---

## 1. Problem statement

The Library is where the product currently ends: a QA-passed master offers "Download master" and "Suggest SEO name," and everything after that happens off-product. Getting one track onto Spotify via DistroKid today means: approve a name (which **fails with a 503 on the hosted console**, because approval writes sidecars and hosted artifacts are read-only — `api/names/approve/route.ts:8-10`), invent album artwork in some other tool, download the WAV, rename it by hand to match the approved title, walk through DistroKid's upload form from memory, and then remember — in your head — which of 144 variants actually went out. Naming is one-modal-per-track with a stub provider, so polishing even the 8-variant pilot set is eight rounds of tap-generate-review-approve; the full matrix is untenable. Nothing in the data model represents a *release*: no grouping, no artwork, no "uploaded" or "live" state, so the one question the Library should answer — *which of these masters are earning on streaming platforms?* — is unanswerable from the product.

One honest constraint shapes everything below: **DistroKid has no public API.** v1 is therefore *prepare-and-track*, not push-button publishing. The product's job is to make the manual DistroKid upload a five-minute copy-paste with zero decisions left in it, and to make the outcome visible in the Library afterward.

### User stories

1. **Name the catalog, not one track.** As the founder polishing masters from my phone, I want to review and approve titles for every unnamed QA-passed master in one sitting — suggestions pre-generated, editable inline, approvable in bulk — and I want approval to *work on the hosted console*, so naming 8 pilot tracks takes two minutes instead of eight modals and a laptop.
2. **Artwork without a designer.** As a one-person label, I want each release to get square, DistroKid-compliant cover art derived from the track's own parameters (color, band, seed) — generated in the console, previewed on the card, exported at 3000×3000 — so artwork is never the reason a finished master sits unreleased.
3. **Upload without guesswork, and never lose track.** As the person doing the DistroKid upload, I want a single "Export for DistroKid" bundle (correctly named WAVs, cover art, paste-ready metadata) and a way to mark the release *Uploaded* and later *Live* with its store link, so the Library shows exactly what's out, what's pending, and what's still unpolished.

---

## 2. Information architecture

**Core new concept: the Release.** A release groups 1–n QA-passed masters under a final tracklist, one cover artwork, and release-level metadata (release title, artist name, genre), and moves through an explicit lifecycle:

```
Draft → Ready → Uploaded → Live
```

- **Draft** — tracks selected; naming/artwork incomplete.
- **Ready** — every track named, artwork attached, metadata complete; the export bundle is available. Computed, not manually set.
- **Uploaded** — manually marked after the DistroKid upload, optionally storing the date.
- **Live** — manually marked when the stores list it, storing the store URL.

**No fourth tab.** Distribution is the Library's exit path, not a sibling destination. The Library gains a two-segment control under its heading — **Masters | Releases** — reusing the existing `mini-segmented` pattern from the Design tab:

1. **Masters segment** (current list, augmented): each card gains a compact **readiness pipeline** replacing today's scattered affordances — `QA ✓ → Named ✓ → In release → Live` — where the next incomplete step is the card's suggested action. A **Select** button in the panel heading enters multi-select mode (checkboxes on QA-PASS cards only), with a bottom bar action **New release (n)** / **Add to release**.
2. **Releases segment**: a list of release cards (artwork thumbnail, title, track count, lifecycle chip). Tapping opens the **release detail** view: orderable tracklist, metadata fields, artwork block, and one primary action that changes with the lifecycle — *Finish naming* (Draft, with unnamed tracks) → *Generate artwork* (Draft, no art) → *Export for DistroKid* (Ready) → *Mark uploaded* → *Mark live*. Exactly one primary action at a time: the release view is a checklist, not a dashboard.

The Library tab badge (rendered-master count) is unchanged; a release count chip appears inside the segment control, not the dock.

---

## 3. Solutions

### (a) Naming at scale — and making it work on the hosted console

**Storage decision (root cause fix):** approved names currently live only in render-side sidecars, which the hosted console cannot write (`ARTIFACTS_ARE_REMOTE` guard). Rather than teaching Vercel to write to R2 (the README deliberately keeps R2 credentials in GitHub Actions, not Vercel), introduce a small **console-owned metadata store** for everything the *console* authors — approved names, releases, artwork params, lifecycle status:

- **Local mode:** a `releases.json` beside the queue JSONL (same pattern as `NOISE_QUEUE_FILE`).
- **Hosted mode:** Vercel Blob (or KV) holding the same JSON document, keyed per deployment.
- `lib/releases.ts` exposes one interface over both; the mode guard mirrors `renderMode()` honesty — if no writable store is configured on a hosted deployment, the UI says so instead of 503ing after the fact.

Render-side sidecars remain the render's record; the console store *overlays* them (a console-approved title wins over a sidecar `seo_title` when both exist). The existing `approveName` sidecar path stays for local mode as a write-through.

**Batch naming flow:** a **Name tracks** sheet, reachable from a release in Draft or from the Masters segment. `POST /api/names/generate` gains a batch form (`variantIds: [...]`) returning one suggestion per track from the existing provider interface (`SeoNameProvider` is untouched; the stub stays the default and the OpenAI provider remains the documented swap-in point). The sheet lists each track with an editable title/description and per-row *Regenerate*; one **Approve all** commits the batch to the store. Titles must be unique within a release — duplicates are flagged inline before Approve all enables.

### (b) Derived artwork

Artwork is **generated, not authored** — consistent with the product's deterministic ethos. A `lib/artwork.ts` module renders cover art on a `<canvas>` from the release's lead variant parameters: the noise color maps to a palette, band edges to composition density, and the render seed drives a seeded generative texture (the `mulberry32` PRNG already in `noise-lab.tsx` moves to a shared util). Same seed, same art, forever — regenerating is a deliberate "reroll" that picks a new art seed and records it in the store.

- **Preview** at card size in the release view; **export** re-renders the identical draw at **3000×3000 px, square, RGB PNG** — DistroKid's recommended spec — via an offscreen canvas, downloaded as `cover.png`.
- Text on the artwork is limited to the release title and artist name (DistroKid rejects art with URLs, social handles, or promotional text; the generator simply has no such inputs).
- No AI image APIs in v1; the provider seam can follow the naming pattern later if wanted.

### (c) Release lifecycle, DistroKid export, and status tracking

- **Export for DistroKid** (Ready state): produces a zip via a server route — each master fetched from the artifact origin and renamed `NN Title.wav`, `cover.png` at 3000×3000, and `metadata.txt` with paste-ready fields in DistroKid's form order (artist, release title, per-track titles, genre, explicit=no, plus each track's measured LUFS/true-peak from QA as evidence it meets platform loudness expectations). The release view then shows a short ordered checklist mirroring the DistroKid upload form, so the manual upload is transcription, not decision-making.
- **Mark uploaded / Mark live:** two manual confirmations on the release view. *Mark live* asks for the store URL (Spotify/Apple link) and stores it; the release card and every member track's Library card gain a **Live** chip linking to it. Both marks are undoable (status can be stepped back) since they record an external fact the product cannot verify.
- **Library answers the money question:** the Masters segment header gains a one-line summary — `3 live · 2 uploaded · 4 ready · 135 unrendered` — the distribution funnel in one glance.

---

## 4. Non-goals / out of scope

- **DistroKid API integration or upload automation** — no public API exists; browser automation against their dashboard is brittle and ToS-hostile.
- **Other distributor integrations** (TuneCore, CD Baby, LANDR) — the export bundle is deliberately distributor-neutral; only the checklist copy is DistroKid-specific.
- **AI-generated artwork** (image-model providers); v1 art is deterministic canvas rendering only.
- **ISRC/UPC management** — DistroKid assigns these; we don't model them in v1.
- **Royalty, analytics, or stream-count tracking** post-release; *Live* plus a store link is the terminal state.
- **Rights/licensing workflow** (content ID opt-ins, cover-song licensing) — surfaced as one checklist line, not modeled.
- **Multi-artist or collaborator support**; a single configurable artist name is enough for one founder.
- **Design/Queue tab changes** beyond the shared PRNG util move.

---

## 5. Task breakdown for Devin (prioritized, dependency-ordered)

**T1. Console metadata store and release model**
Add `lib/releases.ts`: `Release` type (`id`, `title`, `artist`, `genre`, ordered `trackIds`, `artSeed`, `status: "draft" | "uploaded" | "live"` — *Ready is computed*, `uploadedAt?`, `storeUrl?`), plus per-track name overrides (`{ variantId, title, description, approvedAt }`). Backends: local JSON file beside the queue (env `NOISE_RELEASES_FILE`), Vercel Blob when `NOISE_RELEASES_BLOB` (or equivalent) is configured; a hosted deployment with neither is read-only and says so. CRUD API `GET/POST/PATCH /api/releases`. Extend `LibraryTrack` with `releaseId?`, `releaseStatus?`, resolved in `libraryTracks()` by overlaying the store on sidecar data.
*Files:* `web/lib/releases.ts` (new), `web/lib/types.ts`, `web/lib/library.ts`, `web/app/api/releases/route.ts` (new).
*AC:* Store round-trips in both modes; console-approved titles override sidecar `seo_title` in `/api/library`; hosted deployment without a configured store returns a structured `writable: false` rather than 503 on write attempts; existing UI renders unchanged (fields additive).

**T2. Hosted-safe naming: batch generate + store-backed approval** *(depends on T1)*
`POST /api/names/generate` accepts `{ variantIds: string[] }` (single-id form kept) and returns one suggestion each. `POST /api/names/approve` accepts a batch and writes to the release store; in local mode it also write-through updates sidecars via the existing `approveName`. Remove the blanket `ARTIFACTS_ARE_REMOTE` 503. Build the **Name tracks** sheet: editable rows, per-row Regenerate, duplicate-title inline flag, single **Approve all**.
*Files:* `web/app/api/names/generate/route.ts`, `web/app/api/names/approve/route.ts`, `web/lib/naming.ts`, `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* On a hosted deployment with a configured store, approving names succeeds and survives reload; batch of 8 approves in one request; duplicate titles within the batch block Approve all with an inline message; local mode still writes sidecars.

**T3. Library IA: Masters | Releases segments, select mode, readiness pipeline** *(depends on T1)*
Add the segment control to the Library panel; Masters cards get the readiness pipeline row (`QA ✓ → Named → In release → Live`, next incomplete step highlighted) replacing the standalone "Suggest SEO name" placement; Select mode with checkboxes on QA-PASS cards and a bottom action bar (**New release (n)** / **Add to release**); Releases segment lists release cards with artwork thumb, title, count, lifecycle chip. Funnel summary line in the Masters header.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* At 390 px, segments switch without layout shift; select mode cannot include FAIL/UNAVAILABLE tracks; creating a release from 2 selected tracks lands in its detail view; the funnel line matches store + QA state; a11y: segments are `radiogroup`, checkboxes labeled, action bar ≥44 px targets.

**T4. Deterministic artwork generator** *(depends on T1; parallel with T3)*
Extract `mulberry32` into `web/lib/random.ts`; add `web/lib/artwork.ts` drawing seeded cover art from `{ color, bandLowHz, bandHighHz, artSeed, releaseTitle, artist }` onto any canvas size. Release view artwork block: preview, **Reroll** (new `artSeed`, persisted), **Download cover.png** exporting 3000×3000 RGB PNG from an offscreen canvas.
*Files:* `web/lib/random.ts` (new), `web/lib/artwork.ts` (new), `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* Same inputs render pixel-identical art across sessions; export is exactly 3000×3000 PNG; preview and export are visually identical composition; no text beyond title/artist appears; Design-tab preview still works after the PRNG move.

**T5. Release detail view and lifecycle** *(depends on T1, T3)*
Release detail: metadata fields (title, artist, genre) editing the store; orderable tracklist (up/down controls suffice on mobile); computed **Ready** badge when all tracks named + artwork + metadata complete; single context-dependent primary action (*Finish naming* → *Generate artwork* → *Export for DistroKid* → *Mark uploaded* → *Mark live*); *Mark live* prompts for store URL; both marks reversible; Live chip on member tracks' Library cards linking to the store URL.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`, `web/app/api/releases/route.ts`.
*AC:* Ready flips automatically as prerequisites complete, never manually; exactly one primary action visible per state; status can step backward; reload preserves order, status, and URL; Live chips appear on the right Masters cards.

**T6. DistroKid export bundle** *(depends on T2, T4, T5)*
`GET /api/releases/[id]/export`: server-side zip streaming each member master from its artifact origin (`artifactUrl`) renamed `NN Title.wav` (filesystem-safe title sanitization), `cover.png` rendered at 3000×3000 (client-generated and uploaded to the store on Reroll/first render, so the server route stays canvas-free), and `metadata.txt` in DistroKid form order including per-track measured LUFS/true-peak from QA. Release view gains the post-export DistroKid upload checklist.
*Files:* `web/app/api/releases/[id]/export/route.ts` (new), `web/lib/releases.ts`, `web/app/noise-lab.tsx`.
*AC:* Bundle for a 2-track release contains 2 correctly named WAVs byte-identical to the masters, one 3000×3000 PNG, and metadata.txt whose field order matches the checklist; export is only offered in Ready state; works against both local-disk and R2 artifact origins.

**T7. Copy and a11y pass**
Sweep the new surfaces: lifecycle chips announced (`aria-live` on status changes), pipeline steps readable by screen reader as a list with states, empty states ("No releases yet — select QA-passed masters to start one"), checklist links `target="_blank" rel="noopener"`, no clipped text at 320 px.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* No new axe violations; every interactive element labeled; 320 px clean.

**Shipping order:** T1 → T2 → (T3, T4 in parallel) → T5 → T6 → T7. T2 alone already fixes the hosted-naming 503 and is independently shippable after T1.

---

## 6. Success metrics

- **Naming throughput:** all 8 pilot masters named and approved from the hosted console in one session, ≤2 minutes, zero 503s (baseline: impossible today — approval requires the local host).
- **Time-to-upload-ready:** from "QA PASS" to a downloadable DistroKid bundle in ≤5 minutes for a single-track release, with zero tools outside the console (baseline: unmeasured, spans ≥3 tools).
- **Bundle correctness:** 100 % of exported bundles pass DistroKid's upload validation (square 3000×3000 art, valid WAVs, no rejected artwork text) with no re-exports.
- **Catalog visibility:** the founder can answer "what's live, what's uploaded, what's ready, what's unpolished?" from one Library screenshot — the funnel summary line plus lifecycle chips; zero spreadsheet or memory dependence.
- **Qualitative:** re-run the feedback session after ship; "I don't know what happens after Download master" and "naming doesn't work on my phone" should both be closed.

---

## Key implementation facts (verified in code)

- Name approval hard-fails on hosted deployments: `web/app/api/names/approve/route.ts:8-10` returns 503 whenever `ARTIFACTS_ARE_REMOTE`, and `approveName` writes only render-side sidecars (`web/lib/naming.ts:42-55`) — the hosted console (the deployment actually used, per `NOISE_ARTIFACTS_BASE_URL` reading from R2) has no writable metadata path at all.
- Naming UI is one-track-at-a-time: suggestion state lives inside each `TrackCard` (`web/app/noise-lab.tsx:410-450`); there is no batch path in UI or API (`generate/route.ts` takes a single `variantId`).
- `SeoNameProvider` (`web/lib/naming.ts:13-15`) is the documented provider seam; batch generation can wrap it without touching the stub or the future OpenAI swap-in.
- `LibraryTrack` (`web/lib/types.ts:49-63`) has QA and title fields but no release, artwork, or distribution-status concept; `libraryTracks()` (`web/lib/library.ts:41-67`) is the single overlay point where store data can join sidecar data.
- Artifacts on hosted deployments are read via a public manifest and are read-only from the console; R2 write credentials deliberately live in GitHub Actions, not Vercel (`web/lib/artifacts.ts:6-10`, `web/README.md`).
- `mulberry32` seeded PRNG already exists client-side (`web/app/noise-lab.tsx:137-145`) and can be shared with an artwork renderer for deterministic output.
- The `mini-segmented` control pattern and Library card conventions already exist, so the Masters | Releases split and pipeline row need no new design primitives (`web/app/noise-lab.tsx:47-63`, `globals.css`).
