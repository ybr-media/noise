import assert from "node:assert/strict";
import { test } from "node:test";
import { eqCardPath, eqCardPoints } from "../lib/eq-card";
import { EQ_PRESET_GAINS } from "../lib/fx";

test("EQ card samples the logarithmic frequency range and flat line", () => {
  const points = eqCardPoints([...EQ_PRESET_GAINS.flat], 300, 150);
  assert.equal(points[0].x, 0);
  assert.equal(points[0].y, 75);
  assert.equal(points.at(-1)?.x, 300);
  assert.equal(points.at(-1)?.y, 75);
  assert.match(eqCardPath(points), /^M0\.00,75\.00 L/);
});
