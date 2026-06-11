import { relations, sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const mxCountryArray = sql`ARRAY['MX']::char(2)[]`;
const emptyTextArray = sql`ARRAY[]::text[]`;
const defaultStudyAnalysisPlan = sql`'{"version":1,"primary_methodology_slug":"triggers-barriers","selected_lenses":["triggers-barriers"],"lens_configs":{},"composer_modules":[]}'::jsonb`;

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name"),
  hqCountry: char("hq_country", { length: 2 }).default("MX"),
  industryPrimary: text("industry_primary"),
  isHolding: boolean("is_holding").default(false),
  status: text("status").notNull(),
  contractStartedAt: date("contract_started_at"),
  accountOwnerKamId: uuid("account_owner_kam_id").references((): AnyPgColumn => users.id),
  notes: text("notes"),
  createdAt: now(),
  updatedAt: updatedAt()
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    fullName: text("full_name"),
    userType: text("user_type").notNull(),
    primaryRole: text("primary_role").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    status: text("status").notNull(),
    whatsappNumber: text("whatsapp_number"),
    preferences: jsonb("preferences").default(sql`'{}'::jsonb`),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: now(),
    invitedByUserId: uuid("invited_by_user_id").references((): AnyPgColumn => users.id)
  },
  (table) => [
    index("idx_users_org").on(table.organizationId),
    index("idx_users_role").on(table.primaryRole)
  ]
);

// Invitaciones gestionadas desde Studio (Noisia es dueña de la autorización;
// Kinde sólo autentica). Una invitación pendiente pre-asigna rol + organización;
// cuando la persona entra por primera vez con ese correo, el login la "consume"
// y crea su fila en users con ese rol/organización.
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    primaryRole: text("primary_role").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    status: text("status").notNull().default("pending"),
    token: text("token").notNull().unique(),
    invitedByUserId: uuid("invited_by_user_id").references((): AnyPgColumn => users.id),
    acceptedByUserId: uuid("accepted_by_user_id").references((): AnyPgColumn => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    // Sólo una invitación pendiente por correo (no bloquea reinvitar tras aceptar/revocar).
    uniqueIndex("uq_invitations_pending_email")
      .on(table.email)
      .where(sql`${table.status} = 'pending'`),
    index("idx_invitations_status").on(table.status)
  ]
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    industry: text("industry"),
    industrySub: text("industry_sub"),
    countries: char("countries", { length: 2 }).array().default(mxCountryArray),
    description: text("description"),
    brandSeedHandles: text("brand_seed_handles").array().default(emptyTextArray),
    status: text("status").notNull(),
    primaryBrandManagerUserId: uuid("primary_brand_manager_user_id").references(
      (): AnyPgColumn => users.id
    ),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_brands_org_slug").on(table.organizationId, table.slug),
    index("idx_brands_org").on(table.organizationId),
    index("idx_brands_industry").on(table.industry)
  ]
);

export const themes = pgTable(
  "themes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    industryFocus: text("industry_focus").array().default(emptyTextArray),
    geoFocus: char("geo_focus", { length: 2 }).array().default(mxCountryArray),
    status: text("status").notNull(),
    isPublic: boolean("is_public").default(false),
    createdAt: now()
  },
  (table) => [
    index("idx_themes_org").on(table.organizationId),
    index("idx_themes_public").on(table.isPublic).where(sql`${table.isPublic} = true`)
  ]
);

export const brandSeeds = pgTable("brand_seeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalName: text("canonical_name").notNull().unique(),
  aliases: text("aliases").array().default(emptyTextArray),
  detectionPatterns: text("detection_patterns").array().default(emptyTextArray),
  vertical: text("vertical"),
  subVertical: text("sub_vertical"),
  country: char("country", { length: 2 }),
  isInstitution: boolean("is_institution").default(false),
  notes: text("notes"),
  active: boolean("active").default(true),
  createdAt: now()
});

export const competitors = pgTable(
  "competitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    competitorBrandSeedId: uuid("competitor_brand_seed_id")
      .notNull()
      .references(() => brandSeeds.id),
    priority: integer("priority"),
    notes: text("notes"),
    createdAt: now()
  },
  (table) => [unique("uq_competitors_brand_seed").on(table.brandId, table.competitorBrandSeedId)]
);

export const brandKnowledgeSources = pgTable(
  "brand_knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    title: text("title").notNull(),
    originalFileName: text("original_file_name"),
    mimeType: text("mime_type"),
    storagePath: text("storage_path"),
    fileSizeBytes: integer("file_size_bytes"),
    fileHash: text("file_hash"),
    sourcePeriodStart: date("source_period_start"),
    sourcePeriodEnd: date("source_period_end"),
    rawText: text("raw_text"),
    extractedPayload: jsonb("extracted_payload").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("processed"),
    errorMessage: text("error_message"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check(
      "knowledge_source_scope",
      sql`${table.brandId} IS NOT NULL OR ${table.studyCorpusId} IS NOT NULL`
    ),
    index("idx_bks_brand").on(table.brandId, table.createdAt),
    index("idx_bks_corpus").on(table.studyCorpusId, table.createdAt),
    index("idx_bks_org").on(table.organizationId, table.createdAt),
    index("idx_bks_kind").on(table.sourceKind, table.status),
    index("idx_bks_status_created").on(table.status, table.createdAt),
    index("idx_bks_hash").on(table.fileHash)
  ]
);

