# Add to Home Screen — first-run install flow

**Product:** Noise Lab (mobile-first web console) · **Date:** 2026-08-21
**Code grounding:** `web/app/layout.tsx`, `web/lib/auth.ts`, `web/lib/use-first-run.ts`,
`web/lib/tutorial.ts`, `web/app/ui/tutorial.tsx`, `web/app/signin/page.tsx`,
`web/lib/middleware-access.ts`, `web/app/globals.css`
**Status:** spec for build. Section 11 lists the decisions the owner still owns.

---

## 1. Why

The console is already shaped like an app: a 660px column, a floating dock, safe-area
insets on every fixed element (`globals.css:67,318,361`), haptics on tour progress
(`tutorial.tsx`), pull-to-refresh (`lib/use-pull-refresh.ts`). What it is missing is the
one thing that makes a phone treat it as an app — a home-screen icon. Today a teammate
who wants to dial in a variant on their phone has to find a Safari tab, and every render
they start is watched through browser chrome that eats 120px of a 390px screen.

Nothing in the app asks them to install it, and nothing tells them how. Both instructions
below — email and first run — exist because the two moments are different: the email
reaches them on the device that should hold the icon, and the first run reaches them when
they have already decided the app is worth keeping.

## 2. What exists today

| Concern | State | Where |
|---|---|---|
| Web app manifest | **None.** No `app/manifest.ts`, no `public/manifest.webmanifest` | — |
| Service worker | **None** | — |
| Icons | `app/icon.svg` (bell, yellow on transparent) and `app/apple-icon.png` (180×180) | `web/app/` |
| iOS meta | **None** — no `apple-mobile-web-app-capable`, no status-bar style | `app/layout.tsx` |
| Sign-in | Magic link only, Auth.js + Resend, 15-minute single-use link, 30-day JWT cookie | `lib/auth.ts` |
| First-run flag | `tutorialCompletedAt` / `tutorialVersion` on the Upstash user record, read by `GET /api/me`, written by `POST /api/me/tutorial`, mirrored to `localStorage["noise.tutorial.done"]` as a first-paint guard | `lib/tutorial.ts`, `lib/use-first-run.ts` |
| First-run tour | 8 steps, auto-starts when `firstRunShouldLaunch(state) && variants.length > 0` | `app/ui/tutorial.tsx`, `noise-lab.tsx:1013` |
| Transactional email | One template, inline-styled, `TOKENS.brand` button, plain-text fallback | `lib/auth.ts` |
| Auth bypass for static paths | Any non-`/api/` path with a dot in its last segment bypasses the gate — so `/manifest.webmanifest` and `/sw.js` are reachable signed out without touching the matcher | `lib/middleware-access.ts:10` |

So this is a green-field install flow on top of an app that is one manifest away from
being installable.

## 3. The constraint that shapes the whole flow

**Installing does not carry the session over on iOS.** A home-screen web app on iOS runs
in its own storage partition: the `authjs.session-token` cookie set in Safari is not
visible to the icon the user just added. Chromium is the opposite — an installed app runs
in the browser's profile and keeps the cookie.

| Platform | After install, first launch | Consequence |
|---|---|---|
| iOS Safari → home screen | **Signed out** | Must sign in again *inside* the installed app |
| Android Chrome / Edge (installed) | Signed in | Nothing to do |
| Desktop Chrome / Edge (installed) | Signed in | Nothing to do |

And a magic link cannot fix the iOS case: tapping a link in Mail opens Safari, never the
installed app (there is no universal-link association for a web app). The user would sign
in to the browser they were trying to leave, reopen the icon, and still be signed out.

**Therefore the install flow depends on a credential the user can carry across contexts:
a sign-in code they can read in Mail and type into the installed app.** §7 Phase 2 is a
hard dependency of §7 Phase 3, not a nice-to-have. Without it, "add to home screen" on
iOS produces an icon that cannot be signed into, which is worse than no icon.

Auth.js's email provider makes this cheap: the token in the magic link *is* the
credential. Override `generateVerificationToken()` to return a short, typeable token and
the same value works both ways — tapped as `…/api/auth/callback/resend?token=…&email=…`
in Safari, or typed into a field in the installed app.

## 4. The flow

Two entry points, one destination. Neither claims the app was installed — the app only
says so once it observes itself running standalone (the tour review's D4: never
congratulate for something that did not happen).

### 4.1 Email — every new user gets the steps once

Triggered when the Upstash user record is created, which for the email provider happens
on the **first successful sign-in**, not on the link request. `lazyAdapter()` already
intercepts `createUser` to seed `tutorialCompletedAt` (`lib/auth.ts:94`); the same hook
enqueues the welcome email and stamps `installEmailSentAt`.

