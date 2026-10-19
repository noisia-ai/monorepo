import Image from "next/image";
import type { ReactNode } from "react";
import { InfoCircle } from "iconoir-react";
import { Button } from "@/components/ui/Button";
import type { InsightPageCopy, InsightReport, InsightSignal } from "@/content/reports/reports";
import { MethodologyChip } from "./MethodologyChip";
import {
  DownloadPrintButton,
  MaturityDistributionChart,
  SignalEvidenceScatter,
  SignalEvolutionChart,
  SignalScaleChart
} from "./ReportCharts";
import styles from "./Report.module.css";

// Brand marks from Simple Icons (CC0), inlined so the report needs no icon package.
const socialIcon = (path: string) => ({ path });
const siFacebook = socialIcon("M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z");
const siInstagram = socialIcon("M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077");
const siReddit = socialIcon("M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z");
const siTiktok = socialIcon("M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z");
const siX = socialIcon("M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z");
const siYoutube = socialIcon("M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z");

const maturityCopy: Record<InsightSignal["maturity"], { title: string; note: string }> = {
  emergente: {
    title: "Emergente",
    note: "La tensión ya existe; la gente apenas le está poniendo palabras."
  },
  acelerando: {
    title: "Acelerando",
    note: "El vocabulario ya está armado y la frecuencia crece."
  },
  mainstreaming: {
    title: "Mainstreaming",
    note: "Ya atraviesa plataformas y conversaciones en México."
  }
};

const heroNumberOrder = ["corpus_scope", "mentions_reviewed", "period", "sources", "signals", "territories", "keywords", "evidence"];
const maturityOrder: InsightSignal["maturity"][] = ["emergente", "acelerando", "mainstreaming"];
const printTotalPages = "18";
const linkedInIcon = {
  path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.554V9h3.565v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z"
};

const platformIcons = {
  facebook: siFacebook,
  instagram: siInstagram,
  linkedin: linkedInIcon,
  reddit: siReddit,
  tiktok: siTiktok,
  x: siX,
  youtube: siYoutube
};

const futureHumanStudy = "Future is Human";
const mexicanHomeStudy = "The Mexican Home";