export const userBrandAccess = pgTable(
  "user_brand_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    accessLevel: text("access_level").notNull(),
    grantedByUserId: uuid("granted_by_user_id").references((): AnyPgColumn => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (table) => [
    unique("uq_user_brand_access").on(table.userId, table.brandId),
    index("idx_uba_user").on(table.userId),
    index("idx_uba_brand").on(table.brandId)
  ]
);

export const methodologies = pgTable(
  "methodologies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull(),
    manifestYaml: jsonb("manifest_yaml").notNull(),
    defaultBlocks: jsonb("default_blocks"),
    scrollytellingTemplate: jsonb("scrollytelling_template"),
    aiPrompts: jsonb("ai_prompts"),
    qualityGates: jsonb("quality_gates"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("uq_methodologies_slug_version").on(table.slug, table.version),
    index("idx_methodologies_slug").on(table.slug),
    index("idx_methodologies_status").on(table.status)
  ]
);

export const studyCorpora = pgTable(
  "study_corpora",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    brandId: uuid("brand_id").references(() => brands.id),
    themeId: uuid("theme_id").references(() => themes.id),
    baseCorpusId: uuid("base_corpus_id").references((): AnyPgColumn => studyCorpora.id, { onDelete: "set null" }),
    methodologyId: uuid("methodology_id")
      .notNull()
      .references(() => methodologies.id),
    methodologyVersionAtCreation: text("methodology_version_at_creation").notNull(),
    businessQuestion: text("business_question"),
    decisionToInform: text("decision_to_inform"),
    audienceSegment: text("audience_segment"),
    geoFocus: char("geo_focus", { length: 2 }).array().default(mxCountryArray),
    targetWindowMonths: integer("target_window_months").default(12),
    contextForm: jsonb("context_form"),
    analysisPlan: jsonb("analysis_plan").notNull().default(defaultStudyAnalysisPlan),
    status: text("status").notNull(),
    currentPipelineVersion: text("current_pipeline_version"),
    insightsManagerUserId: uuid("insights_manager_user_id").references(() => users.id),
    kamUserId: uuid("kam_user_id").references(() => users.id),
    createdAt: now(),
    corpusFirstApprovedAt: timestamp("corpus_first_approved_at", { withTimezone: true }),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    latestAssessment: jsonb("latest_assessment"),
    latestAssessedAt: timestamp("latest_assessed_at", { withTimezone: true }),
    /** Set during a T&B analysis run to freeze cleanup/upload. Force-unlock from UI. */
    lockedByAnalysisId: uuid("locked_by_analysis_id"),
    updatedAt: updatedAt()
  },
  (table) => [
    check(
      "corpus_has_exactly_one_subject",
      sql`((${table.brandId} IS NOT NULL)::int + (${table.themeId} IS NOT NULL)::int) = 1`
    ),
    index("idx_sc_brand").on(table.brandId),
    index("idx_sc_brand_method_created")
      .on(table.brandId, table.methodologyId, table.createdAt)
      .where(sql`${table.brandId} IS NOT NULL`),
    index("idx_sc_theme").on(table.themeId),
    index("idx_sc_base_corpus").on(table.baseCorpusId),
    index("idx_sc_analysis_plan").using("gin", table.analysisPlan),
    index("idx_sc_theme_method_created")
      .on(table.themeId, table.methodologyId, table.createdAt)
      .where(sql`${table.themeId} IS NOT NULL`),
    index("idx_sc_method").on(table.methodologyId),
    index("idx_sc_status").on(table.status)
  ]
);

export const queryIterations = pgTable(
  "query_iterations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id),
    iterationNumber: integer("iteration_number").notNull(),
    queryText: text("query_text").notNull(),
    industryQueryText: text("industry_query_text"),
    competitorQueryText: text("competitor_query_text"),
    queryComponents: jsonb("query_components"),
    mentionsReturned: integer("mentions_returned"),
    qualityScore: numeric("quality_score", { precision: 5, scale: 2 }),
    densityScore: numeric("density_score", { precision: 5, scale: 2 }),
    noiseScore: numeric("noise_score", { precision: 5, scale: 2 }),
    aiEvaluationNotes: text("ai_evaluation_notes"),
    insightsManagerDecision: text("insights_manager_decision"),
    insightsManagerUserId: uuid("insights_manager_user_id").references(() => users.id),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    pipelineVersion: text("pipeline_version"),
    createdAt: now()
  },
  (table) => [
    unique("uq_query_iterations_corpus_iteration").on(table.studyCorpusId, table.iterationNumber),
    index("idx_qi_corpus").on(table.studyCorpusId),
    index("idx_qi_created").on(table.createdAt)
  ]
);

