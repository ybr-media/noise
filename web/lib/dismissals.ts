import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DISPATCH_REF, DISPATCH_REPO, dispatchHeaders } from "./dispatch";
import { RENDER_MODE } from "./config";
import type { QueueJob } from "./types";

// A dismissed failure is archived server-side — a full snapshot of the job at
// the moment it was removed — so the record outlives both the browser and the
// GitHub last-20-runs window and stays reviewable from any device. Archiving
// also queues deletion of the variants' published R2 artifacts; `r2Cleanup`
// records whether that deletion run was dispatched.
export type R2Cleanup = { state: "queued" | "failed" | "unavailable"; queuedAt: string };

export type DismissalRecord = {
  job: QueueJob;
  dismissedAt: string;
  r2Cleanup?: R2Cleanup;
};

export const DISMISSALS_PATH = process.env.NOISE_DISMISSALS_FILE
  ?? path.join(os.homedir(), "noisegen-out", "noise-lab-dismissals.jsonl");

// The hosted console has no persistent disk, so the archive lives as a JSON
// file committed to the dispatch repo. The dispatch token only carries the
// Actions scope (contents PUTs come back 403), so writes are delegated to a
// workflow that commits with its own repo-scoped token, mirroring how renders
// and cleanup runs are dispatched.
export const DISMISSALS_REPO_PATH = process.env.NOISE_DISMISSALS_REPO_PATH ?? "web-state/queue-dismissals.json";
export const DISMISSALS_WORKFLOW = process.env.NOISE_DISMISSALS_WORKFLOW ?? "archive-dismissal.yml";

const API = "https://api.github.com";

function contentsUrl(): string {
  return `${API}/repos/${DISPATCH_REPO}/contents/${DISMISSALS_REPO_PATH}`;
}

async function readRepoArchive(): Promise<{ records: DismissalRecord[] }> {
  const response = await fetch(`${contentsUrl()}?ref=${encodeURIComponent(DISPATCH_REF)}`, {
    headers: dispatchHeaders(),
    cache: "no-store",
  });
  if (response.status === 404) return { records: [] };
  if (!response.ok) {
    throw new Error(`GitHub refused the dismissal archive read (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const body = (await response.json()) as { content?: string };
  try {
    const decoded = Buffer.from(body.content ?? "", "base64").toString("utf8");
    return { records: (JSON.parse(decoded) as DismissalRecord[]) ?? [] };
  } catch {
    return { records: [] };
  }
}

async function dispatchArchiveWrite(record: DismissalRecord): Promise<void> {
  const response = await fetch(`${API}/repos/${DISPATCH_REPO}/actions/workflows/${DISMISSALS_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: dispatchHeaders(),
    body: JSON.stringify({ ref: DISPATCH_REF, inputs: { record: JSON.stringify(record) } }),
  });
  if (!response.ok) {
    throw new Error(`GitHub refused the dismissal archive dispatch (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

function readLocalArchive(): DismissalRecord[] {
  try {
    return fs.readFileSync(DISMISSALS_PATH, "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as DismissalRecord);
  } catch {
    return [];
  }
}

// The store is append-only, so reversing before the (stable) sort keeps the
// later of two same-timestamp dismissals first.
function newestFirst(records: DismissalRecord[]): DismissalRecord[] {
  return [...records].reverse().sort((a, b) => new Date(b.dismissedAt).getTime() - new Date(a.dismissedAt).getTime());
}

export async function listDismissals(): Promise<DismissalRecord[]> {
  if (RENDER_MODE === "dispatch") return newestFirst((await readRepoArchive()).records);
  return newestFirst(readLocalArchive());
}

export async function archiveDismissal(job: QueueJob, r2Cleanup?: R2Cleanup): Promise<DismissalRecord[]> {
  const record: DismissalRecord = { job, dismissedAt: new Date().toISOString(), ...(r2Cleanup ? { r2Cleanup } : {}) };
  if (RENDER_MODE === "dispatch") {
    const { records } = await readRepoArchive();
    if (records.some((existing) => existing.job.id === job.id)) return newestFirst(records);
    // The commit lands asynchronously (and the workflow dedupes by job id), so
    // the returned list includes the new record optimistically.
    await dispatchArchiveWrite(record);
    return newestFirst([...records, record]);
  }
  const records = readLocalArchive();
  if (records.some((existing) => existing.job.id === job.id)) return newestFirst(records);
  fs.mkdirSync(path.dirname(DISMISSALS_PATH), { recursive: true });
  fs.appendFileSync(DISMISSALS_PATH, `${JSON.stringify(record)}\n`);
  return newestFirst([...records, record]);
}
