import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "noise-lab-web-test-"));
const renderDir = path.join(fixtureDir, "renders");
fs.mkdirSync(renderDir);
const configPath = path.join(fixtureDir, "variants.yaml");
const pilotPath = path.join(fixtureDir, "pilot.yaml");
const variant = (id: string, filename: string) => ({
  balance: "balanced",
  band: "mid",
  band_high_hz: 2500,
  band_low_hz: 800,
  cell_seconds: 60,
  color: "white",
  filename,
  gain_bed_db: -6,
  gain_motion_db: -12,
  gain_texture_db: -9,
  lfo_depth: 0.1,
  lfo_rate_hz: 0.02,
  motion: "drift",
  repeats: 4,
  sample_rate: 48000,
  seeds: { bed_l: 12, bed_r: 13, motion_l: 14, motion_r: 15, texture_l: 16, texture_r: 17 },
  spectrum: { tilt_db_per_oct: 0 },
  target_lufs: -20,
  true_peak_max_dbtp: -3,
  variant_id: id,
});
fs.writeFileSync(configPath, JSON.stringify({ output: { cell_seconds: 60, repeats: 4 }, variants: [
  variant("wn_white_mid_drift_balanced", "present.wav"),
  variant("wn_white_mid_drift_texture-forward", "missing.wav"),
] }));
fs.writeFileSync(pilotPath, JSON.stringify({ output: { cell_seconds: 60, repeats: 4 }, variants: [variant("wn_white_mid_drift_balanced", "present.wav")] }));
fs.writeFileSync(path.join(renderDir, "present.wav"), "RIFFfixture");
fs.writeFileSync(path.join(renderDir, "present.json"), JSON.stringify({
  variant_id: "wn_white_mid_drift_balanced",
  cell_seconds: 61.25,
  repeats: 4,
  existing_key: "preserved",
}));
fs.writeFileSync(path.join(renderDir, "qa_results.json"), JSON.stringify({
  summary: { overall_verdict: "PASS" },
  files: [{ filename: "present.wav", checks: [
    { name: "Loudness", measured: "-20.000 LUFS", threshold: "within", passed: true },
    { name: "True peak", measured: "-10.000 dBTP", threshold: "under", passed: true },
  ] }],
}));

process.env.NOISE_VARIANTS_FILE = configPath;
process.env.NOISE_PILOT_VARIANTS_FILE = pilotPath;
process.env.NOISE_RENDER_DIR = renderDir;
process.env.NOISE_QUEUE_FILE = path.join(fixtureDir, "queue.jsonl");

const modulesPromise = Promise.all([
  import("../lib/config"),
  import("../lib/library"),
  import("../lib/naming"),
  import("../lib/range"),
]);

test("resolves matrix indexes, pilot labels, and total durations from config", async () => {
  const [{ loadVariants }] = await modulesPromise;
  const variants = loadVariants();
  assert.equal(variants.length, 2);
  assert.equal(variants[0].matrixIndex, 14);
  assert.equal(variants[0].pilot, "P1");
  assert.equal(variants[0].durationSeconds, 240);
  assert.equal(variants[1].pilot, null);
});

test("assembles rendered and missing library tracks with QA evidence", async () => {
  const [, { libraryTracks }] = await modulesPromise;
  const tracks = await libraryTracks();
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].exists, true);
  assert.equal(tracks[0].durationSeconds, 245);
  assert.equal(tracks[0].measuredLufs, "-20.000 LUFS");
  assert.equal(tracks[0].qaVerdict, "PASS");
  assert.equal(tracks[1].exists, false);
  assert.equal(tracks[1].qaVerdict, "UNAVAILABLE");
  assert.deepEqual(tracks[1].qaChecks, []);
});

test("resolves inclusive byte ranges including suffix ranges", async () => {
  const [, , , { resolveByteRange }] = await modulesPromise;
  assert.deepEqual(resolveByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(resolveByteRange("bytes=-500", 1000), { start: 500, end: 999 });
  assert.deepEqual(resolveByteRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.equal(resolveByteRange("bytes=1000-1001", 1000), null);
});

test("approval preserves existing sidecar keys", async () => {
  const [, , { approveName }] = await modulesPromise;
  approveName("present.wav", "Approved title", "Approved description");
  const sidecar = JSON.parse(fs.readFileSync(path.join(renderDir, "present.json"), "utf8")) as Record<string, unknown>;
  assert.equal(sidecar.existing_key, "preserved");
  assert.equal(sidecar.variant_id, "wn_white_mid_drift_balanced");
  assert.equal(sidecar.seo_title, "Approved title");
  assert.equal(sidecar.seo_title_approved, true);
});

test("local naming candidates are deterministic but regenerable", async () => {
  const [{ loadVariants }, , { localStubProvider }] = await modulesPromise;
  const variant = loadVariants()[0];
  const first = localStubProvider.generate(variant, 0);
  const second = localStubProvider.generate(variant, 1);
  assert.notEqual(first.title, second.title);
  assert.equal(first.title, localStubProvider.generate(variant, 0).title);
});
