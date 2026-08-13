# First-time user tutorial — plan

**Goal:** a first-run experience for the Noise Lab console: sign in with a magic
link, detect that this is the user's first visit, and walk them through each of
the four tabs with an iOS-style, **hands-on** tutorial. This document is the
build plan (written for Devin to execute) plus the remaining open questions for
the product owner.

**Grounding:** the console is a Next.js 15 App Router app in `web/`, rendered
almost entirely by one client component, `web/app/noise-lab.tsx` (~1,660
lines). It has four tabs — Design, Queue, Library, Releases — switched by
React state (`tab` at `noise-lab.tsx:822`) with hash routes for Library and
Releases, and a glass dock at the bottom (`noise-lab.tsx:1128`). There is
**no auth and no database today**; state lives in JSONL files, sidecars,
object storage, and `localStorage` (`noise.library.seen`,
`noise.library.view`, per-variant FX). The app deploys to Vercel with root
directory `web`.

## Decisions (owner-confirmed)

| Question | Decision |
|---|---|
| Audience | **A team**, not a single user. Owner tests first. Auth path A (Auth.js + store) is confirmed; the stateless fallback is dropped. |
| Email sender | **Resend**, sending from the `ybellrecords.com` domain (account owned by eric@ybellrecords.com). |
| Audio URL privacy | Console and APIs are gated, but **audio URLs stay shareable once grabbed** — `/api/audio/[filename]` is not session-gated. |
| Tour style | **Hands-on.** The user performs each core action themselves; the tour reacts to what they actually did. |

---

## 1. Scope

Three features, shipped in this order because each depends on the last:

1. **Magic-link sign-in** — email in, link out, click link, session cookie.
2. **First-time-use tracking** — the server knows whether this signed-in user
   has ever completed (or skipped) the tutorial.
3. **Hands-on tutorial** — an iOS-style guided tour that auto-starts on first
   sign-in and has the user actually design a variant, send it to render,
   watch it in the Queue, and play a track in the Library.

Out of scope for v1: roles/permissions, multi-tenant workspaces, restricting
API routes per-user beyond "signed in", analytics beyond the first-run flag.

---

## 2. Magic-link sign-in

**Auth.js (NextAuth v5) + Resend email provider + JWT sessions** — confirmed
by the audience decision (team = we need real user records anyway).
**Upstash Redis** (Vercel Marketplace, free tier) is the adapter for
verification tokens + user records. Sessions are stateless JWTs in an
httpOnly cookie, so per-request auth never hits Redis.

### Implementation sketch

- `web/lib/auth.ts` — Auth.js config: Resend provider, Upstash adapter for
  tokens/users, JWT session strategy, allowlist check in the `signIn`
  callback. Allowlist supports **both full addresses and whole domains**:
  `ALLOWED_EMAILS="@ybellrecords.com,austin@marlo.today"` — reject anyone
  else; this is an internal console, not an open signup.
- `web/app/api/auth/[...nextauth]/route.ts` — handler.
- `web/middleware.ts` — redirect unauthenticated visitors to `/signin`.
  Excluded from the gate: `/signin`, `/api/auth/*`, static assets, and
  `/api/audio/*` (see below). All other API routes (`/api/library`,
  `/api/queue`, `/api/variants`, `/api/names/*`, `/api/releases`,
  `/api/bundle/*`) require a session — today they are open.
- **Audio stays link-shareable (owner decision):** `/api/audio/[filename]`
  is not session-gated, so a copied URL keeps working for teammates or
  external listeners. Trade-off to be aware of: filenames are deterministic
  parameter fingerprints, so audio is effectively public-if-known-URL. If
  that ever becomes a problem, the upgrade path is short-lived signed URLs —
  noted here, not built in v1.
- `web/app/signin/page.tsx` — a single card in the existing visual language
  (reuse `Card`, `Button`, `TOKENS` from `web/app/ui/`): email field, "Send
  sign-in link" button, then a "check your email" confirmation state. Include
  the `BellMark` so the page reads as the same product.
- Env vars (Vercel + `.env.local`): `AUTH_SECRET`, `AUTH_RESEND_KEY`,
  `AUTH_EMAIL_FROM` (an address on the verified `ybellrecords.com` Resend
  domain, e.g. `signin@ybellrecords.com` — eric@ybellrecords.com to confirm
  the exact From), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
  `ALLOWED_EMAILS`.
- The sign-in email itself is part of the first impression: Noise Lab
  wordmark + `BellMark`, one button, plain-text fallback. No marketing.

### Acceptance criteria

