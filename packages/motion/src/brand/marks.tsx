import {
  siAppstore, siDiscord, siFacebook, siGoogle, siGooglemaps, siGoogleplay, siInstagram, siPinterest, siReddit,
  siSpotify, siTelegram, siThreads, siTiktok, siTripadvisor, siTrustpilot, siTwitch, siWhatsapp, siX, siYoutube
} from "simple-icons";
import kitIcons from "../../../pitch-kit/assets/icons.json";
import { color } from "./theme";

/**
 * Every platform carries its real logo (Simple Icons), never its name alone and never a Unicode
 * stand-in like 𝕏 or ▶ (VIDEO.md §2). Generic sources use the kit's Iconoir set (assets/icons.json).
 */
type Brand = { label: string; path: string; hex: string };
const b = (label: string, icon: { path: string; hex: string }): Brand => ({ label, path: icon.path, hex: `#${icon.hex}` });

const BRANDS: Record<string, Brand> = {
  tiktok: b("TikTok", siTiktok), instagram: b("Instagram", siInstagram), youtube: b("YouTube", siYoutube), x: b("X", siX),
  facebook: b("Facebook", siFacebook), reddit: b("Reddit", siReddit), threads: b("Threads", siThreads), google: b("Google", siGoogle),
  googlemaps: b("Google Maps", siGooglemaps), tripadvisor: b("Tripadvisor", siTripadvisor), trustpilot: b("Trustpilot", siTrustpilot),
  appstore: b("App Store", siAppstore), googleplay: b("Google Play", siGoogleplay), twitch: b("Twitch", siTwitch),
  spotify: b("Spotify", siSpotify), whatsapp: b("WhatsApp", siWhatsapp), telegram: b("Telegram", siTelegram),
  pinterest: b("Pinterest", siPinterest), discord: b("Discord", siDiscord)
};
const ALIASES: Record<string, string> = { twitter: "x", "google play": "googleplay", "app store": "appstore", "google maps": "googlemaps" };

const GENERIC: Record<string, { es: string; en: string; icon: string }> = {
  reviews: { es: "Reseñas", en: "Reviews", icon: "chat-bubble" },
  forums: { es: "Foros", en: "Forums", icon: "chat-bubble" },
  press: { es: "Prensa", en: "Press", icon: "reports" },
  search: { es: "Búsqueda", en: "Search", icon: "search" },
  news: { es: "Noticias", en: "News", icon: "reports" },
  blogs: { es: "Blogs", en: "Blogs", icon: "book" }
};

const IC = (kitIcons as { ic: Record<string, string> }).ic;

export function iconNames(): string[] {
  return Object.keys(IC);
}

/** A kit icon (Iconoir outline, the same glyphs as the decks). */
export function Icon({ name, size = 40, stroke = color.teal, width = 1.6 }: { name: string; size?: number; stroke?: string; width?: number }) {
  const body = IC[name];
  if (!body) throw new Error(`Unknown kit icon "${name}". See packages/pitch-kit/assets/icons.json`);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ color: stroke, strokeWidth: width, flex: "none" }} dangerouslySetInnerHTML={{ __html: body }} />
  );
}

function key(platform: string) {
  const k = platform.trim().toLowerCase();
  return ALIASES[k] ?? k;
}

export function platformLabel(platform: string, locale: string): string {
  const k = key(platform);
  if (BRANDS[k]) return BRANDS[k].label;
  if (GENERIC[k]) return locale.startsWith("en") ? GENERIC[k].en : GENERIC[k].es;
  return platform;
}

/** The platform's logo in its brand colour (X and TikTok in ink). */
export function PlatformMark({ platform, size = 44, tone }: { platform: string; size?: number; tone?: string }) {
  const k = key(platform);
  const brand = BRANDS[k];
  if (brand) {
    const fill = tone ?? (["x", "tiktok", "threads"].includes(k) ? color.ink : brand.hex);
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none" }} aria-label={brand.label}>
        <path d={brand.path} fill={fill} />
      </svg>
    );
  }
  const generic = GENERIC[k];
  if (generic) return <Icon name={generic.icon} size={size} stroke={tone ?? color.fg} />;
  throw new Error(`No logo for platform "${platform}". Add it to src/brand/marks.tsx before using it.`);
}
