import { lensQueryPackRequirements } from "@noisia/query-engine/src/lens-coverage";

export type StudyAnalysisPlan = {
  version: 1;
  report_kind: "signal" | "signal_pulse";
  primary_methodology_slug: string;
  selected_lenses: string[];
  lens_configs: Record<string, Record<string, unknown>>;
  composer_modules: string[];
  marketing_brief?: Record<string, unknown>;
  budget_cap_usd?: number;
};

export type StudyLensOption = {
  slug: string;
  label: string;
  shortLabel: string;
  description: string;
  status: "required" | "recommended" | "beta";
  category: "foundation" | "narrative" | "value" | "journey" | "risk";
  defaultSelected: boolean;
  locked?: boolean;
  composerModules: string[];
};

const PRIMARY_METHODOLOGY_SLUG = "triggers-barriers";
const SIGNAL_PULSE_SLUG = "signal-pulse";

export const STUDY_LENS_OPTIONS: StudyLensOption[] = [
  {
    slug: PRIMARY_METHODOLOGY_SLUG,
    label: "Triggers & Barriers",
    shortLabel: "T&B",
    description: "Lente base: encuentra fuerzas que motivan, frenan y explican la decision.",
    status: "required",
    category: "foundation",
    defaultSelected: true,
    locked: true,
    composerModules: ["overview", "tb_decision_field", "opportunities", "evidence", "quality_boundaries"]
  },
  {
    slug: "competitive-wave",
    label: "Competitive Wave",
    shortLabel: "Wave",
    description: "Mapa competitivo direccional por ejes, sólo publicable cuando los ejes tienen evidencia suficiente.",
    status: "beta",
    category: "narrative",
    defaultSelected: false,
    composerModules: ["live_composer", "competitive_wave", "competitive_intelligence"]
  },
  {
    slug: "narrative-ownership",
    label: "Narrative Ownership",
    shortLabel: "Narrative",
    description: "Mide que marcas o entidades poseen la narrativa de confianza, valor o categoria.",
    status: "beta",
    category: "narrative",
    defaultSelected: false,
    composerModules: ["live_composer", "narrative_ownership", "competitive_intelligence"]
  },
  {
    slug: "value-perception-matrix",
    label: "Value Perception Matrix",
    shortLabel: "VPM",
    description: "Lee valor funcional, emocional y costos percibidos sin convertirlo aun en dashboard final.",
    status: "beta",
    category: "value",
    defaultSelected: false,
    composerModules: ["live_composer", "value_perception", "opportunities"]
  },
  {
    slug: "brand-positioning-map",
    label: "Brand Positioning Map",
    shortLabel: "Positioning",
    description: "Ubica marcas en ejes perceptuales inferidos del corpus y evidencia competitiva.",
    status: "beta",
    category: "narrative",
    defaultSelected: false,
    composerModules: ["live_composer", "brand_positioning", "competitive_intelligence"]
  },
  {
    slug: "category-opportunity-map",
    label: "Category Opportunity Map",
    shortLabel: "Category Opp",
    description: "Agrupa demanda, cobertura y urgencia para detectar oportunidades por categoria y entidad.",
    status: "beta",
    category: "value",
    defaultSelected: false,
    composerModules: ["live_composer", "category_opportunity", "opportunities"]
  },
  {
    slug: "white-space-analysis",
    label: "White Space Analysis",
    shortLabel: "White Space",
    description: "Busca espacios capturables o aspiracionales sin convertir ausencia de evidencia en afirmacion fuerte.",
    status: "beta",
    category: "value",
    defaultSelected: false,
    composerModules: ["live_composer", "white_space", "opportunities"]
  },
  {
    slug: "journey-friction-mapping",
    label: "Journey Friction Mapping",
    shortLabel: "JFM",
    description: "Agrupa fricciones por fase del journey cuando el corpus trae evidencia suficiente.",
    status: "beta",
    category: "journey",
    defaultSelected: false,
    composerModules: ["live_composer", "journey_friction", "action_studio"]
  },
  {
    slug: "decision-velocity",
    label: "Decision Velocity",
    shortLabel: "Velocity",
    description: "Lee blockers y accelerators del journey para estimar donde se acelera o se frena la decision.",
    status: "beta",
    category: "journey",
    defaultSelected: false,
    composerModules: ["live_composer", "decision_velocity", "action_studio"]
  },
  {
    slug: "cultural-codes-decoding",
    label: "Cultural Codes",
    shortLabel: "Codes",
    description: "Extrae codigos, tensiones y simbolos culturales cuando el corpus trae texto suficientemente rico.",
    status: "beta",
    category: "narrative",
    defaultSelected: false,
    composerModules: ["live_composer", "cultural_codes", "emerging_patterns"]
  },
  {
    slug: "sentiment-advocacy-proxy",
    label: "Sentiment / Advocacy Proxy",
    shortLabel: "Advocacy",
    description: "Usa sentimiento, recomendacion y defensa espontanea como proxy direccional.",
    status: "beta",
    category: "risk",
    defaultSelected: false,
    composerModules: ["live_composer", "advocacy_proxy", "quality_boundaries"]
  },
  {
    slug: "audience-segment-lens",
    label: "Audience Segment Lens",
    shortLabel: "Audience",
    description: "Compara senales por segmento cuando el corpus incluye metadata o pistas de audiencia.",
    status: "beta",
    category: "risk",
    defaultSelected: false,
    composerModules: ["live_composer", "audience_segment", "quality_boundaries"]
  },
  {
    slug: "influence-architecture",
    label: "Influence Architecture",
    shortLabel: "Influence",
    description: "Mapea nodos, comunidades e influencia cuando el corpus trae author/handle metadata suficiente.",
    status: "beta",
    category: "risk",
    defaultSelected: false,
    composerModules: ["live_composer", "influence_architecture", "competitive_intelligence"]
  },
  {
    slug: "trust-risk-benchmark",
    label: "Trust & Risk Benchmark",
    shortLabel: "Trust & Risk",
    description: "Compara senales de confianza, riesgo y reputacion por entidad o categoria.",
    status: "beta",
    category: "risk",
    defaultSelected: false,
    composerModules: ["live_composer", "trust_risk", "competitive_intelligence"]
  },
  {
    slug: "evidence-confidence-layer",
    label: "Evidence Confidence Layer",
    shortLabel: "Confidence",
    description: "Evalua trazabilidad, diversidad y limites de confianza sobre hallazgos existentes.",
    status: "beta",
    category: "risk",
    defaultSelected: false,
    composerModules: ["live_composer", "evidence_confidence", "evidence", "quality_boundaries"]
  }
];

