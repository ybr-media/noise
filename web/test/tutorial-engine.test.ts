import assert from "node:assert/strict";
import { test } from "node:test";
import { tourEventMatches, tutorialSteps } from "../app/ui/tutorial";

test("the tour script is data-driven and branches render copy by mode", () => {
  const local = tutorialSteps("local");
  const dispatch = tutorialSteps("dispatch");
  const unavailable = tutorialSteps("unavailable");
  assert.equal(local.length, 11);
  assert.equal(dispatch.find((step) => step.id === "render")?.kind, "action");
  assert.equal(unavailable.find((step) => step.id === "render-unavailable")?.kind, "info");
  assert.equal(unavailable.find((step) => step.id === "queue-unavailable")?.kind, "info");
});

test("action steps advance only for their declared event and group", () => {
  const color = tutorialSteps("local").find((step) => step.id === "param-color");
  assert(color);
  assert.equal(tourEventMatches(color, { type: "param-selected", group: "color" }), true);
  assert.equal(tourEventMatches(color, { type: "param-selected", group: "shape" }), false);
  assert.equal(tourEventMatches(color, { type: "fx-changed" }), false);
});

test("info steps do not consume handler events", () => {
  const welcome = tutorialSteps("local")[0];
  assert.equal(tourEventMatches(welcome, { type: "param-selected", group: "color" }), false);
});
