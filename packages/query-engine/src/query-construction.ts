import {
  validatePortableListenQuery,
  type PortableListenQueryValidation
} from "./listen-query-language";

export const QUERY_CONSTRUCTION_CONTRACT_VERSION = "query-construction-v2";

export type QueryConstructionMode = "exploratory" | "detection";
export type QueryConstructionScope = "brand" | "competitors" | "category";

export type QueryCompetitorEntity = {
  name: string;
  aliases?: string[];
  handles?: string[];
};

export type QueryConstructionInput = {
  methodologySlug: string;
  queryModeOverride?: QueryConstructionMode;
  subject: {
    type: "brand" | "theme";
    name: string;
    industry?: string | null;
    industrySub?: string | null;
    countries?: string[];
    handles?: string[];
  };
  brandSeeds: string[];
  categorySeeds: string[];
  competitorEntities?: QueryCompetitorEntity[];
  competitorSeeds?: string[];
  triggerTerms?: string[];
  barrierTerms?: string[];
  queryLanguage?: string[];
  exclusions?: string[];
  targetWindowMonths?: number | null;
};

export type QueryProviderConfig = {
  adapter: "listen_query_language";
  syntax_profile: "portable_keyword_v2";
  execution: "manual_export_import";
  rule_mode: "keyword";
  advanced_query_prefix: null;
  languages: string[];
  country: {
    mode: "open";
    values: [];
    rationale: string;
  };
  recommended_sources: string[];
  ignore_special_characters: "pilot_both";
  window_months: number;
};

export type QueryTagPlan = {
  application: "post_ingest";
  methodology_slug: string;
  tags: Array<{
    key: "trigger" | "barrier" | "experience" | "comparison";
    terms: string[];
    expression: string;
  }>;
};

export type QueryAmbiguityWarning = {
  term: string;
  reason: string;
  resolution: string;
};

export type QuerySemanticIssueCode =
  | "missing_anchor"
  | "missing_preemptive_noise"
  | "exploratory_theme_gate"
  | "detection_theme_missing"
  | "unbalanced_theme"
  | "long_exact_phrase"
  | "ambiguous_standalone_term"
  | "unsafe_bare_anchor"
  | "grouped_competitors"
  | "unverified_handle"
  | "noise_profile_missing";

export type QuerySemanticIssue = {
  code: QuerySemanticIssueCode;
  severity: "error" | "warning";
  message: string;
  term?: string;
};

export type QuerySemanticValidation = {
  valid: boolean;
  mode: QueryConstructionMode;
  scope: QueryConstructionScope;
  structural: PortableListenQueryValidation;
  errors: QuerySemanticIssue[];
  warnings: QuerySemanticIssue[];
};

export type QueryConstructionPlan = {
  version: typeof QUERY_CONSTRUCTION_CONTRACT_VERSION;
  mode: QueryConstructionMode;
  recommended_variant: "permissive" | "themed";
  rationale: string;
  anchors: {
    brand: string[];
    category: string[];
    competitor_entities: Array<{
      entity: string;
      terms: string[];
    }>;
  };
  noise_terms: string[];
  unsafe_bare_terms: QueryAmbiguityWarning[];
  theme_terms: {
    triggers: string[];
    barriers: string[];
    context: string[];
    balanced: string[];
  };
  permissive: {
    brand: string;
    category?: string;
    competitor_entities: Array<{
      entity: string;
      query: string;
    }>;
    /** Compatibility only. Analytical packs must use competitor_entities. */
    competitors_legacy_union?: string;
  };
  themed?: {
    brand: string;
    category?: string;
    competitor_entities: Array<{
      entity: string;
      query: string;
    }>;
  };
  provider_config: QueryProviderConfig;
  tag_plan: QueryTagPlan;
  ambiguity_warnings: QueryAmbiguityWarning[];
  handle_verification: Array<{
    handle: string;
    status: "verification_required";
  }>;
  domain_profiles: string[];
};

const EXPLORATORY_METHODOLOGIES = new Set([
  "triggers-barriers",
  "value-perception-matrix",
  "cultural-codes-decoding",
  "journey-friction-mapping"
]);

const COUNTRY_LANGUAGE_MAP: Record<string, string[]> = {
  AR: ["es", "en"],
  BO: ["es", "en"],
  BR: ["pt", "en", "es"],
  CL: ["es", "en"],
  CO: ["es", "en"],
  ES: ["es", "en"],
  MX: ["es", "en"],
  PE: ["es", "en"],
  PT: ["pt", "en"],
  US: ["en", "es"]
};

