import type { QueueJob } from "./types";

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

export async function dispatchRender(variants: string): Promise<void> {
  const response = await fetch(`${API}/repos/${DISPATCH_REPO}/actions/workflows/${DISPATCH_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ref: DISPATCH_REF, inputs: { variants } }),
  });
  if (!response.ok) {
    throw new Error(`GitHub refused the render dispatch (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  display_title: string;
};

const STATUSES: Record<string, QueueJob["status"]> = {
  queued: "Queued",
  requested: "Queued",
  waiting: "Queued",
  pending: "Queued",
  in_progress: "Rendering",
};

function statusOf(run: WorkflowRun): QueueJob["status"] {
  if (run.status !== "completed") return STATUSES[run.status] ?? "Queued";
  return run.conclusion === "success" ? "Done" : "Failed";
}

// The workflow sets its run name to the requested variants, which is the only
// place GitHub surfaces dispatch inputs back to an API caller.
export async function dispatchedJobs(): Promise<QueueJob[]> {
  const response = await fetch(
    `${API}/repos/${DISPATCH_REPO}/actions/workflows/${DISPATCH_WORKFLOW}/runs?per_page=20`,
    { headers: headers(), cache: "no-store" },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { workflow_runs?: WorkflowRun[] };
  return (body.workflow_runs ?? []).map((run) => ({
    id: String(run.id),
    variantId: run.display_title.replace(/^Render\s+/i, ""),
    status: statusOf(run),
    queuedAt: run.created_at,
    error: run.conclusion && run.conclusion !== "success" ? `Workflow ${run.conclusion} — ${runUrl(run.id)}` : undefined,
  }));
}