const reportCopy: Record<"foresight" | "futureHuman", InsightPageCopy> = {
  foresight: {
    printLabel: "cultural foresight",
    heroVisualKicker: "México Foresight 2026",
    heroVisualTitle: "Del tener que demostrar al poder respirar",
    heroVisualBody: "8 señales culturales leídas en la conversación digital mexicana.",
    openingLead: "Del Mundial 2026 ya hablarán todos.",
    openingParagraphs: [
      "Pantallas, cerveza, jerseys, botanas. Este reporte mira lo que no está en el calendario.",
      "Los movimientos culturales que importan no son los que se anuncian con fecha. Son los que se cuelan en lo cotidiano: cómo la gente en México describe su descanso, su exposición, su confianza, su aspiración y su humor.",
      "Este es un radar de esos movimientos. 8 señales detectadas en la conversación digital mexicana entre enero 2025 y mayo 2026. No son tendencias predichas. Son tensiones que ya están pasando."
    ],
    contractEyebrow: "Contrato de lectura",
    contractTitle: "No buscamos tendencias. Buscamos señales.",
    contractLead: "Una tendencia se mide en volumen. Una señal se detecta en lenguaje, contradicciones y cambios de vocabulario.",
    keyInsightsTitle: "Key insights",
    keyInsightsLead:
      "México está negociando permiso para dejar de performar: descansar sin justificarse, proteger su privacidad, desconfiar de la perfección, pedir curaduría y nombrar lo propio sin cliché. Las señales no son predicciones aisladas. Juntas describen un cambio de sensibilidad que una marca puede leer antes de convertirlo en briefing.",
    searchedTitle: "Buscamos",
    searchedItems: [
      "Frases que se repiten en distintas voces y plataformas.",
      "Tensiones que aparecen en la conversación cotidiana de México.",
      "Contradicciones entre lo que la gente dice y lo que las marcas asumen.",
      "Cambios de vocabulario que delatan cambios de creencia.",
      "Comportamientos visibles que todavía no tienen nombre."
    ],
    cannotTitle: "Lo que no podemos decir",
    cannotItems: [
      "No predice el futuro.",
      "No representa a toda la población mexicana.",
      "No equipara volumen de menciones con importancia cultural."
    ],
    radarEyebrow: "Las 8 señales",
    radarTitle: "Por madurez cultural.",
    radarLead: "El radar separa señales emergentes, señales acelerando y señales que ya operan como lenguaje dominante en México.",
    maturityFrameworkEyebrow: "Clasificación",
    maturityFrameworkTitle: "¿Cómo categorizamos las señales culturales?",
    chartMixLabel: "Radar mix",
    chartMixSubtitle: "Distribución del portafolio cultural por madurez.",
    chartMixInfo:
      "Cuántas señales caen en cada nivel de madurez. La madurez orienta qué tan rápido debería reaccionar una marca.",
    scaleChartSubtitle: "Menciones revisadas por señal. El volumen ayuda a leer el contexto; lo importante es la carga cultural de cada una.",
    scaleChartInfo:
      "Compara la cantidad de menciones revisadas por señal. Es una vista de escala, no de importancia.",
    scatterLabel: "Lifecycle view",
    scatterSubtitle:
      "La altura muestra escala revisada; la posición muestra madurez cultural. Los marcadores MX ayudan a leer qué lenguaje sostiene cada señal.",
    scatterInfo:
      "Cada punto es una señal. Horizontal: madurez cultural. Vertical: menciones revisadas. Tamaño: número de fuentes.",
    maturityChartTitle: "La mayoría de las señales ya están acelerando.",
    scaleChartTitle: "Dónde hay más conversación revisada.",
    scatterTitle: "Dónde está cada señal en su ciclo de vida.",
    brandLead: "Las señales no piden una sola respuesta. Piden ajustar producto, tono, evidencia, participación e identidad.",
    ctaEyebrow: "Siguiente paso",
    ctaTitle: "¿Qué señal está creciendo en tu categoría?",
    ctaBody:
      "Este es un radar exploratorio. El paso siguiente es preguntarse, para una categoría concreta, cuál de las 8 señales está cruzando su umbral ahora mismo y qué debería estar haciendo la marca para no llegar tarde.",
    ctaButton: "Agendar"
  },
  futureHuman: {
    printLabel: "future is human",
    heroVisualKicker: "Marcas mexicanas en conversación",
    heroVisualTitle: "La IA no deshumaniza. La falta de criterio sí.",
    heroVisualBody: "6 señales sobre voz, criterio, transparencia y responsabilidad cuando todo puede automatizarse.",
    openingLead: "¿Qué hace que una marca se sienta humana cuando todo puede ser automatizado?",
    openingParagraphs: [
      "La respuesta corta: no es la IA. Es el criterio.",
      "Una marca puede estar automatizada y sentirse confiable. Otra puede sonar cálida y sentirse falsa. Y otra puede responder rápido y aun así sentirse deshumana.",
      "Este reporte no es sobre chatbots ni sobre IA en abstracto. Es sobre las señales que hacen que una marca conserve voz, criterio, transparencia y responsabilidad cuando todo a su alrededor se vuelve automatizable."
    ],
    contractEyebrow: "Qué leímos",
    contractTitle: "No buscamos IA. Buscamos momentos donde una marca pierde humanidad.",
    contractLead:
      "Cruzamos marcas mexicanas con frases de fricción para detectar cuándo la audiencia siente que una marca pierde voz, criterio, transparencia o responsabilidad en una interacción.",
    keyInsightsTitle: "Key insights",
    keyInsightsLead:
      "La humanidad de una marca ya no se mide por sonar cálida, sino por conservar criterio cuando algo se puede automatizar. La audiencia distingue eficiencia útil de eficiencia deshumanizada: pide acceso a humano, transparencia, contexto, voz propia y responsabilidad cuando la experiencia se rompe.",
    searchedTitle: "Sí leímos",
    searchedItems: [
      "Más de 80 marcas mexicanas como punto de entrada, no como ranking.",
      "Frases donde la gente pide humano, criterio, claridad o responsabilidad.",
      "Citas con contexto explícito de marca, plataforma y momento de servicio.",
      "Patrones de lenguaje que revelan cuándo la automatización ayuda o rompe confianza.",
      "Implicaciones concretas para marca, CX, copy, IA y servicio."
    ],
    cannotTitle: "No es",
    cannotItems: [
      "No es un ranking de mejores o peores marcas.",
      "No es un score de customer service.",
      "No representa a toda la población mexicana.",
      "No equipara volumen con importancia. El volumen da contexto; la señal viene del tipo de fricción."
    ],
    radarEyebrow: "Radar de humanidad",
    radarTitle: "Por nivel de instalación.",
    radarLead:
      "El radar separa las expectativas que ya son default de las que todavía aparecen como fricción puntual, pero que se repiten.",
    maturityFrameworkEyebrow: "Nivel de instalación",
    maturityFrameworkTitle: "¿Qué tan instalada está la expectativa de humanidad?",
    chartMixLabel: "Mapa de instalación",
    chartMixSubtitle: "Distribución de señales por nivel de instalación en la conversación sobre marcas.",
    chartMixInfo:
      "Cuántas señales aparecen como emergentes, acelerando o mainstreaming. Aquí la madurez no mide cultura general: mide qué tan instalada está la expectativa de trato humano hacia marcas concretas.",
    scaleChartSubtitle: "Menciones revisadas por señal. El volumen orienta dónde hay más fricción visible; no sustituye la lectura estratégica.",
    scaleChartInfo:
      "Compara escala de conversación revisada por señal. Sirve para dimensionar exposición, no para rankear importancia.",
    scatterLabel: "Mapa de exposición",
    scatterSubtitle:
      "La altura muestra escala revisada; la posición muestra nivel de instalación. Los marcadores MX ayudan a leer qué lenguaje sostiene cada expectativa.",
    scatterInfo:
      "Cada punto es una señal de humanidad de marca. Horizontal: nivel de instalación. Vertical: menciones revisadas. Tamaño: número de fuentes.",
    maturityChartTitle: "La demanda de humano ya opera como default.",
    scaleChartTitle: "Dónde aparece más conversación sobre marcas.",
    scatterTitle: "Cómo se distribuye la exposición por señal.",
    brandLead:
      "Las señales aterrizan en decisiones concretas: acceso a humano, voz, transparencia, criterio y responsabilidad.",
    ctaEyebrow: "Siguiente paso",
    ctaTitle: "¿En qué momento tu marca deja de sentirse humana?",
    ctaBody:
      "Este es un radar exploratorio. El paso siguiente es preguntarse, para una marca concreta, en cuál de las 6 señales está más expuesta y qué debería estar haciendo para conservar humanidad en los momentos que importan.",
    ctaButton: "Conversemos"
  }
};

const homeBrandCatalog = [
  { name: "Inmuebles24", patterns: [/\bInmuebles\s*24\b/i, /@Inmuebles24/i], vertical: "platforms" },
  { name: "Homie", patterns: [/\bHomie\b/i, /@Homie/i], vertical: "platforms" },
  { name: "Propiedades.com", patterns: [/\bPropiedades\.?com\b/i], vertical: "platforms" },
  { name: "Mercado Libre Inmuebles", patterns: [/\bMercado\s?Libre\s+Inmuebles\b/i, /\bMercado\s?Libre\b/i], vertical: "platforms" },
  { name: "La Haus", patterns: [/\bLa\s?Haus\b/i, /\bLaHaus\b/i], vertical: "platforms" },
  { name: "Vivanuncios", patterns: [/\bVivanuncios\b/i], vertical: "platforms" },
  { name: "Lamudi", patterns: [/\bLamudi\b/i], vertical: "platforms" },
  { name: "Tuhabi", patterns: [/\bTu\s?Habi\b/i, /\bTuhabi\b/i], vertical: "platforms" },
  { name: "Infonavit", patterns: [/\bInfonavit\b/i], vertical: "finance" },
  { name: "Cofinavit", patterns: [/\bCofinavit\b/i], vertical: "finance" },
  { name: "Condusef", patterns: [/\bCondusef\b/i], vertical: "finance" },
  { name: "Profeco", patterns: [/\bProfeco\b/i], vertical: "finance" },
  { name: "Century 21", patterns: [/\bCentury\s?21\b/i], vertical: "realtors" },
  { name: "Tecnocasa", patterns: [/\bTecnocasa\b/i], vertical: "realtors" },
  { name: "Remax", patterns: [/\bRe\s?Max\b/i, /\bRemax\b/i], vertical: "realtors" }
];

