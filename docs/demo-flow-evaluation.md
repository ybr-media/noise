# Demo flow evaluation — Noise Lab console

**Scope:** the end-to-end path a person is walked through when the console is demoed —
**Design → Create track → Queue → Library** — plus the state that has to travel between
those tabs for the walk to make sense.

**Method:** production build (`npm run build && npm start`) served against the real
`config/` matrix, driven with Playwright at 390×844. Every timing and every quoted string
below was captured from the running app, not read off the source. Code-only findings are
labelled **(code read)** and were not reproduced in the browser.

**Deliberately not in scope:** styling, tokens, contrast, primitives, desktop layout.
`docs/design-quality-audit.md` covers those and is not re-litigated here — see §8 for the
overlap list. This document is about *sequence*: what happens between the taps.

---

## 1. Verdict

**Each tab is in better shape than the path between them.**

Every screen in the demo does its own job. Design is a genuinely sophisticated instrument.
The Queue card carries real diagnostics. The Library player is complete. What is missing is
everything that should happen *in the joins* — and a demo is nothing but joins.

Three things break, and they break in the same place: the moment the user commits.

1. **The commit goes nowhere.** Tapping *Create track* leaves you on Design with a toast.
   The app knows a job now exists, has a purpose-built affordance for saying so — `Toast`
   accepts an `action` button (`:306`) — and **uses it at zero call sites**. The presenter
   has to say "now tap Queue." That sentence is the demo's biggest tell.
2. **Nothing updates until you go looking.** The Queue polls only while the Queue tab is
   open, every 30 s (`:1019-1022`). The Library polls never. A render that finishes while
   you are talking does not appear — the payoff of the entire demo is gated behind a manual
   navigation.
3. **The thing you made loses its name in transit.** Design never states what you are
   building. The toast names one of its four axes. The Queue names it differently again. Across
   four screens, four different label sources describe the same object, and they disagree (§5).

None of this is a rewrite. Every item in §9 Phase A is a small, local change inside
`web/app/noise-lab.tsx`, and together they are the difference between a demo that needs
narration and one that narrates itself.

---

## 2. The demo, as it actually runs

Measured, cold load to first playable moment:

| # | Step | Measured | What the user sees |
|---|---|---|---|
| 1 | Load | DOMContentLoaded **47 ms** | splash |
| 2 | Splash | visible 134 ms → gone **1,951 ms** | wordmark; Design is not interactive |
| 3 | Design ready | **1,956 ms** | spectrum card is an **empty grid** — nothing is drawn until Play |
| 4 | Tap *Create track* | busy **85 → 468 ms** | button reads "Creating…" |
| 5 | Toast | **+123 ms** | *"White master and stems being rendered"* — **no action button** |
| 6 | Tab after commit | — | **still Design.** Only a red `1` on the Queue icon changed |
| 7 | Tap Queue manually | — | card: *"White Mid Drift — Balanced"*, pill *"Queued"*, *"0 jobs ahead"* |
| 8 | Tap Library | — | *"MASTERS · 0 / No rendered files found."* |

**Two seconds of splash before the first frame of product.** `:978-990` sets 1,250 ms then
a 400 ms fade, and it runs on **every** load, not just the first — reload during a demo and
you buy the wordmark again. It is skipped only under `prefers-reduced-motion`.

**Step 6 is the flow's fracture.** The commit produces a toast and a badge. It does not
produce a destination.

**Step 3 is a wasted first impression.** The spectrum is the hero element and the first
thing on screen, and it renders an empty grid until Play is pressed. The variant's spectral
shape is fully known at selection time — `bandLowHz`, `bandHighHz`, `spectrum.bell`, and
the colour slope are all in the payload — so a static curve for the current selection could
be drawn with no audio at all, and would make the four controls visibly *do something*.

---

## 3. F-1 — The commit has no destination

`queue()` at `:1099-1121` fires the toast and calls `await refresh()`. It never navigates,
and it never offers to.

The affordance already exists and is fully built:

```ts
type ToastState = { message: string; error?: boolean; action?: { label: string; onClick: () => void } };   // :306
```

`Toast` renders `.toast-action` (`:317`), and `globals.css:246` styles it. **Grep for
`action:` across `noise-lab.tsx` returns nothing.** A styled, typed, rendered button with no
producer — dead on arrival.

**Fix:** give the commit toast an action.

```ts
setToast({
  message: `${name} queued`,
  action: { label: "View queue", onClick: () => setTab("queue") },
});
```

That one change removes the presenter's "now tap Queue" line. Whether the commit should
*auto*-navigate instead is a product call — see §10 Q1.

