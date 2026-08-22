import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bundleArchiveFilename, bundleNaming } from "../lib/bundle-naming";
import { loadVariants } from "../lib/config";
import { presets } from "../lib/releases";
import type { LibraryTrack } from "../lib/types";

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "noise-lab-bundles-test-"));
const outputDir = path.join(fixtureDir, "out");
fs.mkdirSync(outputDir);
const presetOutputDir = path.join(fixtureDir, "preset-out");
fs.mkdirSync(presetOutputDir);
const configPath = path.join(fixtureDir, "variants.yaml");
fs.writeFileSync(configPath, JSON.stringify({
  output: { cell_seconds: 60, repeats: 4 },
  variants: [{
    balance: "balanced",
    band: "mid",
    color: "white",
    filename: "render-1_master.wav",
    motion: "drift",
    variant_id: "wn_white_mid_drift_balanced",
  }, {
    balance: "texture-forward",
    band: "mid",
    color: "white",
    filename: "render-2_master.wav",
    motion: "drift",
    variant_id: "wn_white_mid_drift_texture-forward",
  }],
}));
fs.writeFileSync(path.join(outputDir, "render-1_master.wav"), "RIFFmaster");
fs.writeFileSync(path.join(outputDir, "render-1_stem_1.wav"), "RIFFstem");
fs.writeFileSync(path.join(outputDir, "render-1_master.json"), JSON.stringify({
  variant_id: "wn_white_mid_drift_balanced",
  role: "master",
  stem_filenames: ["render-1_stem_1.wav"],
  stem_map: { stem_1: "bed" },
}));
fs.writeFileSync(path.join(outputDir, "releases.json"), JSON.stringify({
  releases: [{
    id: "album",
    artist: "Eric",
    title: "Quiet",
    tracks: [{ variantId: "wn_white_mid_drift_balanced", title: "Track One" }],
  }],
}));
process.env.NOISE_VARIANTS_FILE = configPath;
process.env.NOISE_PILOT_VARIANTS_FILE = configPath;

test("builds a named archive and records its byte size", async () => {
  const { buildBundles } = await import("../scripts/build-bundles");
  const bundles = await buildBundles(outputDir);
  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].variantId, "wn_white_mid_drift_balanced");
  assert.equal(bundles[0].renderKey, "render-1");
  assert.match(bundles[0].filename, /^Eric - Quiet \[Masters & Stems\] - render-1\.zip$/);
  assert.equal(bundles[0].sizeBytes, fs.statSync(path.join(outputDir, bundles[0].filename)).size);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir, "bundles.json"), "utf8")), { bundles });
});

test("matches route naming for an unsaved preset with published tracks", async () => {
  fs.writeFileSync(path.join(presetOutputDir, "render-2_master.wav"), "RIFFmaster");
  fs.writeFileSync(path.join(presetOutputDir, "render-2_master.json"), JSON.stringify({
    variant_id: "wn_white_mid_drift_texture-forward",
    role: "master",
  }));
  const variants = loadVariants();
  const localVariant = variants.find((variant) => variant.variantId === "wn_white_mid_drift_texture-forward")!;
  const publishedVariant = variants.find((variant) => variant.variantId === "wn_white_mid_drift_balanced")!;
  const remoteManifest = {
    artifacts: [{
      filename: "render-1_master.wav",
      sizeBytes: 10,
      sidecar: { variant_id: publishedVariant.variantId, role: "master" },
    }],
  };
  process.env.NOISE_ARTIFACTS_BASE_URL = "https://artifacts.example/noise";
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    return new Response(
      url.endsWith("/releases.json") ? JSON.stringify({ releases: [] }) : JSON.stringify(remoteManifest),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const { buildBundles } = await import("../scripts/build-bundles");
  const bundles = await buildBundles(presetOutputDir);
  assert.equal(bundles.length, 1);
  const localTrack = { ...localVariant, renderKey: "render-2", filename: "render-2_master.wav", exists: true } as LibraryTrack;
  const publishedTrack = { ...publishedVariant, renderKey: "render-1", filename: "render-1_master.wav", exists: true } as LibraryTrack;
  const routeReleases = presets([localTrack, publishedTrack]).map((release) => ({ ...release, unsaved: true }));
  const expectedNames = bundleNaming(localTrack, routeReleases);
  assert.equal(bundles[0].filename, bundleArchiveFilename(localTrack, routeReleases));
  assert.ok(fs.readFileSync(path.join(presetOutputDir, bundles[0].filename), "latin1").includes(expectedNames.masterPath));
  assert.match(fs.readFileSync(path.join(presetOutputDir, bundles[0].filename), "latin1"), / - 02 - /);
});
