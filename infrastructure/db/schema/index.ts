import { relations, sql } from "drizzle-orm";
import {
  AnyPgColumn,
  bigint,
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
    corpusRevision: integer("corpus_revision").notNull().default(1),
    latestAssessedRevision: integer("latest_assessed_revision"),
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

export const signalWorkspaces = pgTable(
  "signal_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "restrict" }),
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check(
      "signal_workspaces_exactly_one_subject",
      sql`((${table.brandId} IS NOT NULL)::int + (${table.themeId} IS NOT NULL)::int) = 1`
    ),
    check("signal_workspaces_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("signal_workspaces_timezone_present", sql`btrim(${table.timezone}) <> ''`),
    check("signal_workspaces_status", sql`${table.status} IN ('active', 'paused', 'archived')`),
    unique("uq_signal_workspaces_org_slug").on(table.organizationId, table.slug),
    uniqueIndex("uq_signal_workspaces_brand")
      .on(table.organizationId, table.brandId)
      .where(sql`${table.brandId} IS NOT NULL`),
    uniqueIndex("uq_signal_workspaces_theme")
      .on(table.organizationId, table.themeId)
      .where(sql`${table.themeId} IS NOT NULL`),
    index("idx_signal_workspaces_org_status").on(table.organizationId, table.status, table.slug),
    index("idx_signal_workspaces_subject").on(table.brandId, table.themeId)
  ]
);

export const signalWorkspaceCorpora = pgTable(
  "signal_workspace_corpora",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("signal_workspace_corpora_role", sql`${table.role} IN ('operational', 'strategic', 'legacy')`),
    check("signal_workspace_corpora_validity", sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`),
    uniqueIndex("uq_signal_workspace_corpora_active")
      .on(table.workspaceId, table.studyCorpusId)
      .where(sql`${table.validTo} IS NULL`),
    index("idx_signal_workspace_corpora_workspace_active")
      .on(table.workspaceId, table.role, table.validFrom)
      .where(sql`${table.validTo} IS NULL`),
    index("idx_signal_workspace_corpora_corpus_active")
      .on(table.studyCorpusId, table.role, table.workspaceId)
      .where(sql`${table.validTo} IS NULL`)
  ]
);

export const signalRefreshPolicies = pgTable(
  "signal_refresh_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    adapterKey: text("adapter_key").notNull().default("manual_import"),
    cadence: text("cadence").notNull().default("manual"),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(false),
    expectedNextRun: timestamp("expected_next_run", { withTimezone: true }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("signal_refresh_policies_source_key_present", sql`btrim(${table.sourceKey}) <> ''`),
    check("signal_refresh_policies_adapter_key_present", sql`btrim(${table.adapterKey}) <> ''`),
    check("signal_refresh_policies_timezone_present", sql`btrim(${table.timezone}) <> ''`),
    check("signal_refresh_policies_cadence", sql`${table.cadence} IN ('manual', 'hourly', 'daily', 'weekly', 'monthly')`),
    check(
      "signal_refresh_policies_enabled_schedule",
      sql`${table.enabled} = false OR (${table.cadence} <> 'manual' AND ${table.expectedNextRun} IS NOT NULL)`
    ),
    unique("uq_signal_refresh_policies_workspace_source").on(table.workspaceId, table.sourceKey),
    index("idx_signal_refresh_policies_due")
      .on(table.expectedNextRun, table.workspaceId)
      .where(sql`${table.enabled} = true`),
    index("idx_signal_refresh_policies_data_source")
      .on(table.dataSourceId)
      .where(sql`${table.dataSourceId} IS NOT NULL`)
  ]
);

export const signalDataWatermarks = pgTable(
  "signal_data_watermarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").notNull().references(() => studyCorpora.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    sourceKey: text("source_key").notNull(),
    corpusRevision: integer("corpus_revision").notNull(),
    lastSourceSyncRunId: uuid("last_source_sync_run_id").references(() => sourceSyncRuns.id, { onDelete: "set null" }),
    lastImportBatchId: uuid("last_import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    maxObservedAt: timestamp("max_observed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    materializedAt: timestamp("materialized_at", { withTimezone: true }).notNull(),
    sourceFreshnessState: text("source_freshness_state").notNull().default("not_available"),
    dataFreshnessState: text("data_freshness_state").notNull().default("not_available"),
    staleAfter: timestamp("stale_after", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("signal_data_watermarks_revision_nonnegative", sql`${table.corpusRevision} >= 0`),
    check("signal_data_watermarks_source_state", sql`${table.sourceFreshnessState} IN ('fresh', 'stale', 'partial', 'failed', 'not_available')`),
    check("signal_data_watermarks_data_state", sql`${table.dataFreshnessState} IN ('fresh', 'stale', 'partial', 'not_available')`),
    check("signal_data_watermarks_materialized_after_accept", sql`${table.materializedAt} >= ${table.acceptedAt}`),
    unique("uq_signal_data_watermarks_scope").on(table.workspaceId, table.studyCorpusId, table.sourceKey),
    index("idx_signal_data_watermarks_workspace_freshness").on(table.workspaceId, table.dataFreshnessState, table.maxObservedAt),
    index("idx_signal_data_watermarks_corpus_source").on(table.studyCorpusId, table.sourceKey, table.acceptedAt)
  ]
);

export const signalRefreshRuns = pgTable(
  "signal_refresh_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refreshPolicyId: uuid("refresh_policy_id").references(() => signalRefreshPolicies.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    bullmqJobId: text("bullmq_job_id"),
    trigger: text("trigger").notNull().default("scheduled"),
    status: text("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(1),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorSummary: jsonb("error_summary").notNull().default(sql`'{}'::jsonb`),
    resultSummary: jsonb("result_summary").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("signal_refresh_runs_status", sql`${table.status} IN ('queued', 'running', 'completed', 'failed', 'dead_letter', 'skipped')`),
    check("signal_refresh_runs_trigger", sql`${table.trigger} IN ('scheduled', 'manual', 'import')`),
    check("signal_refresh_runs_attempt_positive", sql`${table.attempt} >= 1`),
    unique("uq_signal_refresh_runs_idempotency").on(table.idempotencyKey),
    index("idx_signal_refresh_runs_workspace_status").on(table.workspaceId, table.status, table.createdAt),
    index("idx_signal_refresh_runs_policy_status").on(table.refreshPolicyId, table.status, table.createdAt)
  ]
);

export const signalDataInvalidations = pgTable(
  "signal_data_invalidations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").notNull().references(() => studyCorpora.id, { onDelete: "cascade" }),
    dataWatermarkId: uuid("data_watermark_id").notNull().references(() => signalDataWatermarks.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason").notNull().default("data_accepted"),
    affectedFrom: date("affected_from"),
    affectedThrough: date("affected_through"),
    scope: jsonb("scope").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    errorSummary: jsonb("error_summary").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    processedAt: timestamp("processed_at", { withTimezone: true })
  },
  (table) => [
    check("signal_data_invalidations_status", sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')`),
    check("signal_data_invalidations_attempt_nonnegative", sql`${table.attempt} >= 0`),
    check("signal_data_invalidations_window", sql`${table.affectedFrom} IS NULL OR ${table.affectedThrough} IS NULL OR ${table.affectedFrom} <= ${table.affectedThrough}`),
    unique("uq_signal_data_invalidations_idempotency").on(table.idempotencyKey),
    index("idx_signal_data_invalidations_pending")
      .on(table.status, table.createdAt)
      .where(sql`${table.status} IN ('pending', 'failed')`),
    index("idx_signal_data_invalidations_scope").on(table.workspaceId, table.studyCorpusId, table.affectedFrom, table.affectedThrough)
  ]
);

