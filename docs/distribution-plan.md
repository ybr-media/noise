# Distribution Workflow — Plan

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-09
**Code grounding:** `web/app/noise-lab.tsx` (TrackCard, tab dock), `web/lib/naming.ts`, `web/app/api/names/*`, `web/lib/artifacts.ts`, `web/lib/library.ts`, `web/lib/dispatch.ts`, `scripts/publish_artifacts.py`, `config/dimensions.yaml`, `.github/workflows/render.yml`

---

## 1. Problem statement

The pipeline ends at "master ready in the Library," but the product goal is tracks *live on streaming services* via a distributor like DistroKid. Between those two points sits everything a store release actually needs — polished titles, cover art, and release-level metadata (artist, album, genre, release date) — and today the console has almost none of it:

- **Naming exists but doesn't scale and doesn't save.** The only naming surface is a per-track "Suggest SEO name" button on each Library card (`noise-lab.tsx:550`) — naming the matrix is 144 separate generate-review-approve loops. Worse, approval is disabled exactly where the founder works: on a hosted deployment, `POST /api/names/approve` returns 503 because the sidecar lives next to the master on the render host (`approve/route.ts:8-10`). The phone console can *generate* names all day and can never keep one.
- **The stub names collide.** The stub provider's title options use only color+band or color+motion (`naming.ts:29-33`), so "White Noise for low-mid Focus" is shared by 9 variants (3 motions × 3 balances) and the motion-based option by 12. Stores reject duplicate titles within a release; the current generator produces them by construction.
- **There is no release concept.** The unit everywhere is the variant. DistroKid's unit is the *release* (single/EP/album) with one artwork, one artist name, one genre, one date, and an ordered tracklist. Nothing in the repo models any of that — grep for artist/album/artwork/genre finds nothing.
- **There is no artwork.** DistroKid requires square art (3000×3000 recommended, RGB JPG/PNG, no URLs/social handles/logos, nothing blurry). Nothing generates or stores it.
- **The last mile is untracked manual work.** DistroKid has no public upload API, so uploading is a web-form session. Today that session means re-deriving every field by hand from sidecars and YAML — and nothing records which tracks have shipped.

### User stories

1. **Release, not 144 chores.** As the founder, I want to group rendered masters into a release and work at that level — name the batch, make one cover, set the metadata once — so shipping an album is one sitting, not 36 repetitions of a per-track flow.
2. **Name from my phone, keep the names.** As a user reviewing generated titles on the hosted console, I want batch suggestions I can edit and approve — with duplicates and keyword-stuffing caught before approval — and I want the approval to actually persist, not 503.
3. **Hand me the upload, don't pretend to do it.** As the person filling in DistroKid's forms, I want a checklist screen that mirrors the form field-by-field — copy buttons for every text field, download buttons for the WAVs and the art — so the upload session is paste-paste-paste, zero typing and zero tab-hunting. And when I'm done, let me mark the release submitted so the console knows what's live.

---

## 2. The core simplification: the Release

One new concept absorbs all the messiness: a **Release** — an ordered group of variants plus store metadata, stored as a single `releases.json` document beside `manifest.json` (the exact pattern the artifact manifest already uses: one JSON document, merged on publish, read by the hosted console — `publish_artifacts.py`, `artifacts.ts:86-107`).

```jsonc
// releases.json (bucket- or RENDER_DIR-resident, single document)
{
  "releases": [{
    "id": "pilot-ep",
    "type": "ep",                          // single | ep | album
    "artist": "…",                          // one artist name, set once, reused
    "title": "…",
    "genre": "New Age",
    "secondaryGenre": "Ambient",
    "releaseDate": "2026-09-01",
    "artSeed": 937592149,                   // art is re-rendered from this, never stored
    "tracks": [                             // ordered; matrixIndex order by default
      { "variantId": "…", "title": "…", "description": "…", "approvedAt": "…" }
    ],
    "submitted": { "at": null, "storeUrl": null }
  }]
}
```

Decisions baked into that shape, with rationale:

- **`releases.json` is the source of truth for store metadata.** The per-track sidecar `seo_*` fields (`naming.ts:49-53`) become a read-only fallback for the Library card; new approvals write the release document only. Two write paths to two places was the messiness — this collapses it to one.
- **Artwork is a seed, not a file.** Every render in this repo is deterministic from seeds (`config/variants.yaml`); art follows the same ethos. The release stores `artSeed`; the client re-renders the identical 3000×3000 PNG from it on demand. No binary write path, no art hosting, "regenerate" is just a new seed.
- **Grouping is data-driven, like everything else.** Presets derived from `dimensions.yaml`: the **pilot EP** (the 8 pilot variants — the v1 milestone) and **one album per color** (4 × 36) for the full matrix. Custom grouping is a later concern.
- **A release has a visible state ladder:** `Draft → Named → Art ready → Ready to upload → Submitted`. Each state is *derived* (all tracks titled and unique → Named; artSeed chosen → Art ready; all masters rendered + QA PASS → Ready), except Submitted, which is the one manual fact only the human knows.

