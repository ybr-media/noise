---
name: testing-noise-web
description: How to run and visually test the Noise Lab Next.js console in web/ (dev and production servers, seeding Library/Queue data for count badges, tab selectors and hash routing, stale .next pitfalls, inspecting SVG artwork and CSS load animations).
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
  media feature prefers-reduced-motion". Open DevTools with F12 first; Ctrl+Shift+P while the *page*
  has focus opens the print dialog, not the command menu.
- Anything server-rendered and then hidden by a `useEffect` (`matchMedia` checks, splash/intro
  overlays) still paints before hydration. Re-check on the production build before reporting, and
  take the screenshot immediately after `Ctrl+Shift+R` (no `wait` first) to catch the first frame.
- Accessible-name checks (visually hidden `.sr-only` title, `aria-hidden` SVG) are best shown via
  DevTools → Elements → **Accessibility** pane.

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

## Test-harness caveat
The screenshot tool annotates the live DOM with `devin-hidden`/`offscreen` attributes. A screenshot
captured mid-hydration makes React report "A tree hydrated but some attributes of the server rendered
HTML didn't match" — a harness artifact, not an app bug. Confirm by reloading, waiting several seconds
before any capture, and reading the console: it should be empty.

## Devin Secrets Needed
None for UI testing. Publishing/rendering paths (`make publish`, R2) would need the bucket credentials
from the repo config, but they are not required for any web-console UI test.