export const signalInterpretationFreshness = pgTable(
  "signal_interpretation_freshness",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    metricGroupKey: text("metric_group_key").notNull(),
    filtersHash: text("filters_hash").notNull(),
    dataScope: jsonb("data_scope").notNull().default(sql`'{}'::jsonb`),
    dataWatermarkHash: text("data_watermark_hash"),
    interpretationWatermarkHash: text("interpretation_watermark_hash"),
    state: text("state").notNull().default("not_available"),
    reason: text("reason"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("signal_interpretation_freshness_state", sql`${table.state} IN ('fresh', 'stale', 'pending', 'partial', 'not_available')`),
    unique("uq_signal_interpretation_freshness_scope").on(table.workspaceId, table.metricGroupKey, table.filtersHash),
    index("idx_signal_interpretation_freshness_workspace_state").on(table.workspaceId, table.state, table.evaluatedAt)
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
    // The migration owns these two FKs. Keeping them as UUIDs here avoids the
    // circular TypeScript initializer query_iterations <-> validation_runs.
    latestQueryValidationRunId: uuid("latest_query_validation_run_id"),
    approvedQueryValidationRunId: uuid("approved_query_validation_run_id"),
    pipelineVersion: text("pipeline_version"),
    createdAt: now()
  },
  (table) => [
    unique("uq_query_iterations_corpus_iteration").on(table.studyCorpusId, table.iterationNumber),
    index("idx_qi_corpus").on(table.studyCorpusId),
    index("idx_qi_created").on(table.createdAt),
    index("idx_query_iterations_latest_validation").on(table.latestQueryValidationRunId),
    index("idx_query_iterations_approved_validation").on(table.approvedQueryValidationRunId)
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
    /** Stable retrieval identity inside the scope: brand, category, competitor:petco, etc. */
    entityKey: text("entity_key"),
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
    index("idx_query_packs_scope_entity").on(table.studyCorpusId, table.scope, table.entityKey),
    uniqueIndex("uq_query_packs_iteration_lens_intent_scope_entity").on(
      table.studyCorpusId,
      sql`COALESCE(${table.queryIterationId}::text, '')`,
      table.lensSlug,
      table.signalIntent,
      table.scope,
      sql`COALESCE(${table.entityKey}, '')`
    )
  ]
);

export const queryValidationRuns = pgTable(
  "query_validation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    queryIterationId: uuid("query_iteration_id")
      .notNull()
      .references(() => queryIterations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    sourceSystem: text("source_system").notNull().default("imported_corpus"),
    sourceProjectId: text("source_project_id"),
    sampleSizePerPack: integer("sample_size_per_pack").notNull().default(100),
    maxAttempts: integer("max_attempts").notNull().default(1),
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    pipelineVersion: text("pipeline_version").notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    index("idx_query_validation_runs_iteration").on(table.queryIterationId, table.startedAt),
    index("idx_query_validation_runs_corpus").on(table.studyCorpusId, table.startedAt)
  ]
);

export const queryValidationAttempts = pgTable(
  "query_validation_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryValidationRunId: uuid("query_validation_run_id")
      .notNull()
      .references(() => queryValidationRuns.id, { onDelete: "cascade" }),
    queryPackId: uuid("query_pack_id")
      .notNull()
      .references(() => queryPacks.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    queryText: text("query_text").notNull(),
    sampleSize: integer("sample_size").notNull().default(0),
    attemptKind: text("attempt_kind").notNull().default("refinement"),
    uniqueSampleSize: integer("unique_sample_size").notNull().default(0),
    status: text("status").notNull(),
    metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    proposedAdjustments: jsonb("proposed_adjustments").notNull().default(sql`'[]'::jsonb`),
    model: text("model"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("uq_query_validation_attempt").on(
      table.queryValidationRunId,
      table.queryPackId,
      table.attemptNumber
    ),
    index("idx_query_validation_attempts_pack").on(table.queryPackId, table.evaluatedAt),
    index("idx_query_validation_attempts_kind").on(
      table.queryValidationRunId,
      table.queryPackId,
      table.attemptKind
    )
  ]
);

export const queryValidationMentions = pgTable(
  "query_validation_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryValidationAttemptId: uuid("query_validation_attempt_id")
      .notNull()
      .references(() => queryValidationAttempts.id, { onDelete: "cascade" }),
    externalMentionId: text("external_mention_id").notNull(),
    relevance: text("relevance").notNull(),
    signalTypes: text("signal_types").array().notNull().default(emptyTextArray),
    reason: text("reason"),
    mentionMetadata: jsonb("mention_metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    unique("uq_query_validation_mention").on(table.queryValidationAttemptId, table.externalMentionId),
    index("idx_query_validation_mentions_attempt").on(table.queryValidationAttemptId, table.relevance)
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
    queryValidationRunId: uuid("query_validation_run_id")
      .references(() => queryValidationRuns.id, { onDelete: "set null" }),
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
    index("idx_import_batches_validation_run").on(table.queryValidationRunId),
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
    /** 'claude_instruction' | 'manual_bulk' | 'assessment_noise'. */
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

export const corpusAssessments = pgTable(
  "corpus_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    corpusRevision: integer("corpus_revision").notNull(),
    populationSize: integer("population_size").notNull(),
    sampleSize: integer("sample_size").notNull(),
    sampleStrategy: text("sample_strategy").notNull(),
    status: text("status").notNull().default("running"),
    readyForStudy: boolean("ready_for_study"),
    confidence: numeric("confidence", { precision: 5, scale: 2 }),
    verdict: text("verdict"),
    metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
    findings: jsonb("findings").notNull().default(sql`'{}'::jsonb`),
    model: text("model"),
    pipelineVersion: text("pipeline_version").notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    index("idx_corpus_assessments_revision").on(table.studyCorpusId, table.corpusRevision, table.startedAt),
    index("idx_corpus_assessments_status").on(table.studyCorpusId, table.status)
  ]
);

export const corpusAssessmentMentions = pgTable(
  "corpus_assessment_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    corpusAssessmentId: uuid("corpus_assessment_id")
      .notNull()
      .references(() => corpusAssessments.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    relevance: text("relevance").notNull(),
    signalTypes: text("signal_types").array().notNull().default(emptyTextArray),
    reason: text("reason"),
    classificationMetadata: jsonb("classification_metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    unique("uq_corpus_assessment_mention").on(table.corpusAssessmentId, table.mentionId),
    index("idx_corpus_assessment_mentions_assessment").on(table.corpusAssessmentId, table.relevance)
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

/**
 * Strategic opportunities are decision objects synthesized from multiple findings.
 * They are intentionally separate from tb_recommendations, which contains the
 * operational activation/friction-removal playbook.
 */
export const tbStrategicOpportunities = pgTable(
  "tb_strategic_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id").notNull(),
    title: text("title").notNull(),
    decision: text("decision").notNull(),
    whyNow: text("why_now").notNull(),
    level: text("level").notNull(),
    sourceMix: text("source_mix").array().notNull().default(emptyTextArray),
    evidenceSummary: text("evidence_summary").notNull(),
    whatToDo: text("what_to_do").notNull(),
    successSignal: text("success_signal").notNull(),
    confidence: text("confidence").notNull(),
    position: integer("position").notNull().default(0),
    rawData: jsonb("raw_data").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_strategic_opportunities_analysis_id").on(table.tbAnalysisId, table.opportunityId),
    index("idx_tb_strategic_opportunities_analysis").on(table.tbAnalysisId, table.position),
    index("idx_tb_strategic_opportunities_level").on(table.tbAnalysisId, table.level, table.confidence)
  ]
);

export const tbOpportunityFindings = pgTable(
  "tb_opportunity_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => tbStrategicOpportunities.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => tbFindings.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_opportunity_findings_pair").on(table.opportunityId, table.findingId),
    index("idx_tb_opportunity_findings_finding").on(table.findingId)
  ]
);

/** Action Studio is the prioritized execution layer, not an analytical finding. */
export const tbActionStudio = pgTable(
  "tb_action_studio",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    actionId: text("action_id").notNull(),
    targetTeam: text("target_team").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    primaryFindingId: uuid("primary_finding_id").references(() => tbFindings.id, { onDelete: "set null" }),
    rationale: text("rationale").notNull(),
    actionText: text("action_text").notNull(),
    suggestedChannel: text("suggested_channel"),
    suggestedFormat: text("suggested_format"),
    successSignal: text("success_signal").notNull(),
    estimatedEffort: text("estimated_effort").notNull(),
    estimatedImpact: text("estimated_impact").notNull(),
    confidence: text("confidence").notNull(),
    priorityRank: integer("priority_rank").notNull().default(0),
    rawData: jsonb("raw_data").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_action_studio_analysis_id").on(table.tbAnalysisId, table.actionId),
    index("idx_tb_action_studio_analysis").on(table.tbAnalysisId, table.priorityRank),
    index("idx_tb_action_studio_target").on(table.tbAnalysisId, table.targetTeam, table.kind)
  ]
);

