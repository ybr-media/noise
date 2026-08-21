import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRenderEmail } from "../lib/render-email";
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
