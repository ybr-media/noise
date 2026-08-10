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
    ["bed-forward", "Smooth"], ["balanced", "Balanced"], ["texture-forward", "Grainy"],
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

export function formatQueueDisplayName(variantId: string, variants: Variant[], counts: { pilot: number; full: number }): string {
  if (isBatchVariantId(variantId)) return formatBatchLabel(variantId, counts);
  const ids = variantId.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length > 1) return `${ids.length} variants`;
  const variant = variants.find((candidate) => candidate.variantId === variantId);
  return variant ? formatDisplayName(variant) : "Unknown variant";
}

export function formatDisplayName(variant: Variant): string {
  return `${labels[variant.color]} ${labels[variant.band]} ${labels[variant.motion]} — ${labels[variant.balance]}`;
}

export function isBatchVariantId(variantId: string): boolean {
  return variantId === "pilot" || variantId === "full";
}

export function formatBatchLabel(variantId: string, counts: { pilot: number; full: number }): string {
  if (variantId === "pilot") return `Pilot set (${counts.pilot})`;
  if (variantId === "full") return `Full matrix (${counts.full})`;
  return variantId;
}