Timing note: it lands while the user is looking at the console in their browser, which is
exactly when the in-app sheet (§4.2) is also telling them about it. That repetition is
deliberate — the sheet gets them to do it now, the email gets them to do it tonight.

Resendable on demand from the install sheet and from the (i) tooltip
(`POST /api/me/install-email`, rate-limited to 1 per 10 minutes and 5 per day per user).

The email is not the sign-in email. The sign-in email stays lean — it is read under time
pressure by someone who wants to get in, and the plan doc's "no marketing" rule for it
still holds. The only change there is that it gains a code block next to the button (§7
Phase 2).

### 4.2 First run — an install sheet before the tour

`useFirstRun` already knows this is the user's first session. Install becomes the step
before the tour rather than a step inside it, because it is the only step that can end
with the user leaving the browser.

```
/api/me resolves, variants loaded
  └─ installSheetDecision(platform, device state, user record)
       ├─ "show"  → install sheet, tour deferred
       └─ "skip"  → tour starts as it does today (noise-lab.tsx:1013)
```

The sheet is a bottom sheet in the existing `.activity-sheet` language: backdrop, Escape
and backdrop-tap to close, ≥44px targets, "Step 2 of 3" as text.

- **Title** — *Keep Noise Lab on your home screen*
- **Body** — one line on why, then the platform-specific steps (§5.2)
- **Primary** — `Install` (Chromium: fires the captured `beforeinstallprompt`) or
  `Show me how` (iOS: expands the three steps in place)
