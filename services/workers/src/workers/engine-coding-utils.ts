export function normalizeEngineCodingIntensity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(5, Math.round(value)));
}
