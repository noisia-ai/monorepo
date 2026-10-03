export type SignalModuleKey =
  | "overview"
  | "live_composer"
  | "engine_methodology"
  | "competitive_wave"
  | "narrative_ownership"
  | "value_perception"
  | "brand_positioning"
  | "category_opportunity"
  | "white_space"
  | "journey_friction"
  | "decision_velocity"
  | "cultural_codes"
  | "advocacy_proxy"
  | "audience_segment"
  | "influence_architecture"
  | "trust_risk"
  | "evidence_confidence"
  | "tb_decision_field"
  | "opportunities"
  | "competitive_intelligence"
  | "tb_comparative_dashboard"
  | "competitive_tb_matrix"
  | "action_studio"
  | "evidence"
  | "quality_boundaries"
  | "emerging_patterns"
  | "corpus_view"
  | "corpus_chat";

export const defaultSignalManifest: Record<SignalModuleKey, boolean> = {
  overview: true,
  live_composer: true,
  engine_methodology: false,
  competitive_wave: false,
  narrative_ownership: false,
  value_perception: false,
  brand_positioning: false,
  category_opportunity: false,
  white_space: false,
  journey_friction: false,
  decision_velocity: false,
  cultural_codes: false,
  advocacy_proxy: false,
  audience_segment: false,
  influence_architecture: false,
  trust_risk: false,
  evidence_confidence: false,
  tb_decision_field: true,
  opportunities: true,
  competitive_intelligence: true,
  tb_comparative_dashboard: true,
  competitive_tb_matrix: true,
  action_studio: true,
  evidence: true,
  quality_boundaries: true,
  emerging_patterns: true,
  corpus_view: true,
  corpus_chat: true
};

export const signalModuleMeta: Array<{
  key: SignalModuleKey;
  label: string;
  description: string;
  status: "ready" | "partial" | "hold";
}> = [
  {
    key: "overview",
    label: "Overview & confianza",
    description: "Contexto del corte, tamaño de corpus, periodo, confianza y lectura ejecutiva.",
    status: "ready"
  },
  {
    key: "live_composer",
    label: "Live Composer",
    description: "Capa multimétodo: deduplica señales vivas, oportunidades y riesgos entre lentes.",
    status: "partial"
  },
  {
    key: "engine_methodology",
    label: "Engine Methodology",
    description: "Output beta de una metodología engine, con charts, findings y limitaciones del lente.",
    status: "partial"
  },
  {
    key: "competitive_wave",
    label: "Competitive Wave",
    description: "Mapa competitivo por ejes, rankings y lectura de posicionamiento entre entidades.",
    status: "partial"
  },
  {
    key: "narrative_ownership",
    label: "Narrative Ownership",
    description: "Qué entidad posee cada narrativa, si es activo, riesgo o espacio disputable.",
    status: "partial"
  },
  {
    key: "value_perception",
    label: "Value Perception",
    description: "Matriz de beneficio, costo percibido, valor defendible y whitespace candidato.",
    status: "partial"
  },
  {
    key: "brand_positioning",
    label: "Brand Positioning",
    description: "Ejes perceptuales y territorios de posicionamiento detectados desde corpus vivo.",
    status: "partial"
  },
  {
    key: "category_opportunity",
    label: "Category Opportunity",
    description: "Demanda, urgencia, cobertura y oportunidades por categoría, entidad o necesidad.",
    status: "partial"
  },
  {
    key: "white_space",
    label: "White Space",
    description: "Espacios capturables, huecos competitivos y límites de evidencia para priorizar apuestas.",
    status: "partial"
  },
  {
    key: "journey_friction",
    label: "Journey Friction",
    description: "Fricciones y aceleradores por fase del journey, con quick wins direccionales.",
    status: "partial"
  },
  {
    key: "decision_velocity",
    label: "Decision Velocity",
    description: "Blockers y accelerators que frenan o aceleran el avance en la decisión.",
    status: "partial"
  },
  {
    key: "cultural_codes",
    label: "Cultural Codes",
    description: "Códigos, símbolos y tensiones culturales por categoría, marca o comunidad.",
    status: "partial"
  },
  {
    key: "advocacy_proxy",
    label: "Advocacy Proxy",
    description: "Promotores, pasivos y detractores desde corpus vivo; no es NPS encuestado.",
    status: "partial"
  },
  {
    key: "audience_segment",
    label: "Audience Segment",
    description: "Señales comparadas por segmento cuando el corpus trae metadata o pistas de audiencia.",
    status: "partial"
  },
  {
    key: "influence_architecture",
    label: "Influence Architecture",
    description: "Nodos, comunidades y arquitectura de influencia cuando hay author/handle metadata suficiente.",
    status: "partial"
  },
  {
    key: "trust_risk",
    label: "Trust & Risk",
    description: "Drivers de confianza, riesgos reputacionales y vulnerabilidades por entidad.",
    status: "partial"
  },
  {
    key: "evidence_confidence",
    label: "Evidence Confidence",
    description: "Trazabilidad, diversidad de evidencia y límites de confianza sobre hallazgos vivos.",
    status: "partial"
  },
  {
    key: "tb_decision_field",
    label: "T&B Decision Field",
    description: "Vista propietaria central: fuerzas que motivan, frenan y qué tan movibles son.",
    status: "ready"
  },
  {
    key: "opportunities",
    label: "Opportunities",
    description: "Tensiones, whitespace y prioridades sin repetir el mismo finding.",
    status: "ready"
  },
  {
    key: "competitive_intelligence",
    label: "Competitive Intelligence",
    description: "Qué es de la marca, qué posee la competencia y qué es de categoría.",
    status: "ready"
  },
  {
    key: "tb_comparative_dashboard",
    label: "T&B Comparative",
    description: "Dashboard comparativo barato: heatmap, ownership y split trigger/barrier por entidad.",
    status: "ready"
  },
  {
    key: "competitive_tb_matrix",
    label: "Competitive T&B Matrix",
    description: "Matriz #11 de triggers/barriers por entidad usando el análisis T&B existente.",
    status: "ready"
  },
  {
    key: "action_studio",
    label: "Action Studio",
    description: "Acciones por equipo: estrategia, contenido, producto/CX, media y medición.",
    status: "ready"
  },
  {
    key: "evidence",
    label: "Evidence",
    description: "Citas y finding detail conectados a cada recomendación.",
    status: "ready"
  },
  {
    key: "quality_boundaries",
    label: "Quality / Boundaries",
    description: "Límites de lo que podemos afirmar, gates y advertencias client-safe.",
    status: "ready"
  },
  {
    key: "emerging_patterns",
    label: "Emerging Patterns",
    description: "Insights abiertos que nacen del corpus sin forzarlos al método T&B.",
    status: "ready"
  },
  {
    key: "corpus_view",
    label: "Corpus View",
    description: "Vista client-safe del corpus publicado: búsqueda, fuente, fecha y finding.",
    status: "ready"
  },
  {
    key: "corpus_chat",
    label: "Corpus Chat",
    description: "Agente restringido al reporte publicado, Knowledge Base y evidencia del snapshot.",
    status: "partial"
  }
];

