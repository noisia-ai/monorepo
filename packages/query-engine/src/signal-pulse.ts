export type SignalPulsePeriod = {
  periodStart: string;
  periodEnd: string;
  label: string;
};

export type ImpactV1Input = {
  volumeNorm: number;
  engagementNorm: number;
  recency: number;
  sourceDiversity: number;
  temporalConsistency: number;
};

export type SignalPulseLifecycle = "new" | "emerging" | "reappeared" | "accelerating" | "mature" | "declining" | "dormant" | "volatile";

export function buildMonthlyReportPeriods(args: {
  windowEnd: string | Date;
  months: number;
}): SignalPulsePeriod[] {
  const months = Math.max(1, Math.min(36, Math.floor(args.months)));
  const end = toUtcDate(args.windowEnd);
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const periods: SignalPulsePeriod[] = [];

  for (let index = months - 1; index >= 0; index -= 1) {
    const start = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - index, 1));
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const periodEnd = new Date(next.getTime() - 24 * 60 * 60 * 1000);
    periods.push({
      periodStart: isoDate(start),
      periodEnd: isoDate(periodEnd),
      label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`
    });
  }

  return periods;
}

export function buildWeeklyReportPeriods(args: {
  windowEnd: string | Date;
  weeks: number;
}): SignalPulsePeriod[] {
  const weeks = Math.max(1, Math.min(156, Math.floor(args.weeks)));
  const end = toUtcDate(args.windowEnd);
  const endWeekStart = startOfIsoWeek(end);
  const periods: SignalPulsePeriod[] = [];

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const start = addDays(endWeekStart, -7 * index);
    const periodEnd = addDays(start, 6);
    const isoWeek = isoWeekLabel(start);
    periods.push({
      periodStart: isoDate(start),
      periodEnd: isoDate(periodEnd),
      label: isoWeek
    });
  }

  return periods;
}

export function calculateImpactV1(input: ImpactV1Input): number {
  const score = 100 * (
    0.35 * clamp01(input.volumeNorm) +
    0.25 * clamp01(input.engagementNorm) +
    0.15 * clamp01(input.recency) +
    0.15 * clamp01(input.sourceDiversity) +
    0.10 * clamp01(input.temporalConsistency)
  );
  return Math.round(score * 100) / 100;
}

export function classifySignalPulseLifecycle(args: {
  currentVolume: number;
  previousVolume?: number | null;
  periodsSeen: number;
  volatility?: number | null;
}): SignalPulseLifecycle {
  const current = Math.max(0, args.currentVolume);
  const previous = Math.max(0, args.previousVolume ?? 0);
  const periodsSeen = Math.max(0, args.periodsSeen);
  const volatility = Math.max(0, args.volatility ?? 0);

  if (current === 0) return "dormant";
  if (volatility >= 0.7 && periodsSeen >= 3) return "volatile";
  if (previous === 0 && periodsSeen <= 1) return "new";
  if (previous === 0 && periodsSeen > 1) return "reappeared";
  if (previous === 0) return "emerging";
  if (current >= previous * 1.5) return "accelerating";
  if (current <= previous * 0.55) return "declining";
  return "mature";
}

function toUtcDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Signal Pulse period date");
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfIsoWeek(date: Date) {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = normalized.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  return addDays(normalized, -daysFromMonday);
}

function isoWeekLabel(date: Date) {
  const weekDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = weekDate.getUTCDay() || 7;
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((weekDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
