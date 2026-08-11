import type { FxBlock } from "./fx";
import type { QueueJob } from "./types";
import { median } from "./eta";

// A hosted console has no Audacity and no persistent disk, so rendering is
// delegated to a GitHub Actions runner that publishes to object storage.
export const DISPATCH_REPO = process.env.NOISE_DISPATCH_REPO;
export const DISPATCH_WORKFLOW = process.env.NOISE_DISPATCH_WORKFLOW ?? "render.yml";
export const DISPATCH_REF = process.env.NOISE_DISPATCH_REF ?? "main";
const DISPATCH_TOKEN = process.env.NOISE_DISPATCH_TOKEN;

export const DISPATCH_CONFIGURED = Boolean(DISPATCH_REPO && DISPATCH_TOKEN);

const API = "https://api.github.com";

function headers(): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${DISPATCH_TOKEN}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

export function runUrl(runId: number | string): string {
  return `https://github.com/${DISPATCH_REPO}/actions/runs/${runId}`;
}

export async function dispatchRender(variants: string, fx: FxBlock | null = null): Promise<void> {
  const response = await fetch(`${API}/repos/${DISPATCH_REPO}/actions/workflows/${DISPATCH_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ref: DISPATCH_REF, inputs: { variants, ...(fx ? { fx: JSON.stringify(fx) } : {}) } }),
  });
  if (!response.ok) {
    throw new Error(`GitHub refused the render dispatch (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

export async function dispatchMetadata(payload: string): Promise<void> {
  const response = await fetch(`${API}/repos/${DISPATCH_REPO}/actions/workflows/metadata.yml/dispatches`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ref: DISPATCH_REF, inputs: { payload } }),
  });
  if (!response.ok) {
    throw new Error(`GitHub refused the metadata dispatch (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  display_title: string;
  run_started_at?: string | null;
  updated_at?: string | null;
};

export type ActionsJob = {
  name?: string;
  started_at?: string | null;
  completed_at?: string | null;
  runner_name?: string | null;
  conclusion?: string | null;
  steps?: { name?: string; conclusion?: string | null; completed_at?: string | null }[];
};

export function parseFailureDetails(jobs: ActionsJob[]): QueueJob["failure"] {
  const failedJob = jobs.find((job) => job.conclusion === "failure" || job.conclusion === "cancelled") ?? jobs[0];
  if (!failedJob) return undefined;
  const failedStep = failedJob.steps?.find((step) => step.conclusion === "failure" || step.conclusion === "cancelled");
  const durationSeconds = failedJob.started_at && failedJob.completed_at
    ? Math.max(0, (new Date(failedJob.completed_at).getTime() - new Date(failedJob.started_at).getTime()) / 1000)
    : undefined;
  return { step: failedStep?.name, exitCode: null, durationSeconds, runner: failedJob.runner_name };
}

const STATUSES: Record<string, QueueJob["status"]> = {
  queued: "Queued",
  requested: "Queued",
  waiting: "Queued",
  pending: "Queued",
  in_progress: "Rendering",
};

function statusOf(run: WorkflowRun): QueueJob["status"] {
  if (run.status !== "completed") return STATUSES[run.status] ?? "Queued";
  return run.conclusion === "success" ? "Done" : run.conclusion === "cancelled" ? "Cancelled" : "Failed";
}

function errorForConclusion(conclusion: string | null): string {
  if (conclusion === "cancelled") return "Cancelled";
  if (conclusion === "failure") return "Render failed";
  if (conclusion === "timed_out") return "Timed out";
  return "Render did not complete";
}

// The workflow sets its run name to the requested variants, which is the only
// place GitHub surfaces dispatch inputs back to an API caller.
export async function dispatchedQueue(): Promise<{ jobs: QueueJob[]; stats: { medianRenderSeconds: number | null; sampleSize: number } }> {
  const response = await fetch(
    `${API}/repos/${DISPATCH_REPO}/actions/workflows/${DISPATCH_WORKFLOW}/runs?per_page=20`,
    { headers: headers(), cache: "no-store" },
  );
  if (!response.ok) return { jobs: [], stats: { medianRenderSeconds: null, sampleSize: 0 } };
  const body = (await response.json()) as { workflow_runs?: WorkflowRun[] };
  const jobs: QueueJob[] = (body.workflow_runs ?? []).map((run) => {
    const startedAt = run.run_started_at ?? undefined;
    const finishedAt = run.status === "completed" ? run.updated_at ?? undefined : undefined;
    const durationSeconds = startedAt && finishedAt
      ? Math.max(0, (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
      : undefined;
    const failed = run.conclusion && run.conclusion !== "success";
    return {
      id: String(run.id),
      variantId: run.display_title.replace(/^Render\s+/i, ""),
      status: statusOf(run),
      queuedAt: run.created_at,
      error: failed ? errorForConclusion(run.conclusion) : undefined,
      logsUrl: failed ? runUrl(run.id) : undefined,
      startedAt,
      finishedAt,
      durationSeconds,
    };
  });
  await Promise.all(jobs.filter((job) => job.status === "Failed" || job.status === "Cancelled").slice(0, 5).map(async (job) => {
    try {
      const response = await fetch(`${API}/repos/${DISPATCH_REPO}/actions/runs/${job.id}/jobs`, { headers: headers(), cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { jobs?: ActionsJob[] };
      job.failure = parseFailureDetails(body.jobs ?? []);
    } catch {
      // Details are supplemental; the queue itself remains usable.
    }
  }));
  const durations = jobs.filter((job) => job.status === "Done" && job.durationSeconds !== undefined).map((job) => job.durationSeconds!);
  return {
    jobs,
    stats: {
      medianRenderSeconds: median(durations),
      sampleSize: durations.length,
    },
  };
}
