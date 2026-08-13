# Tab cohesion audit — Noise Lab console

**Scope:** the four primary tabs (Design, Queue, Library, Releases) in `web/app/noise-lab.tsx`
and `web/app/globals.css`, as experienced by moving between them.
**Method:** code read of the full 1,656-line component and 352-line stylesheet, plus the app run
locally at 390×844 and 1280×900 with screenshots of every tab in default and scrolled states.

---

## 1. Verdict

**Each tab is well made. The set is not a product.**

Nothing here is ugly, and no single tab reads as broken. The incoherence is entirely in the
*seams* — it only becomes visible in the half-second where you move from one tab to another,
which is exactly the moment this review is about. Four things change under you at once when you
tap the dock:

1. **The page header changes shape.** Design has none. Library grows a toolbar. Queue grows a
   status line. Releases grows a second `<h2>` that repeats the title already on screen.
2. **The card you are looking at changes.** Radius goes 26 → 24, shadow goes soft-and-wide →
   tight-and-dark, list gap goes 22px → 14px.
3. **The primary button changes colour.** Brand red on Design and Releases; black on Queue.
4. **The way you got there changes.** Design and Queue are React state. Library and Releases are
   URL hash routes. So the browser Back button works on two tabs and not the other two.

The root cause is structural, not aesthetic: **the four tabs were built as four apps that share a
stylesheet, rather than as four views that share a design system.** There is a token block at
`globals.css:5-16`, but `--accent`, `--card`, `--secondary` and `--track` are referenced **zero
times** in the entire stylesheet. Every tab reaches past the tokens and hard-codes its own values.
The result is **57 unique hex colours in `globals.css` and 17 more in `noise-lab.tsx`**, against
10 declared tokens.

That is the whole story. Everything below is evidence and remedy.

---

## 2. The four tabs, side by side

| | **Design** | **Queue** | **Library** | **Releases** |
|---|---|---|---|---|
| Page title | floating only | floating only | floating only | floating **+ duplicate `<h2>`** |
| Subtitle | — | — | — | "Prepare rendered masters…" |
| Status line | none | `.queue-sync-caption` 12px `#9a9aa5` + pulse dot | `.library-sync-caption` 11px `#63636b`, no dot | none |
| Refresh | none | pull-to-refresh (touch only) | pull-to-refresh (touch only) | round icon button (click only) |
| Card | `.soft-card` r26 | `.queue-job-card` r24, own shadow | `.soft-card` r26 | `.soft-card` r26 |
| List gap | 22px | 14px | 22px | 14px |
| Section label | — | 12px / 600 / .08em / `#9a9aa5` | 14px / 700 / .05em / `#63636b` | 14px / 700 / .05em / `#63636b` |
| Metadata pill | `.pilot-badge` r999 11px | `.queue-chip` **r8** 12px | `.track-chip` **r999** 10px | `.release-state` r999 10px |
| Primary button | red `#e5483c` | **black `#16161a`** | black `#1c1c1e` (split) | red `#e5483c` |
| Empty state | — | **none at all** | `.empty-state` card | `.empty-state` card |
| Error surface | toast | toast | inline clickable caption | `.unavailable-note` card |
| Confirm pattern | — | bottom sheet **and** double-tap inline | — | none |
| Routing | React state | React state | URL hash | URL hash |
| Back button works | no | no | yes | yes |
| Sticky chrome | sticky action row (mobile) | none | none | sticky footer bar |

Every row in that table is a decision that was made four times instead of once.

---

## 3. Findings

### A. Navigation — the "jumping" itself

**A1. Two routing models in one tab bar.** `noise-lab.tsx:1140-1153`. Tapping Design or Queue
calls `setTab(item)`. Tapping Library or Releases sets `window.location.hash`. Consequences a user
actually feels:

- Back works from Library and Releases, and exits the app from Design and Queue.
- Only two of four tabs are linkable or refresh-stable.
- The return path is a guess: `libraryReturnTab.current ??= tab === "library" ? "queue" : tab`
  (`noise-lab.tsx:998`). If you are on Library and press Library again, the app has decided that
  "back" means Queue. Nothing in the UI suggests that.