export const queryPacks = pgTable(
  "query_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    queryIterationId: uuid("query_iteration_id").references(() => queryIterations.id, { onDelete: "set null" }),
    /** Method/lens that requested this pack: triggers-barriers, value-perception-matrix, etc. */
    lensSlug: text("lens_slug").notNull(),
    /** Method-specific target: triggers, barriers, monetary_cost, checkout_friction, etc. */
    signalIntent: text("signal_intent").notNull(),
    /** brand | competitors | category | baseline | source */
    scope: text("scope").notNull(),
    objective: text("objective"),
    queryText: text("query_text"),
    queryComponents: jsonb("query_components").notNull().default(sql`'{}'::jsonb`),
    seeds: jsonb("seeds").notNull().default(sql`'{}'::jsonb`),
    evaluation: jsonb("evaluation").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("planned"),
    mentionsReturned: integer("mentions_returned"),
    qualityScore: numeric("quality_score", { precision: 5, scale: 2 }),
    densityScore: numeric("density_score", { precision: 5, scale: 2 }),
    noiseScore: numeric("noise_score", { precision: 5, scale: 2 }),
    costBudget: jsonb("cost_budget").notNull().default(sql`'{}'::jsonb`),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_query_packs_corpus").on(table.studyCorpusId),
    index("idx_query_packs_lens").on(table.studyCorpusId, table.lensSlug, table.signalIntent, table.scope),
    index("idx_query_packs_status").on(table.studyCorpusId, table.status),
    index("idx_query_packs_iteration").on(table.queryIterationId),
    uniqueIndex("uq_query_packs_iteration_lens_intent_scope").on(
      table.studyCorpusId,
      sql`COALESCE(${table.queryIterationId}::text, '')`,
      table.lensSlug,
      table.signalIntent,
      table.scope
    )
  ]
);

export const corpusEntities = pgTable(
  "corpus_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references(() => competitors.id),
    /** primary_brand | competitor | category */
    entityKind: text("entity_kind").notNull(),
    name: text("name").notNull(),
    aliases: text("aliases").array().default(emptyTextArray),
    handles: text("handles").array().default(emptyTextArray),
    querySeeds: text("query_seeds").array().default(emptyTextArray),
    notes: text("notes"),
    isCategoryBaseline: boolean("is_category_baseline").default(false),
    priority: integer("priority"),
    status: text("status").notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_corpus_entities_corpus").on(table.studyCorpusId),
    index("idx_corpus_entities_kind").on(table.studyCorpusId, table.entityKind),
    index("idx_corpus_entities_competitor").on(table.competitorId)
  ]
);

export const memoryIndustry = pgTable(
  "memory_industry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    industry: text("industry").notNull(),
    industrySub: text("industry_sub"),
    methodologySlug: text("methodology_slug"),
    memoryType: text("memory_type").notNull(),
    content: jsonb("content").notNull(),
    evidenceCount: integer("evidence_count"),
    shareable: boolean("shareable").default(true),
    createdAt: now(),
    lastConsultedAt: timestamp("last_consulted_at", { withTimezone: true })
  },
  (table) => [
    index("idx_mi_industry").on(table.industry),
    index("idx_mi_method").on(table.methodologySlug),
    index("idx_mi_shareable").on(table.shareable)
  ]
);

export const memoryBrand = pgTable(
  "memory_brand",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    memoryType: text("memory_type").notNull(),
    content: jsonb("content").notNull(),
    sourceCorpusId: uuid("source_corpus_id").references(() => studyCorpora.id),
    createdAt: now()
  },
  (table) => [index("idx_mb_brand").on(table.brandId), index("idx_mb_type").on(table.memoryType)]
);

export const authors = pgTable(
  "authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(),
    externalId: text("external_id"),
    handle: text("handle"),
    displayName: text("display_name"),
    profileUrl: text("profile_url"),
    followerCountLastSeen: integer("follower_count_last_seen"),
    inferredGender: char("inferred_gender", { length: 1 }),
    inferredCountry: char("inferred_country", { length: 2 }),
    isVerified: boolean("is_verified"),
    isBusiness: boolean("is_business"),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeen: timestamp("last_seen", { withTimezone: true })
  },
  (table) => [unique("uq_authors_platform_external").on(table.platform, table.externalId)]
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id),
    queryIterationId: uuid("query_iteration_id").references(() => queryIterations.id),
    queryPackId: uuid("query_pack_id").references(() => queryPacks.id, { onDelete: "set null" }),
    /** 'brand' | 'competitor' | 'industry' | null — null = legacy/uncategorized */
    mentionType: text("mention_type"),
    competitorId: uuid("competitor_id").references(() => competitors.id),
    corpusEntityId: uuid("corpus_entity_id").references(() => corpusEntities.id),
    /** primary_brand | competitor_pool | competitor | category | unknown */
    entityKind: text("entity_kind"),
    entityLabel: text("entity_label"),
    sourceSystem: text("source_system").notNull(),
    sourceFileName: text("source_file_name"),
    sourceFileHash: text("source_file_hash"),
    importedByUserId: uuid("imported_by_user_id").references(() => users.id),
    recordCount: integer("record_count").default(0),
    includedCount: integer("included_count").default(0),
    excludedCount: integer("excluded_count").default(0),
    duplicateCount: integer("duplicate_count").default(0),
    status: text("status").notNull(),
    createdAt: now()
  },
  (table) => [
    index("idx_import_batches_corpus").on(table.studyCorpusId),
    index("idx_import_batches_entity").on(table.studyCorpusId, table.mentionType, table.entityKind),
    index("idx_import_batches_corpus_entity").on(table.studyCorpusId, table.corpusEntityId),
    index("idx_import_batches_competitor").on(table.studyCorpusId, table.competitorId),
    index("idx_import_batches_query_pack").on(table.studyCorpusId, table.queryPackId),
    index("idx_import_batches_status").on(table.status)
  ]
);

