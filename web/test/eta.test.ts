import assert from "node:assert/strict";
import { test } from "node:test";
import { batchMissingMastersSummary } from "../lib/eta";
import type { LibraryTrack } from "../lib/types";

const track = (variantId: string, exists: boolean) => ({ variantId, exists } as LibraryTrack);

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
