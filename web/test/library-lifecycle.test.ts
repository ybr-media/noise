import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingTakes } from "../lib/library-lifecycle";
import type { LibraryTrack, QueueJob, Variant } from "../lib/types";

const job = (id: string, variantId: string, queuedAt: string, status: QueueJob["status"], extra: Partial<QueueJob> = {}): QueueJob => ({
  id, variantId, queuedAt, status, ...extra,
});

const variant = (variantId: string, matrixIndex: number, pilot: string | null = null) => ({
  variantId, matrixIndex, pilot,
} as unknown as Variant);

const track = (variantId: string, exists = true) => ({
  variantId, renderKey: `${variantId}-key`, exists,
} as unknown as LibraryTrack);

const variants = [variant("v1", 1, "pilot-a"), variant("v2", 2), variant("v3", 3)];

test("in-flight takes surface in the Library before any file exists", () => {
  const jobs = [
    job("a", "v1", "2026-08-09T12:00:00Z", "Queued"),
    job("b", "v2", "2026-08-09T12:05:00Z", "Rendering"),
  ];
  const takes = pendingTakes(jobs, variants, []);
  assert.deepEqual(takes.map((take) => take.variantId), ["v2", "v1"]);
  assert.deepEqual(takes.map((take) => take.status), ["Rendering", "Queued"]);
});

test("a failed take stays visible so it is not silently lost", () => {
  const takes = pendingTakes([job("a", "v1", "2026-08-09T12:00:00Z", "Failed")], variants, []);
  assert.deepEqual(takes.map((take) => take.status), ["Failed"]);
});

test("a failure for a variant that already has a master stays out of the Library", () => {
  const jobs = [job("a", "v1", "2026-08-09T12:00:00Z", "Failed")];
  assert.deepEqual(pendingTakes(jobs, variants, [track("v1")]), []);
  assert.equal(pendingTakes(jobs, variants, [track("v1", false)]).length, 1);
});

test("a re-render of an existing master still shows as an in-flight take", () => {
  const jobs = [job("a", "v1", "2026-08-09T12:00:00Z", "Rendering", { takeMarker: "t2" })];
  assert.equal(pendingTakes(jobs, variants, [track("v1")]).length, 1);
});

test("batch jobs stay out of the Library because one job is not one row", () => {
  const jobs = [
    job("a", "pilot", "2026-08-09T12:00:00Z", "Rendering"),
    job("b", "full", "2026-08-09T12:01:00Z", "Queued"),
    job("c", "v3", "2026-08-09T12:02:00Z", "Queued"),
  ];
  assert.deepEqual(pendingTakes(jobs, variants, []).map((take) => take.variantId), ["v3"]);
});

test("retries of one take collapse into a single row carrying the attempt count", () => {
  const jobs = [
    job("first", "v2", "2026-08-09T12:00:00Z", "Failed", { takeMarker: "t1" }),
    job("second", "v2", "2026-08-09T12:04:00Z", "Rendering", { takeMarker: "t1" }),
  ];
  const takes = pendingTakes(jobs, variants, []);
  assert.equal(takes.length, 1);
  assert.equal(takes[0].status, "Rendering");
  assert.equal(takes[0].attempts, 2);
});

test("distinct takes of one variant keep their own rows", () => {
  const jobs = [
    job("a", "v2", "2026-08-09T12:00:00Z", "Queued", { takeMarker: "t1" }),
    job("b", "v2", "2026-08-09T12:01:00Z", "Queued", { takeMarker: "t2" }),
  ];
  assert.equal(pendingTakes(jobs, variants, []).length, 2);
});

test("a superseded failure is history, not a pending take", () => {
  const jobs = [
    job("old", "v2", "2026-08-09T12:00:00Z", "Failed"),
    job("new", "v2", "2026-08-09T12:05:00Z", "Done"),
  ];
  assert.deepEqual(pendingTakes(jobs, variants, []), []);
});
