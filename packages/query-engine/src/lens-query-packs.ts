import type { ComposedQuery, QueryComposerInput } from "./index";
import {
  summarizePortableListenQueryErrors,
  validatePortableListenQuery
} from "./listen-query-language";

export type QueryPackScope = "brand" | "competitors" | "category" | "baseline";

export type LensQueryPackTemplate = {
  lensSlug: string;
  lensLabel: string;
  signalIntent: string;
  signalLabel: string;
  scope: QueryPackScope;
  objective: string;
  phraseHints: string[];
  sourceHints: string[];
  required: boolean;
};

export type MaterializedLensQueryPack = {
  lensSlug: string;
  lensLabel: string;
  signalIntent: string;
  signalLabel: string;
  scope: QueryPackScope;
  /** Stable identity within a scope. Competitors always materialize one pack per entity. */
  entityKey: string | null;
  entityLabel: string | null;
  objective: string;
  queryText: string;
  queryComponents: Record<string, unknown>;
  seeds: Record<string, unknown>;
  evaluation: Record<string, unknown>;
  status: "planned";
  costBudget: Record<string, unknown>;
};

export type StudyAnalysisPlanLike = {
  version?: number;
  primary_methodology_slug?: string;
  selected_lenses?: unknown;
  lens_configs?: unknown;
  composer_modules?: unknown;
};

const PRIMARY_LENS = "triggers-barriers";