const AMBIGUOUS_STANDALONE_TERMS = new Map<string, string>([
  ["pix", "PIX es un rail transversal y sin contexto de tarjeta domina el volumen en Brasil."],
  ["nu", "Nu es ambiguo en portugues y no debe sustituir a Nubank."],
  ["elo", "Elo tiene ruido masivo de gaming, ajedrez y rating."],
  ["bandeira", "Bandeira tambien significa bandera nacional, deportiva o cultural."],
  ["tarjeta", "Tarjeta sola mezcla SIM, regalo, memoria, deporte y documentos."],
  ["cartao", "Cartao solo mezcla SUS, vacina, embarque, presente y visita."],
  ["cartão", "Cartao solo mezcla SUS, vacina, embarque, presente y visita."]
]);

const AMBIGUOUS_PAYMENT_ENTITY_TERMS = new Map<string, string>([
  ["visa", "Visa sola mezcla la red de pagos con migracion, turismo, tramites y salud."],
  ["carnet", "Carnet solo mezcla la red de pagos con documentos escolares, deportivos y de identidad."]
]);

type DomainProfile = {
  id: string;
  matches: (input: QueryConstructionInput) => boolean;
  categoryAnchors: string[];
  brandAnchors: (input: QueryConstructionInput) => string[];
  competitorAnchors: (entity: QueryCompetitorEntity, input: QueryConstructionInput) => string[];
  unsafeBareTerms: (input: QueryConstructionInput) => QueryAmbiguityWarning[];
  noise: string[];
  triggerTerms: string[];
  barrierTerms: string[];
  warnings: QueryAmbiguityWarning[];
  sources: string[];
};

