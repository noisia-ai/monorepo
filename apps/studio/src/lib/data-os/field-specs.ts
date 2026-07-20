export type DataOsConfidence = "low" | "medium" | "high";

export type DataOsBehaviorRule = {
  field: string;
  operator: "exists" | "not_exists" | "equals" | "contains" | "gte" | "lte";
  value?: string | number | boolean | null;
  window_days?: number;
  source?: string;
};

export type DataOsEvidenceRef = {
  source: string;
  excerpt?: string;
  confidence: DataOsConfidence;
};

export type DataOsDecisionSpec = {
  key: string;
  label: string;
  area: string;
  lever: string;
  decision_type: "positioning" | "messaging" | "retention" | "product" | "media" | "pricing" | "service" | "commerce" | "operations" | "measurement" | "other";
  evidence: DataOsEvidenceRef[];
  confidence: DataOsConfidence;
};

export type DataOsAudienceSpec = {
  key: string;
  label: string;
  entity_type: "consumer" | "household" | "account" | "unknown";
  markets: string[];
  facets: string[];
  geo_market?: string | null;
  lifecycle_stage?: string | null;
  channel_affinity?: string | null;
  species?: string | null;
  membership_status?: string | null;
  intent?: string | null;
  behavioral_rules: DataOsBehaviorRule[];
  computed_traits: Array<{ name: string; expression: string; window_days?: number }>;
  evidence: DataOsEvidenceRef[];
  activation_readiness: "rule_ready" | "requires_data" | "draft";
  confidence: DataOsConfidence;
};

export type DataOsSignalSpec = {
  key: string;
  label: string;
  signal_type: "trigger" | "barrier" | "hypothesis" | "constraint";
  taxonomy: string;
  signal_terms: string[];
  evidence: DataOsEvidenceRef[];
  confidence: DataOsConfidence;
};

export type DataOsSuccessMetricSpec = {
  key: string;
  label: string;
  metric: string;
  target_direction: "increase" | "decrease" | "validate" | "discover";
  unit?: string | null;
  window?: string | null;
  evidence: DataOsEvidenceRef[];
  confidence: DataOsConfidence;
};

export type StudyDataOsFieldSpecs = {
  version: 1;
  source: "new_study_form";
  objective: {
    business_question: string;
    geo_focus: string[];
    target_window_months: number;
  };
  decisions: DataOsDecisionSpec[];
  audiences: DataOsAudienceSpec[];
  contexts: Array<{
    key: string;
    context_type: "category" | "competitive" | "study";
    text: string;
    evidence: DataOsEvidenceRef[];
  }>;
  hypotheses: DataOsSignalSpec[];
  barriers: DataOsSignalSpec[];
  triggers: DataOsSignalSpec[];
  constraints: DataOsSignalSpec[];
  success_metrics: DataOsSuccessMetricSpec[];
  source_contract: {
    source_count: number;
    source_kinds: string[];
    has_structured_sources: boolean;
    uploaded_source_names: string[];
  };
};

export type BrandDataOsFieldSpecs = {
  version: 1;
  source: "new_brand_form";
  identity: {
    brand_name: string;
    brand_slug: string;
    countries: string[];
    industry: string | null;
    subindustries: string[];
  };
  seed_terms: Array<{
    key: string;
    term: string;
    term_type: "brand_name" | "brand_slug" | "alias" | "country" | "industry" | "subindustry" | "competitor";
    catalog_role: string;
    confidence: DataOsConfidence;
  }>;
  competitors: Array<{
    key: string;
    name: string;
    role: "direct_competitor" | "category_benchmark";
    priority?: number;
    market_scope: string[];
    category_scope: string[];
    confidence: DataOsConfidence;
  }>;
};

type SourceManifestLike = {
  name?: string;
  kind?: string;
  mime_type?: string;
  field_names?: string[];
  row_count?: number;
};