---

## 4. F-2 — State does not travel on its own

| Data | Refresh trigger | Interval |
|---|---|---|
| Queue | Queue tab open **and** document visible (`:1019-1022`) | 30 s |
| Library | mount, hash-nav, pull-to-refresh, post-commit | **never polls** |
| Releases | same as Library | **never polls** |

Two consequences for a live demo:

- **The badge lies while you are on Design.** After committing, `jobs` only advances when
  the Queue tab is open. Stand on Design and the count is frozen at its post-commit value.
- **The payoff never arrives by itself.** A finished render reaches the Library only if the
  user navigates there (which triggers `refresh()` via the hash path, `:1031`). The moment
  the demo is built around — *"and there it is, rendered"* — cannot happen while you are
  watching the Queue.

**30 s is also the wrong beat.** The README puts a variant at ~3.5 s of runner time. The
poll is an order of magnitude slower than the thing it observes, so a render can start and
finish entirely between two polls and present as a single instant jump from *Queued* to
*Done*.

**Fix:** poll on *active work*, not on *tab identity*. While any job is `Queued` or
`Rendering`, poll every ~5 s regardless of which tab is open, and back off to 30 s (or stop)
when the queue is idle. When a job flips to `Done`, refresh the library too — that is the
only signal the Library ever needs, and it makes the payoff arrive on its own.

**Related, and cheap:** `refresh()` (`:924-947`) is all-or-nothing. It `Promise.all`s four
endpoints and a single failure discards **all four** results, sets `librarySyncFailed`, and
toasts *"Could not load engine data."* One slow releases call blanks the library. Settle the
four independently and degrade per-pane.

---

## 5. F-3 — The object loses its name between tabs

This is the finding I would fix first if only one could be fixed. Follow a single variant
across the demo:

| Where | What it is called | Source |
|---|---|---|
| Design — control tooltip | **Balanced** | `OPTIONS` (`variant-labels.ts:14`) via `title=` (`:225`) |
| Design — visible caption | **Even** | `PARAM_CAPTIONS` (`:91-106`) |
| Design — screen reader | **Even** | `PARAM_ARIA_LABELS` (`:108-112`) |
| Commit toast | **"White …"** — colour only | `:1112-1116` |
| Queue card title | **White Mid Drift — Balanced** | `formatDisplayName` |
| Queue card chips | **white · mid · drift** (raw ids, no balance) | `chipsFor` (`:1736`) |

Four separate label maps for one set of values, and they disagree:

- **`balanced` is "Even" on Design and "Balanced" in the Queue.** Same for `bed-forward`
  (Bed / Smooth) and `texture-forward` (Texture / Grainy). The tooltip on Design contradicts
  the caption sitting two inches from it.
- **Chips render raw enum ids.** `chipsFor` (`:1736`) and the Library's `track-chips`
  (`:1422`) pass `variant.color`, `.band`, `.motion` straight through, so the card shows
  lowercase `white`, `mid`, `drift` beside title-case `Matrix 14`. The label map that would
  fix this is imported in the same file.
- **Balance is dropped from chips entirely** — one of the four axes the user just set does
  not appear on the card that confirms what they set.
- **The commit toast names one axis of four.** `:1112` builds its message from
  `OPTIONS.color` alone: *"White master and stems being rendered"*. Four controls were
  configured; the receipt mentions one.
- **Design never names the variant at all.** Measured `#panel-design` `innerText` contains
  no variant name — only the four captions. The user commits to something the screen has
  never named, then meets that name for the first time in the Queue.

**And there is already a function that does this correctly, unused.**
`formatVariantLabel()` (`variant-labels.ts:22`) returns `"White · Mid · Drift · Balanced"`.
Its only caller in the repository is its own test (`test/web.test.ts:105`).

**Fix — one label vocabulary, one call site each:**

1. Delete `PARAM_ARIA_LABELS`; make `OPTIONS` the single source for names, and reword
   `PARAM_CAPTIONS` to be purely explanatory (§6) rather than a competing name.
2. Route every chip through the label map — Queue `chipsFor` and Library `track-chips` —
   and add the missing balance chip.
3. Show `formatVariantLabel(selected)` on Design, next to *Create track*, so the object is
   named before it is committed.
4. Use that same string in the toast: *"White · Mid · Drift · Balanced queued"*.

The variant then carries one name from selection to library. That continuity *is* the demo.

---

## 6. F-4 — Copy that argues with the screen

