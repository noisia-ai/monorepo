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

export function renderInvitationEmail(args: {
  appName: string;
  loginUrl: string;
  roleLabel: string;
  organizationName?: string | null;
}) {
  const appName = escapeHtml(args.appName);
  const loginUrl = escapeAttribute(args.loginUrl);
  const roleLabel = escapeHtml(args.roleLabel);
  const organizationName = args.organizationName ? escapeHtml(args.organizationName) : null;
  const html = `
    <div style="margin:0;background:#f4f5f6;padding:34px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0a0a0a;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ea;border-radius:18px;overflow:hidden;">
        <div style="background:#05020f;color:#ffffff;padding:30px 34px;">
          <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#00eeee;font-weight:800;">Noisia Studio</div>
          <h1 style="font-size:30px;line-height:1.08;margin:14px 0 10px;font-weight:800;">Te invitaron a ${appName}</h1>
          <p style="margin:0;color:rgba(255,255,255,.72);font-size:15px;line-height:1.55;">
            Activa tu acceso para revisar estudios, señales y entregables compartidos por Noisia.
          </p>
        </div>
        <div style="padding:30px 34px;">
          <div style="background:#fafafa;border:1px solid #e6e8ea;border-radius:14px;padding:18px 20px;margin-bottom:24px;">
            <p style="margin:0 0 10px;color:#5b6168;font-size:13px;line-height:1.5;">Tu acceso quedó preconfigurado como:</p>
            <p style="margin:0;color:#0a0a0a;font-size:17px;line-height:1.45;font-weight:800;">${roleLabel}</p>
            ${organizationName ? `<p style="margin:6px 0 0;color:#5b6168;font-size:14px;line-height:1.45;">Organización: ${organizationName}</p>` : ""}
          </div>
          <p style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#20232a;">
            Entra con este mismo correo. Después del login, Noisia terminará de activar tu cuenta y te llevará al workspace correcto.
          </p>
          <a href="${loginUrl}" style="display:inline-block;background:#008a8a;color:#ffffff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:800;font-size:15px;">
            Activar acceso
          </a>
          <p style="font-size:12px;color:#8a9099;line-height:1.5;margin:20px 0 0;">
            Si el botón no funciona, copia esta liga:<br />
            <span style="word-break:break-all;color:#5b6168;">${loginUrl}</span>
          </p>
        </div>
      </div>
    </div>
  `;
  const text = [
    `Te invitaron a ${args.appName}.`,
    `Rol: ${args.roleLabel}`,
    args.organizationName ? `Organización: ${args.organizationName}` : "",
    "Entra con este mismo correo para activar tu cuenta.",
    args.loginUrl
  ].filter(Boolean).join("\n\n");
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
  loginUrl: string;
  roleLabel: string;
}) {
  const brandLabel = escapeHtml(args.brandLabel);
  const methodologyName = escapeHtml(args.methodologyName);
  const reportTitle = escapeHtml(args.reportTitle);
  const executiveRead = escapeHtml(args.executiveRead);
  const reportUrl = escapeAttribute(args.reportUrl);
  const loginUrl = escapeAttribute(args.loginUrl);
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

          <a href="${loginUrl}" style="display:inline-block;background:#008a8a;color:#ffffff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:800;font-size:15px;">
            Abrir reporte interactivo
          </a>
          <p style="font-size:12px;color:#8a9099;line-height:1.5;margin:18px 0 0;">
            Entra con este correo. Noisia asignará acceso como ${escapeHtml(args.roleLabel)} dentro de la organización del estudio.
            <br />Liga directa del reporte: <span style="word-break:break-all;color:#5b6168;">${reportUrl}</span>
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
    `Abrir reporte: ${args.loginUrl}`,
    `Liga directa: ${args.reportUrl}`,
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
