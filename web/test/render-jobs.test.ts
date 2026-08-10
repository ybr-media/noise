import assert from "node:assert/strict";
import { test } from "node:test";
import { groupCompletedByDay, groupJobs, partitionRenderJobs } from "../lib/render-jobs";
import type { QueueJob } from "../lib/types";

const job = (id: string, variantId: string, queuedAt: string, status: QueueJob["status"], extra: Partial<QueueJob> = {}): QueueJob => ({
  id, variantId, queuedAt, status, ...extra,
});

test("groups all attempts for a variant newest first", () => {
  const jobs = Array.from({ length: 6 }, (_, index) => job(`pilot-${index}`, "pilot", `2026-08-09T12:0${index}:00Z`, "Failed"));
  const grouped = groupJobs(jobs);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].attempts.length, 6);
  assert.equal(grouped[0].latest.id, "pilot-5");
});

test("partitions grouped failures and keeps superseded jobs in history", () => {
  const jobs = [
    job("pilot-failed", "pilot", "2026-08-09T12:00:00Z", "Failed"),
    job("pilot-a", "a", "2026-08-09T12:01:00Z", "Done"),
    job("pilot-b", "b", "2026-08-09T12:02:00Z", "Done"),
    job("cancelled", "c", "2026-08-09T12:03:00Z", "Cancelled"),
    job("active", "d", "2026-08-09T12:04:00Z", "Rendering"),
  ];
  const partition = partitionRenderJobs(jobs, ["a", "b"], []);
  assert.deepEqual(partition.needsAttention.map((item) => item.variantId), ["c"]);
  assert.deepEqual(partition.history.map((item) => item.variantId), ["pilot"]);
  assert.deepEqual(partition.active.map((item) => item.variantId), ["d"]);
  assert.equal(partition.completed.length, 2);
});

test("groups completed jobs by local calendar day without contradictory labels", () => {
  const now = new Date(2026, 7, 10, 15, 30);
  const jobs = [
    job("today", "today", "2026-08-09T23:00:00Z", "Done", { finishedAt: "2026-08-10T09:00:00Z" }),
    job("yesterday", "yesterday", "2026-08-09T01:00:00Z", "Done", { finishedAt: "2026-08-09T23:59:00Z" }),
    job("week", "week", "2026-08-06T01:00:00Z", "Done", { finishedAt: "2026-08-06T09:00:00Z" }),
    job("earlier", "earlier", "2026-08-01T01:00:00Z", "Done", { finishedAt: "2026-08-01T09:00:00Z" }),
  ];
  const buckets = groupCompletedByDay(groupJobs(jobs), now);
  assert.deepEqual(buckets.map((bucket) => bucket.label), ["Today", "Yesterday", "This week", "Earlier"]);
  assert.deepEqual(buckets.map((bucket) => bucket.jobs.map((item) => item.variantId)), [["today"], ["yesterday"], ["week"], ["earlier"]]);
});
