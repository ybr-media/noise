import { loadVariants } from "./config";
import { artifactIndex, artifactUrl } from "./artifacts";
import type { ArtifactIndex } from "./artifacts";
import { sanitizeFxBlock } from "./fx";
import type { LibraryRecipe, LibraryTrack, TrackStem, Variant } from "./types";

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
      sizeBytes: index.artifacts.get(filename)?.sizeBytes ?? 0,
      number: position + 1,
      stem: typeof roles[role] === "string" ? (roles[role] as string) : role,
      exists: index.artifacts.has(filename),
      ...audioUrls(filename),
    }];
  });
}

const SIDECAR_SEED_KEYS = ["bed_l", "bed_r", "texture_l", "texture_r", "motion_l", "motion_r"] as const;

function numberValue(value: unknown, fallback: number | null | undefined): number | null | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string | null = null): string | null {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function sidecarSeeds(sidecar: Sidecar, fallback: Record<string, number>): Record<string, number> {
  if (Array.isArray(sidecar.seeds)) {
    const values = sidecar.seeds.filter((seed): seed is number => typeof seed === "number" && Number.isFinite(seed));
    if (values.length === SIDECAR_SEED_KEYS.length) {
      return Object.fromEntries(SIDECAR_SEED_KEYS.map((key, index) => [key, values[index]]));
    }
  }
  if (sidecar.seeds && typeof sidecar.seeds === "object") {
    const values = Object.fromEntries(Object.entries(sidecar.seeds).filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
    if (Object.keys(values).length) return values;
  }
  return fallback;
}

function sidecarGains(sidecar: Sidecar, fallback: Variant["gainsDb"]): Variant["gainsDb"] {
  const gains = sidecar.per_stem_gains;
  if (!gains || typeof gains !== "object") return fallback;
  const source = gains as Record<string, unknown>;
  return {
    bed: numberValue(source.bed, fallback.bed) ?? fallback.bed,
    motion: numberValue(source.motion, fallback.motion) ?? fallback.motion,
    texture: numberValue(source.texture, fallback.texture) ?? fallback.texture,
  };
}

function withSidecar(variant: Variant, sidecar: Sidecar | null): Variant {
  if (!sidecar) return variant;
  const cellSeconds = numberValue(sidecar.cell_seconds, variant.cellSeconds ?? variant.durationSeconds / (variant.repeats ?? 4)) ?? variant.durationSeconds / (variant.repeats ?? 4);
  const repeats = numberValue(sidecar.repeats, variant.repeats ?? 4) ?? variant.repeats ?? 4;
  return {
    ...variant,
    durationSeconds: cellSeconds * repeats,
  };
}

export function deriveRecipe(variant: Variant, sidecar: Sidecar | null, renderedAt: string | null = null): LibraryRecipe {
  const source = sidecar ?? {};
  const has = (key: string) => sidecar !== null && Object.prototype.hasOwnProperty.call(sidecar, key);
  const color = source.color === "white" || source.color === "green" || source.color === "pink" || source.color === "brown" ? source.color : variant.color;
  const band = source.band === "low-mid" || source.band === "mid" || source.band === "high" || source.band === "broad" ? source.band : variant.band;
  const motion = source.motion === "still" || source.motion === "drift" || source.motion === "breathing" ? source.motion : variant.motion;
  const balance = source.balance === "bed-forward" || source.balance === "balanced" || source.balance === "texture-forward" ? source.balance : variant.balance;
  const fx = sanitizeFxBlock(source.fx);
  const bell = has("bell")
    ? source.bell && typeof source.bell === "object"
      ? {
          gainDb: numberValue((source.bell as Record<string, unknown>).gain_db, variant.spectrum.bell?.gainDb ?? 0) ?? 0,
          centerHz: numberValue((source.bell as Record<string, unknown>).center_hz, variant.spectrum.bell?.centerHz ?? 0) ?? 0,
          q: numberValue((source.bell as Record<string, unknown>).q, variant.spectrum.bell?.q ?? 0) ?? 0,
        }
      : null
    : variant.spectrum.bell;
  const cellSeconds = numberValue(source.cell_seconds, variant.cellSeconds) ?? variant.durationSeconds / (variant.repeats ?? 4);
  const repeats = numberValue(source.repeats, variant.repeats) ?? 4;
  return {
    color: color as LibraryRecipe["color"],
    band: band as LibraryRecipe["band"],
    motion: motion as LibraryRecipe["motion"],
    balance: balance as LibraryRecipe["balance"],
    bandLowHz: numberValue(source.band_low_hz, variant.bandLowHz) ?? variant.bandLowHz,
    bandHighHz: numberValue(source.band_high_hz, variant.bandHighHz) ?? variant.bandHighHz,
    lfoDepth: numberValue(source.lfo_depth, variant.lfoDepth) ?? variant.lfoDepth,
    lfoRateHz: numberValue(source.lfo_rate_hz, variant.lfoRateHz) ?? variant.lfoRateHz,
    gainsDb: sidecarGains(source, variant.gainsDb),
    seeds: sidecarSeeds(source, variant.seeds),
    tiltDbPerOct: numberValue(source.tilt_db_per_oct, variant.spectrum.tiltDbPerOct) ?? variant.spectrum.tiltDbPerOct,
    bell,
    eq: fx?.eq ?? null,
    reverb: fx?.reverb ?? null,
    fxRecorded: has("fx") && (source.fx === null || fx !== null),
    cellSeconds,
    repeats,
    fadeSeconds: sidecar === null
      ? variant.fadeSeconds ?? null
      : has("fade_seconds")
        ? numberValue(source.fade_seconds, null) ?? null
        : null,
    sampleRate: numberValue(source.sample_rate, variant.sampleRate) ?? variant.sampleRate,
    bitDepth: sidecar === null
      ? variant.bitDepth ?? null
      : has("bit_depth")
        ? numberValue(source.bit_depth, null) ?? null
        : null,
    targetLufs: numberValue(source.target_lufs, variant.targetLufs) ?? variant.targetLufs,
    truePeakMaxDbtp: numberValue(source.true_peak_max_dbtp, variant.truePeakMaxDbtp) ?? variant.truePeakMaxDbtp,
    tailSeconds: numberValue(source.tail_seconds, null) ?? null,
    audacityVersion: stringValue(source.audacity_version),
    renderedAt: stringValue(source.render_timestamp, renderedAt),
  };
}

export async function libraryTracks(releaseTitles: Map<string, { title: string; description: string }> = new Map()): Promise<LibraryTrack[]> {
  const index = await artifactIndex();
  const tracks = loadVariants().map((variant): LibraryTrack => {
    const artifact = index.artifacts.get(variant.filename);
    const sidecar = artifact?.sidecar && typeof artifact.sidecar === "object" ? artifact.sidecar : null;
    const resolved = withSidecar(variant, sidecar);
    const recipe = deriveRecipe(variant, sidecar, typeof sidecar?.render_timestamp === "string" ? sidecar.render_timestamp : null);
    const qaChecks = artifact?.qaChecks ?? [];
    const failed = qaChecks.some((check) => !check.passed);
    const lufs = qaChecks.find((check) => check.name === "Loudness")?.measured ?? null;
    const peak = qaChecks.find((check) => check.name === "True peak")?.measured ?? null;
    return {
      ...resolved,
      recipe,
      path: artifactUrl(variant.filename),
      sizeBytes: artifact?.sizeBytes ?? 0,
      ...audioUrls(variant.filename),
      exists: Boolean(artifact),
      stems: stemsOf(sidecar, index),
      qaVerdict: !qaChecks.length ? "UNAVAILABLE" : failed ? "FAIL" : "PASS",
      qaChecks,
      measuredLufs: lufs,
      measuredTruePeak: peak,
      renderStatus: artifact?.renderStatus ?? "Not rendered",
      renderedAt: typeof sidecar?.render_timestamp === "string" ? sidecar.render_timestamp : null,
      title: releaseTitles.get(variant.variantId)?.title || (typeof sidecar?.seo_title === "string" ? sidecar.seo_title : undefined),
      description: releaseTitles.get(variant.variantId)?.description || (typeof sidecar?.seo_description === "string" ? sidecar.seo_description : undefined),
      titleApproved: sidecar?.seo_title_approved === true,
    };
  });
  // Newest renders first; undated tracks keep their matrix order at the end.
  return tracks.sort((a, b) => {
    if (a.renderedAt && b.renderedAt) {
      const delta = new Date(b.renderedAt).getTime() - new Date(a.renderedAt).getTime();
      if (delta) return delta;
      return a.matrixIndex - b.matrixIndex;
    }
    if (a.renderedAt !== b.renderedAt) return a.renderedAt ? -1 : 1;
    return a.matrixIndex - b.matrixIndex;
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

export type BundleAssets = { master: LibraryTrack; stems: TrackStem[] };

export async function bundleAssets(variantId: string): Promise<BundleAssets | undefined> {
  const track = (await libraryTracks()).find((candidate) => candidate.variantId === variantId);
  if (!track?.exists) return undefined;
  return { master: track, stems: track.stems.filter((stem) => stem.exists) };
}