- Visiting any page signed out lands on `/signin`.
- Submitting an allowlisted email (exact or domain match) delivers a link
  from the ybellrecords.com domain; clicking it signs in and redirects to
  `/`. Non-allowlisted emails get the same "check your email" UI (no
  enumeration) but no mail is sent.
- Link expires (15 min) and is single-use. Session lasts 30 days, sliding.
- A raw `/api/audio/...` URL fetched with no cookies still streams (range
  requests included). Every other `/api/*` route 401s without a session.
- The queue worker and Python engine are untouched — auth is web-only.

---

## 3. First-time-use tracking

The flag must answer one question: **has this user ever finished or skipped
the tutorial?** Because sign-in is cross-device (magic link from a phone,
console on a laptop), the flag lives with the user record, not in
`localStorage` — otherwise every new device replays the tutorial (see Q4).

- Store `tutorialCompletedAt: string | null` (and `tutorialVersion: number`)
  on the Upstash user record.
- `GET /api/me` returns `{ email, tutorialCompletedAt, tutorialVersion }`;
  `POST /api/me/tutorial` marks it complete (called on finish *and* on skip —
  a skip is still "seen it", see Q5).
- Client: `NoiseLab` fetches `/api/me` on mount; if `tutorialCompletedAt` is
  null, launch the tour after first data load settles (variants fetched),
  not at t=0 — the tour points at real UI, not skeletons.
- Bump `tutorialVersion` in code when the tour changes materially enough to
  warrant a re-show (mechanism only; do not auto-re-show in v1).
- Mirror the flag in `localStorage` (`noise.tutorial.done`) purely as a fast
  first-paint guard so returning users never see a tour flash before
  `/api/me` responds.

---

## 4. The hands-on tutorial

### Form: iOS-style coach marks where the user drives

The tour dims the app with a spotlight cutout and a bottom-sheet card — but
unlike a watch-only tour, **the highlighted control is live**. Each core step
asks the user to do the real thing (pick a color, hit Render, press play) and
advances only when the app state says they actually did it. By the end of the
tour the user has designed a variant, put a real job in the queue, and heard
a track — not watched a slideshow about it.

Build it in-repo — no tour library. The app is one component with full
control of tab state and every action handler, which is exactly what an
action-reactive tour needs; a dependency would fight the custom dock and
sheets. Estimated ~450–550 lines: `web/app/ui/tutorial.tsx` plus CSS in
`globals.css` and thin hooks in `noise-lab.tsx`.

### Mechanics

- **Backdrop with a live hole:** four positioned blocker `div`s around the
  target rectangle (not one masked overlay) — the hole is genuinely empty,
  so clicks/taps/drags pass through to the real control for free, while
  everything outside it is inert. Rounded-corner illusion via an SVG ring
  drawn on top with `pointer-events: none`. The cutout animates between
  steps on the iOS sheet curve (`0.45s cubic-bezier(0.32, 0.72, 0, 1)`) and
  idles with a slow, subtle breathing pulse so the eye finds it.
- **Card:** a bottom sheet in the existing `Card` style: step title, 1–2
  sentence body, iOS page-control dots, and a persistent **Skip** in the top
  corner of the overlay. Action steps show no Next button — the user's
  action *is* Next. Info steps show **Next** (primary red `#e5483c`) and
  **Back** (text). On desktop widths the card docks bottom-center at a max
  width (~420px) rather than full-bleed.
- **Advance on real state, not DOM guesses:** the tour exposes a tiny event
  bus; `noise-lab.tsx` calls `tour.notify("param-selected")`,
  `tour.notify("render-enqueued")`, `tour.notify("track-played")`, etc.,
  one line each inside the existing handlers. Steps declare which event
  advances them. No selector-sniffing, no brittle DOM listeners.
