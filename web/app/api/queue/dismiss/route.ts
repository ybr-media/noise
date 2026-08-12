import { NextRequest, NextResponse } from "next/server";
import { archiveDismissal, listDismissals } from "@/lib/dismissals";
import type { QueueJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ records: await listDismissals() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Archive unavailable" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { job?: QueueJob };
  const job = body.job;
  if (!job?.id || !job.variantId || !job.status) {
    return NextResponse.json({ error: "A queue job is required" }, { status: 400 });
  }
  if (job.status !== "Failed" && job.status !== "Cancelled") {
    return NextResponse.json({ error: "Only failed or cancelled renders can be archived" }, { status: 400 });
  }
  try {
    return NextResponse.json({ records: await archiveDismissal(job) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Archive failed" }, { status: 502 });
  }
}
