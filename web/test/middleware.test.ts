import assert from "node:assert/strict";
import { test } from "node:test";
import { accessForRequest, shouldBypassAuth } from "../lib/middleware-access";

test("signed-out console pages redirect and signed-in pages pass through", () => {
  assert.equal(accessForRequest("/", false), "redirect");
  assert.equal(accessForRequest("/", true), "next");
  assert.equal(accessForRequest("/api/library", false), "unauthorized");
});

test("auth, signin, static, and audio paths bypass the session gate", () => {
  for (const pathname of ["/signin", "/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/api/auth/session", "/api/audio/example.wav"]) {
    assert.equal(shouldBypassAuth(pathname), true, pathname);
    assert.equal(accessForRequest(pathname, false), "next", pathname);
  }
});

test("audio range URLs stay open while other APIs remain protected", () => {
  assert.equal(accessForRequest("/api/audio/example.wav", false), "next");
  assert.equal(accessForRequest("/api/audio/example.wav?download=1", false), "next");
  assert.equal(accessForRequest("/api/queue", false), "unauthorized");
});