const brandCatalog = [
  { name: "BBVA", patterns: [/\bBBVA\b/i, /@BBVA/i], vertical: "banking" },
  { name: "Banorte", patterns: [/\bBanorte\b/i], vertical: "banking" },
  { name: "Santander", patterns: [/\bSantander\b/i], vertical: "banking" },
  { name: "Banamex", patterns: [/\bBanamex\b/i, /\bCitibanamex\b/i], vertical: "banking" },
  { name: "HSBC", patterns: [/\bHSBC\b/i], vertical: "banking" },
  { name: "Banco Azteca", patterns: [/\bBanco Azteca\b/i], vertical: "banking" },
  { name: "Mercado Pago", patterns: [/\bMercado Pago\b/i, /\bMercadoPago\b/i], vertical: "banking" },
  { name: "Telcel", patterns: [/\bTelcel\b/i], vertical: "telcos" },
  { name: "Movistar", patterns: [/\bMovistar\b/i], vertical: "telcos" },
  { name: "AT&T", patterns: [/\bAT&T\b/i, /\bATT\b/i], vertical: "telcos" },
  { name: "Izzi", patterns: [/\bIzzi\b/i], vertical: "telcos" },
  { name: "Amazon", patterns: [/\bAmazon\b/i], vertical: "retail" },
  { name: "Mercado Libre", patterns: [/\bMercado Libre\b/i, /\bMercadoLibre\b/i], vertical: "retail" },
  { name: "Walmart", patterns: [/\bWalmart\b/i], vertical: "retail" },
  { name: "Aurrera", patterns: [/\bAurrera\b/i], vertical: "retail" },
  { name: "Soriana", patterns: [/\bSoriana\b/i], vertical: "retail" },
  { name: "Liverpool", patterns: [/\bLiverpool\b/i, /@liverpoolmexico/i], vertical: "retail" },
  { name: "Palacio", patterns: [/\bPalacio de Hierro\b/i], vertical: "retail" },
  { name: "Sears", patterns: [/\bSears\b/i], vertical: "retail" },
  { name: "Coppel", patterns: [/\bCoppel\b/i], vertical: "retail" },
  { name: "Elektra", patterns: [/\bElektra\b/i], vertical: "retail" },
  { name: "SHEIN", patterns: [/\bSHEIN\b/i, /\bShein\b/i], vertical: "retail" },
  { name: "Temu", patterns: [/\bTemu\b/i], vertical: "retail" },
  { name: "Rappi", patterns: [/\bRappi\b/i], vertical: "delivery" },
  { name: "Uber Eats", patterns: [/\bUber Eats\b/i, /\bUberEats\b/i], vertical: "delivery" },
  { name: "DiDi", patterns: [/\bDiDi\b/i, /@DiDi_Mexico/i], vertical: "delivery" },
  { name: "OXXO", patterns: [/\bOXXO\b/i, /\bOxxo\b/i], vertical: "delivery" },
  { name: "7 Eleven", patterns: [/\b7 Eleven\b/i, /\b7-Eleven\b/i], vertical: "delivery" },
  { name: "Starbucks", patterns: [/\bStarbucks\b/i], vertical: "delivery" },
  { name: "McDonald's", patterns: [/\bMcDonald's\b/i, /\bMcDonalds\b/i], vertical: "delivery" },
  { name: "Burger King", patterns: [/\bBurger King\b/i], vertical: "delivery" },
  { name: "KFC", patterns: [/\bKFC\b/i], vertical: "delivery" },
  { name: "Domino's", patterns: [/\bDomino'?s\b/i], vertical: "delivery" },
  { name: "Aeroméxico", patterns: [/\bAeromexico\b/i, /\bAeroméxico\b/i, /@Aeromexico/i], vertical: "airlines" },
  { name: "Volaris", patterns: [/\bVolaris\b/i, /@viajaVolaris/i], vertical: "airlines" },
  { name: "Viva Aerobus", patterns: [/\bViva Aerobus\b/i, /\bVivaAerobus\b/i], vertical: "airlines" },
  { name: "Coca-Cola", patterns: [/\bCoca-Cola\b/i, /\bCoca Cola\b/i], vertical: "cpg" },
  { name: "Pepsi", patterns: [/\bPepsi\b/i], vertical: "cpg" },
  { name: "Bimbo", patterns: [/\bBimbo\b/i], vertical: "cpg" },
  { name: "Sabritas", patterns: [/\bSabritas\b/i], vertical: "cpg" },
  { name: "Doritos", patterns: [/\bDoritos\b/i], vertical: "cpg" },
  { name: "Cheetos", patterns: [/\bCheetos\b/i], vertical: "cpg" },
  { name: "Takis", patterns: [/\bTakis\b/i], vertical: "cpg" },
  { name: "Gatorade", patterns: [/\bGatorade\b/i], vertical: "cpg" },
  { name: "Red Bull", patterns: [/\bRed Bull\b/i], vertical: "cpg" }
];

const noisiaMethodologies = [
  "Triggers & Barriers",
  "Value Perception Matrix",
  "Cultural Codes Decoding",
  "Decision Velocity",
  "Journey Friction Mapping",
  "Influence Architecture"
];

function padOrder(order: number) {
  return String(order).padStart(2, "0");
}

function stripEmoji(input: string) {
  return input.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "");
}

function cleanText(input: string, maxLength = 260) {
  const compact = stripEmoji(input)
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength).trimEnd().replace(/[.,;:!?-]+$/g, "")}...`;
}

function displayCopy(input: string) {
  return input
    .replaceAll("De la performance al resguardo", "Del tener que demostrar al poder respirar")
    .replaceAll("aspiración performativa", "presumir como obligación")
    .replaceAll("Aspiración performativa", "Presumir como obligación")
    .replaceAll("performance productiva", "presión por rendir")
    .replaceAll("performance social", "presión por mostrarse")
    .replaceAll("performance comunicacional", "presión por sonar perfecto");
}

function platformName(input: string) {
  const map: Record<string, string> = {
    tiktok: "TikTok",
    youtube: "YouTube",
    instagram: "Instagram",
    facebook: "Facebook",
    reddit: "Reddit",
    x: "X",
    linkedin: "LinkedIn"
  };

  return map[input.toLowerCase()] ?? input;
}

function isFutureHumanReport(report: InsightReport) {
  return report.meta.study === futureHumanStudy;
}

function isMexicanHomeReport(report: InsightReport) {
  return report.meta.study === mexicanHomeStudy;
}

function getReportCopy(report: InsightReport) {
  return report.pageCopy ?? (isFutureHumanReport(report) ? reportCopy.futureHuman : reportCopy.foresight);
}

function makeSectionLinks(report: InsightReport) {
  const lookedForLabel = isFutureHumanReport(report) || isMexicanHomeReport(report) ? "Qué buscamos" : "Señales";

  return [
    { id: "cover", label: "Cover" },
    { id: "opening", label: isFutureHumanReport(report) ? "Apertura" : "Contexto" },
    { id: "looked-for", label: lookedForLabel },
    { id: "radar", label: "Radar" },
    ...report.signals.map((signal) => ({ id: `signal-${signal.order}`, label: padOrder(signal.order) })),
    { id: "brands", label: "Marcas" },
    { id: "methodology", label: "Método" },
    { id: "cta", label: "Contacto" }
  ];
}

function methodologyChipItems(report: InsightReport) {
  return isFutureHumanReport(report) ? noisiaMethodologies : report.methodology.lenses_applied;
}

function heroVisualAsset(report: InsightReport) {
  if (report.heroVisual) {
    return report.heroVisual;
  }

  if (isFutureHumanReport(report)) {
    return {
      src: "/assets/insights/future-is-human-hero-v2.png",
      alt: `Visual editorial para ${report.meta.study}`
    };
  }

  return {
    src: "/assets/insights/cultural-foresight-hero-v2.png",
    alt: `Visual editorial para ${report.meta.study}`
  };
}

function getHeroSummaryChips(report: InsightReport) {
  const period = report.hero_numbers.period;
  const sources = report.hero_numbers.sources;
  const scale = report.hero_numbers.mentions_reviewed ?? report.hero_numbers.evidence ?? report.hero_numbers.corpus_scope;

  return [period ? `${period.value} de escucha` : null, sources?.value, scale ? `${scale.value} menciones` : null].filter(
    Boolean
  ) as string[];
}

function detectBrands(text: string) {
  const homeMatches = homeBrandCatalog.filter((brand) => brand.patterns.some((pattern) => pattern.test(text)));
  const generalMatches = brandCatalog.filter(
    (brand) =>
      brand.patterns.some((pattern) => pattern.test(text)) &&
      !homeMatches.some((homeBrand) => homeBrand.name.toLowerCase().includes(brand.name.toLowerCase()))
  );

  return [...homeMatches, ...generalMatches];
}

function BrandPill({ text }: { text: string }) {
  const brands = detectBrands(text);

  if (!brands.length) {
    return null;
  }

  return (
    <>
      {brands.map((brand) => (
        <span className={styles.brandPill} data-vertical={brand.vertical} key={brand.name}>
          {brand.name}
        </span>
      ))}
    </>
  );
}

function maturityFrameworkText(report: InsightReport, maturity: InsightSignal["maturity"]) {
  if (!isFutureHumanReport(report)) {
    return report.methodology.maturity_framework[maturity];
  }

  const futureHumanMaturity: Record<InsightSignal["maturity"], string> = {
    emergente:
      "Aparece en casos puntuales. Todavía no es expectativa masiva, pero ya revela dónde una marca puede sentirse automática o descuidada.",
    acelerando:
      "La expectativa ya tiene vocabulario público y se dirige a marcas concretas. Si no se atiende, la fricción se vuelve historia.",
    mainstreaming:
      "Ya funciona como default. La gente pide humanidad antes de probar el sistema, no solo después de una mala experiencia."
  };

  return futureHumanMaturity[maturity];
}

function PlatformIcon({ platform }: { platform: string }) {
  const icon = platformIcons[platform.toLowerCase() as keyof typeof platformIcons];

  if (!icon) {
    return <span className={styles.platformFallback}>{platformName(platform).slice(0, 1)}</span>;
  }

  return (
    <svg className={styles.platformIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d={icon.path} />
    </svg>
  );
}

function QuoteGlyph() {
  return (
    <svg className={styles.quoteGlyph} viewBox="0 0 96 72" aria-hidden="true">
      <path d="M12 62c13-8 19-18 19-31V10H8v24h11c0 7-4 13-12 18l5 10Z" />
      <path d="M58 62c13-8 19-18 19-31V10H54v24h11c0 7-4 13-12 18l5 10Z" />
    </svg>
  );
}

function MaturityGlyph({ maturity }: { maturity: InsightSignal["maturity"] }) {
  return <span className={`${styles.maturityIcon} ${styles[`maturityIcon-${maturity}`]}`} aria-hidden="true" />;
}

function signalPlatforms(signal: InsightSignal) {
  return Array.from(new Set(signal.evidence.map((item) => item.platform.toLowerCase())));
}

function SignalPlatformStrip({ signal }: { signal: InsightSignal }) {
  const platforms = signalPlatforms(signal);

  return (
    <span className={styles.platformStrip} aria-label="Plataformas con evidencia textual">
      {platforms.map((platform) => (
        <span key={platform} title={platformName(platform)}>
          <PlatformIcon platform={platform} />
        </span>
      ))}
    </span>
  );
}

function findSignal(report: InsightReport, id: string) {
  return report.signals.find((signal) => signal.id === id);
}

function SectionIntro({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className={styles.sectionIntro}>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {lead ? <p>{lead}</p> : null}
    </div>
  );
}

function PrintChrome({
  page,
  label = "cultural foresight",
  total = printTotalPages
}: {
  page: string;
  label?: string;
  total?: string;
}) {
  return (
    <>
      <div className={styles.printAtmos} aria-hidden="true" />
      <header className={styles.printHeader} aria-hidden="true">
        <div className={styles.printHeaderBrand}>
          <span className={styles.printLogo} />
          <span>· {label}</span>
        </div>
        <div className={styles.printPageNumber}>
          <strong>{page}</strong>
          <span>/ {total}</span>
        </div>
      </header>
      <footer className={styles.printFooter} aria-hidden="true">
        noisia · social intelligence architects
      </footer>
    </>
  );
}

function MaturityBadge({
  signal,
  maturity
}: {
  signal?: InsightSignal;
  maturity?: InsightSignal["maturity"];
}) {
  const value = signal?.maturity ?? maturity;

  if (!value) {
    return null;
  }

  const label = signal?.maturity_label ?? maturityCopy[value].title;

  return (
    <span className={`${styles.maturityBadge} ${styles[`maturity-${value}`]}`}>
      <MaturityGlyph maturity={value} />
      {label}
    </span>
  );
}

const actionEmphasisCandidates = [
  "descanso",
  "contenido que da",
  "no-rendimiento",
  "hobby no monetizable",
  "baja exposición",
  "comunidades cerradas",
  "privacidad emocional",
  "reseñas reales",
  "UGC real",
  "transparencia de patrocinio",
  "curar y simplificar",
  "menos SKUs",
  "microinfluencia",
  "conversación distribuida",
  "mexicanidad contemporánea",
  "criterio sobre identidad",
  "catálogo infinito",
  "testimoniales con guión visible",
  "UGC público obligatorio",
  "cliché folclórico",
  "claim oficial",
  "comentarios negativos",
  "microcomunidades",
  "lenguaje propio",
  "detección pública"
];

function actionEmphasis(input: string) {
  const normalized = input.toLowerCase();
  const candidate = actionEmphasisCandidates.find((item) => normalized.includes(item.toLowerCase()));

  if (candidate) {
    const index = normalized.indexOf(candidate.toLowerCase());

    return {
      before: input.slice(0, index),
      match: input.slice(index, index + candidate.length),
      after: input.slice(index + candidate.length)
    };
  }

  const words = input.split(" ");

  return {
    before: "",
    match: words.slice(0, Math.min(2, words.length)).join(" "),
    after: words.length > 2 ? ` ${words.slice(2).join(" ")}` : ""
  };
}

function ActionItem({ item }: { item: string }) {
  const parts = actionEmphasis(item);

  return (
    <li>
      {parts.before}
      <strong>{parts.match}</strong>
      {parts.after}
    </li>
  );
}

function headlineDetailCopy(input: string) {
  return input;
}

function ChartFigure({
  label,
  title,
  subtitle,
  info,
  children,
  wide = false
}: {
  label: string;
  title: string;
  subtitle: string;
  info: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`${styles.chartSheet} ${wide ? styles.chartSheetWide : ""}`}>
      <header className={styles.chartFigureHeader}>
        <div>
          <span className={styles.chartLabel}>{label}</span>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <details className={styles.chartInfo}>
          <summary>
            <InfoCircle width={17} height={17} strokeWidth={2} aria-hidden />
            Leer gráfica
          </summary>
          <p>{info}</p>
        </details>
      </header>
      <div className={styles.chartCanvas}>{children}</div>
    </article>
  );
}

function UmbrellaSection({
  report,
  printTotal,
  page
}: {
  report: InsightReport;
  printTotal: string;
  page: string;
}) {
  return (
    <aside className={`${styles.umbrellaPanel} ${styles.printDeckPage}`}>
      <PrintChrome page={page} label="hipótesis paraguas" total={printTotal} />
      <span className="eyebrow">Hipótesis paraguas</span>
      <h2>{displayCopy(report.narrative_umbrella.title)}</h2>
      <p>{displayCopy(report.narrative_umbrella.description)}</p>
      <div className={styles.umbrellaGrid}>
        {report.narrative_umbrella.umbrella_logic.map((tier) => (
          <article key={tier.tier}>
            <h3>{tier.tier}</h3>
            <p>{displayCopy(tier.theme)}</p>
            <div>
              {tier.signals.map((id) => (
                <SignalChip report={report} id={id} key={id} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function SignalChip({ report, id }: { report: InsightReport; id: string }) {
  const signal = findSignal(report, id);

  if (!signal) {
    return null;
  }

  return (
    <a
      className={styles.signalChip}
      href={`#signal-${signal.order}`}
      style={{ ["--signal-color" as string]: signal.color }}
    >
      {padOrder(signal.order)} {signal.commercial_name}
    </a>
  );
}

