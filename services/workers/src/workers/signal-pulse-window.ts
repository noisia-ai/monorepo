export function chooseSignalPulseWindowEnd(args: {
  maxMentionDate?: string | null;
  maxPerformanceDate?: string | null;
  fallbackDate?: string | Date;
}) {
  const mentionDate = parseIsoDate(args.maxMentionDate);
  const performanceDate = parseIsoDate(args.maxPerformanceDate);
  if (mentionDate && performanceDate) {
    return isoDate(performanceDate.getTime() <= mentionDate.getTime() ? performanceDate : mentionDate);
  }
  if (mentionDate) return isoDate(mentionDate);
  if (performanceDate) return isoDate(performanceDate);
  return isoDate(args.fallbackDate instanceof Date ? args.fallbackDate : parseIsoDate(args.fallbackDate) ?? new Date());
}

function parseIsoDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
