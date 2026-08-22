import assert from "node:assert/strict";
import { test } from "node:test";
import { queueStrings, renderStatusSummary } from "../lib/queue-strings";

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

test("the header render status reports running work ahead of waiting work", () => {
  assert.equal(renderStatusSummary(0, 0), "Idle");
  assert.equal(renderStatusSummary(0, 1), "Queued");
  assert.equal(renderStatusSummary(0, 3), "Queued · 3 waiting");
  assert.equal(renderStatusSummary(2, 0), "Rendering · 2 running");
  assert.equal(renderStatusSummary(2, 5), "Rendering · 2 running");
  assert.equal(renderStatusSummary(0, 0, true), "Render failed — see activity");
  assert.equal(renderStatusSummary(2, 0, true), "Rendering · 2 running");
});

test("queue attempt statuses distinguish pending and failed work", () => {
  assert.equal(queueStrings.attemptStatus("Queued"), "Queued");
  assert.equal(queueStrings.attemptStatus("Rendering"), "Running");
  assert.equal(queueStrings.attemptStatus("Failed"), "✗ Failed");
  assert.equal(queueStrings.attemptStatus("Done"), "✓ Ready");
});