export const tbActionFindings = pgTable(
  "tb_action_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => tbActionStudio.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => tbFindings.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_action_findings_pair").on(table.actionId, table.findingId),
    index("idx_tb_action_findings_finding").on(table.findingId)
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
    uniqueIndex("uq_signal_observation_signal_engine_analysis_window")
      .on(
        table.canonicalSignalId,
        table.engineAnalysisId,
        sql`COALESCE(${table.windowStart}, DATE '0001-01-01')`,
        sql`COALESCE(${table.windowEnd}, DATE '9999-12-31')`
      )
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

export const dataSources = pgTable(
  "data_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    provider: text("provider").notNull(),
    connectionMethod: text("connection_method").notNull(),
    name: text("name").notNull(),
    mapping: jsonb("mapping").notNull().default(sql`'{}'::jsonb`),
    mappingVersion: integer("mapping_version").notNull().default(1),
    role: jsonb("role").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("internal"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_data_sources_corpus").on(table.studyCorpusId, table.sourceType, table.status),
    index("idx_data_sources_brand").on(table.brandId, table.sourceType, table.status)
  ]
);

export const sourceSyncRuns = pgTable(
  "source_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    recordsTotal: integer("records_total"),
    recordsValid: integer("records_valid"),
    recordsDuplicate: integer("records_duplicate"),
    recordsFailed: integer("records_failed"),
    coverageStart: date("coverage_start"),
    coverageEnd: date("coverage_end"),
    errorSummary: jsonb("error_summary").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_source_sync_runs_source").on(table.dataSourceId, table.createdAt)
  ]
);

export const reportPeriods = pgTable(
  "report_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    granularity: text("granularity").notNull().default("month"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    label: text("label").notNull(),
    coverage: jsonb("coverage").notNull().default(sql`'{}'::jsonb`),
    comparable: boolean("comparable").notNull().default(true),
    comparabilityReasons: jsonb("comparability_reasons").notNull().default(sql`'[]'::jsonb`),
    confidence: text("confidence"),
    knownGaps: jsonb("known_gaps").notNull().default(sql`'[]'::jsonb`),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("uq_report_periods_corpus_grain_start").on(table.studyCorpusId, table.granularity, table.periodStart),
    index("idx_report_periods_corpus_window").on(table.studyCorpusId, table.granularity, table.periodStart, table.periodEnd)
  ]
);