- **Celebrate completed actions:** when an action step's event fires, the
  ring flashes to a green check with a spring scale (the app already has
  `Check` from lucide), a light `navigator.vibrate(10)` haptic where
  supported, and the card swaps to a one-line confirmation ("Queued. That's
  a real render job.") before sliding to the next step. Small, fast,
  everywhere — this is most of the "wow" budget.
- **"Do it for me":** if the user stalls on an action step (~10s), a quiet
  secondary button fades in that performs the action programmatically and
  advances. Nobody gets stuck; nobody is forced to be hands-on.
- **Targets by `data-tour` attribute:** each step names a `data-tour="…"`;
  the tour measures it with `getBoundingClientRect`, re-measures on
  resize/scroll, and scrolls it into view before highlighting. Tab-switch
  steps highlight the dock button itself and advance when the user taps it
  (the existing `setTab` handler notifies the bus). Wait a frame after tab
  switches before measuring (panels toggle `hidden`).
- **Mode-aware script:** the console reports `local`, `dispatch`, or
  `unavailable` render modes. In `unavailable` mode the Render step swaps to
  an info step ("This console is browse-only — designs render elsewhere and
  land in the Library") and the Queue step describes rather than points at
  the user's job. The step list is data; mode picks between two copy
  variants per affected step.
- **Seeded demo track:** hands-on Library steps need something to play on a
  fresh deployment, and the user's own render won't be done in time. Ship a
  short bundled demo master (~20–30 s WAV + sidecar) under `web/demo/`,
  surfaced through the existing library pipeline with a dismissible "Demo"
  chip, served by a special case in the audio route. When
  `NOISE_ARTIFACTS_BASE_URL` already yields published masters, prefer the
  real library and skip the demo entirely.
- **The render outlives the tour:** the tour never blocks on the user's
  render finishing. A background watcher keeps polling after the tour ends
  and fires a one-time banner when their first job completes — "Your first
  render is done — hear it in the Library" — which deep-links to the track.
  The tour's last card promises this, and the app keeps the promise.
- **Escape hatches:** Skip always visible; Esc closes; closing = skip =
  `POST /api/me/tutorial`. Replay lives in the existing per-tab info button
  pattern (`tabInfoOpen`, `noise-lab.tsx:1120`) — add "Replay tour" inside
  that tooltip, which restarts the tour without touching the server flag.
- **Finale:** the last card recaps what *they* did, from real state — "You
  designed **Green · Broad · Drift**, queued render #12, and played your
  first master." One brief confetti burst (canvas, ~1.5 s, skipped under
  `prefers-reduced-motion`), then done. Confetti appears exactly once in the
  product, here.
- **Accessibility:** the card is a focus-trapped `role="dialog"` — except
  that focus may move into the live cutout during action steps; dots are
  `aria-hidden` with an SR-only "Step 3 of 10"; every action step's
  instruction is announced via `aria-live`; `prefers-reduced-motion` gets
  cross-fades instead of the moving cutout, no pulse, no confetti.

<a name="step-script"></a>
### Step script (draft — copy to be tightened, see Q7)

Types: **info** advances on Next; **action** advances when the named event
fires (and always offers "Do it for me" after a stall).

| # | Type | Tab | Target (`data-tour`) | Advance event | Message (draft) |
|---|------|-----|----------------------|---------------|-----------------|
| 1 | info | — | none (centered card) | — | **Welcome to Noise Lab.** You're about to design a noise variant, render it, and hear it — for real, not a demo. Takes about two minutes. |
| 2 | action | Design | `design-params` | `param-selected` | Every track starts here. **Tap a color** — white, green, pink, or brown. The same choices always make the same sound. |
| 3 | action | Design | `design-params` | `param-selected` (different group) | Now shape it: **pick a texture, motion, or mix.** Watch the caption update — that's your variant's fingerprint. |
| 4 | action | Design | `design-fx` | `fx-changed` | EQ and reverb shape the render itself, not just the preview. **Try a preset** — Flat and Off are always safe to come back to. |
| 5 | action | Design | `design-render` | `render-enqueued` | Ready? **Hit Render.** This queues a real job with the engine. *(unavailable mode → info: "This console is browse-only — designs render elsewhere and land in the Library.")* |
| 6 | action | Queue | `dock-queue` | `tab-changed:queue` | Your job went somewhere. **Tap the Queue tab** to find it. |
| 7 | info | Queue | `queue-job` (their job) | — | There it is — Queued, then Rendering, then Done. No fake progress bars; these statuses are real. You don't have to wait here. |
| 8 | action | Library | `dock-library` | `tab-changed:library` | Finished masters live in the Library. **Tap the Library tab.** |
| 9 | action | Library | `library-track` | `track-played` | **Press play** on this track. Masters here are QA'd and downloadable — the master plus its three stems. |
| 10 | info | Library | `library-naming` | — | Titles can be suggested for you, but nothing is written until you approve it. Releases (last tab) bundles approved masters into a publishable set. |
| 11 | info | — | none (centered card) | — | **You did the whole loop:** designed {their params}, queued render #{n}, played your first master. We'll ping you here when your render is done. Replay this any time from the ⓘ button. |

### Acceptance criteria

- First sign-in: tour auto-opens after variants load; completing or skipping
  it sets the server flag; it never auto-opens again on any device.
- Action steps advance **only** from the real event — clicking Next-less
  cards does nothing; "Do it for me" appears after a stall and works on
  every action step.
- The Render step creates a genuine queue job in `local`/`dispatch` modes
  and swaps to the browse-only copy in `unavailable` mode.
- Step 9 always has a playable track: seeded demo on empty deployments,
  real published masters otherwise.
- The post-tour "first render done" banner fires exactly once and
  deep-links to the finished track.
- Every highlight lands on a visible, *interactive* element at 390×844 and
  1280×900 (the two sizes the tab audit uses).
- Replay works from the info tooltip on every tab.
- `npm run lint` and the existing tests stay green; the tour renders nothing
  at all for users with the flag set (zero cost on the hot path).

---

## 5. Build plan for Devin

Work on a branch off `main`; one PR per phase, in order. Root directory for
all JS work is `web/`. Test with the existing setup (`web/test/`, tsx runner)
plus Playwright checks at 390×844 and 1280×900 per the
`.agents/skills/testing-noise-web` skill.

**Phase 1 — Auth (2–3 days)**
1. Add Auth.js v5, Resend provider, Upstash adapter; env vars documented in
   `web/README.md`.
2. `web/lib/auth.ts`, `web/app/api/auth/[...nextauth]/route.ts`,
   `web/middleware.ts`, `web/app/signin/page.tsx` (reuse `ui/` components),
   branded sign-in email template.
3. Domain + exact-address allowlist; no-enumeration behavior; 15-min
   single-use links.
4. Gate all existing `/api/*` routes **except** `/api/auth/*` and
   `/api/audio/*` (owner decision: audio links stay shareable).
5. Tests: middleware redirect, allowlist domain + exact matching, rejection,
   signed-in passthrough, audio route open without cookies.

**Phase 2 — First-run flag (0.5–1 day)**
1. Extend user record with `tutorialCompletedAt` / `tutorialVersion`.
2. `GET /api/me`, `POST /api/me/tutorial`.
3. Client hook `useFirstRun()` in `web/lib/` + `localStorage` mirror.

**Phase 3 — Hands-on tour (5–7 days)**
1. `web/app/ui/tutorial.tsx`: four-blocker overlay with live cutout, SVG
   ring, sheet card, dots, step engine, event bus, "Do it for me",
   reduced-motion paths.
2. `data-tour` attributes + one-line `tour.notify(...)` calls in the
   existing handlers of `noise-lab.tsx`; tab driving via the real `setTab`.
3. Mode-aware step definitions + copy from §4 (owner-reviewed before merge).
4. Seeded demo track (`web/demo/` master + sidecar, "Demo" chip, audio-route
   special case, hidden when published artifacts exist).
5. Action celebrations (check flash, haptic), finale recap + one-shot
   confetti, post-tour first-render-done banner with deep link.
6. Replay entry in the tab info tooltip; complete/skip →
   `POST /api/me/tutorial`.
7. Screenshot review of every step at both breakpoints, empty and populated
   Library, all three render modes.

**Guardrails for Devin**
- Don't add a tour library, a CSS framework, or a database beyond Upstash.
- Don't restyle existing tabs; the tour adopts the app's tokens
  (`web/app/ui/tokens.ts`) as-is. Note the tab-cohesion audit
  (`docs/tab-cohesion-audit.md`) — don't make its 57-hex-colors problem
  worse; new CSS uses the declared tokens.
- `tour.notify(...)` hooks must be one-line and inert when no tour is
  running — zero behavior change for users past first run.
- The Python engine, worker, and render queue are off-limits (the demo track
  is static files, not a render path).
- Every step must work against an **empty** account in every render mode.

---

## 6. Open questions for the product owner

Q1–Q3 and Q6 are answered (see Decisions above). Still open:

- **Q4 — Per-user or per-device first-run?** Plan says per-user (server
  flag), so a second device does *not* replay the tour. Confirm — or would
  you rather each new device gets the tour once?
- **Q5 — Does skipping count as done?** Plan says yes (skip = never auto-show
  again, replay stays available). Alternative: re-offer once on next sign-in.
- **Q7 — Copy voice.** The draft script in §4 is utilitarian. Edit the step
  table directly — it's the single highest-leverage review you can do for
  tour quality. Should the tone match anything existing (the info-tooltip
  texts, Marlo brand voice)?
- **Q10 — Real render during the tour: OK?** Hands-on means step 5 enqueues
  a genuine job (a worker render locally, a GitHub Actions run in dispatch
  mode). Fine, or should the tour's render be marked/throttled somehow?
- **Q11 — Demo track source.** Devin needs a ~20–30 s master + sidecar to
  bundle. Do you want to render one specific variant for this (which one?),
  or should Devin pick any variant and render it via the normal pipeline?
- **Q12 — Exact From address** for the sign-in email on ybellrecords.com
  (e.g. `signin@` vs `noreply@`) — needs eric to confirm what's verified in
  Resend.
