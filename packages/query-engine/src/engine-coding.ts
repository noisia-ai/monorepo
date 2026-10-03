import type {
  EngineCodingLabel,
  EngineCodingPromptInput,
  EngineMethodologySpec,
  EngineRunnableMethodologySlug
} from "./engine";

export function buildEngineCodingPrompt(spec: EngineMethodologySpec, input: EngineCodingPromptInput): string {
  return spec.buildCodingPrompt(input);
}

export function parseEngineCodingResponse(raw: string): EngineCodingLabel[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Engine coding response did not contain a JSON object.");
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { codings?: unknown };
  if (!Array.isArray(parsed.codings)) {
    throw new Error("Engine coding response did not include codings[].");
  }
  // Skip individual malformed labels (missing external_ref/finding_key, etc.)
  // instead of throwing, so one bad item in an otherwise-good batch does not
  // discard the whole batch and fail the lens.
  return parsed.codings.flatMap((item) => {
    try {
      return [normalizeCodingLabel(item)];
    } catch {
      return [];
    }
  });
}

export function buildEngineFixtureCodings(
  methodologySlug: EngineRunnableMethodologySlug,
  units: EngineCodingPromptInput["units"]
): EngineCodingLabel[] {
  if (methodologySlug === "narrative-ownership") return units.map(buildNarrativeOwnershipFixtureCoding);
  if (methodologySlug === "sentiment-advocacy-proxy") return units.map(buildSentimentAdvocacyFixtureCoding);
  if (methodologySlug === "trust-risk-benchmark") return units.map(buildTrustRiskFixtureCoding);
  if (methodologySlug === "value-perception-matrix") return units.map(buildValuePerceptionFixtureCoding);
  if (methodologySlug === "journey-friction-mapping") return units.map(buildJourneyFrictionFixtureCoding);
  if (methodologySlug === "category-opportunity-map") return units.map(buildCategoryOpportunityFixtureCoding);
  if (methodologySlug === "white-space-analysis") return units.map(buildWhiteSpaceFixtureCoding);
  if (methodologySlug === "brand-positioning-map") return units.map(buildBrandPositioningFixtureCoding);
  if (methodologySlug === "cultural-codes-decoding") return units.map(buildCulturalCodesFixtureCoding);
  if (methodologySlug === "competitive-wave") return units.map(buildCompetitiveWaveFixtureCoding);
  if (methodologySlug === "audience-segment-lens") return units.map(buildAudienceSegmentFixtureCoding);
  if (methodologySlug === "influence-architecture") return units.map(buildInfluenceArchitectureFixtureCoding);
  if (methodologySlug === "decision-velocity") return units.map(buildDecisionVelocityFixtureCoding);
  if (methodologySlug === "evidence-confidence-layer") return units.map(buildEvidenceConfidenceFixtureCoding);
  return [];
}

const narrativeRules: Array<{ key: string; narrative: string; patterns: RegExp[] }> = [
  {
    key: "cobertura_confiable",
    narrative: "cobertura confiable",
    patterns: [/\bcobertura\b/i, /\bred\b/i, /\bsenal\b/i, /\b5g\b/i]
  },
  {
    key: "precio_sin_trucos",
    narrative: "precio sin trucos",
    patterns: [/\bprecio\b/i, /\bcosto\b/i, /\btarifa\b/i, /\bletras chiquitas\b/i, /\bsin trucos\b/i]
  },
  {
    key: "atencion_que_resuelve",
    narrative: "atencion que resuelve",
    patterns: [/\batencion\b/i, /\bsoporte\b/i, /\bservicio al cliente\b/i, /\bresuelve\b/i]
  },
  {
    key: "libertad_sin_amarres",
    narrative: "libertad sin amarres",
    patterns: [/\bcontrato\b/i, /\bplazo\b/i, /\bamarr/i, /\bcancelar\b/i, /\bcambiarme\b/i]
  },
  {
    key: "control_digital_simple",
    narrative: "control digital simple",
    patterns: [/\bapp\b/i, /\brecarga\b/i, /\bdatos\b/i, /\bpaquete\b/i, /\bplan\b/i]
  }
];

function buildNarrativeOwnershipFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const rule = narrativeRules.find((candidate) => candidate.patterns.some((pattern) => pattern.test(normalized)));
  if (!rule) {
    return insufficientFixtureCoding(unit, { narrative: "senal insuficiente", valence: "neutra" });
  }

  const valence = inferFixtureValence(text);
  return {
    external_ref: unit.external_ref,
    finding_key: rule.key,
    dimensions: {
      narrative: rule.narrative,
      valence
    },
    intensity: valence === "neutra" ? 2 : 4,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildSentimentAdvocacyFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const valence = inferFixtureValence(text);
  const theme = inferTheme(normalized);
  if (theme === "senal insuficiente" && valence === "neutra") {
    return insufficientFixtureCoding(unit, {
      sentiment: "neutral",
      emotional_intensity: 0,
      theme,
      advocacy_class: "passive"
    });
  }

  return {
    external_ref: unit.external_ref,
    finding_key: `advocacy_${theme.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    dimensions: {
      sentiment: valence === "positiva" ? "positive" : valence === "negativa" ? "negative" : "neutral",
      emotional_intensity: valence === "neutra" ? 2 : 4,
      theme,
      advocacy_class: valence === "positiva" ? "promoter" : valence === "negativa" ? "detractor" : "passive"
    },
    intensity: valence === "neutra" ? 2 : 4,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildTrustRiskFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const riskTheme = inferRiskTheme(normalized);
  const trustDriver = inferTrustDriver(normalized);
  if (riskTheme === "sin riesgo claro" && trustDriver === "sin driver claro") {
    return insufficientFixtureCoding(unit, {
      trust_driver: trustDriver,
      risk_theme: riskTheme,
      severity: "low",
      escalating: "unclear"
    });
  }

  const severity = inferRiskSeverity(normalized);
  return {
    external_ref: unit.external_ref,
    finding_key: `trust_risk_${(riskTheme !== "sin riesgo claro" ? riskTheme : trustDriver).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    dimensions: {
      trust_driver: trustDriver,
      risk_theme: riskTheme,
      severity,
      escalating: hasAny(normalized, ["cada vez", "otra vez", "siempre", "muchos", "viral", "denuncia"]) ? "yes" : "unclear"
    },
    intensity: severity === "critical" ? 5 : severity === "high" ? 4 : severity === "medium" ? 3 : 2,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildValuePerceptionFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const valueBenefit = inferValueBenefit(normalized);
  const valueCost = inferValueCost(normalized);
  if (valueBenefit === "funcional" && valueCost === "cognitivo" && !hasAny(normalized, ["sirve", "funciona", "precio", "caro", "barato", "tiempo", "facil", "dificil", "estatus", "aspira"])) {
    return insufficientFixtureCoding(unit, {
      value_benefit: valueBenefit,
      value_cost: valueCost,
      perceived_value: "unclear"
    });
  }

  const valence = inferFixtureValence(text);
  return {
    external_ref: unit.external_ref,
    finding_key: `value_${valueBenefit}_${valueCost}`,
    dimensions: {
      value_benefit: valueBenefit,
      value_cost: valueCost,
      perceived_value: valence === "positiva" ? "high" : valence === "negativa" ? "low" : "medium"
    },
    intensity: valence === "neutra" ? 2 : 4,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildJourneyFrictionFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const journeyPhase = inferJourneyPhase(normalized);
  const frictionType = inferFrictionType(normalized);
  const polarity = inferFixtureValence(text) === "positiva" ? "accelerator" : "blocker";
  if (journeyPhase === "consider" && frictionType === "informational" && !hasAny(normalized, ["descubri", "compar", "elegi", "compr", "pago", "uso", "renov", "cancel", "duda", "confuso", "facil", "dificil"])) {
    return insufficientFixtureCoding(unit, {
      journey_phase: journeyPhase,
      friction_type: frictionType,
      visibility: "articulable",
      polarity
    });
  }

  return {
    external_ref: unit.external_ref,
    finding_key: `journey_${journeyPhase}_${frictionType}_${polarity}`,
    dimensions: {
      journey_phase: journeyPhase,
      friction_type: frictionType,
      visibility: hasAny(normalized, ["no se", "no entiendo", "confuso", "raro"]) ? "mixed" : "articulable",
      polarity
    },
    intensity: polarity === "blocker" ? 4 : 3,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildCategoryOpportunityFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const need = inferNeed(normalized);
  if (need === "senal insuficiente") {
    return insufficientFixtureCoding(unit, { need, demand_strength: 0, coverage: "served", urgency: "low" });
  }
  return {
    external_ref: unit.external_ref,
    finding_key: `category_need_${slugPart(need)}`,
    dimensions: {
      need,
      demand_strength: inferFixtureValence(text) === "negativa" ? 4 : 3,
      coverage: hasAny(normalized, ["nadie", "ninguna", "no encuentro", "no hay"]) ? "unserved" : "underserved",
      urgency: hasAny(normalized, ["urgente", "ya", "hoy", "siempre", "cada vez"]) ? "high" : "medium"
    },
    intensity: 3,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildWhiteSpaceFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const demand = inferNeed(normalized);
  if (demand === "senal insuficiente") {
    return insufficientFixtureCoding(unit, {
      demand,
      competitive_coverage: "unclear",
      brand_permission: "none",
      whitespace_score_hint: 0
    });
  }
  return {
    external_ref: unit.external_ref,
    finding_key: `whitespace_${slugPart(demand)}`,
    dimensions: {
      demand,
      competitive_coverage: hasAny(normalized, ["nadie", "no hay", "no encuentro"]) ? "low" : "medium",
      brand_permission: hasAny(normalized, ["confiable", "claro", "resuelve", "facil"]) ? "strong" : "moderate",
      whitespace_score_hint: hasAny(normalized, ["nadie", "no hay", "no encuentro"]) ? 4 : 2.5
    },
    intensity: 3,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildBrandPositioningFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const pole = inferAxisPole(normalized);
  if (pole === "unclear") {
    return insufficientFixtureCoding(unit, { attribute: "atributo insuficiente", axis_value: 0, axis_pole: pole });
  }
  return {
    external_ref: unit.external_ref,
    finding_key: `positioning_${pole}`,
    dimensions: {
      attribute: inferTheme(normalized),
      axis_value: axisValueForPole(pole),
      axis_pole: pole
    },
    intensity: 3,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildCulturalCodesFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const opposition = inferCulturalOpposition(normalized);
  if (opposition === "sin oposicion clara") {
    return insufficientFixtureCoding(unit, {
      code_level: "surface",
      binary_opposition: opposition,
      maturity: "nascent",
      valence: "ambivalent"
    });
  }
  const valence = inferFixtureValence(text);
  return {
    external_ref: unit.external_ref,
    finding_key: `cultural_${slugPart(opposition)}`,
    dimensions: {
      code_level: normalized.length > 220 ? "emerging" : "surface",
      binary_opposition: opposition,
      maturity: hasAny(normalized, ["siempre", "todos", "viral", "cada vez"]) ? "active" : "nascent",
      valence: valence === "positiva" ? "positive" : valence === "negativa" ? "negative" : "ambivalent"
    },
    intensity: 3,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildCompetitiveWaveFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const axis = inferWaveAxis(normalized);
  if (axis === "resonance" && inferTheme(normalized) === "senal insuficiente") {
    return insufficientFixtureCoding(unit, { axis, direction: "mixed" });
  }
  const valence = inferFixtureValence(text);
  return {
    external_ref: unit.external_ref,
    finding_key: `wave_${axis}`,
    dimensions: {
      axis,
      direction: valence === "positiva" ? "positive" : valence === "negativa" ? "negative" : "mixed"
    },
    intensity: valence === "neutra" ? 2 : 4,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildAudienceSegmentFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const segment = inferSegment(normalized);
  const valence = inferFixtureValence(text);
  return {
    external_ref: unit.external_ref,
    finding_key: `segment_${slugPart(segment)}_${slugPart(inferTheme(normalized))}`,
    dimensions: {
      segment,
      wrapped_methodology: "fixture",
      metric: inferTheme(normalized),
      polarity: valence === "positiva" ? "positive" : valence === "negativa" ? "negative" : "neutral"
    },
    intensity: valence === "neutra" ? 2 : 3,
    span: text.slice(0, 400),
    ambiguous: segment === "unsegmented"
  };
}

function buildInfluenceArchitectureFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const role = inferNodeRole(normalized);
  return {
    external_ref: unit.external_ref,
    finding_key: `influence_${role}_${slugPart(inferTheme(normalized))}`,
    dimensions: {
      node_role: role,
      community: inferCommunity(normalized),
      tie_type: inferTieType(normalized)
    },
    intensity: 3,
    span: text.slice(0, 400),
    ambiguous: false
  };
}

function buildDecisionVelocityFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const phase = inferDecisionPhase(normalized);
  const valence = inferFixtureValence(text);
  const polarity = valence === "positiva" ? "accelerator" : "blocker";
  return {
    external_ref: unit.external_ref,
    finding_key: `velocity_${phase}_${polarity}`,
    dimensions: {
      decision_phase: phase,
      cognitive_system: inferCognitiveSystem(normalized),
      factor: inferTheme(normalized),
      polarity
    },
    intensity: polarity === "accelerator" ? 3 : 4,
    span: text.slice(0, 400),
    ambiguous: phase === "researching" && inferTheme(normalized) === "senal insuficiente"
  };
}

function buildEvidenceConfidenceFixtureCoding(unit: EngineCodingPromptInput["units"][number]): EngineCodingLabel {
  const text = unit.text.trim();
  const normalized = normalizeFixtureText(text);
  const hasQuote = text.length >= 40;
  return {
    external_ref: unit.external_ref,
    finding_key: `confidence_${slugPart(inferTheme(normalized))}`,
    dimensions: {
      volume: 1,
      source_diversity: unit.platform ? 1 : 0,
      consistency: inferFixtureValence(text) === "neutra" ? 0.5 : 0.8,
      recency: unit.published_at ? 1 : 0.5,
      citation_quality: hasQuote ? 0.8 : 0.2
    },
    intensity: hasQuote ? 3 : 1,
    span: text.slice(0, 400),
    ambiguous: !hasQuote
  };
}

function inferFixtureValence(text: string): "positiva" | "negativa" | "neutra" {
  const normalized = normalizeFixtureText(text);
  const negative = /\b(caro|falla|fallo|malo|pesimo|lento|queja|problema|cancelar|no sirve|se cae|sin cobertura)\b/i;
  const positive = /\b(claro|confiable|bueno|excelente|rapido|simple|facil|me encanta|vale la pena|resuelve)\b/i;

  if (negative.test(normalized)) return "negativa";
  if (positive.test(normalized)) return "positiva";
  return "neutra";
}

function normalizeFixtureText(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function insufficientFixtureCoding(
  unit: EngineCodingPromptInput["units"][number],
  dimensions: Record<string, string | number | boolean>
): EngineCodingLabel {
  return {
    external_ref: unit.external_ref,
    finding_key: "insufficient_signal",
    dimensions,
    intensity: 0,
    span: unit.text.trim().slice(0, 400),
    ambiguous: true
  };
}

function hasAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function inferTheme(text: string) {
  if (hasAny(text, ["cobertura", "red", "senal", "5g"])) return "cobertura";
  if (hasAny(text, ["precio", "costo", "tarifa", "caro", "barato"])) return "precio";
  if (hasAny(text, ["atencion", "soporte", "servicio", "resuelve"])) return "servicio";
  if (hasAny(text, ["contrato", "plazo", "cancelar", "cambiarme"])) return "contrato";
  if (hasAny(text, ["app", "recarga", "datos", "paquete", "plan"])) return "control digital";
  return "senal insuficiente";
}

function inferNeed(text: string) {
  if (hasAny(text, ["cobertura", "red", "senal", "5g"])) return "cobertura confiable";
  if (hasAny(text, ["precio", "costo", "tarifa", "caro", "barato"])) return "precio claro";
  if (hasAny(text, ["app", "recarga", "datos", "paquete", "plan"])) return "control simple";
  if (hasAny(text, ["contrato", "cancelar", "cambiarme", "letras chiquitas"])) return "libertad y transparencia";
  if (hasAny(text, ["atencion", "soporte", "servicio", "resuelve"])) return "soporte resolutivo";
  return "senal insuficiente";
}

function inferRiskTheme(text: string) {
  if (hasAny(text, ["fraude", "estafa", "robo", "cobro indebido"])) return "fraude o cobro";
  if (hasAny(text, ["datos", "privacidad", "seguridad", "hack"])) return "datos y seguridad";
  if (hasAny(text, ["falla", "se cae", "sin cobertura", "no sirve"])) return "confiabilidad operativa";
  if (hasAny(text, ["contrato", "cancelar", "letras chiquitas"])) return "transparencia contractual";
  return "sin riesgo claro";
}

function inferTrustDriver(text: string) {
  if (hasAny(text, ["claro", "transparente", "sin trucos", "sin letras chiquitas"])) return "claridad";
  if (hasAny(text, ["confiable", "cobertura", "red", "funciona"])) return "confiabilidad";
  if (hasAny(text, ["resuelve", "atencion", "soporte"])) return "resolucion";
  if (hasAny(text, ["seguro", "protege", "privacidad"])) return "seguridad";
  return "sin driver claro";
}

function inferRiskSeverity(text: string): "low" | "medium" | "high" | "critical" {
  if (hasAny(text, ["fraude", "estafa", "robo", "hack"])) return "critical";
  if (hasAny(text, ["denuncia", "cobro indebido", "se cae", "no sirve"])) return "high";
  if (hasAny(text, ["falla", "cancelar", "problema", "queja"])) return "medium";
  return "low";
}

function inferValueBenefit(text: string): "funcional" | "emocional" | "social" | "aspiracional" | "economico" {
  if (hasAny(text, ["ahorro", "barato", "precio", "costo", "promocion"])) return "economico";
  if (hasAny(text, ["estatus", "presumir", "se ve", "social"])) return "social";
  if (hasAny(text, ["aspira", "premium", "mejor version"])) return "aspiracional";
  if (hasAny(text, ["tranquilo", "confianza", "me encanta", "miedo"])) return "emocional";
  return "funcional";
}

function inferValueCost(text: string): "monetario" | "tiempo" | "cognitivo" | "social" {
  if (hasAny(text, ["caro", "precio", "costo", "tarifa", "pagar"])) return "monetario";
  if (hasAny(text, ["tarde", "espera", "tiempo", "lento"])) return "tiempo";
  if (hasAny(text, ["pena", "ridiculo", "juzgan", "estatus"])) return "social";
  return "cognitivo";
}

function inferJourneyPhase(text: string): "discover" | "consider" | "choose" | "buy" | "use" | "renew" | "leave" {
  if (hasAny(text, ["descubri", "anuncio", "tiktok", "recomendacion"])) return "discover";
  if (hasAny(text, ["compar", "cotiz", "opcion", "alternativa"])) return "consider";
  if (hasAny(text, ["elegi", "decidi", "me fui por", "preferi"])) return "choose";
  if (hasAny(text, ["compr", "pague", "checkout", "tienda"])) return "buy";
  if (hasAny(text, ["uso", "app", "recarga", "datos", "servicio"])) return "use";
  if (hasAny(text, ["renov", "renovar", "mensualidad"])) return "renew";
  if (hasAny(text, ["cancel", "cambiarme", "me sali"])) return "leave";
  return "consider";
}

function inferFrictionType(text: string): "informational" | "economic" | "trust" | "effort" | "access" | "social" | "emotional" {
  if (hasAny(text, ["caro", "precio", "costo", "tarifa"])) return "economic";
  if (hasAny(text, ["confianza", "fraude", "estafa", "letras chiquitas"])) return "trust";
  if (hasAny(text, ["dificil", "complicado", "tarde", "lento", "espera"])) return "effort";
  if (hasAny(text, ["sin cobertura", "no disponible", "stock", "tienda"])) return "access";
  if (hasAny(text, ["pena", "juzgan", "presumir", "estatus"])) return "social";
  if (hasAny(text, ["miedo", "ansiedad", "enojo", "me encanta"])) return "emotional";
  return "informational";
}

function inferAxisPole(text: string): "premium" | "accessible" | "innovative" | "traditional" | "human" | "technical" | "unclear" {
  if (hasAny(text, ["premium", "aspira", "estatus"])) return "premium";
  if (hasAny(text, ["barato", "precio", "accesible", "promocion"])) return "accessible";
  if (hasAny(text, ["app", "digital", "5g", "innovador"])) return "innovative";
  if (hasAny(text, ["siempre", "tradicional", "de toda la vida"])) return "traditional";
  if (hasAny(text, ["atencion", "humano", "resuelve"])) return "human";
  if (hasAny(text, ["red", "cobertura", "datos", "tecnico"])) return "technical";
  return "unclear";
}

function axisValueForPole(pole: ReturnType<typeof inferAxisPole>) {
  if (pole === "premium" || pole === "innovative" || pole === "human") return 0.75;
  if (pole === "accessible" || pole === "traditional" || pole === "technical") return -0.75;
  return 0;
}

function inferCulturalOpposition(text: string) {
  if (hasAny(text, ["letras chiquitas", "sin trucos", "claro"])) return "claridad vs truco";
  if (hasAny(text, ["cobertura", "se cae", "confiable"])) return "seguridad vs interrupcion";
  if (hasAny(text, ["estatus", "barato", "premium"])) return "estatus vs ahorro";
  if (hasAny(text, ["libertad", "contrato", "amarr"])) return "libertad vs amarre";
  return "sin oposicion clara";
}

function inferWaveAxis(text: string): "resonance" | "cultural_ownership" | "sentiment" | "decision_velocity" | "differentiation" {
  if (hasAny(text, ["diferente", "unico", "nadie", "solo"])) return "differentiation";
  if (hasAny(text, ["decidi", "elegi", "comprar", "facil"])) return "decision_velocity";
  if (hasAny(text, ["me encanta", "odio", "bueno", "malo", "caro"])) return "sentiment";
  if (hasAny(text, ["siempre", "todos", "cultura", "estatus"])) return "cultural_ownership";
  return "resonance";
}

function inferSegment(text: string) {
  if (hasAny(text, ["android"])) return "android";
  if (hasAny(text, ["iphone", "ios"])) return "ios";
  if (hasAny(text, ["prepago"])) return "prepago";
  if (hasAny(text, ["pospago", "plan"])) return "pospago";
  if (hasAny(text, ["cliente nuevo", "primera vez"])) return "cliente nuevo";
  return "unsegmented";
}

function inferNodeRole(text: string): "originator" | "amplifier" | "translator" | "skeptic" | "authority" | "bridge" {
  if (hasAny(text, ["experto", "medio", "profeco", "autoridad"])) return "authority";
  if (hasAny(text, ["no creo", "dudo", "mentira", "skeptic"])) return "skeptic";
  if (hasAny(text, ["explica", "tutorial", "comparativa"])) return "translator";
  if (hasAny(text, ["rt", "comparti", "viral", "todos"])) return "amplifier";
  if (hasAny(text, ["entre", "versus", "vs"])) return "bridge";
  return "originator";
}

function inferCommunity(text: string) {
  if (hasAny(text, ["gaming", "stream", "twitch"])) return "gaming";
  if (hasAny(text, ["familia", "mama", "papas", "hijos"])) return "familia";
  if (hasAny(text, ["trabajo", "negocio", "emprendedor"])) return "trabajo";
  if (hasAny(text, ["viaje", "carretera", "foraneo"])) return "movilidad";
  return "general";
}

function inferTieType(text: string): "endorsement" | "critique" | "translation" | "comparison" | "question" {
  if (text.includes("?") || hasAny(text, ["alguien sabe", "que conviene"])) return "question";
  if (hasAny(text, ["vs", "versus", "compar"])) return "comparison";
  if (hasAny(text, ["explica", "tutorial", "significa"])) return "translation";
  if (inferFixtureValence(text) === "negativa") return "critique";
  return "endorsement";
}

function inferDecisionPhase(text: string): "triggered" | "researching" | "comparing" | "deciding" | "postponing" | "abandoning" {
  if (hasAny(text, ["necesito", "me urge", "busco"])) return "triggered";
  if (hasAny(text, ["investig", "duda", "info", "no entiendo"])) return "researching";
  if (hasAny(text, ["compar", "vs", "opcion"])) return "comparing";
  if (hasAny(text, ["decidi", "elegi", "comprar", "preferi"])) return "deciding";
  if (hasAny(text, ["luego", "despues", "esperar"])) return "postponing";
  if (hasAny(text, ["cancel", "me sali", "abandone"])) return "abandoning";
  return "researching";
}

function inferCognitiveSystem(text: string): "system_1" | "system_2" | "social_proof" | "habit" {
  if (hasAny(text, ["todos", "recomendaron", "viral", "influencer"])) return "social_proof";
  if (hasAny(text, ["siempre", "costumbre", "de toda la vida"])) return "habit";
  if (hasAny(text, ["compar", "precio", "costo", "contrato", "cotiz"])) return "system_2";
  return "system_1";
}

function slugPart(value: string) {
  return normalizeFixtureText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "signal";
}

function normalizeCodingLabel(value: unknown): EngineCodingLabel {
  const record = asRecord(value);
  const externalRef = stringValue(record.external_ref);
  const findingKey = stringValue(record.finding_key);
  if (!externalRef || !findingKey) {
    throw new Error("Engine coding item requires external_ref and finding_key.");
  }

  const dimensions = asPrimitiveRecord(record.dimensions);
  // Clamp the model-provided intensity into the valid [0,5] band instead of
  // throwing; an out-of-range value from one item should not fail the batch.
  const intensity = Math.max(0, Math.min(5, numberValue(record.intensity)));
  const span = stringValue(record.span).slice(0, 400);
  const ambiguous = record.ambiguous === true || findingKey === "insufficient_signal";
  const signalLabel = typeof dimensions.signal_label === "string" ? dimensions.signal_label : "";
  const publishableHasSignalLabel = ambiguous || isUsableSignalLabel(signalLabel, findingKey);

  return {
    external_ref: externalRef,
    finding_key: publishableHasSignalLabel ? findingKey : "insufficient_signal",
    dimensions,
    intensity: publishableHasSignalLabel ? intensity : 0,
    span,
    ambiguous: ambiguous || !publishableHasSignalLabel
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asPrimitiveRecord(value: unknown): Record<string, string | number | boolean> {
  const record = asRecord(value);
  const output: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      output[key] = item;
    }
  }
  return output;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isUsableSignalLabel(signalLabel: string, findingKey: string) {
  const normalized = normalizeFixtureText(signalLabel).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < 8) return false;
  if (normalized === normalizeFixtureText(findingKey).replace(/[_-]+/g, " ").trim()) return false;
  if (isCorporateTaxonomyLabel(normalized)) return false;
  const genericLabels = new Set([
    "funcional",
    "emocional",
    "social",
    "economico",
    "monetario",
    "cognitivo",
    "positivo",
    "negativo",
    "neutral",
    "soporte",
    "precio",
    "servicio",
    "confianza",
    "riesgo",
    "barrier",
    "trigger",
    "value",
    "friction"
  ]);
  return !genericLabels.has(normalized);
}

function isCorporateTaxonomyLabel(normalized: string) {
  const corporateEnglishPatterns = [
    /\bbrand activation\b/,
    /\bpositive experience\b/,
    /\bsocial amplification\b/,
    /\bdiscovery event\b/,
    /\bcasting campaign\b/,
    /\bcommunity engagement\b/,
    /\bidentity activation\b/,
    /\bflavor discovery\b/,
    /\bconsumer engagement\b/
  ];
  return corporateEnglishPatterns.some((pattern) => pattern.test(normalized));
}
