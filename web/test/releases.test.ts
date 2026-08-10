import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Release } from "../lib/types";

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "noise-lab-releases-test-"));
const configPath = path.join(fixtureDir, "variants.yaml");
const pilotPath = path.join(fixtureDir, "variants_pilot.yaml");
const variant = (id: string, filename: string, color: string) => ({
  balance: "balanced",
  band: "mid",
  cell_seconds: 60,
  color,
  filename,
  motion: "drift",
  repeats: 4,
  variant_id: id,
});
const whiteRendered = variant("wn_white_mid_drift_balanced", "white-rendered.wav", "white");
const whiteUnrendered = variant("wn_white_mid_drift_texture-forward", "white-unrendered.wav", "white");
const greenRendered = variant("wn_green_mid_drift_balanced", "green-rendered.wav", "green");
const brownUnrendered = variant("wn_brown_mid_drift_balanced", "brown-unrendered.wav", "brown");
fs.writeFileSync(configPath, JSON.stringify({ output: { cell_seconds: 60, repeats: 4 }, variants: [whiteRendered, whiteUnrendered, greenRendered, brownUnrendered] }));
fs.writeFileSync(pilotPath, JSON.stringify({ output: { cell_seconds: 60, repeats: 4 }, variants: [whiteRendered, brownUnrendered] }));

process.env.NOISE_VARIANTS_FILE = configPath;
process.env.NOISE_PILOT_VARIANTS_FILE = pilotPath;
process.env.NOISE_RENDER_DIR = path.join(fixtureDir, "absent");
process.env.NOISE_ARTIFACTS_BASE_URL = "https://artifacts.example/noise";
process.env.NOISE_MANIFEST_TTL_MS = "0";

const manifest = {
  artifacts: [
    { filename: "white-rendered.wav", sizeBytes: 1, sidecar: null, qaChecks: [], renderStatus: "ok" },
    {
      filename: "green-rendered.wav",
      sizeBytes: 1,
      sidecar: null,
      qaChecks: [{ name: "Loudness", measured: "bad", threshold: "within", passed: false }],
      renderStatus: "qa-failed",
    },
  ],
};
globalThis.fetch = (async () => new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } })) as typeof fetch;

const modulesPromise = Promise.all([import("../lib/releases"), import("../lib/release-document")]);

test("suggested presets contain only rendered variants and omit empty colors", async () => {
  const [{ releaseList, releasePayload }] = await modulesPromise;
  const suggestions = (await releaseList()).filter((release) => release.unsaved);
  assert.deepEqual(suggestions.map((release) => release.id), ["pilot-ep", "white-album", "green-album"]);
  assert.deepEqual(suggestions.find((release) => release.id === "pilot-ep")?.tracks.map((track) => track.variantId), [whiteRendered.variant_id]);
  assert.deepEqual(suggestions.find((release) => release.id === "white-album")?.tracks.map((track) => track.variantId), [whiteRendered.variant_id]);
  assert.deepEqual(suggestions.find((release) => release.id === "green-album")?.tracks.map((track) => track.variantId), [greenRendered.variant_id]);
  const green = suggestions.find((release) => release.id === "green-album")!;
  const qaFailed = await releasePayload({
    ...green,
    artist: "Noise Lab",
    songwriter: "Noise Lab",
    releaseDate: "2025-01-01",
    artSeed: 1,
    tracks: [{ ...green.tracks[0], title: "Green Noise" }],
  });
  assert.equal(qaFailed.release.blockingItem, "1 tracks failed QA");
});

test("derived preset and saved releases narrow to valid documents", async () => {
  const [{ releaseList, releasePayload, validateRelease }, { toReleaseDocument }] = await modulesPromise;
  const preset = (await releaseList()).find((release) => release.unsaved);
  assert.ok(preset);
  assert.deepEqual(validateRelease(toReleaseDocument(preset)), toReleaseDocument(preset));

  const savedFixture: Release = {
    id: "saved-ep",
    type: "ep",
    artist: "Noise Lab",
    title: "Saved EP",
    genre: "New Age",
    secondaryGenre: "Ambient",
    releaseDate: "",
    artSeed: null,
    songwriter: "",
    tracks: [
      { variantId: whiteRendered.variant_id, title: "", description: "", approvedAt: null },
      { variantId: brownUnrendered.variant_id, title: "", description: "", approvedAt: null },
    ],
    submitted: { at: null, storeUrl: null },
  };
  const saved = (await releasePayload(savedFixture)).release;
  assert.equal(saved.unsaved, undefined);
  assert.equal(saved.tracks.length, 2);
  assert.deepEqual(validateRelease(toReleaseDocument(saved)), toReleaseDocument(saved));
});
