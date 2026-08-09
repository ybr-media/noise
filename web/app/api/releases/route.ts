import { NextRequest, NextResponse } from "next/server";
import { releaseList, RELEASE_MODE, saveRelease, validateRelease } from "@/lib/releases";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ releases: await releaseList(), mode: RELEASE_MODE });
}

export async function POST(request: NextRequest) {
  if (RELEASE_MODE === "unavailable") {
    return NextResponse.json({ error: "Releases are edited where a writer is configured; this deployment is read-only" }, { status: 503 });
  }
  try {
    const release = validateRelease(await request.json());
    await saveRelease(release);
    return NextResponse.json({ ok: true, mode: RELEASE_MODE }, { status: RELEASE_MODE === "dispatch" ? 202 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Release save failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
