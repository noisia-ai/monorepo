export const locales = ["es-MX", "en-US"] as const;

export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "en-US";
export const localeCookieName = "noisia_locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && locales.includes(value as AppLocale);
}

export function normalizeLocale(value: unknown): AppLocale | null {
  if (!value || typeof value !== "string") return null;

  const normalized = value.toLowerCase();
  if (normalized === "es" || normalized.startsWith("es-")) return "es-MX";
  if (normalized === "en" || normalized.startsWith("en-")) return "en-US";

  return null;
}

/** The interface language is an explicit user preference. Browser language does
 * not override the product default when a preference has not been selected. */
export function resolveRequestLocale(cookieLocale: unknown): AppLocale {
  return isAppLocale(cookieLocale) ? cookieLocale : defaultLocale;
}

export function pickLocaleFromAcceptLanguage(value: string | null): AppLocale {
  if (!value) return defaultLocale;

  for (const part of value.split(",")) {
    const locale = normalizeLocale(part.trim().split(";")[0]);
    if (locale) return locale;
  }

  return defaultLocale;
}

export function getLocaleFromPreferences(preferences: unknown): AppLocale | null {
  if (!preferences || typeof preferences !== "object") return null;

  const locale = (preferences as { locale?: unknown }).locale;
  return isAppLocale(locale) ? locale : normalizeLocale(locale);
}
