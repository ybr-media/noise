import assert from "node:assert/strict";
import { test } from "node:test";
import { queueStrings } from "../lib/queue-strings";

test("all top-level queue strings avoid restricted implementation terms", () => {
  const sampleJobName = "Pilot set (8)";
  const topLevel = [
    queueStrings.title,
    ...Object.values(queueStrings.mode),
    ...Object.values(queueStrings.sections),
    ...Object.values(queueStrings.empty),
    ...Object.values(queueStrings.status),
    ...Object.values(queueStrings.retry),
    ...Object.values(queueStrings.dismiss),
    queueStrings.start.pilot(8),
    queueStrings.start.full(144),
    queueStrings.start.pilotCaption(8),
    queueStrings.start.fullCaption(144),
    queueStrings.start.pilotTitle(8),
    queueStrings.start.fullTitle(144),
    queueStrings.start.confirm(144),
    queueStrings.start.confirmCaption(144),
    queueStrings.logs,
    queueStrings.library,
    queueStrings.loading,
    queueStrings.idle,
    queueStrings.rendering,
    queueStrings.refresh,
    queueStrings.left("5 min"),
    queueStrings.typically("5 min"),
    queueStrings.renderingCount(1),
    queueStrings.queuedCount(2),
    queueStrings.remaining("5 min"),
    queueStrings.historyCount(1),
    queueStrings.clearAll,
    queueStrings.noRenderer,
    ...Object.values(queueStrings.queueNote),
    queueStrings.fullRetry(sampleJobName),
    queueStrings.retryLabel(sampleJobName),
    queueStrings.alreadyRetried(sampleJobName),
    queueStrings.cancelRetry(sampleJobName),
    queueStrings.dismissLabel(sampleJobName),
    queueStrings.statusLabel("Done"),
    queueStrings.statusLabel("Rendering"),
    queueStrings.missingVariants,
    queueStrings.failure(sampleJobName, "Failed", 7, 8),
    queueStrings.failure(sampleJobName, "Cancelled", null, null),
  ].join(" ");
  assert.doesNotMatch(topLevel, /\b(master|workflow|attempt)\b/i);
});
