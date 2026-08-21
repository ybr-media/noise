import type { QueueJob } from "./types";

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
  statusCaption: { idle: "Idle", queued: "Queued · waiting for runner", rendering: (count: number) => `Rendering · ${count} running` },
  waitingCaption: (count: number) => count > 1 ? `Queued · ${count} waiting` : "Queued · waiting for runner",
  rendering: "Worker is rendering",
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
export function renderStatusSummary(activeCount: number, waitingCount: number): string {
  if (activeCount) return queueStrings.statusCaption.rendering(activeCount);
  if (waitingCount) return queueStrings.waitingCaption(waitingCount);
  return queueStrings.statusCaption.idle;
}