const DOMAIN_PROFILES: DomainProfile[] = [
  {
    id: "pet_retail",
    matches: (input) => testContext(input, /pet|mascot|animal|veterinar|alimento para perro|alimento para gato/i),
    categoryAnchors: [
      "tienda de mascotas",
      "productos para mascotas",
      "alimento para mascotas",
      "comida para perros",
      "comida para gatos",
      "pet shop",
      "pet store",
      "veterinaria online"
    ],
    brandAnchors: () => [],
    competitorAnchors: (entity) => [
      `${entity.name} mascotas`,
      `${entity.name} pet`,
      `comprar en ${entity.name}`,
      `pedido ${entity.name}`
    ],
    unsafeBareTerms: () => [],
    noise: [
      "mascota virtual",
      "juego de mascotas",
      "pet simulator",
      "adopta una mascota roblox"
    ],
    triggerTerms: [
      "me lo recomendaron",
      "vale la pena",
      "me llego rapido",
      "me resolvieron",
      "volvi a comprar",
      "lo recomiendo",
      "me da confianza",
      "encontre todo",
      "mi veterinario recomendo",
      "me conviene la membresia"
    ],
    barrierTerms: [
      "no me llego",
      "pedido incompleto",
      "me cobraron de mas",
      "no hay stock",
      "no me resolvieron",
      "no vuelvo a comprar",
      "es mas caro",
      "cancele la membresia",
      "no pude pagar",
      "tardo demasiado"
    ],
    warnings: [],
    sources: ["x", "instagram", "tiktok", "facebook", "youtube_comments", "reddit", "app_reviews", "google_reviews"]
  },
  {
    id: "laika_disambiguation",
    matches: (input) => /\blaika\b/i.test(input.subject.name),
    categoryAnchors: [],
    brandAnchors: (input) => subjectVariants(input.subject.name, ["mascotas", "pet", "tienda de mascotas"]),
    competitorAnchors: () => [],
    unsafeBareTerms: () => [
      {
        term: "Laika",
        reason: "Laika sola comparte identidad con una IP audiovisual y una referencia historica masivas.",
        resolution: "Usar Laika Mascotas, aliases comerciales o Laika pegada a pet/mascotas."
      }
    ],
    noise: [
      "Laika Studios",
      "LAIKA animation",
      "Coraline",
      "Kubo and the Two Strings",
      "Missing Link",
      "ParaNorman",
      "perra Laika",
      "Laika astronauta",
      "Sputnik"
    ],
    triggerTerms: [],
    barrierTerms: [],
    warnings: [
      {
        term: "Laika",
        reason: "Comparte nombre con el estudio de animacion y la perra sovietica.",
        resolution: "Conservar aliases comerciales y excluir IP audiovisual/astronautica desde v1."
      }
    ],
    sources: []
  },
  {
    id: "payments_cards",
    matches: (input) => testContext(input, /visa|mastercard|amex|tarjet|cart[aã]o|payment|pago|banc|financ|fintech/i),
    categoryAnchors: [
      "tarjeta de credito",
      "tarjeta de debito",
      "tarjeta bancaria",
      "cartao de credito",
      "cartao de debito",
      "cartao bancario",
      "pago con tarjeta",
      "pagamento com cartao",
      "compra con tarjeta",
      "compra com cartao",
      "maquininha",
      "datafono",
      "terminal del banco",
      "bandeira do cartao",
      "cartao Nubank",
      "cartao Klar",
      "cartao Hey Banco",
      "banca digital",
      "banco digital"
    ],
    brandAnchors: (input) => [
      `tarjeta ${input.subject.name}`,
      `cartao ${input.subject.name}`,
      `pago con ${input.subject.name}`,
      `pagamento com ${input.subject.name}`,
      `bandeira ${input.subject.name}`,
      `"mi ${sanitizePhrase(input.subject.name)}"~2`,
      `"meu ${sanitizePhrase(input.subject.name)}"~2`
    ],
    competitorAnchors: (entity) => [
      `tarjeta ${entity.name}`,
      `cartao ${entity.name}`,
      `pago con ${entity.name}`,
      `pagamento com ${entity.name}`,
      `bandeira ${entity.name}`,
      `"mi ${sanitizePhrase(entity.name)}"~2`,
      `"meu ${sanitizePhrase(entity.name)}"~2`
    ],
    unsafeBareTerms: (input) => [
      ...Array.from(AMBIGUOUS_STANDALONE_TERMS, ([term, reason]) => ({
        term,
        reason,
        resolution: `Usar '${term}' solo pegado a producto, marca o mediante proximidad.`
      })),
      ...paymentEntityAmbiguity(input.subject.name)
    ],
    noise: [
      "visa de turista",
      "visa de trabajo",
      "visa americana",
      "visa canadiense",
      "cita para visa",
      "entrevista de visa",
      "visa vaccine",
      "visto de turista",
      "visto de trabalho",
      "Elo rating",
      "Elo xadrez",
      "Elo ajedrez",
      "rating Elo",
      "tarjeta SIM",
      "tarjeta de regalo",
      "tarjeta de memoria",
      "tarjeta madre",
      "tarjeta amarilla",
      "tarjeta roja",
      "cartao SIM",
      "cartao presente",
      "cartao de memoria",
      "cartao SUS",
      "cartao vacina",
      "cartao de embarque",
      "cartao amarelo",
      "cartao vermelho",
      "cartao de visita",
      "Mastercard Foundation",
      "Fundacao Mastercard",
      "resultados trimestrales",
      "earnings call",
      "quarterly results",
      "criptomone*",
      "remesa*",
      "remessa*",
      "hipotec*"
    ],
    triggerTerms: [
      "resolv*",
      "devolv*",
      "estorn*",
      "recomend*",
      "resolveram na hora",
      "estornaram rapidinho",
      "estorno rapido",
      "resolvieron en la app",
      "resolucao no app",
      "atencion por chat",
      "recomiendo la tarjeta",
      "recomendo o cartao",
      '"salvou minha vida cartao"~8',
      '"excelente atencion tarjeta"~8',
      '"atendimento excelente cartao"~8',
      "muito bom suporte",
      "seguro de compra",
      "proteccion de precio",
      "me cubrio el seguro",
      "beneficio de la tarjeta",
      "beneficio do cartao",
      "estorno rapido"
    ],
    barrierTerms: [
      "bloque*",
      "recus*",
      "clon*",
      "cobr*",
      "reclam*",
      "tarjeta rechazada",
      "cartao recusado",
      "no me paso la tarjeta",
      "fraude no cartao",
      "cargo no reconocido",
      "nao reconheco",
      "cobranca indevida",
      "aclaracion de cargo",
      "disputa no cartao",
      "estorno demorado",
      '"PIX cartao"~10',
      '"cambio abusivo cartao"~6',
      '"cartao IOF"~6',
      '"cartao dolar"~8',
      "no aceptan tarjeta",
      "solo aceptan efectivo",
      "so aceita PIX",
      "maquininha nao passou",
      "banco nao resolve",
      "puntos vencieron",
      "pontos vencidos"
    ],
    warnings: Array.from(AMBIGUOUS_STANDALONE_TERMS, ([term, reason]) => ({
      term,
      reason,
      resolution: `Usar '${term}' solo pegado a producto, marca o mediante proximidad.`
    })),
    sources: ["x", "instagram", "tiktok", "facebook", "youtube_comments", "reddit", "app_reviews", "google_reviews"]
  }
];

