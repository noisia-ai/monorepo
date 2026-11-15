import { NextResponse } from "next/server";
import { getStudy } from "@/content/studies";
import { accessCookieName, linkStudy, TOKEN_PATTERN } from "@/lib/content/access";

/**
 * A personal link: noisia.ai/e/<token>. It unlocks one study for whoever holds it and sends
 * them straight to the full study. `?lang=en` opens the English page.
 *
 * The token goes into a cookie scoped to that study, so the deck's files can check it on every
 * request. An unknown or expired link lands on the studies index.
 */

export const dynamic = "force-dynamic";

const LINK_COOKIE_DAYS = 90;

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(request.url);
  const english = url.searchParams.get("lang") === "en";
  const index = english ? "/en/insights/studies" : "/insights/estudios";

  let studyId: string | null = null;
  if (TOKEN_PATTERN.test(token)) {
    try {
      studyId = await linkStudy(token);
    } catch (error) {
      console.error(`[content] Could not check a personal link: ${(error as Error).message}`);
    }
  }
  const study = studyId ? await getStudy(studyId) : undefined;
  const target = study ? (english ? `/en/insights/studies/${study.id}/full` : `/insights/estudios/${study.id}/completo`) : `${index}?enlace=vencido`;

  const response = NextResponse.redirect(new URL(target, url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (study) {
    response.cookies.set(accessCookieName(study.id), token, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: LINK_COOKIE_DAYS * 24 * 60 * 60
    });
  }
  return response;
}