**A2. All four panels are mounted at once and share one scroll position.** `noise-lab.tsx:1087-1122`
renders every panel with `hidden={tab !== …}`. Scroll 800px down Design, tap Library, and the
`window.scrollTo({top: 0, behavior: "smooth"})` at `noise-lab.tsx:1154` animates the *new* tab
upward from a scroll offset it never had. Tab state is not preserved per tab; it is shared and then
reset.

**A3. The transition is a cut, not a transition.** The outgoing panel is hidden instantly; the
incoming panel plays `.panel-show { animation: rise .32s }` (`globals.css:40`) — a 10px slide with
no fade out to pair with. Meanwhile the dock's `.tab-lens` glides on a different duration and a
spring curve (`.38s cubic-bezier(.3,1.35,.4,1)`, `globals.css:226`). The indicator and the content
disagree about how fast the app moves.

**A4. DOM order contradicts visual order.** Dock renders `design, queue, library, releases`
(`noise-lab.tsx:1136`); panels render `design, library, queue, releases` (`noise-lab.tsx:1087-1122`).
Keyboard and screen-reader traversal do not match what is on screen.

**A5. The dock occludes content.** Confirmed on both viewports. The `.glassbar` is translucent with
no scrim behind it, so on desktop it floats over the middle of the Balance control and on mobile
the "Space / Dry — no reverb" row is legible *through* it. `.noise-page` reserves
`var(--dock-height) + 34px` of bottom padding (`globals.css:29`), which covers the end of the page
but not the fact that the bar is a translucent object sitting on live controls.

**A6. Icon-only dock, and one icon means two things.** No visible labels. `Layers` is the Queue tab
glyph *and* the icon inside Design's "Create track" button (`noise-lab.tsx:1100`). Combined with A7,
a scrolled user has no text anywhere naming their location.

**A7. The only "where am I" indicator hides on scroll.** `.current-tab-title` is fixed and fades out
above 24px of scroll (`noise-lab.tsx:931-940`, `globals.css:213-217`) — verified in the scrolled
screenshots. The per-tab help tooltip is anchored to it, so **the help becomes unreachable the
moment you scroll**, and `setTabInfoOpen(false)` is forced on scroll.

### B. Page chrome

**B1. Releases prints its own name twice.** The floating title says "Releases"; 300px below it
`ReleaseList`'s `.panel-heading h2` says "Releases" again at 26px/800 (`noise-lab.tsx:1323-1326`).
This is the most visible single defect in the app and it is in the screenshot.

**B2. Four different header recipes.** `.panel-heading` (h2 + subtitle + round action) exists but
only Releases and the release detail views use it. Library uses `.library-toolbar` +
`.section-title`. Queue uses nothing. Design uses nothing.

**B3. Two sync captions for one concept.** `.library-sync-caption` (`globals.css:87`) is 11px
`--secondary-text` with the copy "Synced 2m ago". `.queue-sync-caption` (`globals.css:238`) is 12px
`#9a9aa5` with a status dot and the copy "Idle · synced 2m ago · pull to refresh". Different size,
different grey, different margin, different capitalisation of the same word.

**B4. Refresh is mutually exclusive by input type.** Library and Queue are pull-to-refresh, which
does not exist on a mouse (`use-pull-refresh.ts` binds touch events only). Releases is a click-only
`.round-action`. **A desktop user cannot refresh Library or Queue; a touch user has no refresh
button on Releases.** Design cannot be refreshed at all.

**B5. The WIP banner is a fifth alert style.** `noise-lab.tsx:1311-1314` uses `#fff8e7 / #f2c46d /
#7a4d00` — matching neither the toast, nor `.unavailable-note` (`#fff0ee / #8b3e38`), nor
`.queue-failure-strip` (`#fdf0ee / #c4392b`), nor `.lint-hard` (`#c62828`).

### C. Components that were forked instead of shared

These are the same thing, built twice, in tabs the user moves directly between.

