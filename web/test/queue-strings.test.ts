import assert from "node:assert/strict";
import { test } from "node:test";
import { queueStrings } from "../lib/queue-strings";

test("all top-level queue strings avoid restricted implementation terms", () => {
  const topLevel = [
    queueStrings.title,
    ...Object.values(queueStrings.sections),
    ...Object.values(queueStrings.status),
    queueStrings.logs,
    queueStrings.library,
    queueStrings.historyCount(1),
    ...Object.values(queueStrings.queueNote),
    queueStrings.failure("Pilot set (8)", "Failed"),
  ].join(" ");
  assert.doesNotMatch(topLevel, /\b(master|workflow|attempt)\b/i);
});

test("queue attempt statuses distinguish pending and failed work", () => {
  assert.equal(queueStrings.attemptStatus("Queued"), "Queued");
  assert.equal(queueStrings.attemptStatus("Rendering"), "Running");
  assert.equal(queueStrings.attemptStatus("Failed"), "✗ Failed");
  assert.equal(queueStrings.attemptStatus("Done"), "✓ Ready");
});