export const LENS_QUERY_PACK_TEMPLATES: LensQueryPackTemplate[] = [
  {
    lensSlug: PRIMARY_LENS,
    lensLabel: "Triggers & Barriers",
    signalIntent: "decision_signal",
    signalLabel: "Marca: triggers, barriers y experiencia",
    scope: "brand",
    objective: "Capturar menciones de la marca con fuerzas que motivan, frenan o explican la decisión.",
    phraseHints: [
      "lo compré porque",
      "me convenció",
      "no me conviene",
      "me frena",
      "me molesta",
      "vale la pena",
      "no vale la pena"
    ],
    sourceHints: ["brand listening export", "reviews", "Zendesk", "social comments"],
    required: true
  },
  {
    lensSlug: PRIMARY_LENS,
    lensLabel: "Triggers & Barriers",
    signalIntent: "competitive_signal",
    signalLabel: "Competidores: triggers y barriers comparables",
    scope: "competitors",
    objective: "Capturar menciones del peer set para comparar qué frena o mueve a usuarios frente a competidores.",
    phraseHints: [
      "me cambié a",
      "prefiero",
      "comparé con",
      "es mejor que",
      "es peor que",
      "me quedo con"
    ],
    sourceHints: ["competitor listening export", "reviews comparativas", "social comments"],
    required: true
  },
  {
    lensSlug: PRIMARY_LENS,
    lensLabel: "Triggers & Barriers",
    signalIntent: "category_signal",
    signalLabel: "Categoría: baseline de decisión",
    scope: "category",
    objective: "Capturar conversación de categoría sin amarrarla a marca para medir baseline cultural.",
    phraseHints: [
      "quiero contratar",
      "no entiendo",
      "sale caro",
      "me preocupa",
      "recomiendan",
      "qué conviene"
    ],
    sourceHints: ["category listening export", "forums", "search/social questions"],
    required: true
  },
  ...templatesForThreeScopes({
    lensSlug: "signal-pulse",
    lensLabel: "Signal Pulse",
    signalIntent: "marketing_signal",
    signalLabel: "Senales tacticas de marketing",
    objective: "Capturar conversacion accionable para claims, contenido, pauta, creators, tendencias, riesgos y movimientos de narrativa.",
    phraseHints: [
      "esta de moda",
      "lo vi en",
      "vi un video",
      "trend",
      "viral",
      "creator",
      "influencer",
      "comparado con",
      "mejor que",
      "peor que",
      "deberian hacer",
      "nuevo sabor",
      "campana",
      "anuncio",
      "promocion",
      "lo recomiendo"
    ],
    sourceHints: ["social listening export", "TikTok comments", "Apify social export", "reviews", "creator/community posts"]
  }),
  ...templatesForThreeScopes({
    lensSlug: "narrative-ownership",
    lensLabel: "Narrative Ownership",
    signalIntent: "narrative_signal",
    signalLabel: "Narrativas y ownership",
    objective: "Encontrar narrativas que las entidades poseen, disputan o dejan huérfanas.",
    phraseHints: [
      "confío en",
      "no confío",
      "letra chica",
      "sin trucos",
      "me resuelve",
      "siempre falla",
      "me da confianza",
      "me decepcionó"
    ],
    sourceHints: ["social listening export", "reviews", "community posts", "customer voice CSV"]
  }),
  ...templatesForThreeScopes({
    lensSlug: "value-perception-matrix",
    lensLabel: "Value Perception Matrix",
    signalIntent: "value_perception",
    signalLabel: "Valor percibido y costos",
    objective: "Capturar beneficios percibidos y costos funcionales, emocionales, sociales o cognitivos.",
    phraseHints: [
      "vale lo que cuesta",
      "muy caro",
      "barato pero",
      "me da más por mi dinero",
      "no rinde",
      "me ahorra tiempo",
      "me complica",
      "me conviene"
    ],
    sourceHints: ["social listening export", "reviews", "pricing feedback", "commerce/review CSV"]
  }),
  ...templatesForThreeScopes({
    lensSlug: "brand-positioning-map",
    lensLabel: "Brand Positioning Map",
    signalIntent: "positioning_signal",
    signalLabel: "Posicionamiento perceptual",
    objective: "Capturar asociaciones perceptuales que ubican entidades en ejes de posicionamiento.",
    phraseHints: [
      "se siente",
      "lo percibo como",
      "es para",
      "parece",
      "más premium",
      "más confiable",
      "más barato",
      "más moderno"
    ],
    sourceHints: ["social listening export", "reviews", "brand perception CSV", "social comments"]
  }),
  ...templatesForThreeScopes({
    lensSlug: "category-opportunity-map",
    lensLabel: "Category Opportunity Map",
    signalIntent: "category_opportunity",
    signalLabel: "Oportunidades de categoría",
    objective: "Capturar necesidades, gaps, urgencia y demanda expresada que puedan convertirse en oportunidad.",
    phraseHints: [
      "necesito",
      "ojalá",
      "nadie ofrece",
      "me gustaría",
      "falta que",
      "no encuentro",
      "sería bueno",
      "deberían"
    ],
    sourceHints: ["category listening export", "forums", "reviews", "search/social questions"]
  }),
  ...templatesForThreeScopes({
    lensSlug: "white-space-analysis",
    lensLabel: "White Space Analysis",
    signalIntent: "white_space",
    signalLabel: "Espacios no capturados",
    objective: "Capturar necesidades poco atendidas y evidencia de espacios disputables o aspiracionales.",
    phraseHints: [
      "nadie resuelve",
      "no hay opción",
      "me falta",
      "quisiera",
      "no encuentro",
      "todas son iguales",
      "si existiera",
      "me encantaría"
    ],
    sourceHints: ["social listening export", "reviews", "category CSV", "community posts"]
  }),
  {
    lensSlug: "journey-friction-mapping",
    lensLabel: "Journey Friction Mapping",
    signalIntent: "journey_friction",
    signalLabel: "Marca: fricciones del journey",
    scope: "brand",
    objective: "Detectar fricciones por fase del journey cuando la marca o experiencia está presente.",
    phraseHints: [
      "quise comprar",
      "no pude",
      "se cayó",
      "no me dejó",
      "cancelé",
      "no contestan",
      "me tardaron",
      "me cobraron"
    ],
    sourceHints: ["brand listening export", "Zendesk", "reviews", "app store"],
    required: true
  },
  {
    lensSlug: "journey-friction-mapping",
    lensLabel: "Journey Friction Mapping",
    signalIntent: "journey_friction",
    signalLabel: "Categoría: fricciones del journey",
    scope: "category",
    objective: "Detectar fricciones recurrentes de categoría aunque no nombren a la marca.",
    phraseHints: [
      "contratar",
      "cancelar",
      "renovar",
      "soporte",
      "servicio al cliente",
      "app falla",
      "cobro",
      "garantía"
    ],
    sourceHints: ["category listening export", "Zendesk", "reviews", "app store"],
    required: true
  },
  ...templatesForScopes({
    lensSlug: "decision-velocity",
    lensLabel: "Decision Velocity",
    signalIntent: "decision_velocity",
    signalLabel: "Blockers y accelerators del journey",
    scopes: ["brand", "category"],
    objective: "Capturar señales que aceleran o frenan la decisión a lo largo del journey.",
    phraseHints: [
      "decidí rápido",
      "me tardé",
      "no pude decidir",
      "me convenció",
      "me detuvo",
      "me hizo dudar",
      "me resolvió",
      "me bloqueó"
    ],
    sourceHints: ["social listening export", "Zendesk", "reviews", "journey/support CSV"]
  }),
  ...templatesForScopes({
    lensSlug: "cultural-codes-decoding",
    lensLabel: "Cultural Codes",
    signalIntent: "cultural_code",
    signalLabel: "Códigos, símbolos y tensiones culturales",
    scopes: ["brand", "category"],
    objective: "Capturar lenguaje, símbolos, rituales y tensiones culturales que dan significado a la categoría.",
    phraseHints: [
      "se volvió",
      "es de",
      "representa",
      "me identifica",
      "me da pena",
      "lo presumo",
      "ritual",
      "trend"
    ],
    sourceHints: ["TikTok/social comments", "forums", "long-form reviews", "community posts"]
  }),
  ...templatesForScopes({
    lensSlug: "sentiment-advocacy-proxy",
    lensLabel: "Sentiment / Advocacy Proxy",
    signalIntent: "advocacy_signal",
    signalLabel: "Advocacy y defensa espontánea",
    scopes: ["brand", "competitors"],
    objective: "Capturar recomendación, defensa, rechazo, intensidad emocional y boca a boca comparable.",
    phraseHints: [
      "lo recomiendo",
      "no lo recomiendo",
      "me encanta",
      "lo odio",
      "definitivamente",
      "jamás vuelvo",
      "me quedo con",
      "cámbiate a"
    ],
    sourceHints: ["social listening export", "reviews", "NPS/comments CSV", "social comments"]
  }),
  ...templatesForThreeScopes({
    lensSlug: "trust-risk-benchmark",
    lensLabel: "Trust & Risk Benchmark",
    signalIntent: "trust_risk",
    signalLabel: "Confianza, riesgo y reputación",
    objective: "Capturar drivers de confianza, riesgo percibido, severidad y señales reputacionales.",
    phraseHints: [
      "me da confianza",
      "me da miedo",
      "es fraude",
      "letra chica",
      "me estafaron",
      "cumplieron",
      "no cumplen",
      "riesgo"
    ],
    sourceHints: ["social listening export", "reviews", "complaints CSV", "support tickets"]
  }),
  ...templatesForThreeScopes({
    lensSlug: "competitive-wave",
    lensLabel: "Competitive Wave",
    signalIntent: "competitive_wave",
    signalLabel: "Ejes comparativos y posición competitiva",
    objective: "Capturar señales comparables para construir ejes de posición competitiva entre entidades.",
    phraseHints: [
      "mejor que",
      "peor que",
      "se compara con",
      "prefiero",
      "lidera en",
      "se queda corto",
      "más fuerte",
      "más débil"
    ],
    sourceHints: ["competitor listening export", "reviews comparativas", "benchmark CSV", "social comments"]
  }),
  ...templatesForScopes({
    lensSlug: "audience-segment-lens",
    lensLabel: "Audience Segment Lens",
    signalIntent: "audience_segment",
    signalLabel: "Señales por audiencia o segmento",
    scopes: ["brand", "category"],
    objective: "Capturar señales con metadata o pistas de segmento para detectar sesgos de audiencia.",
    phraseHints: [
      "como mamá",
      "como estudiante",
      "para mi negocio",
      "en mi zona",
      "en mi edad",
      "para niños",
      "para trabajar",
      "para viajar"
    ],
    sourceHints: ["CRM/Zendesk CSV", "survey open ends", "reviews with metadata", "social listening export"]
  }),
  ...templatesForThreeScopes({
    lensSlug: "influence-architecture",
    lensLabel: "Influence Architecture",
    signalIntent: "influence_signal",
    signalLabel: "Nodos, comunidades e influencia",
    objective: "Capturar menciones con handles, comunidades, fuentes e interacciones que permitan inferir influencia.",
    phraseHints: [
      "lo vi en",
      "me recomendó",
      "influencer",
      "creator",
      "comunidad",
      "grupo",
      "trend",
      "viral"
    ],
    sourceHints: ["social export with handles", "creator CSV", "community posts", "listening author metadata"]
  }),
  ...templatesForScopes({
    lensSlug: "evidence-confidence-layer",
    lensLabel: "Evidence Confidence Layer",
    signalIntent: "evidence_confidence",
    signalLabel: "Calidad, diversidad y trazabilidad de evidencia",
    scopes: ["brand"],
    objective: "Capturar evidencia útil para evaluar confianza, diversidad de fuente y fuerza de claims.",
    phraseHints: [
      "en mi experiencia",
      "me pasó",
      "tengo evidencia",
      "captura",
      "ticket",
      "factura",
      "comprobante",
      "caso real"
    ],
    sourceHints: ["social listening export", "Zendesk", "reviews", "evidence/support CSV"]
  })
];

