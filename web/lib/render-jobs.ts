import type { QueueJob } from "./types";
import { batchMembersForJob, isSuperseded, queueJobIdentity } from "./eta";

export type RenderJob = {
  variantId: string;
  takeMarker?: string;
  attempts: QueueJob[];
  latest: QueueJob;
  status: QueueJob["status"];
};

export type RenderJobPartition = {
  needsAttention: RenderJob[];
  active: RenderJob[];
  completed: RenderJob[];
  history: RenderJob[];
};

function newestFirst(a: QueueJob, b: QueueJob): number {
  const byTime = new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime();
  return byTime || b.id.localeCompare(a.id);
}

export function groupJobs(jobs: QueueJob[]): RenderJob[] {
  const grouped = new Map<string, QueueJob[]>();
  for (const job of jobs) {
    const identity = queueJobIdentity(job);
    grouped.set(identity, [...(grouped.get(identity) ?? []), job]);
  }
  return [...grouped.values()]
    .map((attempts) => {
      const ordered = attempts.sort(newestFirst);
      const latest = ordered[0];
      return { variantId: latest.variantId, takeMarker: latest.takeMarker, attempts: ordered, latest, status: latest.status };
    })
    .sort((a, b) => newestFirst(a.latest, b.latest));
}

export function partitionRenderJobs(
  jobs: QueueJob[],
  pilotMembers: string[],
  fullMembers: string[],
): RenderJobPartition {
  const grouped = groupJobs(jobs);
  return grouped.reduce((partition, job) => {
    if (job.status === "Queued" || job.status === "Rendering") partition.active.push(job);
    else if (job.status === "Done") partition.completed.push(job);
    else {
      const members = batchMembersForJob(job.latest, pilotMembers, fullMembers);
      (isSuperseded(job.latest, jobs, members) ? partition.history : partition.needsAttention).push(job);
    }
    return partition;
  }, { needsAttention: [], active: [], completed: [], history: [] } as RenderJobPartition);
}

export type CompletedDayBucket = {
  label: "Today" | "Yesterday" | "This week" | "Earlier";
  jobs: RenderJob[];
};

export function groupCompletedByDay(completedJobs: RenderJob[], now = new Date()): CompletedDayBucket[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const buckets: CompletedDayBucket[] = [
    { label: "Today", jobs: [] },
    { label: "Yesterday", jobs: [] },
    { label: "This week", jobs: [] },
    { label: "Earlier", jobs: [] },
  ];
  for (const job of completedJobs) {
    const date = new Date(job.latest.finishedAt ?? job.latest.queuedAt);
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const dayDifference = Math.floor((today.getTime() - day.getTime()) / 86_400_000);
    const bucket = dayDifference <= 0 ? buckets[0] : dayDifference === 1 ? buckets[1] : dayDifference < 7 ? buckets[2] : buckets[3];
    bucket.jobs.push(job);
  }
  return buckets.filter((bucket) => bucket.jobs.length > 0);
}
