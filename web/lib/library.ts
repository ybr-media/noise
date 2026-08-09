import { loadVariants } from "./config";
import { artifactIndex, artifactUrl } from "./artifacts";
import type { ArtifactIndex } from "./artifacts";
import type { LibraryTrack, TrackStem, Variant } from "./types";

type Sidecar = Record<string, unknown>;

const audioUrls = (filename: string) => ({
  audioUrl: `/api/audio/${encodeURIComponent(filename)}`,
  downloadUrl: `/api/audio/${encodeURIComponent(filename)}?download=1`,
});

// The master's sidecar names its stems and what each one is, so the console
// never has to reconstruct the naming scheme itself.
function stemsOf(sidecar: Sidecar | null, index: ArtifactIndex): TrackStem[] {
  const filenames = Array.isArray(sidecar?.stem_filenames) ? sidecar.stem_filenames : [];
  const roles = (sidecar?.stem_map ?? {}) as Record<string, unknown>;
  return filenames.flatMap((filename, position) => {
    if (typeof filename !== "string") return [];
    const role = `stem_${position + 1}`;
    return [{
      filename,
      number: position + 1,
      stem: typeof roles[role] === "string" ? (roles[role] as string) : role,
      exists: index.artifacts.has(filename),
      ...audioUrls(filename),
    }];
  });
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

export async function libraryTracks(releaseTitles: Map<string, { title: string; description: string }> = new Map()): Promise<LibraryTrack[]> {
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
      ...audioUrls(variant.filename),
      exists: Boolean(artifact),
      stems: stemsOf(sidecar, index),
      qaVerdict: !qaChecks.length ? "UNAVAILABLE" : failed ? "FAIL" : "PASS",
      qaChecks,
      measuredLufs: lufs,
      measuredTruePeak: peak,
      renderStatus: artifact?.renderStatus ?? "Not rendered",
      title: releaseTitles.get(variant.variantId)?.title || (typeof sidecar?.seo_title === "string" ? sidecar.seo_title : undefined),
      description: releaseTitles.get(variant.variantId)?.description || (typeof sidecar?.seo_description === "string" ? sidecar.seo_description : undefined),
      titleApproved: sidecar?.seo_title_approved === true,
    };
  });
}

export type AudioAsset = { filename: string; exists: boolean; isMaster: boolean };

/** Resolve a served filename to a variant's master or to one of its stems. */
export async function audioAsset(filename: string): Promise<AudioAsset | undefined> {
  for (const track of await libraryTracks()) {
    if (track.filename === filename) return { filename, exists: track.exists, isMaster: true };
    const stem = track.stems.find((candidate) => candidate.filename === filename);
    if (stem) return { filename, exists: stem.exists, isMaster: false };
  }
  return undefined;
}
