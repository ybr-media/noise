import assert from "node:assert/strict";
import { test } from "node:test";
import demoSidecar from "../demo/demo_first_render.json";
import { isDemoSidecar, shouldShowDemoTrack } from "../lib/demo";
import { finaleCopy, shouldFireRenderBanner, shouldPersistTutorial, tourEventMatches, tutorialSteps } from "../app/ui/tutorial";

test("the tour script is data-driven and branches render copy by mode", () => {
  const local = tutorialSteps("local");
  const dispatch = tutorialSteps("dispatch");
  const unavailable = tutorialSteps("unavailable");
  assert.equal(local.length, 9);
  assert.equal(dispatch.find((step) => step.id === "render")?.kind, "action");
  assert.equal(unavailable.find((step) => step.id === "render-unavailable")?.kind, "info");
  assert.equal(unavailable.find((step) => step.id === "queue-unavailable")?.kind, "info");
  assert.equal(local.find((step) => step.id === "param-color")?.target, "design-color");
  assert.equal(local.find((step) => step.id === "param-shape")?.target, "design-shape");
  assert.equal(local.find((step) => step.id === "library-play")?.eventSequence?.length, 2);
});

test("action steps advance only for their declared event and group", () => {
  const color = tutorialSteps("local").find((step) => step.id === "param-color");
  assert(color);
  assert.equal(tourEventMatches(color, { type: "param-selected", group: "color" }), true);
  assert.equal(tourEventMatches(color, { type: "param-selected", group: "shape" }), false);
  assert.equal(tourEventMatches(color, { type: "fx-changed" }), false);
});

test("the Library action waits for navigation and actual playback", () => {
  const library = tutorialSteps("local").find((step) => step.id === "library-play");
  assert(library);
  assert.equal(tourEventMatches(library, { type: "tab-changed", group: "library" }), true);
  assert.equal(tourEventMatches(library, { type: "track-played" }), false);
  assert.equal(tourEventMatches(library, { type: "track-played" }, 1), true);
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
  const copy = finaleCopy({
    params: "Green · Broad · Drift",
    renderLabel: "your track",
    queuedVariantId: "variant-12",
    playedTrackId: "variant-12",
    renderStatus: "Ready",
  });
  assert.match(copy, /Green · Broad · Drift/);
  assert.match(copy, /queued your track/);
  assert.match(copy, /played the master you just queued/);
  assert.doesNotMatch(copy, /Green · Broad · Drift.*Green/);
});

test("finale distinguishes an existing track and a queued render", () => {
  const existing = finaleCopy({
    params: "White · Mid · Drift",
    renderLabel: "your track",
    queuedVariantId: "variant-new",
    playedTrackId: "demo_first_render",
    renderStatus: "Ready",
  });
  assert.match(existing, /played a master from your Library/);
  assert.doesNotMatch(existing, /still queued/);

  const waiting = finaleCopy({
    params: "Brown · Broad · Drift",
    renderLabel: "your track",
    queuedVariantId: "variant-new",
    playedTrackId: "variant-new",
    renderStatus: "Queued",
  });
  assert.match(waiting, /played the master you just queued/);
  assert.match(waiting, /Your render is still queued/);
});

test("render banner fires exactly once when the tracked job is done", () => {
  assert.equal(shouldFireRenderBanner(false, "Queued"), false);
  assert.equal(shouldFireRenderBanner(false, "Done"), true);
  assert.equal(shouldFireRenderBanner(true, "Done"), false);
});

test("the demo is selected only when no real artifacts exist", () => {
  assert.equal(shouldShowDemoTrack(0), true);
  assert.equal(shouldShowDemoTrack(1), false);
  assert.equal(shouldShowDemoTrack(144), false);
});

test("the seeded demo sidecar matches the library contract", () => {
  assert.equal(isDemoSidecar(demoSidecar), true);
  assert.equal(demoSidecar.variant_id, "demo_first_render");
  assert.equal(demoSidecar.stem_filenames.length, 0);
});
