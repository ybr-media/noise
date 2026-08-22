import assert from "node:assert/strict";
import { test } from "node:test";
import { maxDuration } from "../app/api/bundle/[variantId]/route";
import { prebuiltBundleFilename } from "../lib/bundle-redirect";
import type { ArtifactIndex } from "../lib/artifacts";
import { parseRoute, serializeRoute } from "../lib/route";

const index = (filename: string): ArtifactIndex => ({
  origin: "https://artifacts.example/noise",
  artifacts: new Map(),
  bundles: new Map([["render-1", { variantId: "variant-1", renderKey: "render-1", filename, sizeBytes: 123 }]]),
});

test("redirects to a prebuilt bundle only when its current name matches", () => {
  assert.equal(maxDuration, 800);
  assert.equal(prebuiltBundleFilename(index("bundle.zip"), "render-1", "bundle.zip"), "bundle.zip");
  assert.equal(prebuiltBundleFilename(index("old-name.zip"), "render-1", "bundle.zip"), undefined);
  assert.equal(prebuiltBundleFilename(index("bundle.zip"), "other-render", "bundle.zip"), undefined);
});

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