export function resolveQueryConstructionMode(
  methodologySlug: string,
  override?: QueryConstructionMode
): QueryConstructionMode {
  if (override) return override;
  return EXPLORATORY_METHODOLOGIES.has(methodologySlug) ? "exploratory" : "detection";
}

export function buildQueryConstructionPlan(input: QueryConstructionInput): QueryConstructionPlan {
  const mode = resolveQueryConstructionMode(input.methodologySlug, input.queryModeOverride);
  const profiles = DOMAIN_PROFILES.filter((profile) => profile.matches(input));
  const competitors = normalizeCompetitorEntities(input);
  const competitorProfileEntries = competitors.map((entity) => {
    const entityInput: QueryConstructionInput = {
      ...input,
      subject: {
        ...input.subject,
        name: entity.name,
        handles: entity.handles ?? []
      }
    };
    return {
      entity,
      input: entityInput,
      profiles: DOMAIN_PROFILES.filter((profile) => profile.matches(entityInput))
    };
  });
  const activeProfiles = Array.from(
    new Map(
      [...profiles, ...competitorProfileEntries.flatMap((entry) => entry.profiles)]
        .map((profile) => [profile.id, profile] as const)
    ).values()
  );
  const profileBrandAnchors = profiles.flatMap((profile) => profile.brandAnchors(input));
  const profileCategoryAnchors = profiles.flatMap((profile) => profile.categoryAnchors);
  const unsafeBareTerms = uniqueWarnings([
    ...profiles.flatMap((profile) => profile.unsafeBareTerms(input)),
    ...competitorProfileEntries.flatMap((entry) =>
      entry.profiles.flatMap((profile) => profile.unsafeBareTerms(entry.input))
    )
  ]);
  const unsafeBareTermSet = new Set(unsafeBareTerms.map((warning) => normalizeComparable(warning.term)));
  const noise = unique([...activeProfiles.flatMap((profile) => profile.noise), ...(input.exclusions ?? [])]);
  const triggerTerms = naturalThemeTerms([
    ...profiles.flatMap((profile) => profile.triggerTerms),
    ...(input.triggerTerms ?? [])
  ]);
  const barrierTerms = naturalThemeTerms([
    ...profiles.flatMap((profile) => profile.barrierTerms),
    ...(input.barrierTerms ?? [])
  ]);
  const contextTerms = naturalThemeTerms(input.queryLanguage ?? []);
  const theme = balancedThemeTerms(triggerTerms, barrierTerms, contextTerms);
  const brandAnchors = safeAnchorTerms(
    [input.subject.name, ...input.brandSeeds, ...profileBrandAnchors],
    unsafeBareTermSet
  );
  const categoryAnchors = safeAnchorTerms(
    [...input.categorySeeds, ...profileCategoryAnchors],
    unsafeBareTermSet
  );
  const competitorAnchors = competitorProfileEntries.map((entry) => ({
    entity: entry.entity.name,
    terms: safeAnchorTerms(
      [
        entry.entity.name,
        ...(entry.entity.aliases ?? []),
        ...(entry.entity.handles ?? []),
        ...entry.profiles.flatMap((profile) => profile.competitorAnchors(entry.entity, entry.input))
      ],
      unsafeBareTermSet
    )
  }));
  const permissiveBrand = buildExpression(brandAnchors, [], noise);
  const permissiveCategory = categoryAnchors.length > 0
    ? buildExpression(categoryAnchors, [], noise)
    : undefined;
  const competitorEntities = competitorAnchors.map((entity) => ({
    entity: entity.entity,
    query: buildExpression(entity.terms, [], noise)
  }));
  const legacyCompetitorUnion = competitorEntities.length > 0
    ? buildExpression(unique(competitorAnchors.flatMap((entity) => entity.terms)), [], noise)
    : undefined;
  const themed = theme.length > 0
    ? {
        brand: buildExpression(brandAnchors, theme, noise),
        ...(categoryAnchors.length > 0 ? { category: buildExpression(categoryAnchors, theme, noise) } : {}),
        competitor_entities: competitorAnchors.map((entity) => ({
          entity: entity.entity,
          query: buildExpression(entity.terms, theme, noise)
        }))
      }
    : undefined;
  const recommendedVariant = mode === "exploratory" ? "permissive" : "themed";
  const handles = unique([
    ...(input.subject.handles ?? []),
    ...input.brandSeeds.filter((seed) => seed.startsWith("@")),
    ...competitors.flatMap((entity) => entity.handles ?? [])
  ]);

  return {
    version: QUERY_CONSTRUCTION_CONTRACT_VERSION,
    mode,
    recommended_variant: recommendedVariant,
    rationale: mode === "exploratory"
      ? "El corpus se captura por entidad y se clasifica por tema despues de la ingesta para evitar sesgo y perdida de recall."
      : "El playbook requiere prefiltrado tematico; se entrega una variante con THEME estructural.",
    anchors: {
      brand: brandAnchors,
      category: categoryAnchors,
      competitor_entities: competitorAnchors
    },
    noise_terms: noise,
    unsafe_bare_terms: unsafeBareTerms,
    theme_terms: {
      triggers: triggerTerms,
      barriers: barrierTerms,
      context: contextTerms,
      balanced: theme
    },
    permissive: {
      brand: permissiveBrand,
      ...(permissiveCategory ? { category: permissiveCategory } : {}),
      competitor_entities: competitorEntities,
      ...(legacyCompetitorUnion ? { competitors_legacy_union: legacyCompetitorUnion } : {})
    },
    ...(themed ? { themed } : {}),
    provider_config: buildProviderConfig(input, activeProfiles),
    tag_plan: buildTagPlan(input, triggerTerms, barrierTerms, contextTerms),
    ambiguity_warnings: uniqueWarnings([
      ...activeProfiles.flatMap((profile) => profile.warnings),
      ...unsafeBareTerms
    ]),
    handle_verification: handles.map((handle) => ({ handle, status: "verification_required" as const })),
    domain_profiles: activeProfiles.map((profile) => profile.id)
  };
}