// Snapshots: frozen views of which mentions were 'included' at a point in time.
export const corpusSnapshots = pgTable(
  "corpus_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id),
    label: text("label").notNull(),
    /** 'approval' (auto from approving the corpus) | 'manual' (user-saved). */
    kind: text("kind").notNull().default("manual"),
    mentionCount: integer("mention_count").notNull().default(0),
    scoresAtSnapshot: jsonb("scores_at_snapshot"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: now()
  },
  (table) => [index("idx_snap_corpus").on(table.studyCorpusId)]
);

export const corpusSnapshotAggregates = pgTable(
  "corpus_snapshot_aggregates",
  {
    snapshotId: uuid("snapshot_id")
      .primaryKey()
      .references(() => corpusSnapshots.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    totalMentions: integer("total_mentions").notNull().default(0),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    platformDistribution: jsonb("platform_distribution").notNull().default(sql`'[]'::jsonb`),
    contentTypeDistribution: jsonb("content_type_distribution").notNull().default(sql`'[]'::jsonb`),
    volumeTimeline: jsonb("volume_timeline").notNull().default(sql`'[]'::jsonb`),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("idx_snapshot_aggregates_corpus").on(table.studyCorpusId)]
);

// Cleanup actions: every bulk exclusion (Claude or manual) for audit + revert.
export const cleanupActions = pgTable(
  "cleanup_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id),
    /** 'claude_instruction' | 'manual_bulk'. */
    kind: text("kind").notNull(),
    instruction: text("instruction"),
    patterns: jsonb("patterns"),
    claudeNotes: text("claude_notes"),
    mentionCount: integer("mention_count").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: now(),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    revertedByUserId: uuid("reverted_by_user_id").references(() => users.id)
  },
  (table) => [index("idx_cleanup_corpus").on(table.studyCorpusId)]
);

// TODO mejora-futura: implementar particionado LIST real de mentions por
// `study_corpus_id` cuando F1.5/Fase 5 introduzcan importador CSV y volumen.
export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id),
    externalId: text("external_id").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceFileId: uuid("source_file_id").references(() => importBatches.id),
    textHash: text("text_hash").notNull(),
    textRaw: text("text_raw"),
    textClean: text("text_clean").notNull(),
    textSnippet: text("text_snippet"),
    title: text("title"),
    textLength: integer("text_length").notNull(),
    language: char("language", { length: 2 }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    platform: text("platform").notNull(),
    /** Materialized at ingest (see lib/csv/sentione.ts) so Signal dashboard
     * aggregates don't extract platform/channel from raw_metadata jsonb per row. */
    resolvedPlatform: text("resolved_platform"),
    contentType: text("content_type"),
    batchEntityLabel: text("batch_entity_label"),
    url: text("url"),
    authorId: uuid("author_id").references(() => authors.id),
    country: char("country", { length: 2 }),
    engagement: jsonb("engagement"),
    sentimentSource: text("sentiment_source"),
    sentimentScore: numeric("sentiment_score", { precision: 4, scale: 3 }),
    qualityScore: integer("quality_score"),
    inclusionStatus: text("inclusion_status").notNull().default("pending"),
    exclusionReason: text("exclusion_reason"),
    qualityFlags: jsonb("quality_flags"),
    rawMetadata: jsonb("raw_metadata"),
    /** Set when a cleanup_actions row excluded this mention — enables revert. */
    cleanupActionId: uuid("cleanup_action_id").references(() => cleanupActions.id),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_mentions_corpus_text_hash").on(table.studyCorpusId, table.textHash),
    unique("uq_mentions_source_external").on(table.sourceSystem, table.externalId),
    index("idx_mentions_corpus_platform").on(table.studyCorpusId, table.platform),
    index("idx_mentions_corpus_inclusion").on(table.studyCorpusId, table.inclusionStatus),
    index("idx_mentions_published").on(table.publishedAt),
    index("idx_mentions_text_hash").on(table.textHash)
  ]
);

