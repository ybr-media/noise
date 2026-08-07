import { NextResponse } from "next/server";
import { RENDER_DIR } from "@/lib/config";
import { libraryTracks } from "@/lib/library";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ renderDirectory: RENDER_DIR, tracks: libraryTracks() });
}
