import type { Variant } from "./types";

export const OPTIONS = {
  color: [
    ["white", "White"], ["green", "Green"], ["pink", "Pink"], ["brown", "Brown"],
  ],
  band: [
    ["low-mid", "Low-mid"], ["mid", "Mid"], ["high", "High"], ["broad", "Broad"],
  ],
  motion: [
    ["still", "Still"], ["drift", "Drift"], ["breathing", "Breathing"],
  ],
  balance: [
    ["bed-forward", "Bed"], ["balanced", "Even"], ["texture-forward", "Texture"],
  ],
} as const;

const labels = Object.fromEntries(
  Object.values(OPTIONS).flat().map(([value, label]) => [value, label]),
) as Record<string, string>;

export function formatVariantLabel(variantId: string, variants: Variant[]): string {
  const variant = variants.find((candidate) => candidate.variantId === variantId);
  if (!variant) return variantId;
  return [variant.color, variant.band, variant.motion, variant.balance].map((value) => labels[value]).join(" · ");
}

export function isBatchVariantId(variantId: string): boolean {
  return variantId === "pilot" || variantId === "full";
}

export function formatBatchLabel(variantId: string, counts: { pilot: number; full: number }): string {
  if (variantId === "pilot") return `Pilot set (${counts.pilot})`;
  if (variantId === "full") return `Full matrix (${counts.full})`;
  return variantId;
}