export const mentionQuerySources = pgTable(
  "mention_query_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    queryPackId: uuid("query_pack_id").references(() => queryPacks.id, { onDelete: "set null" }),
    queryIterationId: uuid("query_iteration_id").references(() => queryIterations.id, { onDelete: "set null" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    lensSlug: text("lens_slug"),
    signalIntent: text("signal_intent"),
    scope: text("scope"),
    corpusEntityId: uuid("corpus_entity_id").references(() => corpusEntities.id, { onDelete: "set null" }),
    entityId: text("entity_id"),
    matchQuality: numeric("match_quality", { precision: 4, scale: 3 }),
    matchReason: text("match_reason"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_mention_query_sources_mention").on(table.mentionId),
    index("idx_mention_query_sources_corpus").on(table.studyCorpusId, table.lensSlug, table.signalIntent, table.scope),
    index("idx_mention_query_sources_pack").on(table.queryPackId),
    index("idx_mention_query_sources_entity").on(table.studyCorpusId, table.corpusEntityId),
    uniqueIndex("uq_mention_query_source_pack")
      .on(table.mentionId, table.queryPackId)
      .where(sql`${table.queryPackId} IS NOT NULL`)
  ]
);

// ============================================================
// Triggers & Barriers analysis pipeline
// Spec: docs/product/03_TRIGGERS_BARRIERS_DEEPDIVE.md
// ============================================================

export const tbAnalyses = pgTable(
  "tb_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => corpusSnapshots.id),
    pipelineVersion: text("pipeline_version").notNull(),
    methodologyVersion: text("methodology_version").notNull(),

    /** running | needs_review | approved_by_im | approved_by_kam | failed | aborted_preflight */
    status: text("status").notNull().default("running"),
    /** preflight | step1_open_pass | step2_coding | step3_hierarchy | step4_mobility |
     * step5_comparative | step6_synthesis | review | done */
    currentStep: text("current_step").notNull().default("preflight"),

    businessQuestion: text("business_question"),
    decisionToInform: text("decision_to_inform"),

    metaJson: jsonb("meta_json"),
    corpusSnapshotJson: jsonb("corpus_snapshot_json"),

    activationPlaybook: jsonb("activation_playbook"),
    frictionRemovalPlan: jsonb("friction_removal_plan"),
    comparativeBrief: jsonb("comparative_brief"),
    limitations: jsonb("limitations"),
    confidencePerFinding: jsonb("confidence_per_finding"),

    executedByUserId: uuid("executed_by_user_id").references(() => users.id),
    approvedByImUserId: uuid("approved_by_im_user_id").references(() => users.id),
    approvedByKamUserId: uuid("approved_by_kam_user_id").references(() => users.id),
    executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow(),
    imApprovedAt: timestamp("im_approved_at", { withTimezone: true }),
    kamApprovedAt: timestamp("kam_approved_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),

    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_tb_analyses_corpus").on(table.studyCorpusId, table.createdAt),
    index("idx_tb_analyses_status").on(table.status)
  ]
);

export const tbFindings = pgTable(
  "tb_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    /** Human-readable id used by Claude across steps, e.g. "T-PSI-01". */
    findingId: text("finding_id").notNull(),
    /** 'trigger' | 'barrier' */
    polarity: text("polarity").notNull(),
    /** 'psicologico' | 'personal' | 'social' | 'cultural' */
    layer: text("layer").notNull(),
    nombreComercial: text("nombre_comercial").notNull(),

    frecuencia: integer("frecuencia").notNull().default(0),
    intensidadPromedio: numeric("intensidad_promedio", { precision: 3, scale: 2 }),
    capacidadPredictiva: numeric("capacidad_predictiva", { precision: 3, scale: 2 }),
    scoreCompuesto: numeric("score_compuesto", { precision: 4, scale: 2 }),

    /** 'movible_por_marca' | 'parcialmente_movible' | 'estructural' */
    movilidad: text("movilidad"),
    movilidadRazon: text("movilidad_razon"),
    /** 'alta' | 'media' | 'baja_direccional' */
    confidence: text("confidence"),

    periodStart: date("period_start"),
    periodEnd: date("period_end"),

    citaProtagonista: jsonb("cita_protagonista"),
    rawData: jsonb("raw_data"),

    positionInLayer: integer("position_in_layer").notNull().default(0),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_findings_analysis_finding_id").on(table.tbAnalysisId, table.findingId),
    index("idx_tb_findings_kanban").on(table.tbAnalysisId, table.polarity, table.layer, table.positionInLayer),
    index("idx_tb_findings_top").on(table.tbAnalysisId, table.scoreCompuesto),
    index("idx_tb_findings_period").on(table.tbAnalysisId, table.periodStart, table.periodEnd)
  ]
);

export const tbFindingCitations = pgTable(
  "tb_finding_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => tbFindings.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    isProtagonist: boolean("is_protagonist").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_citations_finding_mention").on(table.findingId, table.mentionId),
    index("idx_tb_citations_finding").on(table.findingId, table.position),
    index("idx_tb_citations_mention").on(table.mentionId)
  ]
);

export const tbMentionCodings = pgTable(
  "tb_mention_codings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => tbFindings.id, { onDelete: "cascade" }),
    /** 'trigger' | 'barrier' | 'mixed' | 'irrelevant' */
    polarity: text("polarity").notNull(),
    layer: text("layer"),
    intensityScore: numeric("intensity_score", { precision: 3, scale: 2 }),
    emergentTags: text("emergent_tags").array(),
    ambiguous: boolean("ambiguous").notNull().default(false),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_codings_analysis_mention_finding").on(table.tbAnalysisId, table.mentionId, table.findingId),
    index("idx_tb_codings_analysis_finding").on(table.tbAnalysisId, table.findingId),
    index("idx_tb_codings_mention").on(table.mentionId),
    index("idx_tb_codings_analysis_polarity_layer").on(table.tbAnalysisId, table.polarity, table.layer)
  ]
);

