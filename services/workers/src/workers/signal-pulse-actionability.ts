const STOPWORDS = new Set([
  "para", "pero", "como", "con", "que", "por", "una", "uno", "los", "las", "del", "este", "esta",
  "esto", "muy", "mas", "menos", "porque", "cuando", "todo", "toda", "todos", "todas", "solo", "bien",
  "mal", "sin", "hay", "son", "soy", "fue", "ser", "mis", "sus", "me", "mi", "ya", "no", "si",
  "tambien", "marca", "producto", "personas", "gente", "hacer", "dice", "dicen", "video", "comentario",
  "hasta", "siempre", "ellos", "ellas", "estan", "estas", "estos", "tiene", "tienen", "tener",
  "sera", "seria", "puede", "pueden", "donde", "quien", "ahora", "aqui", "alla", "algo", "cada",
  "mismo", "misma", "mismos", "mismas", "otro", "otra", "otros", "otras"
]);

const NON_ACTIONABLE_TERMS = new Set([
  "amen", "dios", "jesus", "gracias", "felicidades", "bendiciones", "saludos",
  "link", "links", "http", "https", "www", "click", "clic", "viral",
  "futbol", "partido", "gol", "equipo", "botana",
  "puto", "puta", "pendejo", "pendeja", "verga", "chingar",
  "pinche", "hasta", "siempre", "ellos", "ellas", "estan", "esta", "estas", "este", "estos",
  "manejar", "velocidad", "mejor", "nada", "tiene", "tienen", "tener",
  "morena", "amlo", "claudia", "elecciones", "diputado", "senador"
]);

const RAW_SIGNAL_KEYWORDS = new Set([
  "accidente", "accidentes", "aclarar", "actuan", "alcanzó", "alcanzo", "antojo", "aseguradora",
  "aseguradoras", "auto", "autos", "choque", "choques", "danos", "daños", "dano", "daño",
  "directo", "excelente", "gobernador", "groseras", "manicomio", "padrino", "particulares",
  "potosi", "potosí", "qualitas", "quálitas", "responsable", "saber", "sabritas", "seguro",
  "seguros", "situacion", "situación", "vehiculo", "vehículo", "vehiculos", "vehículos", "vieja"
]);

export const RAW_SIGNAL_OUTPUT_TERMS = RAW_SIGNAL_KEYWORDS;

const TAXONOMY_ROLE_MAP: Array<{ pattern: RegExp; roles: string[]; label: string }> = [
  { pattern: /^fricci[oó]n:\s+/i, roles: ["friction", "containment"], label: "Fricción" },
  { pattern: /^oportunidad:\s+/i, roles: ["content_opportunity", "claim_test", "emerging_signal"], label: "Oportunidad" },
  { pattern: /^riesgo creativo:\s+/i, roles: ["creative_risk", "containment"], label: "Riesgo creativo" },
  { pattern: /^territorio saturado:\s+/i, roles: ["saturation"], label: "Territorio saturado" },
  { pattern: /^claim a testear:\s+/i, roles: ["claim_test", "content_opportunity"], label: "Claim a testear" },
  { pattern: /^se(?:ñ|n)al emergente:\s+/i, roles: ["emerging_signal", "content_opportunity"], label: "Señal emergente" },
  { pattern: /^gap de pauta:\s+/i, roles: ["paid_gap"], label: "Gap de pauta" },
  { pattern: /^contenci[oó]n:\s+/i, roles: ["containment", "creative_risk"], label: "Contención" },
  { pattern: /^monitoreo:\s+/i, roles: ["monitor", "emerging_signal"], label: "Monitoreo" }
];

const GENERIC_SIGNAL_COPY_PATTERNS = [
  /sostienen una se(?:ñ|n)al/i,
  /corpus est[aá] empujando/i,
  /no es una conclusi[oó]n de escritorio/i,
  /sale de un cluster/i,
  /territorio accionable del mes/i,
  /cluster pendiente de s[ií]ntesis/i,
  /usar\s+"[^"]{2,60}"\s+como experimento de contenido/i,
  /mantener\s+"[^"]{2,60}"\s+en monitoreo activo/i
];

const VALID_ANALYSIS_SCOPES = new Set(["current_cut", "window_pattern", "mixed"]);

export type SignalPulseSynthesisValidationInput = {
  title: string;
  description: string;
  marketingRead: string;
  actionHint: string;
  signalRole: string;
  analysisScope: string;
  periodRead?: string;
  windowRead?: string;
  marketingHypothesis?: string;
  nextMonthDecision?: string;
  performanceConnection: string;
  evidenceBasis: string;
  confidenceRationale: string;
  contextSummary?: Partial<{
    samples: number;
    conversation_matches: number;
    knowledge_matches: number;
    period_series_points: number;
    weekly_series_points: number;
    strongest_periods: number;
    weekly_pulses: number;
    marketing_intersections: number;
    evidence_sample_ids: number;
    semantic_evidence_ids: number;
    active_performance_months: number;
    direct_marketing_matches: number;
    synthesis_questions: number;
    pattern_flags: number;
    active_periods: number;
    current_volume: number;
  }>;
};

