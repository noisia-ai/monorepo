import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getStudy, getStudyFile } from "@/content/studies";
import { ACCESS_COOKIE_DAYS, accessCookieName, READER_COOKIE, readerValid, registerForStudy } from "@/lib/content/access";
import { studyAccessEmail } from "@/lib/content/study-email";
import { requestOrigin } from "@/lib/site";

/**
 * Unlocks a `registro` study for whoever leaves name, email and company in the viewer. Nothing is
 * verified: the study opens at once (two cookies: one for the study, one that remembers the reader
 * for the next study) and the reader also gets the personal link by email, so they can come back.
 * The team gets a note with the sign-up.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().min(1).max(160),
  marketing: z.boolean().optional().default(false),
  locale: z.enum(["es", "en"]).default("es"),
  // Honeypot: real people never fill it.
  website: z.string().max(500).optional().default("")
});

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const recent = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) for (const [key, times] of recent) if (now - times[times.length - 1]! > WINDOW_MS) recent.delete(key);
  return hits.length > MAX_PER_WINDOW;
}

async function send(apiKey: string, message: Record<string, unknown>): Promise<boolean> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(8000)
  }).catch(() => null);
  return Boolean(response?.ok);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (Number(request.headers.get("content-length") ?? 0) > 8_000) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  const body = parsed.data;

  const { id } = await params;
  const study = await getStudy(id).catch(() => undefined);
  if (!study || study.accessMode !== "registro") return NextResponse.json({ ok: false, error: "not_open_for_signup" }, { status: 404 });
  // A filled honeypot is a bot: answer as if it worked, store nothing, open nothing.
  if (body.website) return NextResponse.json({ ok: true });

  const token = randomBytes(18).toString("base64url");
  let ok = false;
  try {
    ok = await registerForStudy(study.id, token, { name: body.name, email: body.email, company: body.company, marketing: body.marketing, lang: body.locale });
  } catch (error) {
    console.error(`[unlock] Could not register for ${study.id}: ${(error as Error).message}`);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
  if (!ok) return NextResponse.json({ ok: false, error: "rejected" }, { status: 429 });

  const origin = requestOrigin(request);
  const cookieOptions = { httpOnly: true, secure: origin.protocol === "https:", sameSite: "lax" as const, path: "/", maxAge: ACCESS_COOKIE_DAYS * 24 * 60 * 60 };
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(accessCookieName(study.id), token, cookieOptions);
  // The first sign-up becomes the reader; a later one only replaces it if the old one stopped working.
  const reader = (await cookies()).get(READER_COOKIE)?.value;
  if (!reader || !(await readerValid(reader).catch(() => false))) response.cookies.set(READER_COOKIE, token, cookieOptions);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[unlock] RESEND_API_KEY is not set; sign-up for ${study.id} stored without email`);
    return response;
  }
  const lang = body.locale;
  const title = study.summary[lang].title;
  const link = `${origin.origin}/e/${token}${lang === "en" ? "?lang=en" : ""}`;
  const hasCover = Boolean(await getStudyFile(study, "email.jpg").catch(() => null));
  const cover = hasCover ? `${origin.origin}/api/content/studies/${study.id}/email.jpg?v=${study.version}` : null;
  const email = studyAccessEmail(lang, { name: body.name, title, link, cover, slides: study.slideCount });
  const from = process.env.STUDY_FROM_EMAIL || process.env.WORKSHOP_FROM_EMAIL || "contacto@noisia.ai";
  const team = process.env.WORKSHOP_TO_EMAIL || "hola@noisia.ai";
  const [reader_ok, team_ok] = await Promise.all([
    // Replies go to the team: the email invites the reader to answer.
    send(apiKey, { from, to: [body.email], reply_to: team, subject: email.subject, html: email.html, text: email.text }),
    send(apiKey, {
      from,
      to: [team],
      reply_to: body.email,
      subject: `Registro: ${study.id} · ${body.company}`,
      text: [`Nombre: ${body.name}`, `Correo: ${body.email}`, `Empresa: ${body.company}`, `Estudio: ${study.id}`, `Idioma: ${lang}`, `Acepta más estudios: ${body.marketing ? "sí" : "no"}`].join("\n")
    })
  ]);
  if (!reader_ok || !team_ok) console.error(`[unlock] email delivery failed for ${study.id} (reader ${reader_ok}, team ${team_ok})`);
  return response;
}
