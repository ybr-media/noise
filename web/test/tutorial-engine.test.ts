import assert from "node:assert/strict";
import { test } from "node:test";
import { finaleCopy, shouldFireRenderBanner, shouldPersistTutorial, tourEventMatches, tutorialSteps } from "../app/ui/tutorial";

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

test("replays never persist while first runs persist when authenticated", () => {
  assert.equal(shouldPersistTutorial(true, false), true);
  assert.equal(shouldPersistTutorial(true, true), false);
  assert.equal(shouldPersistTutorial(false, false), false);
});

test("finale uses the user's actual tutorial state", () => {
  const copy = finaleCopy({ params: "Green · Broad · Drift", renderLabel: "render #12", played: true });
  assert.match(copy, /Green · Broad · Drift/);
  assert.match(copy, /render #12/);
  assert.match(copy, /played your first master/);
});

test("render banner fires exactly once when the tracked job is done", () => {
  assert.equal(shouldFireRenderBanner(false, "Queued"), false);
  assert.equal(shouldFireRenderBanner(false, "Done"), true);
  assert.equal(shouldFireRenderBanner(true, "Done"), false);
});
