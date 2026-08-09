import assert from "node:assert/strict";
import { test } from "node:test";
import { pilotRelease, releaseList, releasePayload, validateRelease } from "../lib/releases";
import { toReleaseDocument } from "../lib/release-document";

test("derived preset and saved releases narrow to valid documents", async () => {
  const preset = (await releaseList()).find((release) => release.unsaved);
  assert.ok(preset);
  assert.deepEqual(validateRelease(toReleaseDocument(preset)), toReleaseDocument(preset));

  const saved = (await releasePayload({ ...pilotRelease(), id: "saved-ep" })).release;
  assert.equal(saved.unsaved, undefined);
  assert.deepEqual(validateRelease(toReleaseDocument(saved)), toReleaseDocument(saved));
});
