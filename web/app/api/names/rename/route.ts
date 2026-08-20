import { NextRequest, NextResponse } from "next/server";
import { ARTIFACTS_ARE_REMOTE } from "@/lib/artifacts";
import { renameTrack } from "@/lib/naming";

export async function POST(request: NextRequest) {
  if (ARTIFACTS_ARE_REMOTE) {
    return NextResponse.json({ error: "Names are approved where the masters are rendered; this deployment is read-only" }, { status: 503 });
  }
  const body = (await request.json()) as { filename?: unknown; title?: unknown };
  if (typeof body.filename !== "string" || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "Filename and title are required" }, { status: 400 });
  }
  try {
    renameTrack(body.filename, body.title);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rename failed" }, { status: 400 });
  }
}
