export function resolveByteRange(range: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return null;
  const suffix = !match[1] && Boolean(match[2]);
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix ? size - 1 : match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (start > end || start >= size) return null;
  return { start, end };
}
