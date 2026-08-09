import { NextResponse } from "next/server";
import { artifactIndex } from "@/lib/artifacts";
import { libraryTracks } from "@/lib/library";
import { loadReleases } from "@/lib/releases";

export const dynamic = "force-dynamic";

export async function GET() {
  const [index, releases] = await Promise.all([artifactIndex(), loadReleases()]);
  const titles = new Map(releases.flatMap((release) => release.tracks.map((track) => [
    track.variantId,
    { title: track.title, description: track.description },
  ] as const)));
  const tracks = await libraryTracks(titles);
  return NextResponse.json({ renderDirectory: index.origin, tracks });
}
