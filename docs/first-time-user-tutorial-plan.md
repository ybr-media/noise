# First-time user tutorial — plan

**Goal:** a first-run experience for the Noise Lab console: sign in with a magic
link, detect that this is the user's first visit, and walk them through each of
the four tabs with an iOS-style tutorial wizard. This document is the build
plan (written for Devin to execute) plus open questions for the product owner.

**Grounding:** the console is a Next.js 15 App Router app in `web/`, rendered
almost entirely by one client component, `web/app/noise-lab.tsx` (~1,660
lines). It has four tabs — Design, Queue, Library, Releases — switched by
React state (`tab` at `noise-lab.tsx:822`) with hash routes for Library and
Releases, and a glass dock at the bottom (`noise-lab.tsx:1128`). There is
**no auth and no database today**; state lives in JSONL files, sidecars,
object storage, and `localStorage` (`noise.library.seen`,
`noise.library.view`, per-variant FX). The app deploys to Vercel with root
directory `web`.

---

## 1. Scope

Three features, shipped in this order because each depends on the last:

1. **Magic-link sign-in** — email in, link out, click link, session cookie.
2. **First-time-use tracking** — the server knows whether this signed-in user
   has ever completed (or skipped) the tutorial.
3. **Tutorial wizard** — an iOS-style guided tour that auto-starts on first
   sign-in, walks Design → Queue → Library → Releases, and can be replayed.

Out of scope for v1: roles/permissions, multi-tenant workspaces, restricting
API routes per-user beyond "signed in", analytics beyond the first-run flag.

---

## 2. Magic-link sign-in

### Recommendation: Auth.js (NextAuth v5) + Resend email provider + JWT sessions

The app has no database, and magic-link auth normally wants one (to store the
verification token). Two viable paths:

- **A (recommended): Auth.js v5** with the Email (magic link) flow, Resend as
  the sender, and **Upstash Redis** (Vercel Marketplace, free tier) as the
  adapter for verification tokens + user records. Sessions are stateless JWTs
  in an httpOnly cookie, so per-request auth never hits Redis.
- **B: hand-rolled** — sign a short-lived JWT into the link itself
  (`/api/auth/callback?token=…`), verify on click, set a session cookie. Zero
  storage, ~150 lines. Downsides: single-use enforcement is impossible without
  storage (a leaked link works until expiry), and we own all the security
  edges (token replay, timing, email enumeration).

Go with **A** unless the answer to open question Q1 says this is effectively a
single-user tool — then B's simplicity wins and the Upstash dependency drops.

### Implementation sketch (path A)

- `web/lib/auth.ts` — Auth.js config: Resend provider, Upstash adapter for
  tokens/users, JWT session strategy, `ALLOWED_EMAILS` allowlist check in the
  `signIn` callback (comma-separated env var; reject anyone else — this is an
  internal console, not an open signup).
- `web/app/api/auth/[...nextauth]/route.ts` — handler.
- `web/middleware.ts` — redirect unauthenticated visitors to `/signin`;
  exclude `/signin`, `/api/auth/*`, static assets. Also gate the API routes
  (`/api/library`, `/api/queue`, `/api/audio/*`, etc.) — today they are open.
- `web/app/signin/page.tsx` — a single card in the existing visual language
  (reuse `Card`, `Button`, `TOKENS` from `web/app/ui/`): email field, "Send
  sign-in link" button, then a "check your email" confirmation state. Include
  the `BellMark` so the page reads as the same product.
- Env vars (Vercel + `.env.local`): `AUTH_SECRET`, `AUTH_RESEND_KEY`,
  `AUTH_EMAIL_FROM`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
  `ALLOWED_EMAILS`.

### Acceptance criteria

- Visiting any page signed out lands on `/signin`.
- Submitting an allowlisted email delivers a link; clicking it signs in and
  redirects to `/`. Non-allowlisted emails get the same "check your email" UI
  (no enumeration) but no mail is sent.
- Link expires (15 min) and is single-use. Session lasts 30 days, sliding.
- The queue worker and Python engine are untouched — auth is web-only.

---

## 3. First-time-use tracking

The flag must answer one question: **has this user ever finished or skipped
the tutorial?** Because sign-in is cross-device (magic link from a phone,
console on a laptop), the flag should live with the user record, not in
`localStorage` — otherwise every new device replays the tutorial (see Q4).

- Store `tutorialCompletedAt: string | null` (and `tutorialVersion: number`)
  on the Upstash user record.
- `GET /api/me` returns `{ email, tutorialCompletedAt, tutorialVersion }`;
  `POST /api/me/tutorial` marks it complete (called on finish *and* on skip —
  a skip is still "seen it", see Q5).
