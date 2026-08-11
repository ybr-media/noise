import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { DISPATCH_CONFIGURED } from "./dispatch";
import type { Band, Balance, Color, Motion, Variant } from "./types";

// The console runs from the app directory, so the engine's config lives one
// level up. A copy inside the app directory takes over when the app is
// deployed on its own, without the Python tree beside it.
function configPath(name: string): string {
  const candidates = [path.resolve("..", "config", name), path.resolve("config", name)];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export const CONFIG_PATH = process.env.NOISE_VARIANTS_FILE ?? configPath("variants.yaml");
export const PILOT_CONFIG_PATH = process.env.NOISE_PILOT_VARIANTS_FILE ?? configPath("variants_pilot.yaml");
export const DIMENSIONS_PATH = process.env.NOISE_DIMENSIONS_FILE ?? configPath("dimensions.yaml");
export const RENDER_DIR = process.env.NOISE_RENDER_DIR ?? path.join(os.homedir(), "noisegen-out");

// The local queue only means something where the Python worker and Audacity can
// reach the same render directory, which a hosted deployment cannot. Hosted
// deployments instead hand the render to a GitHub Actions runner.
export type RenderMode = "local" | "dispatch" | "unavailable";

function renderMode(): RenderMode {
  if (process.env.NOISE_RENDERING_AVAILABLE === "1") return "local";
  if (process.env.NOISE_RENDERING_AVAILABLE === "0") return "unavailable";
  if (process.env.VERCEL) return DISPATCH_CONFIGURED ? "dispatch" : "unavailable";
  return "local";
}

export const RENDER_MODE = renderMode();
export const RENDERING_AVAILABLE = RENDER_MODE !== "unavailable";

type RawVariant = Record<string, unknown>;

// The matrix numbering belongs to dimensions.yaml: `dimension_order` gives the
// cross-product order the generator emits, and each dimension's declared values
// give its size. Restating either here would silently renumber every track the
// first time someone edits the YAML.
type Matrix = { order: string[]; values: Map<string, string[]>; strides: Map<string, number> };

let matrixCache: Matrix | null = null;

function matrix(): Matrix {
  if (matrixCache) return matrixCache;
  const parsed = parse(fs.readFileSync(DIMENSIONS_PATH, "utf8")) as {
    dimensions?: Record<string, Record<string, unknown>>;
    dimension_order?: string[];
  };
  const order = parsed.dimension_order ?? [];
  if (order.length === 0) throw new Error(`${DIMENSIONS_PATH} declares no dimension_order`);
  const values = new Map<string, string[]>();
  for (const name of order) {
    const declared = Object.keys(parsed.dimensions?.[name] ?? {});
    if (declared.length === 0) throw new Error(`${DIMENSIONS_PATH} declares no values for dimension ${name}`);
    values.set(name, declared);
  }
  const strides = new Map<string, number>();
  let stride = 1;
  for (const name of [...order].reverse()) {
    strides.set(name, stride);
    stride *= values.get(name)!.length;
  }
  matrixCache = { order, values, strides };
  return matrixCache;
}

export function dimensionValues(name: string): string[] {
  return [...(matrix().values.get(name) ?? [])];
}

function matrixIndex(row: RawVariant): number {
  const { order, values, strides } = matrix();
  let index = 1;
  for (const name of order) {
    const value = string(row[name]);
    const position = values.get(name)!.indexOf(value);
    if (position < 0) {
      throw new Error(`variant ${string(row.variant_id)} has ${name}=${value || "(missing)"}, which ${DIMENSIONS_PATH} does not declare`);
    }
    index += position * strides.get(name)!;
  }
  return index;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// The pilot label is the variant's position in the curated pilot manifest, so it
// is read from that manifest in one place rather than recomputed per caller.
function pilotLabels(): Map<string, string> {
  if (!fs.existsSync(PILOT_CONFIG_PATH)) return new Map();
  const rows = (parse(fs.readFileSync(PILOT_CONFIG_PATH, "utf8")) as { variants?: RawVariant[] }).variants ?? [];
  return new Map(rows.map((row, index) => [string(row.variant_id), `P${index + 1}`]));
}

export function loadVariants(configPath = CONFIG_PATH): Variant[] {
  const source = fs.readFileSync(configPath, "utf8");
  const parsed = parse(source) as { output?: RawVariant; variants?: RawVariant[] };
  const output = parsed.output ?? {};
  const pilots = pilotLabels();
  return (parsed.variants ?? []).map((row) => {
    const spectrum = (row.spectrum as RawVariant | undefined) ?? {};
    const bell = spectrum.bell as RawVariant | undefined;
    const seeds = (row.seeds as Record<string, unknown> | undefined) ?? {};
    const color = string(row.color) as Color;
    const band = string(row.band) as Band;
    const motion = string(row.motion) as Motion;
    const balance = string(row.balance) as Balance;
    const variantId = string(row.variant_id);
    return {
      variantId,
      filename: string(row.filename),
      matrixIndex: matrixIndex(row),
      color,
      band,
      motion,
      balance,
      bandLowHz: number(row.band_low_hz),
      bandHighHz: number(row.band_high_hz),
      lfoDepth: number(row.lfo_depth),
      lfoRateHz: number(row.lfo_rate_hz),
      gainsDb: {
        bed: number(row.gain_bed_db),
        motion: number(row.gain_motion_db),
        texture: number(row.gain_texture_db),
      },
      seeds: Object.fromEntries(Object.entries(seeds).map(([key, value]) => [key, number(value)])),
      durationSeconds: number(row.cell_seconds, number(output.cell_seconds)) * number(row.repeats, number(output.repeats)),
      sampleRate: number(row.sample_rate, number(output.sample_rate, 48000)),
      targetLufs: number(row.target_lufs, number(output.target_lufs, -20)),
      truePeakMaxDbtp: number(row.true_peak_max_dbtp, number(output.true_peak_max_dbtp, -3)),
      pilot: pilots.get(variantId) ?? null,
      spectrum: {
        tiltDbPerOct: number(spectrum.tilt_db_per_oct),
        bell: bell
          ? {
              gainDb: number(bell.gain_db),
              centerHz: number(bell.center_hz),
              q: number(bell.q),
            }
          : null,
      },
    } satisfies Variant;
  });
}

export function loadPilotVariants(): Variant[] {
  return loadVariants(PILOT_CONFIG_PATH);
}

export function findVariant(variantId: string): Variant | undefined {
  return loadVariants().find((variant) => variant.variantId === variantId);
}

export type RenderSelection = { variantIds?: unknown[]; pilot?: boolean; full?: boolean; fx?: unknown };

// A render request names either a set of ids or a whole manifest. `pilot` and
// `full` are also render.yml's own selectors, so the whole matrix travels as one
// keyword instead of 144 comma-separated ids, while the local worker still gets
// the expanded list it enqueues.
export function resolveSelection(request: RenderSelection): { variantIds: string[]; dispatchInput: string } {
  if (request.full) {
    return { variantIds: loadVariants().map((variant) => variant.variantId), dispatchInput: "full" };
  }
  if (request.pilot) {
    return { variantIds: loadPilotVariants().map((variant) => variant.variantId), dispatchInput: "pilot" };
  }
  const variantIds = Array.isArray(request.variantIds)
    ? request.variantIds.filter((id): id is string => typeof id === "string")
    : [];
  return { variantIds, dispatchInput: variantIds.join(",") };
}
