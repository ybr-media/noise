# Design quality audit — Noise Lab console

**Scope:** `web/app/noise-lab.tsx` (1,727 lines), `web/app/globals.css` (388 lines),
`web/app/ui/*` (8 primitives), `web/scripts/check-tokens.mjs`.
**Method:** full code read, plus the app built and driven with Playwright at 390×844 and
1280×900 — every tab in default, populated, scrolled, empty, and **API-failure** states.
Every number below is measured, not estimated.
**Follows:** `docs/tab-cohesion-audit.md` (Aug 2026). This audit checks what landed, and audits
what the app is now.

---

## 1. Verdict

**The design system was installed. It was never adopted.**

The last audit asked for five phases. Phases 1 and 2 shipped and shipped well: there is a real
token block, there are eight extracted primitives in `web/app/ui/`, and **zero hex literals remain
outside `:root`** — the exact acceptance criterion that was set. That is genuine progress and it
should be said plainly.

Phases 3, 4, and 5 did not happen. What happened instead, judging by the ~30 commits since, was a
long run of one-line nudges: *Capitalize 'Synced' in Queue sync caption*, *Vertically center Library
header sync caption*, *Center Library header sync caption*, *Tighten Library header whitespace to
match Queue*. Four separate pull requests spent hand-aligning two captions that the last audit had
already said should be **one component**.

That is the pattern this audit is about. The system exists as a document and is bypassed as a
practice:

| | declared | actually used |
|---|---|---|
| Type scale | 8 tokens | **46 raw `px` font sizes** vs 17 tokenised |
| Colour | 0 hex outside `:root` ✅ | **60+ raw `rgba()`**, incl. 4 on a brand red that was retired |
| Shadow | — | **24 unique `box-shadow` values**, no token |
| Nav motion | `--dur-nav`, `--ease-nav` | **2 call sites**, neither is the tab transition or the lens |
| `Card` padding API | `sm` \| `md` | `md` ×25, `sm` ×0 — and **20 of 25 override it with a class** |
| `EmptyState` API | `icon, title, body, action` | **3 call sites, all `title`-only** |

And the guardrail that was built enforces the half of the rule that was already satisfied.
`check-tokens.mjs` verifies that declared tokens are referenced and referenced tokens are declared.
It does not — and cannot — see a raw `14px`, an `rgba(229,72,60,.38)`, or a fourth navigation
duration. **The codebase passes its own design lint while systematically routing around the design
system.**

It is also worse than that: **`check:tokens` is not wired into CI at all.** `.github/workflows/ci.yml`
runs `typecheck`, `lint`, and `test` in the `web` job and never calls it. The single guardrail this
codebase has for its design system is a `package.json` script that nothing runs automatically.
Adding one line to `ci.yml` is the cheapest item in this entire document, and Phase 5's stylelint
rule is the missing piece behind it — without both, the token layer erodes back to where it started.

Underneath that, one finding outranks everything else in this document, and it is not a
consistency problem:

> **When the API is unreachable, the app renders a title, an info button, a dock, and nothing else.**

Measured, not inferred. With `/api/**` blocked, the entire text content of `.noise-page` is the
string `"Noise Lab"` — the screen-reader-only `<h1>`. The one error signal is a toast that deletes
itself after five seconds, and because no tab has a pointer-driven refresh control, a mouse user's
only recovery is to reload the page. The app is beautiful when it has data and blank when it
doesn't.

---

## 2. Severity

- **P0** — the app is unusable, misleading, or inaccessible. Ship first.
- **P1** — the design system is being bypassed; every week this waits, the divergence grows.
- **P2** — real, worth doing, not urgent.

---

## 3. P0 — Dead ends and untrue states

### P0-1. The Design tab renders nothing when data fails to load

`noise-lab.tsx:1158-1185`. The panel is:

```tsx
{initialLoad && !selected && <DesignSkeleton />}
{selected && ( …the entire tab… )}
```

