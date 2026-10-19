import type { LearnIcon } from "@/components/learn/icons";
import type { Localized } from "./types";

/**
 * Privacy notice (simplified, under Mexico's LFPDPPP). Read like a support article: a short
 * summary, a table of contents and one section per topic. The founder sends the text to legal
 * review; keep the substance when editing the layout.
 */

export type PrivacyCopy = {
  metaTitle: string;
  metaDescription: string;
  title: string;
  lead: string;
  summaryTitle: string;
  summary: { name: string; text: string; icon: LearnIcon }[];
  tocTitle: string;
  sections: { id: string; title: string; icon: LearnIcon; paragraphs: string[] }[];
  updated: string;
};

export const PRIVACY_EMAIL = "hola@noisia.ai";

export const privacy: Localized<PrivacyCopy> = {
  es: {
    metaTitle: "Aviso de privacidad",
    metaDescription:
      "Aviso de privacidad simplificado de Noisia: qué datos recabamos en el formulario del taller, para qué los usamos, con quién no los compartimos y cómo ejercer tus derechos ARCO.",
    title: "Aviso de privacidad",
    lead: "Qué datos personales recabamos a través de este sitio, para qué los usamos y cómo puedes ejercer tus derechos. Se lee en unos minutos.",
    summaryTitle: "En resumen",
    summary: [
      { name: "Solo lo que tú nos das", text: "Los datos del formulario del taller o de tu correo. No pedimos datos sensibles.", icon: "user" },
      { name: "Para atender tu solicitud", text: "Contactarte, preparar el taller y, si lo pides, enviarte una propuesta.", icon: "page" },
      { name: "No los vendemos", text: "Ni los transferimos a terceros para sus propios fines.", icon: "shield" }
    ],
    tocTitle: "En esta página",
    sections: [
      {
        id: "responsable",
        title: "Responsable",
        icon: "user",
        paragraphs: [
          "Noisia es responsable del tratamiento de los datos personales que recaba a través de este sitio. Para cualquier asunto relacionado con este aviso puedes escribir a hola@noisia.ai."
        ]
      },
      {
        id: "datos",
        title: "Qué datos recabamos",
        icon: "data",
        paragraphs: [
          "Cuando llenas el formulario para agendar un taller, recabamos los datos que tú nos das: nombre, correo de trabajo, empresa, puesto, la pregunta o decisión que quieres trabajar, el mercado o los países que te interesan y para cuándo lo necesitas.",
          "No pedimos ni recabamos datos personales sensibles a través de este sitio. Si nos escribes por correo, tratamos los datos que incluyas en tu mensaje con las mismas reglas."
        ]
      },
      {
        id: "finalidades",
        title: "Para qué los usamos",
        icon: "page",
        paragraphs: [
          "Usamos tus datos para contactarte sobre el taller que solicitaste, prepararlo con tu contexto y, si lo pides, enviarte una propuesta de alcance. Esas son las finalidades necesarias para atender tu solicitud.",
          "Si en algún momento quisiéramos enviarte contenido de Noisia que no esté relacionado con tu solicitud, te lo preguntaríamos antes y podrías negarte sin que eso afecte la atención del taller."
        ]
      },
      {
        id: "compartir",
        title: "Con quién compartimos tus datos",
        icon: "people",
        paragraphs: [
          "No vendemos tus datos ni los transferimos a terceros para sus propios fines. Los proveedores que nos ayudan a operar el sitio, el correo y la agenda tratan tus datos solo por instrucción nuestra y para las finalidades descritas aquí.",
          "La investigación que producimos se hace sobre conversación pública y no utiliza los datos de contacto que nos das en este formulario."
        ]
      },
      {
        id: "derechos",
        title: "Tus derechos",
        icon: "rights",
        paragraphs: [
          "Puedes acceder a tus datos, rectificarlos, cancelarlos u oponerte a su tratamiento, y también revocar el consentimiento que nos hayas dado, escribiendo a hola@noisia.ai. Te responderemos en los plazos que marca la ley y te pediremos acreditar tu identidad para atender la solicitud.",
          "Conservamos tus datos mientras exista una relación o una conversación activa contigo, y después por el tiempo que la ley nos obligue. Luego los eliminamos."
        ]
      },
      {
        id: "cookies",
        title: "Cookies y analítica",
        icon: "cookie",
        paragraphs: [
          "Este sitio usa analítica básica para saber qué páginas se visitan y desde qué tipo de dispositivo, con el fin de mejorarlo. Esa medición no se usa para construir perfiles individuales ni para publicidad. Puedes bloquear las cookies desde la configuración de tu navegador sin que el sitio deje de funcionar."
        ]
      },
      {
        id: "cambios",
        title: "Cambios a este aviso",
        icon: "book",
        paragraphs: ["Si este aviso cambia, publicaremos la versión actualizada en esta misma página con su fecha."]
      }
    ],
    updated: "Última actualización: octubre de 2026."
  },
  en: {
    metaTitle: "Privacy notice",
    metaDescription:
      "Noisia's short privacy notice: which data we collect in the workshop form, what we use it for, whom we don't share it with and how to exercise your rights.",
    title: "Privacy notice",
    lead: "Which personal data we collect through this site, what we use it for and how you can exercise your rights. It takes a few minutes to read.",
    summaryTitle: "In short",
    summary: [
      { name: "Only what you give us", text: "The data in the workshop form or in your email. We don't ask for sensitive data.", icon: "user" },
      { name: "To handle your request", text: "To contact you, prepare the workshop and, if you ask, send you a proposal.", icon: "page" },
      { name: "We don't sell it", text: "Nor do we transfer it to third parties for their own purposes.", icon: "shield" }
    ],
    tocTitle: "On this page",
    sections: [
      {
        id: "controller",
        title: "Data controller",
        icon: "user",
        paragraphs: [
          "Noisia is responsible for the processing of the personal data collected through this site. For any matter related to this notice you can write to hola@noisia.ai."
        ]
      },
      {
        id: "data",
        title: "Which data we collect",
        icon: "data",
        paragraphs: [
          "When you fill in the form to book a workshop, we collect the data you give us: name, work email, company, role, the question or decision you want to work on, the market or countries you are interested in, and when you need it.",
          "We don't ask for or collect sensitive personal data through this site. If you write to us by email, we handle the data included in your message under the same rules."
        ]
      },
      {
        id: "purposes",
        title: "What we use it for",
        icon: "page",
        paragraphs: [
          "We use your data to contact you about the workshop you requested, prepare it with your context and, if you ask, send you a scope proposal. Those are the purposes needed to handle your request.",
          "If at some point we wanted to send you Noisia content unrelated to your request, we would ask you first, and you could decline without it affecting the workshop."
        ]
      },
      {
        id: "sharing",
        title: "Whom we share your data with",
        icon: "people",
        paragraphs: [
          "We don't sell your data or transfer it to third parties for their own purposes. The providers that help us run the site, email and scheduling process your data only on our instructions and for the purposes described here.",
          "The research we produce is done on public conversation and doesn't use the contact data you give us in this form."
        ]
      },
      {
        id: "rights",
        title: "Your rights",
        icon: "rights",
        paragraphs: [
          "You can access your data, correct it, delete it or object to its processing, and also withdraw any consent you have given us, by writing to hola@noisia.ai. We will answer within the deadlines set by law and will ask you to verify your identity to handle the request.",
          "We keep your data while there is an active relationship or conversation with you, and afterwards for as long as the law requires. Then we delete it."
        ]
      },
      {
        id: "cookies",
        title: "Cookies and analytics",
        icon: "cookie",
        paragraphs: [
          "This site uses basic analytics to know which pages are visited and from which kind of device, in order to improve it. That measurement is not used to build individual profiles or for advertising. You can block cookies in your browser settings and the site will keep working."
        ]
      },
      {
        id: "changes",
        title: "Changes to this notice",
        icon: "book",
        paragraphs: ["If this notice changes, we will publish the updated version on this same page with its date."]
      }
    ],
    updated: "Last updated: October 2026."
  }
};
