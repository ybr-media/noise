import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse, stringify } from "yaml";
import { CONFIG_PATH, RENDER_DIR } from "../lib/config";
import type { QueueJob } from "../lib/types";

const queuePath = process.env.NOISE_QUEUE_FILE ?? path.join("/tmp", "noise-lab-queue.jsonl");
const intervalMs = Number(process.env.NOISE_WORKER_INTERVAL_MS ?? 2500);

function readJobs(): QueueJob[] {
  try {
    return fs.readFileSync(queuePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as QueueJob);
  } catch { return []; }
}

function writeJobs(jobs: QueueJob[]) {
  fs.writeFileSync(queuePath, jobs.map((job) => `${JSON.stringify(job)}\n`).join(""));
}

async function render(job: QueueJob): Promise<void> {
  const source = parse(fs.readFileSync(CONFIG_PATH, "utf8")) as { output: unknown; variants: Array<Record<string, unknown>> };
  const row = source.variants.find((candidate) => candidate.variant_id === job.variantId);
  if (!row) throw new Error(`Unknown variant ${job.variantId}`);
  const temporary = path.join(os.tmpdir(), `noise-lab-${job.id}.yaml`);
  fs.writeFileSync(temporary, stringify({ output: source.output, variants: [row] }));
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
    delete job.error;
  } catch (error) {
    job.status = "Failed";
    job.error = error instanceof Error ? error.message : String(error);
  }
  writeJobs(jobs);
}

console.log(`Noise Lab worker watching ${queuePath}`);
setInterval(() => void drain(), intervalMs);
void drain();
