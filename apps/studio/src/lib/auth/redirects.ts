import { canAccessPortal, canAccessStudio, defaultAuthenticatedPath } from "@/lib/auth/roles";

// Mandamos a los usuarios sin sesión DIRECTO a Kinde (sin la pantalla
// intermedia /login). Kinde, tras autenticar, vuelve a /auth/continue, que
// decide el destino por rol preservando `next`.
export function loginPath(next = "/studio") {
  const safeNext = safeRelativePath(next, "/studio");
  const postLoginRedirectUrl = canonicalAppUrl(authContinuePath(safeNext));
  const relativePath = `/api/auth/login?post_login_redirect_url=${encodeURIComponent(postLoginRedirectUrl)}`;

  return canonicalAppUrl(relativePath);
}

export function sessionRefreshPath(next = "/studio") {
  const safeNext = safeSessionReturnPath(next, "/studio");
  return `/auth/session/refresh?next=${encodeURIComponent(safeNext)}`;
}

export function canonicalAppUrl(path: string) {
  const siteUrl = parseSiteUrl(process.env.KINDE_SITE_URL)
    ?? parseSiteUrl(process.env.NEXT_PUBLIC_APP_URL);

  return siteUrl ? new URL(path, siteUrl).toString() : path;
}

export function authContinuePath(next?: string | null) {
  const safeNext = safeRelativePath(next, "");
  return safeNext ? `/auth/continue?next=${encodeURIComponent(safeNext)}` : "/auth/continue";
}

export function postLoginPath(role: string, next?: string | null) {
  const safeNext = safeRelativePath(next, "");

  if (safeNext.startsWith("/studio") && canAccessStudio(role)) {
    return safeNext;
  }

  if (safeNext.startsWith("/portal") && canAccessPortal(role)) {
    return safeNext;
  }

  if (safeNext && !safeNext.startsWith("/api/")) {
    return safeNext.startsWith("/studio") ? `/unauthorized?next=${encodeURIComponent(safeNext)}` : safeNext;
  }

  return defaultAuthenticatedPath(role);
}

export function safeRelativePath(value: unknown, fallback = "/studio") {
  if (typeof value !== "string") return fallback;
  if (/[\\\u0000-\u001F\u007F]/u.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const canonical = new URL(value, "https://noisia.invalid");
    const decodedPathname = canonicalDecodedPathname(canonical.pathname);
    if (!decodedPathname) return fallback;
    if (/[\\\u0000-\u001F\u007F]/u.test(decodedPathname)) return fallback;
    if (isPathnameWithinRoot(decodedPathname, "/api")) return fallback;
    return `${canonical.pathname}${canonical.search}${canonical.hash}`;
  } catch {
    return fallback;
  }
}

export function safeSessionReturnPath(value: unknown, fallback = "/studio") {
  const safe = safeRelativePath(value, fallback);
  let pathname: string;
  try {
    const decoded = canonicalDecodedPathname(
      new URL(safe, "https://noisia.invalid").pathname
    );
    if (!decoded) return fallback;
    pathname = decoded;
  } catch {
    return fallback;
  }
  if (isForbiddenSessionReturnPathname(pathname)) {
    return fallback;
  }
  return safe;
}

function canonicalDecodedPathname(value: string) {
  let decoded = value;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) {
      return new URL(next, "https://noisia.invalid").pathname;
    }
    decoded = next;
  }
  return null;
}

function isForbiddenSessionReturnPathname(pathname: string) {
  return isPathnameWithinRoot(pathname, "/api")
    || isPathnameWithinRoot(pathname, "/auth")
    || isPathnameWithinRoot(pathname, "/login");
}

function isPathnameWithinRoot(pathname: string, root: string) {
  const normalizedPathname = pathname.toLowerCase();
  return normalizedPathname === root || normalizedPathname.startsWith(`${root}/`);
}

function parseSiteUrl(value: string | undefined) {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
