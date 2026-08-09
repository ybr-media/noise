import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { absoluteTime, attemptNumber, formatMinutes, hasRepeatedVariant, isSuperseded, knownVariantId, median, queueAheadLabel, queuedJobsAhead, relativeTime, renderEstimate } from "../lib/eta";
import { formatBatchLabel, formatVariantLabel } from "../lib/variant-labels";

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
  variant("wn_white_mid_drift_balanced", "present_master.wav"),
  variant("wn_white_mid_drift_texture-forward", "missing_master.wav"),
] }));
fs.writeFileSync(pilotPath, JSON.stringify({ output: { cell_seconds: 60, repeats: 4 }, variants: [variant("wn_white_mid_drift_balanced", "present_master.wav")] }));
const stemFilenames = ["present_stem_1.wav", "present_stem_2.wav", "present_stem_3.wav"];
fs.writeFileSync(path.join(renderDir, "present_master.wav"), "RIFFfixture");
// The third stem is absent on purpose: a half-published group must still render.
for (const filename of stemFilenames.slice(0, 2)) {
  fs.writeFileSync(path.join(renderDir, filename), "RIFFstem");
}
fs.writeFileSync(path.join(renderDir, "present_master.json"), JSON.stringify({
  variant_id: "wn_white_mid_drift_balanced",
  cell_seconds: 61.25,
  repeats: 4,
  existing_key: "preserved",
  role: "master",
  stem: null,
  stem_filenames: stemFilenames,
  stem_map: { stem_1: "bed", stem_2: "texture", stem_3: "motion" },
}));
fs.writeFileSync(path.join(renderDir, "present_stem_1.json"), JSON.stringify({
  variant_id: "wn_white_mid_drift_balanced",
  role: "stem_1",
  stem: "bed",
  stem_filenames: stemFilenames,
}));
fs.writeFileSync(path.join(renderDir, "qa_results.json"), JSON.stringify({
  summary: { overall_verdict: "PASS" },
  files: [{ filename: "present_master.wav", checks: [
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

test("formats queue estimates and relative times", () => {
  assert.equal(median([10, 3, 7]), 7);
  assert.equal(median([10, 2]), 6);
  assert.equal(median([]), null);
  assert.equal(formatMinutes(1), "~1 min");
  assert.equal(renderEstimate(null, 0), "First render — typically 5–10 min");
  assert.equal(renderEstimate(180, 1, 200), "~1 min");
  assert.equal(`${renderEstimate(180, 1, 0)} left`, "~3 min left");
  assert.equal(`Typically ${renderEstimate(180, 1)} once started`, "Typically ~3 min once started");
  assert.equal(`${renderEstimate(180, 1, 0)} remaining`, "~3 min remaining");
  assert.equal(relativeTime(new Date(Date.now() - 4 * 60 * 1000).toISOString()), "4m ago");
  assert.equal(absoluteTime("2026-08-09T12:34:56.000Z"), "2026-08-09 12:34:56 UTC");
  assert.equal(absoluteTime("2026-08-09T12:34:56.123Z"), "2026-08-09 12:34:56 UTC");
});

test("formats known variants and batch fallbacks for queue rows", async () => {
  const [{ loadVariants }] = await modulesPromise;
  const variants = loadVariants();
  assert.equal(formatVariantLabel(variants[0].variantId, variants), "White · Mid · Drift · Even");
  assert.equal(formatVariantLabel("unknown", variants), "unknown");
  assert.equal(formatBatchLabel("pilot", { pilot: 8, full: 144 }), "Pilot set (8)");
  assert.equal(formatBatchLabel("full", { pilot: 8, full: 144 }), "Full matrix (144)");
  assert.equal(formatBatchLabel("unknown", { pilot: 8, full: 144 }), "unknown");
});

test("numbers repeated queue attempts and detects superseded failures", () => {
  const jobs = [
    { id: "new", variantId: "same", status: "Failed" as const, queuedAt: "2026-08-09T12:02:00Z" },
    { id: "old", variantId: "same", status: "Failed" as const, queuedAt: "2026-08-09T12:00:00Z" },
    { id: "other", variantId: "other", status: "Failed" as const, queuedAt: "2026-08-09T12:01:00Z" },
  ];
  assert.equal(attemptNumber(jobs[1], jobs), 1);
  assert.equal(attemptNumber(jobs[0], jobs), 2);
  assert.equal(hasRepeatedVariant(jobs[1], jobs), true);
  assert.equal(hasRepeatedVariant(jobs[2], jobs), false);
  assert.equal(isSuperseded(jobs[1], jobs), true);
  assert.equal(isSuperseded(jobs[0], jobs), false);
});

test("supersedes a batch only after every member has a newer job", () => {
  const members = ["pilot-a", "pilot-b"];
  const batch = { id: "batch", variantId: "pilot", status: "Failed" as const, queuedAt: "2026-08-09T12:00:00Z" };
  const newerA = { id: "new-a", variantId: "pilot-a", status: "Failed" as const, queuedAt: "2026-08-09T12:01:00Z" };
  const newerB = { id: "new-b", variantId: "pilot-b", status: "Done" as const, queuedAt: "2026-08-09T12:02:00Z" };
  assert.equal(isSuperseded(batch, [batch, newerA, newerB], members), true);
  assert.equal(isSuperseded(batch, [batch, newerA], members), false);
});

test("only exact known variants can become library anchors", async () => {
  const [{ loadVariants }] = await modulesPromise;
  const variants = loadVariants();
  assert.equal(knownVariantId(variants[0].variantId, variants), variants[0].variantId);
  assert.equal(knownVariantId("pilot", variants), null);
  assert.equal(knownVariantId(`${variants[0].variantId},${variants[1].variantId}`, variants), null);
});

test("counts local queue positions in worker order", () => {
  const jobs = [
    { id: "newest", variantId: "a", status: "Queued" as const, queuedAt: "2026-08-09T12:02:00Z" },
    { id: "middle", variantId: "b", status: "Queued" as const, queuedAt: "2026-08-09T12:01:00Z" },
    { id: "oldest", variantId: "c", status: "Queued" as const, queuedAt: "2026-08-09T12:00:00Z" },
  ];
  assert.equal(queuedJobsAhead("oldest", jobs), 0);
  assert.equal(queuedJobsAhead("middle", jobs), 1);
  assert.equal(queuedJobsAhead("newest", jobs), 2);
  assert.equal(queueAheadLabel(1), "1 job ahead");
  assert.equal(queueAheadLabel(2), "2 jobs ahead");
});

test("resolves matrix indexes, pilot labels, and total durations from config", async () => {
  const [{ loadVariants }] = await modulesPromise;
  const variants = loadVariants();
  assert.equal(variants.length, 2);
  assert.equal(variants[0].matrixIndex, 14);
  assert.equal(variants[0].pilot, "P1");
  assert.equal(variants[0].durationSeconds, 240);
  assert.equal(variants[1].pilot, null);
});

test("resolves render selections to ids and a workflow input", async () => {
  const [{ resolveSelection }] = await modulesPromise;
  assert.deepEqual(resolveSelection({ full: true }), {
    variantIds: ["wn_white_mid_drift_balanced", "wn_white_mid_drift_texture-forward"],
    dispatchInput: "full",
  });
  assert.deepEqual(resolveSelection({ pilot: true }), {
    variantIds: ["wn_white_mid_drift_balanced"],
    dispatchInput: "pilot",
  });
  assert.deepEqual(resolveSelection({ variantIds: ["wn_white_mid_drift_balanced", 7] }), {
    variantIds: ["wn_white_mid_drift_balanced"],
    dispatchInput: "wn_white_mid_drift_balanced",
  });
  assert.deepEqual(resolveSelection({}), { variantIds: [], dispatchInput: "" });
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

test("groups the stems with their master and serves every file as audio", async () => {
  const [, { libraryTracks, audioAsset }] = await modulesPromise;
  const [master, missing] = await libraryTracks();
  assert.deepEqual(master.stems.map((stem) => [stem.number, stem.stem, stem.exists]), [
    [1, "bed", true],
    [2, "texture", true],
    [3, "motion", false],
  ]);
  assert.equal(master.stems[0].audioUrl, "/api/audio/present_stem_1.wav");
  assert.equal(master.stems[0].downloadUrl, "/api/audio/present_stem_1.wav?download=1");
  // A variant that was never rendered has no stems to offer.
  assert.deepEqual(missing.stems, []);
  assert.deepEqual(await audioAsset("present_master.wav"), {
    filename: "present_master.wav",
    exists: true,
    isMaster: true,
  });
  assert.deepEqual(await audioAsset("present_stem_2.wav"), {
    filename: "present_stem_2.wav",
    exists: true,
    isMaster: false,
  });
  assert.deepEqual(await audioAsset("present_stem_3.wav"), {
    filename: "present_stem_3.wav",
    exists: false,
    isMaster: false,
  });
  assert.equal(await audioAsset("not_a_render.wav"), undefined);
});

test("only a master can be named", async () => {
  const [, , { approveName }] = await modulesPromise;
  assert.throws(() => approveName("present_stem_1.wav", "Title", "Description"), /master/);
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
  approveName("present_master.wav", "Approved title", "Approved description");
  const sidecar = JSON.parse(fs.readFileSync(path.join(renderDir, "present_master.json"), "utf8")) as Record<string, unknown>;
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