export type SignalDemoModeConfig = {
  enabled: boolean;
  blurredSections: SignalModuleKey[];
};

export type SignalDemoModeManifest = {
  enabled: boolean;
  blurred_sections: SignalModuleKey[];
};

export type SignalOutputManifest = Record<SignalModuleKey, boolean> & {
  demo_mode: SignalDemoModeManifest;
};

export const defaultSignalDemoBlurredSections: SignalModuleKey[] = [
  "live_composer",
  "engine_methodology",
  "competitive_wave",
  "narrative_ownership",
  "value_perception",
  "brand_positioning",
  "category_opportunity",
  "white_space",
  "journey_friction",
  "decision_velocity",
  "cultural_codes",
  "advocacy_proxy",
  "audience_segment",
  "influence_architecture",
  "trust_risk",
  "evidence_confidence",
  "tb_decision_field",
  "opportunities",
  "competitive_intelligence",
  "tb_comparative_dashboard",
  "competitive_tb_matrix",
  "action_studio",
  "evidence",
  "emerging_patterns",
  "corpus_view",
  "corpus_chat"
];

const signalModuleKeySet = new Set<SignalModuleKey>(signalModuleMeta.map((module) => module.key));

export function isSignalModuleKey(value: unknown): value is SignalModuleKey {
  return typeof value === "string" && signalModuleKeySet.has(value as SignalModuleKey);
}

export function normalizeSignalModuleFlags(input?: unknown): Record<SignalModuleKey, boolean> {
  const value = asRecord(input);
  const flags = { ...defaultSignalManifest };
  for (const meta of signalModuleMeta) {
    const flag = value[meta.key];
    if (typeof flag === "boolean") {
      flags[meta.key] = flag;
    }
  }
  return flags;
}

export function normalizeSignalDemoMode(input?: unknown): SignalDemoModeConfig {
  const value = asRecord(input);
  const rawBlurredSections = Array.isArray(value.blurred_sections)
    ? value.blurred_sections
    : Array.isArray(value.blurredSections)
      ? value.blurredSections
      : [];

  return {
    enabled: value.enabled === true,
    blurredSections: rawBlurredSections.filter(isSignalModuleKey)
  };
}

export function serializeSignalDemoMode(config: SignalDemoModeConfig): SignalDemoModeManifest {
  return {
    enabled: config.enabled,
    blurred_sections: uniqueSignalModuleKeys(config.blurredSections)
  };
}

export function normalizeSignalOutputManifest(input?: unknown): SignalOutputManifest {
  const value = asRecord(input);
  return {
    ...normalizeSignalModuleFlags(value),
    demo_mode: serializeSignalDemoMode(normalizeSignalDemoMode(value.demo_mode))
  };
}

export function uniqueSignalModuleKeys(values: SignalModuleKey[]): SignalModuleKey[] {
  const seen = new Set<SignalModuleKey>();
  return values.filter((value) => {
    if (!signalModuleKeySet.has(value) || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
