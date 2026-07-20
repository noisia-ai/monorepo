import pg from "pg";

import { getDatabaseSslConfig, requireSafeDatabaseWriteTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

type CounterMap = Record<string, number>;

type CorpusRow = {
  id: string;
  name: string | null;
  brand_id: string | null;
  theme_id: string | null;
  organization_id: string | null;
  subject_name: string | null;
  methodology_slug: string;
  business_question: string | null;
  decision_to_inform: string | null;
  audience_segment: string | null;
  brand_seed_handles: string[] | null;
};

type KnowledgeSourceRow = {
  id: string;
  title: string;
  source_kind: string;
  raw_text: string | null;
  extracted_payload: unknown;
};

type MentionRow = {
  id: string;
  text_clean: string | null;
  text_snippet: string | null;
  title: string | null;
  source_system: string | null;
  platform: string | null;
  resolved_platform: string | null;
  content_type: string | null;
  inclusion_status: string | null;
  sentiment_score: string | number | null;
  quality_score: string | number | null;
  engagement: unknown;
};

type TaxonomySeed = {
  key: string;
  name: string;
  description: string;
  terms: Array<{ key: string; label: string; description?: string }>;
};

type BackfillContext = {
  client: pg.Client;
  counters: CounterMap;
  taxonomyIds: Map<string, string>;
  termIds: Map<string, string>;
  assetIds: Map<string, string>;
  taggingRuleSetId: string;
  modelVersionId: string;
};

type BrandOsBackfillRefs = {
  profileId: string;
  objectiveId: string | null;
  seedSetIds: string[];
};

type TagCandidate = {
  taxonomyKey: string;
  termKey: string;
  value: string;
  matched: string[];
  score: number;
  confidence: "low" | "medium" | "high";
};

const DATA_OS_CATALOG_VERSION = "cut_1";
const TAGGING_RULE_SET_KEY = "data_os_cut_1_deterministic_mentions";
const TAGGING_RULE_SET_VERSION = 1;

const BASE_TAXONOMIES: TaxonomySeed[] = [
  {
    key: "trigger",
    name: "Triggers",
    description: "Motivadores que acercan a una audiencia a una decision, marca o accion.",
    terms: [
      { key: "convenience", label: "Convenience" },
      { key: "trust", label: "Trust" },
      { key: "price_value", label: "Price/value" },
      { key: "safety", label: "Safety" },
      { key: "speed", label: "Speed" },
      { key: "identity", label: "Identity" },
      { key: "belonging", label: "Belonging" },
      { key: "clarity", label: "Clarity" }
    ]
  },
  {
    key: "barrier",
    name: "Barriers",
    description: "Fricciones que alejan a una audiencia de una decision, marca o accion.",
    terms: [
      { key: "price", label: "Price" },
      { key: "distrust", label: "Distrust" },
      { key: "confusion", label: "Confusion" },
      { key: "effort", label: "Effort" },
      { key: "availability", label: "Availability" },
      { key: "risk", label: "Risk" },
      { key: "poor_service", label: "Poor service" },
      { key: "stigma", label: "Stigma" }
    ]
  },
  {
    key: "journey_stage",
    name: "Journey stage",
    description: "Etapas observables del viaje de decision o experiencia.",
    terms: [
      { key: "awareness", label: "Awareness" },
      { key: "consideration", label: "Consideration" },
      { key: "conversion", label: "Conversion" },
      { key: "onboarding", label: "Onboarding" },
      { key: "usage", label: "Usage" },
      { key: "retention", label: "Retention" },
      { key: "advocacy", label: "Advocacy" },
      { key: "churn", label: "Churn" }
    ]
  },
  {
    key: "value_perception",
    name: "Value perception",
    description: "Dimensiones de valor/costo percibido.",
    terms: [
      { key: "monetary_cost", label: "Monetary cost" },
      { key: "time_cost", label: "Time cost" },
      { key: "effort_cost", label: "Effort cost" },
      { key: "functional_value", label: "Functional value" },
      { key: "emotional_value", label: "Emotional value" },
      { key: "social_value", label: "Social value" },
      { key: "trust_value", label: "Trust value" }
    ]
  },
  {
    key: "audience",
    name: "Audience",
    description: "Roles de audiencia utiles para lectura de inteligencia.",
    terms: [
      { key: "prospect", label: "Prospect" },
      { key: "customer", label: "Customer" },
      { key: "switcher", label: "Switcher" },
      { key: "loyalist", label: "Loyalist" },
      { key: "critic", label: "Critic" },
      { key: "creator", label: "Creator" },
      { key: "decision_maker", label: "Decision maker" }
    ]
  },
  {
    key: "demographic",
    name: "Demographic",
    description: "Marcadores demograficos solo cuando la fuente los trae o hay evidencia suficiente.",
    terms: [
      { key: "gen_z", label: "Gen Z" },
      { key: "millennial", label: "Millennial" },
      { key: "gen_x", label: "Gen X" },
      { key: "boomer", label: "Boomer" },
      { key: "family", label: "Family" },
      { key: "student", label: "Student" },
      { key: "professional", label: "Professional" },
      { key: "sme_owner", label: "SME owner" }
    ]
  },
  {
    key: "emotion",
    name: "Emotion",
    description: "Emociones dominantes detectadas o sintetizadas.",
    terms: [
      { key: "joy", label: "Joy" },
      { key: "anger", label: "Anger" },
      { key: "fear", label: "Fear" },
      { key: "sadness", label: "Sadness" },
      { key: "surprise", label: "Surprise" },
      { key: "disgust", label: "Disgust" },
      { key: "trust", label: "Trust" },
      { key: "anticipation", label: "Anticipation" },
      { key: "frustration", label: "Frustration" }
    ]
  },
  {
    key: "sentiment_polarity",
    name: "Sentiment polarity",
    description: "Polaridad normalizada para analisis y filtros.",
    terms: [
      { key: "positive", label: "Positive" },
      { key: "negative", label: "Negative" },
      { key: "neutral", label: "Neutral" },
      { key: "ambivalent", label: "Ambivalent" }
    ]
  },
  {
    key: "signal_lifecycle",
    name: "Signal lifecycle",
    description: "Estado temporal de una senal en una ventana.",
    terms: [
      { key: "new", label: "New" },
      { key: "emerging", label: "Emerging" },
      { key: "accelerating", label: "Accelerating" },
      { key: "mature", label: "Mature" },
      { key: "saturated", label: "Saturated" },
      { key: "peaking", label: "Peaking" },
      { key: "declining", label: "Declining" },
      { key: "dormant", label: "Dormant" },
      { key: "reactivated", label: "Reactivated" },
      { key: "volatile", label: "Volatile" }
    ]
  },
  {
    key: "marketing_move",
    name: "Marketing move",
    description: "Acciones recomendadas o monitoreadas por el sistema.",
    terms: [
      { key: "amplify", label: "Amplify" },
      { key: "test_claim", label: "Test claim" },
      { key: "create_content", label: "Create content" },
      { key: "adjust_paid", label: "Adjust paid" },
      { key: "brief_creators", label: "Brief creators" },
      { key: "avoid_territory", label: "Avoid territory" },
      { key: "defend_budget", label: "Defend budget" },
      { key: "activate_trend", label: "Activate trend" },
      { key: "contain_risk", label: "Contain risk" },
      { key: "monitor", label: "Monitor" }
    ]
  },
  {
    key: "source_type",
    name: "Source type",
    description: "Familias de fuentes que alimentan el lakehouse.",
    terms: [
      { key: "conversation", label: "Conversation" },
      { key: "performance", label: "Performance" },
      { key: "knowledge", label: "Knowledge" },
      { key: "entity", label: "Entity" },
      { key: "search", label: "Search" },
      { key: "reviews", label: "Reviews" },
      { key: "ecomm", label: "Ecomm" },
      { key: "sales", label: "Sales" }
    ]
  },
  {
    key: "content_format",
    name: "Content format",
    description: "Formato del registro o contenido.",
    terms: [
      { key: "post", label: "Post" },
      { key: "comment", label: "Comment" },
      { key: "review", label: "Review" },
      { key: "video", label: "Video" },
      { key: "story", label: "Story" },
      { key: "ad", label: "Ad" },
      { key: "article", label: "Article" },
      { key: "search_query", label: "Search query" }
    ]
  },
  {
    key: "competitor_role",
    name: "Competitor role",
    description: "Tipo de relacion competitiva.",
    terms: [
      { key: "direct", label: "Direct" },
      { key: "indirect", label: "Indirect" },
      { key: "benchmark", label: "Benchmark" },
      { key: "substitute", label: "Substitute" },
      { key: "category_leader", label: "Category leader" },
      { key: "challenger", label: "Challenger" }
    ]
  }
];

const TAXONOMY_BINDINGS = [
  ["signal-pulse", "trigger", "filter", false],
  ["signal-pulse", "barrier", "filter", false],
  ["signal-pulse", "journey_stage", "filter", false],
  ["signal-pulse", "value_perception", "filter", false],
  ["signal-pulse", "audience", "filter", false],
  ["signal-pulse", "demographic", "filter", false],
  ["signal-pulse", "signal_lifecycle", "metric_dimension", true],
  ["signal-pulse", "marketing_move", "output", true],
  ["signal-pulse", "source_type", "filter", true],
  ["triggers-barriers", "trigger", "output", true],
  ["triggers-barriers", "barrier", "output", true],
  ["value-perception-matrix", "value_perception", "output", true],
  ["journey-friction-mapping", "journey_stage", "output", true],
  ["audience-segment-lens", "audience", "output", true]
] as const;

const ASSET_DEFINITIONS = [
  {
    name: "mentions",
    layer: "silver",
    assetKind: "table",
    description: "Normalized corpus mentions.",
    tableName: "mentions"
  },
  {
    name: "data_sources",
    layer: "bronze",
    assetKind: "table",
    description: "Registered source connectors/uploads.",
    tableName: "data_sources"
  },
  {
    name: "performance_records",
    layer: "silver",
    assetKind: "table",
    description: "Structured social/performance records.",
    tableName: "performance_records"
  },
  {
    name: "brand_knowledge_sources",
    layer: "bronze",
    assetKind: "table",
    description: "Uploaded/derived knowledge sources.",
    tableName: "brand_knowledge_sources"
  },
  {
    name: "brand_os_briefs",
    layer: "silver",
    assetKind: "table",
    description: "Structured Brand OS intake and client brief catalog.",
    tableName: "brand_os_briefs"
  },
  {
    name: "knowledge_chunks",
    layer: "silver",
    assetKind: "table",
    description: "Chunked knowledge text for retrieval and assertions.",
    tableName: "knowledge_chunks"
  },
  {
    name: "canonical_signals",
    layer: "gold",
    assetKind: "table",
    description: "Persistent canonical signals.",
    tableName: "canonical_signals"
  },
  {
    name: "signal_period_metrics",
    layer: "gold",
    assetKind: "table",
    description: "Signal metrics by report period.",
    tableName: "signal_period_metrics"
  },
  {
    name: "chart_aggregates",
    layer: "serving",
    assetKind: "table",
    description: "Precomputed chart payloads.",
    tableName: "chart_aggregates"
  },
  {
    name: "published_outputs",
    layer: "serving",
    assetKind: "table",
    description: "Published client-safe snapshots and fallback payloads.",
    tableName: "published_outputs"
  },
  {
    name: "tagging_rule_sets",
    layer: "gold",
    assetKind: "table",
    description: "Versioned deterministic and model-assisted tagging rule catalogs.",
    tableName: "tagging_rule_sets"
  }
] as const;

type AssetFieldSpec = {
  name: string;
  type: string;
  semanticType: string;
  nullable: boolean;
  description: string;
  examples?: unknown[];
};

const ASSET_FIELD_DEFINITIONS: Record<string, AssetFieldSpec[]> = {
  mentions: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Internal mention id." },
    { name: "study_corpus_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Owning corpus." },
    { name: "external_id", type: "text", semanticType: "source_identifier", nullable: true, description: "Provider/source record id." },
    { name: "text_clean", type: "text", semanticType: "content", nullable: false, description: "Normalized mention text." },
    { name: "published_at", type: "timestamptz", semanticType: "event_time", nullable: true, description: "Publication timestamp." },
    { name: "platform", type: "text", semanticType: "dimension", nullable: true, description: "Source platform." },
    { name: "inclusion_status", type: "text", semanticType: "quality_state", nullable: false, description: "Corpus inclusion status." },
    { name: "sentiment_score", type: "numeric", semanticType: "measure", nullable: true, description: "Normalized sentiment score when available." }
  ],
  data_sources: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Data source id." },
    { name: "study_corpus_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Owning corpus." },
    { name: "source_type", type: "text", semanticType: "source_type", nullable: false, description: "Source family." },
    { name: "provider", type: "text", semanticType: "provider", nullable: true, description: "External provider or system." },
    { name: "connection_method", type: "text", semanticType: "ingestion_method", nullable: true, description: "Upload/connector/manual method." },
    { name: "status", type: "text", semanticType: "operational_status", nullable: false, description: "Current source status." }
  ],
  performance_records: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Performance record id." },
    { name: "data_source_id", type: "uuid", semanticType: "foreign_key", nullable: true, description: "Originating data source." },
    { name: "entity_kind", type: "text", semanticType: "entity_type", nullable: false, description: "Campaign/ad/adset/post/account grain." },
    { name: "platform", type: "text", semanticType: "dimension", nullable: true, description: "Paid/organic platform." },
    { name: "record_date", type: "date", semanticType: "event_date", nullable: false, description: "Metric date." },
    { name: "spend", type: "numeric", semanticType: "measure", nullable: true, description: "Media spend." },
    { name: "impressions", type: "numeric", semanticType: "measure", nullable: true, description: "Impressions." },
    { name: "engagement", type: "numeric", semanticType: "measure", nullable: true, description: "Engagement count." }
  ],
  brand_knowledge_sources: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Knowledge source id." },
    { name: "brand_id", type: "uuid", semanticType: "foreign_key", nullable: true, description: "Associated brand." },
    { name: "study_corpus_id", type: "uuid", semanticType: "foreign_key", nullable: true, description: "Associated corpus." },
    { name: "source_kind", type: "text", semanticType: "source_type", nullable: false, description: "Brief, deck, upload or extracted source kind." },
    { name: "title", type: "text", semanticType: "label", nullable: false, description: "Knowledge source title." },
    { name: "status", type: "text", semanticType: "processing_status", nullable: false, description: "Processing status." }
  ],
  brand_os_briefs: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Brand OS brief id." },
    { name: "brand_os_profile_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Owning Brand OS profile." },
    { name: "study_corpus_id", type: "uuid", semanticType: "foreign_key", nullable: true, description: "Study/corpus this brief frames." },
    { name: "objective_id", type: "uuid", semanticType: "foreign_key", nullable: true, description: "Objective the brief supports." },
    { name: "knowledge_source_id", type: "uuid", semanticType: "foreign_key", nullable: true, description: "Original knowledge source when the brief came from an upload." },
    { name: "brief_type", type: "text", semanticType: "classification", nullable: false, description: "Study intake, marketing brief, campaign brief or related intake type." },
    { name: "title", type: "text", semanticType: "label", nullable: false, description: "Human-readable brief title." },
    { name: "summary", type: "text", semanticType: "content", nullable: true, description: "Short structured summary of what the brief asks or constrains." },
    { name: "source_kind", type: "text", semanticType: "source_type", nullable: true, description: "Original knowledge source kind." },
    { name: "status", type: "text", semanticType: "operational_status", nullable: false, description: "Active/superseded/draft status." }
  ],
  knowledge_chunks: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Knowledge chunk id." },
    { name: "knowledge_source_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Source document/upload." },
    { name: "chunk_index", type: "integer", semanticType: "sequence", nullable: false, description: "Chunk order inside source." },
    { name: "chunk_text", type: "text", semanticType: "content", nullable: false, description: "Chunk text." },
    { name: "embedding_status", type: "text", semanticType: "processing_status", nullable: false, description: "Embedding lifecycle." }
  ],
  canonical_signals: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Canonical signal id." },
    { name: "study_corpus_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Owning corpus." },
    { name: "methodology_slug", type: "text", semanticType: "methodology", nullable: false, description: "Methodology that owns the signal." },
    { name: "signal_type", type: "text", semanticType: "classification", nullable: false, description: "Opportunity, risk or related signal type." },
    { name: "canonical_title", type: "text", semanticType: "label", nullable: false, description: "Stable human-readable signal name." },
    { name: "semantic_key", type: "text", semanticType: "semantic_identifier", nullable: false, description: "Stable semantic key." },
    { name: "status", type: "text", semanticType: "operational_status", nullable: false, description: "Signal lifecycle status." }
  ],
  signal_period_metrics: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Metric row id." },
    { name: "canonical_signal_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Measured signal." },
    { name: "period_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Report period." },
    { name: "volume", type: "integer", semanticType: "measure", nullable: true, description: "Signal mention volume." },
    { name: "impact_v1", type: "numeric", semanticType: "measure", nullable: true, description: "Noisia impact score." },
    { name: "sentiment_score", type: "numeric", semanticType: "measure", nullable: true, description: "Aggregated sentiment." },
    { name: "lifecycle_state", type: "text", semanticType: "classification", nullable: true, description: "Signal lifecycle for this period." }
  ],
  chart_aggregates: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Chart aggregate id." },
    { name: "study_corpus_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Owning corpus." },
    { name: "chart_key", type: "text", semanticType: "chart_identifier", nullable: false, description: "Chart/data ref key." },
    { name: "period_id", type: "uuid", semanticType: "foreign_key", nullable: true, description: "Optional report period." },
    { name: "filters_hash", type: "text", semanticType: "materialization_key", nullable: false, description: "Stable filter hash." },
    { name: "payload", type: "jsonb", semanticType: "serving_payload", nullable: false, description: "Precomputed chart data." }
  ],
  published_outputs: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Published output id." },
    { name: "study_corpus_id", type: "uuid", semanticType: "foreign_key", nullable: false, description: "Owning corpus." },
    { name: "kind", type: "text", semanticType: "output_kind", nullable: false, description: "Signal Pulse vs legacy output kind." },
    { name: "status", type: "text", semanticType: "publish_status", nullable: false, description: "Draft/ready/published status." },
    { name: "manifest", type: "jsonb", semanticType: "output_manifest", nullable: false, description: "Rendering manifest." },
    { name: "payload", type: "jsonb", semanticType: "snapshot_payload", nullable: false, description: "Client-safe fallback snapshot." }
  ],
  tagging_rule_sets: [
    { name: "id", type: "uuid", semanticType: "primary_key", nullable: false, description: "Tagging rule set id." },
    { name: "rule_set_key", type: "text", semanticType: "semantic_identifier", nullable: false, description: "Stable rule set key." },
    { name: "version", type: "integer", semanticType: "version", nullable: false, description: "Rule set version." },
    { name: "subject_type", type: "text", semanticType: "record_subject", nullable: false, description: "Record type this rule set tags." },
    { name: "rules", type: "jsonb", semanticType: "tagging_rules", nullable: false, description: "Versioned deterministic rules and derivations." },
    { name: "status", type: "text", semanticType: "operational_status", nullable: false, description: "Active/draft/deprecated state." }
  ]
};