**C1. The card.** `.soft-card` — r26, `0 1px 2px rgba(0,0,0,.04), 0 12px 32px rgba(20,20,50,.06)`
(`globals.css:41`). `.queue-job-card` — r24, `0 8px 24px rgba(40,40,70,.08)`, and it does not use
`.soft-card` at all (`globals.css:242`). Queue cards sit visibly higher off the page than every
other card in the app. Padding also diverges across five values: 22/24, 20/24, 20, 18, 4/20/20.

**C2. The metadata pill — the clearest case.** Library renders `Matrix 12 · white · mid · drift`
via `.track-chip` (`noise-lab.tsx:1284`): radius **999px**, 10px, `#f0f0f4`. Queue renders
**literally the same four strings** via `chipsFor()` → `.queue-chip` (`noise-lab.tsx:1604, 1633`):
radius **8px**, 12px, `#f1f1f5`. Same data, same user, adjacent tabs, two components.

**C3. The section label.** `.section-title` is defined once (`globals.css:86`) and then overridden
by `.queue-section .section-title` (`globals.css:245`) to a different size, weight, tracking and
colour — rather than the two callers agreeing on one style.

**C4. The primary button inverts meaning.** `.queue-primary` is the brand-red CTA
(`globals.css:76`), then `.queue-card-actions .queue-primary` repaints it black `#16161a`
(`globals.css:269`). The same class is the brand action on Design and Releases and a neutral action
on Queue. A user who has learned "red = the main thing to press" un-learns it on Queue.

**C5. Status chips.** Four grammars for one idea: `.queue-ready-chip` / `.queue-status-active` /
`.queue-status-failed` (r8, 12px), `.release-state` (r999, 10px, 800), `.pilot-badge` (r999, 11px,
700), `.track-chip` (r999, 10px, 650).

**C6. Disclosure.** Three mechanisms: `<details>` (Queue strips), `aria-expanded` + conditional
render (QA panel, tab help, FX advanced), route change (Releases detail).

**C7. Confirmation.** Three idioms, two of them inside Queue alone: a modal bottom sheet for
Remove (`noise-lab.tsx:1654`), an inline double-tap-with-3s-timeout for Re-run
(`noise-lab.tsx:1625`), and nothing at all for Releases' destructive-ish saves.

**C8. Overflow menus.** `.track-menu` is genuinely shared by Library and Queue — good — but Queue
re-skins the trigger (`.queue-overflow`, 32px, grey fill) away from Library's `.icon-action`
(34px, transparent).

**C9. Badge semantics.** One red dot, three meanings (`noise-lab.tsx:848-850`): Queue = live
workload, Library = *unseen* items (a notification), Releases = ready-not-submitted (a to-do).
Library's is `.dim` grey, which reads as disabled rather than informational. Nothing explains this.

### D. Tokens that exist but are not used

`globals.css:5-16` declares 10 variables. Actual usage:

| token | uses |
|---|---|
| `--accent` | **0** |
| `--card` | **0** |
| `--secondary` | **0** |
| `--track` | **0** |
| `--separator` | 1 |
| `--page` | 4 |
| `--label` | 7 |

Everything else is literal. The measured consequence:

- **12 reds** — `#e2483b` `#e5483c` `#ff3b30` `#d23a2f` `#ff6a5e` `#ff7a6e` `#f0a49e` `#c4392b`
  `#c7352b` `#c62828` `#b42318` `#8b3e38`. Four are "the brand"; the rest are "an error"; no rule
  separates them, and `C.accent` in `noise-lab.tsx:79` is a *thirteenth* definition living in JS.
- **9 secondary greys** — `#8e8e93` `#63636b` `#8a8a8e` `#9a9aa5` `#6b6b76` `#6e6e73` `#4f5058`
  `#a6a6aa` `#bcbcc2`.
- **9 subtle fills** — `#f0f0f4` `#f1f1f5` `#f4f4f6` `#f4f4f9` `#fafafd` `#e9e9eb` `#e2e2e7`
  `rgba(120,120,128,.12)` `rgba(120,120,128,.08)`.