- **The toast contradicts the pill.** *"…being rendered"* (`:1114`) appears while the Queue
  card for that same job reads **Queued**, and in `local` mode with no worker attached it
  will read Queued indefinitely. Both are on screen simultaneously in `03-queue.png`. Say
  **queued**, and let the Queue say when it is rendering.
- **"0 jobs ahead."** `activeCopy` (`:1737-1738`) renders `queuedJobsAhead(...)` verbatim, so
  the first job in an empty queue announces zero of something. Special-case it: **"Next up"**.
- **Six of fourteen param captions restate their own label.** `:91-106` — *"Mid — mid
  texture"*, *"Drift — drift modulation"*, *"Breathing — breathing modulation"*, *"Low-mid —
  low-mid texture"*, *"High — high texture"*, *"Even — even mix"*. The four `color` captions
  show what good looks like (*"Pink · −3 dB/oct"* teaches something). The other three axes
  should earn their line the same way — say what the control *does to the sound*, or drop
  the caption.
- **The Queue header caption truncates.** At 390 px it renders *"Queued · waiting for runner
  · Sync…"* — clipped mid-word (`03-queue.png`). Status and sync time are competing for one
  line; the sync time is the droppable half.

---

## 7. Library — the last screen in the demo

**(code read — the container has no rendered artifacts, so these were not reproduced in the browser.)**

1. **Two rename flows, side by side.** The ✨ button (`generateTitle`, `:1319`) generates a
   name and drops it into an inline edit that saves via `/api/names/rename`. The overflow
   menu's *"Suggest SEO name"* (`generate`, `:1312`) renders a **separate** review panel at
   the bottom of the card with Regenerate/Approve, saving via `/api/names/approve`. Two
   affordances, two endpoints, two persistence models, one job. Pick one.
2. **The older flow fails silently.** `generate()` (`:1312`) and `regenerate()` (`:1336`)
   never check `response.ok` and assign `payload.suggestion` unguarded — on any API error
   they set `undefined` and the panel simply never appears. `generateTitle()` (`:1319`) does
   this correctly and is the model.
3. **`approve()` (`:1345`) doesn't refresh.** It toasts success and leaves the card showing
   the old title with no `approved` marker until something else triggers a reload.
4. **Nothing coordinates playback.** Each `TrackCard` owns an independent `<audio>`
   (`:1405`). Starting a second track does not pause the first, and the Design preview is a
   separate Web Audio graph again. Two masters can overlap.
5. **The "new" badge is spent all at once.** `:969-977` marks **every** existing track seen
   the moment the Library tab opens, so the badge that should say *"your render landed"*
   is consumed by the visit itself.
6. **Playback start is unmasked.** `preload="none"` on a master served from R2 (which the
   route comments describe as "multi-hundred megabyte", `api/audio/[filename]/route.ts:15`)
   means Play is followed by dead air with no busy state. Bind the button to
   `waiting`/`canplay` and show a spinner.
7. **Incidental, not designed:** the Design preview *does* stop when you switch to Library —
   but only because `refresh()` replaces the `variants` array, which changes `selected`'s
   identity and trips the `[variant]` cleanup at `:721`. Nothing intends this. Call
   `preview.stop()` on tab change explicitly.

---

## 8. Already filed in `docs/design-quality-audit.md` — not re-reported

These surfaced again while walking the flow. They are that document's, and the fixes belong
in its work plan, not this one:

| There | Confirmed again here |
|---|---|
| **P0-2** Queue has no empty state | `#panel-queue` measured **362 × 0 px**, `innerText` `""` |
| **P2-1** Two routing models | Reload on Queue → returns to **Design**; `/` is the URL for both |
| **P2-5** Batch rendering is dead code | `queue()`'s `"pilot"`/`"full"` branches still have no call site |
| **P1-8** `StatusPill` and `Chip` look alike | The *Queued* pill is indistinguishable from *Matrix 14* |

**One new fact for P2-1.** Back from the Library does not return where you came from. From
Design → Library → Back lands on **Queue**. `libraryReturnTab` is seeded
`tab === "library" ? "queue" : tab` at `:1024`, `:1064`, and `:1210`; the Library tab button
sets it *after* the tab is already Library, so the `"queue"` fallback wins and the user is
returned to a tab they never visited. Cheap fix independent of the routing rework: capture
the departure tab before mutating the hash.

---

## 9. Work plan for Devin

Everything in Phase A is local to `web/app/noise-lab.tsx` and `web/lib/variant-labels.ts`.
Baseline is green today — `npm run typecheck`, `npm test` (45 pass), `npm run lint`,
`npm run build` all pass — so each phase should land with them still green.

