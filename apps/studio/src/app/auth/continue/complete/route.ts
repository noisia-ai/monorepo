import { NextResponse, type NextRequest } from "next/server";

import { getLocaleFromPreferences, localeCookieName } from "@/i18n/locales";
import { postLoginPath } from "@/lib/auth/redirects";
import { getAuthenticatedAppUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedAppUser();
  const next = request.nextUrl.searchParams.get("next");

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    if (next) loginUrl.searchParams.set("next", next);
    return noStoreRedirect(loginUrl);
  }

  const destination = new URL(postLoginPath(session.appUser.primaryRole, next), request.url);
  const response = noStoreRedirect(destination);
  const preferredLocale = getLocaleFromPreferences(session.appUser.preferences);

  if (preferredLocale) {
    response.cookies.set(localeCookieName, preferredLocale, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/"
    });
  }

  return response;
}

function noStoreRedirect(destination: URL) {
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
