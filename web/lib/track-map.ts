import type { LibraryTrack } from "./types";

export function newestTracksByVariant(tracks: LibraryTrack[]): Map<string, LibraryTrack> {
  const result = new Map<string, LibraryTrack>();
  for (const track of tracks) {
    if (!result.has(track.variantId)) result.set(track.variantId, track);
  }
  return result;
}
