import assert from "node:assert/strict";
import { test } from "node:test";
import { batchMissingMastersSummary, partitionFailedJobs } from "../lib/eta";
import type { LibraryTrack } from "../lib/types";

const job = (id: string, variantId: string, queuedAt: string, status: "Failed" | "Done" = "Failed") => ({
  id, variantId, status, queuedAt,
});
const track = (variantId: string, exists: boolean) => ({ variantId, exists } as LibraryTrack);

test("partitions actionable and superseded failures, including batches", () => {
  const jobs = [
    job("pilot-old", "pilot", "2026-08-09T12:00:00Z"),
    job("pilot-new", "one", "2026-08-09T12:01:00Z", "Done"),
    job("single-old", "one", "2026-08-09T12:00:00Z"),
    job("single-new", "one", "2026-08-09T12:01:00Z", "Done"),
    job("current", "two", "2026-08-09T12:02:00Z"),
  ];
  const partition = partitionFailedJobs(jobs, ["one", "two"], ["one", "two", "three"]);
  assert.deepEqual(partition.superseded.map(({ id }) => id), ["pilot-old", "single-old"]);
  assert.deepEqual(partition.actionable.map(({ id }) => id), ["current"]);
});

test("summarizes missing batch masters and handles library edge cases", () => {
  assert.deepEqual(batchMissingMastersSummary(["one", "two", "three"], [track("one", true), track("two", false), track("three", false)]), {
    total: 3, missingVariantIds: ["two", "three"],
  });
  assert.deepEqual(batchMissingMastersSummary(["one", "two"], [track("one", true), track("two", true)]), {
    total: 2, missingVariantIds: [],
  });
  assert.equal(batchMissingMastersSummary(["one"], []), null);
  assert.equal(batchMissingMastersSummary(undefined, [track("one", false)]), null);
});
