import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "noise-lab-remote-test-"));
const configPath = path.join(fixtureDir, "variants.yaml");
const variant = (id: string, filename: string) => ({
  balance: "balanced",
  band: "mid",
  cell_seconds: 60,
  color: "white",
  filename,
  motion: "drift",
  repeats: 4,
  variant_id: id,
});
fs.writeFileSync(configPath, JSON.stringify({ output: { cell_seconds: 60, repeats: 4 }, variants: [
  variant("wn_white_mid_drift_balanced", "published.wav"),
  variant("wn_white_mid_drift_texture-forward", "unpublished.wav"),
] }));

const baseUrl = "https://artifacts.example/noise";
process.env.NOISE_VARIANTS_FILE = configPath;
process.env.NOISE_PILOT_VARIANTS_FILE = configPath;
process.env.NOISE_RENDER_DIR = path.join(fixtureDir, "absent");
process.env.NOISE_ARTIFACTS_BASE_URL = `${baseUrl}/`;
process.env.NOISE_MANIFEST_TTL_MS = "0";

const manifest = {
  artifacts: [
    {
      filename: "published.wav",
      sizeBytes: 55_000_000,
      sidecar: { variant_id: "wn_white_mid_drift_balanced", cell_seconds: 61.25, repeats: 4, seo_title: "Published" },
      qaChecks: [{ name: "Loudness", measured: "-20.000 LUFS", threshold: "within", passed: true }],
      renderStatus: "ok",
    },
  ],
};

const requested: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  requested.push(String(input));
  return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const modulesPromise = Promise.all([import("../lib/artifacts"), import("../lib/library")]);

test("published artifacts come from the manifest rather than the local disk", async () => {
  const [, { libraryTracks }] = await modulesPromise;
  const tracks = await libraryTracks();
  assert.equal(requested[0], `${baseUrl}/manifest.json`);
  assert.equal(tracks[0].exists, true);
  assert.equal(tracks[0].qaVerdict, "PASS");
  assert.equal(tracks[0].title, "Published");
  assert.equal(tracks[0].durationSeconds, 245);
  assert.equal(tracks[0].path, `${baseUrl}/published.wav`);
  assert.equal(tracks[1].exists, false);
  assert.equal(tracks[1].renderStatus, "Not rendered");
});

test("an unreachable manifest leaves the matrix browsable", async () => {
  const [{ artifactIndex }] = await modulesPromise;
  globalThis.fetch = (async () => new Response("missing", { status: 404 })) as typeof fetch;
  const index = await artifactIndex();
  assert.equal(index.artifacts.size, 0);
  assert.equal(index.origin, baseUrl);
});
