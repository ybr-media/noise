---
name: testing-noise-web
description: How to run and visually test the Noise Lab Next.js console in web/ (dev server, stale .next CSS pitfall, inspecting SVG artwork and CSS load animations).
---

# Testing the Noise Lab web console (`web/`)

## Running it
- `cd web && npm run dev` → http://localhost:3000. Ready in ~1s. API routes (`/api/variants`,
  `/api/library`, `/api/queue`) are served by the same Next process; watch `npm run dev` output to
  confirm a UI action actually refetched (e.g. clicking header Refresh logs three `GET /api/... 200`).
- A "Could not load engine data" toast may appear when the Audacity render backend isn't reachable.
  It is unrelated to UI changes.

## Pitfall: stale `.next` serves a 404 CSS chunk
If the page renders completely unstyled (raw `<h1>` text visible, giant unsized SVGs, `.sr-only`
not applied), the dev server is serving a dead stylesheet. Verify with:

```
CSS=$(curl -s http://localhost:3000 | grep -o 'href="/_next/static/css/[^"]*"' | head -1 | sed 's/href="//;s/"//')
curl -s "http://localhost:3000$CSS" | head -c 200   # "Not Found" means the chunk is gone
```

Fix: kill the `next dev` process, `rm -rf web/.next`, restart `npm run dev`. Always do this check
before judging any CSS/animation behaviour — an unstyled page can look like a broken feature.

## Inspecting small header artwork (bell mark, icons)
The header mark is only 52px (44px under the 520px breakpoint), so screen zoom alone is not enough
detail. Chrome page zoom maxes at 500%, and **Chrome zoom is per-host, not per-port** — pressing
Ctrl+0 on `localhost:8899` also resets the zoom for `localhost:3000`.

For pixel-level artwork review, serve the same SVG large instead of guessing:
1. Extract the `<svg>` from `web/app/bell-mark.tsx` with a script (never retype the paths),
   set `width/height` to ~900, write it to a scratch dir next to a copy of the source raster.
2. `python3 -m http.server 8899` in that dir and open it in a second tab — you get a
   side-by-side "traced SVG vs source art" comparison at full resolution.

## Verifying CSS load animations (`globals.css`)
The bell uses `rise` (.58s), `bell-eyes-in` (.18s @ .16s) and `bell-smile-in` (.42s @ .3s,
animated `clip-path: inset()`). Screenshot round-trips are far slower than that, so to prove
*direction* and *ordering* of a wipe:
- Temporarily multiply all durations/delays by 10 in `web/app/globals.css`, reload, and take zoomed
  screenshots at ~3.5s / 4.5s / 5.5s to capture intermediate frames. Restore the file afterwards
  (`cp` a backup first, then confirm `git diff` is empty).
- `prefers-reduced-motion` can only be exercised via DevTools → **Rendering** panel → "Emulate CSS
  media feature prefers-reduced-motion". Open DevTools with F12 first; Ctrl+Shift+P while the *page*
  has focus opens the print dialog, not the command menu.
- Accessible-name checks (visually hidden `.sr-only` title inside `<h1>`, `aria-hidden` SVG) are best
  shown via DevTools → Elements → **Accessibility** pane on the `<h1>` node.

## Mobile breakpoint
Resize the real window rather than using device emulation:
`wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,0,500,900`
then reload; restore with `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.

## Devin Secrets Needed
None — everything runs locally with no credentials.
