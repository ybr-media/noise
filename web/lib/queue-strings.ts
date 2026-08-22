import type { QueueJob, Variant } from "./types";
import { queueAheadLabel, queuedJobsAhead, renderEstimate } from "./eta";

export type RenderMode = "local" | "dispatch" | "unavailable";
export type RenderStats = { medianRenderSeconds: number | null; sampleSize: number };

export const queueStrings = {
  title: "Queue",
  sections: { attention: "Needs attention", active: "Active", history: "History" },
  status: { failed: "Failed", cancelled: "Cancelled", queued: "Queued", rendering: "Running", done: "Ready" },
  logs: "View logs",
  library: "Open in Library",
  dismiss: { removed: "Archived", failed: "Could not archive the render" },
  historyCount: (count: number) => `History (${count})`,
  archivedCount: (count: number) => `Archived (${count})`,
  archivedAt: (time: string) => `archived ${time}`,
  r2Cleanup: { queued: "R2 deletion queued", failed: "R2 deletion could not be queued", unavailable: "R2 deletion unavailable" },
  runHistory: (count: number) => `Run history · ${count}`,
  synced: (value: string) => `Synced ${value}`,
  statusCaption: { idle: "Idle", queued: "Queued", rendering: (count: number) => `Rendering · ${count} running`, failed: "Render failed — see activity" },
  waitingCaption: (count: number) => count > 1 ? `Queued · ${count} waiting` : "Queued",
  rendering: "Rendering your track",
  failedAt: (step: string, exitCode?: number | null) => `Failed at step: ${step}${exitCode === null || exitCode === undefined ? "" : ` (exit ${exitCode})`}`,
  attempt: (number: number, time: string) => `Attempt ${number} · ${time}`,
  attemptStatus: (status: QueueJob["status"]) => status === "Done" ? "✓ Ready" : status === "Failed" ? "✗ Failed" : status === "Cancelled" ? "× Cancelled" : status === "Rendering" ? "Running" : "Queued",
  failure: (name: string, status: QueueJob["status"]) => status === "Cancelled" ? "Cancelled" : `${name} render failed — see logs for details`,
  queueNote: {
    local: "Queueing writes a JSONL job for the separate Python worker.",
    dispatch: "Queueing dispatches a GitHub Actions run that renders, checks, and publishes the output.",
    unavailable: "This deployment has no renderer configured, so it browses published outputs only.",
  },
} as const;

/**
 * One line describing what the renderer is doing right now, for the header
 * status pill that every tab shows.
 */
/** The chips that identify a variant, wherever it is shown. */
export function variantChips(variantId: string, variants: Variant[]): string[] {
  const variant = variants.find((candidate) => candidate.variantId === variantId);
  return variant ? [`Matrix ${variant.matrixIndex}`, variant.color, variant.band, variant.motion] : [];
}

/** How far along an unfinished take is, phrased as an estimate and never a countdown. */
export function renderProgressCopy(job: QueueJob, jobs: QueueJob[], mode: RenderMode, stats: RenderStats): string {
  if (mode === "local") return job.status === "Queued" ? queueAheadLabel(queuedJobsAhead(job.id, jobs)) : queueStrings.rendering;
  const elapsed = job.startedAt ? (Date.now() - new Date(job.startedAt).getTime()) / 1000 : 0;
  if (job.status === "Rendering") return `${renderEstimate(stats.medianRenderSeconds, stats.sampleSize, elapsed)} left`;
  return stats.sampleSize ? `Typically ${renderEstimate(stats.medianRenderSeconds, stats.sampleSize)} once started` : renderEstimate(null, 0);
}

/** Why a take did not become a master, in the plainest words available. */
export function renderFailureCopy(job: QueueJob, name: string): string {
  if (job.failure?.step) return queueStrings.failedAt(job.failure.step, job.failure.exitCode);
  return job.error ?? queueStrings.failure(name, job.status);
}

export function renderStatusSummary(activeCount: number, waitingCount: number, needsAttention = false): string {
  if (activeCount) return queueStrings.statusCaption.rendering(activeCount);
  if (waitingCount) return queueStrings.waitingCaption(waitingCount);
  if (needsAttention) return queueStrings.statusCaption.failed;
  return queueStrings.statusCaption.idle;
}
