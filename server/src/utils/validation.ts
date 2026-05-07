interface IntBounds {
  min?: number;
  max?: number;
}

export function toInt(v: unknown, { min = -Infinity, max = Infinity }: IntBounds = {}): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
