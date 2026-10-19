import { SITE_URL } from "@/lib/site";

export { SITE_URL };

export type Lang = "es" | "en";

export const toLang = (locale: string): Lang => (locale === "en" ? "en" : "es");

/** Staging (UAT) is never indexed; production sets neither NOISIA_UAT nor UAT_PASSWORD. */
export const IS_UAT = process.env.NOISIA_UAT === "1";

/** hreflang / inLanguage codes and Open Graph locales per site locale. */
export const HREFLANG: Record<Lang, string> = { es: "es-MX", en: "en-US" };
export const OG_LOCALE: Record<Lang, string> = { es: "es_MX", en: "en_US" };

/**
 * Date the site's pages were last revised, for the sitemap and dateModified in structured data.
 * Bump it when a content round ships. Reports carry their own analysis date.
 */
export const SITE_UPDATED = "2026-10-19";

export const ORG_NAME = "Noisia";
export const ORG_EMAIL = "hola@noisia.ai";
/** Only profiles that exist and are linked from the site (footer). */
export const ORG_SAME_AS = ["https://www.linkedin.com/company/29118513/"];

export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** Absolute URL for a site path ("/" stays the bare origin, like the canonical Next emits). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path === "/" || path === "") return SITE_URL;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
