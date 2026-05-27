import { canAccessPortal, canAccessStudio, defaultAuthenticatedPath } from "@/lib/auth/roles";

export function loginPath(next = "/studio") {
  return `/login?next=${encodeURIComponent(safeRelativePath(next, "/studio"))}`;
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
