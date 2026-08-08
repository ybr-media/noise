import { NextResponse } from "next/server";
import { loadVariants } from "@/lib/config";
import { libraryTracks } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET() {
  const rendered = new Map((await libraryTracks()).map((track) => [track.variantId, track]));
  const variants = loadVariants().map((variant) => {
    const track = rendered.get(variant.variantId);
    return {
      ...variant,
      durationSeconds: track?.exists ? track.durationSeconds : variant.durationSeconds,
    };
  });
  return NextResponse.json({ variants });
}
