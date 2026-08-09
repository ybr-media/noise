# Music Distribution Workflow — Plan

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-09
**Code grounding:** `web/lib/naming.ts`, `web/app/api/names/*`, `web/lib/library.ts`, `web/lib/artifacts.ts`, `scripts/publish_artifacts.py`, `config/dimensions.yaml`, `config/variants.yaml`, `web/app/noise-lab.tsx` (Library tab)

---

## 1. Problem statement

The engine can render 144 QA'd masters, but nothing between "master in the bucket" and "track live on Spotify" exists as a workflow. Three gaps, in order of messiness:

1. **Names are machine IDs.** Tracks are titled `wn_pink_mid_drift_balanced`. A naming flow exists in the Library tab (generate → edit → approve), but the generator is a local stub emitting template strings, and approval writes `seo_title` into a sidecar on the **local render disk** — the hosted console reads sidecars baked into the R2 `manifest.json` at publish time, so an approved name never reaches the catalog a listener-facing tool would read, and approving from the hosted console can't work at all (there is no local sidecar file there).
2. **No release concept.** Distribution platforms deal in *releases* (album/EP/single: artist, title, genre, ordered tracklist, one cover). The repo deals only in variants. Without a release entity there is nothing to name an album after, nothing to attach artwork to, and nothing whose status ("submitted", "live") can be tracked. The tempting default — 144 singles — is also the wrong product: it's 144 manual uploads, 144 covers, and a catalog that reads as spam to both listeners and store review.
3. **No artwork, and no path to upload.** Nothing in the repo produces cover art, and DistroKid has no public upload API — the last mile is a human filling in a web form. Any plan pretending otherwise (scraping, browser automation against their ToS) is fragile and gets accounts banned. The honest goal is to make the human's ten minutes at the form require **zero thinking and zero retyping**.

**The simplification:** the matrix is a *palette*, not a tracklist. Ship a small number of curated releases assembled from QA-passed variants, and make the console produce a complete, copy-paste-ready **release kit** for each one.

### User stories

1. **Catalog that reads like music.** As a founder, I want machine IDs turned into listener-facing track and album titles that I approve once and that persist everywhere (console, manifest, export), so the catalog never leaks `wn_*` strings to a listener.
2. **Artwork without a designer.** As a one-person label, I want each release's cover generated from the release's own parameters (color → palette, motion → texture) at DistroKid's required resolution, so every cover is consistent, compliant, and free.
3. **Upload as copy-paste.** As the person doing the uploads, I want a downloadable kit per release — correctly named WAVs in track order, a 3000×3000 cover, and a metadata sheet that mirrors DistroKid's form fields top to bottom — so submitting an album takes ten minutes and zero re-derivation.
4. **Know what's live.** As the founder, I want a Releases view showing each release's readiness (tracks rendered? names approved? art approved?) and its lifecycle (Draft → Ready → Submitted → Live, with the store link pasted back), so "what's the state of the catalog?" is one glance, not a spreadsheet.

---

## 2. Information architecture

### The release entity (new, and the keystone)

A release is data, in the same spirit as `dimensions.yaml` — `config/releases.yaml`:

```yaml
artist: "<artist name, set once>"
releases:
  - id: pilot-ep
    title: "Pink Noise Sessions"        # working title, editable in console
    genre: "Ambient"                     # DistroKid requires one
    tracks:                              # ordered variant ids
      - wn_pink_mid_drift_balanced
      - wn_pink_low-mid_drift_balanced
      - ...
    art:                                 # inputs to the artwork generator
      palette: pink
      texture: drift
    status: draft                        # draft | ready | submitted | live
    store_links: {}                      # pasted back after upload
```

**v1 catalog: one pilot EP (the 8 pilot variants), then four color albums** (white/pink/brown/green, 9–12 tracks each drawn from QA-PASS variants). Five releases total covers the strongest cross-section of the matrix; the remaining variants stay in the library as future release material. Singles-per-variant is explicitly rejected (§4).

### Console: a fourth tab, "Releases"

The existing tabs keep their jobs (Design = make a variant, Queue = render it, Library = inspect masters). Releases is where catalog work happens:

