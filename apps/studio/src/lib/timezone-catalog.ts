/** Browser-supported IANA identifiers; UTC is the deterministic SSR/failure fallback. */
export const DEFAULT_WORKSPACE_TIMEZONE = "UTC";

export function isIanaTimezone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/u.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
}

export function browserWorkspaceTimezone(resolve = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  try { const zone = resolve(); return typeof zone === "string" && isIanaTimezone(zone) ? zone : DEFAULT_WORKSPACE_TIMEZONE; }
  catch { return DEFAULT_WORKSPACE_TIMEZONE; }
}

export function workspaceTimezoneOptions(current = DEFAULT_WORKSPACE_TIMEZONE,
  supported = () => Intl.supportedValuesOf("timeZone")): Array<{ value: string; label: string }> {
  let available: string[] = [];
  try { available = supported(); } catch { /* Older engines retain UTC and the valid saved/browser zone. */ }
  const zones = new Set([DEFAULT_WORKSPACE_TIMEZONE, ...available.filter(isIanaTimezone)]);
  if (isIanaTimezone(current)) zones.add(current); // Preserve valid aliases already stored on a brand.
  return [...zones].sort((a, b) => a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b))
    .map((value) => ({ value, label: value === "UTC" ? "UTC" : value.replaceAll("_", " ") }));
}
