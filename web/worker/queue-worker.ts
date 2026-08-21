import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse, stringify } from "yaml";
import { CONFIG_PATH, RENDER_DIR } from "../lib/config";
import { QUEUE_PATH } from "../lib/queue";
import type { QueueJob } from "../lib/types";
import { notifyRenderComplete } from "../lib/render-notifications";
import { libraryTracks } from "../lib/library";

const intervalMs = Number(process.env.NOISE_WORKER_INTERVAL_MS ?? 2500);

function readJobs(): QueueJob[] {
  try {
    return fs.readFileSync(QUEUE_PATH, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as QueueJob);
  } catch { return []; }
}

function writeJobs(jobs: QueueJob[]) {
  fs.writeFileSync(QUEUE_PATH, jobs.map((job) => `${JSON.stringify(job)}\n`).join(""));
}

async function render(job: QueueJob): Promise<void> {
  const source = parse(fs.readFileSync(CONFIG_PATH, "utf8")) as { output: unknown; variants: Array<Record<string, unknown>> };
  const row = source.variants.find((candidate) => candidate.variant_id === job.variantId);
  if (!row) throw new Error(`Unknown variant ${job.variantId}`);
  const variant = job.fx ? { ...row, fx: job.fx } : row;
  const temporary = path.join(os.tmpdir(), `noise-lab-${job.id}.yaml`);
  fs.writeFileSync(temporary, stringify({ output: source.output, variants: [variant] }));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.NOISE_PYTHON ?? "python3", [
      path.resolve(process.cwd(), "..", "orchestrator.py"),
      "--variants-file", temporary,
      "--output-dir", RENDER_DIR,
      "--aup3-serializer",
      "--force",
    ], { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`orchestrator exited ${code}`)));
  }).finally(() => fs.rmSync(temporary, { force: true }));
}

async function drain() {
  const jobs = readJobs();
  const job = jobs.find((candidate) => candidate.status === "Queued");
  if (!job) return;
  job.status = "Rendering";
  writeJobs(jobs);
  try {
    await render(job);
    job.status = "Done";
    job.finishedAt = new Date().toISOString();
    delete job.error;
  } catch (error) {
    job.status = "Failed";
    job.error = error instanceof Error ? error.message : String(error);
  }
  writeJobs(jobs);
  if (job.status === "Done") {
    const requestedBy = job.requestedBy;
    try {
      const track = requestedBy
        ? (await libraryTracks()).find((candidate) => candidate.variantId === job.variantId && candidate.exists)
        : undefined;
      const status = requestedBy
        ? await notifyRenderComplete({
            kind: "render-complete",
            requestedBy,
            renderKeys: [track?.renderKey ?? job.variantId],
            runId: job.id,
            finishedAt: job.finishedAt ?? new Date().toISOString(),
          })
        : "skipped";
      if (!requestedBy) console.log(`[render-email] skipped ${job.id}: no requester`);
      else console.log(`[render-email] ${status} ${job.id}`);
    } catch (error) {
      console.error(`[render-email] failed ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(`Noise Lab worker watching ${QUEUE_PATH}`);
setInterval(() => void drain(), intervalMs);
void drain();