export function validateConstructedQuery(params: {
  query: string;
  scope: QueryConstructionScope;
  input: QueryConstructionInput;
  plan?: QueryConstructionPlan;
  competitorEntity?: string;
  allowLegacyCompetitorUnion?: boolean;
}): QuerySemanticValidation {
  const plan = params.plan ?? buildQueryConstructionPlan(params.input);
  const structural = validatePortableListenQuery(params.query);
  const errors: QuerySemanticIssue[] = [];
  const warnings: QuerySemanticIssue[] = [];
  const normalizedQuery = structural.normalized_query.toLocaleLowerCase("es-MX");
  const positiveQuery = normalizedQuery.split(/\s+AND\s+NOT\s+/i)[0] ?? normalizedQuery;
  const anchors = anchorsForScope(params.scope, plan, params.competitorEntity);
  const themeTerms = plan.theme_terms.balanced;
  const knownNoise = plan.noise_terms.length > 0;

  if (structural.valid && !containsAnyTerm(positiveQuery, anchors)) {
    errors.push(semanticIssue("missing_anchor", "error", `La query ${params.scope} no contiene un anchor gobernado por Data OS.`));
  }
  if (structural.valid && knownNoise && !/\bAND\s+NOT\b/i.test(normalizedQuery)) {
    errors.push(semanticIssue(
      "missing_preemptive_noise",
      "error",
      "La entidad tiene ambiguedades conocidas y necesita un bloque AND NOT desde la primera version."
    ));
  } else if (structural.valid && !knownNoise && !/\bAND\s+NOT\b/i.test(normalizedQuery)) {
    warnings.push(semanticIssue(
      "noise_profile_missing",
      "warning",
      "No existe todavia un perfil de homonimos para este dominio; la query necesita pilot antes de firma."
    ));
  }

  if (
    structural.valid
    && plan.mode === "exploratory"
    && hasExploratoryThemeGate(
      positiveQuery,
      themeTerms,
      unique([...anchors, ...plan.anchors.category])
    )
  ) {
    errors.push(semanticIssue(
      "exploratory_theme_gate",
      "error",
      "Un playbook exploratorio no puede exigir triggers/barriers con AND durante la ingesta; esas senales pertenecen al tag plan."
    ));
  }
  if (structural.valid && plan.mode === "detection" && themeTerms.length > 0 && !containsAnyTerm(positiveQuery, themeTerms)) {
    errors.push(semanticIssue(
      "detection_theme_missing",
      "error",
      "El modo detection necesita al menos un termino de THEME defendible."
    ));
  }
  if (
    structural.valid
    && plan.mode === "detection"
    && plan.theme_terms.triggers.length > 0
    && plan.theme_terms.barriers.length > 0
  ) {
    const triggerCount = countMatchingTerms(positiveQuery, plan.theme_terms.triggers);
    const barrierCount = countMatchingTerms(positiveQuery, plan.theme_terms.barriers);
    const total = triggerCount + barrierCount;
    const triggerShare = total > 0 ? triggerCount / total : 0;
    if (triggerCount === 0 || barrierCount === 0 || triggerShare < 0.4 || triggerShare > 0.6) {
      errors.push(semanticIssue(
        "unbalanced_theme",
        "error",
        `El THEME debe balancear lenguaje positivo y negativo; encontro ${triggerCount} triggers y ${barrierCount} barriers.`
      ));
    }
  }

  for (const phrase of exactPhrases(params.query)) {
    if (phrase.value.trim().split(/\s+/u).length > 5 && phrase.proximity === null) {
      errors.push(semanticIssue(
        "long_exact_phrase",
        "error",
        `La frase exacta '${phrase.value}' tiene mas de cinco palabras; usa una expresion corta o proximidad.`,
        phrase.value
      ));
    }
  }

  for (const term of positiveAtomicTerms(positiveQuery)) {
    const normalizedTerm = normalizeComparable(term);
    const reason = AMBIGUOUS_STANDALONE_TERMS.get(normalizedTerm);
    if (reason) {
      errors.push(semanticIssue(
        "ambiguous_standalone_term",
        "error",
        `${reason} Debe ir pegado a producto/marca o mediante proximidad.`,
        term
      ));
      continue;
    }
    const unsafe = plan.unsafe_bare_terms.find(
      (warning) => normalizeComparable(warning.term) === normalizedTerm
    );
    if (unsafe) {
      errors.push(semanticIssue(
        "unsafe_bare_anchor",
        "error",
        `${unsafe.reason} ${unsafe.resolution}`,
        term
      ));
    }
  }

  if (params.scope === "competitors" && !params.allowLegacyCompetitorUnion) {
    const matchedEntities = plan.anchors.competitor_entities.filter((entity) =>
      containsAnyTerm(positiveQuery, entity.terms)
    );
    if (matchedEntities.length > 1) {
      errors.push(semanticIssue(
        "grouped_competitors",
        "error",
        `La query mezcla ${matchedEntities.length} competidores. El contrato exige una query por entidad.`
      ));
    }
  }

  for (const handle of plan.handle_verification) {
    if (normalizedQuery.includes(handle.handle.toLocaleLowerCase("es-MX"))) {
      warnings.push(semanticIssue(
        "unverified_handle",
        "warning",
        `El handle ${handle.handle} viene de Brand OS pero requiere verificacion operativa antes de correr.`,
        handle.handle
      ));
    }
  }

  return {
    valid: structural.valid && errors.length === 0,
    mode: plan.mode,
    scope: params.scope,
    structural,
    errors,
    warnings
  };
}

