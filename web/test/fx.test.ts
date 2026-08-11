import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EQ_PRESET_GAINS,
  REVERB_PRESET_PARAMS,
  defaultFx,
  eqIsFlat,
  eqResponseDb,
  fxBadges,
  formatTail,
  reverbTailSeconds,
  reverbPresetState,
  sanitizeFxBlock,
  toFxBlock,
  wetGainDb,
} from "../lib/fx";

test("default FX serialises to nothing", () => {
  assert.equal(toFxBlock(defaultFx()), null);
});

test("preset state serialises to the snake_case block the renderer reads", () => {
  const fx = defaultFx();
  fx.eq = { preset: "warm-bed", gainsDb: [...EQ_PRESET_GAINS["warm-bed"]], trimDb: 0 };
  fx.reverb = reverbPresetState("cathedral");
  const block = toFxBlock(fx);
  assert.deepEqual(block?.eq, { preset: "warm-bed", gains_db: [0, 1, 2, 2, 1, 0, -1, -3, -6, -9], trim_db: 0 });
  assert.deepEqual(block?.reverb, {
    preset: "cathedral",
    room_size: 95,
    pre_delay_ms: 35,
    reverberance: 90,
    damping: 25,
    mix_percent: 45,
  });
});

test("sanitize round-trips a valid block and rejects malformed sections", () => {
  const fx = defaultFx();
  fx.eq = { preset: "airy", gainsDb: [...EQ_PRESET_GAINS.airy], trimDb: -3 };
  fx.reverb = reverbPresetState("small-room");
  const block = toFxBlock(fx);
  assert.deepEqual(sanitizeFxBlock(JSON.parse(JSON.stringify(block))), block);
  assert.equal(sanitizeFxBlock(null), null);
  assert.equal(sanitizeFxBlock("cathedral"), null);
  assert.equal(sanitizeFxBlock({ eq: { gains_db: [0, 0, 0], trim_db: 0 } }), null);
  assert.equal(sanitizeFxBlock({ reverb: { room_size: 200, pre_delay_ms: 0, reverberance: 0, damping: 0, mix_percent: 50 } }), null);
});

test("queue badges name the presets compactly", () => {
  const fx = defaultFx();
  fx.eq = { preset: "warm-bed", gainsDb: [...EQ_PRESET_GAINS["warm-bed"]], trimDb: 0 };
  fx.reverb = reverbPresetState("cathedral");
  assert.deepEqual(fxBadges(toFxBlock(fx)), ["EQ: Warm Bed", "FX: Cathedral"]);
  assert.deepEqual(fxBadges(null), []);
});

test("the cathedral tail is longer than the small room tail and capped", () => {
  const small = reverbTailSeconds(reverbPresetState("small-room"));
  const cathedral = reverbTailSeconds(reverbPresetState("cathedral"));
  assert.ok(small > 0);
  assert.ok(cathedral > small);
  assert.ok(cathedral <= 8);
  assert.equal(reverbTailSeconds(reverbPresetState("off")), 0);
});

test("tail formatting shows nominal plus tail", () => {
  assert.equal(formatTail(180, 0), "3:00");
  assert.equal(formatTail(180, 6.2), "3:00 + 0:06 tail");
});

test("wet gain follows the mix and never exceeds unity", () => {
  assert.equal(wetGainDb(100), 0);
  assert.ok(wetGainDb(REVERB_PRESET_PARAMS.cathedral.mixPercent) < 0);
  assert.equal(wetGainDb(0.5), -20);
});

test("a flat EQ has a zero response", () => {
  for (const hz of [31, 500, 16000]) {
    assert.equal(eqResponseDb([...EQ_PRESET_GAINS.flat], hz), 0);
  }
  assert.ok(eqIsFlat(defaultFx().eq));
});

test("midnight rolls the top end off far harder than the low end", () => {
  const gains = [...EQ_PRESET_GAINS.midnight];
  assert.ok(eqResponseDb(gains, 16000) < -8);
  assert.ok(Math.abs(eqResponseDb(gains, 40)) < 2);
});
