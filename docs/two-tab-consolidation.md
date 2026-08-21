# Two-tab consolidation — Create and Library

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-21
**Supersedes:** the Queue-tab portions of `docs/queue-redesign-plan.md`
**Code grounding:** `web/app/noise-lab.tsx`, `web/lib/library-lifecycle.ts`,
`web/lib/queue-strings.ts`, `web/app/ui/tutorial.tsx`, `web/app/globals.css`

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
| Where will my track land? | Queue, then Library | Library, as an In progress row |
| Why did it fail? | Queue tab | Render activity sheet |
| Assemble a release | Releases tab | Library → Releases section |

**The header pill** (`RenderStatus`) reports the renderer on every tab: a dot
plus `Idle` / `Queued · 3 waiting` / `Rendering · 2 running`. Sync freshness went
to the tooltip so the words that matter survive a 390px header. Polling now
follows active work rather than the tab you are standing on.

**The Library's unit is the take, not the file.** A render you just asked for
appears immediately where it is going to land, and becomes a master in place.
`lib/library-lifecycle.ts` decides what qualifies, and deliberately excludes two
things:

- **Batch jobs.** A dispatched run's `variantId` can be `pilot` or `full`, so one
  job becomes many tracks. 144 pending Library rows is worse than one activity
  row.
- **Failures for a variant that already has a playable master.** The file is
  there; only the diagnostics are missing, and diagnostics are not Library
  content.

**The activity sheet** keeps everything a Library row is the wrong shape for:
failure diagnostics (failed step, exit code, runner, logs), run history across
attempts, retry, the dismissal archive with its R2 cleanup state, and batch jobs.
It opens from the header pill or from a pending row's Details, and closes on
Escape or backdrop. It also got the empty state the Queue tab never had.

## 3. Phasing

Each phase shipped on its own and left the first-run tour coherent — no step ever
pointed at an element that had stopped existing.

1. **Global render status.** Add the header pill; move the Library's freshness
   caption into the Library toolbar to free the header slot. Tour untouched.
2. **Library speaks the lifecycle.** In-flight and failed takes appear as
   Library rows. Tour untouched.
3. **Retire the Queue tab.** Dock drops to three; Queue's content moves wholesale
   into the activity sheet. The tour's `queue-tab` and `queue-status` steps
   collapse into one info step on the header pill — nine steps become eight.
4. **Two tabs.** Design → Create; Releases becomes a Library section behind a
   segmented control. Tour targets renamed `design-*` → `create-*`.

## 4. What we gave up

Named honestly, because these were real properties of the old Queue:

- **Chronology.** Queue was time-ordered ("Today / Yesterday / This week").
  Library sorts by `matrixIndex` then `renderKey`. Pending takes are pinned above
  the masters and sorted newest-first, but finished masters stay in matrix order,
  so "what did I just make" is answered by the In progress section rather than by
  the list as a whole.
- **One screen showing every job at once.** Fine at 1–8 renders. A large batch
  now reads as a single activity-sheet row instead of a scannable list. This is a
  deliberate trade: the batch case is rare and the single-track case is constant.
- **A tab-sized target for render status.** The pill is smaller than a dock tab.
  It is on every screen, which we judged the better end of that trade.

## 5. Follow-ups not taken

- The activity sheet is React state, not a hash route, so Back does not close it.
  `tab-cohesion-audit.md` §3.A1 is right that mixed routing is a problem; this
  adds one more instance rather than fixing the underlying split.
- Library still sorts masters by matrix index with no recency option.
- `queue(ids, "pilot" | "full")` remains callable with no UI. Either give bulk
  rendering a home in the activity sheet or delete the path.
