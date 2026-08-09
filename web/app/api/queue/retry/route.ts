import { NextRequest, NextResponse } from "next/server";
import { submitQueueSelection } from "@/lib/queue-action";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { jobId?: string; variantId?: string };
  if (!body.jobId || !body.variantId) return NextResponse.json({ error: "A job and variant are required" }, { status: 400 });
  const raw = body.variantId;
  const selection = raw === "pilot" ? { pilot: true } : raw === "full" ? { full: true } : { variantIds: raw.split(",") };
  const result = await submitQueueSelection(selection);
  return NextResponse.json(result.payload, { status: result.status });
}
