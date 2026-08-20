---
name: testing-noise-web
description: How to run and visually test the Noise Lab Next.js console in web/ (dev and production servers, fabricating arbitrary Queue states from a JSONL fixture, making in-flight refresh/busy states observable, sampling CSS animation state reliably, seeding Library/Queue data for count badges, tab selectors and hash routing, stale .next pitfalls, inspecting SVG artwork and CSS load animations).
---

# Testing the Noise Lab web console (`web/`)

## Running it
- `cd web && npm run dev` → http://localhost:3000. Ready in ~1s. No credentials or secrets are
  needed for UI testing: all API routes (`/api/variants`, `/api/library`, `/api/queue`,
  `/api/releases`) read local data/config and are served by the same Next process. Watch the
  `npm run dev` output to confirm a UI action actually refetched (a panel refresh logs
  `GET /api/... 200`).
- `npm install` is already covered by the repo blueprint's `maintenance` step.
- A "Could not load engine data" toast may appear when the Audacity render backend isn't reachable.
  It is unrelated to UI changes.
- To judge anything about first paint / pre-hydration behaviour, use a production build — dev
  hydration is far slower and overstates flashes: `npm run build && npx next start -p 3001`.
  `next.config.ts` sets `output: standalone`, so `next start` prints a warning but still serves
  correctly; `node .next/standalone/server.js` is the officially supported path.

## Pitfalls with `.next`
- **Stale `.next` serves a 404 CSS chunk.** If the page renders completely unstyled (raw `<h1>`
  text visible, giant unsized SVGs, `.sr-only` not applied), the dev server is serving a dead
  stylesheet. Verify with:

  ```
  CSS=$(curl -s http://localhost:3000 | grep -o 'href="/_next/static/css/[^"]*"' | head -1 | sed 's/href="//;s/"//')
  curl -s "http://localhost:3000$CSS" | head -c 200   # "Not Found" means the chunk is gone
  ```

  Fix: kill the `next dev` process, `rm -rf web/.next`, restart `npm run dev`. Do this check before
  judging any CSS/animation behaviour — an unstyled page can look like a broken feature. The same
  stale cache also causes HTTP 500 `MODULE_NOT_FOUND ... .next/server/app/page.js` after switching
  branches or commits.
- **Never build while the dev server is up.** `npm run dev` and `npm run build` share `.next`, so a
  concurrent build makes the dev server return 500s and bogus in-app error toasts, and the build
  itself can fail with a spurious `PageNotFoundError: Cannot find module for page: /api/queue/retry`.
  Neither is an app bug. Stop the dev server, `rm -rf .next`, then build; a full build takes ~2-4
  minutes, so run it in the background with a generous timeout.
- **Stale `next start` processes** keep serving the previous build after a rebuild. Verify you are on
  the build you think you are, e.g. `curl -s localhost:3001 | grep -o 'tab-[a-z]*' | sort -u` should
  list every tab you expect.

## Making Library / Queue non-empty (count badges)
Out of the box both are empty, so tab count badges never render and you cannot test them.

- Library: the render directory is reported by `GET /api/library` as `renderDirectory`
  (default `/home/ubuntu/noisegen-out`). A variant counts as "exists" purely by filename match, so
  zero-byte placeholders are enough:

  ```bash
  mkdir -p /home/ubuntu/noisegen-out
  curl -s localhost:3000/api/library | python3 -c "import json,sys;print([t['filename'] for t in json.load(sys.stdin)['tracks'][:3]])"
  # then: head -c 4096 /dev/zero > /home/ubuntu/noisegen-out/<one of those filenames>
  ```

  Reload; the Library badge equals the number of matching files. Delete the placeholders when done —
  they live outside the repo and will confuse later runs.
- Queue/Render: click **Queue this render** in the Design panel. Each click enqueues one job,
  increments the Render badge and pops a toast. No worker/Audacity is needed just to see queue
  state; actual rendering requires `setup.sh` + Audacity under Xvfb.