export function buildStudyDataOsFieldSpecs(input: {
  submittedSpecs?: unknown;
  businessQuestion: string;
  decisionToInform?: string | null;
  audienceSegment?: string | null;
  categoryContext?: string | null;
  competitiveContext?: string | null;
  studyContext?: string | null;
  hypotheses?: string | null;
  knownBarriers?: string | null;
  knownTriggers?: string | null;
  strategicConstraints?: string | null;
  successCriteria?: string | null;
  geoFocus: string[];
  targetWindowMonths: number;
  sourceManifest?: SourceManifestLike[];
}): StudyDataOsFieldSpecs {
  const submitted = readSubmittedStudySpecs(input.submittedSpecs);
  const sourceManifest = input.sourceManifest ?? [];
  const evidence = buildEvidence(sourceManifest);
  const sourceContract = {
    source_count: sourceManifest.length,
    source_kinds: unique(sourceManifest.map((source) => source.kind || source.mime_type || "manual_upload")),
    has_structured_sources: sourceManifest.some((source) => Boolean(source.row_count || source.field_names?.length)),
    uploaded_source_names: sourceManifest.map((source) => source.name || "Untitled source").filter(Boolean)
  };

  return {
    version: 1,
    source: "new_study_form",
    objective: {
      business_question: clean(input.businessQuestion, 900),
      geo_focus: input.geoFocus,
      target_window_months: input.targetWindowMonths
    },
    decisions: mergeByKey([
      ...submitted.decisions,
      ...splitItems(input.decisionToInform).map((label) => buildDecisionSpec(label, evidence))
    ]),
    audiences: mergeByKey([
      ...submitted.audiences,
      ...splitItems(input.audienceSegment).map((label) => buildAudienceSpec(label, input.geoFocus, evidence, sourceContract.has_structured_sources))
    ]),
    contexts: [
      buildContextSpec("category", input.categoryContext, evidence),
      buildContextSpec("competitive", input.competitiveContext, evidence),
      buildContextSpec("study", input.studyContext, evidence)
    ].filter(isContextSpec),
    hypotheses: mergeByKey([
      ...submitted.hypotheses,
      ...splitItems(input.hypotheses).map((label) => buildSignalSpec(label, "hypothesis", evidence))
    ]),
    barriers: mergeByKey([
      ...submitted.barriers,
      ...splitItems(input.knownBarriers).map((label) => buildSignalSpec(label, "barrier", evidence))
    ]),
    triggers: mergeByKey([
      ...submitted.triggers,
      ...splitItems(input.knownTriggers).map((label) => buildSignalSpec(label, "trigger", evidence))
    ]),
    constraints: mergeByKey([
      ...submitted.constraints,
      ...splitItems(input.strategicConstraints).map((label) => buildSignalSpec(label, "constraint", evidence))
    ]),
    success_metrics: mergeByKey([
      ...submitted.successMetrics,
      ...splitItems(input.successCriteria).map((label) => buildSuccessMetricSpec(label, evidence))
    ]),
    source_contract: sourceContract
  };
}

export function buildBrandDataOsFieldSpecs(input: {
  brandName: string;
  brandSlug: string;
  industry?: string | null;
  industrySub?: string | null;
  countries: string[];
  aliases: string[];
  competitors: Array<{ name: string; priority?: number }>;
}): BrandDataOsFieldSpecs {
  const subindustries = splitItems(input.industrySub);
  const seedTerms = [
    buildBrandSeedTerm(input.brandName, "brand_name", "primary_entity"),
    buildBrandSeedTerm(input.brandSlug, "brand_slug", "canonical_slug"),
    ...input.aliases.map((term) => buildBrandSeedTerm(term, "alias", "brand_alias")),
    ...input.countries.map((term) => buildBrandSeedTerm(term, "country", "market_scope")),
    ...(input.industry ? [buildBrandSeedTerm(input.industry, "industry", "category_scope")] : []),
    ...subindustries.map((term) => buildBrandSeedTerm(term, "subindustry", "category_scope")),
    ...input.competitors.map((competitor) => buildBrandSeedTerm(competitor.name, "competitor", "competitive_seed"))
  ];

  return {
    version: 1,
    source: "new_brand_form",
    identity: {
      brand_name: input.brandName,
      brand_slug: input.brandSlug,
      countries: input.countries,
      industry: input.industry ?? null,
      subindustries
    },
    seed_terms: uniqueBy(seedTerms, (item) => `${item.term_type}:${item.key}`),
    competitors: input.competitors.map((competitor) => ({
      key: stableKey(competitor.name),
      name: competitor.name,
      role: "direct_competitor",
      priority: competitor.priority,
      market_scope: input.countries,
      category_scope: [input.industry, ...subindustries].filter((item): item is string => Boolean(item)),
      confidence: "medium"
    }))
  };
}

