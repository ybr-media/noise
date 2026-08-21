import type { LibraryTrack, QueueJob, Variant } from "./types";
import { knownVariantId } from "./eta";
import { partitionRenderJobs, type RenderJob } from "./render-jobs";

/**
 * A take that has been asked for but is not yet a file you can play — either
 * still with the runner, or failed outright.
 *
 * The Library's unit is the take, not the rendered file: a track you just
 * asked for should appear where it is going to land, immediately, rather than
 * only once it exists.
 */
export type PendingTake = {
  key: string;
  variantId: string;
  status: QueueJob["status"];
  job: QueueJob;
  attempts: number;
};

function toPendingTake(job: RenderJob): PendingTake {
  return {
    key: `${job.variantId}:${job.takeMarker ?? "-"}`,
    variantId: job.variantId,
    status: job.status,
    job: job.latest,
    attempts: job.attempts.length,
  };
}

function newestFirst(a: PendingTake, b: PendingTake): number {
  return new Date(b.job.queuedAt).getTime() - new Date(a.job.queuedAt).getTime()
    || b.job.id.localeCompare(a.job.id);
}

/**
 * The in-flight and failed takes the Library should show above its masters.
 *
 * Two kinds of job are deliberately left out, because a Library row is the
 * wrong shape for them and they stay reachable from the render activity view:
 *
 * - Batch jobs. A dispatched run's variantId can be `pilot` or `full`, so one
 *   job becomes many tracks — 144 pending rows is worse than one activity row.
 * - Failures for a variant that already has a playable master. The file is
 *   there; only the diagnostics are missing, and those are not Library content.
 */
export function pendingTakes(jobs: QueueJob[], variants: Variant[], tracks: LibraryTrack[]): PendingTake[] {
  const pilotMembers = variants.filter((variant) => variant.pilot !== null).map((variant) => variant.variantId);
  const fullMembers = variants.map((variant) => variant.variantId);
  const partition = partitionRenderJobs(jobs, pilotMembers, fullMembers);
  const rendered = new Set(tracks.filter((track) => track.exists).map((track) => track.variantId));
  const active = partition.active
    .filter((job) => knownVariantId(job.variantId, variants) !== null)
    .map(toPendingTake);
  const failed = partition.needsAttention
    .filter((job) => knownVariantId(job.variantId, variants) !== null && !rendered.has(job.variantId))
    .map(toPendingTake);
  return [...active, ...failed].sort(newestFirst);
}
