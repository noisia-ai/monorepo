/**
 * The email a reader gets after opening a `registro` study: their personal link, in Noisia's email
 * system (pitch-kit NOTIFICATIONS.md §2: white 600 px card on #f4f4f4, Google Sans, black pill,
 * tables and inline styles, light mode forced).
 *
 * The study's image and the logo go inside the email by CID (`cid:study`, `cid:noisia`), never by
 * URL: Outlook.com, Hotmail and many company clients block remote images until the reader allows
 * them. The route attaches them (send-email.ts `inlineAttachments`). Design notes and the image
 * rules: content-db/STUDY_EMAIL.md.
 */

type Email = { subject: string; html: string; text: string };

export type StudyEmailVars = {
  name: string;
  title: string;
  dek: string;
  /** "Triggers & Barriers · ene–oct 2026" */
  eyebrow: string;
  slides: number;
  link: string;
  /** Up to two key figures of the study. */
  stats: { value: string; label: string }[];
  /** The study's banner, attached as `cid:study`. Null leaves the email without it. */
  image: { alt: string } | null;
};

const copy = {
  es: {
    subject: (title: string) => `${title} · tu link personal`,
    preheader: () => "Tu link personal al estudio completo.",
    hello: (name: string) => `Hola, ${name}.`,
    intro: "Ya tienes el estudio completo. Guarda este correo para volver.",
    slides: (n: number) => `${n} láminas`,
    button: "Abrir el estudio completo",
    note: "Tu link personal, válido por un año:",
    noteText: "Tu link personal, válido por un año.",
    invite: "¿Quieres algo así para tu marca? Responde este correo.",
    footer: "Recibes este correo porque abriste un estudio en noisia.ai."
  },
  en: {
    subject: (title: string) => `${title} · your personal link`,
    preheader: () => "Your personal link to the full study.",
    hello: (name: string) => `Hi ${name},`,
    intro: "You have the full study. Keep this email to come back.",
    slides: (n: number) => `${n} slides`,
    button: "Open the full study",
    note: "Your personal link, valid for a year:",
    noteText: "Your personal link, valid for a year.",
    invite: "Want this for your brand? Reply to this email.",
    footer: "You are receiving this email because you opened a study on noisia.ai."
  }
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FONT = "'Google Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
const INK = "#0a0a0a";
const BODY = "#2b2b2b";
const MUTED = "#6d6d6d";
const LINE = "#e6e6e6";

export function studyAccessEmail(lang: "es" | "en", vars: StudyEmailVars): Email {
  const c = copy[lang];
  const name = escapeHtml(vars.name);
  const title = escapeHtml(vars.title);
  const link = escapeHtml(vars.link);
  const eyebrow = escapeHtml(`${vars.eyebrow} · ${c.slides(vars.slides)}`);
  const stats = vars.stats.slice(0, 2);

  const image = vars.image
    ? `<tr><td class="pad" style="padding:24px 40px 0 40px;">
      <a href="${link}" style="text-decoration:none;"><img src="cid:study" width="520" height="280" alt="${escapeHtml(vars.image.alt)}" style="display:block;border:0;width:100%;max-width:520px;height:auto;border-radius:12px;background:#ffffff;color:${MUTED};font-family:${FONT};font-size:13px;"></a>
    </td></tr>`
    : "";

  const width = stats.length === 1 ? "100%" : "50%";
  const tile = (stat: { value: string; label: string }, padding: string) => `<td class="tile" width="${width}" valign="top" style="width:${width};padding:${padding};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:10px;">
            <tr><td style="padding:14px 16px;font-family:${FONT};">
              <p style="margin:0 0 4px 0;font-size:22px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(stat.value)}</p>
              <p style="margin:0;font-size:13px;line-height:18px;color:${MUTED};">${escapeHtml(stat.label)}</p>
            </td></tr>
          </table>
        </td>`;
  const tiles =
    stats.length === 0
      ? ""
      : `<tr><td class="pad" style="padding:20px 40px 0 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${stats.length === 1 ? tile(stats[0]!, "0") : `${tile(stats[0]!, "0 6px 0 0")}\n        ${tile(stats[1]!, "0 0 0 6px")}`}
      </tr></table>
    </td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no">
<title>${title}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin:0; padding:0; background:#f4f4f4; }
  a { color:#008a8a; }
  @media (max-width:620px) {
    .card { width:100% !important; border-radius:0 !important; }
    .pad { padding-left:24px !important; padding-right:24px !important; }
    .tile { display:block !important; width:100% !important; padding:0 0 10px 0 !important; }
    .h1 { font-size:24px !important; line-height:31px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f4f4f4;">${escapeHtml(c.preheader())}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">
    <tr><td class="pad" style="padding:28px 40px 4px 40px;">
      <a href="https://noisia.ai" style="text-decoration:none;"><img src="cid:noisia" width="110" height="38" alt="Noisia" style="display:block;border:0;width:110px;height:38px;color:${INK};font-family:${FONT};font-size:20px;font-weight:700;"></a>
    </td></tr>
    <tr><td class="pad" style="padding:20px 40px 0 40px;font-family:${FONT};">
      <p style="margin:0 0 10px 0;font-size:15px;line-height:23px;color:${BODY};">${c.hello(name)}</p>
      <p style="margin:0;font-size:15px;line-height:23px;color:${BODY};">${c.intro}</p>
    </td></tr>
    ${image}
    <tr><td class="pad" style="padding:22px 40px 0 40px;font-family:${FONT};">
      <p style="margin:0 0 8px 0;font-size:11px;line-height:16px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};">${eyebrow}</p>
      <h1 class="h1" style="margin:0 0 10px 0;font-size:26px;line-height:34px;font-weight:700;color:${INK};">${title}</h1>
      <p style="margin:0;font-size:15px;line-height:23px;color:${BODY};">${escapeHtml(vars.dek)}</p>
    </td></tr>
    ${tiles}
    <tr><td class="pad" style="padding:24px 40px 0 40px;font-family:${FONT};">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${link}" style="height:48px;v-text-anchor:middle;width:270px;" arcsize="50%" stroke="f" fillcolor="${INK}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${c.button}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${link}" style="display:inline-block;background:${INK};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:700;line-height:48px;padding:0 30px;border-radius:999px;text-decoration:none;mso-hide:all;">${c.button}</a>
      <!--<![endif]-->
    </td></tr>
    <tr><td class="pad" style="padding:28px 40px 0 40px;font-family:${FONT};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef8f8;border-radius:10px;">
        <tr><td style="padding:16px 20px;font-size:14px;line-height:21px;color:${BODY};">
          ${c.note}<br>
          <a href="${link}" style="color:#008a8a;word-break:break-all;">${link}</a>
        </td></tr>
      </table>
    </td></tr>
    <tr><td class="pad" style="padding:24px 40px 32px 40px;font-family:${FONT};">
      <p style="margin:0;font-size:15px;line-height:23px;color:${BODY};">${c.invite}</p>
    </td></tr>
    <tr><td class="pad" style="padding:20px 40px 28px 40px;border-top:1px solid ${LINE};font-family:${FONT};">
      <p style="margin:0 0 4px 0;font-size:12px;line-height:18px;color:${MUTED};">Noisia · social intelligence architects · <a href="https://noisia.ai" style="color:${MUTED};text-decoration:underline;">noisia.ai</a></p>
      <p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">${c.footer}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;

  const text = [
    c.hello(vars.name),
    "",
    c.intro,
    "",
    `${vars.eyebrow} · ${c.slides(vars.slides)}`,
    vars.title,
    vars.dek,
    ...stats.map((stat) => `- ${stat.value}: ${stat.label}`),
    "",
    `${c.button}:`,
    vars.link,
    "",
    c.noteText,
    "",
    c.invite,
    "",
    "--",
    "Noisia · social intelligence architects · https://noisia.ai",
    c.footer
  ].join("\n");

  return { subject: c.subject(vars.title), html, text };
}
