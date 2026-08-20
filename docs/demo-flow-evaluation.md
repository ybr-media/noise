# First-run tour evaluation — Noise Lab console

**What this evaluates:** the guided first-run tour (`web/app/ui/tutorial.tsx`) — the nine-step
walkthrough a new user is dropped into on first sign-in, and the flow it drives them through.

**Commit under test:** `5052cbb` on `devin/demo-first-run` (the demo integration branch: phase-1
auth, phase-2 first-run tracking, phase-3 tour, the v2 redesign, and the relaunch fix). The tour
is **not on `main`** — nothing under `web/` there references it.

**Method:** production build (`npm run build && npm start`) with `NOISE_RENDERING_AVAILABLE=1`
so the render and queue steps take their **action** variants rather than the "unavailable" info
variants, served against the real `config/` matrix and the bundled `web/demo/` track. Driven with
Playwright at 390×844, walking all nine steps with **genuine clicks** — a real swatch, a real
segment, a real FX toggle, the real *Create track* button, the real dock tabs, the real player —
so every step advanced on the app's own `tour.notify(...)` events, never by forcing state.
Per `.agents/skills/testing-noise-web/SKILL.md`, auth is unconfigured locally, so the tour was
launched the way a user replays it: **(i) → Replay tutorial**.

Every number and every quoted string below was captured from the running app. Where I state a
consequence for the *authenticated* first run (which cannot be exercised locally on this branch —
there is no `NOISE_TEST_USER_FILE` hook here), I say so and cite the code path.

---

## 1. Verdict

**The tour is well built and it tells the truth about everything except itself.**

The engine is genuinely good — I want to say that first, because most of what follows is
criticism of copy and exits, not of architecture. Steps advance on real application events, so
the user actually performs each action; the spotlight is correctly non-interactive
(`pointer-events: none` verified, hit-testing the ring centre returns the real control every
time); the card flips between top and bottom anchoring so it never covers its own target. That
is a real guided tour, not a slideshow.

Three things break it, and they are all promises:

1. **It promises you will hear what you made, and hands you a stock file.** Step 1 says *"design
   a sound, render it for real, and hear the result."* Step 8 points at a **bundled demo master**,
   because your render is still queued — and the finale says so out loud (§3).
2. **The step labelled "Optional" is the one step you cannot skip.** Step 4 is an `action` step:
   no Next, no Back. The only ways past it are to do it, wait ten seconds, or abandon the tour
   (§4).
3. **Every exit is a trapdoor.** Escape — one keypress, no confirmation — ends the tour and marks
   the tutorial complete. On a real first run that also POSTs completion to the server, so the
   tour never comes back on its own (§5).

None of this needs the engine rebuilt. §9 is a work plan whose Phase A is copy, exits, and one
sidecar file.

---

## 2. The tour, as it actually runs

Nine steps in `local`/`dispatch` mode (`tutorialSteps()`, `tutorial.tsx:30-133`). Six of the nine
are `action` steps. Captured state per step:

| # | id | kind | Next | Back | Card | Advanced by |
|---|---|---|---|---|---|---|
| 1 | `welcome` | info | ✅ | — | bottom | Next |
| 2 | `param-color` | **action** | ❌ | ❌ | bottom | clicking a real swatch |
| 3 | `param-shape` | **action** | ❌ | ❌ | **top** | clicking a real segment |
| 4 | `fx` | **action** | ❌ | ❌ | **top** | toggling EQ/Reverb |
| 5 | `render` | **action** | ❌ | ❌ | bottom | real *Create track* |
| 6 | `queue-tab` | **action** | ❌ | ❌ | bottom | real dock tap |
| 7 | `queue-status` | info | ✅ | ✅ | bottom | Next |
| 8 | `library-play` | **action** ×2 | ❌ | ❌ | **top** → bottom | dock tap, then real play |
| 9 | `done` | info | ✅ (Done) | ✅ | bottom | Done |

**Back exists on 3 of 9 steps.** `.tutorial-back` renders only when `step.kind === "info"`
(`tutorial.tsx:428`). Once you are past the welcome card, you cannot go back until step 7.

**What is genuinely good, and should survive any rework:**

- **Real-event progression.** Every action step waited for the app's own handler to fire. Nothing
  advanced on a click the app hadn't actually processed.
- **The spotlight is honest.** `getComputedStyle('.tutorial-ring').pointerEvents === "none"`, and
  `document.elementFromPoint()` at the ring's centre returned the real target
  (`swatch-row`, `glyph-segment is-selected`, `custom-player`) — never the card. The highlighted
  control is genuinely the control.
