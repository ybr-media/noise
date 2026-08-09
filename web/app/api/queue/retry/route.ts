import { NextRequest, NextResponse } from "next/server";
import { dispatchRender } from "@/lib/dispatch";
import { enqueue } from "@/lib/queue";
import { RENDER_MODE, findVariant, resolveSelection } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (RENDER_MODE === "unavailable") {
    return NextResponse.json({ error: "Rendering is unavailable" }, { status: 503 });
  }
  const body = (await request.json()) as { jobId?: string; variantId?: string };
  if (!body.jobId || !body.variantId) return NextResponse.json({ error: "A job and variant are required" }, { status: 400 });
  const raw = body.variantId;
  const selection = raw === "pilot" ? { pilot: true } : raw === "full" ? { full: true } : { variantIds: raw.split(",") };
  const { variantIds, dispatchInput } = resolveSelection(selection);
  if (!variantIds.length || variantIds.some((id) => !findVariant(id))) {
    return NextResponse.json({ error: "Choose one or more known variants" }, { status: 400 });
  }
  if (RENDER_MODE === "local") return NextResponse.json({ mode: RENDER_MODE, jobs: enqueue(variantIds) }, { status: 202 });
  try {
    await dispatchRender(dispatchInput);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Render dispatch failed" }, { status: 502 });
  }
  return NextResponse.json({ mode: RENDER_MODE, jobs: [] }, { status: 202 });
}
