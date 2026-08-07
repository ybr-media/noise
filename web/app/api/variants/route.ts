import { NextResponse } from "next/server";
import { loadPilotVariants, loadVariants } from "@/lib/config";
import { libraryTracks } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET() {
  const pilotIds = new Map(loadPilotVariants().map((variant, index) => [variant.variantId, `P${index + 1}`]));
  const rendered = new Map((await libraryTracks()).map((track) => [track.variantId, track]));
  const variants = loadVariants().map((variant) => {
    const track = rendered.get(variant.variantId);
    return {
      ...variant,
      pilot: pilotIds.get(variant.variantId) ?? null,
      durationSeconds: track?.exists ? track.durationSeconds : variant.durationSeconds,
    };
  });
  return NextResponse.json({ variants });
}
