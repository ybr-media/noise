export const RERENDER_MINUTE_OPTIONS = [1, 2, 4, 8, 15, 30, 60];

export function repeatsForMinutes(minutes: number, cellSeconds: number): number {
  return Math.max(1, Math.round(minutes * 60 / cellSeconds));
}

export function rerenderOptionLabel(minutes: number, cellSeconds: number): string {
  const seconds = Math.max(0, Math.round(cellSeconds * repeatsForMinutes(minutes, cellSeconds)));
  return `${minutes} minute${minutes === 1 ? "" : "s"} (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`;
}