- Client: `NoiseLab` fetches `/api/me` on mount; if `tutorialCompletedAt` is
  null, launch the wizard after first data load settles (variants fetched),
  not at t=0 — the tour should point at real UI, not skeletons.
- Bump `tutorialVersion` in code when the tour changes materially enough to
  warrant a re-show (mechanism only; do not auto-re-show in v1).
- Mirror the flag in `localStorage` (`noise.tutorial.done`) purely as a fast
  first-paint guard so returning users never see a wizard flash before
  `/api/me` responds.

---

## 4. The tutorial wizard

### Form: iOS-style coach-mark tour driven from a bottom sheet

Two common iOS patterns were considered:

- **Full-screen onboarding pager** (swipeable cards before you see the app) —
  rejected: it explains screenshots instead of the real product.
- **Spotlight coach marks + bottom card** (the tour dims the app, cuts a
  highlight around the real control, and a card explains it) — **chosen**. It
  matches the app's existing glass/sheet language (the queue tab already uses
  a bottom sheet) and teaches on live UI.

Build it in-repo — no tour library. The app is one component with full control
of tab state, which is exactly what a tour needs; a dependency would fight the
custom dock and sheets. Estimated ~300 lines: `web/app/ui/tutorial.tsx` plus
CSS in `globals.css`.

### Mechanics

- **Backdrop:** fixed overlay, `rgba(0,0,0,0.45)` with `backdrop-filter:
  blur(2px)`, cut out around the highlighted element using an SVG mask (or
  four-rect approach) with a rounded rect matching the target's radius. The
  cutout animates between steps with a spring-ish ease (`0.45s cubic-bezier
  (0.32, 0.72, 0, 1)` — the iOS sheet curve already implied by the app's
  motion).
- **Card:** a bottom sheet in the existing `Card` style: step title, 1–2
  sentence body, iOS page-control dots, **Next** (primary red `#e5483c`, the
  Design-tab primary), **Back** (text), and a persistent **Skip** in the top
  corner of the overlay. On desktop widths the card docks bottom-center at a
  max width (~420px) rather than full-bleed.
- **Targets by ref/data-attribute:** each step names a `data-tour="…"`
  attribute; the wizard measures it with `getBoundingClientRect`, re-measures
  on resize/scroll, and scrolls it into view before highlighting. Add the
  attributes to the real controls in `noise-lab.tsx`.
- **Tab driving:** steps carry a `tab` field; advancing calls the existing
  `setTab` so the tour physically walks the app. The wizard must wait a frame
  after a tab switch before measuring (panels toggle `hidden`).
- **Interactivity:** v1 is **watch-only** — the overlay swallows pointer
  events except on the card. (Letting users actually tap the highlighted
  control mid-tour is the classic scope-doubler; see Q6.)
- **Escape hatches:** Skip always visible; Esc closes; closing = skip =
  `POST /api/me/tutorial`. Replay lives in the existing per-tab info button
  pattern (`tabInfoOpen`, `noise-lab.tsx:1120`) — add "Replay tour" inside
  that tooltip, which restarts the wizard without touching the server flag.
- **Empty-state honesty:** on a fresh account Queue/Library/Releases are
  empty. Steps for those tabs must highlight the *chrome* (the tab, the
  header, the empty-state card) and describe what will appear — never point
  at a card that doesn't exist. The step definitions should not assume data.
- **Accessibility:** the card is a focus-trapped `role="dialog"`; dots are
  `aria-hidden` with an SR-only "Step 3 of 9"; respect
  `prefers-reduced-motion` (cross-fade instead of the moving cutout).

### Step script (draft — copy to be tightened, see Q7)

| # | Tab | Target (`data-tour`) | Message (draft) |
|---|-----|----------------------|-----------------|
| 1 | — | none (centered card) | **Welcome to Noise Lab.** Design deterministic noise variants, render them through Audacity, and publish the results. This tour takes about a minute. |
| 2 | Design | `design-params` | Every track starts here: pick a color, texture, motion, and mix. The same choices always produce the same sound. |
| 3 | Design | `design-fx` | EQ and reverb presets shape the render itself — not just the preview. Flat and Off are honest defaults. |
| 4 | Design | `design-render` | Render sends your design to the engine. Depending on setup it runs locally or via GitHub Actions. |
| 5 | Queue | `dock-queue` | The Queue tracks each job: Queued, Rendering, Done, or Failed. No fake progress bars — statuses are real. |
| 6 | Library | `dock-library` | Finished masters land in the Library. Play them, check QA results, download the master or its three stems. |
| 7 | Library | `library-naming` | Titles and descriptions can be suggested for you, but nothing is written until you approve it. |
| 8 | Releases | `dock-releases` | Releases bundles approved masters into a publishable set. |
| 9 | — | none (centered card) | **That's the loop:** design → render → review → release. Replay this any time from the ⓘ button. |

