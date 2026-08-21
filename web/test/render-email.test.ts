import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRenderEmail, renderFxSummary } from "../lib/render-email";
import { signDownloadToken, verifyDownloadToken } from "../lib/download-token";
import { notifyRenderComplete } from "../lib/render-notifications";
import type { LibraryTrack } from "../lib/types";

process.env.NOISE_DOWNLOAD_SECRET = "download-test-secret";

const track = (key: string, title?: string): LibraryTrack => ({
  renderKey: key,
  title,
  variantId: key,
  filename: `${key}_master.wav`,
  matrixIndex: 1,
  color: "white",
  band: "mid",
  motion: "still",
  balance: "balanced",
  bandLowHz: 30,
  bandHighHz: 16000,
  lfoDepth: 0,
  lfoRateHz: 0,
  gainsDb: { bed: 0, motion: 0, texture: 0 },
  seeds: {},
  durationSeconds: 240,
  sampleRate: 96000,
  targetLufs: -20,
  truePeakMaxDbtp: -3,
  pilot: null,
  spectrum: { tiltDbPerOct: 0, bell: null },
  cellSeconds: 60,
  repeats: 4,
  recipe: {
    color: "white", band: "mid", motion: "still", balance: "balanced", bandLowHz: 30, bandHighHz: 16000,
    lfoDepth: 0, lfoRateHz: 0, gainsDb: { bed: 0, motion: 0, texture: 0 }, seeds: {}, tiltDbPerOct: 0, bell: null,
    eq: { preset: "telephone", gains_db: [-18, -14, -8, -2, 2, 2, 0, -4, -10, -16], trim_db: 0 }, reverb: null,
    fxRecorded: true, cellSeconds: 60, repeats: 4, fadeSeconds: null, sampleRate: 96000, bitDepth: 24,
    targetLufs: -20, truePeakMaxDbtp: -3, tailSeconds: null, audacityVersion: null, renderedAt: null,
  },
  path: "", sizeBytes: 243_000_000, audioUrl: "", downloadUrl: "", exists: true, stems: [], qaVerdict: "FAIL",
  qaChecks: [], measuredLufs: "-20.1", measuredTruePeak: null, renderStatus: "ok", renderedAt: "2026-08-21T00:00:00Z",
});

test("render email contains title, facts, FX text, and both links", () => {
  const token = signDownloadToken("track_master.wav", Date.now() + 60_000);
  assert.deepEqual(verifyDownloadToken(token), { filename: "track_master.wav" });
  const email = buildRenderEmail({
    tracks: [track("track", "Telephone track")],
    appUrl: "https://noise.example",
    finishedAt: "2026-08-21T00:00:00Z",
    downloadUrls: { track: `https://noise.example/api/download/${token}` },
  });
  assert.equal(email.subject, "Telephone track is rendered");
  assert.match(email.html, /QA flagged — see checks/);
  assert.match(email.html, /EQ: Telephone/);
  assert.match(email.text, /#library\/track/);
  assert.match(email.text, /api\/download/);
});

test("flat dry render omits the FX row while preserving the flat chip summary", () => {
  const dry = track("dry");
  dry.recipe.eq = null;
  dry.recipe.reverb = null;
  const email = buildRenderEmail({ tracks: [dry], appUrl: "https://noise.example", finishedAt: new Date().toISOString() });
  assert.match(email.html, /Frequency response — EQ: Flat/);
  assert.doesNotMatch(email.html, /<p[^>]*>EQ: Flat<\/p>/);
  assert.doesNotMatch(email.text, /EQ: Flat/);
  assert.equal(renderFxSummary(dry), "EQ: Flat");
});

test("batch render email caps the list and has no per-track download", () => {
  const tracks = Array.from({ length: 8 }, (_, index) => track(`track-${index + 1}`));
  const email = buildRenderEmail({ tracks, appUrl: "https://noise.example", finishedAt: new Date().toISOString() });
  assert.equal(email.subject, "8 tracks are rendered");
  assert.match(email.html, /\+5 more in your Library/);
  assert.doesNotMatch(email.html, /Download master/);
});

test("notification gating skips missing requesters and the global kill switch", async () => {
  const missingRequester = await notifyRenderComplete({
    kind: "render-complete",
    requestedBy: "",
    renderKeys: ["track"],
    finishedAt: new Date().toISOString(),
  });
  assert.equal(missingRequester, "skipped");

  const previous = process.env.NOISE_RENDER_EMAILS;
  process.env.NOISE_RENDER_EMAILS = "0";
  try {
    const disabled = await notifyRenderComplete({
      kind: "render-complete",
      requestedBy: "austin@example.com",
      renderKeys: ["track"],
      finishedAt: new Date().toISOString(),
    });
    assert.equal(disabled, "skipped");
  } finally {
    if (previous === undefined) delete process.env.NOISE_RENDER_EMAILS;
    else process.env.NOISE_RENDER_EMAILS = previous;
  }
});

test("notification gating skips disallowed, opted-out, claimed, and unresolved requests", async () => {
  const previousEnv = {
    ALLOWED_EMAILS: process.env.ALLOWED_EMAILS,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    NOISE_APP_URL: process.env.NOISE_APP_URL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  let user: Record<string, unknown> = { id: "user-1", email: "austin@example.com", renderEmails: false };
  let claimSucceeds = true;
  process.env.ALLOWED_EMAILS = "austin@example.com";
  process.env.AUTH_SECRET = "auth-secret";
  process.env.AUTH_RESEND_KEY = "resend-secret";
  process.env.AUTH_EMAIL_FROM = "Noise Lab <noise@example.com>";
  process.env.NOISE_APP_URL = "https://noise.example";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
  process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("api.resend.com")) return new Response("unexpected resend request", { status: 500 });
    const commands = JSON.parse(String(init?.body)) as string[][];
    const results = commands.map(([command, key]) => {
      if (command === "get" && key.startsWith("user:email:")) return { result: "user-1" };
      if (command === "get" && key === "user:user-1") return { result: JSON.stringify(user) };
      if (command === "set" && key.startsWith("render-notify:")) return { result: claimSucceeds ? "OK" : null };
      return { result: null };
    });
    return new Response(JSON.stringify(results));
  }) as typeof fetch;
  try {
    assert.equal(await notifyRenderComplete({
      kind: "render-complete", requestedBy: "not-allowed@example.com", renderKeys: ["missing"], finishedAt: new Date().toISOString(),
    }), "skipped");

    assert.equal(await notifyRenderComplete({
      kind: "render-complete", requestedBy: "austin@example.com", renderKeys: ["missing"], runId: "opted-out", finishedAt: new Date().toISOString(),
    }), "skipped");

    user = { id: "user-1", email: "austin@example.com", renderEmails: true };
    claimSucceeds = false;
    assert.equal(await notifyRenderComplete({
      kind: "render-complete", requestedBy: "austin@example.com", renderKeys: ["missing"], runId: "claimed", finishedAt: new Date().toISOString(),
    }), "skipped");

    claimSucceeds = true;
    assert.equal(await notifyRenderComplete({
      kind: "render-complete", requestedBy: "austin@example.com", renderKeys: ["missing"], runId: "unresolved", finishedAt: new Date().toISOString(),
    }), "skipped");
    assert.equal(requests.some((url) => url.includes("api.resend.com")), false);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