const knownLensSlugs = new Set(STUDY_LENS_OPTIONS.map((option) => option.slug));

export function defaultStudyLensSlugs(primarySlug = PRIMARY_METHODOLOGY_SLUG) {
  const primary = normalizePrimarySlug(primarySlug);
  if (primary === SIGNAL_PULSE_SLUG) return [SIGNAL_PULSE_SLUG];
  return Array.from(new Set([
    primary,
    ...STUDY_LENS_OPTIONS
      .filter((option) => option.defaultSelected)
      .map((option) => option.slug)
  ])).filter((slug) => knownLensSlugs.has(slug));
}

export function buildStudyAnalysisPlan(
  selectedLenses: string[] | undefined,
  primarySlug = PRIMARY_METHODOLOGY_SLUG
): StudyAnalysisPlan {
  const primary = normalizePrimarySlug(primarySlug);
  const lenses = normalizeLensSlugs(selectedLenses, primary);
  return {
    version: 1,
    report_kind: primary === SIGNAL_PULSE_SLUG ? "signal_pulse" : "signal",
    primary_methodology_slug: primary,
    selected_lenses: lenses,
    lens_configs: Object.fromEntries(lenses.map((slug) => [slug, defaultLensConfig(slug)])),
    composer_modules: composerModulesForLenses(lenses)
  };
}