const MENTION_TAG_RULES: Record<string, Record<string, string[]>> = {
  trigger: {
    convenience: ["conveniente", "facil", "facil de entender", "simple", "movil", "sin friccion"],
    trust: ["confianza", "confiable", "datos reales", "transparente", "seguro", "seguridad", "garantia"],
    price_value: ["valor", "precio justo", "promesa de valor", "beneficio", "vale la pena"],
    safety: ["seguro", "seguridad", "proteccion", "riesgo bajo"],
    speed: ["rapido", "rapidez", "agil", "veloz", "sin espera"],
    identity: ["identidad", "me representa", "mi estilo"],
    belonging: ["comunidad", "pertenencia", "grupo"],
    clarity: ["claro", "clara", "claridad", "entender", "explicar", "sin letra chica"]
  },
  barrier: {
    price: ["precio", "caro", "costoso", "costo", "muy caro"],
    distrust: ["desconfianza", "no confio", "falso", "enganoso", "promesa falsa"],
    confusion: ["confusion", "confuso", "no entiendo", "letra chica", "ruido"],
    effort: ["complicado", "dificil", "friccion", "muchos pasos", "esfuerzo"],
    availability: ["no hay", "agotado", "disponibilidad", "no disponible"],
    risk: ["riesgo", "miedo", "inseguro", "fraude"],
    poor_service: ["soporte", "servicio malo", "mala atencion", "atencion", "reclamo"],
    stigma: ["verguenza", "pena", "estigma"]
  },
  journey_stage: {
    awareness: ["descubrir", "descubri", "conocer", "primera vez", "me entere"],
    consideration: ["considero", "comparar", "opciones", "alternativa", "pide"],
    conversion: ["comprar", "contratar", "activar", "activacion", "registro", "pagar"],
    onboarding: ["onboarding", "empezar", "primer uso", "configurar"],
    usage: ["uso", "usar", "experiencia", "app", "movil", "funciona"],
    retention: ["seguir", "renovar", "mantener", "me quedo"],
    advocacy: ["recomiendo", "lo recomiendo", "amo", "me encanta"],
    churn: ["cancelar", "dejar", "me voy", "cambiarme"]
  },
  value_perception: {
    monetary_cost: ["precio", "costo", "caro", "barato", "dinero"],
    time_cost: ["tiempo", "espera", "tarde", "lento"],
    effort_cost: ["esfuerzo", "complicado", "dificil", "friccion", "letra chica"],
    functional_value: ["funciona", "datos", "util", "resuelve", "facil de entender"],
    emotional_value: ["frustracion", "tranquilidad", "miedo", "confianza", "enojo"],
    social_value: ["comunidad", "estatus", "pertenencia", "social"],
    trust_value: ["confianza", "datos reales", "transparente", "seguro", "claridad"]
  },
  audience: {
    prospect: ["interesado", "quiero comprar", "considero", "opciones"],
    customer: ["cliente", "uso", "experiencia", "soporte", "app"],
    switcher: ["cambiar", "cambiarme", "alternativa", "comparar"],
    loyalist: ["siempre", "me quedo", "lo recomiendo", "amo"],
    critic: ["frustracion", "malo", "reclamo", "no sirve", "odio"],
    creator: ["creador", "contenido", "video", "post"],
    decision_maker: ["decision", "presupuesto", "comprar", "contratar"]
  },
  demographic: {
    gen_z: ["gen z", "centennial", "jovenes", "joven", "18-24"],
    millennial: ["millennial", "millennials", "25-34"],
    gen_x: ["gen x", "35-44", "45-54"],
    boomer: ["boomer", "boomers", "55+"],
    family: ["familia", "familias", "papas", "mamas", "hijos"],
    student: ["estudiante", "estudiantes", "universidad", "universitarios"],
    professional: ["profesional", "profesionales", "trabajo", "oficina"],
    sme_owner: ["pyme", "emprendedor", "emprendedores", "dueno de negocio", "dueño de negocio"]
  },
  emotion: {
    joy: ["feliz", "me encanta", "amo"],
    anger: ["enojo", "molesto", "odio"],
    fear: ["miedo", "riesgo", "inseguro"],
    sadness: ["triste", "decepcion"],
    surprise: ["sorpresa", "wow"],
    disgust: ["asco", "pesimo"],
    trust: ["confianza", "seguro", "confiable"],
    anticipation: ["espero", "ojala", "quiero"],
    frustration: ["frustracion", "frustra", "complicado", "reclamo"]
  }
};

