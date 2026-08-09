import { NextRequest, NextResponse } from "next/server";
import { listJobs } from "@/lib/queue";
import { dispatchedQueue } from "@/lib/dispatch";
import { RENDER_MODE, type RenderSelection } from "@/lib/config";
import { submitQueueSelection } from "@/lib/queue-action";

export const dynamic = "force-dynamic";

export async function GET() {
  if (RENDER_MODE === "dispatch") {
    const queue = await dispatchedQueue();
    return NextResponse.json({ mode: RENDER_MODE, ...queue });
  }
  return NextResponse.json({ mode: RENDER_MODE, jobs: listJobs(), stats: { medianRenderSeconds: null, sampleSize: 0 } });
}

export async function POST(request: NextRequest) {
  const result = await submitQueueSelection((await request.json()) as RenderSelection);
  return NextResponse.json(result.payload, { status: result.status });
}