export const signalPeriodMetrics = pgTable(
  "signal_period_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalSignalId: uuid("canonical_signal_id")
      .notNull()
      .references(() => canonicalSignals.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => reportPeriods.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    volume: integer("volume").notNull().default(0),
    engagement: numeric("engagement"),
    impactV1: numeric("impact_v1"),
    sentimentScore: numeric("sentiment_score"),
    polarityBucket: text("polarity_bucket"),
    dominantEmotion: text("dominant_emotion"),
    emotionDistribution: jsonb("emotion_distribution").notNull().default(sql`'{}'::jsonb`),
    sourceMix: jsonb("source_mix").notNull().default(sql`'{}'::jsonb`),
    evidenceCount: integer("evidence_count").notNull().default(0),
    confidence: text("confidence"),
    deltaPrev: numeric("delta_prev"),
    deltaWindowAvg: numeric("delta_window_avg"),
    rank: integer("rank"),
    lifecycleState: text("lifecycle_state"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("uq_signal_period_metrics_signal_period").on(table.canonicalSignalId, table.periodId),
    index("idx_signal_period_metrics_corpus_period").on(table.studyCorpusId, table.periodId, table.rank),
    index("idx_signal_period_metrics_signal").on(table.canonicalSignalId, table.computedAt)
  ]
);

export const marketingMoves = pgTable(
  "marketing_moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    engineAnalysisId: uuid("engine_analysis_id").references(() => engineAnalyses.id, { onDelete: "set null" }),
    periodId: uuid("period_id").references(() => reportPeriods.id, { onDelete: "set null" }),
    moveType: text("move_type").notNull(),
    actionText: text("action_text").notNull(),
    signalRefs: uuid("signal_refs").array().notNull().default(sql`ARRAY[]::uuid[]`),
    evidenceRefs: jsonb("evidence_refs").notNull().default(sql`'[]'::jsonb`),
    ownerSuggestion: text("owner_suggestion"),
    timing: text("timing"),
    measurementSuggestion: text("measurement_suggestion"),
    noGoNotes: text("no_go_notes"),
    confidence: text("confidence"),
    status: text("status").notNull().default("candidate"),
    position: integer("position"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_marketing_moves_corpus_period").on(table.studyCorpusId, table.periodId, table.status, table.position),
    index("idx_marketing_moves_engine").on(table.engineAnalysisId, table.status)
  ]
);

export const chartAggregates = pgTable(
  "chart_aggregates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    chartKey: text("chart_key").notNull(),
    periodId: uuid("period_id").references(() => reportPeriods.id, { onDelete: "cascade" }),
    filtersHash: text("filters_hash").notNull().default("default"),
    payload: jsonb("payload").notNull(),
    algoVersion: text("algo_version"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    staleAfter: timestamp("stale_after", { withTimezone: true })
  },
  (table) => [
    unique("uq_chart_aggregates_ref").on(table.studyCorpusId, table.chartKey, table.periodId, table.filtersHash),
    index("idx_chart_aggregates_lookup").on(table.studyCorpusId, table.chartKey, table.periodId)
  ]
);

export const performanceRecords = pgTable(
  "performance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    externalId: text("external_id").notNull(),
    entityKind: text("entity_kind").notNull(),
    entityName: text("entity_name"),
    parentExternalId: text("parent_external_id"),
    platform: text("platform").notNull(),
    channel: text("channel").notNull().default("paid"),
    objective: text("objective"),
    recordDate: date("record_date").notNull(),
    granularity: text("granularity").notNull().default("day"),
    spend: numeric("spend"),
    impressions: bigint("impressions", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    clicks: bigint("clicks", { mode: "number" }),
    videoViews: bigint("video_views", { mode: "number" }),
    engagement: bigint("engagement", { mode: "number" }),
    conversions: numeric("conversions"),
    ctr: numeric("ctr"),
    cpm: numeric("cpm"),
    cpc: numeric("cpc"),
    creativeText: text("creative_text"),
    creativeAssetRef: text("creative_asset_ref"),
    metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
    rawMetadata: jsonb("raw_metadata"),
    createdAt: now()
  },
  (table) => [
    unique("uq_performance_records_grain").on(table.studyCorpusId, table.platform, table.externalId, table.recordDate, table.granularity),
    index("idx_performance_records_date").on(table.studyCorpusId, table.recordDate),
    index("idx_performance_records_entity").on(table.studyCorpusId, table.entityKind, table.channel),
    index("idx_performance_records_source").on(table.dataSourceId, table.recordDate)
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
    kind: text("kind").notNull().default("signal"),
    outputType: text("output_type").notNull().default("narrative_dashboard"),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    headline: text("headline"),
    summary: text("summary"),
    manifest: jsonb("manifest").notNull().default(sql`'{}'::jsonb`),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    visibilityConfig: jsonb("visibility_config").notNull().default(sql`'{}'::jsonb`),
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
    index("idx_outputs_kind_status").on(table.kind, table.status, table.updatedAt),
    index("idx_outputs_brand").on(table.brandId, table.status, table.publishedAt),
    index("idx_outputs_analysis").on(table.tbAnalysisId),
    index("idx_outputs_engine_analysis").on(table.engineAnalysisId),
    unique("uq_outputs_analysis_type").on(table.tbAnalysisId, table.outputType),
    uniqueIndex("uq_outputs_engine_analysis_type")
      .on(table.engineAnalysisId, table.outputType)
      .where(sql`${table.engineAnalysisId} IS NOT NULL`)
  ]
);

/**
 * Methodology-neutral registry for independently addressable analysis output.
 * Domain tables (for example tb_findings) keep their typed columns; this layer
 * gives Review, Signal and lineage one stable artifact contract.
 */
export const analysisArtifacts = pgTable(
  "analysis_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    tbAnalysisId: uuid("tb_analysis_id").references(() => tbAnalyses.id, { onDelete: "cascade" }),
    engineAnalysisId: uuid("engine_analysis_id").references(() => engineAnalyses.id, { onDelete: "cascade" }),
    artifactKey: text("artifact_key").notNull(),
    artifactType: text("artifact_type").notNull(),
    sourceEntityType: text("source_entity_type"),
    sourceEntityId: uuid("source_entity_id"),
    title: text("title"),
    summary: text("summary"),
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    confidence: text("confidence"),
    reviewStatus: text("review_status").notNull().default("draft"),
    revision: integer("revision").notNull().default(1),
    position: integer("position").notNull().default(0),
    supersedesArtifactId: uuid("supersedes_artifact_id").references(
      (): AnyPgColumn => analysisArtifacts.id,
      { onDelete: "set null" }
    ),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check(
      "analysis_artifacts_exactly_one_analysis",
      sql`((${table.tbAnalysisId} IS NOT NULL)::int + (${table.engineAnalysisId} IS NOT NULL)::int) = 1`
    ),
    check(
      "analysis_artifacts_source_pair",
      sql`(${table.sourceEntityType} IS NULL AND ${table.sourceEntityId} IS NULL)
        OR (${table.sourceEntityType} IS NOT NULL AND ${table.sourceEntityId} IS NOT NULL)`
    ),
    check(
      "analysis_artifacts_review_status",
      sql`${table.reviewStatus} IN ('draft', 'needs_review', 'accepted', 'corrected', 'rejected', 'limited')`
    ),
    check("analysis_artifacts_revision_positive", sql`${table.revision} >= 1`),
    uniqueIndex("uq_analysis_artifacts_tb_key_revision")
      .on(table.tbAnalysisId, table.artifactKey, table.revision)
      .where(sql`${table.tbAnalysisId} IS NOT NULL`),
    uniqueIndex("uq_analysis_artifacts_engine_key_revision")
      .on(table.engineAnalysisId, table.artifactKey, table.revision)
      .where(sql`${table.engineAnalysisId} IS NOT NULL`),
    uniqueIndex("uq_analysis_artifacts_source_revision")
      .on(table.sourceEntityType, table.sourceEntityId, table.revision)
      .where(sql`${table.sourceEntityType} IS NOT NULL AND ${table.sourceEntityId} IS NOT NULL`),
    index("idx_analysis_artifacts_corpus_type").on(
      table.studyCorpusId,
      table.artifactType,
      table.reviewStatus,
      table.position
    ),
    index("idx_analysis_artifacts_tb").on(table.tbAnalysisId, table.artifactType, table.position),
    index("idx_analysis_artifacts_engine").on(table.engineAnalysisId, table.artifactType, table.position)
  ]
);

export const analysisEvidenceGroups = pgTable(
  "analysis_evidence_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => analysisArtifacts.id, { onDelete: "cascade" }),
    groupKey: text("group_key").notNull(),
    role: text("role").notNull().default("supporting"),
    label: text("label"),
    summary: text("summary"),
    position: integer("position").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check(
      "analysis_evidence_groups_role",
      sql`${table.role} IN ('supporting', 'protagonist', 'counter', 'contextual', 'denominator', 'limitation')`
    ),
    unique("uq_analysis_evidence_groups_artifact_key").on(table.artifactId, table.groupKey),
    index("idx_analysis_evidence_groups_artifact").on(table.artifactId, table.role, table.position)
  ]
);

export const analysisEvidenceLinks = pgTable(
  "analysis_evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceGroupId: uuid("evidence_group_id")
      .notNull()
      .references(() => analysisEvidenceGroups.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    relationType: text("relation_type").notNull().default("supports"),
    evidenceRole: text("evidence_role").notNull().default("supporting"),
    quote: text("quote"),
    locator: jsonb("locator").notNull().default(sql`'{}'::jsonb`),
    confidence: text("confidence"),
    weight: numeric("weight", { precision: 5, scale: 4 }),
    position: integer("position").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    check(
      "analysis_evidence_links_weight_range",
      sql`${table.weight} IS NULL OR (${table.weight} >= 0 AND ${table.weight} <= 1)`
    ),
    unique("uq_analysis_evidence_links_source").on(
      table.evidenceGroupId,
      table.sourceType,
      table.sourceId,
      table.relationType
    ),
    index("idx_analysis_evidence_links_group").on(table.evidenceGroupId, table.position),
    index("idx_analysis_evidence_links_source").on(table.sourceType, table.sourceId)
  ]
);

