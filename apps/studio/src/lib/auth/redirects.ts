import { canAccessPortal, canAccessStudio, defaultAuthenticatedPath } from "@/lib/auth/roles";

// Mandamos a los usuarios sin sesión DIRECTO a Kinde (sin la pantalla
// intermedia /login). Kinde, tras autenticar, vuelve a /auth/continue, que
// decide el destino por rol preservando `next`.
export function loginPath(next = "/studio") {
  const safeNext = safeRelativePath(next, "/studio");
  const relativePath = `/api/auth/login?post_login_redirect_url=${encodeURIComponent(authContinuePath(safeNext))}`;
  const siteUrl = parseSiteUrl(process.env.KINDE_SITE_URL);

  return siteUrl ? new URL(relativePath, siteUrl).toString() : relativePath;
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
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.startsWith("/api/")) return fallback;
  return value;
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
