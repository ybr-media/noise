import assert from "node:assert/strict";
import { test } from "node:test";
import { signDownloadToken, verifyDownloadToken } from "../lib/download-token";

process.env.NOISE_DOWNLOAD_SECRET = "download-test-secret";

test("download tokens round-trip and reject tampering or expiry", () => {
  const token = signDownloadToken("track_master.wav", Date.now() + 60_000);
  assert.deepEqual(verifyDownloadToken(token), { filename: "track_master.wav" });
  const [payload, signature] = token.split(".");
  assert.equal(verifyDownloadToken(`${payload}x.${signature}`), null);
  assert.equal(verifyDownloadToken(`${payload}.${signature.slice(0, -1)}x`), null);
  assert.equal(verifyDownloadToken(signDownloadToken("track_master.wav", Date.now() - 1)), null);
});