1. **Release list** — one card per release: cover thumbnail, title, artist, track count, status pill, and a readiness summary ("3 of 8 names approved · art pending").
2. **Release detail** — ordered tracklist (each row: approved title or a "needs name" flag, QA verdict, duration), cover preview with Regenerate/Approve, and the metadata block (artist, title, genre, release date).
3. **Checklist + kit** — a literal checklist gating the kit: every track rendered & QA PASS → every track name approved → cover approved → **Download release kit** enables. After upload, a "Mark submitted" action and a paste field for the store link move status forward.

Naming stays where it is (Library tab, per-track) — the Releases tab links to a track's card for unnamed tracks rather than duplicating the naming UI.

---

## 3. Solutions

### (a) Fix the naming round-trip, then upgrade the generator

**Round-trip (the actual bug):** approved names move out of per-render sidecars into a committed store, `config/track-names.json` — `{ variantId: { title, description, approved_at } }`. It is keyed by variant (not filename), survives re-renders, works identically in local and hosted mode, and is versioned with the repo. `approveName` writes this store; `libraryTracks()` reads it and overlays it on every track; `publish_artifacts.py` merges the store into each master's sidecar at publish time so the manifest keeps carrying names for any external reader. The sidecar write in `web/lib/naming.ts:42-55` is retired.

**Generator:** keep the `SeoNameProvider` interface, add a real provider calling the Claude API (env-gated by `ANTHROPIC_API_KEY`; the existing `local-stub` remains the fallback so the console works offline). The prompt already in `naming.ts` is the right shape — natural title + concise description, no keyword stuffing (stores reject stuffed titles), preserve the variant ID *in the description only*, never the title. Add a release-aware batch mode: "name these 8 tracks as one EP" so titles within a release cohere ("Pink Noise Sessions, Pt. 1–8" is allowed but boring; sibling-aware titles are the point). Release/album titles are typed by hand in the console — five albums do not need a generator.

### (b) Artwork: one deterministic template, N covers