export const analysisArtifactRelations = pgTable(
  "analysis_artifact_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => analysisArtifacts.id, { onDelete: "cascade" }),
    targetArtifactId: uuid("target_artifact_id")
      .notNull()
      .references(() => analysisArtifacts.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    position: integer("position").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    check("analysis_artifact_relations_no_self", sql`${table.sourceArtifactId} <> ${table.targetArtifactId}`),
    unique("uq_analysis_artifact_relations_pair").on(
      table.sourceArtifactId,
      table.targetArtifactId,
      table.relationType
    ),
    index("idx_analysis_artifact_relations_source").on(
      table.sourceArtifactId,
      table.relationType,
      table.position
    ),
    index("idx_analysis_artifact_relations_target").on(table.targetArtifactId, table.relationType)
  ]
);

export const analysisArtifactReviewEvents = pgTable(
  "analysis_artifact_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => analysisArtifacts.id, { onDelete: "cascade" }),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    previousStatus: text("previous_status"),
    nextStatus: text("next_status").notNull(),
    patch: jsonb("patch").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    createdAt: now()
  },
  (table) => [
    index("idx_analysis_artifact_review_events_artifact").on(table.artifactId, table.createdAt),
    index("idx_analysis_artifact_review_events_reviewer").on(table.reviewerUserId, table.createdAt)
  ]
);

export const publishedOutputArtifacts = pgTable(
  "published_output_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publishedOutputId: uuid("published_output_id")
      .notNull()
      .references(() => publishedOutputs.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => analysisArtifacts.id, { onDelete: "cascade" }),
    artifactRevision: integer("artifact_revision").notNull(),
    position: integer("position").notNull().default(0),
    visibility: text("visibility").notNull().default("published"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    check("published_output_artifacts_revision_positive", sql`${table.artifactRevision} >= 1`),
    unique("uq_published_output_artifacts_pair").on(table.publishedOutputId, table.artifactId),
    index("idx_published_output_artifacts_output").on(
      table.publishedOutputId,
      table.visibility,
      table.position
    ),
    index("idx_published_output_artifacts_artifact").on(table.artifactId)
  ]
);

export const dataAssets = pgTable(
  "data_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    assetKind: text("asset_kind").notNull(),
    layer: text("layer").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    ownerTeam: text("owner_team"),
    sensitivity: text("sensitivity").notNull().default("internal"),
    status: text("status").notNull().default("active"),
    storageRef: text("storage_ref"),
    rowCount: bigint("row_count", { mode: "number" }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_data_assets_scope").on(table.organizationId, table.brandId, table.studyCorpusId, table.layer),
    index("idx_data_assets_source").on(table.dataSourceId, table.layer, table.status),
    unique("uq_data_assets_scope_name_layer").on(table.studyCorpusId, table.name, table.layer)
  ]
);

export const dataAssetFields = pgTable(
  "data_asset_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataAssetId: uuid("data_asset_id")
      .notNull()
      .references(() => dataAssets.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    fieldType: text("field_type"),
    semanticType: text("semantic_type"),
    nullable: boolean("nullable"),
    description: text("description"),
    examples: jsonb("examples").notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [unique("uq_data_asset_fields_asset_field").on(table.dataAssetId, table.fieldName)]
);

export const dataAssetRecords = pgTable(
  "data_asset_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    dataAssetId: uuid("data_asset_id")
      .notNull()
      .references(() => dataAssets.id, { onDelete: "cascade" }),
    knowledgeSourceId: uuid("knowledge_source_id").references(() => brandKnowledgeSources.id, { onDelete: "set null" }),
    sourceSyncRunId: uuid("source_sync_run_id").references(() => sourceSyncRuns.id, { onDelete: "set null" }),
    datasetKey: text("dataset_key").notNull(),
    datasetName: text("dataset_name"),
    datasetRole: text("dataset_role"),
    rowIndex: integer("row_index").notNull(),
    recordHash: text("record_hash").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    periodGrain: text("period_grain").notNull().default("unknown"),
    periodSemantics: text("period_semantics").notNull().default("unknown"),
    entityType: text("entity_type"),
    entityKey: text("entity_key"),
    entityLabel: text("entity_label"),
    dimensions: jsonb("dimensions").notNull().default(sql`'{}'::jsonb`),
    recordData: jsonb("record_data").notNull().default(sql`'{}'::jsonb`),
    lineage: jsonb("lineage").notNull().default(sql`'{}'::jsonb`),
    qualityStatus: text("quality_status").notNull().default("accepted"),
    qualityIssues: jsonb("quality_issues").notNull().default(sql`'[]'::jsonb`),
    materializedAt: timestamp("materialized_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now()
  },
  (table) => [
    unique("uq_data_asset_records_asset_dataset_row").on(table.dataAssetId, table.datasetKey, table.rowIndex),
    index("idx_data_asset_records_corpus_role").on(table.studyCorpusId, table.datasetRole, table.qualityStatus),
    index("idx_data_asset_records_asset_dataset").on(table.dataAssetId, table.datasetKey),
    index("idx_data_asset_records_entity").on(table.studyCorpusId, table.entityType, table.entityKey),
    index("idx_data_asset_records_period").on(table.studyCorpusId, table.periodGrain, table.periodStart),
    index("idx_data_asset_records_knowledge_source").on(table.knowledgeSourceId)
  ]
);

export const dataContracts = pgTable(
  "data_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataAssetId: uuid("data_asset_id")
      .notNull()
      .references(() => dataAssets.id, { onDelete: "cascade" }),
    contractName: text("contract_name").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    schemaContract: jsonb("schema_contract").notNull().default(sql`'{}'::jsonb`),
    qualityContract: jsonb("quality_contract").notNull().default(sql`'{}'::jsonb`),
    freshnessContract: jsonb("freshness_contract").notNull().default(sql`'{}'::jsonb`),
    semanticContract: jsonb("semantic_contract").notNull().default(sql`'{}'::jsonb`),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_data_contracts_asset_status").on(table.dataAssetId, table.status),
    unique("uq_data_contracts_asset_name_version").on(table.dataAssetId, table.contractName, table.version)
  ]
);

export const dataQualityRules = pgTable(
  "data_quality_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataContractId: uuid("data_contract_id").references(() => dataContracts.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(),
    ruleType: text("rule_type").notNull(),
    severity: text("severity").notNull().default("warning"),
    definition: jsonb("definition").notNull().default(sql`'{}'::jsonb`),
    active: boolean("active").notNull().default(true),
    createdAt: now()
  },
  (table) => [
    index("idx_data_quality_rules_contract").on(table.dataContractId, table.active),
    unique("uq_data_quality_rules_contract_key").on(table.dataContractId, table.ruleKey)
  ]
);

export const dataQualityResults = pgTable(
  "data_quality_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataQualityRuleId: uuid("data_quality_rule_id").references(() => dataQualityRules.id, { onDelete: "set null" }),
    dataAssetId: uuid("data_asset_id").references(() => dataAssets.id, { onDelete: "cascade" }),
    sourceSyncRunId: uuid("source_sync_run_id").references(() => sourceSyncRuns.id, { onDelete: "set null" }),
    engineAnalysisId: uuid("engine_analysis_id").references(() => engineAnalyses.id, { onDelete: "set null" }),
    resultKey: text("result_key").notNull().default("default"),
    status: text("status").notNull(),
    observedValue: jsonb("observed_value").notNull().default(sql`'{}'::jsonb`),
    expectedValue: jsonb("expected_value").notNull().default(sql`'{}'::jsonb`),
    sampleRefs: jsonb("sample_refs").notNull().default(sql`'[]'::jsonb`),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("idx_data_quality_results_asset").on(table.dataAssetId, table.checkedAt),
    index("idx_data_quality_results_run").on(table.sourceSyncRunId, table.status),
    index("idx_data_quality_results_engine").on(table.engineAnalysisId, table.status),
    unique("uq_data_quality_results_asset_key").on(table.dataAssetId, table.resultKey)
  ]
);