export const tbRecommendations = pgTable(
  "tb_recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => tbFindings.id, { onDelete: "cascade" }),
    /** 'activation' | 'friction_removal' | 'structural_note' */
    kind: text("kind").notNull(),

    medioRecomendado: text("medio_recomendado"),
    tonoRecomendado: text("tono_recomendado"),
    riesgoSaturacion: text("riesgo_saturacion"),
    categoriaDondeAplica: text("categoria_donde_aplica").array(),

    intervencionSugerida: text("intervencion_sugerida"),
    tipoIntervencion: text("tipo_intervencion"),
    inversionEstimada: text("inversion_estimada"),
    indicadorExito: text("indicador_exito"),
    responsableSugerido: text("responsable_sugerido"),

    razonEstructural: text("razon_estructural"),
    recomendacion: text("recomendacion"),

    position: integer("position").notNull().default(0),
    createdAt: now()
  },
  (table) => [
    index("idx_tb_recs_analysis").on(table.tbAnalysisId, table.kind, table.position),
    index("idx_tb_recs_finding").on(table.findingId)
  ]
);

export const tbQualityGates = pgTable(
  "tb_quality_gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    gateName: text("gate_name").notNull(),
    passed: boolean("passed").notNull(),
    notes: text("notes"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow()
  },
  (table) => [
    unique("uq_tb_gates_analysis_gate").on(table.tbAnalysisId, table.gateName),
    index("idx_tb_gates_analysis").on(table.tbAnalysisId)
  ]
);

export const engineAnalyses = pgTable(
  "engine_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").references(() => corpusSnapshots.id, { onDelete: "set null" }),
    methodologySlug: text("methodology_slug").notNull(),
    methodologyVersion: text("methodology_version").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    status: text("status").notNull().default("running"),
    currentStep: text("current_step").notNull().default("preflight"),
    businessQuestion: text("business_question"),
    params: jsonb("params"),
    metaJson: jsonb("meta_json").notNull().default(sql`'{}'::jsonb`),
    limitations: jsonb("limitations").default(sql`'[]'::jsonb`),
    executedByUserId: uuid("executed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow(),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_engine_analyses_corpus").on(table.studyCorpusId, table.createdAt),
    index("idx_engine_analyses_slug").on(table.methodologySlug, table.status)
  ]
);

export const engineFindings = pgTable(
  "engine_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engineAnalysisId: uuid("engine_analysis_id")
      .notNull()
      .references(() => engineAnalyses.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    methodologySlug: text("methodology_slug").notNull(),
    findingKey: text("finding_key").notNull(),
    entityId: text("entity_id"),
    unitKind: text("unit_kind").notNull(),
    name: text("name").notNull(),
    dimensions: jsonb("dimensions").notNull().default(sql`'{}'::jsonb`),
    frequency: integer("frequency").notNull().default(0),
    intensity: numeric("intensity", { precision: 3, scale: 2 }),
    sentiment: numeric("sentiment", { precision: 4, scale: 3 }),
    sharePct: numeric("share_pct", { precision: 5, scale: 2 }),
    compositeScore: numeric("composite_score", { precision: 6, scale: 3 }),
    ownership: text("ownership"),
    differentiationIndex: numeric("differentiation_index", { precision: 4, scale: 3 }),
    confidence: text("confidence"),
    confidenceFactors: jsonb("confidence_factors"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    position: integer("position").notNull().default(0),
    createdAt: now()
  },
  (table) => [
    index("idx_engine_findings_analysis").on(table.engineAnalysisId, table.unitKind, table.position),
    index("idx_engine_findings_entity").on(table.engineAnalysisId, table.entityId),
    uniqueIndex("uq_engine_findings_key").on(table.engineAnalysisId, table.findingKey, sql`COALESCE(${table.entityId},'')`)
  ]
);

export const engineCodings = pgTable(
  "engine_codings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engineAnalysisId: uuid("engine_analysis_id")
      .notNull()
      .references(() => engineAnalyses.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    methodologySlug: text("methodology_slug").notNull(),
    mentionId: uuid("mention_id").references(() => mentions.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => brandKnowledgeSources.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => engineFindings.id, { onDelete: "set null" }),
    entityId: text("entity_id"),
    labels: jsonb("labels").notNull().default(sql`'{}'::jsonb`),
    intensity: numeric("intensity", { precision: 3, scale: 2 }),
    span: text("span"),
    ambiguous: boolean("ambiguous").notNull().default(false),
    createdAt: now()
  },
  (table) => [
    check("engine_coding_has_source", sql`${table.mentionId} IS NOT NULL OR ${table.sourceId} IS NOT NULL`),
    index("idx_engine_codings_analysis").on(table.engineAnalysisId, table.findingId),
    index("idx_engine_codings_mention").on(table.mentionId),
    index("idx_engine_codings_source").on(table.sourceId)
  ]
);

export const engineFindingCitations = pgTable(
  "engine_finding_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => engineFindings.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id").references(() => mentions.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => brandKnowledgeSources.id, { onDelete: "cascade" }),
    isProtagonist: boolean("is_protagonist").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: now()
  },
  (table) => [
    check("engine_citation_has_source", sql`${table.mentionId} IS NOT NULL OR ${table.sourceId} IS NOT NULL`),
    index("idx_engine_citations_finding").on(table.findingId, table.position)
  ]
);

