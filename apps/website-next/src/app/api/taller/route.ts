import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().min(1).max(160),
  role: z.string().trim().max(120).optional().default(""),
  question: z.string().trim().min(8).max(2000),
  market: z.string().trim().max(160).optional().default(""),
  when: z.string().trim().max(60).optional().default(""),
  locale: z.enum(["es", "en"]).default("es"),
  // Honeypot: real people never fill it.
  website: z.string().max(500).optional().default("")
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  const body = parsed.data;
  // A filled honeypot is a bot: answer as if it worked and drop it.
  if (body.website) return NextResponse.json({ ok: true });

  const text = [
    `TALLER NOISIA · ${new Date().toISOString()} · ${body.locale.toUpperCase()}`,
    "",
    `Nombre: ${body.name}`,
    `Correo: ${body.email}`,
    `Empresa: ${body.company}`,
    `Puesto: ${body.role || "(sin dato)"}`,
    `Mercado: ${body.market || "(sin dato)"}`,
    `Para cuándo: ${body.when || "(sin dato)"}`,
    "",
    "PREGUNTA",
    body.question
  ].join("\n");

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[taller] RESEND_API_KEY is not set; request:\n", text);
    // In production a request that can't be delivered must not look like a success.
    if (process.env.NODE_ENV === "production") {
      console.error("[taller] refusing workshop request: email delivery is not configured");
      return NextResponse.json({ ok: false, error: "delivery_not_configured" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, delivered: false });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.WORKSHOP_FROM_EMAIL || "contacto@noisia.ai",
      to: [process.env.WORKSHOP_TO_EMAIL || "hola@noisia.ai"],
      reply_to: body.email,
      subject: `Taller: ${body.company} · ${body.name}`,
      text
    })
  }).catch(() => null);

  if (!response?.ok) {
    console.error("[taller] email delivery failed", response?.status);
    return NextResponse.json({ ok: false, error: "delivery_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, delivered: true });
}