export const dataObservations = pgTable(
  "data_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    dataAssetId: uuid("data_asset_id").references(() => dataAssets.id, { onDelete: "set null" }),
    knowledgeSourceId: uuid("knowledge_source_id").references(() => brandKnowledgeSources.id, { onDelete: "set null" }),
    sourceSyncRunId: uuid("source_sync_run_id").references(() => sourceSyncRuns.id, { onDelete: "set null" }),
    datasetKey: text("dataset_key").notNull(),
    datasetName: text("dataset_name"),
    datasetRole: text("dataset_role"),
    rowIndex: integer("row_index"),
    recordHash: text("record_hash").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    periodGrain: text("period_grain").notNull().default("unknown"),
    entityType: text("entity_type"),
    entityKey: text("entity_key"),
    entityLabel: text("entity_label"),
    metricKey: text("metric_key").notNull(),
    metricFamily: text("metric_family").notNull(),
    metricValue: numeric("metric_value").notNull(),
    metricUnit: text("metric_unit"),
    metricCurrencyCode: text("metric_currency_code"),
    periodSemantics: text("period_semantics").notNull().default("unknown"),
    dimensions: jsonb("dimensions").notNull().default(sql`'{}'::jsonb`),
    rawRecord: jsonb("raw_record").notNull().default(sql`'{}'::jsonb`),
    lineage: jsonb("lineage").notNull().default(sql`'{}'::jsonb`),
    qualityStatus: text("quality_status").notNull().default("accepted"),
    qualityIssues: jsonb("quality_issues").notNull().default(sql`'[]'::jsonb`),
    materializedAt: timestamp("materialized_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now()
  },
  (table) => [
    unique("uq_data_observations_source_metric_row").on(
      table.dataSourceId,
      table.dataAssetId,
      table.datasetKey,
      table.rowIndex,
      table.metricKey
    ),
    index("idx_data_observations_corpus_period_metric").on(
      table.studyCorpusId,
      table.periodGrain,
      table.periodStart,
      table.metricKey
    ),
    index("idx_data_observations_brand_metric_period").on(table.brandId, table.metricKey, table.periodStart),
    index("idx_data_observations_asset").on(table.dataAssetId, table.datasetKey),
    index("idx_data_observations_knowledge_source").on(table.knowledgeSourceId),
    index("idx_data_observations_entity").on(table.studyCorpusId, table.entityType, table.entityKey),
    index("idx_data_observations_corpus_quality").on(table.studyCorpusId, table.qualityStatus, table.datasetRole),
    index("idx_data_observations_currency").on(table.studyCorpusId, table.metricCurrencyCode, table.periodStart)
  ]
);

export const brandOsProfiles = pgTable(
  "brand_os_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("brand_os_profile_has_subject", sql`${table.brandId} IS NOT NULL OR ${table.themeId} IS NOT NULL`),
    index("idx_brand_os_profiles_scope").on(table.organizationId, table.brandId, table.themeId, table.status),
    uniqueIndex("uq_brand_os_profiles_brand_version")
      .on(table.brandId, table.version)
      .where(sql`${table.brandId} IS NOT NULL`),
    uniqueIndex("uq_brand_os_profiles_theme_version")
      .on(table.themeId, table.version)
      .where(sql`${table.themeId} IS NOT NULL`)
  ]
);

export const brandOsObjectives = pgTable(
  "brand_os_objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    objectiveType: text("objective_type").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    successCriteria: jsonb("success_criteria").notNull().default(sql`'{}'::jsonb`),
    priority: integer("priority"),
    activeFrom: date("active_from"),
    activeTo: date("active_to"),
    status: text("status").notNull().default("active"),
    createdAt: now()
  },
  (table) => [
    index("idx_brand_os_objectives_profile").on(table.brandOsProfileId, table.status, table.priority),
    unique("uq_brand_os_objectives_profile_type_name").on(table.brandOsProfileId, table.objectiveType, table.name)
  ]
);

export const brandOsBriefs = pgTable(
  "brand_os_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    objectiveId: uuid("objective_id").references(() => brandOsObjectives.id, { onDelete: "set null" }),
    knowledgeSourceId: uuid("knowledge_source_id").references(() => brandKnowledgeSources.id, { onDelete: "set null" }),
    briefType: text("brief_type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    sourceKind: text("source_kind"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_brand_os_briefs_profile").on(table.brandOsProfileId, table.briefType, table.status),
    index("idx_brand_os_briefs_objective").on(table.objectiveId, table.status),
    index("idx_brand_os_briefs_source")
      .on(table.knowledgeSourceId)
      .where(sql`${table.knowledgeSourceId} IS NOT NULL`),
    unique("uq_brand_os_briefs_profile_corpus_type_title").on(
      table.brandOsProfileId,
      table.studyCorpusId,
      table.briefType,
      table.title
    )
  ]
);

export const brandOsAudiences = pgTable(
  "brand_os_audiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    createdAt: now()
  },
  (table) => [
    index("idx_brand_os_audiences_profile").on(table.brandOsProfileId, table.status),
    unique("uq_brand_os_audiences_profile_name").on(table.brandOsProfileId, table.name)
  ]
);

export const brandOsProducts = pgTable(
  "brand_os_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    productType: text("product_type"),
    description: text("description"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    createdAt: now()
  },
  (table) => [
    index("idx_brand_os_products_profile").on(table.brandOsProfileId, table.status),
    unique("uq_brand_os_products_profile_name").on(table.brandOsProfileId, table.name)
  ]
);

export const brandOsClaims = pgTable(
  "brand_os_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    claimText: text("claim_text").notNull(),
    claimType: text("claim_type"),
    status: text("status").notNull().default("active"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_brand_os_claims_profile").on(table.brandOsProfileId, table.status, table.claimType),
    unique("uq_brand_os_claims_profile_text").on(table.brandOsProfileId, table.claimText)
  ]
);

export const brandOsCampaigns = pgTable(
  "brand_os_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    externalId: text("external_id"),
    campaignType: text("campaign_type"),
    channelMix: jsonb("channel_mix").notNull().default(sql`'{}'::jsonb`),
    activeFrom: date("active_from"),
    activeTo: date("active_to"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_brand_os_campaigns_profile").on(table.brandOsProfileId, table.activeFrom, table.activeTo),
    unique("uq_brand_os_campaigns_external").on(table.brandOsProfileId, table.externalId)
  ]
);

export const brandOsCompetitors = pgTable(
  "brand_os_competitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    competitorName: text("competitor_name").notNull(),
    competitorBrandSeedId: uuid("competitor_brand_seed_id").references(() => brandSeeds.id, { onDelete: "set null" }),
    role: text("role"),
    priority: integer("priority"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_brand_os_competitors_profile").on(table.brandOsProfileId, table.priority),
    unique("uq_brand_os_competitors_profile_name").on(table.brandOsProfileId, table.competitorName)
  ]
);

