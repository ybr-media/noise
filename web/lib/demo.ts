import type { Variant } from "./types";

export const DEMO_VARIANT_ID = "demo_first_render";
export const DEMO_FILENAME = "noise-lab-demo-master.wav";

export type DemoSidecar = {
  variant_id: string;
  cell_seconds: number;
  repeats: number;
  stem_filenames: string[];
  stem_map: Record<string, string>;
  render_timestamp: string;
  seo_title: string;
  seo_description: string;
  seo_title_approved: boolean;
};

export function shouldShowDemoTrack(realArtifactCount: number): boolean {
  return realArtifactCount === 0;
}

export function isDemoSidecar(value: unknown): value is DemoSidecar {
  if (!value || typeof value !== "object") return false;
  const sidecar = value as Partial<DemoSidecar>;
  return sidecar.variant_id === DEMO_VARIANT_ID
    && typeof sidecar.cell_seconds === "number"
    && typeof sidecar.repeats === "number"
    && Array.isArray(sidecar.stem_filenames)
    && typeof sidecar.stem_map === "object"
    && typeof sidecar.render_timestamp === "string"
    && typeof sidecar.seo_title === "string"
    && typeof sidecar.seo_description === "string"
    && typeof sidecar.seo_title_approved === "boolean";
}

export function demoVariant(base: Variant): Variant {
  return {
    ...base,
    variantId: DEMO_VARIANT_ID,
    filename: DEMO_FILENAME,
    matrixIndex: 0,
    color: "green",
    band: "broad",
    motion: "drift",
    balance: "balanced",
    durationSeconds: 25,
    sampleRate: 24000,
  };
}