### Seeding *named* library tracks (titles, dates, approved marker, rename tests)
Zero-byte wavs alone give tracks with no title, no date and no sidecar, so anything that reads or
writes sidecar metadata (`seo_title`, `seo_title_approved`, `render_timestamp`) cannot be exercised.
Write a sidecar JSON next to each wav (same name, `.json` instead of `.wav`) — `web/lib/artifacts.ts`
picks it up per file with no server restart:

```bash
cd /home/ubuntu/noisegen-out && python3 - <<'EOF'
import json, urllib.request
vs = json.load(urllib.request.urlopen('http://localhost:3000/api/variants'))['variants'][:3]
for i, v in enumerate(vs):
    fn = v['filename']
    open(fn, 'wb').write(b'\0' * 4096)
    sc = {"variant_id": v['variantId'], "role": "master", "cell_seconds": 150, "repeats": 4,
          "render_timestamp": f"2026-02-1{i+1}T10:0{i}:00Z"}
    if i == 0: sc["seo_title"] = "Original Seeded Title"
    json.dump(sc, open(fn.replace('.wav', '.json'), 'w'), indent=2)
EOF
```

Key fields: `variant_id` (required — `renderStatus` lookups key off it), `role: "master"` (both
`approveName()` and `renderTrack()` in `web/lib/naming.ts` reject a sidecar whose `role` is anything
else), `render_timestamp` (drives the "Created" line and the newest-first sort, so staggered
timestamps give a deterministic card order), `cell_seconds * repeats` (the displayed duration), and
optionally `seo_title` / `seo_title_approved: true` to start from a named / `approved` track.

Note `/api/library` prefers a **release** title over the sidecar `seo_title`
(`web/lib/library.ts:65`), so if the variant is also in a release the sidecar title will not show.
The three `wn_white_low-mid_still_*` variants are not, which makes them the safe ones to seed.

Sidecar writes are the objective proof for any naming UI: `grep seo_title <sidecar>.json` after the
action distinguishes a real save from a purely optimistic title update. Note "Suggest SEO name" →
Approve **overwrites** `seo_title` and adds `seo_title_approved`, whereas an inline rename writes only
`seo_title` — assert on which keys changed, not just the title.

These files live outside the repo; delete them when done.

## Fabricating arbitrary Queue states (failed rows, batches, repeated variants)
Clicking "Queue this render" can only ever produce *queued* jobs, so failure/retry/batch rows must be
fabricated. The queue is file-backed when you point it at a JSONL fixture, which makes every queue-row
scenario testable with no GitHub Actions and no worker:

```bash
mkdir -p /tmp/nq
cd web
NOISE_QUEUE_FILE=/tmp/nq/queue.jsonl \
NOISE_RENDERING_AVAILABLE=1 \
PORT=3001 npm run dev
```

`NOISE_RENDERING_AVAILABLE=1` puts the app in **Local worker** mode (shown as a chip next to the
"Render queue" heading). One JSON object per line; the list is rendered newest-first. Useful fields:
`id`, `variantId`, `status` (`Failed`/`Queued`/`Done`), `queuedAt` (ISO), `error`, `logsUrl`.

To exercise every label kind at once use `variantId` values: a known id (`wn_white_mid_drift_balanced`
→ `White · Mid · Drift · Even`), a comma-joined/unknown id (falls back to the raw slug), `pilot`
(`Pilot set (8)`), `full` (`Full matrix (144)`), and the SAME `variantId` twice with different
`queuedAt` to trigger the `Attempt N` markers. Keep a pristine copy (`queue.base.jsonl`) and `cp` it
back between tests — retries mutate the fixture. Assert dispatch counts by diffing `wc -l` on the
fixture rather than trusting the UI alone.

**Batch retry expands to individual variant ids.** `POST /api/queue/retry` with `variantId: "pilot"`
enqueues the 8 concrete variant ids, not another `pilot` row. Because "Retried ✓" is derived by
looking for a *sibling job sharing the same variantId*, a batch (`pilot`/`full`) row therefore cannot
show "Retried ✓" after a reload in local-worker mode, while single-variant rows can. Expect this
asymmetry before filing it as a bug.

