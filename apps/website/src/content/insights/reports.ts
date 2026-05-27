import rawForesightReport from "./noisia-foresight-master-handoff.json";
import { signalEvolution as foresightSignalEvolution } from "./noisia_foresight_2026_signal_evolution";
import { signalEvolution as futureHumanSignalEvolution } from "./noisia_future_is_human_signal_evolution";
import rawFutureHumanReport from "./noisia_future_is_human_master_handoff.json";
import rawMexicanHomeReport from "./noisia_mexican_home_master_handoff.json";
import { signalEvolution as mexicanHomeSignalEvolution } from "./noisia_mexican_home_signal_evolution";

export type HeroNumber = {
  value: string;
  label: string;
  detail: string;
};

export type SignalEvidence = {
  text: string;
  platform: string;
  date: string;
  url?: string;
  mx: boolean;
  source?: string;
  polarity?: "positive" | "negative";
  phrase?: string;
};

export type CulturalHeadline = {
  value: string;
  label: string;
  detail: string;
};

export type InsightSignal = {
  id: string;
  order: number;
  commercial_name: string;
  color: string;
  one_liner: string;
  tension: {
    left: string;
    right: string;
  };
  lead_quote: {
    text: string;
    platform: string;
    attribution: string;
  };
  cultural_reading: string;
  cultural_headlines: CulturalHeadline[];
  brand_implications: {
    do: string[];
    avoid: string[];
    categories_exposed: string[];
    categories_opportunity: string[];
  };
  monitor_next: string[];
  maturity: "emergente" | "acelerando" | "mainstreaming";
  maturity_label?: string;
  maturity_note: string;
  is_big_finding?: boolean;
  volume_indicator: {
    records_analyzed: number;
    mx_evidence_estimated: number;
    sources_count: number;
    framing: string;
  };
  evidence: SignalEvidence[];
};

export type SignalEvolutionMonth = {
  month: string;
  mentions: number;
};

export type SignalEvolutionSeries = {
  id: string;
  name: string;
  color: string;
  maturity: InsightSignal["maturity"];
  total: number;
  monthly: SignalEvolutionMonth[];
};

export type SignalEvolutionMap = Record<string, SignalEvolutionSeries>;

export type BrandAction = {
  pillar: string;
  do: string;
  avoid: string;
  signals_relevant: string[];
};

export type NarrativeUmbrella = {
  title: string;
  subtitle: string;
  description: string;
  umbrella_logic: Array<{
    tier: string;
    signals: string[];
    theme: string;
  }>;
};

export type Methodology = {
  opening_statement: string;
  principles: string[];
  corpus: {
    sources_used: string[];
    platforms: string[];
    period: string;
    language_focus: string;
    volume_scope: string;
    brand_seeds?: string[];
    territories?: string[];
  };
  lenses_applied: string[];
  limitations: string[];
  maturity_framework: Record<InsightSignal["maturity"], string>;
};

export type InsightHeroVisual = {
  src: string;
  alt: string;
};

export type InsightPageCopy = {
  printLabel: string;
  heroVisualKicker: string;
  heroVisualTitle: string;
  heroVisualBody: string;
  openingLead: string;
  openingParagraphs: string[];
  contractEyebrow: string;
  contractTitle: string;
  contractLead: string;
  keyInsightsTitle: string;
  keyInsightsLead: string;
  searchedTitle: string;
  searchedItems: string[];
  cannotTitle: string;
  cannotItems: string[];
  radarEyebrow: string;
  radarTitle: string;
  radarLead: string;
  maturityFrameworkEyebrow: string;
  maturityFrameworkTitle: string;
  chartMixLabel: string;
  chartMixSubtitle: string;
  chartMixInfo: string;
  scaleChartSubtitle: string;
  scaleChartInfo: string;
  scatterLabel: string;
  scatterSubtitle: string;
  scatterInfo: string;
  maturityChartTitle: string;
  scaleChartTitle: string;
  scatterTitle: string;
  brandLead: string;
  ctaEyebrow: string;
  ctaTitle: string;
  ctaBody: string;
  ctaButton: string;
};

