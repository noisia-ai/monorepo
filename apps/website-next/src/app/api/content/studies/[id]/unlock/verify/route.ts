import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getStudy, getStudyFile } from "@/content/studies";
import { ACCESS_COOKIE_DAYS, accessCookieName, pendingCookieName, READER_COOKIE, readerValid, verifySignup } from "@/lib/content/access";
import { studyAccessEmail } from "@/lib/content/study-email";
import { clientIp, rateLimiter, sendEmail, TEAM_EMAIL } from "@/lib/content/send-email";
import { requestOrigin } from "@/lib/site";

/**
 * Step 2 of opening a `registro` study: the 4-digit code from the email. The right code turns the
 * sign-up into a personal link, opens the study in this browser (two cookies: one for the study,
 * one that remembers the reader for the next study), emails the reader the link to come back and
 * tells the team. Five wrong codes lock the sign-up; the reader asks for a new code.
 */

export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().regex(/^\d{4}$/) });

const limited = rateLimiter(30, 10 * 60 * 1000);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (Number(request.headers.get("content-length") ?? 0) > 1_000) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  if (limited(clientIp(request))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "wrong" }, { status: 400 });

  const { id } = await params;
  const study = await getStudy(id).catch(() => undefined);
  if (!study || study.accessMode !== "registro") return NextResponse.json({ ok: false, error: "not_open_for_signup" }, { status: 404 });
  const jar = await cookies();
  const pending = jar.get(pendingCookieName(study.id))?.value;
  if (!pending) return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });

  const token = randomBytes(18).toString("base64url");
  let result;
  try {
    result = await verifySignup(study.id, pending, parsed.data.code, token);
  } catch (error) {
    console.error(`[unlock] Could not check a code for ${study.id}: ${(error as Error).message}`);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
  if (result.status !== "ok") {
    const status = result.status === "wrong" ? 400 : result.status === "locked" ? 429 : 410;
    return NextResponse.json({ ok: false, error: result.status }, { status });
  }

  const origin = requestOrigin(request);
  const cookieOptions = { httpOnly: true, secure: origin.protocol === "https:", sameSite: "lax" as const, path: "/", maxAge: ACCESS_COOKIE_DAYS * 24 * 60 * 60 };
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(accessCookieName(study.id), token, cookieOptions);
  response.cookies.delete(pendingCookieName(study.id));
  // The first sign-up becomes the reader; a later one only replaces it if the old one stopped working.
  const reader = jar.get(READER_COOKIE)?.value;
  if (!reader || !(await readerValid(reader).catch(() => false))) response.cookies.set(READER_COOKIE, token, cookieOptions);

  const { person } = result;
  const lang = person.lang;
  const link = `${origin.origin}/e/${token}${lang === "en" ? "?lang=en" : ""}`;
  const hasCover = Boolean(await getStudyFile(study, "email.jpg").catch(() => null));
  const cover = hasCover ? `${origin.origin}/api/content/studies/${study.id}/email.jpg?v=${study.version}` : null;
  const email = studyAccessEmail(lang, { name: person.name, title: study.summary[lang].title, link, cover, slides: study.slideCount });
  const team = TEAM_EMAIL();
  const [readerOk, teamOk] = await Promise.all([
    // Replies go to the team: the email invites the reader to answer.
    sendEmail({ to: [person.email], reply_to: team, subject: email.subject, html: email.html, text: email.text }),
    sendEmail({
      to: [team],
      reply_to: person.email,
      subject: `Registro: ${study.id} · ${person.company}`,
      text: [`Nombre: ${person.name}`, `Correo: ${person.email} (verificado con código)`, `Empresa: ${person.company}`, `Estudio: ${study.id}`, `Idioma: ${lang}`, `Acepta más estudios: ${person.marketing ? "sí" : "no"}`].join("\n")
    })
  ]);
  if (process.env.RESEND_API_KEY && (!readerOk || !teamOk)) console.error(`[unlock] email delivery failed for ${study.id} (reader ${readerOk}, team ${teamOk})`);
  return response;
}
