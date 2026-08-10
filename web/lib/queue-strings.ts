import type { QueueJob } from "./types";

export const queueStrings = {
  title: "Queue",
  mode: { dispatch: "GitHub Actions", local: "Local worker", unavailable: "Browse only" },
  sections: { attention: "Needs attention", active: "Active", history: "History", today: "Today", yesterday: "Yesterday", week: "This week", earlier: "Earlier" },
  empty: { active: "Nothing rendering right now", attention: "Nothing needs attention" },
  status: { failed: "Failed", cancelled: "Cancelled", queued: "Queued", rendering: "Running", done: "Ready" },
  retry: { retry: "Retry", retried: "Retried ✓", cancel: "Cancel" },
  dismiss: { dismiss: "Dismiss", undo: "Undo", removed: "Dismissed", restored: "Restored" },
  start: {
    pilot: (count: number) => `Start pilot (${count})`,
    full: (count: number) => `Full matrix (${count})`,
    pilotCaption: (count: number) => `All ${count} pilot variants`,
    fullCaption: (count: number) => `All ${count} variants`,
    pilotTitle: (count: number) => `Queues the whole curated pilot set from config/variants_pilot.yaml — every pilot variant, regardless of what's selected on the Design tab. (${count} variants)`,
    fullTitle: (count: number) => `Renders every variant in config/variants.yaml, regardless of what's selected on the Design tab. (${count} variants)`,
    confirm: (count: number) => `Confirm ${count} renders`,
    confirmCaption: (count: number) => `Tap confirm to dispatch all ${count} renders.`,
  },
  logs: "View logs",
  library: "Open in Library",
  loading: "Checking the queue…",
  idle: "Queue idle",
  rendering: "Worker is rendering",
  queueStatus: {
    idle: "Idle",
    running: (count: number) => `Running ${count}`,
  },
  refresh: "Refresh queue",
  left: (value: string) => `${value} left`,
  typically: (value: string) => `Typically ${value} once started`,
  renderingCount: (count: number) => `${count} rendering`,
  queuedCount: (count: number) => `${count} queued`,
  remaining: (value: string) => `${value} remaining`,
  historyCount: (count: number) => `History (${count})`,
  clearAll: "Clear all",
  noRenderer: "Rendering isn't available on this deployment.",
  queueNote: {
    local: "Queueing writes a JSONL job for the separate Python worker.",
    dispatch: "Queueing dispatches a GitHub Actions run that renders, checks, and publishes the output.",
    unavailable: "This deployment has no renderer configured, so it browses published outputs only.",
  },
  fullRetry: (name: string) => `Re-render entire ${name}`,
  retryLabel: (name: string) => `Retry ${name}`,
  alreadyRetried: (name: string) => `${name} was already retried`,
  cancelRetry: (name: string) => `Cancel retrying ${name}`,
  dismissLabel: (name: string) => `Dismiss ${name}`,
  statusLabel: (status: QueueJob["status"]) => status === "Done" ? "Ready" : status === "Rendering" ? "Running" : status,
  attempts: (count: number) => `${count} attempts ›`,
  runHistory: (count: number) => `Run history · ${count}`,
  synced: (value: string) => `synced ${value}`,
  statusCaption: { idle: "Idle", queued: "Queued · waiting for runner", rendering: (count: number) => `Rendering · ${count} running` },
  failureSummary: (reason: string) => reason,
  failedAt: (step: string, exitCode?: number | null) => `Failed at step: ${step}${exitCode === null || exitCode === undefined ? "" : ` (exit ${exitCode})`}`,
  attempt: (number: number, time: string) => `Attempt ${number} · ${time} ago`,
  missingVariants: "Show variants",
  failure: (name: string, status: QueueJob["status"], missing: number | null, total: number | null) => {
    if (status === "Cancelled") return "Cancelled";
    const verb = "failed";
    if (missing !== null && total !== null) return missing
      ? `${name} render ${verb} — ${missing} of ${total} variants failed to render`
      : `${name} render ${verb} — all ${total} variants rendered; a full retry likely isn't needed`;
    return `${name} render ${verb} — see logs for details`;
  },
} as const;