function WrappedSignalTitle({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, index) => (
        <span className={styles.titleWord} key={`${word}-${index}`}>
          {word}
        </span>
      ))}
    </>
  );
}

function splitFastTypingLines(text: string) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > 58 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function PrintSignalEvidence({ signal }: { signal: InsightSignal }) {
  const supportingEvidence = signal.evidence.find(
    (item) =>
      item.platform.toLowerCase() !== signal.lead_quote.platform.toLowerCase() ||
      cleanText(item.text, 120) !== cleanText(signal.lead_quote.text, 120)
  ) ?? signal.evidence[0];
  const primaryHeadline = signal.cultural_headlines[0];

  return (
    <aside className={styles.printSignalEvidence} aria-hidden="true">
      {primaryHeadline ? (
        <div className={styles.printSignalEvidenceStat}>
          <strong>{primaryHeadline.value}</strong>
          <span>{primaryHeadline.label}</span>
          <p>{headlineDetailCopy(primaryHeadline.detail)}</p>
        </div>
      ) : null}
      {supportingEvidence ? (
        <blockquote>
          <div className={styles.leadQuoteMeta}>
            <span className={styles.platformMark}>
              <PlatformIcon platform={supportingEvidence.platform} />
              {platformName(supportingEvidence.platform)}
            </span>
            <span>{supportingEvidence.date}</span>
            {supportingEvidence.mx ? <b>MX</b> : null}
          </div>
          <p>&ldquo;{cleanText(supportingEvidence.text, 190)}&rdquo;</p>
        </blockquote>
      ) : null}
    </aside>
  );
}

