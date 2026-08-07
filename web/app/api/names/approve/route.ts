import { NextRequest, NextResponse } from "next/server";
import { approveName } from "@/lib/naming";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { filename?: unknown; title?: unknown; description?: unknown };
  if (typeof body.filename !== "string" || typeof body.title !== "string" || typeof body.description !== "string" || !body.title.trim() || !body.description.trim()) {
    return NextResponse.json({ error: "Filename, title, and description are required" }, { status: 400 });
  }
  try {
    approveName(body.filename, body.title, body.description);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approval failed" }, { status: 400 });
  }
}