function buildProviderConfig(input: QueryConstructionInput, profiles: DomainProfile[]): QueryProviderConfig {
  const countryCodes = unique((input.subject.countries ?? []).map(normalizeCountryCode));
  const languages = unique(countryCodes.flatMap((country) => COUNTRY_LANGUAGE_MAP[country] ?? ["en"]));
  const nativeLanguages = languages.length > 0 ? languages : ["es", "en"];
  return {
    adapter: "listen_query_language",
    syntax_profile: "portable_keyword_v2",
    execution: "manual_export_import",
    rule_mode: "keyword",
    advanced_query_prefix: null,
    languages: nativeLanguages.includes("en") ? nativeLanguages : [...nativeLanguages, "en"],
    country: {
      mode: "open",
      values: [],
      rationale: "Country queda abierto por default porque la geolocalizacion social es incompleta; mercado se valida post-ingesta."
    },
    recommended_sources: unique([
      "x",
      "instagram",
      "tiktok",
      "facebook",
      "youtube_comments",
      "reddit",
      ...profiles.flatMap((profile) => profile.sources)
    ]),
    ignore_special_characters: "pilot_both",
    window_months: input.targetWindowMonths ?? 12
  };
}

function buildTagPlan(
  input: QueryConstructionInput,
  triggers: string[],
  barriers: string[],
  queryLanguage: string[]
): QueryTagPlan {
  const tag = (
    key: QueryTagPlan["tags"][number]["key"],
    terms: string[]
  ): QueryTagPlan["tags"][number] => {
    const governedTerms = naturalThemeTerms(terms);
    return {
      key,
      terms: governedTerms,
      expression: governedTerms.length > 0 ? `(${renderClause(governedTerms)})` : ""
    };
  };

  const tags = [
    tag("trigger", triggers),
    tag("barrier", barriers),
    tag("experience", unique([...triggers, ...barriers, ...queryLanguage]).slice(0, 80)),
    tag("comparison", ["prefiero", "prefiro", "me cambie a", "troquei para", "mejor que", "melhor que"])
  ].filter((candidate) => candidate.terms.length > 0);

  return {
    application: "post_ingest",
    methodology_slug: input.methodologySlug,
    tags
  };
}

