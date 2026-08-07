import { NextResponse } from "next/server";
import { artifactIndex } from "@/lib/artifacts";
import { libraryTracks } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET() {
  const [index, tracks] = await Promise.all([artifactIndex(), libraryTracks()]);
  return NextResponse.json({ renderDirectory: index.origin, tracks });
}
