import { EQ_MAX_ABS_DB, eqResponseDb } from "./fx";

export type EqCardPoint = { x: number; y: number };

export function eqCardPoints(gainsDb: number[], width: number, height: number): EqCardPoint[] {
  const mid = height / 2;
  const span = height * 0.4;
  const points: EqCardPoint[] = [];
  for (let x = 0; x <= width; x += 3) {
    const hz = 30 * (16000 / 30) ** (x / width);
    const db = eqResponseDb(gainsDb, hz);
    points.push({ x, y: mid - (db / EQ_MAX_ABS_DB) * span });
  }
  return points;
}

export function eqCardPath(points: EqCardPoint[]): string {
  return points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}