---

## 3. Information architecture

A fourth dock tab, **Releases**, after Library (`noise-lab.tsx:479` currently maps `design | queue | library`; four tabs still fit a 390 px dock). Hash routing follows the existing `#library/<variantId>` pattern: `#releases/<releaseId>`.

**Releases tab (list):** one card per release — title (or "Untitled EP"), track count, and the state ladder as a compact checklist (`✓ Named · ✓ Art · 2 tracks not rendered`). The blocking item is always stated, never just a status word — same principle as the Queue redesign's "no bare status" rule. An empty state offers the presets: "Start with the pilot EP (8 tracks)".

**Release detail (three stacked sections, mobile-first):**

1. **Metadata** — artist, title, genre, secondary genre, release date. Artist defaults from the previous release: it's set once ever, not per release.
2. **Tracklist** — the batch-naming table (§4a). One row per track: position, variant id, editable title, status chip (rendered/QA from the existing library index). Row problems (duplicate title, style-lint hit, missing render) surface inline.
3. **Cover art** — live preview of the seeded art (§4b), Regenerate, Download PNG.

A sticky footer action reflects the ladder: "Generate names" → "Approve names" → "Prepare for DistroKid" (§4c).

---

## 4. Solutions

### (a) Batch naming that persists

- **Generate-all:** one action calls the name provider for every track in the release. The provider interface already exists and takes a candidate index (`SeoNameProvider`, `naming.ts:13-15`) — batch is a loop over it, with each row individually editable and regenerable, exactly like today's single-card review box but ×N in a table.
- **Uniqueness by construction:** the generate call passes sibling titles already chosen in the release, and validation blocks approval while any two rows collide. This turns the stub's collision problem (§1) from a landmine into a lint error.
- **Style lint, not vibes:** a small pure function flags what stores actually reject — duplicate titles in the release, keyword chains ("for Sleep Focus Calm Study ASMR"), ALL CAPS, emoji, URLs/social handles, leading/trailing whitespace. Warnings show inline; hard rules block Approve.
- **Provider upgrade (parallel, optional):** a real LLM provider (Claude API, server-side, env-gated `NOISE_NAMING_API_KEY`) drops in behind the existing interface; the stub remains the zero-config fallback and the test double. The stub's prompt string (`naming.ts:24-25`) already describes the job — it becomes the actual prompt.
- **Approve-all** writes the release document via the mode-appropriate write path (§4d) — from the phone included. The per-track 503 dead end is retired.

### (b) Cover art: seeded, compliant by construction

A pure client-side canvas renderer, `renderCoverArt(release, seed) → 3000×3000 PNG`:

