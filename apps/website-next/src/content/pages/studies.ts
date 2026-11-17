import type { AccessMode, FullLanguage, Market } from "@/content/studies/schema";

/** Copy of the studies index, the study page and the study viewer. */

const names: Record<"es" | "en", Record<Market, string>> = {
  es: { MX: "México", UK: "Reino Unido", BR: "Brasil", DE: "Alemania", "US-CA": "Estados Unidos y Canadá", ES: "España", FR: "Francia" },
  en: { MX: "Mexico", UK: "United Kingdom", BR: "Brazil", DE: "Germany", "US-CA": "United States and Canada", ES: "Spain", FR: "France" }
};
const list = (locale: string, items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);

type Copy = {
  metaTitle: string;
  metaDescription: string;
  title: string;
  lead: string;
  industryLabel: string;
  marketLabel: string;
  allIndustries: string;
  allMarkets: string;
  latest: string;
  empty: string;
  expiredLink: string;
  editorialReport: string;
  reportNote: string;
  markets: Record<Market, string>;
  /** "Mexico"; "United Kingdom and Germany"; with three or more, "4 markets". */
  marketSummary: (markets: Market[]) => string;
  /** Every market, in full: "United Kingdom, Germany, Spain and France". */
  marketList: (markets: Market[]) => string;
  access: Record<AccessMode, string>;
  languages: Record<FullLanguage, string>;
  allStudies: string;
  // study page
  eyebrow: string;
  findingsTitle: string;
  findingsCta: string;
  voiceTitle: string;
  methodTitle: string;
  facts: { method: string; markets: string; period: string; base: string; channels: string; language: string };
  mentions: (mentions: string) => string;
  fullCta: string;
  /** "45 slides · In English · On request" */
  fullMeta: (slides: number, language: string, access: AccessMode) => string;
  fullTitle: string;
  fullText: (slides: number, language: string) => string;
  accessNote: Record<AccessMode, string>;
  piecesTitle: string;
  piecesLead: string;
  moreStudies: string;
  draft: string;
  // viewer
  close: string;
  slides: (n: number) => string;
  slideOf: (n: number, total: number) => string;
  prev: string;
  next: string;
  showThumbs: string;
  hideThumbs: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  share: string;
  copied: string;
  downloadPdf: string;
  present: string;
  slideAlt: (n: number, total: number) => string;
  tapHint: string;
  gateTitle: Record<Exclude<AccessMode, "abierto">, string>;
  gateText: Record<Exclude<AccessMode, "abierto">, string>;
  gateCta: string;
  gateHasLink: string;
  fullMetaTitle: (title: string) => string;
  unlock: UnlockCopy;
};

export type UnlockCopy = {
  title: string;
  text: (remaining: number) => string;
  name: string;
  email: string;
  company: string;
  marketing: string;
  privacy: string;
  privacyLink: string;
  submit: string;
  sending: string;
  error: string;
  emailError: string;
  locked: string;
  codeTitle: string;
  /** With {email}. */
  codeText: string;
  codeTextNoEmail: string;
  codeLabel: string;
  verify: string;
  verifying: string;
  wrong: string;
  tooMany: string;
  expired: string;
  spam: string;
  restart: string;
};