export type SignalPulseSynthesisValidationResult = {
  publishable: boolean;
  reasons: string[];
};

export function normalizeSignalPhrase(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isRawKeywordSignalPhrase(value: string) {
  const normalized = normalizeSignalPhrase(value);
  if (!normalized) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1) return true;
  if (words.every((word) => RAW_SIGNAL_KEYWORDS.has(word) || STOPWORDS.has(word) || NON_ACTIONABLE_TERMS.has(word))) {
    return true;
  }
  const rawWordCount = words.filter((word) => RAW_SIGNAL_KEYWORDS.has(word)).length;
  if (words.length <= 3 && rawWordCount >= Math.max(1, words.length - 1)) return true;
  return [
    /^friccion\s+/,
    /^oportunidad\s+/,
    /^territorio\s+/,
    /^(alcanzo|alcanz[oó]) aseguradora/,
    /^actuan aseguradoras/,
    /^aclarar situacion/,
    /^directo manicomio$/
  ].some((pattern) => pattern.test(normalized));
}

export function isActionableSignalPulseTerm(term: string) {
  const normalized = normalizeSignalPhrase(term);
  if (!normalized || normalized.length < 4 || /^\d+$/.test(normalized)) return false;
  if (NON_ACTIONABLE_TERMS.has(normalized)) return false;
  if (normalized.includes("http") || normalized.includes("www")) return false;
  return true;
}

export function validateSignalPulseSynthesis(input: SignalPulseSynthesisValidationInput): SignalPulseSynthesisValidationResult {
  const reasons: string[] = [];
  const titleParts = parseSignalPulseTaxonomyTitle(input.title);
  const context = input.contextSummary ?? {};

  if (!titleParts) {
    reasons.push("title_missing_signal_pulse_taxonomy");
  } else {
    const thesis = normalizeSignalPhrase(titleParts.thesis);
    const thesisWords = thesis.split(/\s+/).filter(Boolean);
    if (titleParts.thesis.trim().length < 28 || thesisWords.length < 5 || isRawKeywordSignalPhrase(titleParts.thesis)) {
      reasons.push("title_keyword_or_non_synthetic");
    }
    if (!titleParts.allowedRoles.includes(input.signalRole)) {
      reasons.push("signal_role_mismatch");
    }
  }

  if (!VALID_ANALYSIS_SCOPES.has(input.analysisScope)) reasons.push("analysis_scope_missing");
  if ((input.analysisScope === "window_pattern" || input.analysisScope === "mixed") && numberFromContext(context.active_periods) < 2) {
    reasons.push("window_scope_without_window_pattern");
  }
  if (input.analysisScope === "current_cut" && numberFromContext(context.current_volume) <= 0) {
    reasons.push("current_cut_without_current_volume");
  }

  if (substantiveLength(input.description) < 70) reasons.push("description_too_thin");
  if (substantiveLength(input.marketingRead) < 70) reasons.push("marketing_read_too_thin");
  if (substantiveLength(input.actionHint) < 45) reasons.push("action_hint_too_thin");
  if (substantiveLength(input.confidenceRationale) < 45) reasons.push("confidence_rationale_too_thin");
  if (!hasTraceableMentionId(input.evidenceBasis)) reasons.push("evidence_basis_without_mention_id");
  if (substantiveLength(input.periodRead ?? "") < 60) reasons.push("period_read_too_thin");
  if (substantiveLength(input.windowRead ?? "") < 70) reasons.push("window_read_too_thin");
  if (substantiveLength(input.marketingHypothesis ?? "") < 70) reasons.push("marketing_hypothesis_too_thin");
  if (substantiveLength(input.nextMonthDecision ?? "") < 60) reasons.push("next_month_decision_too_thin");
  if (!hasPeriodLanguage(input.periodRead ?? "")) reasons.push("period_read_missing_period_anchor");
  if (!hasWindowPatternLanguage(input.windowRead ?? "", numberFromContext(context.active_periods))) {
    reasons.push("window_read_missing_window_pattern");
  }
  if (!hasMarketingSourceLanguage(input.marketingHypothesis ?? "")) {
    reasons.push("marketing_hypothesis_missing_marketing_source");
  }
  if (!hasDecisionLanguage(input.nextMonthDecision ?? "") || !hasMeasurementLanguage(`${input.nextMonthDecision ?? ""} ${input.actionHint}`)) {
    reasons.push("next_month_decision_not_measurable");
  }
  if (!hasMeasurementLanguage(input.actionHint)) reasons.push("action_hint_not_measurable");

  const connection = input.performanceConnection.trim().toLowerCase();
  if (!/^(connected|no_connection|insufficient_data):/.test(connection)) reasons.push("performance_connection_unqualified");
  if (connection.startsWith("connected:") && numberFromContext(context.direct_marketing_matches) < 1) {
    reasons.push("connected_without_direct_marketing_overlap");
  }

  if (numberFromContext(context.samples) < 3) reasons.push("insufficient_cluster_samples");
  if (numberFromContext(context.conversation_matches) + numberFromContext(context.knowledge_matches) < 1) {
    reasons.push("missing_rag_evidence");
  }
  if (numberFromContext(context.period_series_points) < 2) reasons.push("missing_monthly_series");
  if (numberFromContext(context.weekly_series_points) < 2) reasons.push("missing_weekly_series");
  if (numberFromContext(context.strongest_periods) < 1) reasons.push("missing_strongest_periods");
  if (numberFromContext(context.weekly_pulses) < 1) reasons.push("missing_weekly_pulses");
  if (numberFromContext(context.marketing_intersections) < 1) reasons.push("missing_marketing_intersection");
  if (numberFromContext(context.pattern_flags) < 1) reasons.push("missing_pattern_flags");
  if (numberFromContext(context.evidence_sample_ids) < 1) reasons.push("missing_evidence_sample_ids");
  if (numberFromContext(context.synthesis_questions) < 2) reasons.push("missing_synthesis_questions");

  const combinedCopy = `${input.title}\n${input.description}\n${input.marketingRead}\n${input.periodRead ?? ""}\n${input.windowRead ?? ""}\n${input.marketingHypothesis ?? ""}\n${input.nextMonthDecision ?? ""}\n${input.actionHint}\n${input.confidenceRationale}`;
  if (GENERIC_SIGNAL_COPY_PATTERNS.some((pattern) => pattern.test(combinedCopy))) {
    reasons.push("generic_keyword_template_copy");
  }

  return {
    publishable: reasons.length === 0,
    reasons: Array.from(new Set(reasons))
  };
}