const CONTENT_FORMAT_BY_TYPE: Record<string, string> = {
  post: "post",
  comment: "comment",
  review: "review",
  video: "video",
  story: "story",
  ad: "ad",
  article: "article",
  search_query: "search_query"
};

function inc(counters: CounterMap, key: string, amount = 1) {
  counters[key] = (counters[key] ?? 0) + amount;
}

function assetKey(name: string) {
  return name;
}

function requireBackfillEnabled() {
  if (process.env.NOISIA_DATA_OS_BACKFILL_ENABLED === "true") {
    return;
  }

  throw new Error(
    "Refusing to run data-os:backfill while NOISIA_DATA_OS_BACKFILL_ENABLED is not true."
  );
}

function json(value: unknown) {
  return JSON.stringify(value ?? {});
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactText(value: string, maxLength = 500) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function numberMaybe(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function payloadToText(value: unknown, maxItems = 80): string {
  const strings: string[] = [];

  function visit(input: unknown) {
    if (strings.length >= maxItems) return;
    if (typeof input === "string") {
      const text = input.trim();
      if (text) strings.push(text);
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }
    if (input && typeof input === "object") {
      for (const nested of Object.values(input as Record<string, unknown>)) visit(nested);
    }
  }

  visit(value);
  return strings.join("\n");
}

function chunkText(text: string, maxChars = 1800) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [text]) {
    if (paragraph.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < paragraph.length; index += maxChars) {
        chunks.push(paragraph.slice(index, index + maxChars));
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks.slice(0, 200);
}

function extractAssertions(payload: unknown) {
  const record = asRecord(payload);
  const candidates: Array<{ assertionType: string; text: string }> = [];

  const addString = (assertionType: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      candidates.push({ assertionType, text: compactText(value) });
    }
  };
  const addArray = (assertionType: string, value: unknown) => {
    for (const item of asStringArray(value)) {
      candidates.push({ assertionType, text: compactText(item) });
    }
  };

  addString("summary", record.summary);
  addString("file_understanding", record.file_understanding);
  addString("time_coverage", record.time_coverage);
  addArray("dataset_inventory", record.dataset_inventory);
  addArray("audience_context", record.audience_clues);
  addArray("brand_claim", record.brand_claims);
  addArray("competitor_context", record.competitor_clues);
  addArray("content_or_channel_insight", record.content_or_channel_insights);
  addArray("trigger_hypothesis", record.potential_triggers);
  addArray("barrier_hypothesis", record.potential_barriers);
  addArray("query_language", record.query_language);
  addArray("limitation", record.limitations);

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.assertionType}:${candidate.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}

function findMatchedKeywords(normalizedTextValue: string, keywords: string[]) {
  return keywords.filter((keyword) => normalizedTextValue.includes(normalizeText(keyword)));
}

function textRuleCandidates(text: string): TagCandidate[] {
  const normalized = normalizeText(text);
  const candidates: TagCandidate[] = [];

  for (const [taxonomyKey, terms] of Object.entries(MENTION_TAG_RULES)) {
    for (const [termKey, keywords] of Object.entries(terms)) {
      const matched = findMatchedKeywords(normalized, keywords);
      if (matched.length === 0) continue;
      candidates.push({
        taxonomyKey,
        termKey,
        value: termKey,
        matched,
        score: Math.min(1, 0.4 + matched.length * 0.15),
        confidence: matched.length >= 3 ? "medium" : "low"
      });
    }
  }

  return candidates;
}

function sentimentCandidate(mention: MentionRow): TagCandidate | null {
  const sentimentScore = numberMaybe(mention.sentiment_score);
  if (sentimentScore === null) return null;
  const termKey = sentimentScore > 0.1 ? "positive" : sentimentScore < -0.1 ? "negative" : "neutral";
  return {
    taxonomyKey: "sentiment_polarity",
    termKey,
    value: termKey,
    matched: [`sentiment_score:${sentimentScore}`],
    score: Math.min(1, Math.max(0, Math.abs(sentimentScore))),
    confidence: "high"
  };
}

function sourceTypeCandidate(mention: MentionRow): TagCandidate {
  const source = normalizeKey([mention.source_system, mention.content_type].filter(Boolean).join("_"));
  const termKey = source.includes("review")
    ? "reviews"
    : source.includes("search")
      ? "search"
      : "conversation";
  return {
    taxonomyKey: "source_type",
    termKey,
    value: termKey,
    matched: [source || "mention"],
    score: 1,
    confidence: "high"
  };
}

function contentFormatCandidate(mention: MentionRow): TagCandidate | null {
  const normalizedType = normalizeKey(mention.content_type ?? "");
  const termKey = CONTENT_FORMAT_BY_TYPE[normalizedType];
  if (!termKey) return null;
  return {
    taxonomyKey: "content_format",
    termKey,
    value: termKey,
    matched: [normalizedType],
    score: 1,
    confidence: "high"
  };
}

function isBriefLikeSourceKind(sourceKind: string) {
  const normalized = normalizeKey(sourceKind);
  return normalized.includes("brief") || normalized.includes("intake");
}

function buildMentionTagCandidates(mention: MentionRow) {
  const text = [mention.title, mention.text_clean, mention.text_snippet].filter(Boolean).join("\n");
  const candidates = [
    ...textRuleCandidates(text),
    sentimentCandidate(mention),
    sourceTypeCandidate(mention),
    contentFormatCandidate(mention)
  ].filter((candidate): candidate is TagCandidate => Boolean(candidate));

  const deduped = new Map<string, TagCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.taxonomyKey}:${candidate.termKey}`;
    const existing = deduped.get(key);
    if (!existing || candidate.score > existing.score || candidate.matched.length > existing.matched.length) {
      deduped.set(key, candidate);
    }
  }
  return [...deduped.values()];
}

function groupCandidateTagsByTaxonomy(candidates: TagCandidate[]) {
  return candidates.reduce<Record<string, string[]>>((acc, candidate) => {
    acc[candidate.taxonomyKey] = [...(acc[candidate.taxonomyKey] ?? []), candidate.termKey];
    return acc;
  }, {});
}

async function queryOne<T extends Record<string, unknown>>(client: pg.Client, text: string, values: unknown[]) {
  const result = await client.query<T>(text, values);
  const row = result.rows[0];
  if (!row) throw new Error(`Expected row from query: ${text.slice(0, 80)}`);
  return row;
}

async function scalarNumber(client: pg.Client, text: string, values: unknown[]) {
  const row = await queryOne<{ count: string }>(client, text, values);
  return Number(row.count ?? "0");
}

async function upsertLineageEdge(
  ctx: BackfillContext,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relationType: string,
  metadata: Record<string, unknown>
) {
  await ctx.client.query(
    `
      INSERT INTO lineage_edges (
        source_type, source_id, target_type, target_id, relation_type, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation DO UPDATE SET
        metadata = lineage_edges.metadata || EXCLUDED.metadata
    `,
    [sourceType, sourceId, targetType, targetId, relationType, json(metadata)]
  );
  inc(ctx.counters, "lineage_edges_seen");
  inc(ctx.counters, `lineage_${sourceType}_to_${targetType}_seen`);
}

async function upsertBrandOsLink(
  ctx: BackfillContext,
  profileId: string,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relationType: string,
  metadata: Record<string, unknown>
) {
  await ctx.client.query(
    `
      INSERT INTO brand_os_links (
        brand_os_profile_id, source_type, source_id, target_type, target_id,
        relation_type, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT ON CONSTRAINT uq_brand_os_links_relation DO UPDATE SET
        brand_os_profile_id = EXCLUDED.brand_os_profile_id,
        metadata = brand_os_links.metadata || EXCLUDED.metadata
    `,
    [profileId, sourceType, sourceId, targetType, targetId, relationType, json(metadata)]
  );
  inc(ctx.counters, "brand_os_links_seen");
  inc(ctx.counters, `brand_os_links_${sourceType}_to_${targetType}_seen`);
}

async function upsertKnowledgeAssertionLink(
  ctx: BackfillContext,
  assertionId: string,
  targetType: string,
  targetId: string,
  relationType: string,
  metadata: Record<string, unknown>
) {
  await ctx.client.query(
    `
      INSERT INTO knowledge_assertion_links (
        knowledge_assertion_id, target_type, target_id, relation_type, metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT ON CONSTRAINT uq_knowledge_assertion_links_relation DO UPDATE SET
        metadata = knowledge_assertion_links.metadata || EXCLUDED.metadata
    `,
    [assertionId, targetType, targetId, relationType, json(metadata)]
  );
  inc(ctx.counters, "knowledge_assertion_links_seen");
  inc(ctx.counters, `knowledge_assertion_links_to_${targetType}_seen`);
}

async function upsertBrandOsBrief(
  ctx: BackfillContext,
  values: {
    brandOsProfileId: string;
    briefType: string;
    knowledgeSourceId?: string | null;
    metadata: Record<string, unknown>;
    objectiveId?: string | null;
    sourceKind?: string | null;
    studyCorpusId: string;
    summary?: string | null;
    title: string;
  }
) {
  const row = await queryOne<{ id: string }>(
    ctx.client,
    `
      INSERT INTO brand_os_briefs (
        brand_os_profile_id, study_corpus_id, objective_id, knowledge_source_id,
        brief_type, title, summary, source_kind, status, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9::jsonb)
      ON CONFLICT ON CONSTRAINT uq_brand_os_briefs_profile_corpus_type_title DO UPDATE SET
        objective_id = COALESCE(EXCLUDED.objective_id, brand_os_briefs.objective_id),
        knowledge_source_id = COALESCE(EXCLUDED.knowledge_source_id, brand_os_briefs.knowledge_source_id),
        summary = COALESCE(EXCLUDED.summary, brand_os_briefs.summary),
        source_kind = COALESCE(EXCLUDED.source_kind, brand_os_briefs.source_kind),
        status = EXCLUDED.status,
        metadata = brand_os_briefs.metadata || EXCLUDED.metadata,
        updated_at = now()
      RETURNING id
    `,
    [
      values.brandOsProfileId,
      values.studyCorpusId,
      values.objectiveId ?? null,
      values.knowledgeSourceId ?? null,
      values.briefType,
      values.title,
      values.summary ?? null,
      values.sourceKind ?? null,
      json(values.metadata)
    ]
  );
  inc(ctx.counters, "brand_os_briefs_seen");
  inc(ctx.counters, `brand_os_briefs_${values.briefType}_seen`);
  return row.id;
}

async function insertKnowledgeUsageEvent(
  ctx: BackfillContext,
  values: {
    knowledgeSourceId: string | null;
    knowledgeChunkId?: string | null;
    knowledgeAssertionId?: string | null;
    usageType: string;
    metadata: Record<string, unknown>;
  }
) {
  await ctx.client.query(
    `
      INSERT INTO knowledge_usage_events (
        knowledge_source_id, knowledge_chunk_id, knowledge_assertion_id, usage_type, metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      values.knowledgeSourceId,
      values.knowledgeChunkId ?? null,
      values.knowledgeAssertionId ?? null,
      values.usageType,
      json(values.metadata)
    ]
  );
  inc(ctx.counters, "knowledge_usage_events_seen");
}

async function seedTaxonomies(ctx: BackfillContext) {
  for (const taxonomy of BASE_TAXONOMIES) {
    const row = await queryOne<{ id: string }>(
      ctx.client,
      `
        INSERT INTO taxonomies (taxonomy_key, name, description, scope, status)
        VALUES ($1, $2, $3, 'global', 'active')
        ON CONFLICT (taxonomy_key) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status
        RETURNING id
      `,
      [taxonomy.key, taxonomy.name, taxonomy.description]
    );
    ctx.taxonomyIds.set(taxonomy.key, row.id);
    inc(ctx.counters, "taxonomies_seen");

    for (const [index, term] of taxonomy.terms.entries()) {
      const termRow = await queryOne<{ id: string }>(
        ctx.client,
        `
          INSERT INTO taxonomy_terms (
            taxonomy_id, term_key, label, description, sort_order, status
          )
          VALUES ($1, $2, $3, $4, $5, 'active')
          ON CONFLICT ON CONSTRAINT uq_taxonomy_terms_taxonomy_key DO UPDATE SET
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            sort_order = EXCLUDED.sort_order,
            status = EXCLUDED.status
          RETURNING id
        `,
        [row.id, term.key, term.label, term.description ?? null, index + 1]
      );
      ctx.termIds.set(`${taxonomy.key}:${term.key}`, termRow.id);
      inc(ctx.counters, "taxonomy_terms_seen");
    }
  }

  for (const [methodologySlug, taxonomyKey, role, required] of TAXONOMY_BINDINGS) {
    const taxonomyId = ctx.taxonomyIds.get(taxonomyKey);
    if (!taxonomyId) continue;
    await ctx.client.query(
      `
        INSERT INTO methodology_taxonomy_bindings (
          methodology_slug, taxonomy_id, role, required, metadata
        )
        VALUES ($1, $2, $3, $4, '{}'::jsonb)
        ON CONFLICT ON CONSTRAINT uq_methodology_taxonomy_bindings_role DO UPDATE SET
          required = EXCLUDED.required,
          metadata = EXCLUDED.metadata
      `,
      [methodologySlug, taxonomyId, role, required]
    );
    inc(ctx.counters, "methodology_taxonomy_bindings_seen");
  }
}

async function ensureTaggingRuleSet(ctx: BackfillContext) {
  const triggerTaxonomyId = ctx.taxonomyIds.get("trigger") ?? null;
  const row = await queryOne<{ id: string }>(
    ctx.client,
    `
      INSERT INTO tagging_rule_sets (
        rule_set_key, version, methodology_slug, subject_type, scope,
        taxonomy_id, rules, status, metadata
      )
      VALUES ($1, $2, NULL, 'mention', 'global', $3, $4::jsonb, 'active', $5::jsonb)
      ON CONFLICT ON CONSTRAINT uq_tagging_rule_sets_key_version DO UPDATE SET
        methodology_slug = EXCLUDED.methodology_slug,
        subject_type = EXCLUDED.subject_type,
        scope = EXCLUDED.scope,
        taxonomy_id = EXCLUDED.taxonomy_id,
        rules = EXCLUDED.rules,
        status = EXCLUDED.status,
        metadata = tagging_rule_sets.metadata || EXCLUDED.metadata,
        updated_at = now()
      RETURNING id
    `,
    [
      TAGGING_RULE_SET_KEY,
      TAGGING_RULE_SET_VERSION,
      triggerTaxonomyId,
      json({
        catalog_version: DATA_OS_CATALOG_VERSION,
        deterministic: true,
        text_keyword_rules: MENTION_TAG_RULES,
        derived_field_rules: {
          sentiment_polarity: {
            source_field: "mentions.sentiment_score",
            thresholds: { positive_gt: 0.1, negative_lt: -0.1, otherwise: "neutral" }
          },
          source_type: {
            source_fields: ["mentions.source_system", "mentions.content_type"],
            rules: [
              { contains: "review", term_key: "reviews" },
              { contains: "search", term_key: "search" },
              { default: true, term_key: "conversation" }
            ]
          },
          content_format: {
            source_field: "mentions.content_type",
            mapping: CONTENT_FORMAT_BY_TYPE
          }
        },
        confidence_policy: {
          text_keywords: "low_by_default_medium_after_3_matches",
          derived_fields: "high_when_source_field_present"
        }
      }),
      json({
        source: "data_os_backfill",
        catalog_version: DATA_OS_CATALOG_VERSION,
        automatic_llm_enrichment: false,
        review_status: "unreviewed_until_human_or_eval_review"
      })
    ]
  );
  inc(ctx.counters, "tagging_rule_sets_seen");
  return row.id;
}

async function ensureModelVersion(client: pg.Client, taggingRuleSetId: string) {
  const row = await queryOne<{ id: string }>(
    client,
    `
      INSERT INTO tagging_model_versions (
        model_key, provider, version, methodology_slug, tagging_rule_set_id, prompt_hash, metadata
      )
      VALUES ('data_os_backfill', 'system', 'v1', NULL, $1, NULL, $2::jsonb)
      ON CONFLICT ON CONSTRAINT uq_tagging_model_versions_key_version DO UPDATE SET
        tagging_rule_set_id = EXCLUDED.tagging_rule_set_id,
        metadata = EXCLUDED.metadata
      RETURNING id
    `,
    [
      taggingRuleSetId,
      json({
        deterministic: true,
        rule_set_key: TAGGING_RULE_SET_KEY,
        rule_set_version: TAGGING_RULE_SET_VERSION,
        catalog_version: DATA_OS_CATALOG_VERSION
      })
    ]
  );
  return row.id;
}

async function loadCorpora(client: pg.Client, corpusId: string | null) {
  const result = await client.query<CorpusRow>(
    `
      SELECT
        sc.id,
        sc.name,
        sc.brand_id,
        sc.theme_id,
        COALESCE(b.organization_id, t.organization_id) AS organization_id,
        COALESCE(b.name, t.name, sc.name) AS subject_name,
        m.slug AS methodology_slug,
        sc.business_question,
        sc.decision_to_inform,
        sc.audience_segment,
        b.brand_seed_handles
      FROM study_corpora sc
      JOIN methodologies m ON m.id = sc.methodology_id
      LEFT JOIN brands b ON b.id = sc.brand_id
      LEFT JOIN themes t ON t.id = sc.theme_id
      WHERE ($1::uuid IS NULL OR sc.id = $1::uuid)
      ORDER BY sc.created_at
    `,
    [corpusId]
  );
  return result.rows;
}

async function ensureBrandOs(ctx: BackfillContext, corpus: CorpusRow): Promise<BrandOsBackfillRefs> {
  const profileName = `${corpus.subject_name ?? corpus.name ?? "Noisia"} Brand OS`;
  const profileRow = corpus.brand_id
    ? await queryOne<{ id: string }>(
        ctx.client,
        `
          INSERT INTO brand_os_profiles (
            organization_id, brand_id, theme_id, name, status, version, metadata
          )
          VALUES ($1, $2, NULL, $3, 'active', 1, $4::jsonb)
          ON CONFLICT ("brand_id", "version") WHERE "brand_id" IS NOT NULL DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            metadata = brand_os_profiles.metadata || EXCLUDED.metadata,
            updated_at = now()
          RETURNING id
        `,
        [
          corpus.organization_id,
          corpus.brand_id,
          profileName,
          json({ source: "data_os_backfill", corpus_id: corpus.id })
        ]
      )
    : await queryOne<{ id: string }>(
        ctx.client,
        `
          INSERT INTO brand_os_profiles (
            organization_id, brand_id, theme_id, name, status, version, metadata
          )
          VALUES ($1, NULL, $2, $3, 'active', 1, $4::jsonb)
          ON CONFLICT ("theme_id", "version") WHERE "theme_id" IS NOT NULL DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            metadata = brand_os_profiles.metadata || EXCLUDED.metadata,
            updated_at = now()
          RETURNING id
        `,
        [
          corpus.organization_id,
          corpus.theme_id,
          profileName,
          json({ source: "data_os_backfill", corpus_id: corpus.id })
        ]
      );
  inc(ctx.counters, "brand_os_profiles_seen");

  const objectiveDescription = [
    corpus.business_question ? `Business question: ${corpus.business_question}` : null,
    corpus.decision_to_inform ? `Decision to inform: ${corpus.decision_to_inform}` : null,
    corpus.audience_segment ? `Audience segment: ${corpus.audience_segment}` : null
  ].filter(Boolean).join("\n");

  let objectiveId: string | null = null;
  if (objectiveDescription) {
    const objectiveRow = await queryOne<{ id: string }>(
      ctx.client,
      `
        INSERT INTO brand_os_objectives (
          brand_os_profile_id, objective_type, name, description, success_criteria, priority, status
        )
        VALUES ($1, 'research', $2, $3, $4::jsonb, 1, 'active')
        ON CONFLICT (brand_os_profile_id, objective_type, name) DO UPDATE SET
          description = EXCLUDED.description,
          success_criteria = EXCLUDED.success_criteria,
          status = EXCLUDED.status
        RETURNING id
      `,
      [
        profileRow.id,
        `Corpus objective: ${corpus.name ?? corpus.methodology_slug}`,
        objectiveDescription,
        json({ methodology_slug: corpus.methodology_slug, corpus_id: corpus.id })
      ]
    );
    objectiveId = objectiveRow.id;
    inc(ctx.counters, "brand_os_objectives_seen");
    await upsertBrandOsLink(ctx, profileRow.id, "brand_os_objective", objectiveId, "study_corpus", corpus.id, "frames", {
      source: "data_os_backfill",
      corpus_id: corpus.id,
      methodology_slug: corpus.methodology_slug
    });

    const briefId = await upsertBrandOsBrief(ctx, {
      brandOsProfileId: profileRow.id,
      briefType: "study_intake",
      metadata: {
        source: "study_corpora",
        corpus_id: corpus.id,
        methodology_slug: corpus.methodology_slug
      },
      objectiveId,
      sourceKind: "study_corpus_context",
      studyCorpusId: corpus.id,
      summary: compactText(objectiveDescription, 1000),
      title: `Study intake: ${corpus.name ?? corpus.methodology_slug}`
    });
    await upsertBrandOsLink(ctx, profileRow.id, "brand_os_objective", objectiveId, "brand_os_brief", briefId, "defined_by", {
      source: "data_os_backfill",
      corpus_id: corpus.id
    });
    await upsertBrandOsLink(ctx, profileRow.id, "brand_os_brief", briefId, "study_corpus", corpus.id, "frames", {
      source: "data_os_backfill",
      corpus_id: corpus.id,
      brief_type: "study_intake"
    });
  }

  if (corpus.audience_segment) {
    const audienceRow = await queryOne<{ id: string }>(
      ctx.client,
      `
        INSERT INTO brand_os_audiences (
          brand_os_profile_id, name, description, attributes, status
        )
        VALUES ($1, $2, $3, $4::jsonb, 'active')
        ON CONFLICT (brand_os_profile_id, name) DO UPDATE SET
          description = EXCLUDED.description,
          attributes = EXCLUDED.attributes,
          status = EXCLUDED.status
        RETURNING id
      `,
      [
        profileRow.id,
        corpus.audience_segment,
        `Audience segment captured on corpus ${corpus.name ?? corpus.id}.`,
        json({ source: "study_corpora.audience_segment", corpus_id: corpus.id })
      ]
    );
    inc(ctx.counters, "brand_os_audiences_seen");
    if (objectiveId) {
      await upsertBrandOsLink(ctx, profileRow.id, "brand_os_objective", objectiveId, "brand_os_audience", audienceRow.id, "focuses_on", {
        source: "data_os_backfill",
        corpus_id: corpus.id
      });
    }
  }

  const seedTerms = new Set<string>();
  if (corpus.subject_name) seedTerms.add(corpus.subject_name);
  for (const handle of corpus.brand_seed_handles ?? []) {
    if (handle.trim()) seedTerms.add(handle.trim());
  }

  if (seedTerms.size > 0) {
    const seedSetRow = await queryOne<{ id: string }>(
      ctx.client,
      `
        INSERT INTO brand_os_seed_sets (
          brand_os_profile_id, name, seed_set_type, objective_id, status, metadata
        )
        VALUES ($1, 'Brand aliases', 'brand_aliases', $2, 'active', $3::jsonb)
        ON CONFLICT (brand_os_profile_id, seed_set_type, name) DO UPDATE SET
          objective_id = COALESCE(EXCLUDED.objective_id, brand_os_seed_sets.objective_id),
          metadata = brand_os_seed_sets.metadata || EXCLUDED.metadata,
          status = EXCLUDED.status
        RETURNING id
      `,
      [profileRow.id, objectiveId, json({ source: "data_os_backfill", corpus_id: corpus.id })]
    );
    inc(ctx.counters, "brand_os_seed_sets_seen");
    if (objectiveId) {
      await upsertBrandOsLink(ctx, profileRow.id, "brand_os_objective", objectiveId, "brand_os_seed_set", seedSetRow.id, "uses_seed_set", {
        source: "data_os_backfill",
        corpus_id: corpus.id
      });
    }
    await upsertBrandOsLink(ctx, profileRow.id, "brand_os_seed_set", seedSetRow.id, "study_corpus", corpus.id, "seeded_from", {
      source: "data_os_backfill",
      corpus_id: corpus.id
    });

    for (const term of seedTerms) {
      await ctx.client.query(
        `
          INSERT INTO brand_os_seed_terms (
            seed_set_id, term, term_type, weight, metadata
          )
          VALUES ($1, $2, 'alias', 1, $3::jsonb)
          ON CONFLICT ON CONSTRAINT uq_brand_os_seed_terms_set_term DO UPDATE SET
            weight = EXCLUDED.weight,
            metadata = brand_os_seed_terms.metadata || EXCLUDED.metadata
        `,
        [seedSetRow.id, term, json({ source: "data_os_backfill" })]
      );
      inc(ctx.counters, "brand_os_seed_terms_seen");
    }
  }

  if (corpus.brand_id) {
    const competitors = await ctx.client.query<{ competitor_name: string; competitor_brand_seed_id: string | null; priority: number | null }>(
      `
        SELECT bs.canonical_name AS competitor_name, c.competitor_brand_seed_id, c.priority
        FROM competitors c
        JOIN brand_seeds bs ON bs.id = c.competitor_brand_seed_id
        WHERE c.brand_id = $1
      `,
      [corpus.brand_id]
    );
    for (const competitor of competitors.rows) {
      await ctx.client.query(
        `
          INSERT INTO brand_os_competitors (
            brand_os_profile_id, competitor_name, competitor_brand_seed_id, role, priority, metadata
          )
          VALUES ($1, $2, $3, 'direct', $4, $5::jsonb)
          ON CONFLICT (brand_os_profile_id, competitor_name) DO UPDATE SET
            competitor_brand_seed_id = EXCLUDED.competitor_brand_seed_id,
            priority = EXCLUDED.priority,
            metadata = brand_os_competitors.metadata || EXCLUDED.metadata
        `,
        [
          profileRow.id,
          competitor.competitor_name,
          competitor.competitor_brand_seed_id,
          competitor.priority,
          json({ source: "competitors" })
        ]
      );
      inc(ctx.counters, "brand_os_competitors_seen");
    }
  }

  const seedSetIds = await ctx.client.query<{ id: string }>(
    `
      SELECT id
      FROM brand_os_seed_sets
      WHERE brand_os_profile_id = $1
        AND status = 'active'
    `,
    [profileRow.id]
  );

  return {
    profileId: profileRow.id,
    objectiveId,
    seedSetIds: seedSetIds.rows.map((row) => row.id)
  };
}

async function backfillKnowledge(ctx: BackfillContext, corpus: CorpusRow, brandOs: BrandOsBackfillRefs) {
  const sources = await ctx.client.query<KnowledgeSourceRow>(
    `
      SELECT id, title, source_kind, raw_text, extracted_payload
      FROM brand_knowledge_sources
      WHERE status IN ('processed', 'processed_truncated')
        AND (
          study_corpus_id = $1
          OR ($2::uuid IS NOT NULL AND brand_id = $2 AND study_corpus_id IS NULL)
        )
      ORDER BY created_at
    `,
    [corpus.id, corpus.brand_id]
  );

  await ctx.client.query(
    `
      DELETE FROM knowledge_usage_events
      WHERE metadata->>'source' = 'data_os_backfill'
        AND metadata->>'corpus_id' = $1
    `,
    [corpus.id]
  );

  for (const source of sources.rows) {
    let briefId: string | null = null;
    if (isBriefLikeSourceKind(source.source_kind)) {
      briefId = await upsertBrandOsBrief(ctx, {
        brandOsProfileId: brandOs.profileId,
        briefType: normalizeKey(source.source_kind) || "knowledge_brief",
        knowledgeSourceId: source.id,
        metadata: {
          source: "brand_knowledge_sources",
          corpus_id: corpus.id,
          knowledge_source_id: source.id,
          source_kind: source.source_kind
        },
        objectiveId: brandOs.objectiveId,
        sourceKind: source.source_kind,
        studyCorpusId: corpus.id,
        summary: compactText((source.raw_text ?? payloadToText(source.extracted_payload)).trim(), 1000),
        title: source.title
      });
      await upsertBrandOsLink(ctx, brandOs.profileId, "brand_os_brief", briefId, "brand_knowledge_source", source.id, "sourced_from", {
        source: "data_os_backfill",
        corpus_id: corpus.id,
        source_kind: source.source_kind
      });
      if (brandOs.objectiveId) {
        await upsertBrandOsLink(ctx, brandOs.profileId, "brand_os_brief", briefId, "brand_os_objective", brandOs.objectiveId, "supports", {
          source: "data_os_backfill",
          corpus_id: corpus.id,
          source_kind: source.source_kind
        });
      }
    }

    await upsertBrandOsLink(ctx, brandOs.profileId, "brand_knowledge_source", source.id, "brand_os_profile", brandOs.profileId, "informs", {
      source: "data_os_backfill",
      corpus_id: corpus.id,
      source_kind: source.source_kind
    });
    await insertKnowledgeUsageEvent(ctx, {
      knowledgeSourceId: source.id,
      usageType: "catalogued_for_brand_os",
      metadata: {
        source: "data_os_backfill",
        corpus_id: corpus.id,
        brand_os_profile_id: brandOs.profileId,
        brand_os_brief_id: briefId
      }
    });

    const text = (source.raw_text ?? payloadToText(source.extracted_payload)).trim();
    const chunks = text ? chunkText(text) : [];

    for (const [index, chunk] of chunks.entries()) {
      const chunkRow = await queryOne<{ id: string }>(
        ctx.client,
        `
          INSERT INTO knowledge_chunks (
            knowledge_source_id, chunk_index, chunk_text, token_count, embedding_status, metadata
          )
          VALUES ($1, $2, $3, $4, 'pending', $5::jsonb)
          ON CONFLICT ON CONSTRAINT uq_knowledge_chunks_source_index DO UPDATE SET
            chunk_text = EXCLUDED.chunk_text,
            token_count = EXCLUDED.token_count,
            metadata = knowledge_chunks.metadata || EXCLUDED.metadata
          RETURNING id
        `,
        [
          source.id,
          index,
          chunk,
          Math.ceil(chunk.length / 4),
          json({ source: "data_os_backfill", title: source.title, source_kind: source.source_kind })
        ]
      );
      inc(ctx.counters, "knowledge_chunks_seen");
      await insertKnowledgeUsageEvent(ctx, {
        knowledgeSourceId: source.id,
        knowledgeChunkId: chunkRow.id,
        usageType: "chunked_for_data_os",
        metadata: {
          source: "data_os_backfill",
          corpus_id: corpus.id,
          brand_os_profile_id: brandOs.profileId,
          brand_os_brief_id: briefId,
          chunk_index: index
        }
      });
    }

    await ctx.client.query(
      `DELETE FROM knowledge_chunks WHERE knowledge_source_id = $1 AND chunk_index >= $2`,
      [source.id, chunks.length]
    );

    for (const assertion of extractAssertions(source.extracted_payload)) {
      const assertionRow = await queryOne<{ id: string }>(
        ctx.client,
        `
          INSERT INTO knowledge_assertions (
            knowledge_source_id, assertion_text, assertion_type, confidence, status, evidence, metadata
          )
          VALUES ($1, $2, $3, 'medium', 'candidate', $4::jsonb, $5::jsonb)
          ON CONFLICT ("knowledge_source_id", "assertion_type", "assertion_text") DO UPDATE SET
            confidence = EXCLUDED.confidence,
            status = CASE
              WHEN knowledge_assertions.status IN ('active', 'rejected', 'needs_review')
                THEN knowledge_assertions.status
              ELSE EXCLUDED.status
            END,
            evidence = EXCLUDED.evidence,
            metadata = knowledge_assertions.metadata || EXCLUDED.metadata,
            updated_at = now()
          RETURNING id
        `,
        [
          source.id,
          assertion.text,
          assertion.assertionType,
          json([{ source_id: source.id, source_kind: source.source_kind }]),
          json({ source: "data_os_backfill", corpus_id: corpus.id, brand_os_brief_id: briefId })
        ]
      );
      inc(ctx.counters, "knowledge_assertions_seen");
      await upsertKnowledgeAssertionLink(ctx, assertionRow.id, "brand_os_profile", brandOs.profileId, "supports", {
        source: "data_os_backfill",
        corpus_id: corpus.id,
        assertion_type: assertion.assertionType
      });
      if (brandOs.objectiveId) {
        await upsertKnowledgeAssertionLink(ctx, assertionRow.id, "brand_os_objective", brandOs.objectiveId, "supports", {
          source: "data_os_backfill",
          corpus_id: corpus.id,
          assertion_type: assertion.assertionType
        });
        await upsertBrandOsLink(ctx, brandOs.profileId, "knowledge_assertion", assertionRow.id, "brand_os_objective", brandOs.objectiveId, "supports", {
          source: "data_os_backfill",
          corpus_id: corpus.id,
          assertion_type: assertion.assertionType
        });
      }
      if (briefId) {
        await upsertKnowledgeAssertionLink(ctx, assertionRow.id, "brand_os_brief", briefId, "extracted_from", {
          source: "data_os_backfill",
          corpus_id: corpus.id,
          assertion_type: assertion.assertionType
        });
        await upsertBrandOsLink(ctx, brandOs.profileId, "knowledge_assertion", assertionRow.id, "brand_os_brief", briefId, "extracted_from", {
          source: "data_os_backfill",
          corpus_id: corpus.id,
          assertion_type: assertion.assertionType
        });
      }
      if (["audience_context", "brand_claim", "trigger_hypothesis", "barrier_hypothesis", "query_language"].includes(assertion.assertionType)) {
        for (const seedSetId of brandOs.seedSetIds) {
          await upsertKnowledgeAssertionLink(ctx, assertionRow.id, "brand_os_seed_set", seedSetId, "informs", {
            source: "data_os_backfill",
            corpus_id: corpus.id,
            assertion_type: assertion.assertionType
          });
        }
      }
      await insertKnowledgeUsageEvent(ctx, {
        knowledgeSourceId: source.id,
        knowledgeAssertionId: assertionRow.id,
        usageType: "assertion_linked_to_brand_os",
        metadata: {
          source: "data_os_backfill",
          corpus_id: corpus.id,
          brand_os_profile_id: brandOs.profileId,
          brand_os_objective_id: brandOs.objectiveId,
          brand_os_brief_id: briefId,
          assertion_type: assertion.assertionType
        }
      });
    }
  }
}

async function countAssetRows(client: pg.Client, corpus: CorpusRow, tableName: string) {
  switch (tableName) {
    case "mentions":
      return scalarNumber(client, `SELECT count(*)::text FROM mentions WHERE study_corpus_id = $1`, [corpus.id]);
    case "data_sources":
      return scalarNumber(client, `SELECT count(*)::text FROM data_sources WHERE study_corpus_id = $1`, [corpus.id]);
    case "performance_records":
      return scalarNumber(client, `SELECT count(*)::text FROM performance_records WHERE study_corpus_id = $1`, [corpus.id]);
    case "brand_knowledge_sources":
      return scalarNumber(
        client,
        `
          SELECT count(*)::text
          FROM brand_knowledge_sources
          WHERE study_corpus_id = $1
            OR ($2::uuid IS NOT NULL AND brand_id = $2 AND study_corpus_id IS NULL)
        `,
        [corpus.id, corpus.brand_id]
      );
    case "brand_os_briefs":
      return scalarNumber(client, `SELECT count(*)::text FROM brand_os_briefs WHERE study_corpus_id = $1`, [corpus.id]);
    case "knowledge_chunks":
      return scalarNumber(
        client,
        `
          SELECT count(*)::text
          FROM knowledge_chunks kc
          JOIN brand_knowledge_sources bks ON bks.id = kc.knowledge_source_id
          WHERE bks.study_corpus_id = $1
            OR ($2::uuid IS NOT NULL AND bks.brand_id = $2 AND bks.study_corpus_id IS NULL)
        `,
        [corpus.id, corpus.brand_id]
      );
    case "canonical_signals":
      return scalarNumber(client, `SELECT count(*)::text FROM canonical_signals WHERE study_corpus_id = $1`, [corpus.id]);
    case "signal_period_metrics":
      return scalarNumber(client, `SELECT count(*)::text FROM signal_period_metrics WHERE study_corpus_id = $1`, [corpus.id]);
    case "chart_aggregates":
      return scalarNumber(client, `SELECT count(*)::text FROM chart_aggregates WHERE study_corpus_id = $1`, [corpus.id]);
    case "published_outputs":
      return scalarNumber(client, `SELECT count(*)::text FROM published_outputs WHERE study_corpus_id = $1`, [corpus.id]);
    case "tagging_rule_sets":
      return scalarNumber(
        client,
        `SELECT count(*)::text FROM tagging_rule_sets WHERE rule_set_key = $1 AND version = $2 AND status = 'active'`,
        [TAGGING_RULE_SET_KEY, TAGGING_RULE_SET_VERSION]
      );
    default:
      return 0;
  }
}

async function ensureAssetFields(ctx: BackfillContext, assetId: string, assetName: string) {
  const fields = ASSET_FIELD_DEFINITIONS[assetName] ?? [];
  for (const field of fields) {
    await ctx.client.query(
      `
        INSERT INTO data_asset_fields (
          data_asset_id, field_name, field_type, semantic_type, nullable,
          description, examples, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
        ON CONFLICT ON CONSTRAINT uq_data_asset_fields_asset_field DO UPDATE SET
          field_type = EXCLUDED.field_type,
          semantic_type = EXCLUDED.semantic_type,
          nullable = EXCLUDED.nullable,
          description = EXCLUDED.description,
          examples = EXCLUDED.examples,
          metadata = data_asset_fields.metadata || EXCLUDED.metadata
      `,
      [
        assetId,
        field.name,
        field.type,
        field.semanticType,
        field.nullable,
        field.description,
        json(field.examples ?? []),
        json({ source: "data_os_backfill", catalog_version: "cut_1" })
      ]
    );
    inc(ctx.counters, "data_asset_fields_seen");
  }
}

async function ensureAssetAndQuality(ctx: BackfillContext, corpus: CorpusRow, asset: typeof ASSET_DEFINITIONS[number]) {
  const rowCount = await countAssetRows(ctx.client, corpus, asset.tableName);
  const assetRow = await queryOne<{ id: string }>(
    ctx.client,
    `
      INSERT INTO data_assets (
        organization_id, brand_id, theme_id, study_corpus_id, data_source_id,
        asset_kind, layer, name, description, owner_team, sensitivity, status,
        row_count, metadata
      )
      VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, 'data-os', 'internal', 'active', $9, $10::jsonb)
      ON CONFLICT ON CONSTRAINT uq_data_assets_scope_name_layer DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        brand_id = EXCLUDED.brand_id,
        theme_id = EXCLUDED.theme_id,
        asset_kind = EXCLUDED.asset_kind,
        description = EXCLUDED.description,
        row_count = EXCLUDED.row_count,
        metadata = data_assets.metadata || EXCLUDED.metadata,
        updated_at = now()
      RETURNING id
    `,
    [
      corpus.organization_id,
      corpus.brand_id,
      corpus.theme_id,
      corpus.id,
      asset.assetKind,
      asset.layer,
      asset.name,
      asset.description,
      rowCount,
      json({ source: "data_os_backfill", physical_table: asset.tableName })
    ]
  );
  inc(ctx.counters, "data_assets_seen");
  ctx.assetIds.set(assetKey(asset.name), assetRow.id);
  await ensureAssetFields(ctx, assetRow.id, asset.name);

  const contractRow = await queryOne<{ id: string }>(
    ctx.client,
    `
      INSERT INTO data_contracts (
        data_asset_id, contract_name, version, status,
        schema_contract, quality_contract, freshness_contract, semantic_contract
      )
      VALUES ($1, 'cut_1_default', 1, 'active', $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)
      ON CONFLICT ON CONSTRAINT uq_data_contracts_asset_name_version DO UPDATE SET
        status = EXCLUDED.status,
        schema_contract = EXCLUDED.schema_contract,
        quality_contract = EXCLUDED.quality_contract,
        freshness_contract = EXCLUDED.freshness_contract,
        semantic_contract = EXCLUDED.semantic_contract,
        updated_at = now()
      RETURNING id
    `,
    [
      assetRow.id,
      json({ physical_table: asset.tableName, layer: asset.layer }),
      json({ minimum_rows: asset.tableName === "mentions" ? 1 : 0 }),
      json({ mode: "manual_or_source_window" }),
      json({ grain: asset.layer === "serving" ? "output_or_chart" : "record" })
    ]
  );
  inc(ctx.counters, "data_contracts_seen");

  const ruleRow = await queryOne<{ id: string }>(
    ctx.client,
    `
      INSERT INTO data_quality_rules (
        data_contract_id, rule_key, rule_type, severity, definition, active
      )
      VALUES ($1, 'row_coverage_exists', 'completeness', $2, $3::jsonb, true)
      ON CONFLICT ON CONSTRAINT uq_data_quality_rules_contract_key DO UPDATE SET
        severity = EXCLUDED.severity,
        definition = EXCLUDED.definition,
        active = EXCLUDED.active
      RETURNING id
    `,
    [
      contractRow.id,
      asset.tableName === "mentions" ? "error" : "warning",
      json({ minimum_rows: asset.tableName === "mentions" ? 1 : 0 })
    ]
  );
  inc(ctx.counters, "data_quality_rules_seen");

  const status = rowCount > 0 ? "passed" : asset.tableName === "mentions" ? "failed" : "warning";
  await ctx.client.query(
    `
      INSERT INTO data_quality_results (
        data_quality_rule_id, data_asset_id, result_key, status,
        observed_value, expected_value, sample_refs, checked_at
      )
      VALUES ($1, $2, 'row_coverage_exists', $3, $4::jsonb, $5::jsonb, '[]'::jsonb, now())
      ON CONFLICT ON CONSTRAINT uq_data_quality_results_asset_key DO UPDATE SET
        data_quality_rule_id = EXCLUDED.data_quality_rule_id,
        status = EXCLUDED.status,
        observed_value = EXCLUDED.observed_value,
        expected_value = EXCLUDED.expected_value,
        checked_at = now()
    `,
    [
      ruleRow.id,
      assetRow.id,
      status,
      json({ row_count: rowCount }),
      json({ minimum_rows: asset.tableName === "mentions" ? 1 : 0 })
    ]
  );
  inc(ctx.counters, "data_quality_results_seen");

  await upsertLineageEdge(ctx, "study_corpus", corpus.id, "data_asset", assetRow.id, "scopes", {
    source: "data_os_backfill",
    asset_name: asset.name,
    layer: asset.layer
  });

  return assetRow.id;
}

async function backfillEntities(ctx: BackfillContext, corpus: CorpusRow) {
  if (corpus.brand_id || corpus.theme_id) {
    const entityType = corpus.brand_id ? "brand" : "theme";
    const externalId = corpus.brand_id ?? corpus.theme_id;
    const row = await queryOne<{ id: string }>(
      ctx.client,
      `
        INSERT INTO intelligence_entities (
          organization_id, brand_id, theme_id, entity_type, canonical_name, external_id, metadata, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active')
        ON CONFLICT ("entity_type", "external_id") WHERE "external_id" IS NOT NULL DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          brand_id = EXCLUDED.brand_id,
          theme_id = EXCLUDED.theme_id,
          canonical_name = EXCLUDED.canonical_name,
          metadata = intelligence_entities.metadata || EXCLUDED.metadata,
          updated_at = now()
        RETURNING id
      `,
      [
        corpus.organization_id,
        corpus.brand_id,
        corpus.theme_id,
        entityType,
        corpus.subject_name ?? corpus.name ?? externalId,
        externalId,
        json({ source: "data_os_backfill", corpus_id: corpus.id })
      ]
    );
    inc(ctx.counters, "intelligence_entities_seen");

    for (const alias of [corpus.subject_name, ...(corpus.brand_seed_handles ?? [])].filter((value): value is string => Boolean(value?.trim()))) {
      await ctx.client.query(
        `
          INSERT INTO entity_aliases (entity_id, alias, alias_type, source, confidence)
          VALUES ($1, $2, 'name_or_handle', 'data_os_backfill', 1)
          ON CONFLICT ON CONSTRAINT uq_entity_aliases_entity_alias DO UPDATE SET
            alias_type = EXCLUDED.alias_type,
            source = EXCLUDED.source,
            confidence = EXCLUDED.confidence
        `,
        [row.id, alias.trim()]
      );
      inc(ctx.counters, "entity_aliases_seen");
    }
  }

  const campaigns = await ctx.client.query<{ external_id: string; entity_name: string | null; entity_kind: string }>(
    `
      SELECT DISTINCT
        external_id,
        COALESCE(entity_name, external_id) AS entity_name,
        entity_kind
      FROM performance_records
      WHERE study_corpus_id = $1
        AND entity_kind IN ('campaign', 'adset', 'ad', 'post', 'creative', 'account')
      LIMIT 1000
    `,
    [corpus.id]
  );

  for (const campaign of campaigns.rows) {
    await ctx.client.query(
      `
        INSERT INTO intelligence_entities (
          organization_id, brand_id, theme_id, entity_type, canonical_name, external_id, metadata, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active')
        ON CONFLICT ("entity_type", "external_id") WHERE "external_id" IS NOT NULL DO UPDATE SET
          canonical_name = EXCLUDED.canonical_name,
          metadata = intelligence_entities.metadata || EXCLUDED.metadata,
          updated_at = now()
      `,
      [
        corpus.organization_id,
        corpus.brand_id,
        corpus.theme_id,
        campaign.entity_kind === "creative" ? "creative" : "campaign",
        campaign.entity_name ?? campaign.external_id,
        campaign.external_id,
        json({ source: "performance_records", corpus_id: corpus.id, entity_kind: campaign.entity_kind })
      ]
    );
    inc(ctx.counters, "intelligence_entities_seen");
  }
}

async function upsertMentionTag(ctx: BackfillContext, corpus: CorpusRow, mention: MentionRow, candidate: TagCandidate) {
  const taxonomyTermId = ctx.termIds.get(`${candidate.taxonomyKey}:${candidate.termKey}`);
  if (!taxonomyTermId) return;

  await ctx.client.query(
    `
      INSERT INTO record_tags (
        organization_id, brand_id, study_corpus_id, subject_type, subject_id,
        taxonomy_term_id, value, score, confidence, evidence, source,
        model_version_id, review_status
      )
      VALUES ($1, $2, $3, 'mention', $4, $5, $6, $7, $8, $9::jsonb, 'data_os_backfill_deterministic', $10, 'unreviewed')
      ON CONFLICT (subject_type, subject_id, taxonomy_term_id, source) DO UPDATE SET
        value = EXCLUDED.value,
        score = EXCLUDED.score,
        confidence = EXCLUDED.confidence,
        evidence = EXCLUDED.evidence,
        model_version_id = EXCLUDED.model_version_id
    `,
    [
      corpus.organization_id,
      corpus.brand_id,
      corpus.id,
      mention.id,
      taxonomyTermId,
      candidate.value,
      candidate.score,
      candidate.confidence,
      json([
        {
          source: "deterministic_keyword_rule",
          taxonomy_key: candidate.taxonomyKey,
          term_key: candidate.termKey,
          matched_keywords: candidate.matched,
          snippet: compactText([mention.title, mention.text_snippet, mention.text_clean].filter(Boolean).join(" "), 260)
        }
      ]),
      ctx.modelVersionId
    ]
  );
  inc(ctx.counters, "record_tags_seen");
  inc(ctx.counters, `record_tags_${candidate.taxonomyKey}_seen`);
}

async function upsertMentionFeatureValues(
  ctx: BackfillContext,
  corpus: CorpusRow,
  mention: MentionRow,
  candidates: TagCandidate[]
) {
  const featureValue = {
    platform: mention.resolved_platform ?? mention.platform,
    source_system: mention.source_system,
    content_type: mention.content_type,
    inclusion_status: mention.inclusion_status,
    sentiment_score: numberMaybe(mention.sentiment_score),
    quality_score: numberMaybe(mention.quality_score),
    engagement: mention.engagement ?? {},
    tags_by_taxonomy: groupCandidateTagsByTaxonomy(candidates),
    tags: candidates.map((candidate) => ({
      taxonomy_key: candidate.taxonomyKey,
      term_key: candidate.termKey,
      confidence: candidate.confidence,
      source: "data_os_backfill_deterministic"
    }))
  };

  await ctx.client.query(
    `
      INSERT INTO record_feature_values (
        organization_id, brand_id, study_corpus_id, subject_type, subject_id,
        feature_key, feature_value, value_type, confidence, source, model_version_id
      )
      VALUES ($1, $2, $3, 'mention', $4, 'mention_operational_context', $5::jsonb, 'object', 'medium', 'data_os_backfill_deterministic', $6)
      ON CONFLICT ON CONSTRAINT uq_record_feature_values_subject_key_source DO UPDATE SET
        feature_value = EXCLUDED.feature_value,
        value_type = EXCLUDED.value_type,
        confidence = EXCLUDED.confidence,
        model_version_id = EXCLUDED.model_version_id
    `,
    [
      corpus.organization_id,
      corpus.brand_id,
      corpus.id,
      mention.id,
      json(featureValue),
      ctx.modelVersionId
    ]
  );
  inc(ctx.counters, "record_feature_values_seen");
}

async function backfillMentionTagsAndFeatures(ctx: BackfillContext, corpus: CorpusRow) {
  const result = await ctx.client.query<MentionRow>(
    `
      SELECT
        id,
        text_clean,
        text_snippet,
        title,
        source_system,
        platform,
        resolved_platform,
        content_type,
        inclusion_status,
        sentiment_score,
        quality_score,
        engagement
      FROM mentions
      WHERE study_corpus_id = $1
      ORDER BY published_at NULLS LAST, id
    `,
    [corpus.id]
  );

  for (const mention of result.rows) {
    const candidates = buildMentionTagCandidates(mention);
    for (const candidate of candidates) {
      await upsertMentionTag(ctx, corpus, mention, candidate);
    }
    await upsertMentionFeatureValues(ctx, corpus, mention, candidates);
  }
}

async function backfillSourceAndAssetLineage(ctx: BackfillContext, corpus: CorpusRow) {
  const mentionsAsset = ctx.assetIds.get(assetKey("mentions"));
  const dataSourcesAsset = ctx.assetIds.get(assetKey("data_sources"));
  const performanceAsset = ctx.assetIds.get(assetKey("performance_records"));
  const knowledgeSourcesAsset = ctx.assetIds.get(assetKey("brand_knowledge_sources"));
  const knowledgeChunksAsset = ctx.assetIds.get(assetKey("knowledge_chunks"));
  const signalsAsset = ctx.assetIds.get(assetKey("canonical_signals"));
  const metricsAsset = ctx.assetIds.get(assetKey("signal_period_metrics"));
  const chartAggregatesAsset = ctx.assetIds.get(assetKey("chart_aggregates"));
  const outputsAsset = ctx.assetIds.get(assetKey("published_outputs"));
  const taggingRuleSetsAsset = ctx.assetIds.get(assetKey("tagging_rule_sets"));

  if (taggingRuleSetsAsset && ctx.taggingRuleSetId) {
    await upsertLineageEdge(ctx, "tagging_rule_set", ctx.taggingRuleSetId, "data_asset", taggingRuleSetsAsset, "catalogued_as", {
      source: "data_os_backfill",
      rule_set_key: TAGGING_RULE_SET_KEY,
      version: TAGGING_RULE_SET_VERSION
    });
    await upsertLineageEdge(ctx, "tagging_rule_set", ctx.taggingRuleSetId, "tagging_model_version", ctx.modelVersionId, "drives", {
      source: "data_os_backfill",
      model_key: "data_os_backfill"
    });
  }

  const dataSources = await ctx.client.query<{ id: string; source_type: string; provider: string | null }>(
    `
      SELECT id, source_type, provider
      FROM data_sources
      WHERE study_corpus_id = $1
    `,
    [corpus.id]
  );
  for (const source of dataSources.rows) {
    if (dataSourcesAsset) {
      await upsertLineageEdge(ctx, "data_source", source.id, "data_asset", dataSourcesAsset, "catalogued_as", {
        source: "data_os_backfill",
        source_type: source.source_type,
        provider: source.provider
      });
    }
    for (const assetId of [mentionsAsset, performanceAsset].filter((id): id is string => Boolean(id))) {
      await upsertLineageEdge(ctx, "data_source", source.id, "data_asset", assetId, "produces", {
        source: "data_os_backfill",
        source_type: source.source_type,
        provider: source.provider
      });
    }
  }

  const syncRuns = await ctx.client.query<{ id: string; data_source_id: string }>(
    `
      SELECT ssr.id, ssr.data_source_id
      FROM source_sync_runs ssr
      JOIN data_sources ds ON ds.id = ssr.data_source_id
      WHERE ds.study_corpus_id = $1
    `,
    [corpus.id]
  );
  for (const syncRun of syncRuns.rows) {
    await upsertLineageEdge(ctx, "source_sync_run", syncRun.id, "data_source", syncRun.data_source_id, "updates", {
      source: "data_os_backfill"
    });
    for (const assetId of [mentionsAsset, performanceAsset].filter((id): id is string => Boolean(id))) {
      await upsertLineageEdge(ctx, "source_sync_run", syncRun.id, "data_asset", assetId, "loads", {
        source: "data_os_backfill"
      });
    }
  }

  const importBatches = await ctx.client.query<{ id: string; source_system: string | null; mention_type: string | null }>(
    `
      SELECT id, source_system, mention_type
      FROM import_batches
      WHERE study_corpus_id = $1
    `,
    [corpus.id]
  );
  for (const batch of importBatches.rows) {
    if (!mentionsAsset) continue;
    await upsertLineageEdge(ctx, "import_batch", batch.id, "data_asset", mentionsAsset, "loads", {
      source: "data_os_backfill",
      source_system: batch.source_system,
      mention_type: batch.mention_type
    });
  }

  const knowledgeSources = await ctx.client.query<{ id: string; source_kind: string; status: string }>(
    `
      SELECT id, source_kind, status
      FROM brand_knowledge_sources
      WHERE status IN ('processed', 'processed_truncated')
        AND (
          study_corpus_id = $1
          OR ($2::uuid IS NOT NULL AND brand_id = $2 AND study_corpus_id IS NULL)
        )
    `,
    [corpus.id, corpus.brand_id]
  );
  for (const source of knowledgeSources.rows) {
    if (knowledgeSourcesAsset) {
      await upsertLineageEdge(ctx, "brand_knowledge_source", source.id, "data_asset", knowledgeSourcesAsset, "catalogued_as", {
        source: "data_os_backfill",
        source_kind: source.source_kind,
        status: source.status
      });
    }
    if (knowledgeChunksAsset) {
      await upsertLineageEdge(ctx, "brand_knowledge_source", source.id, "data_asset", knowledgeChunksAsset, "chunked_into", {
        source: "data_os_backfill",
        source_kind: source.source_kind,
        status: source.status
      });
    }
  }

  for (const [sourceAsset, targetAsset, relationType] of [
    [mentionsAsset, signalsAsset, "aggregates_into"],
    [mentionsAsset, metricsAsset, "measures_into"],
    [performanceAsset, metricsAsset, "measures_into"],
    [metricsAsset, chartAggregatesAsset, "materializes_into"],
    [chartAggregatesAsset, outputsAsset, "feeds"],
    [signalsAsset, outputsAsset, "feeds"],
    [metricsAsset, outputsAsset, "feeds"]
  ] as const) {
    if (!sourceAsset || !targetAsset) continue;
    await upsertLineageEdge(ctx, "data_asset", sourceAsset, "data_asset", targetAsset, relationType, {
      source: "data_os_backfill",
      corpus_id: corpus.id
    });
  }
}

async function backfillSignalTags(ctx: BackfillContext, corpus: CorpusRow) {
  const lifecycleTaxonomyId = ctx.taxonomyIds.get("signal_lifecycle");
  if (!lifecycleTaxonomyId) return;

  const result = await ctx.client.query(
    `
      WITH latest_metrics AS (
        SELECT DISTINCT ON (spm.canonical_signal_id)
          spm.canonical_signal_id,
          lower(spm.lifecycle_state) AS lifecycle_state
        FROM signal_period_metrics spm
        JOIN report_periods rp ON rp.id = spm.period_id
        WHERE spm.study_corpus_id = $1
          AND spm.lifecycle_state IS NOT NULL
        ORDER BY spm.canonical_signal_id, rp.period_start DESC
      )
      INSERT INTO record_tags (
        organization_id, brand_id, study_corpus_id, subject_type, subject_id,
        taxonomy_term_id, value, score, confidence, evidence, source,
        model_version_id, review_status
      )
      SELECT
        $2::uuid,
        $3::uuid,
        $1::uuid,
        'canonical_signal',
        latest_metrics.canonical_signal_id,
        tt.id,
        latest_metrics.lifecycle_state,
        NULL,
        'medium',
        jsonb_build_array(jsonb_build_object('source', 'signal_period_metrics')),
        'data_os_backfill',
        $4::uuid,
        'unreviewed'
      FROM latest_metrics
      JOIN taxonomy_terms tt
        ON tt.taxonomy_id = $5::uuid
       AND tt.term_key = latest_metrics.lifecycle_state
      ON CONFLICT (subject_type, subject_id, taxonomy_term_id, source) DO UPDATE SET
        value = EXCLUDED.value,
        confidence = EXCLUDED.confidence,
        evidence = EXCLUDED.evidence,
        model_version_id = EXCLUDED.model_version_id
    `,
    [corpus.id, corpus.organization_id, corpus.brand_id, ctx.modelVersionId, lifecycleTaxonomyId]
  );
  inc(ctx.counters, "record_tags_seen", result.rowCount ?? 0);
}

async function backfillDashboardRefs(ctx: BackfillContext, corpus: CorpusRow) {
  const result = await ctx.client.query<{ id: string }>(
    `
      SELECT id
      FROM published_outputs
      WHERE study_corpus_id = $1
        AND kind = 'signal_pulse'
    `,
    [corpus.id]
  );

  for (const output of result.rows) {
    for (const ref of [
      { key: "sources", sourceType: "api_query", assetName: "data_sources" },
      { key: "metrics", sourceType: "metric_materialization", assetName: "signal_period_metrics" },
      { key: "chart_aggregates", sourceType: "chart_aggregate", assetName: "chart_aggregates" },
      { key: "corpus", sourceType: "api_query", assetName: "mentions" }
    ]) {
      const sourceId = ctx.assetIds.get(assetKey(ref.assetName)) ?? null;
      const refRow = await queryOne<{ id: string }>(
        ctx.client,
        `
          INSERT INTO dashboard_data_refs (
            output_id, study_corpus_id, ref_key, source_type, source_id, filters, visibility
          )
          VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, '{"internal":true}'::jsonb)
          ON CONFLICT ON CONSTRAINT uq_dashboard_data_refs_output_key DO UPDATE SET
            source_type = EXCLUDED.source_type,
            source_id = EXCLUDED.source_id,
            filters = EXCLUDED.filters,
            visibility = EXCLUDED.visibility
          RETURNING id
        `,
        [output.id, corpus.id, ref.key, ref.sourceType, sourceId]
      );
      inc(ctx.counters, "dashboard_data_refs_seen");
      if (sourceId) {
        await upsertLineageEdge(ctx, "data_asset", sourceId, "dashboard_data_ref", refRow.id, "serves", {
          source: "data_os_backfill",
          ref_key: ref.key
        });
      }
      await upsertLineageEdge(ctx, "dashboard_data_ref", refRow.id, "published_output", output.id, "feeds", {
        source: "data_os_backfill",
        ref_key: ref.key
      });
    }
  }
}

async function seedSemanticLayer(ctx: BackfillContext) {
  const metricDefinitions = [
    {
      key: "signal_volume",
      name: "Signal volume",
      grain: "signal_period",
      unit: "mentions",
      definition: { source: "signal_period_metrics.volume" }
    },
    {
      key: "signal_impact_v1",
      name: "Signal impact v1",
      grain: "signal_period",
      unit: "score",
      definition: { source: "signal_period_metrics.impact_v1" }
    },
    {
      key: "signal_sentiment_score",
      name: "Signal sentiment score",
      grain: "signal_period",
      unit: "score",
      definition: { source: "signal_period_metrics.sentiment_score", range: [-1, 1] }
    },
    {
      key: "performance_engagement",
      name: "Performance engagement",
      grain: "record",
      unit: "engagements",
      definition: { source: "performance_records.engagement" }
    }
  ];

  for (const metric of metricDefinitions) {
    await ctx.client.query(
      `
        INSERT INTO metric_definitions (
          metric_key, name, description, grain, unit, definition, dimensions, owner_team, status
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'data-os', 'active')
        ON CONFLICT (metric_key) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          grain = EXCLUDED.grain,
          unit = EXCLUDED.unit,
          definition = EXCLUDED.definition,
          dimensions = EXCLUDED.dimensions,
          updated_at = now()
      `,
      [
        metric.key,
        metric.name,
        `${metric.name} used by Noisia Data OS serving APIs.`,
        metric.grain,
        metric.unit,
        json(metric.definition),
        json(["study_corpus", "period", "signal", "source_type"])
      ]
    );
    inc(ctx.counters, "metric_definitions_seen");
  }

  await ctx.client.query(
    `
      INSERT INTO semantic_models (
        model_key, name, entities, dimensions, measures, metadata, status
      )
      VALUES (
        'signal_pulse_serving',
        'Signal Pulse serving model',
        $1::jsonb,
        $2::jsonb,
        $3::jsonb,
        '{"source":"data_os_backfill"}'::jsonb,
        'active'
      )
      ON CONFLICT (model_key) DO UPDATE SET
        name = EXCLUDED.name,
        entities = EXCLUDED.entities,
        dimensions = EXCLUDED.dimensions,
        measures = EXCLUDED.measures,
        metadata = semantic_models.metadata || EXCLUDED.metadata,
        status = EXCLUDED.status
    `,
    [
      json(["study_corpus", "canonical_signal", "report_period"]),
      json(["period", "platform", "source_type", "lifecycle_state", "taxonomy"]),
      json(["signal_volume", "signal_impact_v1", "signal_sentiment_score", "performance_engagement"])
    ]
  );
  inc(ctx.counters, "semantic_models_seen");
}

async function backfillCorpus(ctx: BackfillContext, corpus: CorpusRow) {
  inc(ctx.counters, "corpora_seen");
  const brandOs = await ensureBrandOs(ctx, corpus);
  await backfillKnowledge(ctx, corpus, brandOs);
  await backfillEntities(ctx, corpus);

  for (const asset of ASSET_DEFINITIONS) {
    await ensureAssetAndQuality(ctx, corpus, asset);
  }

  await backfillSourceAndAssetLineage(ctx, corpus);
  await backfillMentionTagsAndFeatures(ctx, corpus);
  await backfillSignalTags(ctx, corpus);
  await backfillDashboardRefs(ctx, corpus);
}

async function main() {
  requireBackfillEnabled();
  const databaseUrl = requireEnv("DATABASE_URL");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "data-os:backfill",
    allowRemoteEnv: "NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });
  const counters: CounterMap = {};

  await client.connect();
  try {
    await client.query("begin");
    const ctx: BackfillContext = {
      client,
      counters,
      taxonomyIds: new Map(),
      termIds: new Map(),
      assetIds: new Map(),
      taggingRuleSetId: "",
      modelVersionId: ""
    };

    await seedTaxonomies(ctx);
    ctx.taggingRuleSetId = await ensureTaggingRuleSet(ctx);
    ctx.modelVersionId = await ensureModelVersion(client, ctx.taggingRuleSetId);
    await seedSemanticLayer(ctx);

    const corpusId = process.env.NOISIA_DATA_OS_BACKFILL_CORPUS_ID?.trim() || null;
    const corpora = await loadCorpora(client, corpusId);
    for (const corpus of corpora) {
      await backfillCorpus(ctx, corpus);
    }

    await client.query("commit");
    console.log(JSON.stringify({ ok: true, corpusFilter: corpusId, ...counters }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
