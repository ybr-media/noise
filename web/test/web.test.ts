import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { absoluteTime, attemptNumber, formatMinutes, hasRepeatedVariant, isSuperseded, knownVariantId, median, queueAheadLabel, queuedJobsAhead, relativeTime, renderEstimate } from "../lib/eta";
import { formatBatchLabel, formatDisplayName, formatVariantLabel } from "../lib/variant-labels";
import { formatBytes } from "../lib/format";
import { bundleNaming } from "../lib/bundle-naming";
import { streamZip, crc32 } from "../lib/zip";
import type { LibraryTrack, Release } from "../lib/types";

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
  color: "green",
  band: "high",
  motion: "breathing",
  balance: "texture-forward",
  seeds: [101, 102, 103, 104, 105, 106],
  band_low_hz: 1200,
  band_high_hz: 8000,
  lfo_depth: 0.25,
  lfo_rate_hz: 0.04,
  per_stem_gains: { bed: -8, texture: -4, motion: -11 },
  target_lufs: -18,
  true_peak_max_dbtp: -2,
  cell_seconds: 61.25,
  repeats: 4,
  fade_seconds: 2,
  sample_rate: 88200,
  bit_depth: 24,
  tilt_db_per_oct: -3,
  bell: { gain_db: 2, center_hz: 1000, q: 1.2 },
  fx: { eq: { preset: "custom", gains_db: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], trim_db: -2 } },
  tail_seconds: 0,
  audacity_version: "3.7.8",
  render_timestamp: "2026-08-09T12:34:56.000Z",
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
  assert.equal(formatVariantLabel(variants[0].variantId, variants), "White · Mid · Drift · Balanced");
  assert.equal(formatVariantLabel("unknown", variants), "unknown");
  assert.equal(formatDisplayName(variants[0]), "White Mid Drift — Balanced");
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
  assert.equal(tracks[0].sizeBytes, 11);
  assert.equal(tracks[0].qaVerdict, "PASS");
  assert.equal(tracks[1].exists, false);
  assert.equal(tracks[1].qaVerdict, "UNAVAILABLE");
  assert.deepEqual(tracks[1].qaChecks, []);
  assert.equal(tracks[1].sizeBytes, 0);
});

test("derives a recipe from the sidecar and preserves unknown legacy fields", async () => {
  const [, { libraryTracks }] = await modulesPromise;
  const [rendered, missing] = await libraryTracks();
  assert.deepEqual(rendered.recipe.seeds, {
    bed_l: 101,
    bed_r: 102,
    texture_l: 103,
    texture_r: 104,
    motion_l: 105,
    motion_r: 106,
  });
  assert.equal(rendered.recipe.color, "green");
  assert.equal(rendered.recipe.bandLowHz, 1200);
  assert.equal(rendered.recipe.gainsDb.texture, -4);
  assert.equal(rendered.recipe.sampleRate, 88200);
  assert.equal(rendered.recipe.bitDepth, 24);
  assert.equal(rendered.recipe.fxRecorded, true);
  assert.equal(rendered.recipe.eq?.preset, "custom");
  assert.equal(rendered.recipe.reverb, null);
  assert.equal(rendered.recipe.audacityVersion, "3.7.8");
  assert.equal(rendered.recipe.renderedAt, "2026-08-09T12:34:56.000Z");
  assert.equal(missing.recipe.fxRecorded, false);
  assert.equal(missing.recipe.tailSeconds, null);
  assert.equal(missing.recipe.audacityVersion, null);
  assert.equal(missing.recipe.fadeSeconds, null);
  assert.equal(missing.recipe.bitDepth, null);
});