function EvidenceItem({
  item,
  signal,
  index
}: {
  item: InsightSignal["evidence"][number];
  signal: InsightSignal;
  index: number;
}) {
  const quote = cleanText(item.text);
  const quoteLines = splitFastTypingLines(quote);

  return (
    <li
      className={index % 2 === 0 ? styles.evidenceLeft : styles.evidenceRight}
      key={`${signal.id}-${item.platform}-${item.date}-${index}`}
      style={{ ["--bubble-index" as string]: index }}
    >
      <div className={styles.evidenceMeta}>
        <span className={styles.platformMark}>
          <PlatformIcon platform={item.platform} />
          {platformName(item.platform)}
        </span>
        <span>{item.date}</span>
        {item.mx ? <b>MX</b> : null}
        <BrandPill text={item.text} />
      </div>
      <blockquote aria-label={`"${quote}"`}>
        {quoteLines.map((line, lineIndex) => (
          <span
            className={styles.quoteLine}
            key={`${signal.id}-${index}-${lineIndex}`}
            style={{ ["--quote-line-index" as string]: lineIndex }}
          >
            {lineIndex === 0 ? "\u201c" : ""}
            {line}
            {lineIndex === quoteLines.length - 1 ? "\u201d" : ""}
          </span>
        ))}
      </blockquote>
      <footer>
        {item.phrase ? <span className={styles.phraseTag}>{item.phrase}</span> : null}
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            Fuente
          </a>
        ) : null}
      </footer>
    </li>
  );
}

