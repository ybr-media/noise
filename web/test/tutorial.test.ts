import assert from "node:assert/strict";
import { test } from "node:test";
import * as meRoute from "../app/api/me/route";
import * as tutorialRoute from "../app/api/me/tutorial/route";
import {
  TUTORIAL_VERSION,
  markTutorialComplete,
  tutorialApiAccess,
  tutorialDoneFromStorage,
  tutorialDoneStorageValue,
  tutorialUserResponse,
} from "../lib/tutorial";

const AUTH_ENV_NAMES = [
  "AUTH_SECRET",
  "AUTH_RESEND_KEY",
  "AUTH_EMAIL_FROM",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "ALLOWED_EMAILS",
] as const;

async function withAuthUnset<T>(callback: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(AUTH_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of AUTH_ENV_NAMES) delete process.env[name];
  try {
    return await callback();
  } finally {
    for (const name of AUTH_ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test("the user and tutorial endpoints are split and tutorial POST remains gated", async () => {
  assert.equal("POST" in meRoute, false);
  assert.equal(typeof tutorialRoute.POST, "function");
  await withAuthUnset(async () => {
    const meResponse = await meRoute.GET();
    assert.equal(meResponse.status, 401);
    assert.deepEqual(await meResponse.json(), { error: "Authentication unavailable" });
    const tutorialResponse = await tutorialRoute.POST();
    assert.equal(tutorialResponse.status, 401);
    assert.deepEqual(await tutorialResponse.json(), { error: "Authentication unavailable" });
  });
});

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