function parseSignalPulseTaxonomyTitle(title: string) {
  const match = TAXONOMY_ROLE_MAP.find((entry) => entry.pattern.test(title.trim()));
  if (!match) return null;
  return {
    label: match.label,
    allowedRoles: match.roles,
    thesis: title.trim().replace(match.pattern, "")
  };
}

function substantiveLength(value: string) {
  return value.trim().replace(/\s+/g, " ").length;
}

function hasTraceableMentionId(value: string) {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value);
}

function hasPeriodLanguage(value: string) {
  return /\b20\d{2}[-/](0[1-9]|1[0-2])\b|\bsemana\b|\bcorte\b|\bmes\b|\bperiodo\b|\bperiod\b/i.test(value);
}

function hasWindowPatternLanguage(value: string, activePeriods: number) {
  const normalized = normalizeSignalPhrase(value);
  if (!normalized) return false;
  const hasWindowWord = /\b(ventana|meses|periodos|historico|historica|serie|trayectoria|desde|regresa|reactiva|reactivacion|repite|repeticion|satura|saturacion|acelera|aceleracion|caida|anomalia|nuevo|emergente|persistente)\b/i.test(normalized);
  if (activePeriods >= 2) return hasWindowWord;
  return hasWindowWord || /\b(no hay patron|sin patron|solo corte|aislado)\b/i.test(normalized);
}

function hasMarketingSourceLanguage(value: string) {
  return /\b(campa[nñ]a|pauta|paid|org[aá]nico|brief|claim|promesa|creativ[oa]|pieza|performance|search|ecomm|venta|ventas|review|reviews|google business|fuente|fuentes|kb|knowledge|no_connection|sin evidencia|no hay evidencia|sin conexi[oó]n)\b/i.test(value);
}

function hasDecisionLanguage(value: string) {
  return /\b(probar|testear|medir|auditar|pausar|mover|monitorear|comparar|ajustar|revisar|contener|activar|desactivar|separar|validar|publicar|no escalar|no pautar|priorizar)\b/i.test(value);
}

function hasMeasurementLanguage(value: string) {
  return /\b(medir|comparar|validar|monitorear|ctr|costo|interacci[oó]n|engagement|volumen|sentimiento|comentarios|dudas|quejas|menciones|hook rate|conversion|conversi[oó]n|guardados|shares|respuesta|control|baseline)\b/i.test(value);
}

function numberFromContext(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