export function selectedLensSlugsFromAnalysisPlan(
  analysisPlan: unknown,
  primarySlug = PRIMARY_LENS
): string[] {
  const plan = normalizeAnalysisPlan(analysisPlan, primarySlug);
  return plan.selected_lenses;
}

export function buildLensQueryPacks(params: {
  input: QueryComposerInput;
  composed: ComposedQuery;
  analysisPlan?: unknown;
}): MaterializedLensQueryPack[] {
  const selectedLenses = selectedLensSlugsFromAnalysisPlan(
    params.analysisPlan,
    params.input.methodology.slug || PRIMARY_LENS
  );
  const selected = new Set(selectedLenses);
  const templates = LENS_QUERY_PACK_TEMPLATES.filter((template) => selected.has(template.lensSlug));
  const components = normalizeComponents(params.composed.query_components);

  return templates.flatMap((template) =>
    queryIdentitiesForScope({
      scope: template.scope,
      input: params.input,
      composed: params.composed,
      components
    }).map((identity) => {
      const structuralValidation = validatePortableListenQuery(identity.queryText);
      if (!structuralValidation.valid) {
        throw new Error(
          `Query pack ${template.lensSlug}/${template.scope}/${identity.entityKey ?? "scope"} ` +
          `violates the portable dialect: ${summarizePortableListenQueryErrors(structuralValidation)}`
        );
      }
      const queryText = structuralValidation.normalized_query;

      return {
        lensSlug: template.lensSlug,
        lensLabel: template.lensLabel,
        signalIntent: template.signalIntent,
        signalLabel: identity.entityLabel
          ? `${template.signalLabel}: ${identity.entityLabel}`
          : template.signalLabel,
        scope: template.scope,
        entityKey: identity.entityKey,
        entityLabel: identity.entityLabel,
        objective: template.objective,
        queryText,
        queryComponents: {
          source: "lens_query_pack_registry",
          retrieval_policy: "canonical_entity_query",
          classification_policy: "post_ingest",
          lens_slug: template.lensSlug,
          signal_intent: template.signalIntent,
          scope: template.scope,
          entity_key: identity.entityKey,
          entity_label: identity.entityLabel,
          query_identity: identity.queryIdentity,
          base_query_text: queryText,
          post_ingest_phrase_hints: template.phraseHints,
          source_hints: template.sourceHints,
          selected_lenses: selectedLenses,
          generation_contract: components.generation_contract ?? null,
          structural_validation: structuralValidation,
          shared_components: {
            brand_seeds: arrayOfStrings(components.brand_seeds),
            competitor_seeds: arrayOfStrings(components.competitor_seeds),
            category_seeds: arrayOfStrings(components.category_seeds),
            global_exclusions: arrayOfStrings(components.global_exclusions)
          }
        },
        seeds: {
          lens_slug: template.lensSlug,
          lens_label: template.lensLabel,
          signal_intent: template.signalIntent,
          signal_label: template.signalLabel,
          scope: template.scope,
          entity_key: identity.entityKey,
          entity_label: identity.entityLabel,
          scope_seeds: identity.scopeSeeds,
          post_ingest_phrase_hints: template.phraseHints,
          source_hints: template.sourceHints,
          required: template.required
        },
        evaluation: {
          source: "planned_from_query_iteration",
          status: "awaiting_imported_evidence",
          coverage: "pending_import",
          structural_status: "valid",
          evidence_status: "awaiting_imported_mentions"
        },
        status: "planned" as const,
        costBudget: {
          source: "study_size_policy",
          note: "Resolved by corpus package and worker runtime, not by hardcoded per-lens caps."
        }
      };
    })
  );
}