export function splitItems(value: string | null | undefined) {
  return (value ?? "")
    .split(/\n|\t|;/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 80);
}

function readSubmittedStudySpecs(value: unknown) {
  const root = asRecord(value) ?? {};
  const specs = asRecord(root.data_os_field_specs) ?? asRecord(root.field_specs) ?? root;
  return {
    decisions: readArray(specs.decision_specs ?? specs.decisions).map((item) => normalizeDecisionSpec(item)).filter(isDecisionSpec),
    audiences: readArray(specs.audience_specs ?? specs.audiences).map((item) => normalizeAudienceSpec(item)).filter(isAudienceSpec),
    hypotheses: readArray(specs.hypothesis_specs ?? specs.hypotheses).map((item) => normalizeSignalSpec(item, "hypothesis")).filter(isSignalSpec),
    barriers: readArray(specs.barrier_specs ?? specs.barriers).map((item) => normalizeSignalSpec(item, "barrier")).filter(isSignalSpec),
    triggers: readArray(specs.trigger_specs ?? specs.triggers).map((item) => normalizeSignalSpec(item, "trigger")).filter(isSignalSpec),
    constraints: readArray(specs.constraint_specs ?? specs.constraints).map((item) => normalizeSignalSpec(item, "constraint")).filter(isSignalSpec),
    successMetrics: readArray(specs.success_metric_specs ?? specs.success_metrics).map((item) => normalizeSuccessMetricSpec(item)).filter(isSuccessMetricSpec)
  };
}

function normalizeDecisionSpec(value: unknown): DataOsDecisionSpec | null {
  const record = asRecord(value);
  const label = clean(record?.label ?? record?.name, 180);
  if (!label) return null;
  return {
    ...buildDecisionSpec(label, []),
    area: clean(record?.area, 80) || buildDecisionSpec(label, []).area,
    lever: clean(record?.lever, 100) || buildDecisionSpec(label, []).lever,
    confidence: confidence(record?.confidence)
  };
}

function normalizeAudienceSpec(value: unknown): DataOsAudienceSpec | null {
  const record = asRecord(value);
  const label = clean(record?.label ?? record?.name, 220);
  if (!label) return null;
  const base = buildAudienceSpec(label, readStringArray(record?.markets), [], Boolean(readArray(record?.behavioral_rules).length));
  return {
    ...base,
    entity_type: entityType(record?.entity_type) ?? base.entity_type,
    markets: readStringArray(record?.markets).length ? readStringArray(record?.markets) : base.markets,
    facets: readStringArray(record?.facets).length ? readStringArray(record?.facets) : base.facets,
    geo_market: clean(record?.geo_market ?? record?.geo, 120) || base.geo_market,
    lifecycle_stage: clean(record?.lifecycle_stage, 120) || base.lifecycle_stage,
    channel_affinity: clean(record?.channel_affinity, 120) || base.channel_affinity,
    species: clean(record?.species, 80) || base.species,
    membership_status: clean(record?.membership_status, 120) || base.membership_status,
    intent: clean(record?.intent, 140) || base.intent,
    behavioral_rules: readArray(record?.behavioral_rules).map(normalizeBehaviorRule).filter(isBehaviorRule),
    computed_traits: readArray(record?.computed_traits).map(normalizeComputedTrait).filter(isComputedTrait),
    activation_readiness: activationReadiness(record?.activation_readiness) ?? base.activation_readiness,
    confidence: confidence(record?.confidence)
  };
}