export function normalizeStudyAnalysisPlan(input: unknown, primarySlug = PRIMARY_METHODOLOGY_SLUG): StudyAnalysisPlan {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const selectedLenses = Array.isArray(value.selected_lenses)
    ? value.selected_lenses.map((item) => String(item))
    : undefined;
  const plan = buildStudyAnalysisPlan(selectedLenses, String(value.primary_methodology_slug || primarySlug));
  const marketingBrief = value.marketing_brief && typeof value.marketing_brief === "object" && !Array.isArray(value.marketing_brief)
    ? value.marketing_brief as Record<string, unknown>
    : undefined;
  const budgetCapUsd = Number(value.budget_cap_usd);
  return {
    ...plan,
    ...(marketingBrief ? { marketing_brief: marketingBrief } : {}),
    ...(Number.isFinite(budgetCapUsd) && budgetCapUsd > 0 ? { budget_cap_usd: budgetCapUsd } : {})
  };
}

export function labelForLens(slug: string) {
  return STUDY_LENS_OPTIONS.find((option) => option.slug === slug)?.label ?? prettifySlug(slug);
}

export function composerModulesForLenses(lenses: string[]) {
  if (lenses.includes(SIGNAL_PULSE_SLUG)) {
    return ["overview", "signals", "marketing_moves", "evidence", "corpus_view", "composer", "quality_settings"];
  }
  return Array.from(new Set(
    lenses.flatMap((slug) => STUDY_LENS_OPTIONS.find((option) => option.slug === slug)?.composerModules ?? [])
  ));
}

export function queryPackRequirementForLens(slug: string) {
  return lensQueryPackRequirements[slug] ?? null;
}

function normalizeLensSlugs(selectedLenses: string[] | undefined, primarySlug: string) {
  if (primarySlug === SIGNAL_PULSE_SLUG) return [SIGNAL_PULSE_SLUG];
  const incoming = selectedLenses?.length ? selectedLenses : defaultStudyLensSlugs(primarySlug);
  return Array.from(new Set([primarySlug, ...incoming.map((slug) => slug.trim()).filter(Boolean)]))
    .filter((slug) => knownLensSlugs.has(slug))
    .slice(0, 40);
}

function normalizePrimarySlug(primarySlug: string) {
  if (primarySlug === SIGNAL_PULSE_SLUG) return SIGNAL_PULSE_SLUG;
  return knownLensSlugs.has(primarySlug) ? primarySlug : PRIMARY_METHODOLOGY_SLUG;
}

function defaultLensConfig(slug: string) {
  if (slug === SIGNAL_PULSE_SLUG) {
    return {
      role: "primary",
      runtime: "signal_pulse_pipeline",
      query_pack_required: true,
      query_pack: {
        required_scopes: ["brand", "competitors", "category"],
        validation_level: "signal_pulse_cut_1"
      },
      signal_module_keys: ["overview", "signals", "marketing_moves", "evidence", "corpus_view", "composer", "quality_settings"]
    };
  }
  if (slug === PRIMARY_METHODOLOGY_SLUG) {
    return {
      role: "primary",
      query_pack_required: true,
      runtime: "tb_pipeline",
      query_pack: lensQueryPackRequirements[slug],
      signal_module_keys: STUDY_LENS_OPTIONS.find((option) => option.slug === slug)?.composerModules ?? []
    };
  }
  return {
    role: "lens",
    runtime: "engine_lens",
    query_pack_required: true,
    query_pack: lensQueryPackRequirements[slug] ?? { validation_level: "missing_spec" },
    signal_module_keys: STUDY_LENS_OPTIONS.find((option) => option.slug === slug)?.composerModules ?? []
  };
}

function prettifySlug(slug: string) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
