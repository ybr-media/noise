import { loadVariants } from "./config";
import { artifactIndex, artifactUrl } from "./artifacts";
import type { LibraryTrack, Variant } from "./types";

type Sidecar = Record<string, unknown>;

function withSidecar(variant: Variant, sidecar: Sidecar | null): Variant {
  if (!sidecar) return variant;
  const cellSeconds = typeof sidecar.cell_seconds === "number" ? sidecar.cell_seconds : variant.durationSeconds;
  const repeats = typeof sidecar.repeats === "number" ? sidecar.repeats : 4;
  return {
    ...variant,
    durationSeconds: cellSeconds * repeats,
  };
}

export async function libraryTracks(): Promise<LibraryTrack[]> {
  const index = await artifactIndex();
  return loadVariants().map((variant) => {
    const artifact = index.artifacts.get(variant.filename);
    const sidecar = artifact?.sidecar ?? null;
    const resolved = withSidecar(variant, sidecar);
    const qaChecks = artifact?.qaChecks ?? [];
    const failed = qaChecks.some((check) => !check.passed);
    const lufs = qaChecks.find((check) => check.name === "Loudness")?.measured ?? null;
    const peak = qaChecks.find((check) => check.name === "True peak")?.measured ?? null;
    return {
      ...resolved,
      path: artifactUrl(variant.filename),
      audioUrl: `/api/audio/${encodeURIComponent(variant.filename)}`,
      downloadUrl: `/api/audio/${encodeURIComponent(variant.filename)}?download=1`,
      exists: Boolean(artifact),
      qaVerdict: !qaChecks.length ? "UNAVAILABLE" : failed ? "FAIL" : "PASS",
      qaChecks,
      measuredLufs: lufs,
      measuredTruePeak: peak,
      renderStatus: artifact?.renderStatus ?? "Not rendered",
      title: typeof sidecar?.seo_title === "string" ? sidecar.seo_title : undefined,
      description: typeof sidecar?.seo_description === "string" ? sidecar.seo_description : undefined,
      titleApproved: sidecar?.seo_title_approved === true,
    };
  });
}

export async function trackForFilename(filename: string): Promise<LibraryTrack | undefined> {
  return (await libraryTracks()).find((track) => track.filename === filename);
}
