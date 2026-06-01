// Envío de correo vía la API HTTP de Resend (sin SDK para no añadir dependencia).
// Es best-effort: si no hay API key o falla, devolvemos { ok: false } y el caller
// decide si lo trata como error suave (p.ej. la invitación se crea igual).

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const DEFAULT_FROM_EMAIL = "Noisia Studio <team@hey.noisia.ai>";

export async function sendEmail({ to, subject, html, text }: SendEmailArgs): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM_EMAIL;

  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY no configurado." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to, subject, html, text })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend respondió ${res.status}: ${body.slice(0, 300)}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error de red al enviar correo." };
  }
}

/** Plantilla mínima para el correo de invitación al workspace. */
export function renderInvitationEmail(args: { appName: string; loginUrl: string; roleLabel: string }) {
  const { appName, loginUrl, roleLabel } = args;
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h1 style="font-size: 20px;">Te invitaron a ${appName}</h1>
      <p>Tienes acceso como <strong>${roleLabel}</strong>. Entra con este correo para activar tu cuenta:</p>
      <p style="margin: 24px 0;">
        <a href="${loginUrl}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">
          Entrar a ${appName}
        </a>
      </p>
      <p style="color:#666;font-size:13px;">Si el botón no funciona, copia esta liga: ${loginUrl}</p>
    </div>
  `;
  const text = `Te invitaron a ${appName} como ${roleLabel}. Entra con tu correo para activar tu cuenta: ${loginUrl}`;
  return { html, text };
}

export function renderSignalShareEmail(args: {
  brandLabel: string;
  methodologyName: string;
  reportTitle: string;
  businessQuestion: string | null;
  executiveRead: string;
  highlights: string[];
  opportunities: string[];
  reportUrl: string;
  roleLabel: string;
}) {
  const brandLabel = escapeHtml(args.brandLabel);
  const methodologyName = escapeHtml(args.methodologyName);
  const reportTitle = escapeHtml(args.reportTitle);
  const executiveRead = escapeHtml(args.executiveRead);
  const reportUrl = escapeAttribute(args.reportUrl);
  const question = args.businessQuestion ? escapeHtml(args.businessQuestion) : null;
  const highlights = args.highlights.length > 0 ? args.highlights : ["La lectura completa está lista en el deck interactivo."];
  const opportunities = args.opportunities.length > 0 ? args.opportunities : ["Revisar el deck con el equipo y alinear próximos movimientos."];

  const html = `
    <div style="margin:0;background:#f4f5f6;padding:34px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0a0a0a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ea;border-radius:18px;overflow:hidden;">
        <div style="background:#061218;color:#ffffff;padding:30px 34px;">
          <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#00eeee;font-weight:800;">Noisia Signal</div>
          <h1 style="font-size:31px;line-height:1.04;margin:16px 0 12px;font-weight:700;">${reportTitle}</h1>
          <p style="margin:0;color:rgba(255,255,255,.72);font-size:15px;line-height:1.5;">${brandLabel} · ${methodologyName}</p>
        </div>
        <div style="padding:30px 34px;">
          ${question ? `<p style="margin:0 0 18px;color:#5b6168;font-size:14px;line-height:1.55;"><strong style="color:#0a0a0a;">Pregunta:</strong> ${question}</p>` : ""}
          <p style="font-size:18px;line-height:1.62;margin:0 0 24px;color:#20232a;">${executiveRead}</p>

          <div style="border-top:1px solid #e6e8ea;border-bottom:1px solid #e6e8ea;padding:22px 0;margin:0 0 24px;">
            <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#008a8a;font-weight:800;margin-bottom:12px;">Señales que vale la pena leer</div>
            ${renderEmailList(highlights)}
          </div>

          <div style="background:#fafafa;border:1px solid #e6e8ea;border-radius:14px;padding:20px;margin-bottom:26px;">
            <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#ee0b00;font-weight:800;margin-bottom:10px;">Decisiones abiertas</div>
            ${renderEmailList(opportunities)}
          </div>

          <a href="${reportUrl}" style="display:inline-block;background:#008a8a;color:#ffffff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:800;font-size:15px;">
            Abrir reporte interactivo
          </a>
          <p style="font-size:12px;color:#8a9099;line-height:1.5;margin:18px 0 0;">
            Entra con este correo. Noisia asignará acceso como ${escapeHtml(args.roleLabel)} dentro de la organización del estudio.
          </p>
        </div>
      </div>
    </div>
  `;

  const text = [
    args.reportTitle,
    `${args.brandLabel} · ${args.methodologyName}`,
    args.businessQuestion ? `Pregunta: ${args.businessQuestion}` : "",
    args.executiveRead,
    "Señales:",
    ...highlights.map((item) => `- ${item}`),
    "Decisiones abiertas:",
    ...opportunities.map((item) => `- ${item}`),
    `Abrir reporte: ${args.reportUrl}`,
    `Acceso: ${args.roleLabel}`
  ].filter(Boolean).join("\n\n");

  return { html, text };
}

function renderEmailList(items: string[]) {
  return `
    <ul style="padding:0;margin:0;list-style:none;">
      ${items.slice(0, 4).map((item) => `
        <li style="display:flex;gap:10px;margin:0 0 10px;font-size:15px;line-height:1.5;color:#20232a;">
          <span style="color:#008a8a;font-weight:900;">•</span>
          <span>${escapeHtml(item)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