- **Secondary** — `Email me the steps`
- **Dismiss** — `Not now` (≥44px, not a 12px grey word — the tour review's D9)

Choosing `Not now` starts the tour immediately in the browser. Dismissing by backdrop or
Escape does the same. Only the explicit "I've added it" path defers the tour, and it
defers rather than cancels: `tutorialCompletedAt` stays null, so the tour runs on the
first standalone launch — where the user will actually be using the app.

### 4.3 Signing in inside the installed app

First standalone launch on iOS lands on `/signin` with no session. The page reads its own
display mode and reorders itself:

- **Standalone:** heading *Sign in to the app*, code field first and focused
  (`inputmode="text"`, `autocomplete="one-time-code"`), `Send me a code` below it. The
  magic-link button is demoted with one line of honesty: *the link opens your browser, so
  use the code here*.
- **Browser:** unchanged from today, plus a small `I have a code` disclosure.

After a successful code sign-in inside the app, the pending tour starts. That is the
payoff of deferring it in §4.2: the walkthrough runs in the standalone chrome the user
just chose, and the "Create track" step points at a dock that is not covered by a
browser toolbar.

### 4.4 Return visits

- Running standalone → never prompt. `firstStandaloneAt` is stamped on the user record
  the first time any session reports `display-mode: standalone` (one `POST /api/me/install`
  call, fire-and-forget).
- Browser, prompt previously dismissed on this device → nothing until the snooze expires
  (§6).
- Browser, user has `firstStandaloneAt` from another device → the sheet, if it shows at
  all, opens on the softer copy: *You already run Noise Lab from a home screen elsewhere.
  Add it here too?*
- The (i) tooltip gains `Add to home screen` beside `Replay tutorial`, which reopens the
  sheet on any device at any time. That is the manual escape hatch that lets every
  automatic prompt below stay conservative.

## 5. Copy

House voice: concrete, no adjectives that cannot be checked, no promise the build does not
keep. Nothing here mentions offline use or notifications — we are not shipping either
(§10).

### 5.1 Welcome email

**Subject:** Put Noise Lab on your home screen
**Preheader:** Three taps, and the console opens like an app.

> **Noise Lab**
>
> You're in. One thing worth doing on your phone: add Noise Lab to your home screen. It
> opens full-screen, without browser chrome, and it's the difference between a tab you
> lose and an app you use.
>
> **iPhone or iPad — open this email's link in Safari first**
> 1. Tap the Share button — the square with the arrow.
> 2. Scroll down and tap **Add to Home Screen**.
> 3. Tap **Add**.
>
> **Android**
> 1. Tap the ⋮ menu in Chrome.
> 2. Tap **Install app** (or **Add to Home screen**).
> 3. Tap **Install**.
>
> **The first time you open the icon on an iPhone, it will ask you to sign in again** —
> a home-screen app doesn't share Safari's session. Tap **Send me a code**, then type the
> code from the email we send. Codes work where links don't.
>
> [ Open Noise Lab ]  ← same link, still 15 minutes
>
> Sign-in code: **7K4M-2XQP**

Plain-text alternative carries the same three-step lists and the same code.

### 5.2 Install sheet, by platform

| Platform | Steps shown |
|---|---|
| `ios-safari` | Tap the Share button at the bottom of Safari → **Add to Home Screen** → **Add**. Rendered with the SF share glyph inline so the target is unmistakable. |
| `ios-other` (Chrome, Firefox, Gmail/Slack webviews) | *Adding to the home screen only works from Safari.* + `Copy link` button + tap-through: **⋯ → Open in Safari**, then the three steps above. |
| `android-prompt` (`beforeinstallprompt` captured) | Single `Install` button. No instructions — the OS sheet does the talking. |
| `android-manual` (Firefox, Samsung Internet) | ⋮ menu → **Add to Home screen** → **Add**. |
| `desktop-prompt` | `Install` button, one line: *runs in its own window.* Shown only if the event fired — desktop is never nagged. |
| `desktop-other` | Sheet is not shown. Available from the (i) tooltip, which explains there is nothing to install in this browser. |
| `standalone` | Sheet is never shown. |

## 6. State model

Install state is per **device**; the tour flag is per **user**. Conflating them is the
bug this section exists to prevent: a user who installs on their phone must still be
offered the icon on their iPad, and a user who dismisses on their laptop must not be
nagged on their phone.

**Server (Upstash user record, alongside `tutorialCompletedAt`):**

| Field | Meaning |
|---|---|
| `installEmailSentAt: string \| null` | Welcome email sent; makes the send idempotent and rate-limits resends |
| `firstStandaloneAt: string \| null` | The first time any session for this user reported standalone display mode |

**Device (`localStorage["noise.install"]`, one JSON blob):**

```ts
type InstallDeviceState = {
  dismissals: number;      // times "Not now" / backdrop was used
  lastPromptedAt: string;  // ISO
  acknowledgedAt: string | null; // "I've added it" — defers the tour, claims nothing
};
```

**Decision, as one pure function** (`lib/install.ts`, mirroring how `lib/tutorial.ts`
holds the logic that `lib/use-first-run.ts` merely wires):

```ts
shouldShowInstallSheet({ platform, device, user, now }): boolean
```

| Condition | Result |
|---|---|
| `platform === "standalone"` | never |
| `platform === "desktop-other"` | never |
| `platform === "desktop-prompt"` and this is not first run | never |
| `device.dismissals >= 3` | never again on this device |
| `now < lastPromptedAt + 30 days` | not yet |
| First run for this user (no `tutorialCompletedAt`) | show, before the tour |
| Otherwise | show at most once per 30 days, on app open, after data settles |

## 7. Build plan

Each phase ships on its own and leaves the app coherent — no phase points the user at
something the next phase is supposed to build.

### Phase 0 — Make it installable

- `web/app/manifest.ts` → `name: "Noise Lab"`, `short_name: "Noise Lab"`,
  `id: "/"`, `start_url: "/?source=homescreen"`, `scope: "/"`, `display: "standalone"`,
  `background_color: "#eef0f6"` and `theme_color: "#ffffff"` (matching `globals.css`, not
  invented), `orientation: "portrait"`.
- Icons: 192×192 and 512×512 PNGs plus a 512×512 `purpose: "maskable"` with the bell on
  the brand ground and the safe-zone padding Android crops to. `app/apple-icon.png` (180)
  already covers iOS.
- `app/layout.tsx`: `appleWebApp: { capable: true, statusBarStyle: "default", title: "Noise Lab" }`
  via Next's metadata API. Keep `viewportFit: "cover"` — the safe-area work in
  `globals.css` is what makes standalone mode look right on a notched phone.
- `public/sw.js`: a minimal service worker with a pass-through `fetch` handler, registered
  after first paint. It exists for Chromium's install criteria, **not** for offline. It
  must not cache `/api/audio/*` (masters are hundreds of MB) or any `/api/*` response.
- **Accept:** Lighthouse "Installable" passes; the Chrome menu offers Install; adding from
  iOS Safari yields an icon that opens full-screen with no browser chrome and correct safe
  areas; signed out, `/manifest.webmanifest` and `/sw.js` return 200 (they bypass the
  middleware gate via `shouldBypassAuth`); `npm run build`, `typecheck`, `lint` clean.

### Phase 1 — Platform detection and the sheet

- `lib/install.ts` — pure: `installPlatform(userAgent, displayMode, beforeInstallPromptSeen)`,
  `installSteps(platform)`, `shouldShowInstallSheet(...)`, `installDeviceStateAfter(action, state, now)`.
  iPadOS reports as `Macintosh`; disambiguate with `maxTouchPoints > 1`.
- `lib/use-install.ts` — the hook: reads `matchMedia("(display-mode: standalone)")` and
  `navigator.standalone`, captures `beforeinstallprompt`, persists device state, exposes
  `promptInstall()`.
- `app/ui/install-sheet.tsx` — the sheet, in the `.activity-sheet` language.
- Wire into `noise-lab.tsx` beside the existing first-run launch, plus the (i) tooltip
  entry.
- `POST /api/me/install` stamps `firstStandaloneAt` once.
- **Accept:** new `web/test/install.test.ts` (node:test, pure functions, no DOM) covering
  every row of the §6 table and every platform branch — **and added to the explicit test
  list in `web/package.json`**, which does not glob. Manually: iOS Safari, iOS Chrome,
  Android Chrome, desktop Chrome, and one standalone launch each on iOS and Android.

### Phase 2 — Sign-in codes *(hard dependency of Phase 3 on iOS)*

- `generateVerificationToken()` on the Resend provider returns 8 characters of Crockford
  base32 (no I/L/O/U), displayed `XXXX-XXXX`. ~40 bits, single-use, 15 minutes, and it is
  the same token the link carries.
- Sign-in email gains the code beneath the button.
- `/signin` gains the code field, primary in standalone (§4.3), normalising case and
  dashes before submit.
- Rate limit: 5 failed code attempts per email address invalidates the token; per-IP
  throttle on submit. The allowlist still gates everything (`lib/allowlist.ts`).
- **Accept:** `test/auth.test.ts` grows cases for token shape, normalisation, and attempt
  invalidation. End to end: request a link on a laptop, sign in on a phone with the code,
  and confirm the link is then dead.

### Phase 3 — The email

- Extract the shared email chrome (bell, wordmark, card, button) out of `lib/auth.ts` into
  `lib/email.ts` so two templates cannot drift.
- `lib/install-email.ts` — subject, HTML, and text from §5.1, plus
  `shouldSendInstallEmail(user)`.
- Send from the `createUser` hook; `POST /api/me/install-email` for resends.
- **Accept:** the email renders in Apple Mail (iOS + macOS), Gmail app, and Gmail web
  without a horizontal scrollbar at 320px; the code is selectable text, never an image;
  the plain-text part carries both step lists; a second sign-in sends no second email.

### Phase 4 — Backfill

The team already exists in Upstash with no `installEmailSentAt`. One `scripts/` run sends
the welcome email once to every existing allowlisted user, stamping the field as it goes,
after Phases 0–3 are live in production. Existing users also get the sheet on their next
open, since the §6 rules do not require a first run.

## 8. Design rules

Lifted from `docs/first-run-tour-redesign.md` because the same failures are available here.

- **D4 applies:** the sheet never says "Installed". "I've added it" only dismisses;
  confirmation comes from the app observing `display-mode: standalone` — at which point
  the next standalone launch may say *Now you're running from the home screen* once.
- **D8 applies:** step counts are text.
- **D9 applies:** `Not now` is a real ≥44px target with a real label.
- One sheet, one job. No render status, no queue, no upsell inside it.
- Screenshots of the OS share sheet age badly and localise worse. Use inline SVG glyphs
  and the OS's own words in bold.
- The sheet must never cover the dock during the tour, and must never be on screen at the
  same time as the tour card.

## 9. Instrumentation

Minimum to know whether this worked, using what already exists — no analytics vendor:

- `firstStandaloneAt` per user answers "how many of us actually installed it".
- `installEmailSentAt` answers "did the email go out once".
- `start_url` carries `?source=homescreen`, so a server log line at the root route
  separates home-screen launches from browser launches without cookies or a tracker.

## 10. Out of scope

Named because each will be proposed the moment the manifest lands:

- **Offline.** The service worker is a pass-through. Masters are hundreds of megabytes and
  the Library is a live view of R2; a cache would be stale or enormous. If offline is ever
  wanted, it is its own spec.
- **Push notifications when a render lands.** This is the real payoff of an installed app —
  renders take minutes and the tour already promises "we'll tell you when it lands" — but
  it needs a push service, VAPID keys, permission UX, and worker-side delivery. Follow-up
  spec, and until it exists no copy anywhere may imply it.
- **Passkeys.** They would remove the cross-context session problem outright, but the code
  in Phase 2 is a day of work against a week of one.
- **A native wrapper.** Nothing here needs one.

## 11. Open questions for the owner

1. **Codes.** Phase 2 changes how sign-in works for everyone, not just installers. Confirm
   the code (recommended — without it an installed iOS app cannot be signed into), or
   accept that home-screen install is Android-and-desktop only for now.
2. **Sender.** The welcome email needs a From on the verified `ybellrecords.com` domain.
   Same address as sign-in, or a separate one?
3. **Desktop.** The spec never nags on desktop. If the console is mostly used on laptops,
   say so and the `desktop-prompt` rule can loosen to once per 30 days.
4. **Backfill timing.** Phase 4 emails the existing team. Immediately on ship, or held for
   a moment when a message from the console is expected?