`initialLoad` is `loading && !everLoaded` (`:922`). Once `refresh()` has settled — success **or**
failure — `everLoaded` is true, so `initialLoad` is false forever. If `selected` is undefined the
panel renders **neither branch**. `selected` is a `.find()` over four selectors (`:917`), so it is
undefined whenever the variants list is empty (any API failure) or the current four-way combination
isn't in `config/variants.yaml`.

Verified with `/api/**` blocked: `document.querySelector(".noise-page").innerText` → `"Noise Lab"`.
The screenshot is a heading, an ⓘ, and a gradient.

The only signal is `setToast({ message: "Could not load engine data.", error: true })` at `:941`,
and `Toast` unmounts itself after 5,000 ms (`:310-312`). `ToastState` already supports an `action`
(`:306`) and this call site doesn't use it.

**Fix:** give Design the same three states every other tab has — skeleton, empty, error. The error
state needs a visible **Retry** that calls `refresh()`, and the load-failure toast should carry an
action rather than being the only channel. Distinguish "the engine is unreachable" (retry) from
"this combination isn't in the matrix" (adjust selection) — they are different messages.

### P0-2. The Queue has no empty state

An idle Queue renders **zero characters**. Measured: `#panel-queue` `innerText` is `""`.

`:1724` — `section()` returns `null` for an empty bucket, and `:1726` composes four possibly-empty
sections with nothing behind them. Library (`:1265`) and Releases (`:1398`) both render an
`EmptyState` in exactly this situation, so the app disagrees with itself about whether "nothing
here" deserves an explanation. This was Phase 3 item 4 of the previous audit and is the single
most visible thing that didn't get done. Side by side, Releases explains itself and Queue is a
blank page under a live-looking green status dot reading "Idle · Synced just now".

**Fix:** `EmptyState` with an action pointing at Design — the queue is empty because nothing has
been rendered, and the next step is to render something.

### P0-3. No tab can be refreshed with a mouse

| tab | pointer | touch |
|---|---|---|
| Design | — | — |
| Queue | — | pull-to-refresh |
| Library | — | pull-to-refresh |
| Releases | — | — |

`usePullRefresh` binds touch events only. Releases receives an `onRefresh` prop (`:1188`) that is
forwarded to `ReleaseDetail` and only ever fires after a successful save (`:1478`) — `ReleaseList`
never calls it. The round refresh button the previous audit recorded on Releases is gone, so
pointer refresh is now at zero across the whole app.

The sole exception is the Library's `"Sync failed — retry"` caption (`:1238`), which requires a
failure to have already happened *and* the page to be scrolled within 24 px of the top.

Combined with P0-1 this is the recovery trap: data fails → Design is blank → the toast expires →
there is no control anywhere that re-fetches.

**Fix:** one `<RefreshControl>` that renders a button for pointers and keeps the pull gesture for
touch, on all four tabs. This was Phase 3 item 3.

### P0-4. Four colour pairs in the token set fail WCAG AA

Computed from the declared tokens:

| pair | ratio | verdict | where it shows |
|---|---|---|---|
| white on `--brand #e2483b` | **4.02:1** | fails AA (needs 4.5) | **every primary button label** — Create track, Approve names, Mark submitted |
| `--success` on `--success-bg` | **3.23:1** | fails AA | the **PASS** pill — the QA verdict |
| `--link #007aff` on white | **4.02:1** | fails AA | every link |
| `--ink-tertiary #8e8e93` on white | **3.26:1** | fails AA | disabled download label |
| glyph-segment `rgba(29,29,31,.45)` | **2.74:1** | fails even the 3:1 graphics floor | **the Band / Motion / Balance icons** — the primary controls |

The brand value was deliberately settled at `#e2483b` in the last audit for continuity of focus
rings and selected states. That reasoning was sound and is unaffected here: `#e2483b` is fine as a
*stroke* — rings, selected borders, the EQ fill. It cannot carry white *text* at 13 px. These are
two different jobs and they need two different values.

