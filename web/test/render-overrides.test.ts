import assert from "node:assert/strict";
import { test } from "node:test";
import { repeatsForMinutes, rerenderOptionLabel } from "../lib/render-overrides";

test("rerender minutes map to repeats using the configured cell length", () => {
  assert.equal(repeatsForMinutes(4, 61.25), 4);
  assert.equal(rerenderOptionLabel(4, 61.25), "4 minutes (4:05)");
});