test("groups the stems with their master and serves every file as audio", async () => {
  const [, { libraryTracks, audioAsset, bundleAssets }] = await modulesPromise;
  const [master, missing] = await libraryTracks();
  assert.deepEqual(master.stems.map((stem) => [stem.number, stem.stem, stem.exists]), [
    [1, "bed", true],
    [2, "texture", true],
    [3, "motion", false],
  ]);
  assert.deepEqual(master.stems.map((stem) => stem.sizeBytes), [8, 8, 0]);
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
  const bundle = await bundleAssets("wn_white_mid_drift_balanced");
  assert.equal(bundle?.master.filename, "present_master.wav");
  assert.deepEqual(bundle?.stems.map((stem) => stem.filename), ["present_stem_1.wav", "present_stem_2.wav"]);
  assert.equal(await bundleAssets("wn_white_mid_drift_texture-forward"), undefined);
});

const namingTrack = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  variantId: "wn_pink_mid_drift_balanced",
  filename: "present_master.wav",
  matrixIndex: 14,
  color: "pink",
  band: "mid",
  motion: "drift",
  balance: "balanced",
  bandLowHz: 800,
  bandHighHz: 2500,
  lfoDepth: 0.1,
  lfoRateHz: 0.02,
  gainsDb: { bed: -6, motion: -12, texture: -9 },
  seeds: {},
  durationSeconds: 240,
  sampleRate: 48000,
  targetLufs: -20,
  truePeakMaxDbtp: -3,
  pilot: null,
  spectrum: { tiltDbPerOct: 0, bell: null },
  path: "present_master.wav",
  sizeBytes: 1,
  audioUrl: "",
  downloadUrl: "",
  exists: true,
  stems: [{ filename: "present_stem_1.wav", sizeBytes: 1, number: 1, stem: "bed", audioUrl: "", downloadUrl: "", exists: true }],
  qaVerdict: "PASS",
  qaChecks: [],
  measuredLufs: null,
  measuredTruePeak: null,
  renderStatus: "Done",
  renderedAt: null,
  recipe: {
    color: "pink",
    band: "mid",
    motion: "drift",
    balance: "balanced",
    bandLowHz: 800,
    bandHighHz: 2500,
    lfoDepth: 0.1,
    lfoRateHz: 0.02,
    gainsDb: { bed: -6, motion: -12, texture: -9 },
    seeds: {},
    tiltDbPerOct: 0,
    bell: null,
    eq: null,
    reverb: null,
    fxRecorded: false,
    cellSeconds: 60,
    repeats: 4,
    fadeSeconds: null,
    sampleRate: 48000,
    bitDepth: null,
    targetLufs: -20,
    truePeakMaxDbtp: -3,
    tailSeconds: null,
    audacityVersion: null,
    renderedAt: null,
  },
  title: "SEO Title",
  titleApproved: true,
  ...overrides,
});

const namingRelease = (overrides: Partial<Release> = {}): Release => ({
  id: "saved-album",
  type: "album",
  artist: "Eric",
  title: "Quiet Album",
  genre: "Ambient",
  secondaryGenre: "New Age",
  releaseDate: "",
  artSeed: null,
  songwriter: "",
  tracks: [{ variantId: "wn_pink_mid_drift_balanced", title: "Track One", description: "", approvedAt: null }],
  submitted: { at: null, storeUrl: null },
  ...overrides,
});

test("names a saved-release bundle and its master and stem paths", () => {
  const track = namingTrack();
  const names = bundleNaming(track, [namingRelease()]);
  assert.equal(names.zipFilename, "Eric - Quiet Album [Masters & Stems].zip");
  assert.equal(names.masterPath, "Eric - Quiet Album [Masters]/Eric - Quiet Album - 01 - Track One (Pink Noise) [Master].wav");
  assert.equal(names.stemsPath(track.stems[0]), "Eric - Quiet Album [Stems]/Eric - Quiet Album - 01 - Track One (Pink Noise) [Stems]/Stem 1.wav");
});

