import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { QueueJob } from "../lib/types";

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "noise-dismissals-"));
process.env.NOISE_DISMISSALS_FILE = path.join(fixtureDir, "dismissals.jsonl");

const modulePromise = import("../lib/dismissals");

const job = (id: string, status: QueueJob["status"] = "Failed"): QueueJob => ({
  id,
  variantId: `variant-${id}`,
  status,
  queuedAt: "2026-08-12T00:00:00Z",
  error: "Render failed",
});

test("archives dismissed jobs to the local JSONL and lists them newest first", async () => {
  const { archiveDismissal, listDismissals, DISMISSALS_PATH } = await modulePromise;
  assert.deepEqual(await listDismissals(), []);
  await archiveDismissal(job("first"));
  await archiveDismissal(job("second", "Cancelled"));
  const records = await listDismissals();
  assert.deepEqual(records.map((record) => record.job.id), ["second", "first"]);
  assert.ok(records.every((record) => !Number.isNaN(new Date(record.dismissedAt).getTime())));
  const lines = fs.readFileSync(DISMISSALS_PATH, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
});

test("does not archive the same job twice", async () => {
  const { archiveDismissal, listDismissals } = await modulePromise;
  await archiveDismissal(job("first"));
  assert.equal((await listDismissals()).length, 2);
});
