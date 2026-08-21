import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoute, serializeRoute } from "../lib/route";

test("parses the create routes", () => {
  assert.deepEqual(parseRoute(""), { tab: "create", activity: false });
  assert.deepEqual(parseRoute("#create"), { tab: "create", activity: false });
  assert.deepEqual(parseRoute("#create?activity"), { tab: "create", activity: true });
});

test("parses library routes and track ids", () => {
  assert.deepEqual(parseRoute("#library"), { tab: "library", activity: false });
  assert.deepEqual(parseRoute("#library?activity"), { tab: "library", activity: true });
  assert.deepEqual(parseRoute("#library/render-key"), { tab: "library", trackId: "render-key", activity: false });
  assert.deepEqual(parseRoute("#library/variant%2Fid?activity"), { tab: "library", trackId: "variant/id", activity: true });
});

test("parses release routes and release ids", () => {
  assert.deepEqual(parseRoute("#releases"), { tab: "releases", activity: false });
  assert.deepEqual(parseRoute("#releases?activity"), { tab: "releases", activity: true });
  assert.deepEqual(parseRoute("#releases/release%2Fid"), { tab: "releases", releaseId: "release/id", activity: false });
});

test("redirects legacy design and queue routes", () => {
  assert.deepEqual(parseRoute("#design"), { tab: "create", activity: false });
  assert.deepEqual(parseRoute("#design?activity"), { tab: "create", activity: true });
  assert.deepEqual(parseRoute("#queue"), { tab: "library", activity: true });
  assert.deepEqual(parseRoute("#queue?anything"), { tab: "library", activity: true });
});

test("serializes every route shape and preserves encoded ids", () => {
  const routes = [
    { tab: "create", activity: false },
    { tab: "create", activity: true },
    { tab: "library", activity: false },
    { tab: "library", trackId: "render/key?take", activity: true },
    { tab: "releases", activity: false },
    { tab: "releases", releaseId: "release/id?draft", activity: true },
  ] as const;

  for (const route of routes) {
    assert.deepEqual(parseRoute(serializeRoute(route)), route);
  }
});
