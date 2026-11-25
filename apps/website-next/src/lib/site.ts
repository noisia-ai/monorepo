export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://noisia.ai").replace(/\/$/, "");

const HOST_PATTERN = /^[a-z0-9.-]+(?::\d+)?$/i;

/**
 * Hosts a link may point to: the site's own, noisia.ai with and without www, local development,
 * and any extra host in SITE_HOSTS (comma-separated, e.g. a UAT domain). Links built from a
 * request go into emails, so a forged Host or X-Forwarded-Host must never choose the domain.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
function allowedHosts(): Set<string> {
  const hosts = new Set(["noisia.ai", "www.noisia.ai", new URL(SITE_URL).host.toLowerCase()]);
  for (const host of (process.env.SITE_HOSTS ?? "").split(",")) if (host.trim()) hosts.add(host.trim().toLowerCase());
  return hosts;
}

/**
 * The origin the visitor used. Behind Railway's proxy `request.url` carries the server's own
 * address (0.0.0.0:8080), so redirects are built from the forwarded host instead. Falls back to
 * SITE_URL when the headers are missing, look wrong or name a host that is not the site's.
 */
export function requestOrigin(request: Request): URL {
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  if (!host || !HOST_PATTERN.test(host)) return new URL(SITE_URL);
  if (!LOCAL_HOST.test(host) && !allowedHosts().has(host.toLowerCase())) return new URL(SITE_URL);
  const proto = first(request.headers.get("x-forwarded-proto")) ?? new URL(request.url).protocol.replace(":", "");
  return new URL(`${proto === "http" ? "http" : "https"}://${host}`);
}

/**
 * The visitor's IP. Cloudflare sets `cf-connecting-ip` and overwrites any value the visitor sends.
 * The first entry of `x-forwarded-for` is whatever the visitor wrote, so it is never trusted: when
 * there is no Cloudflare header, the last entry (added by the nearest proxy) is used instead.
 */
export function clientIp(request: Request): string {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;
  const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded[forwarded.length - 1] || request.headers.get("x-real-ip")?.trim() || "unknown";
}
