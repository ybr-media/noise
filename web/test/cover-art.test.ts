import assert from "node:assert/strict";
import { test } from "node:test";
import { coverArtOps } from "../lib/cover-art";
import type { Release } from "../lib/types";

const release: Release = {
  id: "pilot-ep",
  type: "ep",
  artist: "Noise Lab",
  title: "Pilot EP",
  genre: "New Age",
  secondaryGenre: "Ambient",
  releaseDate: "",
  artSeed: 42,
  songwriter: "",
  tracks: [{ variantId: "wn_white_mid_drift_balanced", title: "Still Air", description: "", approvedAt: null }],
  submitted: { at: null, storeUrl: null },
};
const dimensions = [{ color: "white" as const, band: "mid" as const, motion: "drift" as const }];

test("cover art operations are deterministic and text is optional", () => {
  assert.deepEqual(coverArtOps(release, dimensions), coverArtOps(release, dimensions));
  assert.notDeepEqual(coverArtOps(release, dimensions, 43), coverArtOps(release, dimensions, 42));
  assert.equal(coverArtOps(release, dimensions, 42, false).some((op) => op.kind === "text"), false);
  assert.equal(coverArtOps(release, dimensions).find((op) => op.kind === "text")?.text, "Pilot EP · Noise Lab");
});
