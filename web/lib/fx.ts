// The FX model shared by the preview chain, the queue, and the render
// pipeline. Band layout, preset tables, and the tail estimate mirror
// render_plan.py so the previewed curve and the rendered curve are the same
// function.

export const EQ_BAND_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_BAND_Q = 1.4;
export const EQ_MAX_ABS_DB = 20;
export const FX_TRIM_MAX_ABS_DB = 12;
export const REVERB_TAIL_CAP_SECONDS = 8;
export const TAIL_FADE_SECONDS = 0.5;
export const REVERB_WET_GAIN_MIN_DB = -20;

export const EQ_PRESETS = ["flat", "warm-bed", "airy", "midnight", "telephone", "custom"] as const;
export type EqPreset = (typeof EQ_PRESETS)[number];

export const REVERB_PRESETS = ["off", "small-room", "medium-room", "large-room", "church-hall", "cathedral", "custom"] as const;
export type ReverbPreset = (typeof REVERB_PRESETS)[number];

export type EqState = {
  preset: EqPreset;
  gainsDb: number[];
  trimDb: number;
};

export type ReverbState = {
  preset: ReverbPreset;
  roomSize: number;
  preDelayMs: number;
  reverberance: number;
  damping: number;
  mixPercent: number;
};

export type FxState = {
  eq: EqState;
  reverb: ReverbState;
};

export const EQ_PRESET_GAINS: Record<Exclude<EqPreset, "custom">, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "warm-bed": [0, 1, 2, 2, 1, 0, -1, -3, -6, -9],
  airy: [-4, -3, -1, 0, 0, 1, 2, 3, 4, 5],
  midnight: [0, 0, -1, -2, -4, -6, -9, -12, -15, -18],
  telephone: [-18, -14, -8, -2, 2, 2, 0, -4, -10, -16],
};

export const EQ_PRESET_LABELS: Record<EqPreset, string> = {
  flat: "Flat",
  "warm-bed": "Warm Bed",
  airy: "Airy",
  midnight: "Midnight",
  telephone: "Telephone",
  custom: "Custom",
};

type ReverbParams = Omit<ReverbState, "preset">;

export const REVERB_PRESET_PARAMS: Record<Exclude<ReverbPreset, "custom">, ReverbParams> = {
  off: { roomSize: 50, preDelayMs: 10, reverberance: 45, damping: 40, mixPercent: 0 },
  "small-room": { roomSize: 25, preDelayMs: 5, reverberance: 25, damping: 50, mixPercent: 20 },
  "medium-room": { roomSize: 50, preDelayMs: 10, reverberance: 45, damping: 40, mixPercent: 28 },
  "large-room": { roomSize: 70, preDelayMs: 15, reverberance: 60, damping: 35, mixPercent: 35 },
  "church-hall": { roomSize: 80, preDelayMs: 25, reverberance: 75, damping: 30, mixPercent: 40 },
  cathedral: { roomSize: 95, preDelayMs: 35, reverberance: 90, damping: 25, mixPercent: 45 },
};

export const REVERB_PRESET_LABELS: Record<ReverbPreset, string> = {
  off: "Off",
  "small-room": "Small",
  "medium-room": "Medium",
  "large-room": "Large",
  "church-hall": "Church",
  cathedral: "Cathedral",
  custom: "Custom",
};

export function defaultFx(): FxState {
  return {
    eq: { preset: "flat", gainsDb: [...EQ_PRESET_GAINS.flat], trimDb: 0 },
    reverb: { preset: "off", ...REVERB_PRESET_PARAMS.off },
  };
}

export function eqPresetState(preset: Exclude<EqPreset, "custom">): EqState {
  return { preset, gainsDb: [...EQ_PRESET_GAINS[preset]], trimDb: 0 };
}

export function reverbPresetState(preset: Exclude<ReverbPreset, "custom">): ReverbState {
  return { preset, ...REVERB_PRESET_PARAMS[preset] };
}