test("falls back to a preset release and the approved SEO title", () => {
  const track = namingTrack({ title: "SEO Title", titleApproved: true });
  const preset = namingRelease({ id: "pink-album", artist: "chamberecho", title: "Pink Noise", tracks: [{ variantId: track.variantId, title: "", description: "", approvedAt: null }] });
  const names = bundleNaming(track, [preset]);
  assert.equal(names.zipFilename, "chamberecho - Pink Noise [Masters & Stems].zip");
  assert.match(names.masterPath, /- 01 - SEO Title \(Pink Noise\) \[Master\]\.wav$/);
});

test("falls back from missing release title to the variant id and sanitizes names", () => {
  const track = namingTrack({ title: "Ignored", titleApproved: false });
  const release = namingRelease({ artist: "Eric / Test", title: "Album: One", tracks: [{ variantId: track.variantId, title: "Rain / Fire: Night", description: "", approvedAt: null }] });
  const names = bundleNaming(track, [release]);
  assert.equal(names.masterPath, "Eric Test - Album One [Masters]/Eric Test - Album One - 01 - Rain Fire Night (Pink Noise) [Master].wav");
  const missing = bundleNaming(track, [namingRelease({ tracks: [{ variantId: track.variantId, title: "", description: "", approvedAt: null }] })]);
  assert.match(missing.masterPath, /- 01 - wn_pink_mid_drift_balanced \(Pink Noise\) \[Master\]\.wav$/);
});

test("formats artifact sizes with decimal units", () => {
  assert.equal(formatBytes(999), "999 B");
  assert.equal(formatBytes(1_000_000), "1.0 MB");
  assert.equal(formatBytes(40_200_000), "40.2 MB");
  assert.equal(formatBytes(1_000_000_000), "1.0 GB");
});

test("writes streamed stored ZIP entries with CRCs and expected sizes", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const expectedDate = new Date("2026-08-09T12:34:56Z");
  const stream = streamZip([
    { name: "máster.wav", date: expectedDate, data: (async function* () { yield new TextEncoder().encode("RIFF"); })() },
    { name: "stem_1.wav", date: new Date("1979-11-30T01:02:04Z"), data: (async function* () { yield new TextEncoder().encode("stem"); })() },
  ]);
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let writeOffset = 0;
  for (const chunk of chunks) { bytes.set(chunk, writeOffset); writeOffset += chunk.length; }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: string[] = [];
  const sizes: number[] = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    let descriptor = dataStart;
    while (view.getUint32(descriptor, true) !== 0x08074b50) descriptor += 1;
    const size = descriptor - dataStart;
    names.push(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength)));
    sizes.push(size);
    offset = descriptor + 16;
  }
  assert.deepEqual(names, ["máster.wav", "stem_1.wav"]);
  assert.deepEqual(sizes, [4, 4]);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint16(offset + 4, true), 0x0314);
  assert.equal(view.getUint16(offset + 6, true), 20);
  assert.equal(view.getUint16(offset + 8, true), 0x808);
  assert.equal(view.getUint16(offset + 10, true), 0);
  const dosTime = (date: Date) => (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = (date: Date, year = date.getFullYear()) => ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  assert.equal(view.getUint16(10, true), dosTime(expectedDate));
  assert.equal(view.getUint16(12, true), dosDate(expectedDate));
  const centralOffset = offset;
  assert.equal(view.getUint16(centralOffset + 12, true), dosTime(expectedDate));
  assert.equal(view.getUint16(centralOffset + 14, true), dosDate(expectedDate));
  const secondCentralOffset = centralOffset + 46 + view.getUint16(centralOffset + 28, true);
  const clampedDate = new Date("1979-11-30T01:02:04Z");
  assert.equal(view.getUint16(secondCentralOffset + 12, true), dosTime(clampedDate));
  assert.equal(view.getUint16(secondCentralOffset + 14, true), dosDate(clampedDate, 1980));
  assert.equal(view.getUint16(6, true) & 0x800, 0x800);
  assert.equal(view.getUint16(centralOffset + 8, true) & 0x800, 0x800);
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
