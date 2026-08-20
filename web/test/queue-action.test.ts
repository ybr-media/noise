import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const queuePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "noise-lab-queue-action-test-")), "queue.jsonl");
process.env.NOISE_QUEUE_FILE = queuePath;

test("render-again with no FX keeps the queued job free of FX", async () => {
  const [{ loadVariants }, { submitQueueSelection }] = await Promise.all([
    import("../lib/config"),
    import("../lib/queue-action"),
  ]);
  const variantId = loadVariants()[0].variantId;
  const result = await submitQueueSelection({
    variantIds: [variantId],
    repeats: 4,
    takeMarker: "tnofx",
    fx: null,
  });
  assert.equal(result.status, 202);
  const job = JSON.parse(fs.readFileSync(queuePath, "utf8")) as Record<string, unknown>;
  assert.equal("fx" in job, false);
});