export function eqIsFlat(eq: EqState): boolean {
  return eq.trimDb === 0 && eq.gainsDb.every((gain) => gain === 0);
}

export function reverbIsOff(reverb: ReverbState): boolean {
  return reverb.mixPercent <= 0;
}

export function fxIsDefault(fx: FxState): boolean {
  return eqIsFlat(fx.eq) && reverbIsOff(fx.reverb);
}

export function wetGainDb(mixPercent: number): number {
  const wet = 20 * Math.log10(mixPercent / 100);
  return Math.max(REVERB_WET_GAIN_MIN_DB, Math.min(0, wet));
}

// Mirrors render_plan.reverb_tail_seconds (without sample quantisation).
export function reverbTailSeconds(reverb: ReverbState): number {
  if (reverbIsOff(reverb)) return 0;
  const rt60 = Math.pow(reverb.reverberance / 100, 1.5) * (2 + (6 * reverb.roomSize) / 100);
  return Math.min(REVERB_TAIL_CAP_SECONDS, 0.15 + rt60 + reverb.preDelayMs / 1000);
}

// The snake_case block render_plan.parse_fx reads; null when nothing is active.
export type FxBlock = {
  eq?: { preset: string; gains_db: number[]; trim_db: number };
  reverb?: {
    preset: string;
    room_size: number;
    pre_delay_ms: number;
    reverberance: number;
    damping: number;
    mix_percent: number;
  };
};

export function toFxBlock(fx: FxState): FxBlock | null {
  const block: FxBlock = {};
  if (!eqIsFlat(fx.eq)) {
    block.eq = { preset: fx.eq.preset, gains_db: [...fx.eq.gainsDb], trim_db: fx.eq.trimDb };
  }
  if (!reverbIsOff(fx.reverb)) {
    block.reverb = {
      preset: fx.reverb.preset,
      room_size: fx.reverb.roomSize,
      pre_delay_ms: fx.reverb.preDelayMs,
      reverberance: fx.reverb.reverberance,
      damping: fx.reverb.damping,
      mix_percent: fx.reverb.mixPercent,
    };
  }
  return block.eq || block.reverb ? block : null;
}

export function sanitizeFxBlock(raw: unknown): FxBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const block: FxBlock = {};
  const eq = source.eq as Record<string, unknown> | undefined;
  if (eq && typeof eq === "object") {
    const gains = eq.gains_db;
    if (
      Array.isArray(gains) &&
      gains.length === EQ_BAND_HZ.length &&
      gains.every((gain) => typeof gain === "number" && Math.abs(gain) <= EQ_MAX_ABS_DB)
    ) {
      const trim = typeof eq.trim_db === "number" ? eq.trim_db : 0;
      if (Math.abs(trim) <= FX_TRIM_MAX_ABS_DB) {
        block.eq = { preset: String(eq.preset ?? "custom"), gains_db: [...(gains as number[])], trim_db: trim };
      }
    }
  }
  const reverb = source.reverb as Record<string, unknown> | undefined;
  if (reverb && typeof reverb === "object") {
    const inRange = (value: unknown, low: number, high: number): value is number =>
      typeof value === "number" && value >= low && value <= high;
    if (
      inRange(reverb.room_size, 0, 100) &&
      inRange(reverb.pre_delay_ms, 0, 200) &&
      inRange(reverb.reverberance, 0, 100) &&
      inRange(reverb.damping, 0, 100) &&
      inRange(reverb.mix_percent, 0, 100)
    ) {
      block.reverb = {
        preset: String(reverb.preset ?? "custom"),
        room_size: reverb.room_size,
        pre_delay_ms: reverb.pre_delay_ms,
        reverberance: reverb.reverberance,
        damping: reverb.damping,
        mix_percent: reverb.mix_percent,
      };
    }
  }
  return block.eq || block.reverb ? block : null;
}

