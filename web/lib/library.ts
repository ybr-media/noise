import { loadVariants } from "./config";
import { artifactIndex, artifactUrl } from "./artifacts";
import type { Artifact, ArtifactIndex } from "./artifacts";
import { sanitizeFxBlock } from "./fx";
import type { Band, Balance, Color, LibraryRecipe, LibraryTrack, Motion, TrackStem, Variant } from "./types";

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

function sidecarOf(artifact: Artifact): Sidecar | null {
  return artifact.sidecar && typeof artifact.sidecar === "object" && !Array.isArray(artifact.sidecar)
    ? artifact.sidecar
    : null;
}

function isMasterFilename(filename: string): boolean {
  return /^[\w.-]+_master\.wav$/.test(filename);
}

function renderKeyOf(filename: string): string {
  return filename.slice(0, -"_master.wav".length);
}

const SIDECAR_SEED_KEYS = ["bed_l", "bed_r", "texture_l", "texture_r", "motion_l", "motion_r"] as const;

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown, fallback: string | null = null): string | null {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function valueOf<T extends string>(value: unknown, values: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && values.has(value as T) ? value as T : fallback;
}

const COLOR_VALUES = new Set<Color>(["white", "green", "pink", "brown"]);
const BAND_VALUES = new Set<Band>(["low-mid", "mid", "high", "broad"]);
const MOTION_VALUES = new Set<Motion>(["still", "drift", "breathing"]);
const BALANCE_VALUES = new Set<Balance>(["bed-forward", "balanced", "texture-forward"]);

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
    bed: numberValue(source.bed, fallback.bed),
    motion: numberValue(source.motion, fallback.motion),
    texture: numberValue(source.texture, fallback.texture),
  };
}

function withSidecar(variant: Variant, sidecar: Sidecar | null): Variant {
  if (!sidecar) return variant;
  const cellSeconds = numberValue(sidecar.cell_seconds, variant.cellSeconds);
  const repeats = numberValue(sidecar.repeats, variant.repeats);
  return {
    ...variant,
    durationSeconds: cellSeconds * repeats,
  };
}

export function deriveRecipe(variant: Variant, sidecar: Sidecar | null, renderedAt: string | null = null): LibraryRecipe {
  const source = sidecar ?? {};
  const has = (key: string) => sidecar !== null && Object.prototype.hasOwnProperty.call(sidecar, key);
  const color = valueOf(source.color, COLOR_VALUES, variant.color);
  const band = valueOf(source.band, BAND_VALUES, variant.band);
  const motion = valueOf(source.motion, MOTION_VALUES, variant.motion);
  const balance = valueOf(source.balance, BALANCE_VALUES, variant.balance);
  const fx = sanitizeFxBlock(source.fx);
  const bell = has("bell")
    ? source.bell && typeof source.bell === "object"
      ? {
          gainDb: numberValue((source.bell as Record<string, unknown>).gain_db, variant.spectrum.bell?.gainDb ?? 0),
          centerHz: numberValue((source.bell as Record<string, unknown>).center_hz, variant.spectrum.bell?.centerHz ?? 0),
          q: numberValue((source.bell as Record<string, unknown>).q, variant.spectrum.bell?.q ?? 0),
        }
      : null
    : variant.spectrum.bell;
  const cellSeconds = numberValue(source.cell_seconds, variant.cellSeconds);
  const repeats = numberValue(source.repeats, variant.repeats);
  return {
    color,
    band,
    motion,
    balance,
    bandLowHz: numberValue(source.band_low_hz, variant.bandLowHz),
    bandHighHz: numberValue(source.band_high_hz, variant.bandHighHz),
    lfoDepth: numberValue(source.lfo_depth, variant.lfoDepth),
    lfoRateHz: numberValue(source.lfo_rate_hz, variant.lfoRateHz),
    gainsDb: sidecarGains(source, variant.gainsDb),
    seeds: sidecarSeeds(source, variant.seeds),
    tiltDbPerOct: numberValue(source.tilt_db_per_oct, variant.spectrum.tiltDbPerOct),
    bell,
    eq: fx?.eq ?? null,
    reverb: fx?.reverb ?? null,
    fxRecorded: has("fx") && (source.fx === null || fx !== null),
    cellSeconds,
    repeats,
    fadeSeconds: sidecar === null
      ? variant.fadeSeconds ?? null
      : has("fade_seconds")
        ? nullableNumber(source.fade_seconds)
        : null,
    sampleRate: numberValue(source.sample_rate, variant.sampleRate),
    bitDepth: sidecar === null
      ? variant.bitDepth ?? null
      : has("bit_depth")
        ? nullableNumber(source.bit_depth)
        : null,
    targetLufs: numberValue(source.target_lufs, variant.targetLufs),
    truePeakMaxDbtp: numberValue(source.true_peak_max_dbtp, variant.truePeakMaxDbtp),
    tailSeconds: nullableNumber(source.tail_seconds),
    audacityVersion: stringValue(source.audacity_version),
    renderedAt: stringValue(source.render_timestamp, renderedAt),
  };
}

