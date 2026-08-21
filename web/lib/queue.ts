import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RenderOverrides } from "./config";
import type { FxBlock } from "./fx";
import type { QueueJob } from "./types";

export const QUEUE_PATH = process.env.NOISE_QUEUE_FILE ?? path.join(os.homedir(), "noisegen-out", "noise-lab-queue.jsonl");

function readJobs(): QueueJob[] {
  try {
    return fs.readFileSync(QUEUE_PATH, "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as QueueJob);
  } catch {
    return [];
  }
}

export function listJobs(): QueueJob[] {
  return readJobs().reverse();
}

export function enqueue(
  variantIds: string[],
  fx: FxBlock | null = null,
  overrides?: RenderOverrides,
  requestedBy?: string,
): QueueJob[] {
  // Each job carries its own deep copy of the FX block, so later edits in the
  // console can never mutate what an already-queued render will apply.
  const jobs = variantIds.map((variantId) => ({
    id: randomUUID(),
    variantId,
    status: "Queued" as const,
    queuedAt: new Date().toISOString(),
    ...(fx ? { fx: structuredClone(fx) } : {}),
    ...(overrides ?? {}),
    ...(requestedBy ? { requestedBy } : {}),
  }));
  fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
  fs.appendFileSync(QUEUE_PATH, jobs.map((job) => `${JSON.stringify(job)}\n`).join(""));
  return jobs;
}