- **4 near-blacks** — `#1c1c1e` `#1d1d1f` `#171719` `#16161a`.
- **4 greens** for pass/done — `#34c759` `#1f9d4d` `#16833b` `#187a35`.
- **3 blues** for link — `#007aff` `#005bb5` `#2f5bd7`.
- **15 font sizes** including one-offs at `10.5px`, `11.5px`, `13.5px`; weights include a lone `650`.
- **12 radii** — 8, 10, 11, 12, 13, 14, 16, 18, 20, 24, 26, 999.
- **Icon sizes** unscaled: 14, 15, 16, 17, 18, 19, 22, 27, and `ParamIcon`'s filled 20×20 SVGs are a
  different visual family from Lucide's strokes entirely.

None of this is visible inside one tab. All of it is visible across four.

### E. State coverage

**E1. Queue has no empty state.** Verified in the screenshot: an idle Queue is a title, one grey
caption, and 1,400px of nothing. Library and Releases both render an `.empty-state` card in the same
situation. Design has no empty or error state either.

**E2. Skeletons drift from their real layouts.** All four exist (`noise-lab.tsx:305-383`), which is
better than most apps — but each is hand-drawn and re-specifies geometry the real components own, so
they will silently desync on the next layout change.

**E3. Four error surfaces**: toast (Design, Queue), inline clickable caption (Library),
`.unavailable-note` card (Releases), plus the WIP banner.

---

## 4. What should be shared, and isn't

The work is one shared layer plus eight extracted components. Nothing here changes a single
feature — it is the same app, spoken in one voice.

### 4.1 Token layer (`globals.css`)

Replace the 10 half-used variables with a real set, and make it a lint-enforced rule that **no hex
literal appears outside `:root`**.

```css
:root {
  /* surface */
  --page:            #eef0f6;
  --surface:         #ffffff;
  --surface-sunken:  #f0f0f4;   /* collapses #f1f1f5 #f4f4f6 #f4f4f9 #fafafd */
  --surface-inset:   rgba(120,120,128,.12);  /* segmented / swatch / eq trays */

  /* ink */
  --ink:             #1c1c1e;   /* collapses #1d1d1f #171719 #16161a */
  --ink-secondary:   #63636b;   /* collapses 9 greys */
  --ink-tertiary:    #8e8e93;

  /* brand + status — one value each, chosen deliberately */
  --brand:           #e2483b;
  --brand-pressed:   #c4392b;
  --brand-disabled:  #f0a49e;
  --danger:          #c4392b;   /* errors are NOT the brand red */
  --danger-bg:       #fdf0ee;
  --success:         #1f9d4d;
  --success-bg:      #ecf9ef;
  --warning:         #7a4d00;
  --warning-bg:      #fff8e7;
  --link:            #007aff;

  /* geometry */
  --radius-pill: 999px;
  --radius-card: 24px;
  --radius-control: 16px;
  --radius-chip: 8px;

  /* rhythm */
  --gap-list: 18px;             /* one gap, not 22 and 14 */
  --gap-section: 26px;

  /* type scale — 8 sizes, no 10.5/11.5/13.5 */
  --text-2xs: 10px; --text-xs: 11px; --text-sm: 12px; --text-base: 13px;
  --text-md: 15px;  --text-lg: 17px; --text-xl: 21px;  --text-display: 30px;

  /* motion — one duration + one curve for navigation */
  --ease-nav: cubic-bezier(.2,.8,.25,1);
  --dur-nav: 260ms;

  /* icons */
  --icon-sm: 16px; --icon-md: 20px; --icon-lg: 24px;
}
```

Delete the `C` object at `noise-lab.tsx:72-83`; it is a second, competing palette living in JS and
it is only used by `Toast` and the spectrum canvas. Canvas drawing should read the tokens via
`getComputedStyle` or import from a single TS constants module generated from the same source.

### 4.2 Components to extract