**Fix:** add `--brand-ink` (a darkened brand for filled buttons, ~`#c4392b` already reaches 5.9:1),
keep `--brand` for strokes and fills-without-text; darken `--success` for on-tint text; take
`--link` to `#0063cc`; raise the unselected segment icon to at least 3:1. `--ink-tertiary` should
stop being used for text at all.

### P0-5. `role="menu"` and `aria-modal` without the behaviour they promise

Three overflow menus (`:1355`, `:1362`, `:1698`) declare `role="menu"` / `role="menuitem"` but have
no arrow-key handling, no focus move into the menu, and no focus restore to the trigger. The remove
sheet (`:1726`) declares `role="dialog" aria-modal="true"` with no focus trap, no initial focus, and
no restore — so focus tabs straight out into the page the dialog claims to have made inert.

Worth noting as contrast: `radioArrowHandler` (`:194-206`) implements roving `tabIndex` and arrow
keys **correctly** for the segmented controls. The app knows how to do this. It just hasn't done it
where it announced that it would. Declaring the role and omitting the interaction is worse than
using a plain `<div>`, because assistive tech states a contract the widget doesn't honour.

### P0-6. The splash screen says a different product name

`layout.tsx:5` and the `<h1>` say **Noise Lab**. The intro wordmark — the first thing every user
sees, at `clamp(22px, 6vw, 32px)` — says **Noise Labs** (`:1151`). One character, maximum
prominence, thirty seconds to fix.

---

## 4. P1 — The system is declared and bypassed

### P1-1. Type: 46 raw sizes against an 8-token scale

`globals.css` has **46** raw `font-size: Npx` declarations and **17** tokenised ones. The raw
values: `12px` ×15, `11px` ×13, `14px` ×5, `13px` ×5, `10px` ×5, `26px`, `18px`, `16px`.

This is not a pure find-and-replace, and that is why it stalled. Four of the eight raw sizes —
**14, 16, 18, 26** — have no equivalent in the scale, which jumps 13 → 15 → 17 → 21 → 30. Someone
has to decide whether `.section-title` at 14 becomes `--text-sm` (12) or `--text-md` (15), and
whether `.panel-heading h2` at 26 becomes `--text-xl` (21) or `--text-display` (30). Those are five
or six judgement calls, and once made the remaining ~40 sites are mechanical.

Also note the volume of very small type: five declarations at `10px` (`.approved-marker`,
`.release-track-meta`, `.qa-metric-label`, `.track-menu small`, `.fx-eq-value/label`) and thirteen
at `11px`. `--text-2xs: 10px` is below every platform guideline for body-adjacent text. It should
be reserved for the count badge, or removed.

### P1-2. Colour: the hex rule was met, and `rgba()` walked around it

Zero hex literals outside `:root` — the stated goal, achieved. But 60+ raw `rgba()` values were
never in scope and now carry most of the app's depth and hairlines:

- `rgba(0,0,0,.06)` ×6, `.04` ×5, `.08` ×4, `.12` ×3, `.05` ×2 — the hairline separator has **three
  different values** (`.06` on `.param-row`, `.08` on `.queue-diagnostics`, `.09` on `.qa-checks`)
  while `--separator: #d8d8dc` exists for exactly this.
- **`rgba(229,72,60,…)` ×4** — that is `#e5483c`, the *old* brand red, retired by the last audit.
  It survives in the play button's glow, the primary button's shadow, the count badge's shadow, and
  `@keyframes pulse`. Every red glow in the app is cast by a colour that no longer exists in the
  token set.

### P1-3. Shadow: 24 unique values, zero tokens

Elevation is the most-repeated visual decision in the app and the only major one with no token at
all. Three tiers would cover every case (`--shadow-card`, `--shadow-raised`, `--shadow-overlay`).

### P1-4. Motion: one gesture, three durations, and unused tokens

Changing tabs animates three things on three timings:

| element | timing |
|---|---|
| `.panel-show` (`:77`) | `.32s cubic-bezier(.2,.8,.25,1)` |
| `.tab-lens` (`:264`) | `.38s cubic-bezier(.3,1.35,.4,1)` |
| `.dock-tab` colour (`:265`) | `var(--dur-nav)` = 260 ms, with `ease` — not `--ease-nav` |

