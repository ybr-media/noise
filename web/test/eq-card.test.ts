import assert from "node:assert/strict";
import { test } from "node:test";
import { eqCardPath, eqCardPoints } from "../lib/eq-card";
import { EQ_MAX_ABS_DB, EQ_PRESET_GAINS, eqResponseDb } from "../lib/fx";

test("EQ card samples the logarithmic frequency range and flat line", () => {
  const points = eqCardPoints([...EQ_PRESET_GAINS.flat], 300, 150);
  assert.equal(points[0].x, 0);
  assert.equal(points[0].y, 75);
  assert.equal(points.at(-1)?.x, 300);
  assert.equal(points.at(-1)?.y, 75);
  assert.match(eqCardPath(points), /^M0\.00,75\.00 L/);

  const gains = EQ_PRESET_GAINS.telephone;
  const mapped = eqCardPoints([...gains], 300, 150);
  assert.ok(Math.abs(mapped[0].y - (75 - (eqResponseDb(gains, 30) / EQ_MAX_ABS_DB) * 60)) < 1e-12);
  assert.ok(Math.abs(mapped.at(-1)!.y - (75 - (eqResponseDb(gains, 16000) / EQ_MAX_ABS_DB) * 60)) < 1e-12);
});
