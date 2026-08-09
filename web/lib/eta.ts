import type { QueueJob, Variant } from "./types";

export const DEFAULT_RENDER_ESTIMATE_RANGE = "5–10 min";

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function formatMinutes(seconds: number): string {
  return `~${Math.max(1, Math.ceil(seconds / 60))} min`;
}

export function renderEstimate(medianSeconds: number | null, sampleSize: number, elapsedSeconds?: number): string {
  if (!sampleSize || medianSeconds === null) return `First render — typically ${DEFAULT_RENDER_ESTIMATE_RANGE}`;
  return `${formatMinutes(Math.max(60, medianSeconds - (elapsedSeconds ?? 0)))} left`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function knownVariantId(variantId: string, variants: Variant[]): string | null {
  return variants.some((variant) => variant.variantId === variantId) ? variantId : null;
}

export function queuedJobsAhead(jobId: string, jobs: QueueJob[]): number {
  const workerOrder = jobs.filter((job) => job.status === "Queued").reverse();
  return Math.max(0, workerOrder.findIndex((job) => job.id === jobId));
}

export function queueAheadLabel(ahead: number): string {
  return ahead === 0 ? "Next" : `${ahead} job${ahead === 1 ? "" : "s"} ahead`;
}