### Acceptance criteria

- First sign-in: wizard auto-opens after variants load; completing or
  skipping it sets the server flag; it never auto-opens again on any device.
- Steps drive the real tabs; every highlight lands on a visible element at
  390×844 and 1280×900 (the two sizes the tab audit uses).
- Replay works from the info tooltip on every tab.
- `npm run lint` and the existing tests stay green; the wizard renders
  nothing at all for users with the flag set (zero cost on the hot path).

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
   `web/middleware.ts`, `web/app/signin/page.tsx` (reuse `ui/` components).
3. Allowlist enforcement + no-enumeration behavior; 15-min single-use links.
4. Gate all existing `/api/*` routes except `/api/auth/*`.
5. Tests: middleware redirect, allowlist rejection, signed-in passthrough.

**Phase 2 — First-run flag (0.5–1 day)**
1. Extend user record with `tutorialCompletedAt` / `tutorialVersion`.
2. `GET /api/me`, `POST /api/me/tutorial`.
3. Client hook `useFirstRun()` in `web/lib/` + `localStorage` mirror.

**Phase 3 — Wizard (3–4 days)**
1. `web/app/ui/tutorial.tsx`: overlay with masked cutout, sheet card, dots,
   step engine (measure/scroll/retarget), reduced-motion path.
2. Add `data-tour` attributes to the targets in `noise-lab.tsx`; wire
   `setTab` driving and the post-switch measurement frame.
3. Step definitions + copy from §4 (owner-reviewed before merge).
4. Replay entry in the tab info tooltip.
5. Complete/skip → `POST /api/me/tutorial`.
6. Screenshot review of every step at both breakpoints, light and dark-ish
   backgrounds, empty and populated Library.

**Guardrails for Devin**
- Don't add a tour library, a CSS framework, or a database beyond Upstash.
- Don't restyle existing tabs; the wizard adopts the app's tokens
  (`web/app/ui/tokens.ts`) as-is. Note the tab-cohesion audit
  (`docs/tab-cohesion-audit.md`) — don't make its 57-hex-colors problem worse;
  new CSS uses the declared tokens.
- The Python engine, worker, and render queue are off-limits.
- Every step must render correctly against an **empty** account.

---

## 6. Open questions for the product owner

Answers to these materially change the build — Q1–Q3 block Phase 1, Q4–Q5
block Phase 2, Q6–Q9 block Phase 3 copy/behavior but not its scaffolding.

- **Q1 — Who signs in?** Is this just you, a small fixed team, or eventually
  external users? (Just you → drop Upstash and use the stateless hand-rolled
  magic link, path B. External users → allowlist becomes a signup policy
  question.)
- **Q2 — Email sender?** Is Resend acceptable, or do you have an existing
  transactional email provider/domain (e.g. something already sending from
  `marlo.today`) the link should come from? What From address?
- **Q3 — Should the hosted console be fully private?** Today all API routes
  are open. Plan gates everything behind sign-in — including audio streaming
  URLs. Any route that must stay public (e.g. shared preview links)?
- **Q4 — Per-user or per-device first-run?** Plan says per-user (server
  flag), so a second device does *not* replay the tour. Confirm — or would
  you rather each new device gets the tour once?
- **Q5 — Does skipping count as done?** Plan says yes (skip = never auto-show
  again, replay stays available). Alternative: re-offer once on next sign-in.
- **Q6 — Watch-only or hands-on?** v1 tour is watch-only (overlay blocks
  taps). A hands-on version ("now tap Render yourself") is much stickier but
  roughly doubles Phase 3 and needs a queued job to exist. Worth it for v1?
- **Q7 — Copy voice.** The draft script in §4 is utilitarian. Should the
  tone match anything existing (the info-tooltip texts, Marlo brand voice)?
  Please edit the table copy directly — it's the single highest-leverage
  review you can do for tour quality.
- **Q8 — Render modes in the tour.** Step 4 mentions local vs. dispatch
  rendering. In `unavailable` mode Render returns 503 — should the tour
  detect the mode and swap that step's copy (e.g. "this console is
  browse-only"), or keep one generic script?
- **Q9 — Seed content.** On a brand-new account the Library is empty, so
  steps 6–7 point at an empty state. Should we ship a demo master (or point
  the tour at published artifacts if `NOISE_ARTIFACTS_BASE_URL` is set) so
  the first-run Library has something real to show?
