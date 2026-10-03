import { NextResponse, type NextRequest } from "next/server";

import { getLocaleFromPreferences, localeCookieName } from "@/i18n/locales";
import { canonicalAppUrl, loginPath, postLoginPath } from "@/lib/auth/redirects";
import { getAuthenticatedAppUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Punto de aterrizaje tras el callback de Kinde. Debe SETEAR cookie + REDIRIGIR,
// y eso solo es legal en un Route Handler (no en el render de una page). Antes
// era una page que hacia cookies().set() en render, lo que en Next 15 lanza
// "Cookies can only be modified in a Server Action or Route Handler" y tumbaba
// el login justo despues de autenticar.
export async function GET(request: NextRequest) {
  const session = await getAuthenticatedAppUser();
  const next = request.nextUrl.searchParams.get("next");

  if (!session) {
    const loginUrl = new URL(canonicalAppUrl(loginPath(next || "/studio")), request.url);
    return noStoreRedirect(loginUrl);
  }

  const destination = new URL(canonicalAppUrl(postLoginPath(session.appUser.primaryRole, next)), request.url);
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