`--dur-nav` and `--ease-nav` were added for precisely this and have **two call sites in the
codebase**, neither of which is the panel transition or the lens. The token didn't replace the
opinions; it became a fourth one. The incoming panel still rises with no paired fade-out, so the
transition is a cut with a slide on the end of it.

### P1-5. Two styling systems, and one component that escaped both

`globals.css` is the design system; Tailwind is also loaded (`globals.css:1-3`) and used in
scattered places — `:316`, `:532-534`, `:1150`, `:1168`, `:1401`, `:1425`. Most are incidental
layout utilities. One is not: the SEO-name review panel at **`:1363`** is built entirely from
Tailwind utilities, with `rounded-xl` (12 px — not one of the four radius tokens), its own border,
its own spacing, and its own type sizes including `text-[10px]`.

It is the only surface in the app that is outside the design system in both directions: it doesn't
use the CSS layer and it doesn't use the primitives. It should be rebuilt from `Card` + `Button` +
the type tokens.

Third channel: inline `style={{}}` for the app's typeface (`:1150`). The single most global design
decision in the product — the font stack — is a JSX attribute on `<main>` rather than a token on
`body`. Move it to `globals.css`, or to `next/font`.

---

## 5. P1 — Primitives adopted at the minimum viable depth

Phase 2 built the right components. Adoption stopped at the narrowest possible call.

### P1-6. `Card`'s padding API is inert

25 call sites. **All 25** pass `padding="md"`. **20 of them** then override it with a class:
`.spectrum-card` (22/24), `.controls-card` (0/24), `.track-card` (20/24), `.release-card` (20),
`.release-section` (4/20/20), `.track-row` (12/16). `padding="sm"` has **zero** call sites and
`.card-padding-sm` is dead CSS.

The prop should either express the real set of paddings or be deleted in favour of the classes that
are actually doing the work. Right now it is API-shaped decoration.

### P1-7. `EmptyState` has four props and uses one

Three call sites (`:1265`, `:1398`, `:1600`), all `title`-only. `icon`, `body`, and `action` are
unused everywhere. The result on screen is a 180 px white slab containing one line of bold grey
text, centred — which is why the empty Library and empty Releases read as *broken* rather than as
*ready and waiting*.

Every empty state in this app is a place where the user's next action is knowable, and none of them
say it: Library-empty → "Render your first track" → Design. Releases-empty → "Start with the pilot
EP". Cover-art-empty → the Generate button is already right there and should be the `action`.

The three copy strings are also in three voices — *"No rendered files found."* (systems language,
and "files" appears nowhere else in the UI — everything else says *masters* or *tracks*),
*"No releases yet."*, *"No art yet — generate a seed below."*

### P1-8. `StatusPill` and `Chip` are the same component, so status is invisible

`globals.css:111` gives `.chip` and `.status-pill` one shared base rule. Line 114 then declares:

```css
.chip-active, .status-pill-active { color: var(--ink-secondary); background: var(--surface-sunken); }
```

Those are the two values the base rule already set. **`.status-pill-active` is a no-op.**

The consequence is on `:1699`, where a Queue card renders its status pill and its metadata chips in
the same flex row:

```tsx
{activeItem && <StatusPill state="active">Rendering</StatusPill>}
{chipsFor(latest.variantId).map(chip => <Chip key={chip}>{chip}</Chip>)}
```

So **"Rendering" is pixel-identical to "white" and "mid"**. The most important word on the Queue tab
has no more visual weight than a parameter label. Phase 2 collapsed the two components so
thoroughly that the semantic distinction they existed to carry was collapsed with them.

Only `success` and `danger` are visually distinct; `active`, `queued`, `rendering`, `pending` and
every unrecognised string all land on neutral.

**Fix:** give `active` a real tone (the `--link` family already means "in progress" for the sync
dot), and let a status pill differ from a chip in weight or shape so the eye can sort them.