function buildExpression(anchorTerms: string[], themeTerms: string[], noiseTerms: string[]) {
  const anchor = renderClause(anchorTerms);
  const theme = renderClause(naturalThemeTerms(themeTerms));
  const noise = renderClause(noiseTerms);
  const candidate = [
    `(${anchor})`,
    theme ? `AND (${theme})` : "",
    noise ? `AND NOT (${noise})` : ""
  ].filter(Boolean).join(" ");
  const validation = validatePortableListenQuery(candidate);
  if (validation.valid) return validation.normalized_query;
  throw new Error(`Deterministic query construction produced invalid syntax: ${validation.errors.map((item) => item.message).join(" ")}`);
}

function balancedThemeTerms(triggers: string[], barriers: string[], queryLanguage: string[]) {
  const naturalTriggers = naturalThemeTerms(triggers);
  const naturalBarriers = naturalThemeTerms(barriers);
  const perSide = Math.min(20, Math.max(1, Math.min(naturalTriggers.length || 1, naturalBarriers.length || 1)));
  return unique([
    ...naturalTriggers.slice(0, perSide),
    ...naturalBarriers.slice(0, perSide),
    ...naturalThemeTerms(queryLanguage).slice(0, 12)
  ]);
}

function naturalThemeTerms(values: string[]) {
  return unique(values)
    .map((value) => value.trim())
    .filter((value) => {
      if (/^"[^"\n]+"~\d+$/u.test(value)) return true;
      const unquoted = value.replace(/^"|"$/g, "");
      return unquoted.split(/\s+/u).length <= 5;
    });
}

function renderClause(values: string[]) {
  return unique(values).map(renderTerm).filter(Boolean).join(" OR ");
}

function renderTerm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^"[^"\n]+"(?:~\d+)?$/u.test(trimmed)) return trimmed;
  const sanitized = sanitizePhrase(trimmed);
  if (!sanitized) return "";
  if (/^[@#]?[\p{L}\p{N}_.-]+(?:[?*])?$/u.test(sanitized)) return sanitized;
  return `"${sanitized}"`;
}

function normalizeCompetitorEntities(input: QueryConstructionInput): QueryCompetitorEntity[] {
  const explicit = input.competitorEntities ?? [];
  if (explicit.length > 0) {
    return explicit
      .map((entity) => ({
        name: entity.name.trim(),
        aliases: unique(entity.aliases ?? []),
        handles: unique(entity.handles ?? [])
      }))
      .filter((entity) => entity.name.length > 0);
  }
  return unique(input.competitorSeeds ?? []).map((name) => ({ name, aliases: [], handles: [] }));
}

function anchorsForScope(
  scope: QueryConstructionScope,
  plan: QueryConstructionPlan,
  competitorEntity?: string
) {
  if (scope === "brand") return plan.anchors.brand;
  if (scope === "category") return plan.anchors.category;
  if (competitorEntity) {
    return plan.anchors.competitor_entities.find((entity) => entity.entity === competitorEntity)?.terms ?? [];
  }
  return plan.anchors.competitor_entities.flatMap((entity) => entity.terms);
}

function containsAnyTerm(query: string, terms: string[]) {
  const haystack = normalizeComparable(query);
  return unique(terms).some((term) => {
    const needle = normalizeComparable(term.replace(/^"|"(?:~\d+)?$/g, ""));
    return needle.length > 0 && haystack.includes(needle);
  });
}

function countMatchingTerms(query: string, terms: string[]) {
  return unique(terms).filter((term) => containsAnyTerm(query, [term])).length;
}

function hasExploratoryThemeGate(
  query: string,
  themeTerms: string[],
  governedIdentityTerms: string[]
) {
  const clauses = splitTopLevelAndClauses(query);
  if (clauses.length < 2) return false;

  return clauses.some((clause) => {
    if (containsAnyTerm(clause, themeTerms)) return true;
    return !containsAnyTerm(clause, governedIdentityTerms);
  });
}

function splitTopLevelAndClauses(value: string) {
  let source = value.trim();
  while (isWrappedBySingleParenthesisPair(source)) {
    source = source.slice(1, -1).trim();
  }
  const clauses: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && source.slice(index, index + 5).toUpperCase() === " AND ") {
      clauses.push(source.slice(start, index).trim());
      start = index + 5;
      index += 4;
    }
  }
  clauses.push(source.slice(start).trim());
  return clauses.filter(Boolean);
}