function normalizeAnalysisPlan(analysisPlan: unknown, primarySlug: string): { selected_lenses: string[] } {
  const plan = analysisPlan && typeof analysisPlan === "object" && !Array.isArray(analysisPlan)
    ? (analysisPlan as StudyAnalysisPlanLike)
    : {};
  const selected = Array.isArray(plan.selected_lenses)
    ? plan.selected_lenses.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return {
    selected_lenses: unique([primarySlug || PRIMARY_LENS, ...selected]).filter((slug) =>
      LENS_QUERY_PACK_TEMPLATES.some((template) => template.lensSlug === slug)
    )
  };
}

function templatesForThreeScopes(params: Omit<Parameters<typeof templatesForScopes>[0], "scopes">) {
  return templatesForScopes({ ...params, scopes: ["brand", "competitors", "category"] });
}

function templatesForScopes(params: {
  lensSlug: string;
  lensLabel: string;
  signalIntent: string;
  signalLabel: string;
  scopes: QueryPackScope[];
  objective: string;
  phraseHints: string[];
  sourceHints: string[];
}) {
  const labels: Record<QueryPackScope, string> = {
    brand: "Marca",
    competitors: "Competidores",
    category: "Categoría",
    baseline: "Baseline"
  };
  return params.scopes.map< LensQueryPackTemplate>((scope) => ({
    lensSlug: params.lensSlug,
    lensLabel: params.lensLabel,
    signalIntent: params.signalIntent,
    signalLabel: `${labels[scope]}: ${params.signalLabel}`,
    scope,
    objective: `${params.objective} Scope: ${labels[scope].toLowerCase()}.`,
    phraseHints: params.phraseHints,
    sourceHints: params.sourceHints,
    required: true
  }));
}