Related: `status-pill.tsx` types `state` as `string` and hand-rolls a ternary chain, while `:1401`
casts a value *to* a union the component never declares. Make `state` the union and delete the cast.

### P1-9. `Banner` is used as a container and then un-bannered

`:1702` and `:1719` render `<Banner tone="danger" className="queue-failure-content">` inside a
disclosure, and `.queue-failure-content` (`globals.css:294`) cancels the banner's margin, border,
and radius to make it fill the strip. That is a missing primitive wearing another one's clothes —
what those sites need is a neutral inset "tray" surface.

---

## 6. P2 — Navigation, layout, and drift

### P2-1. Two routing models, unchanged

Phase 4 was not started. Measured hash values while clicking each tab:

| clicked | resulting hash |
|---|---|
| Queue | `""` |
| Library | `#library` |
| Releases | `#releases` |
| Design | `""` |

Design and Queue are React state and share the empty hash — so they are indistinguishable in
history, neither is deep-linkable, and Back from either exits the app. Library and Releases are
routes, so Back works there. `libraryReturnTab` and its guess (`:1024`, `:1064`) are still present.
Panels still render in `design, library, queue, releases` order (`:1158-1188`) against a dock in
`design, queue, library, releases` order (`:1204`), so keyboard and screen-reader traversal still
disagree with the screen. Scroll is still reset to 0 on every switch (`:1222`) rather than persisted
per tab.

### P2-2. The dock sits on top of live controls

Confirmed at both viewports. At 1280×900 the glass bar floats directly over the **Balance**
segmented control, and because `.glassbar` is translucent with no scrim, the control's segments are
legible *through* the bar. `.noise-page` reserves bottom padding for the dock's height, which
handles the end of the page but not the fact that a floating translucent object is parked over an
interactive row mid-scroll.

### P2-3. There is no desktop layout

At 1280×900 the app is the 390 px mobile layout centred in a 660 px column, with a bottom-centre
floating dock and roughly 1,000 px of empty gradient below the fold on three of four tabs. The empty
Library at desktop is one 200 px white slab and an otherwise blank screen.

This is a console for browsing a 144-variant matrix and ~37 GB of published renders. A two-pane
desktop layout — list on the left, detail on the right, dock promoted to a rail — is the largest
single design win available and the only item in this document that is a *product* decision rather
than a cleanup. It needs a call from Austin before anyone builds it.

### P2-4. Reduced motion is half-covered

`@media (prefers-reduced-motion: reduce)` (`:321-330`) disables the intro, the bell, the title
transition, the refresh spin, and the skeleton sheen. It does not disable `.panel-show` (fires on
every tab change), `.current-tab-title-text`, `.param-caption-text`, `.fx-detail`,
`.track-highlight`, the `:active` transforms on `.swatch` / `.play-button` / `.dock-tab`, or —
most importantly — **`.queue-sync-dot.is-active`, which is an infinite pulse animation**
(`:281`). A user who has asked the OS to stop motion still gets a permanently animating dot.

### P2-5. Batch rendering is dead code

`queue(ids, label)` (`:1099`) branches on `"one" | "pilot" | "full"`, builds `{pilot:true}` /
`{full:true}` selectors, and composes a toast reading *"Full matrix (144 variants) sent to the
GitHub Actions renderer."* The only call site in the file is `queue([selected.variantId], "one")`
(`:1170`). There is no UI anywhere that triggers a pilot or full render. `pilotCount` is threaded
from `:918` through `Queue`'s props purely to format display names.

Either restore the entry point or delete the branches. Right now the API route, the selector shapes,
and the copy are all maintained for a path nothing can reach.

### P2-6. Classes in JSX with no CSS

`.queue-link` (`:1594`), `.queue-section` (×3), `.panel` (×14) — referenced in markup, defined
nowhere. `.card-padding-sm` is the mirror image: defined, never used. Small, but they are the
sediment that makes the next person distrust the stylesheet.

### P2-7. Two sync captions, still

