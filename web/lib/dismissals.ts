import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DISPATCH_REF, DISPATCH_REPO, dispatchHeaders } from "./dispatch";
import { RENDER_MODE } from "./config";
import type { QueueJob } from "./types";

// A dismissed failure is archived server-side — a full snapshot of the job at
// the moment it was removed — so the record outlives both the browser and the
// GitHub last-20-runs window and stays reviewable from any device.
export type DismissalRecord = {
  job: QueueJob;
  dismissedAt: string;
};

export const DISMISSALS_PATH = process.env.NOISE_DISMISSALS_FILE
  ?? path.join(os.homedir(), "noisegen-out", "noise-lab-dismissals.jsonl");

// The hosted console has no persistent disk, so the archive lives as a JSON
// file committed to the dispatch repo through the same token used for renders.
export const DISMISSALS_REPO_PATH = process.env.NOISE_DISMISSALS_REPO_PATH ?? "web-state/queue-dismissals.json";

const API = "https://api.github.com";

function contentsUrl(): string {
  return `${API}/repos/${DISPATCH_REPO}/contents/${DISMISSALS_REPO_PATH}`;
}

async function readRepoArchive(): Promise<{ records: DismissalRecord[]; sha: string | null }> {
  const response = await fetch(`${contentsUrl()}?ref=${encodeURIComponent(DISPATCH_REF)}`, {
    headers: dispatchHeaders(),
    cache: "no-store",
  });
  if (response.status === 404) return { records: [], sha: null };
  if (!response.ok) {
    throw new Error(`GitHub refused the dismissal archive read (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const body = (await response.json()) as { content?: string; sha?: string };
  try {
    const decoded = Buffer.from(body.content ?? "", "base64").toString("utf8");
    return { records: (JSON.parse(decoded) as DismissalRecord[]) ?? [], sha: body.sha ?? null };
  } catch {
    return { records: [], sha: body.sha ?? null };
  }
}

async function writeRepoArchive(records: DismissalRecord[], sha: string | null, variantId: string): Promise<void> {
  const response = await fetch(contentsUrl(), {
    method: "PUT",
    headers: dispatchHeaders(),
    body: JSON.stringify({
      message: `Archive dismissed render ${variantId}`,
      content: Buffer.from(`${JSON.stringify(records, null, 2)}\n`).toString("base64"),
      branch: DISPATCH_REF,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub refused the dismissal archive write (${response.status}): ${(await response.text()).slice(0, 300)}`);
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

export async function archiveDismissal(job: QueueJob): Promise<DismissalRecord[]> {
  const record: DismissalRecord = { job, dismissedAt: new Date().toISOString() };
  if (RENDER_MODE === "dispatch") {
    const { records, sha } = await readRepoArchive();
    if (records.some((existing) => existing.job.id === job.id)) return newestFirst(records);
    const updated = [...records, record];
    await writeRepoArchive(updated, sha, job.variantId);
    return newestFirst(updated);
  }
  const records = readLocalArchive();
  if (records.some((existing) => existing.job.id === job.id)) return newestFirst(records);
  fs.mkdirSync(path.dirname(DISMISSALS_PATH), { recursive: true });
  fs.appendFileSync(DISMISSALS_PATH, `${JSON.stringify(record)}\n`);
  return newestFirst([...records, record]);
}