type QueryPackIdentity = {
  queryIdentity: string;
  entityKey: string | null;
  entityLabel: string | null;
  queryText: string;
  scopeSeeds: string[];
};

function queryIdentitiesForScope(params: {
  scope: QueryPackScope;
  input: QueryComposerInput;
  composed: ComposedQuery;
  components: Record<string, unknown>;
}): QueryPackIdentity[] {
  if (params.scope === "competitors") {
    const firstClass = params.composed.competitor_queries ?? [];
    if (firstClass.length > 0) {
      return firstClass.map((competitor) => {
        const governed = params.input.competitorEntities?.find(
          (entity) => normalizeEntityName(entity.name) === normalizeEntityName(competitor.entity)
        );
        return {
          queryIdentity: `competitor:${entitySlug(competitor.entity)}`,
          entityKey: `competitor:${entitySlug(competitor.entity)}`,
          entityLabel: competitor.entity,
          queryText: competitor.query_text,
          scopeSeeds: unique([
            competitor.entity,
            ...(governed?.aliases ?? []),
            ...(governed?.handles ?? [])
          ]).slice(0, 80)
        };
      });
    }

    if (params.composed.competitor_query_text) {
      return [{
        queryIdentity: "competitors:legacy-peer-set",
        entityKey: null,
        entityLabel: null,
        queryText: params.composed.competitor_query_text,
        scopeSeeds: arrayOfStrings(params.components.competitor_seeds).slice(0, 80)
      }];
    }
    return [];
  }

  if (params.scope === "category" || params.scope === "baseline") {
    const queryText = params.composed.industry_query_text;
    if (!queryText) return [];
    return [{
      queryIdentity: params.scope,
      entityKey: params.scope,
      entityLabel: null,
      queryText,
      scopeSeeds: arrayOfStrings(params.components.category_seeds).slice(0, 40)
    }];
  }

  return [{
    queryIdentity: "brand",
    entityKey: "brand",
    entityLabel: params.input.subject.name,
    queryText: params.composed.query_text,
    scopeSeeds: unique([
      params.input.subject.name,
      ...arrayOfStrings(params.components.brand_seeds)
    ]).slice(0, 60)
  }];
}

function normalizeComponents(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function normalizeEntityName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es-MX");
}

function entitySlug(value: string) {
  return normalizeEntityName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
