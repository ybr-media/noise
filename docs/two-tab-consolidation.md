# Two-tab consolidation — Create and Library

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-21
**Supersedes:** the Queue-tab portions of `docs/queue-redesign-plan.md`
**Code grounding:** `web/app/noise-lab.tsx`, `web/lib/queue-strings.ts`,
`web/app/ui/tutorial.tsx`, `web/app/globals.css`

---

## 1. Why

Four dock tabs — Design, Queue, Library, Releases — had become three views and
one waiting room.

**Queue had no way to start a render left in it.** Every render begins either on
Design ("Create track") or from a Library recipe ("Render again"). The bulk
pilot/full buttons that `queue-redesign-plan.md` §2 placed at the bottom of the
Queue tab are gone from the UI; `queue(ids, "pilot" | "full")` survives in code
with no caller. So Queue was a pure monitor: a tab you visited only while
waiting, carrying a badge that nagged the rest of the time.

**Queue and Library were the same list split by whether the render finished.**
Library rendered `tracks.filter(track => track.exists)` — only files. A take
moved between the two tabs by completing, and the app already admitted the seam:
a Done job's only action was "Open in Library".

**Queue was also the app's biggest chrome outlier.** Per the table in
`docs/tab-cohesion-audit.md` §2 it was the only tab with a black primary button,
r24 cards, 14px list gaps, and no empty state at all.

## 2. What we built

Two dock destinations. Three panels. One render state.

| Concern | Before | After |
|---|---|---|
| Is anything rendering? | Queue tab | Header pill, every tab |
| Where will my track land? | Queue, then Library | Library, once the master exists |
| Why did it fail? | Queue tab | Render activity sheet |
| Assemble a release | Releases tab | Library → Releases section |

**The header pill** (`RenderStatus`) reports the renderer on every tab: a dot
plus `Idle` / `Queued · 3 waiting` / `Rendering · 2 running`. When no work is
active, a non-dismissed failure changes it to a danger state that says
`Render failed — see activity`. Sync freshness went to the tooltip so the words
that matter survive a 390px header. Polling now follows active work rather than
the tab you are standing on.

**The Library contains finished masters only.** In-flight and failed jobs belong
in the activity sheet, where their status, diagnostics, retry controls, run
history, and dismissal archive have the right shape. The Library empty state
directs users back to the render-status pill instead of pretending an unfinished
take is already a Library row.

**The activity sheet** keeps everything a Library row is the wrong shape for:
failure diagnostics (failed step, exit code, runner, logs), run history across
attempts, retry, the dismissal archive with its R2 cleanup state, and batch jobs.
It opens from the header pill, and closes on Escape, backdrop, close, or browser
Back. It also got the empty state the Queue tab never had.

## 3. Phasing

Each phase shipped on its own and left the first-run tour coherent — no step ever
pointed at an element that had stopped existing.

1. **Global render status.** Add the header pill; move the Library's freshness
   caption into the Library toolbar to free the header slot. Tour untouched.
2. **Library lifecycle rows (reverted).** PR #145 Phase 2 briefly put in-flight
   and failed takes in Library. That approach is reverted at the user's request:
   Library shows finished masters only, and render lifecycle remains in the
   activity sheet entered from the header pill.
3. **Retire the Queue tab.** Dock drops to three; Queue's content moves wholesale
   into the activity sheet. The tour's `queue-tab` and `queue-status` steps
   collapse into one info step on the header pill — nine steps become eight.
4. **Two tabs.** Design → Create; Releases becomes a Library section behind a
   segmented control. Tour targets renamed `design-*` → `create-*`.

## 4. What we gave up

Named honestly, because these were real properties of the old Queue:

- **Chronology.** Queue was time-ordered ("Today / Yesterday / This week").
  Library sorts finished masters by `matrixIndex` then `renderKey`; render
  lifecycle chronology and failure history remain in the activity sheet.
- **One screen showing every job at once.** Fine at 1–8 renders. A large batch
  now reads as a single activity-sheet row instead of a scannable list. This is a
  deliberate trade: the batch case is rare and the single-track case is constant.
- **A tab-sized target for render status.** The pill is smaller than a dock tab.
  It is on every screen, which we judged the better end of that trade.

## 5. Follow-ups

The routing and client cleanup follow-ups from the consolidation are complete:

- **One hash route for view state.** Create, Library, and Releases are derived
  from `web/lib/route.ts`. Canonical routes are `#create`, `#library`,
  `#library/<render-key-or-variant-id>`, `#releases`, and
  `#releases/<id>`. The empty hash remains Create, and `#design` / `#queue`
  redirect to Create / Library; the latter opens the activity sheet.
- **Activity is a route flag.** `?activity` composes with every tab. Opening
  pushes the flag, while Escape, backdrop, close, and Back pop it, so refresh
  and browser navigation preserve the same sheet state.
- **Client bulk rendering is removed.** The client queues one selected
  variant at a time. Server and shared selectors still accept `pilot` and
  `full` for CI-dispatched jobs.
- **The Phase 2 take-as-Library-row experiment is reverted.** In-flight and
  failed takes are no longer rendered as Library rows. The activity sheet is
  the sole lifecycle surface, entered from the header pill; the pill reports
  active work and non-dismissed failures.

Library still sorts masters by matrix index with no recency option; that remains
open because it is a product decision, not a routing cleanup.
