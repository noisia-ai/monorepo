/**
 * The email with the 4-digit code that opens a `registro` study. Same look as the access email
 * (study-email.ts): white card, Noisia logo (inline, `cid:noisia`), Google Sans, black pill button, tables for Outlook.
 *
 * The code goes first in the subject so it reads in the notification, and alone in its own block so
 * Gmail and Apple Mail offer to copy it. The button goes back to the study with the code in the
 * address: in the browser that asked for it, the study opens on its own.
 */

type Email = { subject: string; html: string; text: string };

const copy = {
  es: {
    subject: (code: string) => `${code} es tu código de Noisia`,
    preheader: "Vence en 30 minutos.",
    hello: (name: string) => `Hola, ${name}.`,
    intro: "Tu código para",
    use: "",
    button: "Abrir el estudio",
    expires: "Vence en 30 minutos.",
    ignore: "Si no lo pediste, ignora este correo.",
    footer: "Recibes este correo porque pediste abrir un estudio en noisia.ai."
  },
  en: {
    subject: (code: string) => `${code} is your Noisia code`,
    preheader: "It expires in 30 minutes.",
    hello: (name: string) => `Hi ${name},`,
    intro: "Your code for",
    use: "",
    button: "Open the study",
    expires: "It expires in 30 minutes.",
    ignore: "If you did not ask for it, ignore this email.",
    footer: "You are receiving this email because you asked to open a study on noisia.ai."
  }
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FONT = "'Google Sans','Helvetica Neue',Helvetica,Arial,sans-serif";

export function studyCodeEmail(lang: "es" | "en", vars: { name: string; title: string; code: string; link: string }): Email {
  const c = copy[lang];
  const name = escapeHtml(vars.name);
  const title = escapeHtml(vars.title);
  const link = escapeHtml(vars.link);
  const code = escapeHtml(vars.code);
  const p = (text: string, margin = "0") => `<p style="margin:${margin};font-size:15px;line-height:23px;color:#2b2b2b;">${text}</p>`;

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
<title>${escapeHtml(c.subject(vars.code))}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin:0; padding:0; background:#f4f4f4; }
  a { color:#008a8a; }
  @media (max-width:620px) {
    .card { width:100% !important; border-radius:0 !important; }
    .pad { padding-left:24px !important; padding-right:24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f4f4f4;">${escapeHtml(c.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e6e6e6;border-radius:14px;">
    <tr><td class="pad" style="padding:28px 40px 8px 40px;">
      <a href="https://noisia.ai" style="text-decoration:none;"><img src="cid:noisia" width="110" height="38" alt="Noisia" style="display:block;border:0;width:110px;height:38px;color:#0a0a0a;font-family:${FONT};font-size:20px;font-weight:700;"></a>
    </td></tr>
    <tr><td class="pad" style="padding:20px 40px 0 40px;font-family:${FONT};">
      ${p(c.hello(name), "0 0 12px 0")}
      ${p(`${c.intro} <strong style="color:#0a0a0a;">${title}</strong>:`)}
    </td></tr>
    <tr><td class="pad" style="padding:20px 40px 0 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef8f8;border-radius:12px;">
        <tr><td align="center" style="padding:22px 20px;font-family:'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace;font-size:40px;line-height:48px;font-weight:700;letter-spacing:.32em;color:#0a0a0a;">${code}</td></tr>
      </table>
    </td></tr>
    <tr><td class="pad" style="padding:20px 40px 0 40px;font-family:${FONT};">
      ${c.use ? p(c.use, "0 0 20px 0") : ""}
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${link}" style="height:46px;v-text-anchor:middle;width:210px;" arcsize="50%" stroke="f" fillcolor="#0a0a0a">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${c.button}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${link}" style="display:inline-block;background:#0a0a0a;color:#ffffff;font-family:${FONT};font-size:15px;font-weight:700;line-height:46px;padding:0 28px;border-radius:999px;text-decoration:none;mso-hide:all;">${c.button}</a>
      <!--<![endif]-->
    </td></tr>
    <tr><td class="pad" style="padding:24px 40px 32px 40px;font-family:${FONT};">
      <p style="margin:0 0 8px 0;font-size:14px;line-height:21px;color:#6d6d6d;">${c.expires}</p>
      <p style="margin:0;font-size:14px;line-height:21px;color:#6d6d6d;">${c.ignore}</p>
    </td></tr>
    <tr><td class="pad" style="padding:20px 40px 28px 40px;border-top:1px solid #e6e6e6;font-family:${FONT};">
      <p style="margin:0 0 4px 0;font-size:12px;line-height:18px;color:#6d6d6d;">Noisia · social intelligence architects · <a href="https://noisia.ai" style="color:#6d6d6d;text-decoration:underline;">noisia.ai</a></p>
      <p style="margin:0;font-size:12px;line-height:18px;color:#6d6d6d;">${c.footer}</p>
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
    `${c.intro} ${vars.title}:`,
    "",
    vars.code,
    "",
    ...(c.use ? [c.use] : []),
    `${c.button}: ${vars.link}`,
    "",
    c.expires,
    c.ignore,
    "",
    "--",
    "Noisia · social intelligence architects · https://noisia.ai",
    c.footer
  ].join("\n");

  return { subject: c.subject(vars.code), html, text };
}
