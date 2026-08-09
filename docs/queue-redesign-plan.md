# Queue Tab Redesign — Plan

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-09
**Code grounding:** `web/app/noise-lab.tsx` (Queue component), `web/lib/dispatch.ts`, `web/lib/queue.ts`, `web/app/api/queue/route.ts`, `web/lib/types.ts`, `web/app/globals.css`

---

## 1. Problem statement

The Queue tab conflates two jobs — *starting* renders and *monitoring* renders — on one phone screen, with the less-frequent action (bulk render buttons plus two paragraph-length captions) sitting above the thing users actually come for (job status). Once a job is listed, it's a dead end: no expected wait time, no path from a Done job to its master in the Library, and a Failed job shows a raw error string containing an un-tappable GitHub Actions URL with no way to retry. The result is a tab that requires context-switching to GitHub or manually hunting the Library to answer "when is it done, where is it, and what do I do when it breaks?"

### User stories

1. **Monitor without clutter.** As a founder checking renders from my phone, I want the Queue tab to open on the status of my jobs — with the rarely-used bulk actions tucked out of the way — so I can see the state of the world in one glance without scrolling past buttons I press once a week.
2. **Know the wait, reach the result.** As a user who just queued a render, I want to see roughly how long it will take and, when it's done, tap the job to land on that track in the Library, so I never have to guess whether it's finished or scroll the Library to find it.
3. **Recover from failure in one tap.** As a user with a failed render, I want a plain-language error, a tappable "View logs" link to the Actions run, and a one-tap Retry, so a failure costs me ten seconds instead of a trip to github.com.

---

## 2. Information architecture (redesigned Queue tab, single tab, mobile-first)

Top-to-bottom order — **status first, actions demoted to the bottom**:

1. **Panel heading** (unchanged position): "Render queue" + refresh button + a small mode chip (`GitHub Actions` / `Local worker`). The current heading subtitle prose ("Honest worker-backed status") is replaced by a live **summary line**: e.g. `2 rendering · 1 queued · ~6 min remaining` (or `Queue idle` when empty). This is the single answer to "how long?"
2. **Needs attention** (Failed jobs) — only rendered when non-empty, and rendered *first* when present. Failures are the highest-urgency content; today they're buried inside "Completed today".
3. **Active** (Queued + Rendering) — each row: variant id, status dot, relative time ("queued 4m ago"), and per-job ETA (dispatch mode) or queue position (local mode).
4. **Done** — each row becomes a tappable link into the Library (see §3b). Keep the current "Completed today" scoping.
5. **Start renders** — a single collapsed `<details>`-style card at the bottom containing the two bulk actions. Collapsed by default; the summary row reads "Start renders · pilot (8) or full matrix (144)". Inside: the two buttons with **one-line** captions ("All 8 pilot variants, ignores Design selection" / "All 144 variants, ignores Design selection"); the current paragraph captions move entirely into `title`/`aria-label`. The full-matrix confirm step stays. The `QUEUE_NOTES` mode paragraph moves inside this card too — it explains dispatch mechanics, which is start-context, not monitor-context.

Rationale for demote-not-remove: single-variant queueing already lives on the Design tab ("Queue this render"), so the Queue tab's actions are genuinely bulk/rare. They stay on this tab (one fewer navigation concept, and "unavailable" mode messaging stays coherent) but stop dominating the viewport.

The tab badge (active-job count) is unchanged.

---

## 3. Solutions

### (a) Expected wait time / ETA

**Data source (dispatch mode):** the workflow-runs API already returns `run_started_at` and `updated_at`; `dispatchedJobs()` currently discards them. We will:

- Extend `QueueJob` with optional `startedAt`, `finishedAt`, `durationSeconds`, `logsUrl`.
- In `dispatchedJobs()`, compute `durationSeconds = updated_at − run_started_at` for completed-successful runs, and have the GET `/api/queue` response include `stats: { medianRenderSeconds, sampleSize }` — the **median duration of successful runs within the last-20 window** (median, not mean, because a run that installs Audacity has occasional outliers).

**Display:**

- Rendering job: `~N min left` = `max(1 min, median − elapsed since startedAt)`, phrased as an estimate, never a countdown.
- Queued job: `typically ~N min once started`.
- Header summary: elapsed-aware total for the busiest active job.

**Fallback when no history exists** (`sampleSize === 0`): show the static copy `First render — typically 5–10 min` (hardcoded constant `DEFAULT_RENDER_ESTIMATE_RANGE = "5–10 min"`; the workflow spends most of its time on the Audacity install + render, which is stable enough for a printed range). Never show a bare "unknown".

**Local mode:** the JSONL has no timing and the worker is out of scope, so no ETA. Instead show **queue position** — "2 jobs ahead" — computed client-side from Queued-job order, which is the honest equivalent.