## Fabricating Library sync-failure states
`librarySyncFailed` flips when *any* of the four endpoints in `refresh()` (`/api/variants`,
`/api/library`, `/api/queue`, `/api/releases`) fails — all four must return OK for a successful sync.
The cheapest toggle is a **temporary, uncommitted** flag-file check at the top of the GET handler in
`web/app/api/library/route.ts`:

```ts
if (existsSync("/tmp/noise-fail")) return new Response("fail", { status: 500 });
```

`touch /tmp/noise-fail` to break sync, `rm` it to recover — no server restart needed. Never commit
this; verify `git status` before any push. Note the Library panel has no refresh round-action: a
failed sync is reached via page reload (or pull-to-refresh on touch), and retried by clicking the
sync caption itself when it shows the failed state.

## Observing in-flight / busy UI state (refresh spinners, disabled, aria-busy)
Local API routes answer in a few ms, so in-flight state is otherwise impossible to catch. Add a
**temporary, uncommitted** env-gated delay at the top of the GET handlers in
`web/app/api/{queue,variants,library,releases}/route.ts`:

```ts
const d = Number(process.env.NOISE_TEST_DELAY_MS ?? 0);
if (d) await new Promise((r) => setTimeout(r, d));
```

Run with `NOISE_TEST_DELAY_MS=6000`. This scaffolding must never be committed — `git status` should
show only these route files as modified, and they must be reverted before any merge or push.

**Sample with a requestAnimationFrame loop, not a single probe.** A `browser_console` call issued
after a click usually lands *after* the fetch resolved and reports a misleading all-idle result. Arm a
sampler first, then click through the real UI, then read the collected samples:

```js
window.__s = []; const t0 = performance.now();
const tick = () => {
  const b = document.querySelector('.round-action[aria-label="Refresh queue"]');
  const svg = b.querySelector('svg'), cs = getComputedStyle(svg);
  window.__s.push({ disabled: b.disabled, ariaBusy: b.getAttribute('aria-busy'),
    refreshing: b.classList.contains('is-refreshing'),
    anim: cs.animationName, transform: cs.transform, nAnims: svg.getAnimations().length });
  if (performance.now() - t0 < 12000) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

Then filter to `refreshing === true` samples. `animationName`, `getAnimations().length` and the set of
distinct `transform` values are the objective proof of an actual spin — zoomed screenshots of a small
icon are ambiguous and should not be the primary evidence. Note a *dead* `@keyframes spin` can exist
with no rule ever assigning `animation: spin ...`; always grep for the positive assignment, not just
the keyframe, and check the **served** CSS too:
`curl -s localhost:3001/_next/static/css/app/layout.css | tr '}' '}\n' | grep -n is-refreshing`.

The refresh buttons are `.round-action[aria-label="Refresh library|Refresh queue|Refresh releases"]`.
Queue's busy state is opt-in: only a user click passes `refreshQueue(true)`, while the 30s background
poll calls `refreshQueue()` and must leave the button idle — watch the dev-server log for a poll
`GET /api/queue 200` while sampling to prove it.

## UI map / selectors
- Tabs live in `nav.glassbar[role=tablist]` in the bottom dock; buttons are
  `[data-tab="design|queue|library|releases"]` with ids `tab-<value>` and panels `#panel-<value>`.
- The queue tab is *labelled* "Render" but its state value, id and panel id remain `queue`. Assert on
  the visible label AND the id — they intentionally differ.
- Hash routes: `#library`, `#releases`, `#releases/<release-id>`. Activating those tabs sets the hash;
  browser Back restores the previously active tab (tracked in a ref, not history state). Deep-linking
  any of them loads the right tab.
