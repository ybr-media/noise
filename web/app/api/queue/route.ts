import { NextRequest, NextResponse } from "next/server";
import { enqueue, listJobs } from "@/lib/queue";
import { dispatchRender, dispatchedJobs } from "@/lib/dispatch";
import { RENDER_MODE, findVariant, loadPilotVariants } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ mode: RENDER_MODE, jobs: RENDER_MODE === "dispatch" ? await dispatchedJobs() : listJobs() });
}

export async function POST(request: NextRequest) {
  if (RENDER_MODE === "unavailable") {
    return NextResponse.json({ error: "Rendering needs the local Audacity worker; this deployment is browse-only" }, { status: 503 });
  }
  const body = (await request.json()) as { variantIds?: unknown[]; pilot?: boolean };
  const variantIds = body.pilot
    ? loadPilotVariants().map((variant) => variant.variantId)
    : Array.isArray(body.variantIds) ? body.variantIds.filter((id): id is string => typeof id === "string") : [];
  if (!variantIds.length || variantIds.some((id) => !findVariant(id))) {
    return NextResponse.json({ error: "Choose one or more known variants" }, { status: 400 });
  }
  if (RENDER_MODE === "local") {
    return NextResponse.json({ mode: RENDER_MODE, jobs: enqueue(variantIds) }, { status: 202 });
  }
  try {
    await dispatchRender(body.pilot ? "pilot" : variantIds.join(","));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Render dispatch failed" }, { status: 502 });
  }
  // GitHub takes a moment to register the run, so the caller polls GET for it.
  return NextResponse.json({ mode: RENDER_MODE, jobs: [] }, { status: 202 });
}
