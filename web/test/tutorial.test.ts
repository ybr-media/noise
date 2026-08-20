import assert from "node:assert/strict";
import { test } from "node:test";
import * as meRoute from "../app/api/me/route";
import * as tutorialRoute from "../app/api/me/tutorial/route";
import { lazyAdapter, missingAuthEnv, resolveAuthRedisEnv } from "../lib/auth";
import { isAuthOpenMode } from "../lib/middleware-access";
import { completedFirstRunState, firstRunShouldLaunch, type FirstRunState } from "../lib/use-first-run";
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
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
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

async function withAuthEnv<T>(values: Partial<Record<(typeof AUTH_ENV_NAMES)[number], string>>, callback: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(AUTH_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of AUTH_ENV_NAMES) {
    delete process.env[name];
    if (values[name]) process.env[name] = values[name];
  }
  try {
    return await callback();
  } finally {
    for (const name of AUTH_ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test("auth Redis env accepts explicit Upstash names", async () => {
  await withAuthEnv(
    { UPSTASH_REDIS_REST_URL: "https://explicit.example", UPSTASH_REDIS_REST_TOKEN: "explicit-token" },
    () => {
      assert.deepEqual(resolveAuthRedisEnv(), {
        url: "https://explicit.example",
        token: "explicit-token",
      });
    },
  );
});

test("auth Redis env accepts Vercel marketplace names", async () => {
  await withAuthEnv(
    { KV_REST_API_URL: "https://marketplace.example", KV_REST_API_TOKEN: "marketplace-token" },
    () => {
      assert.deepEqual(resolveAuthRedisEnv(), {
        url: "https://marketplace.example",
        token: "marketplace-token",
      });
    },
  );
});

test("explicit Upstash Redis env wins over marketplace aliases", async () => {
  await withAuthEnv(
    {
      UPSTASH_REDIS_REST_URL: "https://explicit.example",
      UPSTASH_REDIS_REST_TOKEN: "explicit-token",
      KV_REST_API_URL: "https://marketplace.example",
      KV_REST_API_TOKEN: "marketplace-token",
    },
    () => {
      assert.deepEqual(resolveAuthRedisEnv(), {
        url: "https://explicit.example",
        token: "explicit-token",
      });
    },
  );
});

test("read-only marketplace token does not satisfy auth Redis configuration", async () => {
  await withAuthEnv(
    {
      AUTH_SECRET: "secret",
      AUTH_RESEND_KEY: "resend",
      AUTH_EMAIL_FROM: "from@example.com",
      KV_REST_API_URL: "https://marketplace.example",
      KV_REST_API_READ_ONLY_TOKEN: "read-only-token",
      ALLOWED_EMAILS: "person@example.com",
    },
    () => {
      assert.equal(resolveAuthRedisEnv().token, undefined);
      assert.equal(missingAuthEnv().includes("UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN"), true);
    },
  );
});

test("missing Redis env keeps auth in open mode", async () => {
  await withAuthEnv({}, () => {
    assert.equal(resolveAuthRedisEnv().url, undefined);
    assert.equal(resolveAuthRedisEnv().token, undefined);
    assert.equal(isAuthOpenMode(missingAuthEnv()), true);
  });
});

test("lazy auth adapter advertises its methods without exposing then", async () => {
  await withAuthUnset(async () => {
    const adapter = lazyAdapter();
    const methodNames = [
      "createUser",
      "getUser",
      "getUserByEmail",
      "getUserByAccount",
      "updateUser",
      "linkAccount",
      "createSession",
      "getSessionAndUser",
      "updateSession",
      "deleteSession",
      "createVerificationToken",
      "useVerificationToken",
      "unlinkAccount",
      "deleteUser",
    ];

    for (const name of methodNames) {
      assert.equal(name in adapter, true, name);
      assert.equal(typeof Reflect.get(adapter, name), "function", name);
    }
    assert.deepEqual(Object.keys(adapter), methodNames);
    assert.equal("then" in adapter, false);
    assert.equal(Reflect.get(adapter, "then"), undefined);
    assert.equal(Reflect.get(adapter, "toString"), undefined);
    assert.doesNotThrow(() => lazyAdapter());
  });
});

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
  const completedAt = "2026-01-01T00:00:00.000Z";
  assert.deepEqual(
    tutorialUserResponse({ email: "austin@example.com" }, "austin@example.com"),
    { email: "austin@example.com", tutorialCompletedAt: null, tutorialVersion: TUTORIAL_VERSION },
  );
  assert.deepEqual(
    tutorialUserResponse({ tutorialCompletedAt: completedAt, tutorialVersion: 2 }, "austin@example.com"),
    { email: "austin@example.com", tutorialCompletedAt: completedAt, tutorialVersion: 2 },
  );
  assert.deepEqual(
    tutorialUserResponse({ tutorialCompletedAt: new Date(completedAt) }, "austin@example.com"),
    { email: "austin@example.com", tutorialCompletedAt: completedAt, tutorialVersion: TUTORIAL_VERSION },
  );
  for (const tutorialCompletedAt of [new Date("invalid"), "not-a-date", 42, {}, undefined]) {
    assert.equal(
      tutorialUserResponse({ tutorialCompletedAt }, "austin@example.com").tutorialCompletedAt,
      null,
    );
  }
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

test("completing the first-run state prevents another automatic launch", () => {
  const initialState: FirstRunState = {
    ready: true,
    authenticated: true,
    firstPaintGuard: false,
    user: null,
  };
  assert.equal(firstRunShouldLaunch(initialState), true);
  const completedAt = "2026-01-01T00:00:00.000Z";
  const completedState = completedFirstRunState(initialState, completedAt);
  assert.equal(completedState.user?.tutorialCompletedAt, completedAt);
  assert.equal(firstRunShouldLaunch(completedState), false);
});