function normalizeSignalSpec(value: unknown, signalType: DataOsSignalSpec["signal_type"]): DataOsSignalSpec | null {
  const record = asRecord(value);
  const label = clean(record?.label ?? record?.name, 260);
  if (!label) return null;
  return {
    ...buildSignalSpec(label, signalType, []),
    taxonomy: clean(record?.taxonomy, 120) || inferSignalTaxonomy(label, signalType),
    signal_terms: readStringArray(record?.signal_terms).length ? readStringArray(record?.signal_terms) : extractTerms(label),
    confidence: confidence(record?.confidence)
  };
}

function normalizeSuccessMetricSpec(value: unknown): DataOsSuccessMetricSpec | null {
  const record = asRecord(value);
  const label = clean(record?.label ?? record?.name, 260);
  if (!label) return null;
  return {
    ...buildSuccessMetricSpec(label, []),
    metric: clean(record?.metric, 160) || inferMetric(label),
    target_direction: targetDirection(record?.target_direction) ?? inferTargetDirection(label),
    unit: clean(record?.unit, 80) || null,
    window: clean(record?.window, 120) || null,
    confidence: confidence(record?.confidence)
  };
}

function buildDecisionSpec(label: string, evidence: DataOsEvidenceRef[]): DataOsDecisionSpec {
  const [rawArea, rawLever] = label.split(/\s+\/\s+/, 2);
  const area = clean(rawArea || label, 80);
  const lever = clean(rawLever || inferDecisionLever(label), 100);
  return {
    key: stableKey(`${area}-${lever}`),
    label: clean(label, 180),
    area,
    lever,
    decision_type: inferDecisionType(label),
    evidence,
    confidence: evidence.length ? "high" : "medium"
  };
}

function buildAudienceSpec(label: string, markets: string[], evidence: DataOsEvidenceRef[], hasStructuredSources: boolean): DataOsAudienceSpec {
  const normalized = normalize(label);
  const facets = label
    .split(/\s+[·|]\s+|\s+--\s+|\s+—\s+/)
    .map((item) => clean(item, 120))
    .filter(Boolean);
  return {
    key: stableKey(label),
    label: clean(label, 220),
    entity_type: /empresa|account|cuenta|cliente b2b/.test(normalized) ? "account" : /hogar|household/.test(normalized) ? "household" : "consumer",
    markets,
    facets,
    geo_market: inferGeoMarket(label),
    lifecycle_stage: inferLifecycleStage(label),
    channel_affinity: inferChannelAffinity(label),
    species: inferSpecies(label),
    membership_status: inferMembershipStatus(label),
    intent: inferIntent(label),
    behavioral_rules: inferBehaviorRules(label),
    computed_traits: inferComputedTraits(label),
    evidence,
    activation_readiness: hasStructuredSources || inferBehaviorRules(label).length > 0 ? "rule_ready" : "requires_data",
    confidence: evidence.length ? "high" : "medium"
  };
}

function buildSignalSpec(label: string, signalType: DataOsSignalSpec["signal_type"], evidence: DataOsEvidenceRef[]): DataOsSignalSpec {
  return {
    key: stableKey(`${signalType}-${label}`),
    label: clean(label, 260),
    signal_type: signalType,
    taxonomy: inferSignalTaxonomy(label, signalType),
    signal_terms: extractTerms(label),
    evidence,
    confidence: evidence.length ? "high" : "medium"
  };
}