export const brandOsEvents = pgTable(
  "brand_os_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    eventType: text("event_type"),
    eventDate: date("event_date"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [index("idx_brand_os_events_profile_date").on(table.brandOsProfileId, table.eventDate)]
);

export const brandOsSeedSets = pgTable(
  "brand_os_seed_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    seedSetType: text("seed_set_type").notNull(),
    objectiveId: uuid("objective_id").references(() => brandOsObjectives.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_brand_os_seed_sets_profile").on(table.brandOsProfileId, table.seedSetType, table.status),
    unique("uq_brand_os_seed_sets_profile_type_name").on(table.brandOsProfileId, table.seedSetType, table.name)
  ]
);

export const brandOsSeedTerms = pgTable(
  "brand_os_seed_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seedSetId: uuid("seed_set_id")
      .notNull()
      .references(() => brandOsSeedSets.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    termType: text("term_type").notNull().default("keyword"),
    brandSeedId: uuid("brand_seed_id").references(() => brandSeeds.id, { onDelete: "set null" }),
    weight: numeric("weight"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [unique("uq_brand_os_seed_terms_set_term").on(table.seedSetId, table.term)]
);

export const brandOsLinks = pgTable(
  "brand_os_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandOsProfileId: uuid("brand_os_profile_id")
      .notNull()
      .references(() => brandOsProfiles.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    relationType: text("relation_type").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_brand_os_links_source").on(table.sourceType, table.sourceId),
    index("idx_brand_os_links_target").on(table.targetType, table.targetId),
    unique("uq_brand_os_links_relation").on(table.sourceType, table.sourceId, table.targetType, table.targetId, table.relationType)
  ]
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    knowledgeSourceId: uuid("knowledge_source_id")
      .notNull()
      .references(() => brandKnowledgeSources.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    tokenCount: integer("token_count"),
    embeddingStatus: text("embedding_status").notNull().default("pending"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_knowledge_chunks_source").on(table.knowledgeSourceId, table.chunkIndex),
    unique("uq_knowledge_chunks_source_index").on(table.knowledgeSourceId, table.chunkIndex)
  ]
);

export const knowledgeAssertions = pgTable(
  "knowledge_assertions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    knowledgeSourceId: uuid("knowledge_source_id").references(() => brandKnowledgeSources.id, { onDelete: "set null" }),
    assertionText: text("assertion_text").notNull(),
    assertionType: text("assertion_type").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    confidence: text("confidence"),
    status: text("status").notNull().default("candidate"),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_knowledge_assertions_source").on(table.knowledgeSourceId, table.status, table.assertionType),
    unique("uq_knowledge_assertions_source_type_text").on(table.knowledgeSourceId, table.assertionType, table.assertionText)
  ]
);

export const knowledgeAssertionLinks = pgTable(
  "knowledge_assertion_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    knowledgeAssertionId: uuid("knowledge_assertion_id")
      .notNull()
      .references(() => knowledgeAssertions.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    relationType: text("relation_type").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_knowledge_assertion_links_target").on(table.targetType, table.targetId),
    unique("uq_knowledge_assertion_links_relation").on(table.knowledgeAssertionId, table.targetType, table.targetId, table.relationType)
  ]
);

export const knowledgeAssertionReviewEvents = pgTable(
  "knowledge_assertion_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    knowledgeAssertionId: uuid("knowledge_assertion_id").references(() => knowledgeAssertions.id, { onDelete: "cascade" }),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    previousValue: jsonb("previous_value").notNull().default(sql`'{}'::jsonb`),
    nextValue: jsonb("next_value").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    createdAt: now()
  },
  (table) => [index("idx_knowledge_assertion_review_events_assertion").on(table.knowledgeAssertionId, table.createdAt)]
);

export const knowledgeUsageEvents = pgTable(
  "knowledge_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    knowledgeSourceId: uuid("knowledge_source_id").references(() => brandKnowledgeSources.id, { onDelete: "set null" }),
    knowledgeChunkId: uuid("knowledge_chunk_id").references(() => knowledgeChunks.id, { onDelete: "set null" }),
    knowledgeAssertionId: uuid("knowledge_assertion_id").references(() => knowledgeAssertions.id, { onDelete: "set null" }),
    engineAnalysisId: uuid("engine_analysis_id").references(() => engineAnalyses.id, { onDelete: "set null" }),
    usageType: text("usage_type").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_knowledge_usage_analysis").on(table.engineAnalysisId, table.usageType),
    index("idx_knowledge_usage_source").on(table.knowledgeSourceId, table.createdAt)
  ]
);

export const taxonomies = pgTable(
  "taxonomies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxonomyKey: text("taxonomy_key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    scope: text("scope").notNull().default("global"),
    methodologySlug: text("methodology_slug"),
    status: text("status").notNull().default("active"),
    createdAt: now()
  },
  (table) => [index("idx_taxonomies_scope").on(table.scope, table.methodologySlug, table.status)]
);

export const taxonomyTerms = pgTable(
  "taxonomy_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxonomyId: uuid("taxonomy_id")
      .notNull()
      .references(() => taxonomies.id, { onDelete: "cascade" }),
    termKey: text("term_key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    parentTermId: uuid("parent_term_id").references((): AnyPgColumn => taxonomyTerms.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    createdAt: now()
  },
  (table) => [
    index("idx_taxonomy_terms_taxonomy_parent").on(table.taxonomyId, table.parentTermId, table.status),
    unique("uq_taxonomy_terms_taxonomy_key").on(table.taxonomyId, table.termKey)
  ]
);

export const taxonomyTermEdges = pgTable(
  "taxonomy_term_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromTermId: uuid("from_term_id")
      .notNull()
      .references(() => taxonomyTerms.id, { onDelete: "cascade" }),
    toTermId: uuid("to_term_id")
      .notNull()
      .references(() => taxonomyTerms.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`)
  },
  (table) => [unique("uq_taxonomy_term_edges_relation").on(table.fromTermId, table.toTermId, table.relationType)]
);

export const methodologyTaxonomyBindings = pgTable(
  "methodology_taxonomy_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    methodologySlug: text("methodology_slug").notNull(),
    taxonomyId: uuid("taxonomy_id")
      .notNull()
      .references(() => taxonomies.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    required: boolean("required").notNull().default(false),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`)
  },
  (table) => [unique("uq_methodology_taxonomy_bindings_role").on(table.methodologySlug, table.taxonomyId, table.role)]
);

export const taggingRuleSets = pgTable(
  "tagging_rule_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleSetKey: text("rule_set_key").notNull(),
    version: integer("version").notNull().default(1),
    methodologySlug: text("methodology_slug"),
    subjectType: text("subject_type").notNull().default("mention"),
    scope: text("scope").notNull().default("global"),
    taxonomyId: uuid("taxonomy_id").references(() => taxonomies.id, { onDelete: "set null" }),
    rules: jsonb("rules").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_tagging_rule_sets_scope").on(table.scope, table.methodologySlug, table.subjectType, table.status),
    index("idx_tagging_rule_sets_taxonomy").on(table.taxonomyId, table.status),
    unique("uq_tagging_rule_sets_key_version").on(table.ruleSetKey, table.version)
  ]
);

