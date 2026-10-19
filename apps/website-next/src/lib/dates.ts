// Fixed month names instead of Intl so the server and every browser print the same text.
const MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
} as const;

/** "2026-01" or "2026-01-15" → "ene 2026" / "Jan 2026". Anything else passes through. */
export function formatMonth(value: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[locale === "en" ? "en" : "es"][Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : value;
}