function buildSuccessMetricSpec(label: string, evidence: DataOsEvidenceRef[]): DataOsSuccessMetricSpec {
  return {
    key: stableKey(`success-${label}`),
    label: clean(label, 260),
    metric: inferMetric(label),
    target_direction: inferTargetDirection(label),
    unit: inferUnit(label),
    window: inferWindow(label),
    evidence,
    confidence: evidence.length ? "high" : "medium"
  };
}

function buildContextSpec(
  contextType: "category" | "competitive" | "study",
  value: string | null | undefined,
  evidence: DataOsEvidenceRef[]
): StudyDataOsFieldSpecs["contexts"][number] | null {
  const text = clean(value, contextType === "study" ? 1800 : 2400);
  if (!text) return null;
  return {
    key: contextType,
    context_type: contextType,
    text,
    evidence
  };
}

function buildBrandSeedTerm(
  term: string,
  termType: BrandDataOsFieldSpecs["seed_terms"][number]["term_type"],
  catalogRole: string
) {
  return {
    key: stableKey(`${termType}-${term}`),
    term: clean(term, 240),
    term_type: termType,
    catalog_role: catalogRole,
    confidence: "high" as const
  };
}

function buildEvidence(sources: SourceManifestLike[]): DataOsEvidenceRef[] {
  return sources.slice(0, 8).map((source) => ({
    source: source.name || source.kind || "new_study_form",
    excerpt: source.kind || source.mime_type || undefined,
    confidence: source.field_names?.length || source.row_count ? "high" : "medium"
  }));
}

function normalizeBehaviorRule(value: unknown): DataOsBehaviorRule | null {
  const record = asRecord(value);
  const field = clean(record?.field ?? record?.trait ?? record?.event, 120);
  if (!field) return null;
  return {
    field,
    operator: operator(record?.operator),
    value: primitive(record?.value),
    window_days: numberValue(record?.window_days),
    source: clean(record?.source, 120) || undefined
  };
}

function normalizeComputedTrait(value: unknown): { name: string; expression: string; window_days?: number } | null {
  const record = asRecord(value);
  const name = clean(record?.name, 120);
  const expression = clean(record?.expression, 260);
  if (!name || !expression) return null;
  return { name, expression, window_days: numberValue(record?.window_days) };
}

function inferDecisionType(label: string): DataOsDecisionSpec["decision_type"] {
  const normalized = normalize(label);
  if (/position|territorio|diferenc/.test(normalized)) return "positioning";
  if (/message|mensaje|comunic|value|valor|claim/.test(normalized)) return "messaging";
  if (/retention|retencion|recompra|crm|member|membres|lifecycle/.test(normalized)) return "retention";
  if (/product|producto|membership|membresia|experiencia|app/.test(normalized)) return "product";
  if (/media|search|demand|demanda|awareness|notoriedad/.test(normalized)) return "media";
  if (/price|precio|pricing|descuento|promo/.test(normalized)) return "pricing";
  if (/service|servicio|delivery|entrega|soporte|atencion/.test(normalized)) return "service";
  if (/commerce|ecommerce|e-commerce|funnel|conversion|checkout|carrito/.test(normalized)) return "commerce";
  if (/operation|operacion|recovery|recuperacion/.test(normalized)) return "operations";
  if (/kpi|metric|medicion|measurement/.test(normalized)) return "measurement";
  return "other";
}

function inferDecisionLever(label: string) {
  const type = inferDecisionType(label);
  return type === "other" ? "decision scope" : type.replace(/_/g, " ");
}

function inferGeoMarket(label: string) {
  const normalized = normalize(label);
  if (/cdmx|valle de mexico|mexico city/.test(normalized)) return "CDMX / Valle de Mexico";
  if (/mexico|mx|mexicano/.test(normalized)) return "Mexico";
  if (/bolivia|bo\b/.test(normalized)) return "Bolivia";
  return null;
}

