import type { Release } from "./types";

export function toReleaseDocument(release: Release): Release {
  return {
    id: release.id,
    type: release.type,
    artist: release.artist,
    title: release.title,
    genre: release.genre,
    secondaryGenre: release.secondaryGenre,
    releaseDate: release.releaseDate,
    artSeed: release.artSeed,
    songwriter: release.songwriter,
    tracks: release.tracks.map((track) => ({
      variantId: track.variantId,
      title: track.title,
      description: track.description,
      approvedAt: track.approvedAt,
    })),
    submitted: {
      at: release.submitted.at,
      storeUrl: release.submitted.storeUrl,
    },
  };
}
