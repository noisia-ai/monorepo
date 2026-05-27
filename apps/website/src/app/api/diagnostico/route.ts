import { NextRequest, NextResponse } from "next/server";

const situationLabels: Record<string, string> = {
  "no-compra": "No sé por qué la gente no compra",
  "competencia-share": "Mi competencia me come share",
  "journey-roto": "Mi journey está roto y no sé dónde",
  "territorio-creativo": "No sé qué territorio creativo defender",
  "comunicacion-nodos": "Mi comunicación no llega a los nodos correctos",
  "decision-lenta": "El consumidor decide lento en mi categoría",
  "otra": "Otra pregunta estratégica",
};

const caseLabels: Record<string, string> = {
  "lanzamiento-de-campana": "Lanzamiento de campaña",
  "optimizacion-de-medios": "Optimización de medios",
  "desarrollo-de-producto": "Desarrollo de producto",
  "entrada-a-nuevo-mercado": "Nuevo mercado",
  "defensa-competitiva": "Defensa competitiva",
  "anticipacion-de-tendencias": "Anticipación de tendencias",
};

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    situation: string;
    situationOther: string;
    caseSlug: string;
    assets: string[];
    industry: string;
    markets: string[];
    name: string;
    email: string;
    phone: string;
  };

  const situationLabel = situationLabels[body.situation] ?? body.situation;
  const caseLabel = caseLabels[body.caseSlug] ?? body.caseSlug;

  const text = `
DIAGNÓSTICO NOISIA — ${new Date().toISOString()}

CONTACTO
Nombre: ${body.name}
Email:  ${body.email}
Teléfono: ${body.phone || "—"}

SITUACIÓN
${situationLabel}${body.situationOther ? `\nDetalle: ${body.situationOther}` : ""}

CASO DE USO
${caseLabel}

EVIDENCIA DISPONIBLE
${body.assets.length > 0 ? body.assets.join(", ") : "Ninguna"}

CATEGORÍA
${body.industry || "—"}

MERCADOS
${body.markets.length > 0 ? body.markets.join(", ") : "—"}
`.trim();

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "diagnostico@noisia.ai",
          to: ["fer@noisia.ai"],
          reply_to: body.email,
          subject: `Diagnóstico: ${body.name} — ${situationLabel}`,
          text,
        }),
      });
    } catch {
      // log but don't fail — response to user should succeed regardless
      console.error("[diagnostico] Resend send failed");
    }
  } else {
    console.log("[diagnostico] No RESEND_API_KEY — form data:\n", text);
  }

  return NextResponse.json({ ok: true });
}
