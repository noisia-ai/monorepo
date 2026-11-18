import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getStudy } from "@/content/studies";
import { CODE_MINUTES, newCode, pendingCookieName, startSignup } from "@/lib/content/access";
import { studyCodeEmail } from "@/lib/content/study-code-email";
import { LOGO_PNG_BASE64 } from "@/lib/content/email-logo";
import { clientIp, inlineAttachments, rateLimiter, sendEmail } from "@/lib/content/send-email";
import { requestOrigin } from "@/lib/site";

/**
 * Step 1 of opening a `registro` study: the reader leaves name, email and company and gets a
 * 4-digit code by email. The browser keeps a pending secret in a short cookie; step 2
 * (`unlock/verify`) checks the code against it and opens the study.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().min(1).max(160),
  marketing: z.boolean().optional().default(false),
  locale: z.enum(["es", "en"]).default("es"),
  slide: z.number().int().min(1).max(999).optional(),
  // Honeypot: real people never fill it.
  website: z.string().max(500).optional().default("")
});

const limited = rateLimiter(10, 10 * 60 * 1000);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (Number(request.headers.get("content-length") ?? 0) > 8_000) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  if (limited(clientIp(request))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  const body = parsed.data;

  const { id } = await params;
  const study = await getStudy(id).catch(() => undefined);
  if (!study || study.accessMode !== "registro") return NextResponse.json({ ok: false, error: "not_open_for_signup" }, { status: 404 });
  // A filled honeypot is a bot: answer as if it worked, store nothing, send nothing.
  if (body.website) return NextResponse.json({ ok: true });

  const pending = randomBytes(18).toString("base64url");
  const code = newCode();
  let ok = false;
  try {
    ok = await startSignup(study.id, pending, code, { name: body.name, email: body.email, company: body.company, marketing: body.marketing, lang: body.locale });
  } catch (error) {
    console.error(`[unlock] Could not start a sign-up for ${study.id}: ${(error as Error).message}`);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
  if (!ok) return NextResponse.json({ ok: false, error: "rejected" }, { status: 429 });

  const origin = requestOrigin(request);
  const lang = body.locale;
  const page = new URL(lang === "en" ? `/en/insights/studies/${study.id}/full` : `/insights/estudios/${study.id}/completo`, origin.origin);
  if (body.slide) page.searchParams.set("slide", String(body.slide));
  page.searchParams.set("code", code);
  const email = studyCodeEmail(lang, { name: body.name, title: study.summary[lang].title, code, link: page.toString() });

  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      console.error("[unlock] RESEND_API_KEY is not set: the code cannot be sent");
      return NextResponse.json({ ok: false, error: "email_failed" }, { status: 503 });
    }
    // Local development without email: the code shows in the server log.
    console.log(`[unlock] dev code for ${study.id}: ${code}`);
  } else if (!(await sendEmail({
      to: [body.email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: inlineAttachments([{ id: "noisia", filename: "noisia.png", bytes: LOGO_PNG_BASE64, contentType: "image/png" }])
    }))) {
    console.error(`[unlock] Could not send the code for ${study.id}`);
    return NextResponse.json({ ok: false, error: "email_failed" }, { status: 502 });
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(pendingCookieName(study.id), pending, {
    httpOnly: true,
    secure: origin.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: CODE_MINUTES * 60
  });
  return response;
}
