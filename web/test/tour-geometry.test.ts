import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RING_OFFSET,
  SPOTLIGHT_PADDING,
  TOOLTIP_CLEARANCE,
  cutoutRadius,
  ringBox,
  ringPath,
  scrimPath,
  spotlightBox,
  tooltipPlacement,
} from "../lib/tour-geometry";

const pill = { top: 500, left: 20, width: 320, height: 48 };

test("the cutout is the target's own box with even padding", () => {
  const cutout = spotlightBox(pill);
  assert.deepEqual(cutout, {
    top: pill.top - SPOTLIGHT_PADDING,
    left: pill.left - SPOTLIGHT_PADDING,
    width: pill.width + SPOTLIGHT_PADDING * 2,
    height: pill.height + SPOTLIGHT_PADDING * 2,
  });
  const ring = ringBox(pill);
  assert.equal(ring.top, cutout.top - RING_OFFSET);
  assert.equal(ring.width, cutout.width + RING_OFFSET * 2);
});

test("corner radius follows the target instead of a default rectangle", () => {
  // A pill stays a pill: half the grown height, never a square corner.
  assert.equal(cutoutRadius(pill, 999), (pill.height + SPOTLIGHT_PADDING * 2) / 2);
  assert.equal(cutoutRadius(pill, pill.height / 2), (pill.height + SPOTLIGHT_PADDING * 2) / 2);
  // A card keeps its own curve, grown by the same padding.
  const card = { top: 100, left: 14, width: 340, height: 220 };
  assert.equal(cutoutRadius(card, 24), 24 + SPOTLIGHT_PADDING);
  // A square-cornered target still gets a rounded cutout.
  assert.equal(cutoutRadius(card, 0), SPOTLIGHT_PADDING);
});

test("scrim and ring are rounded paths, with arcs on every corner", () => {
  const scrim = scrimPath({ width: 390, height: 844 }, spotlightBox(pill), cutoutRadius(pill, 999));
  assert.match(scrim, /^M0,0H390V844H0Z/);
  assert.equal(scrim.match(/A/g)?.length, 4);
  assert.equal(ringPath(pill, 999).match(/A/g)?.length, 4);
});

test("the tooltip always clears the ring by the full gap", () => {
  const top = tooltipPlacement({ top: 90, left: 14, width: 360, height: 60 }, 240, 844);
  assert.equal(top.placement, "bottom");
  assert.ok(top.top >= ringBox({ top: 90, left: 14, width: 360, height: 60 }).top + 60 + 2 * (SPOTLIGHT_PADDING + RING_OFFSET) + TOOLTIP_CLEARANCE - 0.01);
  assert.equal(top.ringVisible, true);

  const low = { top: 700, left: 14, width: 360, height: 60 };
  const above = tooltipPlacement(low, 240, 844);
  assert.equal(above.placement, "top");
  assert.equal(above.top + 240 + TOOLTIP_CLEARANCE, ringBox(low).top);
  assert.equal(above.ringVisible, true);
});

test("a card too tall for either side drops the ring rather than hiding it", () => {
  const placement = tooltipPlacement({ top: 300, left: 14, width: 360, height: 200 }, 600, 700);
  assert.equal(placement.ringVisible, false);
  assert.ok(placement.top >= 0);
});
