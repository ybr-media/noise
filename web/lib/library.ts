import fs from "node:fs";
import path from "node:path";
import { RENDER_DIR, loadVariants } from "./config";
import type { LibraryTrack, QaCheck, Variant } from "./types";

type QaFile = {
  files?: Array<{
    filename?: string;
    checks?: QaCheck[];
  }>;
};

type Sidecar = Record<string, unknown>;

function sidecarFor(filename: string): Sidecar | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(RENDER_DIR, filename.replace(/\.wav$/, ".json")), "utf8")) as Sidecar;
  } catch {
    return null;
  }
}

function qaFor(filename: string): QaCheck[] {
  try {
    const report = JSON.parse(fs.readFileSync(path.join(RENDER_DIR, "qa_results.json"), "utf8")) as QaFile;
    return report.files?.find((item) => item.filename === filename)?.checks ?? [];
  } catch {
    return [];
  }
}

function renderStatusFor(variantId: string): string {
  try {
    const lines = fs.readFileSync(path.join(RENDER_DIR, "render_log.jsonl"), "utf8").trim().split("\n");
    const record = lines.map((line) => JSON.parse(line) as { variant_id?: string; exit_state?: string }).reverse()
      .find((item) => item.variant_id === variantId);
    return record?.exit_state ?? "Not rendered";
  } catch {
    return "Not rendered";
  }
}

function withSidecar(variant: Variant, sidecar: Sidecar | null): Variant {
  if (!sidecar) return variant;
  const cellSeconds = typeof sidecar.cell_seconds === "number" ? sidecar.cell_seconds : variant.durationSeconds;
  const repeats = typeof sidecar.repeats === "number" ? sidecar.repeats : 4;
  return {
    ...variant,
    durationSeconds: cellSeconds * repeats,
  };
}

export function libraryTracks(): LibraryTrack[] {
  return loadVariants().map((variant) => {
    const sidecar = sidecarFor(variant.filename);
    const resolved = withSidecar(variant, sidecar);
    const filePath = path.join(RENDER_DIR, variant.filename);
    const exists = fs.existsSync(filePath);
    const qaChecks = qaFor(variant.filename);
    const failed = qaChecks.some((check) => !check.passed);
    const lufs = qaChecks.find((check) => check.name === "Loudness")?.measured ?? null;
    const peak = qaChecks.find((check) => check.name === "True peak")?.measured ?? null;
    return {
      ...resolved,
      path: filePath,
      audioUrl: `/api/audio/${encodeURIComponent(variant.filename)}`,
      downloadUrl: `/api/audio/${encodeURIComponent(variant.filename)}?download=1`,
      exists,
      qaVerdict: !qaChecks.length ? "UNAVAILABLE" : failed ? "FAIL" : "PASS",
      qaChecks,
      measuredLufs: lufs,
      measuredTruePeak: peak,
      renderStatus: renderStatusFor(variant.variantId),
      title: typeof sidecar?.seo_title === "string" ? sidecar.seo_title : undefined,
      description: typeof sidecar?.seo_description === "string" ? sidecar.seo_description : undefined,
      titleApproved: sidecar?.seo_title_approved === true,
    };
  });
}

export function trackForFilename(filename: string): LibraryTrack | undefined {
  return libraryTracks().find((track) => track.filename === filename);
}
