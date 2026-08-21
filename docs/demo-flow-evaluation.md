# First-run tour evaluation — Noise Lab console

**What this evaluates:** the guided first-run tour (`web/app/ui/tutorial.tsx`) — the eight-step
walkthrough a new user is dropped into on first sign-in, and the flow it drives them through.

**Commit under test:** originally `5052cbb` on `devin/demo-first-run`. **The tour has since landed
on `main`** — re-verified against `5fce2db` (`main`, PR #145 "queue-library-consolidation"), which
removed the Queue tab and folded its steps into one. Every finding below was re-checked against
that commit and **all of them still hold**; the structural facts in this section (step count, tab
names, the step table) are the current ones. See "What changed, and what didn't" below.

**Still current at `9b8971d`** (`main`, through PRs #147 hide-Library-Releases, #151 compact-dock,
#152 render-complete-email). Checked at each step:

- `.tutorial-*` CSS rules and `web/demo/demo_first_render.json`: **byte-identical** since `5fce2db`.
- `tourTrackId` fallback in `noise-lab.tsx`: unchanged (now at `:1429`); the `render-status` target
  still exists; the dock is still `["create", "library"]`.
- `tutorial.tsx`: **one copy-only change** at `9b8971d` — the `done` body and `finaleCopy()` tail
  dropped the Releases mention ("bundle approved masters under Releases" → "keep your approved
  masters together"), following #147. Step count, step kinds, targets and the `finaleCopy()`
  branch are untouched, and the finale text this document quotes ends at *"Your render is still
  queued."* — before the edited tail. **No finding is affected.**

**Method:** production build (`npm run build && npm start`) with `NOISE_RENDERING_AVAILABLE=1`
so the render step takes its **action** variant rather than the "unavailable" info variant,
served against the real `config/` matrix and the bundled `web/demo/` track. Driven with
Playwright at 390×844 with **genuine clicks** — a real swatch, a real segment, a real FX toggle,
the real *Create track* button, the real dock tabs, the real player — so every step advanced on
the app's own `tour.notify(...)` events, never by forcing state.
Per `.agents/skills/testing-noise-web/SKILL.md`, auth is unconfigured locally, so the tour was
launched the way a user replays it: **(i) → Replay tutorial**.

The spotlight findings in §9 additionally required per-frame sampling: geometry of all four scrim
divs and the ring `<rect>` read on every `requestAnimationFrame` across a step transition, plus
`elementFromPoint` probes around the hole corners at 4× device scale.

Every number and every quoted string below was captured from the running app. Where I state a
consequence for the *authenticated* first run (which cannot be exercised locally — there is no
`NOISE_TEST_USER_FILE` hook on `main` either, confirmed), I say so and cite the code path.

---

## 1. Verdict

**The tour is well built and it tells the truth about everything except itself.**

The step machine is genuinely good — I want to say that first. Steps advance on real application
events, so the user actually performs each action; the spotlight is correctly non-interactive
(`pointer-events: none` verified, hit-testing the ring centre returns the real control every
time); the card flips between top and bottom anchoring so it never covers its own target. That
is a real guided tour, not a slideshow.

**Its rendering is a different story.** The dimming and the highlight are two unrelated objects —
four plain `<div>`s and an `<svg><rect>` — with nothing binding them. They disagree about where
the spotlight is: the corners leak undimmed page, and mid-transition the two come apart by as
much as **198 px** before snapping back. At rest they agree to 0.00 px, which is why this
survives screenshot review and fails in use (§9).

Four things break the tour. Three are promises; the fourth is the edges:

1. **It promises you will hear what you made, and hands you a stock file.** Step 1 says *"design
   a sound, render it for real, and hear the result."* The `library-play` step points at a
   **bundled demo master**, because your render is still queued — and the finale says so out loud (§3).
2. **The step labelled "Optional" is the one step you cannot skip.** Step 4 is an `action` step:
   no Next, no Back. The only ways past it are to do it, wait ten seconds, or abandon the tour
   (§4).
3. **Every exit is a trapdoor.** Escape — one keypress, no confirmation — ends the tour and marks
   the tutorial complete. On a real first run that also POSTs completion to the server, so the
   tour never comes back on its own (§5).
4. **The spotlight edges are not tight.** A square hole under a rounded ring leaks live page at
   all four corners; the scrim and ring animate on separate clocks; there is no blur, in an app
   whose whole visual language is blurred glass (§9).

The step machine does not need rebuilding — but the scrim does, and it is a contained change:
one element with the hole cut out of it, instead of four that cannot track it. §10 is the work
plan.

---

## 2. The tour, as it actually runs

**Eight** steps in `local`/`dispatch` mode (`tutorialSteps()`). **Five of the eight are `action`
steps.** Enumerated from `tutorialSteps()` on `main` and walked live at 390×844:

| # | id | kind | Next | Back | tab | target |
|---|---|---|---|---|---|---|
| 1 | `welcome` | info | ✅ | — | — | — |
| 2 | `param-color` | **action** | ❌ | ❌ | `create` | `create-color` |
| 3 | `param-shape` | **action** | ❌ | ❌ | `create` | `create-shape` |
| 4 | `fx` | **action** | ❌ | ❌ | `create` | `create-fx` |
| 5 | `render` | **action** | ❌ | ❌ | `create` | `create-render` |
| 6 | `progress` | info | ✅ | ✅ | — | `render-status` |
| 7 | `library-play` | **action** | ❌ | ❌ | `library` | `dock-library` |
| 8 | `done` | info | ✅ (Done) | ✅ | — | — |

In `unavailable` mode the same eight ids appear with `render` → `render-unavailable` and
`progress` → `progress-unavailable`, both `info`, leaving **four** action steps.

**Back renders on info steps only** — `.tutorial-back` is gated on `step.kind === "info"`, so of
the three info steps one is the first card; **Back is reachable on 2 of 8**. Once you are past
the welcome card you cannot go back until step 6.

### What changed since `5052cbb`, and what didn't

**Changed (structure only):**

- The **Queue tab no longer exists**. The dock is `create`, `library` — confirmed live.
- The two queue steps (`queue-tab` action + `queue-status` info) collapsed into **one info step**,
  `progress`, targeting `render-status`. That removes a whole dock-tap action step.
- `tab: "design"` → `tab: "create"`; targets `design-*` → `create-*`.
- Step count **9 → 8**; action steps **6 → 5**.

**Not changed — every finding in §3–§9 was re-verified on `main` and still holds:**

| Finding | Status on `main` `5fce2db` |
|---|---|
| §3 payoff is a stock file | `tourTrackId` fallback identical; `finaleCopy()` still branches and still appends *"Your render is still queued."* |
| §4 "Optional" is unskippable | `fx` step is still `kind: "action"` |
| §5 Escape is a trapdoor | `if (event.key === "Escape") onSkip()` — identical |
| §6 ten seconds of nothing | `setTimeout(() => setDoItVisible(true), 10000)` — identical |
| §7 demo sidecar contradicts copy | `stem_filenames: []`, `render_timestamp: "2025-01-01T00:00:00.000Z"`, no `qa_verdict`/`qa_checks` |
| §8 confetti over the card | `.tutorial-confetti` `z-index: 3` vs `.tutorial-card` `2` — identical |
| §8 celebration swaps the body | `const body = isFinale ? finaleCopy(snapshot) : celebration ?? step.body` — identical |
| §9 spotlight edges | **CSS byte-identical.** Live on `main`: 4 blockers, ring `rx="16"`, scrim `border-radius: 0px`, `backdrop-filter: none`, padding ≈ **0 px** |

**What is genuinely good, and should survive any rework:**

- **Real-event progression.** Every action step waited for the app's own handler to fire. Nothing
  advanced on a click the app hadn't actually processed.
- **The spotlight is honest about interaction.** `getComputedStyle('.tutorial-ring').pointerEvents
  === "none"`, and `document.elementFromPoint()` at the ring's centre returned the real target
  (`swatch-row`, `glyph-segment is-selected`, `custom-player`) — never the card. The highlighted
  control is genuinely the control. *(How that spotlight is drawn is a separate matter — §9.)*
- **Placement adapts.** `.tutorial-card.is-top` engaged on exactly the steps
  whose targets sit low enough that a bottom-anchored card would cover them.
- **Back-navigation was not a trap.** On `5052cbb` I expected Back from `queue-status` into the
  completed `queue-tab` step to deadlock, since `tab-changed` had already fired and the Queue tab
  was already active. It did not — re-tapping the already-selected tab re-fired the event.
  **This test no longer applies:** both queue steps are gone on `main`, and the info step that
  replaced them (`progress`) has no target tab to return into. The equivalent risk now sits at
  Back from `done` into `library-play`; I have not re-tested that path, so treat it as unverified
  rather than as a known-good.

---

## 3. F-1 — The payoff is a stock file, and the tour admits it

This is the finding that matters. Step 1 sets the promise:

> "You'll design a sound, render it for real, and hear the result. Two minutes, and you keep
> whatever you make."

The `library-play` step sets the task: **"Hear a master."** But which master?

```ts
const tourTrackId = tourVariantId && tracks.some((t) => t.exists && t.variantId === tourVariantId)
  ? tourVariantId
  : tracks.find((track) => track.exists)?.variantId;   // noise-lab.tsx:1343-1345
```

Your render was queued seconds earlier and is not in the Library yet — at ~3.5 s of runner time
it needs a worker that a demo box does not have, and in `dispatch` mode it is a GitHub Actions
round trip of minutes. So the fallback fires and the tour spotlights **the first track that
exists**, which on any fresh deployment is the bundled `web/demo/demo_first_render.json`.

Captured at step 9, with the finale card and the track it just played on screen together
(`tour/09-done.png`):

| The user designed | The user is listening to |
|---|---|
| **Brown · high · drift** | **"Green Broad Drift — First Light"**, chipped **"Demo ×"** |

And the finale narrates it accurately, which is the part that stings:

> "You designed Brown · high · drift, queued your track, and **played a master from your
> Library. Your render is still queued.**"

`finaleCopy()` (`tutorial.tsx:155-165`) explicitly branches between *"played the master you just
queued"* and *"played a master from your Library"* — **the code knows** the user did not hear
their own work, and says so honestly at the emotional peak of a two-minute onboarding. The honesty
is right; the promise in step 1 is what is wrong.

**Fix — pick one, this is a product call (§11 Q1):**

- **(a) Reframe the promise.** Step 1 stops promising "hear the result" and promises what the tour
  can actually deliver in two minutes: design something real, send a real job, and hear what a
  finished master sounds like. `library-play` then names the demo track as a demo *on purpose*
  ("Here's one we rendered earlier — yours is still cooking"), and the existing render-done banner
  (`noise-lab.tsx:1229`, deep-linking to `#library/<variantId>`) becomes the real payoff, arriving
  later. Cheapest, and honest.
- **(b) Make the promise true.** Hold `library-play` until the user's own render lands, with the tour
  parked on the Queue. Only viable if a render reliably completes in tour time — which it does not
  in `dispatch` mode.

Also fix regardless: **the finale names the variant inconsistently.** "Brown · high · drift" mixes
the display label `Brown` with raw enum ids `high` and `drift`, and drops the balance axis
entirely — one of the four things the user just chose. `snapshot.params` should use the same
formatter the Queue and Library use.

---

## 4. F-2 — The step marked "Optional" is the only one you cannot skip

The `fx` step is titled **"Optional: EQ and reverb"**. Captured state (from the original
`5052cbb` run — the step is still `kind: "action"` on `main`, now numbered 4 of 8):

```json
{ "count": "Step 4 of 9", "title": "Optional: EQ and reverb",
  "hasNext": false, "hasBack": false, "hasSkip": true,
  "doItPresent": true, "doItVisible": false }
```

`kind: "action"` (`tutorial.tsx:95-103`), so no Next is rendered. From `tour/04-fx.png`, the only
button on the card is **"Skip tour"** — which does not skip the step, it ends the tutorial.

A user who does not want EQ or reverb on their first track — the reasonable default, and the
literal meaning of "Optional" — has three options: toggle something they didn't want, wait ten
seconds for a button they can't see yet, or quit. The card even reserves the empty action row
where Next would be, so there is a conspicuous band of blank card under the text.

**Fix:** make step 4 `kind: "info"` with a Next, and let the `fx-changed` event advance it early
if the user does experiment. That is the one step where "either do it or move on" is exactly the
right semantics, and the engine already supports both halves.

---

## 5. F-3 — Every exit is a trapdoor, and Escape is the trapdoor you fall through

Measured, from step 1 of a fresh tour (original `5052cbb` run; the Escape handler is byte-identical
on `main`):

```
before Escape : {"count":"Step 1 of 9","title":"Make your first track"}
after Escape  : {"gone":true}
localStorage["noise.tutorial.done"] = "1"
```

One Escape keypress, no confirmation, and the tutorial is over and marked done
(`tutorial.tsx:378-380` → `onSkip` → `complete()` → `onComplete: firstRun.markCompleted`,
`noise-lab.tsx:958`).

**On a real authenticated first run this is worse than local.** `complete()` runs
`if (shouldPersistTutorial(authConfigured, replayRef.current)) void fetch("/api/me/tutorial", { method: "POST" })`
(`tutorial.tsx:203`). Locally `authConfigured` is false and I was in replay, so nothing
persisted; on the hosted demo both are true on a first run, so completion is written server-side
and `firstRunShouldLaunch()` (`use-first-run.ts:26`) will never fire again for that user. Escape is
a reflex — people press it to dismiss the notification, the keyboard, anything. **Code path, not
reproduced locally; flagged as such.**

Compounding it: **"Skip tour" is the most prominent button on every action step** — on steps 2–6
and 8 it is the *only* button — and it is equally final and equally unconfirmed.

**Fix:**
1. Escape should not complete. Either ignore it, or show "Leave the tour? You can replay it from
   the (i) button" with Leave / Stay.
2. Separate *dismiss* from *complete*. Skipping should let the tour come back on the next visit —
   only reaching step 9 should mark it done. At minimum, do not POST completion on a skip.
3. Give "Skip tour" the visual weight of an escape hatch, not the primary action on the card.

---

## 6. F-4 — Ten seconds of nothing on every action step

Measured: **`.tutorial-do-it` became visible 9,884 ms after the step opened**
(`setTimeout(..., 10000)`, `tutorial.tsx:301`).

On an action step the user either performs the action or looks at a card with no forward control
at all for nearly ten seconds. Five of eight steps are action steps. If someone hesitates on two of
them — reading the copy, glancing away — that is twenty seconds of a tour that opened by promising
two minutes.

Ten seconds is also the wrong shape for the assistance: it is long enough to feel broken, and it
arrives with no warning that it is coming.

**Fix:** drop it to ~3 s, and render the button in a disabled/quiet state from the start so the
affordance is visible before it is usable. The user should never be looking at a card with no
visible way forward.

---

## 7. F-5 — The demo track contradicts the copy pointing at it

The `library-play` step's body makes two specific claims about the track it is spotlighting. Both are false for the
bundled demo master. From `GET /api/library` and `web/demo/demo_first_render.json`:

| `library-play` says | The demo track actually has |
|---|---|
| "Each one carries its own **QA numbers**" | `qaVerdict: "UNAVAILABLE"`, LUFS `–`, true peak `–`, **0 QA checks** |
| "downloads as the master, **a single stem**, or all of it as a zip" | `stem_filenames: []` — **no stems** |

Visible in `tour/09-done.png`: the QA strip under the player reads **UNAVAILABLE** with two
em-dashes, directly beneath the sentence claiming QA numbers.

Third problem in the same card: **"Created Jan 1, 2025"**, from a hardcoded
`"render_timestamp": "2025-01-01T00:00:00.000Z"`. A twenty-month-old date on the one track a
first-time user is told to open.

**Fix (cheapest item in this document):** regenerate the demo sidecar with real QA numbers and at
least one stem so the copy is true, and set `render_timestamp` at build or first read rather than
pinning it. If stems for the demo are not worth the bytes, cut "a single stem" from the `library-play` copy
instead — but do not ship a sentence the spotlighted track disproves.

---

## 8. F-6 and F-7 — Two visual defects in the moments that matter

**F-6. Confetti renders on top of the finale card.**

```css
.tutorial-confetti { z-index: 3; }   /* globals.css:291 */
.tutorial-card     { z-index: 2; }   /* globals.css:292 */
```

In `tour/09-done.png` the particles are drawn across the headline ("That's the loop") and over the
Download button beneath. The celebration defaces the card it is celebrating. **Fix:** put the
canvas behind the card (`z-index: 1`).

**F-7. The card collapses on every success.**

`body = isFinale ? finaleCopy(...) : celebration ?? step.body` (`tutorial.tsx:405`) — for 420 ms
the instruction is *replaced* by "Nice — that's exactly it." Measured on step 2:

| | card height |
|---|---|
| instruction showing | 223.16 px |
| celebration showing | 142.56 px |
| back to instruction | 223.16 px |

**An 80.6 px collapse-and-reflow, twice, on each of six action steps.** And because it replaces
rather than accompanies the instruction, the text explaining what you just did vanishes at the
moment you succeed — exactly when a user looks back at the card to confirm.

**Fix:** show the celebration as a line *above* or beside the instruction, or reserve the height.
Never swap the body.

---

## 9. F-8, F-9, F-10 — The spotlight edges

The three findings in this section are one bug wearing three faces, so read the diagnosis before
the fixes. **The dimming and the highlight are two separate objects.** The scrim is four plain
`<div>`s; the ring is an `<svg><rect>`. Nothing binds them together, so their edges disagree — at
rest, in motion, and in style.

```tsx
<div className="tutorial-blocker tutorial-blocker-top"    style={{ height: rect.top }} />
<div className="tutorial-blocker tutorial-blocker-left"   style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
<div className="tutorial-blocker tutorial-blocker-right"  style={{ top: rect.top, left: rect.right, right: 0, height: rect.height }} />
<div className="tutorial-blocker tutorial-blocker-bottom" style={{ top: rect.bottom, bottom: 0 }} />
<svg className="tutorial-ring"><rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx="16" /></svg>
```
<sub>`tutorial.tsx:411-416`</sub>

### F-8. The hole is square; the ring is round. The corners leak.

The ring is drawn with `rx="16"`. The four scrim divs have `border-radius: 0`. So the dimmed
region stops in a hard right angle while the highlight curves away from it, and the crescent
between them is **undimmed live page**.

Measured on step 2, spotlight at `x:30 y:365.5 w:330 h:112`:

| | value |
|---|---|
| ring corner radius | `rx="16"` |
| scrim hole corner radius | `0px` |
| `elementFromPoint` at hole corner **+2,+2** | `param-row` — **the live page** |
| `elementFromPoint` at hole corner **+4,+4** | `param-row` |
| `elementFromPoint` at hole corner **+8,+8** | `param-row` |
| `elementFromPoint` **outside** the hole (−6,−6) | `tutorial-blocker-top` ✅ |

The scrim is not merely lighter at the corners — it is **absent**. About **55 px² per corner**
(`r² − πr²/4` at r=16), four corners, on every step. `edges-corner-TL.png` shows it at 4× zoom: a
pale wedge sitting outside the red arc, brighter than the scrim around it.

### F-9. The scrim and the ring do not move together.

This is the one that reads as "not tight". Frame-by-frame trace of a step advance, sampling the
top blocker's inner edge against the ring's `y`, every `requestAnimationFrame`:

| dt (ms) | scrim hole top | ring `y` (attr) | ring `y` (computed CSS) |
|---|---|---|---|
| 0–400 | 365.5 | 365.5 | 365.5 |
| **434** | 365.5 | **477.5** | 365.5 |
| 467 | 365.5 | 469.5 | 365.5 |
| 500 | 365.5 | 444.5 | 365.5 |
| 534 | 365.5 | 404.5 | 365.5 |
| 567 | 365.5 | 360.5 | 365.5 |

The ring's geometry **attribute** snaps to the new target and then eases, while the scrim holds its
old position. Peak divergence across the move:

| measurement | peak |
|---|---|
| scrim inner edge vs. ring, vertical | **112.00 px** |
| left blocker bottom vs. bottom blocker top | **197.50 px** |
| scrim inner edge vs. ring, horizontal | 0.00 px |

For roughly a quarter of a second on **every one of the seven transitions**, the ring is floating
over a hole that is somewhere else, and the scrim is torn open along a ~198 px seam. At rest all
these deltas are 0.00 px — which is why it looks fine in a screenshot and wrong in use.

The cause is two animation systems driven from one state update: CSS transitions on SVG geometry
(`transition: x .45s, y .45s, width .45s, height .45s`, `globals.css:288`) versus CSS transitions
on div layout (`transition: top, right, bottom, left, width, height` × `.45s`, `globals.css:282`).
Note the computed CSS `y` never changes at all — only the attribute does — so the two layers are
not even interpolating the same quantity.

Two aggravating factors in the same declarations:

- **The ring pulses while it travels.** `animation: tutorial-pulse 1.8s ease-in-out infinite`
  (opacity `.72 ↔ 1`) keeps running through the move; measured range during the transition was
  **0.72 → 1.00**. The highlight fades in and out *while* relocating, which reads as flicker
  rather than a confident move.
- **Twenty-four animated layout properties.** Four divs × six properties, all of
  `top/right/bottom/left/width/height` — none composited, all forcing layout each frame.

### F-10. There is no blur, and the timing is a fourth motion curve.

The scrim is flat `rgba(22,22,26,.58)`; `backdrop-filter` computes to **`none`**. The app uses
`backdrop-filter: blur(...)` in three places — `.glassbar` (`blur(22px) saturate(190%)`),
`.action-row` (`blur(18px) saturate(180%)`), `.release-footer` (`blur(18px)`). The tour is the one
full-screen surface in the product that dims the app and it does not participate in the app's own
glass idiom.

The tour also invents its own motion: `.45s cubic-bezier(.32,.72,0,1)`, against the declared
tokens `--dur-nav: 260ms` and `--ease-nav: cubic-bezier(.2,.8,.25,1)`. `docs/design-quality-audit.md`
P1-4 already counted three navigation durations against those tokens; this is the fourth.

### The fix: make the hole and the ring the same object

Do not tune the four divs — they cannot be made to track a separately-animated ring, and adding
`border-radius` to each one still cannot produce a rounded hole. Collapse the scrim to **one
element with the hole cut out of it**, and drive the ring from the same numbers.

```tsx
// one scrim, one source of geometry
const pad = 8;
const r   = 16;
const x = rect.left - pad, y = rect.top - pad;
const w = rect.width + pad * 2, h = rect.height + pad * 2;

<div
  className="tutorial-scrim"
  style={{ clipPath: `path(evenodd, '${viewportRect()} ${roundedRect(x, y, w, h, r)}')` }}
/>
<svg className="tutorial-ring"><rect x={x} y={y} width={w} height={h} rx={r} /></svg>
```

```css
.tutorial-scrim {
  position: fixed; inset: 0; z-index: 0; pointer-events: auto;
  background: rgba(22,22,26,.52);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
          backdrop-filter: blur(14px) saturate(140%);
}
```

Why this settles all three findings at once:

- **F-8 disappears by construction** — the hole *is* the rounded rect, same `r` as the ring, so
  there is no corner region to leak through.
- **F-9 disappears** if both the `clipPath` string and the `<rect>` attributes are written from
  one eased value. Interpolate `{x,y,w,h}` yourself in a `requestAnimationFrame` loop (or a small
  spring) and set both in the same frame — then they are incapable of desyncing. Do **not** rely
  on two independent CSS transitions again.
- **F-10** is one declaration: blur on the scrim, and retire `.45s cubic-bezier(.32,.72,0,1)` in
  favour of `--dur-nav`/`--ease-nav`.

Also: **pad the hole.** Today it is the raw `getBoundingClientRect()`, so padding measures
**0 px on every side** and the 3 px ring straddles the control's own edge — 1.5 px of the
highlight lands *on* the thing it is highlighting. A `pad` of 6–8 px is what makes a spotlight
look deliberate rather than shrink-wrapped.

And **stop the pulse during the move** — gate it on a settled state, or drop the infinite pulse
entirely in favour of a single attention beat when the ring arrives.

Two implementation notes so this doesn't stall:

- `clip-path: path()` on an HTML element is Chromium/Safari-supported but **not** Firefox
  (`path()` is behind a flag there). If Firefox matters, use `mask-image` with an inline SVG
  `<mask>`, or an SVG `<path fill-rule="evenodd">` scrim — the SVG route loses `backdrop-filter`,
  so it is blur *or* Firefox unless you layer a blurred div beneath a masked one.
- Keep the reduced-motion block (`globals.css:369-374`); it already kills these transitions
  correctly and the rAF loop must honour it too — snap, don't interpolate.

**Accept for the whole section:** at every step and at four sampled frames per transition,
(a) `elementFromPoint` inside the scrim region returns the scrim, never page content, including
within 8 px of each hole corner; (b) the scrim's inner edge and the ring's rect agree to within
1 px on all four sides; (c) `backdrop-filter` on the scrim is not `none`; (d) padding between the
target's bounding box and the hole is ≥ 6 px on all four sides.

---
## 10. Work plan for Devin

Baseline on `devin/demo-first-run` builds clean. Everything in Phase A is confined to
`web/app/ui/tutorial.tsx`, `web/app/globals.css`, and `web/demo/demo_first_render.json`.

### Phase A — Stop the tour contradicting itself

1. **Make "Optional" optional** (§4). Step 4 → `kind: "info"` with Next; keep `fx-changed`
   advancing it early. *Accept:* step 4 renders a Next button; toggling EQ still advances it.
2. **Escape must not complete the tutorial** (§5). *Accept:* Escape either does nothing or
   confirms; after an Escape, `noise.tutorial.done` is unset and no `POST /api/me/tutorial` is
   issued.
3. **Skip ≠ complete** (§5). Only step 9 marks the tutorial done. *Accept:* skipping at step 3,
   then reloading as the same user, relaunches the tour.
4. **Fix the demo sidecar** (§7) — real QA numbers, at least one stem, non-hardcoded
   `render_timestamp`; or amend the `library-play` copy to match. *Accept:* nothing that step claims is
   contradicted by the card it spotlights.
5. **Confetti behind the card** (§8). *Accept:* no particle overlaps the finale text.
6. **Stop the celebration swapping the body** (§8). *Accept:* card height is unchanged between
   instruction and celebration on every action step.
7. **Name the variant consistently in the finale** (§3). *Accept:* `snapshot.params` reads the
   same as the Queue card title, balance axis included.

### Phase B — Pacing and exits

8. **"Do it for me" at ~3 s, visible-but-quiet from 0 s** (§6).
9. **Demote "Skip tour"** from primary-by-default to a quiet escape hatch (§5).
10. **Back on action steps.** Back is `info`-only today; there is no reason an action step cannot
    return to the previous step, and it removes the "my only option is to quit" feeling that
    powers §4 and §5.

### Phase C — Tighten the spotlight (§9)

This is one change, not four, and the order matters — do 11 first and 12–14 come nearly free.

11. **Collapse the four blockers into one scrim with the hole cut out** (§9). One element,
    `clip-path: path(evenodd, …)` (or an SVG `<mask>` if Firefox is in scope), rounded to the
    same `r` as the ring. *Accept:* `elementFromPoint` returns the scrim everywhere outside the
    hole, including within 8 px of each corner.
12. **Drive the scrim path and the ring rect from one eased value in one frame** (§9) — a `rAF`
    interpolation, not two CSS transitions. *Accept:* sampled at four frames per transition, the
    scrim's inner edge and the ring agree within 1 px on all four sides.
13. **Pad the hole 6–8 px** (§9). Today it is the raw `getBoundingClientRect()` and the 3 px ring
    lands on the control. *Accept:* padding ≥ 6 px on all four sides.
14. **Blur the scrim, and use the motion tokens** (§9). `backdrop-filter: blur(14px)
    saturate(140%)`; retire `.45s cubic-bezier(.32,.72,0,1)` for `--dur-nav`/`--ease-nav`.
    *Accept:* computed `backdrop-filter` is not `none`; no fourth easing curve in
    `globals.css`. Keep the reduced-motion block honouring both — snap, don't interpolate.
15. **Stop the ring pulsing while it travels** (§9). Measured 0.72 → 1.00 opacity mid-move.
    *Accept:* opacity is constant for the duration of a transition.

### Phase D — The promise (needs §11 Q1 answered first)

16. Reframe `welcome` and `library-play`, or hold `library-play` for the user's own render (§3).

### Housekeeping

17. **`.agents/skills/testing-noise-web/SKILL.md` says the tour has "11 steps"** (`:50`) and lists
    `button.tutorial-next` as labelled "Done" on the last step. The step count is now **8**. The
    skill is the test contract for this feature — correct it in the same PR as any step change.
    *Note:* the skill was edited as recently as PR #153 ("Update testing-noise-web skill for
    render-email routes") and the stale count survived that edit, so it will not fix itself. It
    also still describes the removed Queue tab ("keeps the Queue/Library dock steps tappable",
    `:381`) and "render/queue steps" (`:383`).

---

## 11. Decisions needed from Austin

1. **Q1 — Should the tour promise "hear your own render"?** Option (a) reframe the copy and let
   the render-done banner deliver the payoff later; option (b) hold `library-play` until the user's render
   lands. *Recommendation: (a).* In `dispatch` mode a render is minutes of Actions time, so (b)
   either strands the user on the Queue or quietly becomes (a) anyway — and (a) is a copy change,
   not an engine change.
2. **Q2 — Should skipping the tour be recoverable?** I recommend yes: skip dismisses for the
   session, only completion persists. The counter-argument is that a user who skips twice is
   telling you something. If you prefer the current behaviour, then Escape at minimum must stop
   being an exit (§5.1) — one reflex keypress should not permanently consume a first run.
3. **Q3 — Is the bundled demo track worth stems and real QA?** Adding both makes the `library-play` copy
   true and makes the Library step demonstrate the QA story properly. The cost is repo bytes.
   *Recommendation: yes for QA numbers (a sidecar edit, no bytes), your call on stems.*