export type InsightReport = {
  slug: string;
  aliases?: string[];
  indexLabel: string;
  ctaHref: string;
  heroVisual?: InsightHeroVisual;
  pageCopy?: InsightPageCopy;
  meta: {
    study: string;
    subtitle: string;
    agency: string;
    version: string;
    analysis_date: string;
    codex_instructions?: string;
  };
  hero_numbers: Record<string, HeroNumber>;
  narrative_umbrella: NarrativeUmbrella;
  signals: InsightSignal[];
  signalEvolution: SignalEvolutionMap;
  brand_action_map: BrandAction[];
  methodology: Methodology;
};

const foresightReport = rawForesightReport as unknown as Omit<InsightReport, "slug" | "indexLabel" | "ctaHref" | "signalEvolution">;
const futureHumanReport = rawFutureHumanReport as unknown as Omit<InsightReport, "slug" | "indexLabel" | "ctaHref" | "signalEvolution">;
const mexicanHomeRawReport = rawMexicanHomeReport as unknown as Omit<InsightReport, "slug" | "indexLabel" | "ctaHref" | "signalEvolution">;
const foresightSignalEvolutionMap = foresightSignalEvolution as unknown as SignalEvolutionMap;
const futureHumanSignalEvolutionMap = futureHumanSignalEvolution as unknown as SignalEvolutionMap;
const mexicanHomeSignalEvolutionMap = mexicanHomeSignalEvolution as unknown as SignalEvolutionMap;

export const mexicoForesight2026Report: InsightReport = {
  ...foresightReport,
  signalEvolution: foresightSignalEvolutionMap,
  slug: "cultural-foresight-mexico-2026",
  aliases: ["mexico-esta-cansado-de-performar"],
  indexLabel: "Cultural Foresight México 2026",
  ctaHref: "/diagnostico",
  heroVisual: {
    src: "/assets/insights/cultural-foresight-editorial.png",
    alt: "Retrato editorial con efecto anaglyph para Cultural Foresight México 2026"
  }
};

export const futureIsHumanReport: InsightReport = {
  ...futureHumanReport,
  signalEvolution: futureHumanSignalEvolutionMap,
  slug: "future-is-human",
  indexLabel: "Future is Human",
  ctaHref: "/contacto",
  heroVisual: {
    src: "/assets/insights/future-is-human-editorial.png",
    alt: "Retrato editorial con efecto anaglyph para Future is Human"
  }
};

