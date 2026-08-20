# First-run tour: design review and v2 script

Reviewed by walking the merged tour (feature branch + current `main`) in the browser at
1568x993, local worker mode, seeded Library. Every finding below was observed on screen or
measured, not read off the diff.

## Verdict

The mechanics work; the *design* is a year behind the app. Four classes of problem:

1. **The spotlight isn't a spotlight.** `.tutorial-blocker-right` never gets a `right` and
   `.tutorial-blocker-bottom` never gets a `bottom`, so both render at zero size: measured
   `right: {w: 0, h: 433}`, `bottom: {w: 1553, h: 0}`. Everything to the right of the target and
   everything below it is neither dimmed nor click-blocked — 30% of the viewport width plus a
   217px strip stayed live and `elementFromPoint` returned `MAIN` there. The screen looks
   half-scrimmed, and mid-tour clicks land in the app.
2. **Steps light up controls that can't satisfy them.** `design-params` is one card holding
   Color, Band, Motion and Balance. Step 2 says "Tap a color" but rings all four rows; I clicked
   Motion → Breathing inside the ring, the variant really changed (#14 → #17) and the tour did
   nothing — no advance, no acknowledgement. Then step 3 rings the identical rect and asks for
   the shape change the user already made.
3. **Copy names things the app no longer calls that.** "texture / mix" vs the on-screen
   **Band / Motion / Balance**; "Queued, then Rendering, then Done" vs **Queued → Running →
   Ready** plus a separate header state (`Queued · waiting for runner`); "tone preset … Flat and
   Off are always safe" when the presets are **Warm Bed / Airy / Midnight / Telephone** and
   there is no Flat; "its three stems" vs a download menu of **Master / Stem… / All as .zip**.
4. **The finale claims things that didn't happen.** The FX step advances on the on/off switch —
   flipping EQ on auto-applies Warm Bed and the step is over before any preset is chosen, so the
   preset copy is never true. The play step advances on the click, not on audio: my click failed
   (an error pill appeared, `aria-label` stayed "Play track") and the tour still ended with
   "played your first master". Worse, `library-track` is the *first* card in the Library, which
   is never the render just queued — the user is congratulated for playing someone else's track.

Smaller, still worth fixing: the FX step rings two collapsed `EQ Off` / `Reverb Off` rows while
the copy talks about presets that are not on screen; the queue-step toast ("Green master and
stems being rendered") covers the highlighted dock tab; the card is pinned to the opposite screen
edge from its target (up to ~500px away, with undimmed emptiness in between); progress is 11
6px dots (unreadable, and 11 steps is too many); Skip is 12px `#63636b` in a 29x26px target.

## v2 script — 9 steps, current vocabulary

Targets in brackets. `[+]` = new `data-tour` hook needed.

1. **info** — *Make your first track* — "You'll design a sound, render it for real, and hear the
   result. Two minutes, and you keep whatever you make."
2. **action** `param-selected/color` [`design-color` +] — *Pick a color* — "Color sets the tilt
   of the noise: White is flat, Brown is deepest. The caption on the right names exactly what
   you picked."
3. **action** `param-selected/shape` [`design-shape` +] — *Now narrow it down* — "Band, Motion
   and Balance decide which part of the spectrum you keep, how much it moves, and how it's
   mixed. Change any one — the caption and the spectrum follow."
4. **action** `fx-changed` [`design-fx`] — *Optional: EQ and reverb* — "Switch EQ on and it loads
   a preset — Warm Bed, Airy, Midnight, Telephone — that you can nudge band by band. Reverb adds
   a room. Both bake into the render, not just the preview."
5. **action** `render-enqueued` [`design-render`] — *Create the track* — "Create track queues a
   real job with the engine: full-length master plus stems. Nothing here is a mock."
6. **action** `tab-changed/queue` [`dock-queue`] — *Follow it to Queue* — "That badge on Queue is
   your job. Open it."
7. **info** [`queue-job`] — *Real status, no fake progress* — "Jobs read Queued, then Running,
   then Ready, and the header says what the runner itself is doing. You don't have to wait here —
   we'll tell you when it lands."
8. **action** `tab-changed/library` + `track-played` [`dock-library`, `library-track`] — *Hear a
   master* — "Finished masters live in Library. Press play. Each one carries its own QA numbers
   and downloads as the master, a single stem, or all of it as a zip." (Two steps only if the
   dock hop needs its own beat; the play step must name whose track it is — see D4.)
9. **info** — *That's the loop* — recap from real state, then what's next: "Rename a track with
   the sparkle button, and bundle approved masters into a Release when you're ready. Replay this
   any time from the (i) button."

Releases stays out of the hands-on flow (it's a multi-step publishing workflow with its own
empty-state) and is named once, in the finale, as the next thing to explore.

## Defects to fix alongside the copy

- **D1** Give `.tutorial-blocker-right` a `right: 0` and `.tutorial-blocker-bottom` a `bottom: 0`
  (or set them from the measured rect) so all four panels cover the screen. Assert non-zero
  rects and `elementFromPoint` hitting a blocker on all four sides.
- **D2** Split `design-params` into per-row hooks so each step rings only the rows that can
  satisfy it; a param step must never light a control whose change the tour ignores.
- **D3** FX copy matches what advancing actually requires (the switch), and names real presets.
- **D4** Never congratulate for something that didn't happen: advance the play step on audio
  actually starting (not the click), and derive the finale recap from real state — if the played
  track wasn't the one just queued, say "played a master from your Library", and if the render is
  still queued say so.
- **D5** Status vocabulary: Queued / Running / Ready, header state described separately.
- **D6** "the master, a stem, or all of it as a zip" instead of "its three stems".
- **D7** Place the card adjacent to its target rather than at the opposite edge, and keep it
  clear of the toast during the dock steps.
- **D8** Show "Step N of 9" as text; dots at 9+ steps are noise.
- **D9** Skip becomes a real ≥44px target labelled "Skip tour".
