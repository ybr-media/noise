import fs from "node:fs";
import path from "node:path";
import { RENDER_DIR } from "./config";
import type { QaCheck } from "./types";

// Rendered output can either sit beside the engine on a local disk or be
// published to object storage, which is the only option for a hosted console
// since Audacity and the renders never reach it.
export const ARTIFACTS_BASE_URL = process.env.NOISE_ARTIFACTS_BASE_URL?.replace(/\/+$/, "");
export const ARTIFACTS_ARE_REMOTE = Boolean(ARTIFACTS_BASE_URL);
export const MANIFEST_NAME = "manifest.json";

const MANIFEST_TTL_MS = Number(process.env.NOISE_MANIFEST_TTL_MS ?? 30_000);

export type Artifact = {
  filename: string;
  sizeBytes: number;
  sidecar: Record<string, unknown> | null;
  qaChecks: QaCheck[];
  renderStatus: string;
};

export type ArtifactIndex = {
  origin: string;
  artifacts: Map<string, Artifact>;
};

type QaFile = { files?: Array<{ filename?: string; checks?: QaCheck[] }> };

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function localRenderStatuses(): Map<string, string> {
  const statuses = new Map<string, string>();
  let lines: string[];
  try {
    lines = fs.readFileSync(path.join(RENDER_DIR, "render_log.jsonl"), "utf8").trim().split("\n");
  } catch {
    return statuses;
  }
  // Later entries supersede earlier ones for the same variant.
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as { variant_id?: string; exit_state?: string };
      if (record.variant_id && record.exit_state) statuses.set(record.variant_id, record.exit_state);
    } catch {
      continue;
    }
  }
  return statuses;
}

function localIndex(): ArtifactIndex {
  const qa = readJson<QaFile>(path.join(RENDER_DIR, "qa_results.json"));
  const statuses = localRenderStatuses();
  const artifacts = new Map<string, Artifact>();
  let entries: string[];
  try {
    entries = fs.readdirSync(RENDER_DIR).filter((entry) => entry.endsWith(".wav"));
  } catch {
    entries = [];
  }
  for (const filename of entries) {
    const sidecar = readJson<Record<string, unknown>>(path.join(RENDER_DIR, filename.replace(/\.wav$/, ".json")));
    const variantId = typeof sidecar?.variant_id === "string" ? sidecar.variant_id : "";
    artifacts.set(filename, {
      filename,
      sizeBytes: fs.statSync(path.join(RENDER_DIR, filename)).size,
      sidecar,
      qaChecks: qa?.files?.find((item) => item.filename === filename)?.checks ?? [],
      renderStatus: statuses.get(variantId) ?? "Not rendered",
    });
  }
  return { origin: RENDER_DIR, artifacts };
}

type RemoteManifest = { artifacts?: Artifact[] };

let cached: { index: ArtifactIndex; at: number } | null = null;

async function remoteIndex(baseUrl: string): Promise<ArtifactIndex> {
  if (cached && Date.now() - cached.at < MANIFEST_TTL_MS) return cached.index;
  const artifacts = new Map<string, Artifact>();
  const index: ArtifactIndex = { origin: baseUrl, artifacts };
  const response = await fetch(`${baseUrl}/${MANIFEST_NAME}`, { cache: "no-store" });
  // A missing manifest means nothing has been published yet, which the library
  // already renders as an unrendered matrix.
  if (response.ok) {
    const manifest = (await response.json()) as RemoteManifest;
    for (const artifact of manifest.artifacts ?? []) {
      artifacts.set(artifact.filename, {
        filename: artifact.filename,
        sizeBytes: artifact.sizeBytes ?? 0,
        sidecar: artifact.sidecar ?? null,
        qaChecks: artifact.qaChecks ?? [],
        renderStatus: artifact.renderStatus ?? "Not rendered",
      });
    }
  }
  cached = { index, at: Date.now() };
  return index;
}

export async function artifactIndex(): Promise<ArtifactIndex> {
  return ARTIFACTS_BASE_URL ? remoteIndex(ARTIFACTS_BASE_URL) : localIndex();
}

export function artifactUrl(filename: string): string {
  return ARTIFACTS_BASE_URL
    ? `${ARTIFACTS_BASE_URL}/${encodeURIComponent(filename)}`
    : path.join(RENDER_DIR, filename);
}
