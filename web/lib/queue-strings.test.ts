import assert from "node:assert/strict";
import { test } from "node:test";
import { queueStrings } from "./queue-strings";

test("top-level queue strings avoid restricted implementation terms", () => {
  const topLevel = [
    queueStrings.title,
    ...Object.values(queueStrings.sections),
    ...Object.values(queueStrings.empty),
    queueStrings.library,
    queueStrings.loading,
    queueStrings.idle,
    queueStrings.queued,
    queueStrings.rendering,
    queueStrings.firstRender,
    queueStrings.noRenderer,
    ...Object.values(queueStrings.mode),
  ].join(" ");
  assert.doesNotMatch(topLevel, /\b(master|workflow|attempt)\b/i);
});