### Phase A — Close the joins *(highest value, no refactor)*

1. **Toast action on commit.** `:1112` — add `action: { label: "View queue", onClick: () => setTab("queue") }`.
   *Accept:* after *Create track*, the toast offers a one-tap route to the Queue.
2. **Poll on work, not on tab.** `:1019-1022` — poll every 5 s while any job is
   `Queued`/`Rendering` regardless of active tab; 30 s or paused when idle; refresh the
   library when a job reaches `Done`.
   *Accept:* with the Design tab open, the Queue badge advances; a completed render appears
   in the Library without a manual navigation.
3. **Name the variant on Design.** Render `formatVariantLabel(selected)` in the action row.
   *Accept:* `#panel-design` `innerText` contains the variant name before commit.
4. **One label vocabulary.** Delete `PARAM_ARIA_LABELS` (`:108-112`); route Queue `chipsFor`
   (`:1736`) and Library `track-chips` (`:1422`) through the label map; add the balance chip;
   name the variant in the toast with the same string.
   *Accept:* one variant reads identically on Design, in the toast, and on both cards; no raw
   enum id (`low-mid`, `bed-forward`) is rendered anywhere. Extend `test/web.test.ts` to
   assert the shared formatter — `formatVariantLabel` gains its first real caller.
5. **Copy fixes.** "queued" not "being rendered" (`:1114`); "Next up" for zero ahead
   (`:1738`); drop the sync half of the Queue header caption at narrow widths.
6. **Correct the Library return tab.** `:1024`, `:1064`, `:1210` — capture the departure tab
   before the hash changes.
   *Accept:* Design → Library → Back returns to Design.

### Phase B — First impression

7. **Cut the splash on repeat loads.** `:978-990` — show it once per session
   (`sessionStorage`), and shorten to ~600 ms when it does show.
   *Accept:* a reload reaches interactive Design in well under 1 s.
8. **Draw the idle spectrum.** Render the selected variant's static curve from
   `bandLowHz`/`bandHighHz`/`spectrum.bell`/colour slope, so the hero card responds to the
   four controls without audio.
9. **Rewrite the six tautological captions** (`:91-106`) in the register the colour captions
   already set.

### Phase C — Library consolidation

10. **Collapse the two rename flows into one** (§7.1); delete `generate`/`regenerate`
    (`:1312`, `:1336`) or give them `generateTitle`'s error handling; make `approve()`
    (`:1345`) refresh.
11. **One player at a time**, and an explicit `preview.stop()` on tab change (§7.4, §7.7).
12. **Buffering state on Play** (§7.6).
13. **Spend the "new" badge per track**, not per visit (`:969-977`).

### Phase D — Resilience

14. **Settle `refresh()`'s four fetches independently** (`:924-947`) and degrade per pane.

---

## 10. Decisions needed from Austin

1. **Q1 — Should *Create track* navigate to the Queue, or only offer to?** A toast action
   (Phase A-1) is the conservative choice and keeps the user's place; auto-navigation makes
   the demo hands-free but takes the wheel. *Recommendation: toast action now; revisit once
   the tutorial in `first-time-user-tutorial-plan.md` exists, since a hands-on tour will want
   to drive navigation itself.*
2. **Q2 — Names for the balance axis: "Smooth / Balanced / Grainy" or "Bed / Even /
   Texture"?** Both are in the app today. *Recommendation: Smooth / Balanced / Grainy — it
   describes the result rather than the renderer's internals, and it is what the Queue and
   Library already show, so track titles already rendered stay correct.*
3. **Q3 — Poll interval while work is active.** 5 s against a ~3.5 s render is proposed. On
   `dispatch` mode this is a GitHub Actions round trip per poll per open tab — is that
   acceptable, or should it be 10 s?

---

## 11. What is good, and should not be touched

- **The Design instrument.** Four axes, glyph segments with roving `tabIndex` and haptics,
  the live spectrum with the EQ curve drawn over it, and FX sections that remember their
  previous state. Nothing in this document changes how any of it works.
- **The Queue card's diagnostics.** Failed step, exit code, duration, runner, run history
  across attempts, and a logs link — this is better failure reporting than most production
  tooling, and the two-tap retry confirm is the right amount of friction for a dispatch.
- **`lib/queue-strings.ts`.** The copy problems in §6 are all in strings that live *outside*
  this module. It is the model the other three tabs should follow, and the fixes in Phase A-5
  should land there rather than inline.
- **The commit is honest.** *Create track* queues exactly one variant, says so in its
  `aria-label`, and the FX block travels with it. The problem is never what the button does —
  only what happens next.
