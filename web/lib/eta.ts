import type { LibraryTrack, QueueJob, Variant } from "./types";
import { newestTracksByVariant } from "./track-map";

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
  return formatMinutes(Math.max(60, medianSeconds - (elapsedSeconds ?? 0)));
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

export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const [datePart, timePart] = date.toISOString().split("T");
  return `${datePart} ${timePart.slice(0, 8)} UTC`;
}

export function hasRepeatedVariant(job: QueueJob, jobs: QueueJob[]): boolean {
  return jobs.some((candidate) => candidate.id !== job.id && candidate.variantId === job.variantId);
}

export function attemptNumber(job: QueueJob, jobs: QueueJob[]): number {
  return jobs
    .filter((candidate) => candidate.variantId === job.variantId)
    .sort((a, b) => {
      const byTime = new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime();
      return byTime || a.id.localeCompare(b.id);
    })
    .findIndex((candidate) => candidate.id === job.id) + 1;
}

function isNewer(candidate: QueueJob, job: QueueJob): boolean {
  const candidateTime = new Date(candidate.queuedAt).getTime();
  const queuedAt = new Date(job.queuedAt).getTime();
  return candidateTime > queuedAt || (candidateTime === queuedAt && candidate.id > job.id);
}

export function isSuperseded(job: QueueJob, jobs: QueueJob[], batchMembers?: string[]): boolean {
  if (batchMembers) {
    if (batchMembers.length === 0) return false;
    return batchMembers.every((member) =>
      jobs.some((candidate) => candidate.variantId === member && isNewer(candidate, job)),
    );
  }
  return jobs.some(
    (candidate) =>
      candidate.variantId === job.variantId &&
      candidate.id !== job.id &&
      isNewer(candidate, job),
  );
}

export function batchMembersForJob(job: QueueJob, pilotMembers: string[], fullMembers: string[]): string[] | undefined {
  return job.variantId === "pilot" ? pilotMembers : job.variantId === "full" ? fullMembers : undefined;
}

export type BatchMissingMastersSummary = {
  total: number;
  missingVariantIds: string[];
};

export function batchMissingMastersSummary(
  batchMembers: string[] | undefined,
  tracks: LibraryTrack[],
): BatchMissingMastersSummary | null {
  if (!batchMembers || batchMembers.length === 0 || tracks.length === 0) return null;
  const byId = newestTracksByVariant(tracks);
  return {
    total: batchMembers.length,
    missingVariantIds: batchMembers.filter((member) => !byId.get(member)?.exists),
  };
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
