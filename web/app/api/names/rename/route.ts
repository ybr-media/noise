import { NextRequest, NextResponse } from "next/server";
import { ARTIFACTS_ARE_REMOTE } from "@/lib/artifacts";
import { DISPATCH_CONFIGURED, dispatchRename } from "@/lib/dispatch";
import { renameTrack } from "@/lib/naming";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { filename?: unknown; title?: unknown };
  if (typeof body.filename !== "string" || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "Filename and title are required" }, { status: 400 });
  }
  if (ARTIFACTS_ARE_REMOTE) {
    if (!DISPATCH_CONFIGURED) {
      return NextResponse.json({ error: "Renames are dispatched to GitHub; no dispatch token is configured on this deployment" }, { status: 503 });
    }
    try {
      await dispatchRename(JSON.stringify({ filename: body.filename, title: body.title }));
      return NextResponse.json({ ok: true, dispatched: true }, { status: 202 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Rename dispatch failed" }, { status: 502 });
    }
  }
  try {
    renameTrack(body.filename, body.title);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rename failed" }, { status: 400 });
  }
}
