export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://noisia.ai").replace(/\/$/, "");

const HOST_PATTERN = /^[a-z0-9.-]+(?::\d+)?$/i;

/**
 * The origin the visitor used. Behind Railway's proxy `request.url` carries the server's own
 * address (0.0.0.0:8080), so redirects are built from the forwarded host instead. Falls back to
 * SITE_URL when the headers are missing or look wrong.
 */
export function requestOrigin(request: Request): URL {
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  if (!host || !HOST_PATTERN.test(host)) return new URL(SITE_URL);
  const proto = first(request.headers.get("x-forwarded-proto")) ?? new URL(request.url).protocol.replace(":", "");
  return new URL(`${proto === "http" ? "http" : "https"}://${host}`);
}
