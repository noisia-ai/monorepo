import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

/**
 * Staging (UAT) guard: with UAT_PASSWORD set, every page asks for basic auth (any user,
 * that password); with NOISIA_UAT=1 nothing is indexed. Production sets neither.
 */
export default function middleware(request: NextRequest) {
  const password = process.env.UAT_PASSWORD;
  if (password) {
    const header = request.headers.get("authorization") ?? "";
    const [scheme, encoded] = header.split(" ");
    const supplied = scheme === "Basic" && encoded ? atob(encoded).split(":").slice(1).join(":") : null;
    if (supplied !== password) {
      return new NextResponse("Noisia UAT", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Noisia UAT", charset="UTF-8"' } });
    }
  }
  const response = intl(request);
  if (process.env.NOISIA_UAT === "1") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response ?? NextResponse.next();
}

export const config = {
  // Skip API routes, Next internals and any file with an extension (fonts, images, llms.txt).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"]
};
