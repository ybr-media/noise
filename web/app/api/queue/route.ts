import { NextRequest, NextResponse } from "next/server";
import { enqueue, listJobs } from "@/lib/queue";
import { RENDERING_AVAILABLE, findVariant, loadPilotVariants } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

export async function POST(request: NextRequest) {
  if (!RENDERING_AVAILABLE) {
    return NextResponse.json({ error: "Rendering needs the local Audacity worker; this deployment is browse-only" }, { status: 503 });
  }
  const body = (await request.json()) as { variantIds?: unknown[]; pilot?: boolean };
  const variantIds = body.pilot
    ? loadPilotVariants().map((variant) => variant.variantId)
    : Array.isArray(body.variantIds) ? body.variantIds.filter((id): id is string => typeof id === "string") : [];
  if (!variantIds.length || variantIds.some((id) => !findVariant(id))) {
    return NextResponse.json({ error: "Choose one or more known variants" }, { status: 400 });
  }
  return NextResponse.json({ jobs: enqueue(variantIds) }, { status: 202 });
}
