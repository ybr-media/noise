import fs from "node:fs";
import path from "node:path";
import { RENDER_DIR } from "./config";
import type { Variant } from "./types";

export type NameSuggestion = {
  title: string;
  description: string;
  provider: "local-stub";
  prompt: string;
};

export interface SeoNameProvider {
  generate(variant: Variant, candidate?: number, siblingTitles?: string[]): NameSuggestion;
}

const colorNames: Record<string, string> = {
  white: "White Noise",
  pink: "Pink Noise",
  brown: "Brown Noise",
  green: "Green Noise",
};

const motionNames: Record<string, string> = {
  still: "Still",
  drift: "Drifting",
  breathing: "Breathing",
};

const balanceNames: Record<string, string> = {
  "bed-forward": "Deep",
  balanced: "Balanced",
  "texture-forward": "Textured",
};

const localPrompt = (variant: Variant) =>
  `Create one natural Spotify title and one concise search-friendly description for a ${variant.color} noise track with ${variant.band} texture, ${variant.motion} modulation, and ${variant.balance} balance. Avoid keyword stuffing; preserve the internal ID ${variant.variantId}.`;

export const localStubProvider: SeoNameProvider = {
  generate(variant, candidate = 0, siblingTitles = []) {
    const options = [
      [`${colorNames[variant.color]} · ${variant.band} ${motionNames[variant.motion]} ${balanceNames[variant.balance]}`, "focus, sleep, meditation, and calm background listening"],
      `${colorNames[variant.color]} · ${variant.band} ${motionNames[variant.motion]} Calm`,
      `${colorNames[variant.color]} ${motionNames[variant.motion]} ${balanceNames[variant.balance]}`,
    ];
    const normalized = new Set(siblingTitles.map((title) => title.trim().toLowerCase()));
    let offset = candidate % options.length;
    let selected = options[offset];
    while (normalized.has((Array.isArray(selected) ? selected[0] : selected).toLowerCase()) && offset < candidate + options.length) {
      offset += 1;
      selected = options[offset % options.length];
    }
    const title = Array.isArray(selected) ? selected[0] : selected;
    const keywords = Array.isArray(selected) ? selected[1] : "focus, sleep, meditation, and calm background listening";
    const description = `${colorNames[variant.color]} with a ${variant.band} frequency profile and ${variant.motion} motion, shaped for ${keywords}.`;
    return { title, description, provider: "local-stub", prompt: localPrompt(variant) };
  },
};

export function approveName(filename: string, title: string, description: string): void {
  if (!/^[\w.-]+\.wav$/i.test(filename)) throw new Error("Invalid audio filename");
  const sidecarPath = path.join(RENDER_DIR, filename.replace(/\.wav$/, ".json"));
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;
  // A published title names the release, which is the mixed master; the stems
  // are supporting assets and carry no name of their own.
  if ("role" in sidecar && sidecar.role !== "master") throw new Error("Only a master can be named");
  sidecar.seo_title = title.trim();
  sidecar.seo_description = description.trim();
  sidecar.seo_title_approved = true;
  sidecar.seo_provider = "local-stub";
  sidecar.seo_approved_at = new Date().toISOString();
  fs.writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
}
