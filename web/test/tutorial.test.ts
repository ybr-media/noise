import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TUTORIAL_VERSION,
  markTutorialComplete,
  tutorialApiAccess,
  tutorialDoneFromStorage,
  tutorialDoneStorageValue,
  tutorialUserResponse,
} from "../lib/tutorial";

test("tutorial API exposes the user shape with defaults", () => {
  assert.deepEqual(
    tutorialUserResponse({ email: "austin@example.com" }, "austin@example.com"),
    { email: "austin@example.com", tutorialCompletedAt: null, tutorialVersion: TUTORIAL_VERSION },
  );
  assert.deepEqual(
    tutorialUserResponse({ tutorialCompletedAt: "2026-01-01T00:00:00.000Z", tutorialVersion: 2 }, "austin@example.com"),
    { email: "austin@example.com", tutorialCompletedAt: "2026-01-01T00:00:00.000Z", tutorialVersion: 2 },
  );
});

test("tutorial API distinguishes open mode and unauthenticated sessions", () => {
  assert.equal(tutorialApiAccess(false, null), "open");
  assert.equal(tutorialApiAccess(true, null), "unauthenticated");
  assert.equal(tutorialApiAccess(true, "austin@example.com"), "authenticated");
});

test("marking the tutorial complete persists the completion timestamp and version", () => {
  const completedAt = "2026-01-01T00:00:00.000Z";
  assert.deepEqual(
    markTutorialComplete({ email: "austin@example.com" }, completedAt),
    { email: "austin@example.com", tutorialCompletedAt: completedAt, tutorialVersion: TUTORIAL_VERSION },
  );
});

test("tutorial localStorage mirror uses a compact done flag", () => {
  assert.equal(tutorialDoneStorageValue(null), null);
  assert.equal(tutorialDoneStorageValue("2026-01-01T00:00:00.000Z"), "1");
  assert.equal(tutorialDoneFromStorage("1"), true);
  assert.equal(tutorialDoneFromStorage(null), false);
  assert.equal(tutorialDoneFromStorage("0"), false);
});