export const studiesPage: Record<"es" | "en", Copy> = {
  es: {
    metaTitle: "Estudios de inteligencia social",
    metaDescription: "Estudios completos de Noisia sobre cómo habla la gente de una categoría: hallazgos, cifras con su base y el método. Por industria y mercado.",
    title: "Estudios",
    lead: "Lo que la gente dice de una categoría, analizado con método. Cada estudio trae sus hallazgos, sus cifras con su base y el estudio completo.",
    industryLabel: "Industria",
    marketLabel: "Mercado",
    allIndustries: "Todas",
    allMarkets: "Todos",
    latest: "Más reciente",
    empty: "No hay estudios con esos filtros todavía.",
    expiredLink: "Ese enlace ya venció o no existe. Pide uno nuevo a tu contacto en Noisia.",
    editorialReport: "Reporte editorial",
    reportNote: "Reporte interactivo",
    markets: names.es,
    marketSummary: (markets) => (markets.length > 2 ? `${markets.length} mercados` : list("es-MX", markets.map((m) => names.es[m]))),
    marketList: (markets) => list("es-MX", markets.map((m) => names.es[m])),
    access: { abierto: "Gratis", registro: "Gratis", solo_link: "Bajo solicitud" },
    languages: { es: "español", en: "inglés", pt: "portugués", de: "alemán" },
    allStudies: "Todos los estudios",
    eyebrow: "Estudio",
    findingsTitle: "Lo que encontramos",
    findingsCta: "Lo que encontramos",
    voiceTitle: "En palabras de la gente",
    methodTitle: "Cómo lo hicimos",
    facts: { method: "Método", markets: "Mercados", period: "Periodo", base: "Base", channels: "Canales", language: "Estudio completo" },
    mentions: (mentions) => `${mentions} menciones`,
    fullCta: "Ver el estudio",
    fullMeta: (slides, language, access) =>
      [`${slides} láminas`, `en ${language}`, access === "solo_link" ? "bajo solicitud" : null].filter(Boolean).join(" · "),
    fullTitle: "El estudio completo",
    fullText: (slides, language) => `${slides} láminas con cada hallazgo, sus cifras y la evidencia detrás. Está en ${language} y se descarga en PDF.`,
    accessNote: {
      abierto: "Se abre sin registro.",
      registro: "Gratis. Solo te pedimos nombre, correo y empresa.",
      solo_link: "Se comparte bajo solicitud. Si recibiste un enlace personal, ya lo tienes abierto."
    },
    piecesTitle: "Piezas de este estudio",
    piecesLead: "Hallazgos cortos, cada uno con su evidencia.",
    moreStudies: "Más estudios",
    draft: "Borrador",
    close: "Cerrar y volver al estudio",
    slides: (n) => `${n} láminas`,
    slideOf: (n, total) => `${n} de ${total}`,
    prev: "Lámina anterior",
    next: "Lámina siguiente",
    showThumbs: "Mostrar miniaturas",
    hideThumbs: "Ocultar miniaturas",
    zoomIn: "Acercar",
    zoomOut: "Alejar",
    fit: "Ajustar",
    share: "Compartir",
    copied: "Link copiado. Abre la página del estudio; tu acceso sigue siendo personal.",
    downloadPdf: "Descargar PDF",
    present: "Presentar",
    slideAlt: (n, total) => `Lámina ${n} de ${total}`,
    tapHint: "Toca una lámina para verla completa. Gira el teléfono o acerca para leer el detalle.",
    gateTitle: { registro: "Este estudio se comparte con registro", solo_link: "Este estudio se comparte bajo solicitud" },
    gateText: {
      registro: "Escríbenos con tu nombre y tu empresa y te mandamos el estudio completo.",
      solo_link: "Pídelo a tu contacto en Noisia, o escríbenos y te lo mandamos."
    },
    gateCta: "Pedir el estudio",
    gateHasLink: "¿Recibiste un enlace personal? Ábrelo desde tu correo o tu mensaje y el estudio se abre aquí.",
    fullMetaTitle: (title) => `${title} · Estudio completo`,
    unlock: {
      title: "Abre el estudio completo",
      text: (remaining) => `Faltan ${remaining} láminas. Déjanos tus datos y te mandamos a tu correo un código para abrirlas.`,
      name: "Nombre",
      email: "Correo",
      company: "Empresa",
      marketing: "Quiero recibir los próximos estudios de Noisia.",
      privacy: "Usamos tus datos como dice el",
      privacyLink: "aviso de privacidad",
      submit: "Enviarme el código",
      sending: "Enviando…",
      error: "No pudimos abrirlo. Revisa tus datos e inténtalo de nuevo.",
      emailError: "No pudimos mandar el código a ese correo. Revísalo e inténtalo de nuevo.",
      locked: "Se abre con tus datos",
      codeTitle: "Revisa tu correo",
      codeText: "Te mandamos un código de 4 dígitos a {email}. Escríbelo aquí y el estudio se abre.",
      codeTextNoEmail: "Te mandamos un código de 4 dígitos a tu correo. Escríbelo aquí y el estudio se abre.",
      codeLabel: "Código",
      verify: "Abrir el estudio",
      verifying: "Abriendo…",
      wrong: "Ese código no es. Revisa el correo e inténtalo de nuevo.",
      tooMany: "Demasiados intentos con ese código. Pide uno nuevo.",
      expired: "El código venció. Pide uno nuevo.",
      spam: "¿No llega? Revisa spam o promociones, o",
      restart: "pide otro código."
    }
  },
  en: {
    metaTitle: "Social intelligence studies",
    metaDescription: "Full Noisia studies on how people talk about a category: findings, figures with their base and the method. By industry and market.",
    title: "Studies",
    lead: "What people say about a category, analyzed with a method. Each study brings its findings, its figures with their base and the full study.",
    industryLabel: "Industry",
    marketLabel: "Market",
    allIndustries: "All",
    allMarkets: "All",
    latest: "Latest",
    empty: "No studies with those filters yet.",
    expiredLink: "That link has expired or does not exist. Ask your Noisia contact for a new one.",
    editorialReport: "Editorial report",
    reportNote: "Interactive report, in Spanish",
    markets: names.en,
    marketSummary: (markets) => (markets.length > 2 ? `${markets.length} markets` : list("en-US", markets.map((m) => names.en[m]))),
    marketList: (markets) => list("en-US", markets.map((m) => names.en[m])),
    access: { abierto: "Free", registro: "Free", solo_link: "On request" },
    languages: { es: "Spanish", en: "English", pt: "Portuguese", de: "German" },
    allStudies: "All studies",
    eyebrow: "Study",
    findingsTitle: "What we found",
    findingsCta: "What we found",
    voiceTitle: "In people's words",
    methodTitle: "How we did it",
    facts: { method: "Method", markets: "Markets", period: "Period", base: "Base", channels: "Channels", language: "Full study" },
    mentions: (mentions) => `${mentions} mentions`,
    fullCta: "See the study",
    fullMeta: (slides, language, access) =>
      [`${slides} slides`, `in ${language}`, access === "solo_link" ? "on request" : null].filter(Boolean).join(" · "),
    fullTitle: "The full study",
    fullText: (slides, language) => `${slides} slides with every finding, its figures and the evidence behind it. It is in ${language} and downloads as a PDF.`,
    accessNote: {
      abierto: "It opens without signing up.",
      registro: "Free. We only ask for your name, email and company.",
      solo_link: "Shared on request. If you received a personal link, it is already open for you."
    },
    piecesTitle: "Pieces from this study",
    piecesLead: "Short findings, each with its evidence.",
    moreStudies: "More studies",
    draft: "Draft",
    close: "Close and go back to the study",
    slides: (n) => `${n} slides`,
    slideOf: (n, total) => `${n} of ${total}`,
    prev: "Previous slide",
    next: "Next slide",
    showThumbs: "Show thumbnails",
    hideThumbs: "Hide thumbnails",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fit: "Fit",
    share: "Share",
    copied: "Link copied. It opens the study page; your access stays personal.",
    downloadPdf: "Download PDF",
    present: "Present",
    slideAlt: (n, total) => `Slide ${n} of ${total}`,
    tapHint: "Tap a slide to see it full size. Turn your phone or zoom in to read the detail.",
    gateTitle: { registro: "This study is shared with sign-up", solo_link: "This study is shared on request" },
    gateText: {
      registro: "Write to us with your name and company and we will send you the full study.",
      solo_link: "Ask your Noisia contact for it, or write to us and we will send it."
    },
    gateCta: "Request the study",
    gateHasLink: "Did you receive a personal link? Open it from your email or message and the study opens here.",
    fullMetaTitle: (title) => `${title} · Full study`,
    unlock: {
      title: "Open the full study",
      text: (remaining) => `${remaining} more slides. Leave your details and we email you a code to open them.`,
      name: "Name",
      email: "Email",
      company: "Company",
      marketing: "Send me Noisia's next studies.",
      privacy: "We use your data as described in our",
      privacyLink: "privacy notice",
      submit: "Email me the code",
      sending: "Sending…",
      error: "We couldn't open it. Check your details and try again.",
      emailError: "We couldn't send the code to that email. Check it and try again.",
      locked: "Opens with your details",
      codeTitle: "Check your email",
      codeText: "We sent a 4-digit code to {email}. Type it here and the study opens.",
      codeTextNoEmail: "We sent a 4-digit code to your email. Type it here and the study opens.",
      codeLabel: "Code",
      verify: "Open the study",
      verifying: "Opening…",
      wrong: "That code is not right. Check the email and try again.",
      tooMany: "Too many tries with that code. Ask for a new one.",
      expired: "The code expired. Ask for a new one.",
      spam: "Not there? Check spam or promotions, or",
      restart: "ask for another code."
    }
  }
};