function inferLifecycleStage(label: string) {
  const normalized = normalize(label);
  if (/primera compra|first order|nuevo|new owner|adopcion|prospect/.test(normalized)) return "first_purchase_or_prospect";
  if (/sin recompra|0 recompra|inactivo|inactive|churn|abandon/.test(normalized)) return "inactive_or_no_repurchase";
  if (/member|membres/.test(normalized)) return "member";
  if (/recurrente|retention|retencion|recompra/.test(normalized)) return "retention";
  return null;
}

function inferChannelAffinity(label: string) {
  const normalized = normalize(label);
  if (/app|web|ecommerce|e-commerce|digital/.test(normalized)) return "digital";
  if (/tienda|fisica|super|retail|walmart|costco|petco/.test(normalized)) return "retail";
  if (/marketplace|amazon|mercado libre/.test(normalized)) return "marketplace";
  return null;
}

function inferSpecies(label: string) {
  const normalized = normalize(label);
  if (/gato|cat|felin/.test(normalized)) return "cat";
  if (/perro|dog|canin|cachorro/.test(normalized)) return "dog";
  if (/pet|mascota/.test(normalized)) return "pet";
  return null;
}

function inferMembershipStatus(label: string) {
  const normalized = normalize(label);
  if (/member|membres/.test(normalized)) return /inactivo|sin recompra|0 recompra/.test(normalized) ? "inactive_member" : "member";
  return null;
}

function inferIntent(label: string) {
  const normalized = normalize(label);
  if (/premium|calidad|salud|health|veterin/.test(normalized)) return "quality_or_health";
  if (/ahorro|descuento|precio|promo/.test(normalized)) return "savings_or_promotion";
  if (/convenien|rapidez|entrega|delivery/.test(normalized)) return "convenience";
  if (/croqueta|alimento|food/.test(normalized)) return "food_replenishment";
  return null;
}

function inferBehaviorRules(label: string): DataOsBehaviorRule[] {
  const normalized = normalize(label);
  const rules: DataOsBehaviorRule[] = [];
  if (/sin recompra|0 recompra|no recurrente/.test(normalized)) {
    rules.push({ field: "repeat_purchase_count", operator: "equals", value: 0, source: "crm_or_sales" });
  }
  if (/90 dias|90 dias|90 days/.test(normalized)) {
    rules.push({ field: "days_since_last_purchase", operator: "gte", value: 90, source: "crm_or_sales" });
  }
  if (/member|membres/.test(normalized)) {
    rules.push({ field: "membership_status", operator: "equals", value: "member", source: "crm_or_membership" });
  }
  if (/app|web|ecommerce|e-commerce/.test(normalized)) {
    rules.push({ field: "channel_affinity", operator: "contains", value: "digital", source: "commerce_events" });
  }
  return rules;
}

function inferComputedTraits(label: string) {
  const normalized = normalize(label);
  const traits: Array<{ name: string; expression: string; window_days?: number }> = [];
  if (/recompra|retention|retencion/.test(normalized)) {
    traits.push({ name: "repeat_purchase_rate", expression: "repeat_purchasers / first_time_buyers", window_days: 90 });
  }
  if (/member|membres/.test(normalized)) {
    traits.push({ name: "member_repurchase_gap_days", expression: "days_between_membership_payment_and_next_order", window_days: 90 });
  }
  return traits;
}

function inferSignalTaxonomy(label: string, signalType: DataOsSignalSpec["signal_type"]) {
  const normalized = normalize(label);
  if (/precio|price|descuento|promo|ahorro/.test(normalized)) return "price_value";
  if (/confianza|trust|reputacion|review|resena/.test(normalized)) return "trust_reputation";
  if (/delivery|entrega|rapidez|stock|surtido/.test(normalized)) return "service_experience";
  if (/salud|health|veterin|ingrediente|calidad/.test(normalized)) return "quality_health";
  if (/member|membres|recompra|retencion|crm/.test(normalized)) return "retention_membership";
  if (/media|search|demanda|awareness|notoriedad/.test(normalized)) return "demand_capture";
  return signalType;
}

