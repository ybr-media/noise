import { NextRequest, NextResponse } from "next/server";
import { archiveDismissal, listDismissals, type R2Cleanup } from "@/lib/dismissals";
import { DISPATCH_CONFIGURED, dispatchCleanup } from "@/lib/dispatch";
import { loadPilotVariants, loadVariants } from "@/lib/config";
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
    return NextResponse.json({ records: await archiveDismissal(job, await queueR2Cleanup(job.variantId)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Archive failed" }, { status: 502 });
  }
}

// A dispatch job's variantId is the raw workflow input (`pilot`, `full`, or a
// comma-separated list), so batch selectors expand to their member variants
// before the cleanup run is dispatched.
function cleanupVariants(raw: string): string {
  if (raw === "pilot") return loadPilotVariants().map((variant) => variant.variantId).join(",");
  if (raw === "full") return loadVariants().map((variant) => variant.variantId).join(",");
  return raw;
}

async function queueR2Cleanup(variantId: string): Promise<R2Cleanup> {
  const queuedAt = new Date().toISOString();
  if (!DISPATCH_CONFIGURED) return { state: "unavailable", queuedAt };
  try {
    await dispatchCleanup(cleanupVariants(variantId));
    return { state: "queued", queuedAt };
  } catch {
    return { state: "failed", queuedAt };
  }
}