`HeaderSyncCaption` (`:1231`, `.header-sync-caption`) serves Library; inline markup at `:1192`
(`.queue-sync-caption`) serves Queue. Different components, different classes, different copy
("Synced 2m ago" vs "Idle · Synced 2m ago" + dot). `globals.css:278` is a selector whose entire
purpose is to override the Queue caption's size and margin *back to* the Library caption's when it
appears in the header — the hand-alignment those four micro-PRs were performing, frozen into CSS.
One `<SyncStatus>` deletes that rule, both components, and the whole class of follow-up ticket.

### P2-8. Smaller things worth a line each

- **The Design tab never says which variant you're on.** `matrixIndex` appears only in the Create
  track button's `aria-label` (`:1170`), while every other tab shows a `Matrix N` chip.
- **Release cards are `role="button"` with interactive children.** `:1400` — an `<article
  role="button" tabIndex={0}>` containing an `<a>`. Also the `onKeyDown` handler accepts `" "`
  without `preventDefault()`, so Space both scrolls the page and navigates.
- **`EmptyState` renders its title as `<strong>`** — no heading semantics for a section's only label.
- **Manual refresh has no feedback after first load.** `initialLoad` gates every skeleton, so a
  re-`refresh()` shows nothing except the Library caption — which is hidden past 24 px of scroll.
- **The ⓘ help disappears with the title on scroll** (`:998-1006`, `:1194`). Scroll down and the
  only per-tab explanation in the app becomes unreachable.

---

## 7. Work plan for Devin

Sequenced so each phase is independently shippable and reviewable. Phase A is user-visible
bug-fixing; B and C are the system work; D needs a decision first.

### Phase A — Stop the dead ends *(P0; visible change, no refactor)*
1. Design tab: skeleton / empty / **error-with-Retry** states (P0-1). Distinguish unreachable-engine
   from combination-not-in-matrix.
2. Queue empty state, with an action pointing at Design (P0-2).
3. `<RefreshControl>` — button for pointer, pull for touch — adopted on all four tabs (P0-3).
4. Give the load-failure toast its `action: { label: "Retry" }`.
5. Fix `Noise Labs` → `Noise Lab` (P0-6).
6. **Acceptance:** with `/api/**` blocked, every tab renders an explanatory state with a working
   Retry. Every tab refreshes by both mouse and touch. Empty Queue renders a card, not nothing.

### Phase B — Make the contrast and semantics true *(P0/P1)*
1. Add `--brand-ink`, darken `--success`, `--link`; retire `--ink-tertiary` as a text colour; raise
   the unselected glyph-segment icon to ≥3:1 (P0-4). Re-run the ratio table; all text ≥4.5:1.
2. Give `StatusPill` a real `active` tone, delete the no-op rule, and type `state` as a union (P1-8).
3. Focus management on the three menus and the confirm sheet: initial focus, arrow keys, trap,
   restore — reuse the `radioArrowHandler` pattern that already works (P0-5).
4. Fill in `EmptyState`'s `icon`/`body`/`action` at all three call sites; unify the copy on
   *masters* / *tracks* (P1-7).
5. **Acceptance:** contrast table passes AA for text and 3:1 for controls; keyboard-only traversal
   of every menu and the confirm sheet works and returns focus.

### Phase C — Finish the token layer and the guardrail *(P1)*
1. Decide the five type-scale mappings (14/16/18/26 → which tokens), then convert all 46 raw
   font sizes (P1-1).
2. Add `--shadow-card` / `--shadow-raised` / `--shadow-overlay`; convert the 24 shadows (P1-3).
3. Add `--hairline`; collapse the three separator alphas; replace the four `rgba(229,72,60,…)`
   with values derived from `--brand` (P1-2).
4. Put `--dur-nav` / `--ease-nav` on `.panel-show`, `.tab-lens`, and `.dock-tab`; add the paired
   fade-out (P1-4).
5. Complete the reduced-motion block — especially the infinite sync dot (P2-4).
6. Rebuild the SEO-name panel (`:1363`) from `Card` + `Button` + tokens (P1-5); move the font stack
   out of the inline style.
