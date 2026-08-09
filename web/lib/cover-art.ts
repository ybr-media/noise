import type { Color, Release, Variant } from "./types";

export type CoverArtDimensions = Pick<Variant, "color" | "band" | "motion">[];

export type ArtOp =
  | { kind: "background"; color: [number, number, number] }
  | { kind: "circle"; x: number; y: number; radius: number; color: [number, number, number]; alpha: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: [number, number, number]; width: number; alpha: number }
  | { kind: "text"; text: string; x: number; y: number; color: [number, number, number] };

export function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const palettes: Record<Color | "mixed", [number, number, number]> = {
  white: [230, 234, 238],
  green: [56, 130, 102],
  pink: [196, 91, 121],
  brown: [126, 82, 54],
  mixed: [145, 145, 145],
};

function releaseColor(dimensions: CoverArtDimensions): Color | "mixed" {
  const colors = new Set(dimensions.map((dimension) => dimension.color));
  return colors.size === 1 ? Array.from(colors)[0] : "mixed";
}

export function coverArtOps(release: Release, dimensions: CoverArtDimensions, seed = release.artSeed ?? 0, includeText = true): ArtOp[] {
  const random = mulberry32(seed);
  const base = palettes[releaseColor(dimensions)];
  const ops: ArtOp[] = [{ kind: "background", color: base }];
  const motionWeight = dimensions.reduce((total, dimension) => {
    return total + (dimension.motion === "breathing" ? 3 : dimension.motion === "drift" ? 2 : 1);
  }, 0);
  const bandWeight = dimensions.reduce((total, dimension) => {
    return total + (dimension.band === "broad" ? 3 : dimension.band === "low-mid" || dimension.band === "high" ? 2 : 1);
  }, 0);
  const count = Math.max(8, release.tracks.length + motionWeight + bandWeight);
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 300 + random() * 1100;
    const center = 1500 + (random() - 0.5) * 700;
    ops.push({
      kind: "circle",
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
      radius: 100 + random() * 500,
      color: [Math.min(255, base[0] + 35), Math.min(255, base[1] + 35), Math.min(255, base[2] + 35)],
      alpha: 0.18 + random() * 0.35,
    });
    ops.push({ kind: "line", x1: random() * 3000, y1: random() * 3000, x2: random() * 3000, y2: random() * 3000, color: [255, 255, 255], width: 2 + random() * 14, alpha: 0.1 + random() * 0.25 });
  }
  if (includeText) {
    ops.push({ kind: "text", text: `${release.title} · ${release.artist}`, x: 180, y: 2700, color: [255, 255, 255] });
  }
  return ops;
}

export function renderCoverArt(canvas: HTMLCanvasElement, release: Release, dimensions: CoverArtDimensions, seed = release.artSeed ?? 0, includeText = true): void {
  canvas.width = 3000;
  canvas.height = 3000;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  for (const op of coverArtOps(release, dimensions, seed, includeText)) {
    if (op.kind === "background") {
      context.fillStyle = `rgb(${op.color.join(",")})`;
      context.fillRect(0, 0, 3000, 3000);
    } else if (op.kind === "circle") {
      context.globalAlpha = op.alpha;
      context.fillStyle = `rgb(${op.color.join(",")})`;
      context.beginPath();
      context.arc(op.x, op.y, op.radius, 0, Math.PI * 2);
      context.fill();
    } else if (op.kind === "line") {
      context.globalAlpha = op.alpha;
      context.strokeStyle = `rgb(${op.color.join(",")})`;
      context.lineWidth = op.width;
      context.beginPath();
      context.moveTo(op.x1, op.y1);
      context.lineTo(op.x2, op.y2);
      context.stroke();
    } else {
      context.globalAlpha = 1;
      context.fillStyle = `rgb(${op.color.join(",")})`;
      context.font = "bold 96px sans-serif";
      context.fillText(op.text, op.x, op.y);
    }
  }
  context.globalAlpha = 1;
}