A generator, not a designer: `scripts/gen_artwork.py` renders an SVG template to PNG at **3000×3000** (DistroKid's recommended size; RGB; JPG/PNG accepted), driven entirely by release data:

- **Palette** from the color dimension (white → warm greys, pink → dusk tones, brown → deep umber, green → sage) — one mapping table in the script.
- **Texture** from the motion dimension: `still` = flat field, `drift` = slow gradient bands, `breathing` = concentric soft rings. Deterministic from the release id (seeded, same discipline as the audio seeds) so regenerating reproduces the same cover.
- **Typography:** artist + release title only, in one bundled open-license font. DistroKid compliance rules are enforced by construction: no URLs, no social handles, no logos, no store branding, text matches the release metadata exactly.

The console's Release detail shows the rendered cover with **Regenerate** (bumps a seed offset, same as name candidates) and **Approve**. Approved covers are committed under `art/<release-id>/cover.png` — five ~1–3 MB PNGs, fine in git; no new storage machinery.

### (c) Release kit + upload runbook (the last mile, human-shaped)

**Kit:** per release, a zip built by `scripts/build_release_kit.py` (surfaced as a download in the Releases tab and as `make releasekit RELEASE=<id>`):

```
01 - <Approved Title>.wav     # masters fetched from R2/local, renamed, in track order
...
cover.png                     # 3000×3000, the approved art
metadata.txt                  # DistroKid's form fields, in the form's order
```

`metadata.txt` mirrors the DistroKid submission form top-to-bottom: artist, release title, genre, language (English), explicit (No), per-track titles in order, songwriter/credit line, release date. Every line is copy-paste-ready; nothing on the form requires opening another tool. The existing masters already satisfy DistroKid's audio requirements (24-bit/48 kHz stereo WAV, 4-minute tracks — comfortably over the ~30 s royalty minimum), so the kit re-packages, never re-encodes. UPC/ISRC are assigned by DistroKid and deliberately not modeled.

**Runbook:** `docs/distribution-runbook.md` — the one-page ordered procedure: build kit → DistroKid form walkthrough with each field's source line in `metadata.txt` → artwork upload → submit → paste the store link into the console → status flips to Submitted (and Live once the store link resolves, checked by hand — no store-API polling). The pilot EP is the acceptance test: one human runs the runbook end to end and every friction found is a bug against T6/T7.

---

## 4. Non-goals / out of scope

- **Automating the DistroKid upload** (no public API; browser automation violates ToS and risks the account). The kit is the automation boundary.
- **144 singles.** The full matrix as individual releases is rejected as product and as workload; unreleased variants simply stay in the Library.
- **UPC/ISRC management** — DistroKid assigns both.
- **Marketing beyond metadata**: playlist pitching, social assets, Canvas videos, release-day promotion.
- **Re-mastering for streaming loudness.** Masters are −20 LUFS by design (sleep/focus material; platforms normalize and true peak is already capped at −3 dBTP). No new render work in this phase.
- **Distributing stems** — the release kit ships masters only.
- **Other stores/aggregators** (CD Baby, TuneCore, direct Bandcamp): one aggregator first; the kit format is aggregator-agnostic anyway.
- **Store-side status polling** — Live is a manual flip after checking the pasted link.

---

## 5. Task breakdown for Devin (prioritized, dependency-ordered)

**T1. Release data model and loader**
Add `config/releases.yaml` (schema in §2) with the pilot EP and four color albums, tracks chosen from QA-passing variants. Add `web/lib/releases.ts`: load, validate (every track id exists in `variants.yaml`; no duplicate ids), and compute readiness (rendered/named/art flags per release). Expose `GET /api/releases`.
*Files:* `config/releases.yaml`, `web/lib/releases.ts`, `web/app/api/releases/route.ts`, `web/lib/types.ts`.
*AC:* API returns all releases with per-release readiness derived from the artifact index and the names store; an unknown variant id in the YAML fails loudly at load; unit tests cover validation and readiness.

**T2. Names store: fix the approval round-trip**
Replace sidecar writes with `config/track-names.json` keyed by `variantId`. `approveName` writes the store; `libraryTracks()` overlays it (store wins over any legacy `seo_title` sidecar field); `publish_artifacts.py` merges the store into master sidecars at publish so the manifest self-describes.
*Files:* `web/lib/naming.ts`, `web/lib/library.ts`, `scripts/publish_artifacts.py`, `config/track-names.json`.
*AC:* Approving a name in a console with `NOISE_ARTIFACTS_BASE_URL` set (no local render dir) succeeds and shows on refresh; re-rendering a variant does not lose its name; a publish after approval carries `seo_title` in the manifest sidecar; existing approve UI works unchanged.

**T3. Claude naming provider with release-aware batch** *(depends on T2)*
Implement `SeoNameProvider` backed by the Claude API behind `ANTHROPIC_API_KEY`, falling back to `local-stub` when unset. Add `POST /api/names/generate-batch` taking a release id: one call names all unnamed tracks coherently as an EP/album; results land in the existing per-track review UI (nothing is auto-approved).
*Files:* `web/lib/naming.ts`, `web/app/api/names/generate/route.ts`, new batch route.
*AC:* With a key set, generate returns non-template titles with no variant id in the title; without a key, stub behavior is byte-identical to today; batch returns one suggestion per unnamed track of a release; API failures surface as a toast, never a hung button.

**T4. Artwork generator** *(depends on T1)*
`scripts/gen_artwork.py`: release id → deterministic 3000×3000 PNG per §3b (palette from color, texture from motion, artist + title text, seeded). Bundle one open-license font. `make artwork RELEASE=<id>` writes `art/<id>/cover.png`.
*Files:* `scripts/gen_artwork.py`, `art/`, `Makefile`, `requirements-*.txt` as needed.
*AC:* Same inputs reproduce identical bytes; output is 3000×3000 RGB PNG under 10 MB; rendered text exactly matches YAML artist/title; no network access at render time; each of the five v1 releases yields a visually distinct cover from the mapping table alone.

**T5. Releases tab** *(depends on T1; T4 for cover previews)*
Fourth tab per §2: release list with readiness summaries, release detail with ordered tracklist (unnamed rows deep-link to the track's Library card via the existing `#library/<variantId>` scheme), cover preview with Regenerate (seed bump) / Approve, status pill and transitions (Mark submitted + store-link paste → Submitted; manual → Live).
*Files:* `web/app/noise-lab.tsx`, `web/app/api/releases/*`, `web/app/globals.css`.
*AC:* On 390 px, list and detail render without horizontal overflow; readiness reflects live artifact/name state; status and store links persist in `releases.yaml` (local mode) and survive reload; kit download button disabled until checklist complete, with the blocking item named.

**T6. Release kit builder** *(depends on T1, T2, T4)*
`scripts/build_release_kit.py` + `make releasekit RELEASE=<id>` + console download route: zip of ordered renamed masters (fetched from `NOISE_ARTIFACTS_BASE_URL` or local render dir), `cover.png`, and `metadata.txt` mirroring the DistroKid form order.
*Files:* `scripts/build_release_kit.py`, `Makefile`, `web/app/api/releases/[id]/kit/route.ts`.
*AC:* Kit for the pilot EP contains 8 WAVs named `NN - Title.wav` in YAML order with approved titles, byte-identical audio to the masters (no re-encode), 3000×3000 cover, and a metadata.txt where every DistroKid form field appears exactly once; building with an unready release fails with the missing item named.

**T7. Distribution runbook + pilot dry run** *(depends on T6)*
Write `docs/distribution-runbook.md` (§3c) and execute it once for the pilot EP against the real DistroKid form (stop before payment/submit if the account isn't ready — the dry run validates field coverage, not billing). File every friction point as an issue against T5/T6.
*Files:* `docs/distribution-runbook.md`.
*AC:* A person who has never seen this repo can go from "kit downloaded" to "form fully populated" using only the runbook and kit; every form field DistroKid presents maps to a named line in `metadata.txt`; discovered gaps are filed, not folded silently into the doc.

**Shipping order:** T1 → T2 → (T3, T4 in parallel) → T5 → T6 → T7. T2 is independently shippable and fixes a live bug regardless of the rest.

---

## 6. Success metrics

- **Upload effort:** "kit downloaded" → "DistroKid form submitted" in ≤ 15 minutes per release, with zero fields typed from memory (everything copy-paste from `metadata.txt`). Measured by the T7 dry run and the first real release.
- **No leaked machine IDs:** 0 occurrences of `wn_*` strings in any listener-facing surface — track titles, album titles, cover art, store metadata. (Descriptions may carry the id for traceability.)
- **Naming round-trip:** 100 % of approved names visible in the hosted console and present in the published manifest after the next publish; a name is never approved twice for the same variant.
- **Artwork compliance:** all v1 covers pass DistroKid's artwork check on first submission (correct size, no prohibited content) — zero art rejections.
- **Catalog legibility:** the founder answers "what's live, what's ready, what's blocked and on what?" from the Releases list alone — no spreadsheet, no bucket-browsing. Re-check after the pilot EP ships.

---

## Key implementation facts (verified in code)

- The naming UI (generate → edit → approve) already exists on Library track cards (`web/app/noise-lab.tsx:522-552`) and reads titles via `seo_title` (`web/lib/library.ts:62-64`) — T2/T3 slot into a live flow, not a green field.
- `approveName` writes only to `RENDER_DIR` sidecars (`web/lib/naming.ts:44`), while hosted mode reads sidecars baked into the R2 manifest (`web/lib/artifacts.ts:91-99`, embedded at publish by `scripts/publish_artifacts.py:65-72`) — approved names cannot reach a hosted catalog today, hence the committed names store.
- The generator is an explicit stub: `provider: "local-stub"` with template titles (`web/lib/naming.ts:27-40`); the `SeoNameProvider` interface was built to be swapped.
- `variant_id` is `wn_<color>_<band>_<motion>_<balance>` and filenames embed a seed (`scripts/gen_variants.py:92,112`) — stable keys for the names store and release tracklists.
- Masters are 24-bit/48 kHz stereo WAV, 4 minutes (60 s × 4 repeats), −20 LUFS, ≤ −3 dBTP (`config/dimensions.yaml:6-13`) — already within DistroKid's accepted audio specs; the kit re-packages without re-encoding.
- Releases-as-YAML follows the repo's established pattern: the matrix is pure data (`config/dimensions.yaml` header comment), and the queue plan's `#library/<variantId>` deep links (docs/queue-redesign-plan.md §3b) give the Releases tab its track-linking mechanism for free.