7. Extract `<SyncStatus>`; delete `globals.css:278` and both caption implementations (P2-7).
8. Resolve `Card.padding` — real values or delete the prop (P1-6).
9. Delete dead classes and dead batch-render branches (P2-5, P2-6).
10. **Add `npm run check:tokens` to the `web` job in `.github/workflows/ci.yml`.** One line. The
    guardrail already exists and nothing runs it.
11. **Extend `check-tokens.mjs` into a real guardrail**, or add stylelint: ban raw `font-size: Npx`,
    ban `rgba()` outside `:root`, ban `box-shadow` literals, ban `transition`/`animation` durations
    outside the motion tokens. **This is the phase's most important item** — without it, C is a
    one-time cleanup that decays instead of a rule that holds.
12. **Acceptance:** the new lint runs in CI, passes, and fails a deliberately-introduced raw `13px`.

### Phase D — Navigation and layout *(P2; needs §8 answered first)*
1. Route all four tabs; derive `tab` from the hash; delete `libraryReturnTab` (P2-1).
2. Reorder panel JSX to dock order; persist scroll per tab.
3. Scrim or solid backing behind `.glassbar` so it stops sitting on the Balance control (P2-2).
4. Move the ⓘ help off the scroll-hiding title (P2-8).
5. Desktop layout (P2-3) — only after Austin's call.
6. **Acceptance:** Back works from all four tabs; every tab is deep-linkable and survives reload;
   no control is occluded at 390 px or 1280 px.

### Phase E — Guardrail documentation
1. `docs/design-language.md`: the tokens, the primitives, the rule that new surfaces compose
   existing primitives. `lib/queue-strings.ts` is the model for how this repo already does a
   centralised layer well.
2. Rebuild the four skeletons from the real components rather than hand-drawn geometry — they
   re-specify padding and radii the real components own and will silently desync.

---

## 8. Decisions needed from Austin

Devin should not guess these.

1. **Brand red for filled buttons.** `#e2483b` gives white text 4.02:1 and fails AA. Add a darker
   `--brand-ink` for filled buttons while `--brand` keeps strokes and selection — or accept the
   contrast. *Recommendation: add `--brand-ink`; the existing `--brand-pressed #c4392b` already
   reaches 5.9:1 and is the obvious candidate.*
2. **Type scale mappings.** `.section-title` 14 → 12 or 15? `.panel-heading h2` 26 → 21 or 30?
   Five calls, and they set the app's whole typographic rhythm.
3. **Is `--text-2xs: 10px` allowed for text?** Five declarations use it today; it's below every
   platform minimum. *Recommendation: badge-only.*
4. **Desktop layout.** Stay a centred 660 px mobile-shaped console, or build the two-pane layout the
   content clearly wants? This is the biggest item in the document and the only genuine product
   question.
5. **Batch rendering.** Restore a pilot/full entry point, or delete the dead branches?

---

## 9. What is good, and must survive the refactor

- **Zero hex outside `:root`.** The last audit's headline acceptance criterion was met exactly. The
  token block is well-organised and the naming is good.
- **`lib/queue-strings.ts`** remains the best-engineered thing in the codebase — a real centralised
  copy layer. It is the model for §7 Phase E, and the other three tabs should adopt the pattern.
- **`radioArrowHandler` + `GlyphSegmented` / `SwatchRow`** — roving `tabIndex`, `aria-checked`,
  arrow keys, and haptics, done properly. This is the reference implementation for Phase B item 3.
- **Skeleton coverage on all four tabs** is better than most shipped apps.
- **`.track-menu` reuse** across Library and Queue is real component sharing.
- **The FX section** (EQ curve on the live spectrum, preset glyphs, the remember-previous-state
  toggles at `:778-786` and `:843-851`) is the most sophisticated interaction design in the app and
  nothing here touches it.
- **The ambient fields, the bell mark, and the intro splash** give the product a memorable identity.
  The point of this audit is that the four tabs should be able to carry it.