| Component | Replaces | Props |
|---|---|---|
| `<TabPage>` | four bespoke header recipes | `title, subtitle?, status?, onRefresh?, actions?` — owns the title, the sync line, the refresh control and the section spacing for **all four tabs** |
| `<SyncStatus>` | `.library-sync-caption` + `.queue-sync-caption` | `state: "idle"\|"syncing"\|"active"\|"failed", lastSync, onRetry?` — one size, one grey, one dot rule, one wording |
| `<RefreshControl>` | pull-to-refresh **and** `.round-action` | renders both: pull gesture on touch, button on pointer. Every tab gets both affordances |
| `<Card>` | `.soft-card` + `.queue-job-card` | `padding: "sm"\|"md"`, one radius, one shadow |
| `<Chip>` | `.track-chip` + `.queue-chip` + `.pilot-badge` | `tone: "neutral"\|"success"\|"danger"\|"active"\|"brand"` — one radius, one size |
| `<StatusPill>` | `.queue-ready-chip` `.queue-status-*` `.release-state` | `state` enum, mapped to `--success/--danger/--ink-secondary` |
| `<Button>` | `.queue-primary` / `.queue-secondary` / `.download-main` / `.copy-button` | `variant: "primary"\|"secondary"\|"neutral"\|"link"` — **`primary` is always brand red**; Queue's black buttons become `neutral` |
| `<EmptyState>` | `.empty-state` (+ the missing Queue one) | `icon, title, body, action?` — mandatory on all four tabs |
| `<Banner>` | WIP banner + `.unavailable-note` + `.queue-failure-strip` | `tone: "info"\|"warning"\|"danger"` |
| `<Disclosure>` | `<details>` strips + `aria-expanded` panels | one open/close animation and chevron rule |
| `<ConfirmSheet>` | bottom sheet + inline double-tap | one destructive-confirm pattern |

### 4.3 Navigation contract

One decision, applied to all four tabs — **route everything**. Hash routing already works for two
tabs; extend it rather than removing it:

- `#design`, `#queue`, `#library`, `#releases` are all real routes; `#library/<id>` and
  `#releases/<id>` stay as detail routes.
- `setTab` becomes derived state from the hash. Delete `libraryReturnTab` and its guess.
- Back always means "the previous tab you were on", because the browser holds the stack.
- Persist scroll position **per tab** and restore it, instead of `scrollTo(0)` on every switch.
- Reorder the panel JSX to match the dock order (fixes A4).
- Pair the panel transition with the lens: one `--dur-nav` / `--ease-nav`, cross-fade out as well as
  in, and honour `prefers-reduced-motion`.
- Make the current tab legible when scrolled: either keep a compact sticky title bar, or add visible
  labels to the active dock tab. Move the `Info` help off the disappearing title so it stays
  reachable.

---

## 5. Work plan for Devin

Sequenced so each phase is independently shippable and reviewable. Phases 1–2 are pure refactors
with **no intended visual change on any tab except where the audit says the tab was wrong**.

### Phase 1 — Token layer *(no visual change intended; small diffs expected where values collapse)*
1. Write the `:root` block from §4.1 into `globals.css`.
2. Replace all 57 hex literals in `globals.css` with tokens. Where two near-identical values
   collapse (e.g. `#f0f0f4` / `#f1f1f5`), take the more-used one.
3. Delete `C` (`noise-lab.tsx:72-83`); route `Toast` and the spectrum canvas to the token source.
4. Collapse `10.5/11.5/13.5px` to the scale; collapse font-weight `650` → `600`.
5. Collapse the 12 radii to the four tokens.
6. **Acceptance:** `grep -oE '#[0-9a-fA-F]{6}' app/globals.css` returns only lines inside `:root`.
   `npm run typecheck && npm test` pass. Screenshot diff of all four tabs shows only intended
   colour collapses.

### Phase 2 — Shared primitives *(no visual change except Queue cards/chips adopting the shared look)*
1. Extract `<Card>`, `<Chip>`, `<StatusPill>`, `<Button>`, `<Banner>`, `<EmptyState>`,
   `<Disclosure>` per §4.2 into `web/app/ui/`.
2. Replace `.queue-job-card` with `<Card>`; delete the bespoke shadow.
3. Replace `.track-chip` and `.queue-chip` with one `<Chip>`; delete `chipsFor`'s separate styling.
4. Delete the `.queue-card-actions .queue-primary` black override; those buttons become
   `variant="neutral"`. **Primary red now means the same thing on every tab.**