function inferMetric(label: string) {
  const normalized = normalize(label);
  if (/recompra|repeat|retention|retencion/.test(normalized)) return "repeat_purchase_rate";
  if (/conversion|funnel|carrito|checkout/.test(normalized)) return "conversion_rate";
  if (/awareness|notoriedad|search|demanda/.test(normalized)) return "category_demand_or_awareness";
  if (/sentiment|sentimiento|reputacion/.test(normalized)) return "sentiment_or_reputation";
  if (/share|cuota/.test(normalized)) return "share_metric";
  return clean(label, 120);
}

function inferTargetDirection(label: string): DataOsSuccessMetricSpec["target_direction"] {
  const normalized = normalize(label);
  if (/reduc|bajar|menos|decrease|drop/.test(normalized)) return "decrease";
  if (/aument|subir|crecer|increase|mayor|mas|más|\+/.test(normalized)) return "increase";
  if (/valid|confirm|probar|test/.test(normalized)) return "validate";
  return "discover";
}

function inferUnit(label: string) {
  if (/%|porcentaje|percent/.test(normalize(label))) return "percent";
  if (/\$|usd|mxn|monto|revenue|ventas/.test(normalize(label))) return "currency";
  return null;
}

function inferWindow(label: string) {
  const match = label.match(/\b\d+\s*(dias|days|meses|months|semanas|weeks)\b/i);
  return match?.[0] ?? null;
}

function extractTerms(label: string) {
  return unique(
    normalize(label)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 3 && !STOPWORDS.has(term))
  ).slice(0, 12);
}

function operator(value: unknown): DataOsBehaviorRule["operator"] {
  if (value === "exists" || value === "not_exists" || value === "equals" || value === "contains" || value === "gte" || value === "lte") {
    return value;
  }
  return "contains";
}

function targetDirection(value: unknown) {
  if (value === "increase" || value === "decrease" || value === "validate" || value === "discover") return value;
  return null;
}

function entityType(value: unknown) {
  if (value === "consumer" || value === "household" || value === "account" || value === "unknown") return value;
  return null;
}

function activationReadiness(value: unknown) {
  if (value === "rule_ready" || value === "requires_data" || value === "draft") return value;
  return null;
}

function confidence(value: unknown): DataOsConfidence {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isDecisionSpec(value: DataOsDecisionSpec | null): value is DataOsDecisionSpec {
  return Boolean(value);
}

function isAudienceSpec(value: DataOsAudienceSpec | null): value is DataOsAudienceSpec {
  return Boolean(value);
}

function isSignalSpec(value: DataOsSignalSpec | null): value is DataOsSignalSpec {
  return Boolean(value);
}

function isSuccessMetricSpec(value: DataOsSuccessMetricSpec | null): value is DataOsSuccessMetricSpec {
  return Boolean(value);
}

function isBehaviorRule(value: DataOsBehaviorRule | null): value is DataOsBehaviorRule {
  return Boolean(value);
}

function isComputedTrait(value: { name: string; expression: string; window_days?: number } | null): value is { name: string; expression: string; window_days?: number } {
  return Boolean(value);
}

function isContextSpec(
  value: StudyDataOsFieldSpecs["contexts"][number] | null
): value is StudyDataOsFieldSpecs["contexts"][number] {
  return Boolean(value);
}

function readStringArray(value: unknown): string[] {
  return readArray(value).map((item) => clean(item, 240)).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function primitive(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function mergeByKey<T extends { key: string }>(items: Array<T | null>) {
  return uniqueBy(items.filter((item): item is T => Boolean(item)), (item) => item.key).slice(0, 40);
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function stableKey(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "field";
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function clean(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

const STOPWORDS = new Set([
  "para",
  "como",
  "con",
  "sin",
  "que",
  "the",
  "and",
  "los",
  "las",
  "una",
  "uno",
  "del",
  "por",
  "mas",
  "menos",
  "brand",
  "marca",
  "study",
  "estudio"
]);