export async function libraryTracks(releaseTitles: Map<string, { title: string; description: string }> = new Map()): Promise<LibraryTrack[]> {
  const index = await artifactIndex();
  const variants = loadVariants();
  const variantsById = new Map(variants.map((variant) => [variant.variantId, variant]));
  const renderedIds = new Set<string>();
  const rendered: LibraryTrack[] = [];
  for (const artifact of index.artifacts.values()) {
    const sidecar = sidecarOf(artifact);
    const variantId = typeof sidecar?.variant_id === "string" ? sidecar.variant_id : null;
    const variant = variantId ? variantsById.get(variantId) : undefined;
    if (!variant || !sidecar || !isMasterFilename(artifact.filename)) continue;
    renderedIds.add(variant.variantId);
    rendered.push(trackFrom(variant, artifact, sidecar, index, releaseTitles, renderKeyOf(artifact.filename)));
  }
  const tracks = variants
    .filter((variant) => !renderedIds.has(variant.variantId))
    .map((variant) => trackFrom(variant, null, null, index, releaseTitles, variant.variantId));
  tracks.unshift(...rendered);
  // Newest renders first; undated tracks keep their matrix order at the end.
  return tracks.sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    if (a.renderedAt && b.renderedAt) {
      const delta = new Date(b.renderedAt).getTime() - new Date(a.renderedAt).getTime();
      if (delta) return delta;
    } else if (a.renderedAt !== b.renderedAt) {
      return a.renderedAt ? -1 : 1;
    }
    return a.matrixIndex - b.matrixIndex || a.renderKey.localeCompare(b.renderKey);
  });
}

function trackFrom(
  variant: Variant,
  artifact: Artifact | null,
  sidecar: Sidecar | null,
  index: ArtifactIndex,
  releaseTitles: Map<string, { title: string; description: string }>,
  renderKey: string,
): LibraryTrack {
  const filename = artifact?.filename ?? variant.filename;
  const resolved = withSidecar(variant, sidecar);
  const recipe = deriveRecipe(variant, sidecar, typeof sidecar?.render_timestamp === "string" ? sidecar.render_timestamp : null);
  const qaChecks = artifact?.qaChecks ?? [];
  const failed = qaChecks.some((check) => !check.passed);
  const lufs = qaChecks.find((check) => check.name === "Loudness")?.measured ?? null;
  const peak = qaChecks.find((check) => check.name === "True peak")?.measured ?? null;
  return {
    ...resolved,
    filename,
    renderKey,
    recipe,
    path: artifactUrl(filename),
    sizeBytes: artifact?.sizeBytes ?? 0,
    ...audioUrls(filename),
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
  const tracks = await libraryTracks();
  const track = tracks.find((candidate) => candidate.renderKey === variantId)
    ?? tracks.find((candidate) => candidate.variantId === variantId);
  if (!track?.exists) return undefined;
  return { master: track, stems: track.stems.filter((stem) => stem.exists) };
}