- A small non-interactive `.current-tab-title` pill at top-centre names the active tab. It is
  `aria-hidden` with `pointer-events: none`, so it is invisible to the accessibility tree — assert on
  its rendered text via screenshot, not DOM/aria queries.
- `/api/releases` returns preset draft releases (Pilot EP + one per noise colour) with no seeding
  needed, which makes the Releases tab the easiest place to find a real clickable card.
- Design panel: `Play/Stop approximate preview` (spectrum animates while playing) and segmented rows
  Color/Band/Motion/Balance. Changing a segment recomputes the variant — assert on the
  `Matrix N of 144` line, the `wn_*` variant id and the row hint (e.g. `-6 dB/oct`). Changing a
  segment stops an in-progress preview; that is existing behaviour, not a bug.

## Fixed floating chrome
`.dock` (bottom nav), `.current-tab-title` (top pill), `.toast` and `.release-footer` are all fixed or
sticky and share the bottom-edge budget via the `--dock-height` variable. When touching layout on any
of them, always trigger a toast and open a release detail and screenshot both: if the `--dock-height`
offset is dropped, an element silently covers *and* blocks the nav underneath it.

To prove an overlay has `pointer-events: none`, don't just click it and observe "nothing happened" —
scroll a real interactive element underneath it and click at the overlay's centre. The underlying
control toggling is the only real proof.

## Verifying CSS load animations (`globals.css`)
The bell uses `rise` (.58s), `bell-eyes-in` (.18s @ .16s) and `bell-smile-in` (.42s @ .3s, animated
`clip-path: inset()`). Screenshot round-trips are far slower than that, so to prove *direction* and
*ordering* of a wipe:
- Temporarily multiply all durations/delays by 10 in `web/app/globals.css`, reload, and take zoomed
  screenshots at ~3.5s / 4.5s / 5.5s to capture intermediate frames. Restore the file afterwards
  (`cp` a backup first, then confirm `git diff` is empty).
- `prefers-reduced-motion` can only be exercised via DevTools → **Rendering** panel → "Emulate CSS
  media feature prefers-reduced-motion". Open DevTools with F12 first, then **click inside the
  DevTools pane** so it owns focus — Ctrl+Shift+P while the *page* has focus opens the print dialog,
  not the command menu. `Ctrl+Shift+P` → "Show Rendering" gives the drawer with the dropdown, which is
  more reliable than the one-shot command-menu toggle because you can read the current value and set
  it back to "No emulation" for the control run. Always confirm the state in-page with
  `matchMedia('(prefers-reduced-motion: reduce)').matches` before trusting a result.
- When asserting that reduced motion *suppresses* something, always run the **control** case too
  (emulation off) and show the thing does appear. The intro splash is gated in JS
  (`introState` → `"hidden"` immediately under reduce) and is removed from the DOM ~1.65s after load
  anyway, so "element absent" alone proves nothing — reload with emulation off and screenshot within
  the first second to catch the bell.
- Anything server-rendered and then hidden by a `useEffect` (`matchMedia` checks, splash/intro
  overlays) still paints before hydration. Re-check on the production build before reporting, and
  take the screenshot immediately after `Ctrl+Shift+R` (no `wait` first) to catch the first frame.
- Accessible-name checks (visually hidden `.sr-only` title, `aria-hidden` SVG) are best shown via
  DevTools → Elements → **Accessibility** pane.

## Verifying CSS-only PRs (never trust the diff — read `getComputedStyle`)
`globals.css` is a flat, source-ordered sheet with many `.foo:hover, .foo:focus-visible { ... }`
rules sitting *above* the more specific-looking element rules. A new rule like
`.track-card-title-input { outline: 2px solid var(--brand); }` (specificity 0-1-0) is silently beaten
by an earlier `.track-card-title:focus-visible { outline: none; }` (0-2-0) whenever the element
carries **both** classes — which several components do (`className="track-card-title
track-card-title-input"`). The diff looks correct and the property never renders.
- For every property a CSS PR claims to add, assert it objectively in the browser console *in the
  state the user actually sees* (focused, hovered, open):
  ```js
  const el = document.querySelector('.track-card-title-input');
  const cs = getComputedStyle(el);
  console.log(JSON.stringify({border: cs.border, borderRadius: cs.borderRadius,
    padding: cs.padding, outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle}));
  ```
  A thin ring in a screenshot is ambiguous; `outlineStyle: "none"` is not.