// Compact queue badges, e.g. "EQ: Warm Bed" / "FX: Cathedral".
export function fxBadges(block: FxBlock | null | undefined): string[] {
  if (!block) return [];
  const badges: string[] = [];
  if (block.eq) {
    const label = EQ_PRESET_LABELS[block.eq.preset as EqPreset] ?? "Custom";
    badges.push(`EQ: ${label}`);
  }
  if (block.reverb && block.reverb.mix_percent > 0) {
    const label = REVERB_PRESET_LABELS[block.reverb.preset as ReverbPreset] ?? "Custom";
    badges.push(`FX: ${label}`);
  }
  return badges;
}

// --- EQ curve (RBJ biquads, matching Web Audio's BiquadFilterNode) ---

type Coefficients = [number, number, number, number, number, number];

function shelfCoefficients(frequency: number, gainDb: number, sampleRate: number, high: boolean): Coefficients {
  const amplitude = Math.pow(10, gainDb / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosW = Math.cos(omega);
  const alpha = (Math.sin(omega) / 2) * Math.sqrt(amplitude + 1 / amplitude);
  const twoSqrtAAlpha = 2 * Math.sqrt(amplitude) * alpha;
  const sign = high ? 1 : -1;
  return [
    amplitude * ((amplitude + 1) + sign * (amplitude - 1) * cosW + twoSqrtAAlpha),
    -2 * sign * amplitude * ((amplitude - 1) + sign * (amplitude + 1) * cosW),
    amplitude * ((amplitude + 1) + sign * (amplitude - 1) * cosW - twoSqrtAAlpha),
    (amplitude + 1) - sign * (amplitude - 1) * cosW + twoSqrtAAlpha,
    2 * sign * ((amplitude - 1) - sign * (amplitude + 1) * cosW),
    (amplitude + 1) - sign * (amplitude - 1) * cosW - twoSqrtAAlpha,
  ];
}

function peakingCoefficients(frequency: number, gainDb: number, quality: number, sampleRate: number): Coefficients {
  const amplitude = Math.pow(10, gainDb / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(omega) / (2 * quality);
  const cosW = Math.cos(omega);
  return [1 + alpha * amplitude, -2 * cosW, 1 - alpha * amplitude, 1 + alpha / amplitude, -2 * cosW, 1 - alpha / amplitude];
}

function biquadResponseDb(coefficients: Coefficients, hz: number, sampleRate: number): number {
  const [b0, b1, b2, a0, a1, a2] = coefficients;
  const omega = (2 * Math.PI * hz) / sampleRate;
  const re1 = Math.cos(-omega);
  const im1 = Math.sin(-omega);
  const re2 = re1 * re1 - im1 * im1;
  const im2 = 2 * re1 * im1;
  const numRe = b0 + b1 * re1 + b2 * re2;
  const numIm = b1 * im1 + b2 * im2;
  const denRe = a0 + a1 * re1 + a2 * re2;
  const denIm = a1 * im1 + a2 * im2;
  const magnitude = Math.hypot(numRe, numIm) / Math.max(Math.hypot(denRe, denIm), 1e-30);
  return 20 * Math.log10(Math.max(magnitude, 1e-30));
}

export function eqResponseDb(gainsDb: number[], hz: number, sampleRate = 48000): number {
  let total = 0;
  for (let band = 0; band < EQ_BAND_HZ.length; band += 1) {
    const gain = gainsDb[band];
    if (!gain) continue;
    const frequency = EQ_BAND_HZ[band];
    const coefficients =
      band === 0
        ? shelfCoefficients(frequency, gain, sampleRate, false)
        : band === EQ_BAND_HZ.length - 1
          ? shelfCoefficients(frequency, gain, sampleRate, true)
          : peakingCoefficients(frequency, gain, EQ_BAND_Q, sampleRate);
    total += biquadResponseDb(coefficients, hz, sampleRate);
  }
  return total;
}

export function formatBandLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

export function formatTail(nominalSeconds: number, tailSeconds: number): string {
  const clock = (seconds: number) => {
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };
  if (tailSeconds <= 0) return clock(nominalSeconds);
  return `${clock(nominalSeconds)} + ${clock(tailSeconds)} tail`;
}
