import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const contactSchema = z.object({
  firstName: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value.replace(/\D/g, "").length >= 8),
  message: z.string().trim().min(12),
  terms: z.literal(true)
});

export async function POST(req: NextRequest) {
  const parsed = contactSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const body = parsed.data;
  const fullName = `${body.firstName} ${body.lastName}`;
  const text = `
CONTACTO NOISIA — ${new Date().toISOString()}

Nombre: ${fullName}
Email: ${body.email}
Teléfono: ${body.phone}
Aceptó TyC: ${body.terms ? "Sí" : "No"}

MENSAJE
${body.message}
`.trim();

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "contacto@noisia.ai",
          to: ["hola@noisia.ai"],
          reply_to: body.email,
          subject: `Contacto web: ${fullName}`,
          text
        })
      });
    } catch {
      console.error("[contacto] Resend send failed");
    }
  } else {
    console.log("[contacto] No RESEND_API_KEY — form data:\n", text);
  }

  return NextResponse.json({ ok: true });
}