function isWrappedBySingleParenthesisPair(value: string) {
  if (!value.startsWith("(") || !value.endsWith(")")) return false;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function exactPhrases(query: string) {
  const values: Array<{ value: string; proximity: number | null }> = [];
  const pattern = /"([^"\n]+)"(?:~(\d+))?/gu;
  for (const match of query.matchAll(pattern)) {
    values.push({ value: match[1] ?? "", proximity: match[2] ? Number(match[2]) : null });
  }
  return values;
}

function positiveAtomicTerms(query: string) {
  return query
    .replace(/[()]/g, " ")
    .split(/\s+(?:AND|OR|NOT)\s+/iu)
    .map((term) => term.trim().replace(/^"|"(?:~\d+)?$/g, ""))
    .filter(Boolean);
}

function safeAnchorTerms(values: string[], unsafeBareTerms: Set<string>) {
  return unique(values).filter((value) => {
    const comparable = normalizeComparable(value.replace(/^"|"(?:~\d+)?$/g, ""));
    return !unsafeBareTerms.has(comparable);
  });
}

function paymentEntityAmbiguity(subjectName: string): QueryAmbiguityWarning[] {
  const normalized = normalizeComparable(subjectName);
  const reason = AMBIGUOUS_PAYMENT_ENTITY_TERMS.get(normalized);
  if (!reason) return [];
  return [
    {
      term: subjectName,
      reason,
      resolution: `Usar ${subjectName} pegada a tarjeta/cartao, emisor, producto o expresion posesiva natural.`
    }
  ];
}

function testContext(input: QueryConstructionInput, pattern: RegExp) {
  return pattern.test([
    input.subject.name,
    input.subject.industry ?? "",
    input.subject.industrySub ?? "",
    ...input.brandSeeds,
    ...input.categorySeeds
  ].join(" "));
}

function subjectVariants(subjectName: string, suffixes: string[]) {
  const base = subjectName.replace(/\s+mascotas?$/iu, "").trim() || subjectName.trim();
  return unique([
    subjectName,
    ...suffixes.map((suffix) => `${base} ${suffix}`)
  ]);
}

function normalizeCountryCode(value: string) {
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/\(([A-Z]{2})\)$/u);
  if (match?.[1]) return match[1];
  const aliases: Record<string, string> = {
    ARGENTINA: "AR",
    BOLIVIA: "BO",
    BRASIL: "BR",
    BRAZIL: "BR",
    CHILE: "CL",
    COLOMBIA: "CO",
    ESPANA: "ES",
    SPAIN: "ES",
    MEXICO: "MX",
    PERU: "PE",
    PORTUGAL: "PT",
    "UNITED STATES": "US",
    USA: "US"
  };
  return aliases[normalizeComparable(normalized).toUpperCase()] ?? normalized;
}

function semanticIssue(
  code: QuerySemanticIssueCode,
  severity: "error" | "warning",
  message: string,
  term?: string
): QuerySemanticIssue {
  return { code, severity, message, ...(term ? { term } : {}) };
}

function sanitizePhrase(value: string) {
  return value.replace(/["\n\r]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^\p{L}\p{N}@#*?]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueWarnings(values: QueryAmbiguityWarning[]) {
  const seen = new Set<string>();
  return values.filter((warning) => {
    const key = `${warning.term}:${warning.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