export const taggingModelVersions = pgTable(
  "tagging_model_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelKey: text("model_key").notNull(),
    provider: text("provider"),
    version: text("version").notNull(),
    methodologySlug: text("methodology_slug"),
    taggingRuleSetId: uuid("tagging_rule_set_id").references(() => taggingRuleSets.id, { onDelete: "set null" }),
    promptHash: text("prompt_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [unique("uq_tagging_model_versions_key_version").on(table.modelKey, table.version)]
);

export const intelligenceEntities = pgTable(
  "intelligence_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id").references(() => themes.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    canonicalName: text("canonical_name").notNull(),
    externalId: text("external_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_intelligence_entities_scope").on(table.organizationId, table.brandId, table.entityType, table.status),
    uniqueIndex("uq_intelligence_entities_type_external")
      .on(table.entityType, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`)
  ]
);

export const entityAliases = pgTable(
  "entity_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => intelligenceEntities.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    aliasType: text("alias_type"),
    source: text("source"),
    confidence: numeric("confidence"),
    createdAt: now()
  },
  (table) => [
    index("idx_entity_aliases_alias").on(table.alias),
    unique("uq_entity_aliases_entity_alias").on(table.entityId, table.alias)
  ]
);

export const entityLinks = pgTable(
  "entity_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => intelligenceEntities.id, { onDelete: "cascade" }),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => intelligenceEntities.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [unique("uq_entity_links_relation").on(table.sourceEntityId, table.targetEntityId, table.relationType)]
);

export const recordEntityLinks = pgTable(
  "record_entity_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => intelligenceEntities.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    confidence: text("confidence"),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_record_entity_links_subject").on(table.subjectType, table.subjectId),
    index("idx_record_entity_links_entity").on(table.entityId, table.relationType),
    unique("uq_record_entity_links_subject_entity_relation").on(table.subjectType, table.subjectId, table.entityId, table.relationType)
  ]
);

export const recordTags = pgTable(
  "record_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    taxonomyTermId: uuid("taxonomy_term_id")
      .notNull()
      .references(() => taxonomyTerms.id, { onDelete: "cascade" }),
    value: text("value"),
    score: numeric("score"),
    confidence: text("confidence"),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    source: text("source").notNull().default("system"),
    modelVersionId: uuid("model_version_id").references(() => taggingModelVersions.id, { onDelete: "set null" }),
    tbAnalysisId: uuid("tb_analysis_id").references(() => tbAnalyses.id, { onDelete: "cascade" }),
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    createdAt: now()
  },
  (table) => [
    index("idx_record_tags_scope").on(table.studyCorpusId, table.subjectType, table.taxonomyTermId),
    index("idx_record_tags_subject").on(table.subjectType, table.subjectId),
    index("idx_record_tags_review").on(table.studyCorpusId, table.reviewStatus),
    index("idx_record_tags_tb_analysis").on(table.tbAnalysisId, table.subjectType, table.taxonomyTermId),
    unique("uq_record_tags_subject_term_source").on(table.subjectType, table.subjectId, table.taxonomyTermId, table.source)
  ]
);

export const recordFeatureValues = pgTable(
  "record_feature_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    featureKey: text("feature_key").notNull(),
    featureValue: jsonb("feature_value").notNull(),
    valueType: text("value_type"),
    confidence: text("confidence"),
    source: text("source").notNull().default("system"),
    modelVersionId: uuid("model_version_id").references(() => taggingModelVersions.id, { onDelete: "set null" }),
    tbAnalysisId: uuid("tb_analysis_id").references(() => tbAnalyses.id, { onDelete: "cascade" }),
    createdAt: now()
  },
  (table) => [
    index("idx_record_feature_values_scope").on(table.studyCorpusId, table.subjectType, table.featureKey),
    index("idx_record_feature_values_tb_analysis").on(table.tbAnalysisId, table.subjectType, table.featureKey),
    unique("uq_record_feature_values_subject_key_source").on(table.subjectType, table.subjectId, table.featureKey, table.source)
  ]
);

export const tagReviewEvents = pgTable(
  "tag_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordTagId: uuid("record_tag_id").references(() => recordTags.id, { onDelete: "cascade" }),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    previousValue: jsonb("previous_value").notNull().default(sql`'{}'::jsonb`),
    nextValue: jsonb("next_value").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    createdAt: now()
  },
  (table) => [index("idx_tag_review_events_tag").on(table.recordTagId, table.createdAt)]
);

export const lineageEdges = pgTable(
  "lineage_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    relationType: text("relation_type").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_lineage_edges_source").on(table.sourceType, table.sourceId),
    index("idx_lineage_edges_target").on(table.targetType, table.targetId),
    unique("uq_lineage_edges_relation").on(table.sourceType, table.sourceId, table.targetType, table.targetId, table.relationType)
  ]
);

export const metricDefinitions = pgTable(
  "metric_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metricKey: text("metric_key").notNull(),
    version: integer("version").notNull().default(1),
    metricGroupKey: text("metric_group_key"),
    name: text("name").notNull(),
    description: text("description"),
    grain: text("grain").notNull(),
    unit: text("unit"),
    definition: jsonb("definition").notNull(),
    formulaHash: text("formula_hash"),
    dimensions: jsonb("dimensions").notNull().default(sql`'[]'::jsonb`),
    visibility: text("visibility").notNull().default("internal"),
    ownerTeam: text("owner_team"),
    status: text("status").notNull().default("active"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("metric_definitions_version_positive", sql`${table.version} >= 1`),
    check("metric_definitions_visibility", sql`${table.visibility} IN ('internal', 'client', 'both')`),
    check("metric_definitions_formula_hash", sql`${table.formulaHash} IS NULL OR ${table.formulaHash} ~ '^sha256:[0-9a-f]{64}$'`),
    unique("uq_metric_definitions_key_version").on(table.metricKey, table.version),
    index("idx_metric_definitions_status").on(table.status, table.grain),
    index("idx_metric_definitions_group_version")
      .on(table.metricGroupKey, table.version, table.status)
      .where(sql`${table.metricGroupKey} IS NOT NULL`)
  ]
);

export const semanticModels = pgTable(
  "semantic_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelKey: text("model_key").notNull().unique(),
    name: text("name").notNull(),
    baseAssetId: uuid("base_asset_id").references(() => dataAssets.id, { onDelete: "set null" }),
    entities: jsonb("entities").notNull().default(sql`'[]'::jsonb`),
    dimensions: jsonb("dimensions").notNull().default(sql`'[]'::jsonb`),
    measures: jsonb("measures").notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    createdAt: now()
  },
  (table) => [index("idx_semantic_models_status").on(table.status)]
);

export const metricMaterializations = pgTable(
  "metric_materializations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metricDefinitionId: uuid("metric_definition_id")
      .notNull()
      .references(() => metricDefinitions.id, { onDelete: "cascade" }),
    semanticModelId: uuid("semantic_model_id").references(() => semanticModels.id, { onDelete: "set null" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    periodId: uuid("period_id").references(() => reportPeriods.id, { onDelete: "set null" }),
    filtersHash: text("filters_hash").notNull().default("default"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    staleAfter: timestamp("stale_after", { withTimezone: true })
  },
  (table) => [
    index("idx_metric_materializations_lookup").on(table.studyCorpusId, table.metricDefinitionId, table.periodId),
    unique("uq_metric_materializations_ref").on(table.metricDefinitionId, table.studyCorpusId, table.periodId, table.filtersHash)
  ]
);

export const dashboardDataRefs = pgTable(
  "dashboard_data_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outputId: uuid("output_id").references(() => publishedOutputs.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    refKey: text("ref_key").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
    visibility: jsonb("visibility").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_dashboard_data_refs_corpus").on(table.studyCorpusId, table.refKey),
    unique("uq_dashboard_data_refs_output_key").on(table.outputId, table.refKey)
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
