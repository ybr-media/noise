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

const COLORS: Color[] = ["white", "green", "pink", "brown"];
const BANDS: Band[] = ["low-mid", "mid", "high", "broad"];
const MOTIONS: Motion[] = ["still", "drift", "breathing"];
const BALANCES: Balance[] = ["bed-forward", "balanced", "texture-forward"];

type RawVariant = Record<string, unknown>;

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function matrixIndex(color: string, band: string, motion: string, balance: string): number {
  const c = COLORS.indexOf(color as Color);
  const b = BANDS.indexOf(band as Band);
  const m = MOTIONS.indexOf(motion as Motion);
  const bal = BALANCES.indexOf(balance as Balance);
  return c * 36 + b * 9 + m * 3 + bal + 1;
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
      matrixIndex: matrixIndex(color, band, motion, balance),
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
