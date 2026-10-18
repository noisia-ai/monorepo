import type { ComponentType, CSSProperties, SVGProps } from "react";
import { ChatLines, Community, Database, Journal, Linkedin, Megaphone, PercentageCircle, Search, Star } from "iconoir-react";
import {
  siAppstore,
  siDiscord,
  siFacebook,
  siGoogle,
  siGooglemaps,
  siGoogleplay,
  siInstagram,
  siPinterest,
  siReddit,
  siSpotify,
  siTelegram,
  siThreads,
  siTiktok,
  siTripadvisor,
  siTrustpilot,
  siTwitch,
  siWhatsapp,
  siX,
  siYoutube
} from "simple-icons";

/**
 * Every source the site names carries its mark: the platform's real logo (Simple Icons)
 * or a generic Iconoir icon for source types. Rule: never a platform name without its icon.
 */

type BrandMark = { kind: "brand"; label: string; path: string; hex: string };
type GenericMark = { kind: "generic"; label: { es: string; en: string }; Icon: ComponentType<SVGProps<SVGSVGElement>> };
type Mark = BrandMark | GenericMark;

const brand = (label: string, icon: { path: string; hex: string }): BrandMark => ({ kind: "brand", label, path: icon.path, hex: `#${icon.hex}` });

const MARKS: Record<string, Mark> = {
  tiktok: brand("TikTok", siTiktok),
  instagram: brand("Instagram", siInstagram),
  youtube: brand("YouTube", siYoutube),
  x: brand("X", siX),
  facebook: brand("Facebook", siFacebook),
  reddit: brand("Reddit", siReddit),
  threads: brand("Threads", siThreads),
  google: brand("Google", siGoogle),
  googlemaps: brand("Google Maps", siGooglemaps),
  tripadvisor: brand("Tripadvisor", siTripadvisor),
  trustpilot: brand("Trustpilot", siTrustpilot),
  appstore: brand("App Store", siAppstore),
  googleplay: brand("Google Play", siGoogleplay),
  twitch: brand("Twitch", siTwitch),
  spotify: brand("Spotify", siSpotify),
  whatsapp: brand("WhatsApp", siWhatsapp),
  telegram: brand("Telegram", siTelegram),
  pinterest: brand("Pinterest", siPinterest),
  discord: brand("Discord", siDiscord),
  // LinkedIn left Simple Icons for trademark reasons; Iconoir keeps a faithful outline.
  linkedin: { kind: "generic", label: { es: "LinkedIn", en: "LinkedIn" }, Icon: Linkedin },
  reviews: { kind: "generic", label: { es: "Reseñas", en: "Reviews" }, Icon: Star },
  forums: { kind: "generic", label: { es: "Foros", en: "Forums" }, Icon: ChatLines },
  press: { kind: "generic", label: { es: "Prensa", en: "Press" }, Icon: Journal },
  search: { kind: "generic", label: { es: "Búsqueda", en: "Search" }, Icon: Search },
  ads: { kind: "generic", label: { es: "Anuncios", en: "Ads" }, Icon: Megaphone },
  nps: { kind: "generic", label: { es: "NPS", en: "NPS" }, Icon: PercentageCircle },
  social: { kind: "generic", label: { es: "Redes sociales", en: "Social media" }, Icon: Community },
  crm: { kind: "generic", label: { es: "CRM", en: "CRM" }, Icon: Database }
};

const ALIASES: Record<string, string> = {
  twitter: "x",
  review: "reviews",
  "reseñas": "reviews",
  "reseña": "reviews",
  forum: "forums",
  foros: "forums",
  foro: "forums",
  news: "press",
  prensa: "press",
  "búsqueda": "search",
  busqueda: "search",
  anuncios: "ads",
  redes: "social"
};

// Free-text source names ("Reseñas de Google Maps", "Betting forums") still get the closest mark.
const CONTAINS: [RegExp, string][] = [
  [/google maps/i, "googlemaps"],
  [/tripadvisor/i, "tripadvisor"],
  [/trustpilot/i, "trustpilot"],
  [/app store|tiendas? de apps/i, "appstore"],
  [/google play/i, "googleplay"],
  [/reseñ|review|comentarios/i, "reviews"],
  [/foro|forum/i, "forums"],
  [/búsqueda|busqueda|search/i, "search"],
  [/nps|encuesta|survey/i, "nps"],
  [/crm/i, "crm"],
  [/prensa|press|news|noticias/i, "press"]
];

function resolve(name: string): { mark: Mark | null; exact: boolean } {
  const key = name.trim().toLowerCase();
  const direct = MARKS[ALIASES[key] ?? key];
  if (direct) return { mark: direct, exact: true };
  const hit = CONTAINS.find(([pattern]) => pattern.test(name));
  return { mark: hit ? MARKS[hit[1]] ?? null : null, exact: false };
}

/** True when a source name resolves to a real mark (used by tests to enforce the icon rule). */
export function hasSourceMark(name: string): boolean {
  return resolve(name).mark !== null;
}

export function sourceLabel(name: string, locale: string): string {
  const { mark, exact } = resolve(name);
  if (!mark || !exact) return name;
  return mark.kind === "brand" ? mark.label : mark.label[locale === "en" ? "en" : "es"];
}

/** The icon alone, sized in CSS pixels (or canvas pixels inside a composition). */
export function SourceIcon({ name, size = 16, mono, style }: { name: string; size?: number; mono?: string; style?: CSSProperties }) {
  const { mark } = resolve(name);
  if (!mark) return <ChatLines width={size} height={size} strokeWidth={1.8} aria-hidden style={{ flex: "none", ...style }} />;
  if (mark.kind === "generic") return <mark.Icon width={size} height={size} strokeWidth={1.8} aria-hidden style={{ flex: "none", ...style }} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={mono ?? mark.hex} aria-hidden style={{ flex: "none", ...style }}>
      <path d={mark.path} />
    </svg>
  );
}

/** Icon plus localized name, the default way to show a source. */
export function SourceMark({ name, locale, size = 16, className, style }: { name: string; locale: string; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.4), ...style }}>
      <SourceIcon name={name} size={size} />
      {sourceLabel(name, locale)}
    </span>
  );
}