- Enumerate the competing rules in source order to find the culprit:
  ```js
  for (const sheet of document.styleSheets) { let r; try { r = sheet.cssRules } catch { continue }
    for (const rule of r) if (rule.selectorText?.includes('track-card-title'))
      console.log(rule.selectorText + ' => ' + rule.style.cssText); }
  ```
- Prove the fix before reporting by injecting the corrected rule as a `<style>` element, re-screenshot,
  then `.remove()` it and re-verify the computed value reverted. This turns "looks wrong" into a
  concrete one-line suggestion.
- Focus-ring rules only apply while `el.matches(':focus-visible')` is true. Text inputs match
  `:focus-visible` even when focused programmatically (`.focus()`), so an auto-focused edit input is
  *always* in the overridden state — the ring never renders for any user.

## Proving "no layout jump" on style changes
Eyeballing a 1px shift is not evidence. Install a measurement helper and diff the same rects across
before / during / after states:
```js
window.__m = () => { const c = document.getElementById('track-<variantId>'); const g = s => {
  const e = c.querySelector(s); const r = e.getBoundingClientRect();
  return {x:r.x, y:r.y, w:r.width, h:r.height}; };
  return {wrap: g('.track-card-title-wrap'), sparkles: g('.track-name-action'),
          chips: g('.track-chips'), card: (({x,y,width,height}) =>
          ({x,y,w:width,h:height}))(c.getBoundingClientRect())}; };
console.log('BEFORE ' + JSON.stringify(window.__m()));
```
Measure the *surrounding* elements (sibling icon buttons, the next row, the card), not the swapped
element itself — an input replacing a button legitimately changes its own rect (e.g. +2px height from
a border, text inset by `padding`), and that is only a defect if neighbours move. A `margin: -1px 0`
paired with a new `1px` border is the usual trick to keep the row height stable; confirm it works
rather than assuming.

## Inspecting small artwork (bell mark, icons)
The bell mark renders small in-app, so screen zoom alone is not enough detail. Chrome page zoom maxes
at 500%, and **Chrome zoom is per-host, not per-port** — Ctrl+0 on `localhost:8899` also resets zoom
for `localhost:3000`. For pixel-level review:
1. Extract the `<svg>` from `web/app/bell-mark.tsx` with a script (never retype the paths), set
   `width/height` to ~900, write it to a scratch dir next to a copy of the source raster.
2. `python3 -m http.server 8899` in that dir and open it in a second tab — a side-by-side
   "traced SVG vs source art" comparison at full resolution.