export const mexicanHomeReport: InsightReport = {
  ...mexicanHomeRawReport,
  meta: {
    ...mexicanHomeRawReport.meta,
    subtitle: "8 señales sobre qué significa hogar para México hoy"
  },
  signalEvolution: mexicanHomeSignalEvolutionMap,
  slug: "the-mexican-home",
  indexLabel: "The Mexican Home",
  ctaHref: "/contacto",
  heroVisual: {
    src: "/assets/insights/mexican-home-editorial.png",
    alt: "Mujer sosteniendo una llave con efecto anaglyph y trazo de casa"
  },
  pageCopy: {
    printLabel: "the mexican home",
    heroVisualKicker: "Hogar mexicano contemporáneo",
    heroVisualTitle: "El hogar mexicano se volvió infraestructura emocional.",
    heroVisualBody: "8 señales sobre identidad, refugio, acceso, confianza y vida doméstica.",
    openingLead: "¿Qué significa hogar para México hoy?",
    openingParagraphs: [
      "Lo primero que el corpus revela: la palabra que se usa para hablar con afecto del lugar donde se vive no es casa. Es mi casita.",
      "Y mi casita no es diminutivo. Es identidad declarada.",
      "El hogar mexicano contemporáneo se volvió infraestructura emocional: el lugar donde la gente busca sentirse segura, representada, cómoda, productiva, protegida y en control. Al mismo tiempo, acceder a ese hogar propio se vive como reto económico, burocrático y emocional.",
      "Este reporte no mira el mercado inmobiliario ni la decoración. Lee conversación digital cotidiana sobre cómo se está resignificando el hogar: con lenguaje afectivo, mecánicas financieras reales, realidad multifuncional y demanda creciente de confianza."
    ],
    contractEyebrow: "Qué leímos",
    contractTitle: "No buscamos hogar en abstracto. Buscamos lenguaje cotidiano específico.",
    contractLead:
      "Leímos conversación pública alrededor de afecto, función, aspiración, frustración, confianza y seguridad para entender cómo se nombra el hogar cuando aparece como vida real.",
    keyInsightsTitle: "Key insights",
    keyInsightsLead:
      "El hogar mexicano se volvió infraestructura emocional: identidad, refugio, oficina, meta financiera y filtro de confianza conviven en la misma conversación. El hallazgo dominante es mi casita: una forma afectiva y consolidada de nombrar apropiación, orgullo y pertenencia.",
    searchedTitle: "Lo que sí podemos decir",
    searchedItems: [
      "Que estas 8 señales aparecen en conversación digital pública sobre hogar mexicano.",
      "Qué lenguaje acompaña cada señal: mi casita, renta carísima, trabajo desde mi casa, monta rentas.",
      "Qué tensiones revelan para marcas que entran o permanecen dentro de la vida doméstica.",
      "Cómo se organiza la conversación entre afecto, función, aspiración, acceso y confianza.",
      "Qué implicaciones comerciales deberían detonar para retail, real estate, banca, seguros, smart home y consumo doméstico."
    ],
    cannotTitle: "Lo que no podemos decir",
    cannotItems: [
      "No predice el mercado inmobiliario.",
      "No representa a toda la población mexicana.",
      "No mide precios, oferta, demanda ni indicadores macro.",
      "No es ranking de plataformas inmobiliarias.",
      "No equipara volumen con importancia cultural."
    ],
    radarEyebrow: "Las 8 señales",
    radarTitle: "Por madurez cultural.",
    radarLead:
      "El radar separa la señal dominante de mi casita, cinco tensiones acelerando y dos señales emergentes donde el lenguaje todavía está tomando forma.",
    maturityFrameworkEyebrow: "Clasificación",
    maturityFrameworkTitle: "¿Qué tan instalada está cada forma de hablar del hogar?",
    chartMixLabel: "Mapa de madurez",
    chartMixSubtitle: "Distribución del portafolio cultural por nivel de instalación.",
    chartMixInfo:
      "Cuántas señales caen en cada nivel de madurez. Aquí la madurez orienta qué tan instalado está el vocabulario doméstico.",
    scaleChartSubtitle:
      "Menciones procesadas por señal. El volumen dimensiona la conversación; la lectura estratégica viene del tipo de tensión.",
    scaleChartInfo:
      "Compara escala de conversación revisada por señal. Es contexto de exposición, no ranking de importancia.",
    scatterLabel: "Mapa de exposición",
    scatterSubtitle:
      "La altura muestra escala procesada; la posición muestra madurez cultural. Los marcadores MX ayudan a leer qué lenguaje sostiene cada señal.",
    scatterInfo:
      "Cada punto es una señal sobre hogar. Horizontal: madurez cultural. Vertical: menciones procesadas. Tamaño: número de fuentes.",
    maturityChartTitle: "Mi casita domina, pero cinco señales ya están acelerando.",
    scaleChartTitle: "Dónde se concentra la conversación sobre hogar.",
    scatterTitle: "Cómo se distribuye la exposición por señal.",
    brandLead:
      "Las señales aterrizan en decisiones concretas: lenguaje, producto, financiamiento, confianza y bienestar doméstico.",
    ctaEyebrow: "Siguiente paso",
    ctaTitle: "¿Qué señal está cambiando cómo tu marca entra a la vida doméstica?",
    ctaBody:
      "Este es un radar exploratorio. El siguiente paso es preguntarse, para una categoría específica, en cuál de las 8 señales está más expuesta y qué debería hacer para entrar al hogar mexicano sin imponer el lenguaje equivocado.",
    ctaButton: "Conversemos"
  }
};

export const insightsReports = [mexicanHomeReport, futureIsHumanReport, mexicoForesight2026Report];

export function getInsightReport(slug: string) {
  return insightsReports.find((reportItem) => reportItem.slug === slug || reportItem.aliases?.includes(slug));
}
