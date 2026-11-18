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
    lead: "Lo que la gente dice de una categoría, analizado con método.",
    industryLabel: "Industria",
    marketLabel: "Mercado",
    allIndustries: "Todas",
    allMarkets: "Todos",
    latest: "Más reciente",
    empty: "No hay estudios con esos filtros todavía.",
    expiredLink: "Este link venció. Pide uno nuevo a tu contacto en Noisia.",
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
    fullText: (slides, language) => `${slides} láminas con cada hallazgo y su evidencia. En ${language}, con PDF.`,
    accessNote: {
      abierto: "Se abre sin registro.",
      registro: "Gratis, con tu nombre, correo y empresa.",
      solo_link: "Bajo solicitud."
    },
    piecesTitle: "Piezas de este estudio",
    piecesLead: "Hallazgos cortos con su evidencia.",
    moreStudies: "Más estudios",
    draft: "Borrador",
    close: "Cerrar",
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
    copied: "Link copiado",
    downloadPdf: "Descargar PDF",
    present: "Presentar",
    slideAlt: (n, total) => `Lámina ${n} de ${total}`,
    tapHint: "",
    gateTitle: { registro: "Estudio con registro", solo_link: "Estudio bajo solicitud" },
    gateText: {
      registro: "Escríbenos y te lo mandamos.",
      solo_link: "Pídelo a tu contacto en Noisia o escríbenos."
    },
    gateCta: "Pedir el estudio",
    gateHasLink: "¿Tienes un link personal? Ábrelo desde tu correo.",
    fullMetaTitle: (title) => `${title} · Estudio completo`,
    unlock: {
      title: "Ve el estudio completo",
      text: () => "",
      name: "Nombre",
      email: "Correo",
      company: "Empresa",
      marketing: "Mándame los próximos estudios",
      privacy: "",
      privacyLink: "Aviso de privacidad",
      submit: "Recibir código",
      sending: "Enviando…",
      error: "No se pudo. Intenta de nuevo.",
      emailError: "No pudimos enviar a ese correo.",
      locked: "Bloqueada",
      codeTitle: "Escribe el código",
      codeText: "Lo enviamos a {email}.",
      codeTextNoEmail: "Lo enviamos a tu correo.",
      codeLabel: "Código",
      verify: "Abrir",
      verifying: "Abriendo…",
      wrong: "Código incorrecto.",
      tooMany: "Demasiados intentos. Pide otro código.",
      expired: "El código venció. Pide otro.",
      spam: "¿No llegó? Revisa spam o",
      restart: "pide otro."
    }
  },
  en: {
    metaTitle: "Social intelligence studies",
    metaDescription: "Full Noisia studies on how people talk about a category: findings, figures with their base and the method. By industry and market.",
    title: "Studies",
    lead: "What people say about a category, analyzed with a method.",
    industryLabel: "Industry",
    marketLabel: "Market",
    allIndustries: "All",
    allMarkets: "All",
    latest: "Latest",
    empty: "No studies with those filters yet.",
    expiredLink: "This link expired. Ask your Noisia contact for a new one.",
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
    fullText: (slides, language) => `${slides} slides with every finding and its evidence. In ${language}, with a PDF.`,
    accessNote: {
      abierto: "It opens without signing up.",
      registro: "Free, with your name, email and company.",
      solo_link: "On request."
    },
    piecesTitle: "Pieces from this study",
    piecesLead: "Short findings with their evidence.",
    moreStudies: "More studies",
    draft: "Draft",
    close: "Close",
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
    copied: "Link copied",
    downloadPdf: "Download PDF",
    present: "Present",
    slideAlt: (n, total) => `Slide ${n} of ${total}`,
    tapHint: "",
    gateTitle: { registro: "Study with sign-up", solo_link: "Study on request" },
    gateText: {
      registro: "Write to us and we will send it.",
      solo_link: "Ask your Noisia contact or write to us."
    },
    gateCta: "Request the study",
    gateHasLink: "Have a personal link? Open it from your email.",
    fullMetaTitle: (title) => `${title} · Full study`,
    unlock: {
      title: "See the full study",
      text: () => "",
      name: "Name",
      email: "Email",
      company: "Company",
      marketing: "Send me the next studies",
      privacy: "",
      privacyLink: "Privacy notice",
      submit: "Get the code",
      sending: "Sending…",
      error: "Something failed. Try again.",
      emailError: "We couldn't send to that email.",
      locked: "Locked",
      codeTitle: "Enter the code",
      codeText: "We sent it to {email}.",
      codeTextNoEmail: "We sent it to your email.",
      codeLabel: "Code",
      verify: "Open",
      verifying: "Opening…",
      wrong: "Wrong code.",
      tooMany: "Too many tries. Ask for a new code.",
      expired: "The code expired. Ask for a new one.",
      spam: "Not there? Check spam or",
      restart: "ask for another."
    }
  }
};