- **Palette from the color dimension** (the release's dominant color for a per-color album; a neutral blend for mixed releases), **composition from band/motion** — the art literally depicts the release's spectral character, consistent with the console's existing visual language.
- **Deterministic from `artSeed`** — same seed, same pixels, forever re-downloadable. Regenerate = new seed into the release doc.
- **Compliant by construction:** always 3000×3000 RGB PNG; rendered text is only the release title + artist (matching metadata exactly, per store rules) and can be toggled off; no URLs, handles, or logos are *possible* because the renderer has no way to draw them. Compliance is a property of the generator, not a review step.
- No new server dependencies: canvas runs in the browser; Download is `canvas.toBlob`.

### (c) The DistroKid handoff: checklist, not fake integration

DistroKid has no public upload API, and this console "never accepts work it cannot run" (`web/README.md`). So the last mile is an honest **Prepare for DistroKid** screen that makes the manual session mechanical:

- **Field-by-field, in DistroKid's form order:** artist name, release title, number of songs, genre + secondary, release date — each with a copy button. Then one row per track in release order: title (copy), songwriter (copy — stores require a legal name; captured once in release metadata), and the fixed answers stated plainly ("Not explicit · Instrumental · No radio edit"), plus **Download WAV** using the existing per-master download route.
- **Art:** the Download PNG button, restated with the spec it already meets.
- **Format note, honest and specific:** masters are 48 kHz/24-bit WAV at −20 LUFS / −3 dBTP (`config/dimensions.yaml` `output:`) — DistroKid accepts them as-is; no transcode step exists because none is needed.
- **Mark submitted:** a manual confirm that stamps `submitted.at` and stores the DistroKid/Spotify URL — the one state transition that can't be derived. The release card then reads "Submitted · open in store."

### (d) Where release metadata writes go (per mode, same trichotomy as rendering)

- **Local:** `POST /api/releases` writes `releases.json` in `RENDER_DIR`; `publish_artifacts.py` uploads and merges it alongside `manifest.json` (documents merge by release `id`, same never-hide-earlier rule as artifact merging).
- **Dispatch (the hosted phone console):** the console already owns a side-effect channel for work it can't perform itself — workflow dispatch (`dispatch.ts`, `render.yml`). A new lightweight `metadata.yml` workflow accepts the release document as a payload input, validates it, merges with the bucket's `releases.json`, and publishes using the R2 secrets the render workflow already holds. Seconds, not minutes; the UI treats it as save-with-a-lag and refreshes through the existing manifest TTL. Payload stays well under workflow-dispatch input limits at per-release granularity (a 36-track album is ~15 KB of JSON).
- **Unavailable:** read-only, 503 with the established copy pattern ("Releases are edited where a writer is configured…").

---

## 5. Non-goals / out of scope

- **DistroKid API integration or browser automation** of their forms — no public API exists, and automating their web forms is brittle and ToS-hostile. The checklist is the product.
- **Uploading audio/art from the console to DistroKid** — files download locally; DistroKid's uploader takes it from there.
- **ISRC/UPC management, royalties, analytics, store dashboards** — DistroKid assigns codes; reporting stays theirs.
- **Transcoding/re-mastering** — 48/24 WAV uploads as-is; stores transcode downstream.
- **Custom/drag-reorder track grouping** — v1 releases come from presets (pilot EP, per-color albums) in matrixIndex order.
- **Per-store metadata variants, localization, multiple artists/collaborators.**
- **Distributing stems** — a release is masters only, consistent with "only the master is playable, QA'd, and nameable."
- **Scheduling/pre-save campaigns** — releaseDate is a metadata field, not a marketing engine.

---

## 6. Task breakdown for Devin (prioritized, dependency-ordered)

**T1. Release model, `releases.json` read path, and presets**
Add `Release`/`ReleaseTrack` types; `web/lib/releases.ts` with `loadReleases()` (local: read `RENDER_DIR/releases.json`; remote: fetch beside the manifest with the same TTL cache), derived state ladder (`Draft/Named/ArtReady/Ready/Submitted`) computed against the library index, and preset builders `pilotRelease()` / `colorAlbum(color)` from existing config loaders. `GET /api/releases` returns releases + derived states.
*Files:* `web/lib/types.ts`, `web/lib/releases.ts`, `web/app/api/releases/route.ts`.
*AC:* With no document present, GET returns presets as unsaved suggestions; with a document, states derive correctly (all-unique-titles → Named; artSeed → ArtReady; all tracks rendered+PASS → Ready); remote mode never touches `fs`.

**T2. Releases tab IA** *(depends on T1)*
Fourth dock tab with `#releases/<id>` hash routing (mirror the `#library/<variantId>` handler); release-list cards showing the checklist ladder with the current blocking item spelled out; release detail with Metadata / Tracklist / Cover art sections and the sticky ladder-driven footer action. Artist field defaults from the most recent release.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* On 390 px, list cards state the blocker in words ("2 tracks not rendered"), never a bare status; cold-loading `#releases/pilot-ep` lands on the detail view; back returns to the list; existing three tabs unaffected.

**T3. Batch naming table with uniqueness and style lint** *(depends on T2)*
Tracklist rows with editable titles; "Generate names" loops the existing provider passing sibling titles; per-row Regenerate; `web/lib/name-lint.ts` pure validator (duplicate-in-release, keyword chains, caps/emoji/URLs/handles, whitespace) with inline messages; Approve-all disabled while hard rules fail; approval POSTs the whole release document.
*Files:* `web/app/noise-lab.tsx`, `web/lib/name-lint.ts`, `web/lib/naming.ts` (signature gains optional `siblingTitles`), `web/app/api/names/generate/route.ts`.
*AC:* Generating a full pilot EP yields 8 distinct titles; forcing two rows identical blocks Approve with the duplicate named; lint unit-tested as a pure function; single-track flow on the Library card still works.

**T4. Release write path per mode** *(depends on T1; unblocks T3's approve)*
`POST /api/releases`: local mode writes `RENDER_DIR/releases.json` (merge by release id, atomic write); dispatch mode dispatches new `metadata.yml` (validate payload → merge bucket `releases.json` → publish via existing R2 secrets); unavailable returns 503 with copy matching the naming route's pattern. Extend `publish_artifacts.py` to upload/merge `releases.json` when present. Library card title resolution: release doc first, sidecar `seo_*` fallback.
*Files:* `web/app/api/releases/route.ts`, `web/lib/dispatch.ts`, `.github/workflows/metadata.yml`, `scripts/publish_artifacts.py`, `web/lib/library.ts`.
*AC:* Local approve survives process restart and republish never drops releases absent from the current payload; dispatch approve results in an updated bucket document within one manifest TTL; sidecar-only titles still display; unavailable mode never dispatches.

**T5. Seeded cover-art generator** *(depends on T2; parallel with T3/T4)*
`web/lib/cover-art.ts`: deterministic canvas renderer keyed on `(release, artSeed)` — palette from the release's color dimension, composition from band/motion distribution, optional title+artist text (exact-match metadata), always 3000×3000 RGB. Detail-view preview (downscaled canvas), Regenerate (new seed into the unsaved doc), Download PNG via `toBlob`.
*Files:* `web/lib/cover-art.ts`, `web/app/noise-lab.tsx`.
*AC:* Same seed renders pixel-identical output across sessions; downloaded file is 3000×3000 PNG; regenerate changes seed and preview together; no network requests or new dependencies; text toggle off produces pure abstract art.

**T6. Prepare-for-DistroKid handoff screen** *(depends on T3, T4, T5)*
Per-release screen mirroring DistroKid's form order: copy buttons for artist/title/genres/date/songwriter and each track title; per-track Download WAV (existing route); art Download; the fixed-answers line and the 48/24 format note; **Mark submitted** confirm capturing the store URL, stamping `submitted` via the T4 write path.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* Every text field DistroKid asks for has a one-tap copy source — a complete upload session requires zero typing of release/track metadata; Mark submitted flips the release card to "Submitted · open in store" with a working link; screen is reachable only from Ready state.

**T7. Copy and a11y pass**
Sweep the new tab: ladder announced via `aria-live` on state change, copy buttons confirm via toast + `aria-live`, all targets ≥44 px, table rows labeled for screen readers, empty states for each ladder stage ("No names yet — Generate names below").
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* No new axe violations; every copy/download control reachable and labeled; no clipped text at 320 px.

**Shipping order:** T1 → T2 → (T3, T5 in parallel) → T4 → T6 → T7. The optional Claude-backed name provider slots in behind the T3 interface any time after T3 with no UI change.

**v1 milestone:** the **pilot EP** (8 tracks) walked through the whole ladder — named, art'd, exported, submitted — before any per-color album is attempted.

---

## 7. Success metrics

- **Time to first release:** pilot EP from "masters rendered" to "Ready to upload" in one phone sitting (≤30 min); the DistroKid form session itself requires zero typed metadata — every field pasted or downloaded. Proxy: copy-button usage on the handoff screen vs. abandonments.
- **Naming throughput and integrity:** a 36-track album named in ≤15 min via batch generate + spot edits (vs. 144 individual card loops today); **zero duplicate titles within any release**, enforced at approve time — currently the stub guarantees collisions (9-way and 12-way).
- **Hosted approval works:** approvals from the dispatch-mode console succeed; today 100 % of them 503. Target: 0 dead ends.
- **Art compliance by construction:** every generated cover is 3000×3000 RGB with no URLs/handles/logos — DistroKid art rejections from this pipeline: zero.
- **State honesty:** the Releases tab answers, from one screenshot, what is live, what is ready to upload, and exactly what blocks everything else — the same one-glance bar the Queue redesign set.

---

## Key implementation facts (verified in code)

- Naming is per-track only — one "Suggest SEO name" button per Library card (`web/app/noise-lab.tsx:550`); no batch surface exists.
- Hosted approval is a dead end by design: `ARTIFACTS_ARE_REMOTE` → 503 (`web/app/api/names/approve/route.ts:8-10`); the sidecar write happens in `approveName` (`web/lib/naming.ts:42-55`).
- The stub's title options key on color+band or color+motion only (`web/lib/naming.ts:29-33`), so titles repeat across the balance and motion dimensions (9- and 12-way collisions across the 144-variant matrix).
- `SeoNameProvider` is already an interface with the stub as one implementation (`web/lib/naming.ts:13-15`) — a real provider is a drop-in.
- The single-document-merged-on-publish pattern exists end to end: `manifest.json` built and merged in `scripts/publish_artifacts.py`, TTL-cached remote read in `web/lib/artifacts.ts:86-107`. `releases.json` copies it.
- The hosted console's only side-effect channel is workflow dispatch (`web/lib/dispatch.ts`, `.github/workflows/render.yml`), which already holds the R2 secrets a metadata-publish workflow needs.
- Masters are 48 kHz/24-bit stereo WAV, −20 LUFS target, −3 dBTP ceiling (`config/dimensions.yaml` `output:`); DistroKid accepts WAV at this resolution directly.
- Tab state and hash routing precedent: `design | queue | library` union and `#library/<variantId>` handling (`web/app/noise-lab.tsx:269,479`).
- No artist, album, genre, artwork, or release-date concept exists anywhere in the repo (verified by grep).
- Everything renderable in this repo is already seeded and deterministic (`config/variants.yaml` `seeds:`), which the art generator extends to pixels.
