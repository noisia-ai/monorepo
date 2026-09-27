/** Format an evidence instant in the workspace's display zone without changing its UTC identity. */
export function formatSignalEvidenceDateV1(value: string | null, locale: string, timeZone = "UTC") {
  if (!value?.trim()) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options = { day: "numeric", month: "short", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    // Workspaces created before timezone validation may still carry invalid legacy data.
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
  }
}