export const engineRunMentionMap = pgTable(
  "engine_run_mention_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engineAnalysisId: uuid("engine_analysis_id")
      .notNull()
      .references(() => engineAnalyses.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    sourceStudyCorpusId: uuid("source_study_corpus_id").references(() => studyCorpora.id, { onDelete: "set null" }),
    queryPackId: uuid("query_pack_id").references(() => queryPacks.id, { onDelete: "set null" }),
    queryIterationId: uuid("query_iteration_id").references(() => queryIterations.id, { onDelete: "set null" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    lensSlug: text("lens_slug").notNull(),
    signalIntent: text("signal_intent"),
    scope: text("scope"),
    entityId: text("entity_id"),
    corpusEntityId: uuid("corpus_entity_id").references(() => corpusEntities.id, { onDelete: "set null" }),
    matchQuality: numeric("match_quality", { precision: 4, scale: 3 }),
    qualityScore: integer("quality_score"),
    selectionRank: integer("selection_rank").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("uq_engine_run_mention_map_analysis_mention").on(table.engineAnalysisId, table.mentionId),
    index("idx_engine_run_mention_map_analysis_rank").on(table.engineAnalysisId, table.selectionRank),
    index("idx_engine_run_mention_map_pack").on(table.queryPackId),
    index("idx_engine_run_mention_map_corpus_lens").on(table.studyCorpusId, table.lensSlug, table.scope, table.signalIntent)
  ]
);

export const canonicalSignals = pgTable(
  "canonical_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "set null" }),
    methodologySlug: text("methodology_slug").notNull(),
    signalType: text("signal_type").notNull(),
    canonicalTitle: text("canonical_title").notNull(),
    semanticKey: text("semantic_key").notNull(),
    description: text("description"),
    dimensions: jsonb("dimensions").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdFromTbFindingId: uuid("created_from_tb_finding_id").references(() => tbFindings.id, { onDelete: "set null" }),
    createdFromEngineFindingId: uuid("created_from_engine_finding_id").references(() => engineFindings.id, { onDelete: "set null" }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_canonical_signals_brand").on(table.brandId, table.methodologySlug, table.status),
    index("idx_canonical_signals_theme").on(table.themeId, table.methodologySlug, table.status),
    index("idx_canonical_signals_org").on(table.organizationId, table.status),
    index("idx_canonical_signals_corpus").on(table.studyCorpusId),
    uniqueIndex("uq_canonical_signal_scope_key").on(
      sql`COALESCE(${table.organizationId}::text, '')`,
      sql`COALESCE(${table.brandId}::text, '')`,
      sql`COALESCE(${table.themeId}::text, '')`,
      table.methodologySlug,
      table.signalType,
      table.semanticKey
    )
  ]
);

export const signalObservations = pgTable(
  "signal_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalSignalId: uuid("canonical_signal_id")
      .notNull()
      .references(() => canonicalSignals.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").references(() => corpusSnapshots.id, { onDelete: "set null" }),
    tbAnalysisId: uuid("tb_analysis_id").references(() => tbAnalyses.id, { onDelete: "set null" }),
    engineAnalysisId: uuid("engine_analysis_id").references(() => engineAnalyses.id, { onDelete: "set null" }),
    publishedOutputId: uuid("published_output_id").references(() => publishedOutputs.id, { onDelete: "set null" }),
    methodologySlug: text("methodology_slug").notNull(),
    signalType: text("signal_type").notNull(),
    windowStart: date("window_start"),
    windowEnd: date("window_end"),
    frequency: integer("frequency").notNull().default(0),
    sharePct: numeric("share_pct", { precision: 6, scale: 2 }),
    intensity: numeric("intensity", { precision: 3, scale: 2 }),
    sentiment: numeric("sentiment", { precision: 4, scale: 3 }),
    compositeScore: numeric("composite_score", { precision: 6, scale: 3 }),
    confidence: text("confidence"),
    rank: integer("rank"),
    deltaVsPrevious: numeric("delta_vs_previous", { precision: 8, scale: 3 }),
    status: text("status").notNull().default("observed"),
    metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_signal_observations_signal").on(table.canonicalSignalId, table.windowStart, table.windowEnd),
    index("idx_signal_observations_corpus").on(table.studyCorpusId, table.methodologySlug, table.signalType),
    index("idx_signal_observations_snapshot").on(table.snapshotId),
    index("idx_signal_observations_tb").on(table.tbAnalysisId),
    index("idx_signal_observations_engine").on(table.engineAnalysisId),
    uniqueIndex("uq_signal_observation_signal_snapshot")
      .on(table.canonicalSignalId, table.snapshotId)
      .where(sql`${table.snapshotId} IS NOT NULL`),
    uniqueIndex("uq_signal_observation_signal_tb_analysis")
      .on(table.canonicalSignalId, table.tbAnalysisId)
      .where(sql`${table.tbAnalysisId} IS NOT NULL`),
    uniqueIndex("uq_signal_observation_signal_engine_analysis")
      .on(table.canonicalSignalId, table.engineAnalysisId)
      .where(sql`${table.engineAnalysisId} IS NOT NULL`),
    uniqueIndex("uq_signal_observation_signal_output_window")
      .on(table.canonicalSignalId, table.publishedOutputId, table.windowStart, table.windowEnd)
      .where(sql`${table.publishedOutputId} IS NOT NULL AND ${table.snapshotId} IS NULL AND ${table.tbAnalysisId} IS NULL AND ${table.engineAnalysisId} IS NULL`)
  ]
);

export const signalObservationEvidence = pgTable(
  "signal_observation_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalObservationId: uuid("signal_observation_id")
      .notNull()
      .references(() => signalObservations.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id").references(() => mentions.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => brandKnowledgeSources.id, { onDelete: "cascade" }),
    tbFindingCitationId: uuid("tb_finding_citation_id").references(() => tbFindingCitations.id, { onDelete: "set null" }),
    engineFindingCitationId: uuid("engine_finding_citation_id").references(() => engineFindingCitations.id, { onDelete: "set null" }),
    quote: text("quote"),
    evidenceRole: text("evidence_role"),
    isProtagonist: boolean("is_protagonist").notNull().default(false),
    position: integer("position").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    check("signal_observation_evidence_has_source", sql`${table.mentionId} IS NOT NULL OR ${table.sourceId} IS NOT NULL`),
    index("idx_signal_observation_evidence_observation").on(table.signalObservationId, table.position),
    index("idx_signal_observation_evidence_mention").on(table.mentionId),
    index("idx_signal_observation_evidence_source").on(table.sourceId)
  ]
);

export const signalComposerEdits = pgTable(
  "signal_composer_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outputId: uuid("output_id")
      .notNull()
      .references(() => publishedOutputs.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    selection: jsonb("selection").notNull().default(sql`'{}'::jsonb`),
    draft: jsonb("draft").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("uq_signal_composer_edits_output").on(table.outputId),
    index("idx_signal_composer_edits_corpus").on(table.studyCorpusId, table.updatedAt)
  ]
);

export const enginePipelineSteps = pgTable(
  "engine_pipeline_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engineAnalysisId: uuid("engine_analysis_id")
      .notNull()
      .references(() => engineAnalyses.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    status: text("status").notNull().default("queued"),
    bullmqJobId: text("bullmq_job_id"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    resultSummary: jsonb("result_summary"),
    createdAt: now()
  },
  (table) => [index("idx_engine_steps_analysis").on(table.engineAnalysisId, table.createdAt)]
);

export const engineCostEvents = pgTable(
  "engine_cost_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engineAnalysisId: uuid("engine_analysis_id")
      .notNull()
      .references(() => engineAnalyses.id, { onDelete: "cascade" }),
    pipelineStepId: uuid("pipeline_step_id").references(() => enginePipelineSteps.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model"),
    operation: text("operation").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 4 }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_engine_cost_events_analysis").on(table.engineAnalysisId, table.createdAt),
    index("idx_engine_cost_events_step").on(table.pipelineStepId),
    index("idx_engine_cost_events_operation").on(table.operation, table.provider, table.model)
  ]
);

export const publishedOutputs = pgTable(
  "published_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    engineAnalysisId: uuid("engine_analysis_id").references(() => engineAnalyses.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "cascade" }),
    methodologySlug: text("methodology_slug").notNull(),
    outputType: text("output_type").notNull().default("narrative_dashboard"),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    headline: text("headline"),
    summary: text("summary"),
    manifest: jsonb("manifest").notNull().default(sql`'{}'::jsonb`),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check(
      "published_outputs_has_exactly_one_analysis",
      sql`((${table.tbAnalysisId} IS NOT NULL)::int + (${table.engineAnalysisId} IS NOT NULL)::int) = 1`
    ),
    index("idx_outputs_corpus").on(table.studyCorpusId, table.status, table.updatedAt),
    index("idx_outputs_brand").on(table.brandId, table.status, table.publishedAt),
    index("idx_outputs_analysis").on(table.tbAnalysisId),
    index("idx_outputs_engine_analysis").on(table.engineAnalysisId),
    unique("uq_outputs_analysis_type").on(table.tbAnalysisId, table.outputType),
    uniqueIndex("uq_outputs_engine_analysis_type")
      .on(table.engineAnalysisId, table.outputType)
      .where(sql`${table.engineAnalysisId} IS NOT NULL`)
  ]
);

export const tbPipelineSteps = pgTable(
  "tb_pipeline_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    /** queued | running | completed | failed | skipped */
    status: text("status").notNull().default("queued"),
    bullmqJobId: text("bullmq_job_id"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    resultSummary: jsonb("result_summary"),
    createdAt: now()
  },
  (table) => [index("idx_tb_steps_analysis").on(table.tbAnalysisId, table.createdAt)]
);

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  brands: many(brands),
  users: many(users),
  accountOwnerKam: one(users, {
    fields: [organizations.accountOwnerKamId],
    references: [users.id]
  })
}));

export const brandsRelations = relations(brands, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [brands.organizationId],
    references: [organizations.id]
  }),
  competitors: many(competitors),
  corpora: many(studyCorpora)
}));