function EvidenceList({ signal, evidence }: { signal: InsightSignal; evidence: InsightSignal["evidence"] }) {
  return (
    <ul className={styles.evidenceList} data-reveal-group>
      {evidence.map((item, index) => (
        <EvidenceItem item={item} signal={signal} index={index} key={`${signal.id}-${item.platform}-${item.date}-${index}`} />
      ))}
    </ul>
  );
}

function SignalCard({
  signal,
  evolution,
  printTotal,
  isFutureHuman = false
}: {
  signal: InsightSignal;
  evolution?: InsightReport["signalEvolution"][string];
  printTotal: string;
  isFutureHuman?: boolean;
}) {
  const fallbackEvidence: InsightSignal["evidence"] = [
    {
      text: signal.lead_quote.text,
      platform: signal.lead_quote.platform,
      date: signal.lead_quote.attribution,
      mx: /mx/i.test(signal.lead_quote.attribution)
    }
  ];
  const evidence = signal.evidence.length ? signal.evidence : fallbackEvidence;
  const positiveEvidence = evidence.filter((item) => item.polarity === "positive");
  const negativeEvidence = evidence.filter((item) => item.polarity === "negative");
  const hasDualEvidence = positiveEvidence.length > 0 && negativeEvidence.length > 0;

  return (
    <article
      className={styles.signalCard}
      id={`signal-${signal.order}`}
      style={{ ["--signal-color" as string]: signal.color }}
    >
      <PrintChrome page={padOrder(signal.order + 7)} label={`señal ${padOrder(signal.order)}`} total={printTotal} />
      <header className={styles.signalHeader}>
        <span className={styles.signalNumber}>{padOrder(signal.order)}</span>
        <div>
          <div className={styles.signalHeaderMeta}>
            <span>{signal.is_big_finding ? "El hallazgo principal" : `Señal ${padOrder(signal.order)}`}</span>
            <MaturityBadge signal={signal} />
          </div>
          <h2>
            <WrappedSignalTitle text={displayCopy(signal.commercial_name)} />
          </h2>
          <p>{displayCopy(signal.one_liner)}</p>
        </div>
      </header>

      <section className={styles.signalTension} aria-label={`Tensión de ${signal.commercial_name}`}>
        <span className="eyebrow">{isFutureHuman ? "Tensión de marca" : "Tensión cultural"}</span>
        <div>
          <strong>{displayCopy(signal.tension.left === "Tensión real" ? "Lo que pesa pero no se dice" : signal.tension.left)}</strong>
          <span aria-hidden="true">vs</span>
          <strong>{displayCopy(signal.tension.right === "Tensión real" ? "Lo que pesa pero no se dice" : signal.tension.right)}</strong>
        </div>
      </section>

      <blockquote className={styles.leadQuote}>
        <div className={styles.leadQuoteMeta}>
          <span className={styles.platformMark}>
            <PlatformIcon platform={signal.lead_quote.platform} />
            {platformName(signal.lead_quote.platform)}
          </span>
          <span>{signal.lead_quote.attribution}</span>
          <BrandPill text={signal.lead_quote.text} />
        </div>
        <p>&ldquo;{cleanText(signal.lead_quote.text, 340)}&rdquo;</p>
        <QuoteGlyph />
      </blockquote>

      <SignalEvolutionChart signal={signal} evolution={evolution} />

      <section className={styles.signalReading}>
        <span className="eyebrow">Lectura cultural</span>
        <p>{displayCopy(signal.cultural_reading)}</p>
      </section>

      <section className={styles.headlineGrid} aria-label={`Tres observaciones de ${signal.commercial_name}`}>
        {signal.cultural_headlines.map((headline) => (
          <article className={styles.headlineCard} key={`${signal.id}-${headline.label}`}>
            <strong>{headline.value}</strong>
            <span>{headline.label}</span>
            <p>{headlineDetailCopy(headline.detail)}</p>
            <footer>
              <small>Origen</small>
              <SignalPlatformStrip signal={signal} />
            </footer>
          </article>
        ))}
      </section>
      <PrintSignalEvidence signal={signal} />

      <section className={styles.evidenceSection}>
        <div className={styles.evidenceHeader}>
          <span className="eyebrow">Evidencia textual</span>
          <div className={styles.evidenceSummary}>
            <strong>{signal.volume_indicator.records_analyzed.toLocaleString("es-MX")} menciones revisadas</strong>
            <SignalPlatformStrip signal={signal} />
            <span>{signalPlatforms(signal).length} plataformas con evidencia</span>
          </div>
        </div>
        {hasDualEvidence ? (
          <div className={styles.evidenceDual}>
            <article className={`${styles.evidenceBlock} ${styles.evidenceBlockPositive}`}>
              <span className="eyebrow">Marcas que asumieron</span>
              <EvidenceList signal={signal} evidence={positiveEvidence} />
            </article>
            <article className={`${styles.evidenceBlock} ${styles.evidenceBlockNegative}`}>
              <span className="eyebrow">Marcas que se lavaron las manos</span>
              <EvidenceList signal={signal} evidence={negativeEvidence} />
            </article>
          </div>
        ) : (
          <EvidenceList signal={signal} evidence={evidence} />
        )}
      </section>

      <section className={styles.implicationsGrid}>
        <div className={styles.doPanel}>
          <span className="eyebrow">Qué puedes hacer</span>
          <ul>
            {signal.brand_implications.do.map((item) => (
              <ActionItem item={item} key={item} />
            ))}
          </ul>
        </div>
        <div className={styles.avoidPanel}>
          <span className="eyebrow">Qué deberías evitar</span>
          <ul>
            {signal.brand_implications.avoid.map((item) => (
              <ActionItem item={item} key={item} />
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.categoryBlock}>
        <div>
          <span className="eyebrow">Categorías expuestas</span>
          <ul className={styles.chipList}>
            {signal.brand_implications.categories_exposed.map((item) => (
              <li className={styles.chipOutlined} key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <span className="eyebrow">Categorías con oportunidad</span>
          <ul className={styles.chipList}>
            {signal.brand_implications.categories_opportunity.map((item) => (
              <li className={styles.chipFilled} key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.monitorBlock}>
        <span className="eyebrow">Qué monitorear después</span>
        <ul className={styles.chipList}>
          {signal.monitor_next.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}

export function InsightReportPage({ report, locale = "es" }: { report: InsightReport; locale?: string }) {
  const heroNumbers = heroNumberOrder.map((key) => report.hero_numbers[key]).filter(Boolean);
  const methodLimitations = report.methodology.limitations.map((item) =>
    item.includes("Mundial") ? "Los eventos de calendario masivo se trataron como contexto externo; no se analizaron como señal." : item
  );
  const copy = getReportCopy(report);
  const sectionLinks = makeSectionLinks(report);
  const isFutureHuman = isFutureHumanReport(report);
  const isMexicanHome = isMexicanHomeReport(report);
  const seededMethodologyItems = report.methodology.corpus.territories ?? report.methodology.corpus.brand_seeds ?? [];
  const seededMethodologyLabel = report.methodology.corpus.territories ? "Territorios sembrados" : "Verticales sembradas";
  const hasSeededMethodology = seededMethodologyItems.length > 0;
  const printPagesTotal = String(report.signals.length + 10);
  const printPage = (page: number) => padOrder(page);
  const heroVisual = heroVisualAsset(report);
  const heroChips = getHeroSummaryChips(report);

  return (
    <div className={`printScope ${styles.reportRoot}`} lang="es-MX">
      {locale === "en" ? (
        <p className={styles.languageNote} lang="en">
          This report is published in Spanish.
        </p>
      ) : null}
      <section className={styles.reportHero} id="cover">
        <PrintChrome page="01" label={copy.printLabel} total={printPagesTotal} />
        <div className={styles.reportHeroInner}>
          <div className={styles.heroText}>
            {!isMexicanHome ? <span className="eyebrow">NOISIA · INTELIGENCIA SOCIAL</span> : null}
            <h1>{report.meta.study}</h1>
            <p>{report.meta.subtitle}</p>
          </div>

          <aside className={styles.heroVisual} aria-label="Imagen editorial del reporte">
            <Image
              src={heroVisual.src}
              alt={heroVisual.alt}
              fill
              priority
              sizes="(max-width: 980px) 100vw, 34vw"
              className={styles.heroVisualImage}
            />
          </aside>

          <div className={styles.heroFooter}>
            <div className={styles.heroMeta}>
              {heroChips.map((item) => (
                <span className={styles.heroMetaChip} key={item}>
                  {item}
                </span>
              ))}
            </div>
            <div className={styles.heroCtaRow}>
              <DownloadPrintButton />
            </div>
          </div>
        </div>
      </section>

      <nav className={styles.stickyNav} aria-label="Navegación del reporte">
        <div className={styles.stickyNavTrack}>
          {sectionLinks.map((section) => (
            <a className={styles.stickyNavLink} href={`#${section.id}`} key={section.id}>
              {section.label}
            </a>
          ))}
        </div>
      </nav>

      <div className={styles.reportMain}>
        <section className={styles.openingSection} id="opening">
          <PrintChrome page="02" label="contexto" total={printPagesTotal} />
          <div className={styles.editorialColumn}>
            <p className={styles.openingLead}>{copy.openingLead}</p>
            {copy.openingParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

        <UmbrellaSection report={report} printTotal={printPagesTotal} page="03" />

        <section className={styles.contractSection} id="looked-for">
          <PrintChrome page="04" label="contrato de lectura" total={printPagesTotal} />
          <SectionIntro
            eyebrow={copy.contractEyebrow}
            title={copy.contractTitle}
            lead={copy.contractLead}
          />
          <div className={styles.contractGrid}>
            <article>
              <h3>{copy.searchedTitle}</h3>
              <ul>
                {copy.searchedItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article>
              <h3>{copy.cannotTitle}</h3>
              <ul>
                {copy.cannotItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
          <div className={styles.maturityFramework}>
            <header className={styles.maturityFrameworkHeader}>
              <span className="eyebrow">{copy.maturityFrameworkEyebrow}</span>
              <h3>{copy.maturityFrameworkTitle}</h3>
            </header>
            <div className={styles.maturityFrameworkCards}>
              {maturityOrder.map((maturity) => (
                <article key={maturity}>
                  <MaturityBadge maturity={maturity} />
                  <p>{maturityFrameworkText(report, maturity)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.radarSection} id="radar">
          <div className={styles.printDeckPage}>
            <PrintChrome page="05" label="radar cultural" total={printPagesTotal} />
            <SectionIntro
              eyebrow={copy.radarEyebrow}
              title={copy.radarTitle}
              lead={copy.radarLead}
            />

            <div className={styles.radarColumns}>
              {maturityOrder.map((maturity) => (
                <article
                  className={styles.radarColumn}
                  key={maturity}
                >
                  <header>
                    <MaturityBadge maturity={maturity} />
                    {!isFutureHuman ? <p>{maturityCopy[maturity].note}</p> : null}
                  </header>
                  <ol>
                    {report.signals
                      .filter((signal) => signal.maturity === maturity)
                      .map((signal) => (
                        <li key={signal.id}>
                          <a href={`#signal-${signal.order}`} style={{ ["--signal-color" as string]: signal.color }}>
                            <span>{padOrder(signal.order)}</span>
                            <strong>{signal.commercial_name}</strong>
                            <small>{signal.one_liner}</small>
                          </a>
                        </li>
                      ))}
                  </ol>
                </article>
              ))}
            </div>
          </div>

          <div className={`${styles.chartGrid} ${styles.printDeckPage}`}>
            <PrintChrome page="06" label="lectura visual" total={printPagesTotal} />
            <ChartFigure
              label={copy.chartMixLabel}
              title={copy.maturityChartTitle}
              subtitle={copy.chartMixSubtitle}
              info={copy.chartMixInfo}
            >
              <MaturityDistributionChart signals={report.signals} />
            </ChartFigure>
            <ChartFigure
              label="Signal scale"
              title={copy.scaleChartTitle}
              subtitle={copy.scaleChartSubtitle}
              info={copy.scaleChartInfo}
            >
              <SignalScaleChart signals={report.signals} />
            </ChartFigure>
          </div>

          <div className={`${styles.chartGrid} ${styles.chartGridSingle} ${styles.printDeckPage}`}>
            <PrintChrome page="07" label="evidencia comparada" total={printPagesTotal} />
            <ChartFigure
              label={copy.scatterLabel}
              title={copy.scatterTitle}
              subtitle={copy.scatterSubtitle}
              info={copy.scatterInfo}
              wide
            >
              <SignalEvidenceScatter signals={report.signals} axisLabel={isFutureHuman ? "Nivel de instalación" : undefined} />
            </ChartFigure>
          </div>
        </section>

        <section className={styles.signalStack} aria-label="Señales culturales">
          {report.signals.map((signal) => (
            <SignalCard
              signal={signal}
              evolution={report.signalEvolution[signal.id]}
              printTotal={printPagesTotal}
              isFutureHuman={isFutureHuman}
              key={signal.id}
            />
          ))}
        </section>

        <section className={styles.brandSection} id="brands">
          <PrintChrome page={printPage(report.signals.length + 8)} label="movimientos de marca" total={printPagesTotal} />
          <SectionIntro
            eyebrow="Qué significa para marcas"
            title="Cinco movimientos para pasar de lectura a decisión."
            lead={copy.brandLead}
          />
          <div className={styles.brandGrid}>
            {report.brand_action_map.map((action, index) => (
              <article className={styles.brandCard} key={action.pillar}>
                <span>{padOrder(index + 1)}</span>
                <h3>{action.pillar}</h3>
                <div>
                  <strong>Qué puedes hacer</strong>
                  <p>{displayCopy(action.do)}</p>
                </div>
                <div>
                  <strong>Qué deberías evitar</strong>
                  <p>{displayCopy(action.avoid)}</p>
                </div>
                <footer>
                  {action.signals_relevant.map((id) => (
                    <SignalChip report={report} id={id} key={id} />
                  ))}
                </footer>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.methodSection} id="methodology">
          <PrintChrome page={printPage(report.signals.length + 9)} label="método" total={printPagesTotal} />
          <SectionIntro
            eyebrow="Cómo se leyeron las señales"
            title="Escuchamos, leímos y citamos."
            lead={report.methodology.opening_statement}
          />
          <div className={styles.methodGrid}>
            <article>
              <h3>Cómo trabajamos</h3>
              <ul>
                {report.methodology.principles.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article>
              <h3>Qué escuchamos</h3>
              <dl>
                <div>
                  <dt>Fuentes</dt>
                  <dd>{report.methodology.corpus.sources_used.join(" · ")}</dd>
                </div>
                <div>
                  <dt>Plataformas</dt>
                  <dd>{report.methodology.corpus.platforms.join(" · ")}</dd>
                </div>
                <div>
                  <dt>Periodo</dt>
                  <dd>{report.methodology.corpus.period}</dd>
                </div>
                <div>
                  <dt>Idioma</dt>
                  <dd>{report.methodology.corpus.language_focus}</dd>
                </div>
                <div>
                  <dt>Escala</dt>
                  <dd>{report.methodology.corpus.volume_scope}</dd>
                </div>
              </dl>
            </article>
          </div>
          {hasSeededMethodology ? (
            <div className={styles.verticalSeedBlock}>
              <span className="eyebrow">{seededMethodologyLabel}</span>
              <ul className={styles.verticalBadges}>
                {seededMethodologyItems.map((seed) => (
                  <li key={seed}>{seed}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className={`${styles.heroStats} ${styles.methodStats}`} aria-label="Snapshot de escala metodológica">
            {heroNumbers.map((item) => (
              <li key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <p>{item.detail}</p>
              </li>
            ))}
          </ul>
          <div className={styles.methodChips}>
            {methodologyChipItems(report).map((methodology) => (
              <MethodologyChip identifier={methodology} key={methodology} />
            ))}
          </div>
          <div className={styles.limitations}>
            <h3>Limitaciones</h3>
            <ul>
              {methodLimitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className={styles.ctaSection} id="cta">
          <PrintChrome page={printPage(report.signals.length + 10)} label="siguiente paso" total={printPagesTotal} />
          <span className="eyebrow">{copy.ctaEyebrow}</span>
          <h2>{copy.ctaTitle}</h2>
          <p>{copy.ctaBody}</p>
          <div className="hero-actions">
            <Button href="/taller" arrow>
              {copy.ctaButton}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