**Freshness:** manual refresh undermines any ETA, so add light polling: while the Queue tab is visible **and** at least one job is active, re-fetch `/api/queue` every 30 s; stop when the tab is hidden (`visibilitychange`) or the queue drains. No websockets.

### (b) Done job → Library track

- **Deep link scheme:** hash routing, `#library/<variantId>`. On load and on `hashchange`, the app sets `tab = "library"` and scrolls to the matching `TrackCard` (each card gets `id={"track-" + variantId}`), applying a brief highlight pulse. Hash (not query param) avoids a server round-trip and works with the existing client-side tab state.
- **Affordance:** a Done job row becomes a full-row tap target — subtitle changes from "Master ready" to **"Master ready · Open in Library"** with a trailing chevron. Tapping navigates via the hash and triggers a library refresh so a just-finished master is present.
- **Bulk-run edge case (dispatch):** a run's `variantId` is derived from `display_title` and may be `pilot`, `full`, or a variant list — i.e., one job can produce many tracks. Rule: if `variantId` matches exactly one known variant, deep-link to that track; otherwise the row links to the Library tab top with subtitle "Masters ready · Open Library".

### (c) Failed-job UX

- **Structured error:** stop concatenating the run URL into `error` (`dispatch.ts:73`). `error` becomes the human message ("Workflow failed" / the worker's error string in local mode); the URL moves to the new `logsUrl` field (`runUrl(run.id)`).
- **Row layout:** status dot (red) + variant id + short error line + two compact actions: **View logs** (dispatch mode only — opens `logsUrl` in a new tab as a real `<a target="_blank" rel="noopener">`) and **Retry**.
- **Retry semantics, per mode:**
  - *Dispatch:* Retry re-dispatches the same inputs via the existing `dispatchRender(variants)` — the client sends the job's raw `variantId` string (which is exactly the original `variants` input, including `pilot`/`full`) to a new `POST /api/queue/retry` endpoint. A new run (new job row) appears on next poll; the failed row remains as history. Button flips to "Retried ✓" (disabled) for the session; toast confirms "Retry dispatched".
  - *Local:* Retry appends a fresh Queued job for that `variantId` via existing `enqueue()` — the JSONL stays append-only; the worker picks it up normally. Same "Retried ✓" treatment.
  - *Unavailable mode:* Retry hidden; View logs still shown when `logsUrl` exists.

---

## 4. Non-goals / out of scope

- **Cancelling** queued or in-progress jobs (GitHub run cancellation and JSONL mutation are both new machinery).
- **Local-worker timing** (`startedAt`/`finishedAt` written by the Python worker) — ETA stays dispatch-only in v1.
- **Real-time transport** (websockets/SSE); 30 s polling is sufficient at this scale.
- **Job history beyond** the last-20-runs window (dispatch) / current JSONL (local); no archive, search, or pagination.
- **Per-step progress** (install/render/QA breakdown) inside a running job.
- **Push/email notifications** on completion or failure.
- **Design and Library tab redesigns** (Library only gains card anchors + highlight).
- **Queue reordering or prioritization.**

---

## 5. Task breakdown for Devin (prioritized, dependency-ordered)

**T1. Surface run timing, logs URL, and duration stats from the queue API**
Extend `QueueJob` with optional `startedAt`, `finishedAt`, `durationSeconds`, `logsUrl`. In `dispatchedJobs()`, map `run_started_at`/`updated_at` into those fields, move the Actions URL out of `error` into `logsUrl`, and compute `stats: { medianRenderSeconds, sampleSize }` from successful completed runs. Return `stats` from `GET /api/queue` (null/zero-sample in local mode).
*Files:* `web/lib/types.ts`, `web/lib/dispatch.ts`, `web/app/api/queue/route.ts`.
*AC:* In dispatch mode, GET response includes `stats` with median over successful runs and per-job `logsUrl` on failed jobs; `error` contains no URL; local mode response shape is unchanged apart from the added optional/null fields; existing UI still renders without modification (fields are additive).

**T2. Restructure Queue tab IA: status first, actions collapsed**
Reorder the Queue component: summary line in heading; sections Needs attention (Failed, only when non-empty) → Active → Done; move both bulk actions plus `QUEUE_NOTES` into a collapsed `<details>` "Start renders" card at the bottom with one-line captions (full text demoted to `title`/`aria-label`); keep the full-matrix confirm flow and `unavailable`-mode disabling.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* On a 390 px viewport with ≥1 active job, the first scroll-height shows only heading + job status (no bulk buttons); Failed section renders above Active only when failures exist; bulk actions still work in both modes, collapsed by default; a11y labels preserved.

**T3. ETA display and queue positions** *(depends on T1)*
Consume `stats` client-side: per-job ETA lines for Rendering/Queued in dispatch mode, `First render — typically 5–10 min` fallback when `sampleSize === 0`, heading summary line (`2 rendering · ~6 min remaining`), and "N jobs ahead" position labels in local mode. Add relative queued-at times ("4m ago") everywhere.
*Files:* `web/app/noise-lab.tsx`.
*AC:* With history, a Rendering job shows `~N min left` that decreases across refreshes and floors at `~1 min left`; with no history, fallback copy appears; local mode shows position, never an ETA; all times relative, no raw ISO strings.

**T4. Auto-refresh while jobs are active**
Poll `GET /api/queue` every 30 s while the Queue tab is selected, the document is visible, and ≥1 job is Queued/Rendering; clear the interval otherwise. Manual refresh button unchanged.
*Files:* `web/app/noise-lab.tsx`.
*AC:* With an active job, the list and tab badge update within 30 s of a status change without user action; no requests fire when the tab is hidden, another tab is selected, or the queue is drained; no overlapping in-flight fetches.

**T5. Done → Library deep link**
Add `id={"track-" + variantId}` anchors to `TrackCard`; implement `#library/<variantId>` hash handling (on load + `hashchange`): switch tab, refresh library, scroll to card, 2 s highlight pulse. Done job rows become full-row links with "Master ready · Open in Library ›"; jobs whose `variantId` isn't exactly one known variant (`pilot`, `full`, lists) link to the Library tab top instead.
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* Tapping a single-variant Done job lands on the highlighted track card, including for a track rendered after the page loaded (refresh happens first); tapping a `pilot`/`full` Done job opens the Library at top; opening the app cold at `#library/<id>` works; back button returns to the Queue tab.

**T6. Failed-job actions: View logs + Retry** *(depends on T1; T2 recommended first)*
Failed rows render the short `error` plus a tappable **View logs** anchor (`logsUrl`, new tab) and a **Retry** button. Add `POST /api/queue/retry` accepting `{ jobId, variantId }`: local mode validates the variant and calls `enqueue([variantId])`; dispatch mode passes the job's raw `variantId` string through `resolveSelection`/`dispatchRender` so `pilot`/`full`/list inputs re-dispatch identically; unavailable mode returns 503. Client shows a toast, marks the row "Retried ✓" (disabled) for the session, and triggers a refresh.
*Files:* `web/app/api/queue/route.ts` (or new `web/app/api/queue/retry/route.ts`), `web/lib/dispatch.ts`, `web/app/noise-lab.tsx`, `web/lib/types.ts` if needed.
*AC:* View logs opens the exact Actions run in a new tab (dispatch only; absent in local mode); Retry on a failed dispatch run creates a new run with identical `variants` input visible as a new job row on next poll; Retry on a failed local job appends a new Queued JSONL line without mutating existing lines; double-tap does not double-dispatch; unavailable mode hides Retry.

**T7. Copy and a11y pass**
Sweep the redesigned tab: statuses announced via `aria-live` on the summary line, all tap targets ≥44 px, error strings truncated with full text in `title`, empty states for each section ("Nothing needs attention", "No active renders — open Start renders below").
*Files:* `web/app/noise-lab.tsx`, `web/app/globals.css`.
*AC:* Axe/lighthouse a11y pass shows no new violations on the Queue tab; every interactive element reachable and labeled by screen reader; no clipped text at 320 px width.

**Shipping order:** T1 → T2 → (T3, T4, T5 in parallel) → T6 → T7. T2, T4, T5 are shippable without T1.

---

## 6. Success metrics

- **Failure recovery time:** from "failure visible" to "retry dispatched" achievable in ≤2 taps inside the app; zero required visits to github.com for the retry path (View logs remains optional). Proxy: count of `/api/queue/retry` calls vs. manual re-queues of previously failed variants.
- **Done-to-Library conversion:** ≥50 % of sessions containing a Done job include a `#library/<id>` navigation from the Queue tab, replacing manual Library scrolling.
- **Wait-time visibility:** 100 % of active jobs display an ETA (dispatch) or queue position (local) — no status row is ever a bare status word; ETA median absolute error vs. actual run duration within ±30 % after 10 runs of history.
- **Reduced status-checking friction:** with polling live, median manual-refresh taps per Queue session drops (baseline: every check is manual today).
- **Qualitative:** the founder can answer, from one phone screenshot of the tab, all three of: what's running and how long it'll take, which masters are ready and how to open them, and what failed and what to do about it. Re-run the original feedback session after ship; all three complaints should be closed.

---

## Key implementation facts (verified in code)

- Run timing fields are fetched-and-discarded in `dispatchedJobs()` (`web/lib/dispatch.ts:38-75`).
- The failed-job URL is concatenated into `error` at `web/lib/dispatch.ts:73`.
- The dispatch `variantId` is the raw workflow `display_title` minus a `Render ` prefix (`dispatch.ts:70`), so it doubles as the exact retry input.
- The local queue is append-only JSONL (`web/lib/queue.ts`), so retry must append, never mutate.
- Tab state is pure React state with no routing today (`noise-lab.tsx:266`), hence the hash-routing approach.
