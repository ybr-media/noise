import assert from "node:assert/strict";
import { test } from "node:test";
import demoSidecar from "../demo/demo_first_render.json";
import { isDemoSidecar, shouldShowDemoTrack } from "../lib/demo";
import { finaleCopy, playedTrackIdAfterPlayback, shouldFireRenderBanner, shouldOfferRenderStatus, shouldPersistTutorial, tourEventMatches, tourLibraryTrackId, tutorialSteps } from "../app/ui/tutorial";

test("the tour script is data-driven and branches render copy by mode", () => {
  const local = tutorialSteps("local");
  const dispatch = tutorialSteps("dispatch");
  const unavailable = tutorialSteps("unavailable");
  assert.equal(local.length, 9);
  assert.equal(dispatch.find((step) => step.id === "render")?.kind, "action");
  assert.equal(unavailable.find((step) => step.id === "render-unavailable")?.kind, "info");
  assert.equal(unavailable.find((step) => step.id === "progress-unavailable")?.kind, "info");
  // Render progress is a header state now, not a tab you are sent to.
  assert.equal(local.find((step) => step.id === "progress")?.target, "render-status");
  assert.equal(local.some((step) => step.target?.includes("queue")), false);
  assert.equal(local.find((step) => step.id === "param-color")?.target, "create-color");
  assert.equal(local.find((step) => step.id === "param-shape")?.target, "create-shape");
  assert.equal(local.find((step) => step.id === "param-color")?.title, "Pick a color");
  assert.doesNotMatch(local.find((step) => step.id === "param-color")?.body ?? "", /colour/i);
});

test("every step can be advanced from the tooltip and action steps say what to do", () => {
  for (const mode of ["local", "dispatch", "unavailable"] as const) {
    for (const step of tutorialSteps(mode)) {
      if (step.kind === "action") assert.ok(step.instruction, `${step.id} needs an instruction`);
      // Auto-advance is a bonus; the tooltip's own Back/Next path is unconditional in the overlay.
      assert.ok(step.title && step.body);
    }
  }
});

test("tour copy avoids engineering and defensive vocabulary", () => {
  for (const mode of ["local", "dispatch", "unavailable"] as const) {
    const copy = tutorialSteps(mode)
      .flatMap((step) => [step.title, step.body, step.instruction, step.autoAction, step.fallbackCopy?.body])
      .filter(Boolean)
      .join(" ");
    assert.doesNotMatch(copy, /\b(mock|fake|real job|the engine|runner)\b/i);
  }
});

test("navigating to Library and playing a master are separate steps", () => {
  const local = tutorialSteps("local");
  const open = local.find((step) => step.id === "library-open");
  const play = local.find((step) => step.id === "library-play");
  assert(open && play);
  assert.equal(open.target, "dock-library");
  assert.equal(play.target, "library-track");
  // Never "press play" while the nav icon is the thing being pointed at.
  assert.doesNotMatch(open.instruction ?? "", /play/i);
  assert.match(play.instruction ?? "", /play/i);
  assert.equal(play.fallbackTarget, "library-header");
  assert.equal(play.fallbackCopy?.instruction, undefined);
});

test("the tour only ever points at a master that passed QA", () => {
  const tracks = [
    { variantId: "failing", exists: true, qaVerdict: "FAIL" as const },
    { variantId: "passing", exists: true, qaVerdict: "PASS" as const },
    { variantId: "missing", exists: false, qaVerdict: "PASS" as const },
  ];
  assert.equal(tourLibraryTrackId(tracks), "passing");
  assert.equal(tourLibraryTrackId(tracks, "failing"), "passing");
  assert.equal(tourLibraryTrackId(tracks, "missing"), "passing");
  assert.equal(tourLibraryTrackId(tracks, "passing"), "passing");
  assert.equal(tourLibraryTrackId([tracks[0]]), undefined);
});

test("action steps advance only for their declared event and group", () => {
  const color = tutorialSteps("local").find((step) => step.id === "param-color");
  assert(color);
  assert.equal(tourEventMatches(color, { type: "param-selected", group: "color" }), true);
  assert.equal(tourEventMatches(color, { type: "param-selected", group: "shape" }), false);
  assert.equal(tourEventMatches(color, { type: "fx-changed" }), false);
});

test("the Library steps wait for navigation and then for actual playback", () => {
  const steps = tutorialSteps("local");
  const open = steps.find((step) => step.id === "library-open");
  const play = steps.find((step) => step.id === "library-play");
  assert(open && play);
  assert.equal(tourEventMatches(open, { type: "tab-changed", group: "library" }), true);
  assert.equal(tourEventMatches(open, { type: "track-played" }), false);
  assert.equal(tourEventMatches(play, { type: "track-played" }), true);
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
  // An unfinished render becomes the finale's "Check render status" action instead of a dead mention.
  assert.doesNotMatch(waiting, /still queued/);
  assert.equal(shouldOfferRenderStatus({ renderStatus: "Queued" }), true);
  assert.equal(shouldOfferRenderStatus({ renderStatus: "Rendering" }), true);
  assert.equal(shouldOfferRenderStatus({ renderStatus: "Ready" }), false);
});

test("failed playback cannot leave a false played-track claim", () => {
  assert.equal(playedTrackIdAfterPlayback(null, "seeded", "playing"), "seeded");
  assert.equal(playedTrackIdAfterPlayback("seeded", "seeded", "error"), null);
  assert.equal(playedTrackIdAfterPlayback("other", "seeded", "error"), "other");
  const failed = finaleCopy({
    params: "Green · Broad · Drift",
    renderLabel: "your track",
    queuedVariantId: "variant-new",
    playedTrackId: null,
    renderStatus: "Ready",
  });
  assert.match(failed, /haven't played a master yet/);
  assert.doesNotMatch(failed, /played a master from your Library/);
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