- **Placement adapts.** `.tutorial-card.is-top` engaged on steps 3, 4, and 8 — exactly the steps
  whose targets sit low enough that a bottom-anchored card would cover them.
- **Back-navigation is not a trap.** I expected Back from step 7 into the completed step 6 to
  deadlock, since `tab-changed` had already fired and the Queue tab was already active. It does
  not: re-tapping the already-selected Queue tab re-fires the event and the tour moves on.
  Tested, works, no action needed.

---

## 3. F-1 — The payoff is a stock file, and the tour admits it

This is the finding that matters. Step 1 sets the promise:

> "You'll design a sound, render it for real, and hear the result. Two minutes, and you keep
> whatever you make."

Step 8 sets the task: **"Hear a master."** But which master?

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

**Fix — pick one, this is a product call (§10 Q1):**

- **(a) Reframe the promise.** Step 1 stops promising "hear the result" and promises what the tour
  can actually deliver in two minutes: design something real, send a real job, and hear what a
  finished master sounds like. Step 8 then names the demo track as a demo *on purpose*
  ("Here's one we rendered earlier — yours is still cooking"), and the existing render-done banner
  (`noise-lab.tsx:1229`, deep-linking to `#library/<variantId>`) becomes the real payoff, arriving
  later. Cheapest, and honest.
- **(b) Make the promise true.** Hold step 8 until the user's own render lands, with the tour
  parked on the Queue. Only viable if a render reliably completes in tour time — which it does not
  in `dispatch` mode.

Also fix regardless: **the finale names the variant inconsistently.** "Brown · high · drift" mixes
the display label `Brown` with raw enum ids `high` and `drift`, and drops the balance axis
entirely — one of the four things the user just chose. `snapshot.params` should use the same
formatter the Queue and Library use.

---

## 4. F-2 — The step marked "Optional" is the only one you cannot skip

Step 4 is titled **"Optional: EQ and reverb"**. Captured state:

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

Measured, from step 1 of a fresh tour:

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
at all for nearly ten seconds. Six of nine steps are action steps. If someone hesitates on two of
them — reading the copy, glancing away — that is twenty seconds of a tour that opened by promising
two minutes.

Ten seconds is also the wrong shape for the assistance: it is long enough to feel broken, and it
arrives with no warning that it is coming.

**Fix:** drop it to ~3 s, and render the button in a disabled/quiet state from the start so the
affordance is visible before it is usable. The user should never be looking at a card with no
visible way forward.

---

## 7. F-5 — The demo track contradicts the copy pointing at it

Step 8's body makes two specific claims about the track it is spotlighting. Both are false for the
bundled demo master. From `GET /api/library` and `web/demo/demo_first_render.json`:

| Step 8 says | The demo track actually has |
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
pinning it. If stems for the demo are not worth the bytes, cut "a single stem" from step 8's copy
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

## 9. Work plan for Devin

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
   `render_timestamp`; or amend step 8's copy to match. *Accept:* nothing step 8 claims is
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

### Phase C — The promise (needs §10 Q1 answered first)

11. Reframe step 1 and step 8, or hold step 8 for the user's own render (§3).

### Housekeeping

12. **`.agents/skills/testing-noise-web/SKILL.md` says the tour has "11 steps"** and lists
    `button.tutorial-next` as labelled "Done" on the last step. The step count is now **9**. The
    skill is the test contract for this feature — correct it in the same PR as any step change.

---

## 10. Decisions needed from Austin

1. **Q1 — Should the tour promise "hear your own render"?** Option (a) reframe the copy and let
   the render-done banner deliver the payoff later; option (b) hold step 8 until the user's render
   lands. *Recommendation: (a).* In `dispatch` mode a render is minutes of Actions time, so (b)
   either strands the user on the Queue or quietly becomes (a) anyway — and (a) is a copy change,
   not an engine change.
2. **Q2 — Should skipping the tour be recoverable?** I recommend yes: skip dismisses for the
   session, only completion persists. The counter-argument is that a user who skips twice is
   telling you something. If you prefer the current behaviour, then Escape at minimum must stop
   being an exit (§5.1) — one reflex keypress should not permanently consume a first run.
3. **Q3 — Is the bundled demo track worth stems and real QA?** Adding both makes step 8's copy
   true and makes the Library step demonstrate the QA story properly. The cost is repo bytes.
   *Recommendation: yes for QA numbers (a sidecar edit, no bytes), your call on stems.*
