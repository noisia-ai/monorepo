import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

/**
 * The home page follows the reader's language: the ES/EN toggle's NEXT_LOCALE cookie first,
 * then the device language. Deep links keep the language they were shared in.
 */
const CRAWLER = /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|preview|google-inspectiontool|chatgpt-user|claude-user|perplexity-user/i;

function preferredHomeLocale(request: NextRequest): "es" | "en" {
  // Crawlers and link previews read the canonical home (Spanish) and follow hreflang to /en.
  if (CRAWLER.test(request.headers.get("user-agent") ?? "")) return "es";
  const saved = request.cookies.get("NEXT_LOCALE")?.value;
  if (saved === "en" || saved === "es") return saved;
  const first = (request.headers.get("accept-language") ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "es";
}

/**
 * Staging (UAT) guard: with UAT_PASSWORD set, every page asks for basic auth (any user,
 * that password); with NOISIA_UAT=1 nothing is indexed. Production sets neither.
 */
export default function middleware(request: NextRequest) {
  const password = process.env.UAT_PASSWORD;
  if (password) {
    const header = request.headers.get("authorization") ?? "";
    const [scheme, encoded] = header.split(" ");
    let supplied: string | null = null;
    try {
      supplied = scheme === "Basic" && encoded ? atob(encoded).split(":").slice(1).join(":") : null;
    } catch {
      supplied = null;
    }
    if (supplied !== password) {
      return new NextResponse("Noisia UAT", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Noisia UAT", charset="UTF-8"' } });
    }
  }
  if (request.nextUrl.pathname === "/" && preferredHomeLocale(request) === "en") {
    const url = request.nextUrl.clone();
    url.pathname = "/en";
    const redirect = NextResponse.redirect(url, 307);
    redirect.headers.set("Vary", "Accept-Language, Cookie");
    if (process.env.NOISIA_UAT === "1") redirect.headers.set("X-Robots-Tag", "noindex, nofollow");
    return redirect;
  }
  const response = intl(request);
  if (process.env.NOISIA_UAT === "1") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response ?? NextResponse.next();
}

export const config = {
  // Skip API routes, Next internals and any file with an extension (fonts, images, llms.txt).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"]
};
