import { NextResponse } from "next/server";
import { loadVariants } from "@/lib/config";
import { libraryTracks } from "@/lib/library";
import { newestTracksByVariant } from "@/lib/track-map";
import type { LibraryTrack } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const rendered: Map<string, LibraryTrack> = newestTracksByVariant((await libraryTracks()).filter((track) => track.exists));
  const variants = loadVariants().map((variant) => {
    const track = rendered.get(variant.variantId);
    return {
      ...variant,
      durationSeconds: track?.exists ? track.durationSeconds : variant.durationSeconds,
    };
  });
  return NextResponse.json({ variants });
}