## Mobile breakpoint
Mobile rules kick in at `max-width: 520px` (the Design action row becomes sticky, the dock goes full
width). Device emulation at 390x844 works; resizing the real window also works:
`wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,0,500,900`
then reload; restore with `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.

The window manager enforces a **minimum outer window width (~532px here)**, so `wmctrl` alone cannot
reach ~390 CSS px. Combine it with Chrome page zoom (`Ctrl+-`) to shrink the CSS viewport further, and
always report the real `window.innerWidth` you achieved rather than the nominal target. Media queries
evaluate against the zoomed CSS viewport, so `matchMedia('(max-width: 400px)').matches` is a valid
check. Remember **Chrome zoom is per-host**, so reset with Ctrl+0 afterwards.

To prove nothing is trapped under the fixed dock, scroll to the bottom and compare geometry rather
than eyeballing it — collect the largest `getBoundingClientRect().bottom` over visible descendants of
the active panel (skipping `display:none` and closed `<details>`) and subtract it from
`.dock` `getBoundingClientRect().top`; a positive gap is the pass. Measure touch targets the same way:
`.dock-tab` heights drop to ~41.5px at `<=520px` (the mobile rule shrinks `font-size` to 13px while
keeping 11px padding), which is under the 44px guideline even though `.mini-segment`,
`.bulk-action` buttons and `.queue-link` all explicitly set `min-height: 44px`.

## Which config file the console actually reads (sample rate / duration assertions)
`/api/variants` calls `loadVariants()` on **`config/variants.yaml`** (overridable with
`NOISE_VARIANTS_FILE`); `config/variants_pilot.yaml` is only used for the `P1..P8` pilot labels and
`config/dimensions.yaml` only for the matrix. Editing `dimensions.yaml` or `variants_pilot.yaml` and
watching `/api/variants` therefore proves nothing — a common false negative.

To prove a config key is genuinely read rather than silently satisfied by a hardcoded default
(`sampleRate: number(row.sample_rate, number(output.master_sample_rate, 96000))` in `web/lib/config.ts`),
do a three-way A/B on `config/variants.yaml` with the dev server running (config is read per request,
no restart needed):

```bash
cp config/variants.yaml /tmp/variants.bak
sed -i 's/master_sample_rate: 96000/master_sample_rate: 88200/' config/variants.yaml
curl -s localhost:3000/api/variants | python3 -c "import json,sys,collections;print(collections.Counter(v['sampleRate'] for v in json.load(sys.stdin)['variants']))"
# expect 88200 -> the key IS read; then delete the key entirely and expect the literal fallback
cp /tmp/variants.bak config/variants.yaml   # always restore and confirm `git status` is clean
```

Beware: because the fallback literal equals the real configured value, a *renamed/misspelled* key
would look correct. Only the "changed value propagates" case is real proof.

Note the console surfaces only the **master** rate (`Variant.sampleRate`); no UI element derives a
stem rate, so any "48 kHz" text you see (e.g. Store answers, or a seeded QA `Sample rate` check) is
static copy or fixture data, not computed — do not read it as evidence the stems are downsampled.
Verify real stem rates from the downloaded WAVs with `soundfile.info()`
(master 96000/PCM_24, stems 48000/PCM_24). A quick UI-level sanity signal: in the Library download
menu a 48 kHz stem is ~half the byte size of the 96 kHz master of the same duration.

## Driving a release to `Ready` and reaching the DistroKid handoff
`web/lib/releases.ts` only derives `Ready` when every track has a unique title, `artSeed` is set, all
tracks are rendered with QA `PASS`, and artist/songwriter/release-date are filled. In the Releases →
release detail view the order that works is: fill **Songwriter** and **Release date** → `Generate names`
→ `Generate cover art` → `Approve names` → footer reads `Prepare for DistroKid` → click it.

Two traps:
- The footer button is a single position whose label/action changes per state, and in the handoff view a
  red **`Mark submitted`** button sits at almost the same screen position. Blind consecutive clicks
  there will jump `Ready → Submitted` and skip the handoff content entirely. Screenshot between clicks.
- To reset a release that was accidentally submitted, edit `/home/ubuntu/noisegen-out/releases.json` and
  set `"submitted": {"at": null, "storeUrl": null}`. Do **not** delete the `submitted` key — the code
  reads `release.submitted.at` unguarded and `/api/releases` then 500s with
  `TypeError: Cannot read properties of undefined (reading 'at')`, which makes the Releases tab show
  "No releases yet."

## Test-harness caveat
The screenshot tool annotates the live DOM with `devin-hidden`/`offscreen` attributes. A screenshot
captured mid-hydration makes React report "A tree hydrated but some attributes of the server rendered
HTML didn't match" — a harness artifact, not an app bug. Confirm by reloading, waiting several seconds
before any capture, and reading the console: it should be empty.

## Devin Secrets Needed
None for UI testing. Publishing/rendering paths (`make publish`, R2) would need the bucket credentials
from the repo config, but they are not required for any web-console UI test.
