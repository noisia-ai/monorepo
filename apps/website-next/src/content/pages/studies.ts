import type { AccessMode, FullLanguage, Market } from "@/content/studies/schema";

/** Copy of the studies index, the study page and the full-study viewer. */

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
  findingsTitle: string;
  methodTitle: string;
  baseLine: (mentions: string, channels: string) => string;
  fullCta: string;
  fullLanguage: (language: string) => string;
  accessNote: Record<AccessMode, string>;
  piecesTitle: string;
  piecesLead: string;
  moreStudies: string;
  draft: string;
  // full study
  backToStudy: string;
  downloadPdf: string;
  fullscreen: string;
  slideAlt: (n: number, total: number) => string;
  tapHint: string;
  gateTitle: Record<Exclude<AccessMode, "abierto">, string>;
  gateText: Record<Exclude<AccessMode, "abierto">, string>;
  gateCta: string;
  gateHasLink: string;
  fullMetaTitle: (title: string) => string;
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
    access: { abierto: "Libre", registro: "Con registro", solo_link: "Bajo solicitud" },
    languages: { es: "español", en: "inglés", pt: "portugués", de: "alemán" },
    allStudies: "Todos los estudios",
    findingsTitle: "Lo que encontramos",
    methodTitle: "Cómo lo hicimos",
    baseLine: (mentions, channels) => `${mentions} menciones analizadas en ${channels}`,
    fullCta: "Ver el estudio completo",
    fullLanguage: (language) => `El estudio completo está en ${language}.`,
    accessNote: {
      abierto: "Libre: se abre sin registro.",
      registro: "Se comparte con registro. Si recibiste un enlace personal, ya lo tienes abierto.",
      solo_link: "Se comparte bajo solicitud. Si recibiste un enlace personal, ya lo tienes abierto."
    },
    piecesTitle: "Piezas de este estudio",
    piecesLead: "Hallazgos cortos, cada uno con su evidencia.",
    moreStudies: "Más estudios",
    draft: "Borrador",
    backToStudy: "Volver al estudio",
    downloadPdf: "Descargar PDF",
    fullscreen: "Pantalla completa",
    slideAlt: (n, total) => `Lámina ${n} de ${total}`,
    tapHint: "Toca una lámina para verla completa. Gira el teléfono o acerca para leer el detalle.",
    gateTitle: { registro: "Este estudio se comparte con registro", solo_link: "Este estudio se comparte bajo solicitud" },
    gateText: {
      registro: "Escríbenos con tu nombre y tu empresa y te mandamos el estudio completo.",
      solo_link: "Pídelo a tu contacto en Noisia, o escríbenos y te lo mandamos."
    },
    gateCta: "Pedir el estudio",
    gateHasLink: "¿Recibiste un enlace personal? Ábrelo desde tu correo o tu mensaje y el estudio se abre aquí.",
    fullMetaTitle: (title) => `${title} · Estudio completo`
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
    access: { abierto: "Free", registro: "Sign-up", solo_link: "On request" },
    languages: { es: "Spanish", en: "English", pt: "Portuguese", de: "German" },
    allStudies: "All studies",
    findingsTitle: "What we found",
    methodTitle: "How we did it",
    baseLine: (mentions, channels) => `${mentions} mentions analyzed across ${channels}`,
    fullCta: "See the full study",
    fullLanguage: (language) => `The full study is in ${language}.`,
    accessNote: {
      abierto: "Free: it opens without signing up.",
      registro: "Shared with sign-up. If you received a personal link, it is already open for you.",
      solo_link: "Shared on request. If you received a personal link, it is already open for you."
    },
    piecesTitle: "Pieces from this study",
    piecesLead: "Short findings, each with its evidence.",
    moreStudies: "More studies",
    draft: "Draft",
    backToStudy: "Back to the study",
    downloadPdf: "Download PDF",
    fullscreen: "Full screen",
    slideAlt: (n, total) => `Slide ${n} of ${total}`,
    tapHint: "Tap a slide to see it full size. Turn your phone or zoom in to read the detail.",
    gateTitle: { registro: "This study is shared with sign-up", solo_link: "This study is shared on request" },
    gateText: {
      registro: "Write to us with your name and company and we will send you the full study.",
      solo_link: "Ask your Noisia contact for it, or write to us and we will send it."
    },
    gateCta: "Request the study",
    gateHasLink: "Did you receive a personal link? Open it from your email or message and the study opens here.",
    fullMetaTitle: (title) => `${title} · Full study`
  }
};
