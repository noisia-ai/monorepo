export const CORPUS_ASSESSMENT_PIPELINE_VERSION = "corpus-assessment-v3-stratified";
export const CORPUS_ASSESSMENT_FULL_POPULATION_LIMIT = 5_000;
export const CORPUS_ASSESSMENT_STRATIFIED_SAMPLE_SIZE = 2_000;
export const CORPUS_ASSESSMENT_BATCH_SIZE = 75;

export type CorpusAssessmentMention = {
  id: string;
  text_snippet: string;
  platform: string;
  language: string | null;
  country: string | null;
  sentiment_source: string | null;
};

export type CorpusAssessmentClassification = {
  mention_id: string;
  relevance: "relevant" | "partial" | "noise";
  signal_types: string[];
  reason: string;
};

export type DeterministicCorpusAssessment = {
  ready_for_study: boolean;
  confidence: number;
  verdict: "ready" | "needs_more_signal" | "needs_more_volume" | "corpus_too_noisy";
  coverage: {
    trigger_signal_pct: number;
    barrier_signal_pct: number;
    experience_signal_pct: number;
    noise_pct: number;
  };
  metrics: {
    population_size: number;
    classified_size: number;
    relevant_count_estimate: number;
    weighted_signal_density_pct: number;
    full_population_classified: boolean;
  };
  signals_well_covered: string[];
  signals_missing: string[];
  recommendation: string;
};

export function buildCorpusClassificationPrompt(input: {
  methodologySlug: string;
  businessQuestion: string | null;
  subjectName: string;
  geoFocus: string[];
  mentions: CorpusAssessmentMention[];
}) {
  return [
    "Clasifica evidencia del corpus de Noisia. Devuelve solo el objeto JSON solicitado.",
    "No calcules scores, porcentajes, confianza ni readiness; el sistema los calcula de forma deterministica.",
    "Clasifica cada mention_id exactamente una vez.",
    "relevance: relevant si aporta evidencia interpretable a la pregunta/metodologia; partial si tiene contexto util pero incompleto; noise si es coincidencia, spam, listing, noticia sin experiencia, contenido fuera de alcance o texto vacio.",
    "signal_types: usa solo trigger, barrier, experience, comparison, category_language u other_signal. Para noise usa [].",
    "reason: una frase breve y verificable basada en el texto.",
    "Para Triggers & Barriers: trigger es motivo/momento que impulsa conducta; barrier es friccion/freno; experience es relato de uso, compra o postcompra. No infieras sin evidencia textual.",
    "Contexto:",
    JSON.stringify({
      methodology_slug: input.methodologySlug,
      business_question: input.businessQuestion,
      subject_name: input.subjectName,
      geo_focus: input.geoFocus
    }),
    "Menciones:",
    JSON.stringify(input.mentions)
  ].join("\n");
}

export function computeDeterministicCorpusAssessment(input: {
  populationSize: number;
  classifications: CorpusAssessmentClassification[];
}): DeterministicCorpusAssessment {
  const classifiedSize = input.classifications.length;
  if (classifiedSize === 0) {
    return emptyAssessment(input.populationSize);
  }

  const counts = new Map<string, number>();
  let relevant = 0;
  let partial = 0;
  let noise = 0;
  for (const classification of input.classifications) {
    if (classification.relevance === "relevant") relevant += 1;
    else if (classification.relevance === "partial") partial += 1;
    else noise += 1;
    for (const signalType of new Set(classification.signal_types)) {
      counts.set(signalType, (counts.get(signalType) ?? 0) + 1);
    }
  }

  const weightedSignalCount = relevant + partial * 0.5;
  const densityPct = percent(weightedSignalCount, classifiedSize);
  const noisePct = percent(noise, classifiedSize);
  const triggerPct = percent(counts.get("trigger") ?? 0, classifiedSize);
  const barrierPct = percent(counts.get("barrier") ?? 0, classifiedSize);
  const experiencePct = percent(counts.get("experience") ?? 0, classifiedSize);
  const sampleFraction = Math.min(1, classifiedSize / Math.max(1, input.populationSize));
  const evidenceDepth = Math.min(1, classifiedSize / 1_000);
  const confidence = round(100 * (sampleFraction * 0.55 + evidenceDepth * 0.45), 1);
  const estimatedRelevant = Math.round(input.populationSize * (weightedSignalCount / classifiedSize));
  const hasCoreCoverage = triggerPct >= 5 && barrierPct >= 5;

  let verdict: DeterministicCorpusAssessment["verdict"] = "needs_more_signal";
  if (noisePct > 60 || densityPct < 30) verdict = "corpus_too_noisy";
  else if (estimatedRelevant < 500) verdict = "needs_more_volume";
  else if (densityPct >= 40 && hasCoreCoverage) verdict = "ready";

  const signalEntries = [
    ["triggers", triggerPct],
    ["barriers", barrierPct],
    ["experiences", experiencePct],
    ["comparisons", percent(counts.get("comparison") ?? 0, classifiedSize)],
    ["category language", percent(counts.get("category_language") ?? 0, classifiedSize)]
  ] as const;
  const signalsWellCovered = signalEntries
    .filter(([, value]) => value >= 5)
    .map(([label, value]) => `${label}: ${value}% de la muestra clasificada`);
  const signalsMissing = signalEntries
    .filter(([, value]) => value < 5)
    .map(([label]) => label);

  return {
    ready_for_study: verdict === "ready",
    confidence,
    verdict,
    coverage: {
      trigger_signal_pct: triggerPct,
      barrier_signal_pct: barrierPct,
      experience_signal_pct: experiencePct,
      noise_pct: noisePct
    },
    metrics: {
      population_size: input.populationSize,
      classified_size: classifiedSize,
      relevant_count_estimate: estimatedRelevant,
      weighted_signal_density_pct: densityPct,
      full_population_classified: classifiedSize >= input.populationSize
    },
    signals_well_covered: signalsWellCovered,
    signals_missing: signalsMissing,
    recommendation: recommendationFor(verdict, signalsMissing)
  };
}

function recommendationFor(
  verdict: DeterministicCorpusAssessment["verdict"],
  missing: string[]
) {
  if (verdict === "ready") return "El corpus tiene volumen, densidad y cobertura minima para congelar una revision y ejecutar el estudio.";
  if (verdict === "corpus_too_noisy") return "Limpia el corpus o reimporta menciones con queries mas precisas antes de aprobarlo.";
  if (verdict === "needs_more_volume") return "Importa mas menciones relevantes antes de aprobar el corpus.";
  return `Amplia la captura de ${missing.join(", ") || "los tipos de senal faltantes"} y vuelve a diagnosticar la nueva revision.`;
}

function emptyAssessment(populationSize: number): DeterministicCorpusAssessment {
  return {
    ready_for_study: false,
    confidence: 0,
    verdict: "needs_more_volume",
    coverage: {
      trigger_signal_pct: 0,
      barrier_signal_pct: 0,
      experience_signal_pct: 0,
      noise_pct: 0
    },
    metrics: {
      population_size: populationSize,
      classified_size: 0,
      relevant_count_estimate: 0,
      weighted_signal_density_pct: 0,
      full_population_classified: false
    },
    signals_well_covered: [],
    signals_missing: ["triggers", "barriers", "experiences"],
    recommendation: "Importa menciones antes de diagnosticar el corpus."
  };
}

function percent(value: number, total: number) {
  return round((value / Math.max(1, total)) * 100, 1);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