5. Unify list gap to `--gap-list`; unify `.section-title` and delete the `.queue-section` override.
6. **Acceptance:** no component-level colour or radius literals remain in `noise-lab.tsx`. Queue and
   Library render identical chips for identical data.

### Phase 3 — Page chrome
1. Build `<TabPage>`, `<SyncStatus>`, `<RefreshControl>`; adopt on all four tabs.
2. **Delete the duplicate `<h2>Releases</h2>`** in `ReleaseList` (`noise-lab.tsx:1323-1326`).
3. Give Design and Releases a sync line; give Library and Queue a refresh button; give Releases
   pull-to-refresh. Every tab supports both input types.
4. Add the missing **Queue empty state**; add Design's error state.
5. Move the tab `Info` control out of the scroll-hiding title.
6. **Acceptance:** all four tabs refresh by both pointer and touch; all four render a designed empty
   state; "Releases" appears exactly once on screen.

### Phase 4 — Navigation
1. Route all four tabs through the hash; derive `tab` from location; delete `libraryReturnTab`.
2. Per-tab scroll persistence; reorder panel JSX to dock order.
3. Unify panel transition with the lens timing; add the cross-fade; honour reduced motion.
4. Add a scrim or solid backing behind `.glassbar`, or reserve real layout space, so it stops sitting
   on live controls (A5). Consider visible labels on the dock.
5. Choose a distinct glyph for either the Queue tab or the "Create track" button (A6).
6. Document badge semantics and pick one visual language for them (C9).
7. **Acceptance:** Back works from all four tabs; every tab is deep-linkable and survives reload;
   scroll position is preserved per tab; no control is occluded by the dock at 390px or 1280px.

### Phase 5 — Guardrails
1. Stylelint rule banning hex literals outside `:root`.
2. A short `docs/design-language.md` recording the token names and the component inventory, so tab
   five does not fork the whole thing again.
3. Rebuild the four skeletons from the real components rather than hand-drawn geometry (E2).

---

## 6. Decisions needed before Phase 1

These are Austin's calls, not Devin's — they change what the tokens say.

1. ~~**Brand red value.**~~ **SETTLED — `--brand: #e2483b`.** Approved by Austin, 13 Aug 2026. Four
   candidates were in the code: `#e5483c` (buttons), `#e2483b` (selection and focus), `#ff3b30` (the
   unused `--accent` token and `C.accent`), `#d23a2f` (play-button shadow). `#e2483b` wins because it
   already owns focus rings and selected states, so the most semantically load-bearing use of red
   stays pixel-identical through the refactor. **Phase 1 is unblocked on this point:** every red in
   §3D that is doing brand work — `#e5483c`, `#ff3b30`, `#d23a2f` — collapses to `--brand`, and the
   play button's gradient is rebuilt from it rather than from three hand-picked stops.
2. **Does error red equal brand red?** Right now they are the same family, which makes a failed
   render look like a call to action. §4.1 separates them (`--danger: #c4392b`). Confirm.
3. **Queue's black buttons.** Phase 2 makes them neutral-grey secondary actions and gives Queue no
   red primary. The alternative is to keep black and rename it a real `neutral` variant used
   app-wide. Either is coherent; the current state is not.
4. **List rhythm.** 22px (Design/Library) or 14px (Queue/Releases)? §4.1 proposes 18px as one value.
5. **Dock labels.** Add visible text labels, or keep icon-only and add a persistent compact title
   bar? One of the two is needed; A7 means neither exists today.

---

## 7. What is already good, and should be preserved

Worth saying, because a token refactor can flatten these by accident:

- The **skeleton coverage** on all four tabs is better than most shipped apps.
- The **haptic + arrow-key radiogroup** pattern in `GlyphSegmented` / `SwatchRow` is genuinely well
  built, including `tabIndex` roving and `aria-checked`.
- `.track-menu` is real component reuse across Library and Queue.
- `queue-strings.ts` is a proper centralised copy layer — it is the one place in this codebase that
  already does what §4 is asking for everywhere else. It should be the model.
- The ambient background fields and the intro splash give the product a memorable identity that the
  tabs themselves currently fail to carry through.
