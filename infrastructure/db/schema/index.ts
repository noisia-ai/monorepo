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
  primaryKey,
  smallint,
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
    status: text("status").notNull().default("current"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    retiredByUserId: uuid("retired_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: now(),
    updatedAt: updatedAt()
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
    uniqueIndex("uq_signal_workspace_corpora_one_operational")
      .on(table.workspaceId)
      .where(sql`${table.role} = 'operational' AND ${table.validTo} IS NULL`),
    index("idx_signal_workspace_corpora_workspace_active")
      .on(table.workspaceId, table.role, table.validFrom)
      .where(sql`${table.validTo} IS NULL`),
    index("idx_signal_workspace_corpora_corpus_active")
      .on(table.studyCorpusId, table.role, table.workspaceId)
      .where(sql`${table.validTo} IS NULL`)
  ]
);

export const signalTaxonomyProfiles = pgTable(
  "signal_taxonomy_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    taxonomyId: uuid("taxonomy_id")
      .notNull()
      .references((): AnyPgColumn => taxonomies.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    contextHash: text("context_hash").notNull(),
    ruleSetId: uuid("rule_set_id")
      .notNull()
      .references((): AnyPgColumn => taggingRuleSets.id, { onDelete: "restrict" }),
    modelVersionId: uuid("model_version_id")
      .notNull()
      .references((): AnyPgColumn => taggingModelVersions.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("signal_taxonomy_profiles_kind", sql`${table.kind} IN ('topic', 'narrative')`),
    check("signal_taxonomy_profiles_version_positive", sql`${table.version} >= 1`),
    check("signal_taxonomy_profiles_status", sql`${table.status} IN ('draft', 'activating', 'active', 'retired')`),
    check("signal_taxonomy_profiles_context_hash", sql`${table.contextHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check(
      "signal_taxonomy_profiles_active_approval",
      sql`${table.status} NOT IN ('activating', 'active') OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`
    ),
    unique("uq_signal_taxonomy_profiles_workspace_kind_version").on(
      table.workspaceId,
      table.kind,
      table.version
    ),
    unique("uq_signal_taxonomy_profiles_taxonomy").on(table.taxonomyId),
    uniqueIndex("uq_signal_taxonomy_profiles_active_kind")
      .on(table.workspaceId, table.kind)
      .where(sql`${table.status} = 'active'`),
    index("idx_signal_taxonomy_profiles_workspace_history").on(
      table.workspaceId,
      table.kind,
      table.version
    ),
    index("idx_signal_taxonomy_profiles_model").on(table.modelVersionId, table.ruleSetId)
  ]
);

export const signalWorkspaceReleases = pgTable(
  "signal_workspace_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references((): AnyPgColumn => tbAnalyses.id, { onDelete: "restrict" }),
    reportKey: text("report_key").notNull().default("triggers-barriers"),
    reportRevision: integer("report_revision").notNull().default(1),
    releaseKey: text("release_key").notNull(),
    releaseType: text("release_type").notNull().default("strategic"),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("internal"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    corpusRevision: integer("corpus_revision").notNull(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references((): AnyPgColumn => corpusSnapshots.id, { onDelete: "restrict" }),
    comparisonBaseAnalysisId: uuid("comparison_base_analysis_id").references(
      (): AnyPgColumn => tbAnalyses.id,
      { onDelete: "restrict" }
    ),
    qualityGates: jsonb("quality_gates").notNull().default(sql`'[]'::jsonb`),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_workspace_releases_key").on(table.workspaceId, table.releaseKey),
    unique("uq_signal_workspace_releases_report_revision").on(
      table.workspaceId,
      table.reportKey,
      table.reportRevision
    ),
    unique("uq_signal_workspace_releases_analysis").on(table.workspaceId, table.tbAnalysisId),
    check("signal_workspace_releases_report_key", sql`${table.reportKey} ~ '^[a-z][a-z0-9-]*$'`),
    check("signal_workspace_releases_report_revision_positive", sql`${table.reportRevision} >= 1`),
    check("signal_workspace_releases_type", sql`${table.releaseType} = 'strategic'`),
    check(
      "signal_workspace_releases_status",
      sql`${table.status} IN ('draft', 'needs_review', 'published', 'rejected')`
    ),
    check(
      "signal_workspace_releases_visibility",
      sql`${table.visibility} IN ('internal', 'client')`
    ),
    check("signal_workspace_releases_period", sql`${table.periodStart} <= ${table.periodEnd}`),
    check(
      "signal_workspace_releases_approval",
      sql`(${table.status} = 'published' AND ${table.approvedByUserId} IS NOT NULL
        AND ${table.approvedAt} IS NOT NULL AND ${table.publishedAt} IS NOT NULL)
        OR ${table.status} <> 'published'`
    ),
    index("idx_signal_workspace_releases_history").on(
      table.workspaceId,
      table.periodEnd,
      table.createdAt
    ),
    index("idx_signal_workspace_releases_analysis").on(table.tbAnalysisId)
  ]
);

export const signalWorkspaceReleaseArtifacts = pgTable(
  "signal_workspace_release_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => signalWorkspaceReleases.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references((): AnyPgColumn => analysisArtifacts.id, { onDelete: "restrict" }),
    artifactRevision: integer("artifact_revision").notNull(),
    position: integer("position").notNull().default(0),
    visibility: text("visibility").notNull().default("client"),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_workspace_release_artifact").on(table.releaseId, table.artifactId),
    check(
      "signal_workspace_release_artifact_revision_positive",
      sql`${table.artifactRevision} >= 1`
    ),
    check(
      "signal_workspace_release_artifact_visibility",
      sql`${table.visibility} IN ('internal', 'client')`
    ),
    index("idx_signal_workspace_release_artifacts_release").on(
      table.releaseId,
      table.visibility,
      table.position
    )
  ]
);

export const signalWorkspaceCurrentReleases = pgTable(
  "signal_workspace_current_releases",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id")
      .notNull()
      .unique()
      .references(() => signalWorkspaceReleases.id, { onDelete: "restrict" }),
    promotedByUserId: uuid("promoted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull().defaultNow()
  }
);

export const signalWorkspaceReports = pgTable(
  "signal_workspace_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    title: text("title").notNull(),
    reportType: text("report_type").notNull().default("strategic"),
    status: text("status").notNull().default("active"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_workspace_reports_identity").on(table.workspaceId, table.reportKey),
    check("signal_workspace_reports_key", sql`${table.reportKey} ~ '^[a-z][a-z0-9-]*$'`),
    check("signal_workspace_reports_type", sql`${table.reportType} IN ('strategic', 'operational')`),
    check("signal_workspace_reports_status", sql`${table.status} IN ('active', 'paused', 'archived')`),
    index("idx_signal_workspace_reports_workspace").on(table.workspaceId, table.status)
  ]
);

export const signalWorkspaceReportCurrentReleases = pgTable(
  "signal_workspace_report_current_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => signalWorkspaceReleases.id, { onDelete: "restrict" }),
    promotedByUserId: uuid("promoted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("uq_signal_workspace_report_current_identity").on(table.workspaceId, table.reportKey),
    unique("uq_signal_workspace_report_current_release").on(table.releaseId),
    index("idx_signal_workspace_report_current_workspace").on(table.workspaceId, table.reportKey)
  ]
);

export const signalPopulationDefinitions = pgTable(
  "signal_population_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    populationKey: text("population_key").notNull(),
    version: integer("version").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("draft"),
    acceptanceStatus: text("acceptance_status").notNull().default("included"),
    allowedScopes: text("allowed_scopes").array().notNull(),
    minQualityScore: integer("min_quality_score"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    definitionHash: text("definition_hash").notNull(),
    policyKey: text("policy_key"),
    policyVersion: text("policy_version"),
    timezone: text("timezone"),
    membershipDigest: text("membership_digest"),
    idempotencyKey: text("idempotency_key"),
    definition: jsonb("definition").notNull().default(sql`'{}'::jsonb`),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    activatedByUserId: uuid("activated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_population_definitions_version").on(
      table.workspaceId,
      table.populationKey,
      table.version
    ),
    uniqueIndex("uq_signal_population_definitions_active")
      .on(table.workspaceId, table.populationKey)
      .where(sql`${table.status} = 'active'`),
    check("signal_population_definitions_key", sql`${table.populationKey} ~ '^[a-z][a-z0-9-]*$'`),
    check("signal_population_definitions_version_positive", sql`${table.version} >= 1`),
    check("signal_population_definitions_purpose", sql`${table.purpose} IN ('operational', 'analysis')`),
    check("signal_population_definitions_status", sql`${table.status} IN ('draft', 'active', 'retired')`),
    check("signal_population_definitions_acceptance", sql`${table.acceptanceStatus} = 'included'`),
    check("signal_population_definitions_window", sql`${table.periodStart} IS NULL OR ${table.periodEnd} IS NULL OR ${table.periodStart} <= ${table.periodEnd}`),
    check("signal_population_definitions_hash", sql`${table.definitionHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_population_definitions_policy_key", sql`${table.policyKey} IS NULL OR ${table.policyKey} ~ '^[a-z][a-z0-9-]*$'`),
    check("signal_population_definitions_policy_version", sql`${table.policyVersion} IS NULL OR btrim(${table.policyVersion}) <> ''`),
    check("signal_population_definitions_timezone", sql`${table.timezone} IS NULL OR btrim(${table.timezone}) <> ''`),
    check("signal_population_definitions_membership_digest", sql`${table.membershipDigest} IS NULL OR ${table.membershipDigest} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_population_definitions_idempotency_key", sql`${table.idempotencyKey} IS NULL OR ${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    uniqueIndex("uq_signal_analysis_population_idempotency")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.purpose} = 'analysis' AND ${table.idempotencyKey} IS NOT NULL`),
    index("idx_signal_population_definitions_workspace").on(table.workspaceId, table.purpose, table.status)
  ]
);

export const signalWorkspacePopulationPointers = pgTable(
  "signal_workspace_population_pointers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    populationId: uuid("population_id")
      .notNull()
      .references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    promotedByUserId: uuid("promoted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("uq_signal_workspace_population_pointer").on(table.workspaceId, table.purpose),
    unique("uq_signal_workspace_population_pointer_population").on(table.populationId),
    check("signal_workspace_population_pointer_purpose", sql`${table.purpose} IN ('operational', 'analysis')`)
  ]
);

export const signalRefreshPolicies = pgTable(
  "signal_refresh_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull().default(""),
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
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "set null" }),
    populationId: uuid("population_id").references(() => signalPopulationDefinitions.id, { onDelete: "set null" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    sourceKey: text("source_key").notNull().default(""),
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
    runType: text("run_type").notNull().default("source_refresh"),
    taxonomyProfileId: uuid("taxonomy_profile_id").references(
      () => signalTaxonomyProfiles.id,
      { onDelete: "set null" }
    ),
    modelVersionId: uuid("model_version_id").references(
      (): AnyPgColumn => taggingModelVersions.id,
      { onDelete: "set null" }
    ),
    inputCorpusRevision: integer("input_corpus_revision"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    budgetCapUsd: numeric("budget_cap_usd", { precision: 12, scale: 6 }),
    actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 6 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("signal_refresh_runs_status", sql`${table.status} IN ('queued', 'running', 'partial', 'blocked', 'completed', 'failed', 'dead_letter', 'skipped')`),
    check("signal_refresh_runs_trigger", sql`${table.trigger} IN ('scheduled', 'manual', 'import')`),
    check("signal_refresh_runs_attempt_positive", sql`${table.attempt} >= 1`),
    check("signal_refresh_runs_run_type", sql`${table.runType} IN ('source_refresh', 'taxonomy_enrichment')`),
    check(
      "signal_refresh_runs_enrichment_scope",
      sql`${table.runType} <> 'taxonomy_enrichment' OR (
        ${table.taxonomyProfileId} IS NOT NULL
        AND ${table.modelVersionId} IS NOT NULL
        AND ${table.inputCorpusRevision} IS NOT NULL
        AND ${table.inputCorpusRevision} >= 0
      )`
    ),
    check(
      "signal_refresh_runs_enrichment_cost",
      sql`(${table.budgetCapUsd} IS NULL OR ${table.budgetCapUsd} >= 0)
        AND (${table.actualCostUsd} IS NULL OR ${table.actualCostUsd} >= 0)
        AND (${table.budgetCapUsd} IS NULL OR ${table.actualCostUsd} IS NULL OR ${table.actualCostUsd} <= ${table.budgetCapUsd})
        AND (${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0)
        AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)`
    ),
    unique("uq_signal_refresh_runs_idempotency").on(table.idempotencyKey),
    index("idx_signal_refresh_runs_workspace_status").on(table.workspaceId, table.status, table.createdAt),
    index("idx_signal_refresh_runs_policy_status").on(table.refreshPolicyId, table.status, table.createdAt),
    index("idx_signal_refresh_runs_outbox_recovery")
      .on(table.scheduledFor, table.refreshPolicyId, table.id)
      .where(sql`${table.trigger} = 'scheduled' AND ${table.status} IN ('queued', 'failed') AND ${table.completedAt} IS NULL`),
    index("idx_signal_refresh_runs_taxonomy_recovery")
      .on(table.status, table.heartbeatAt, table.createdAt, table.id)
      .where(sql`${table.runType} = 'taxonomy_enrichment' AND ${table.status} IN ('queued', 'running', 'partial', 'blocked', 'failed')`)
  ]
);

export const signalDataInvalidations = pgTable(
  "signal_data_invalidations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    populationId: uuid("population_id").references(() => signalPopulationDefinitions.id, { onDelete: "cascade" }),
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
    check("signal_data_invalidations_operational_scope", sql`(
      ${table.studyCorpusId} IS NOT NULL AND ${table.populationId} IS NULL
    ) OR (
      ${table.studyCorpusId} IS NULL AND ${table.populationId} IS NOT NULL
    )`),
    unique("uq_signal_data_invalidations_idempotency").on(table.idempotencyKey),
    index("idx_signal_data_invalidations_pending")
      .on(table.status, table.createdAt)
      .where(sql`${table.status} IN ('pending', 'failed')`),
    index("idx_signal_data_invalidations_scope").on(table.workspaceId, table.studyCorpusId, table.affectedFrom, table.affectedThrough),
    index("idx_signal_data_invalidations_population_scope")
      .on(table.workspaceId, table.populationId, table.affectedFrom, table.affectedThrough, table.createdAt)
      .where(sql`${table.populationId} IS NOT NULL`)
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
    latestInterpretationId: uuid("latest_interpretation_id"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("signal_interpretation_freshness_state", sql`${table.state} IN ('fresh', 'stale', 'pending', 'partial', 'not_available')`),
    unique("uq_signal_interpretation_freshness_scope").on(table.workspaceId, table.metricGroupKey, table.filtersHash),
    index("idx_signal_interpretation_freshness_workspace_state").on(table.workspaceId, table.state, table.evaluatedAt)
  ]
);

export const metricInterpretationRuns = pgTable(
  "metric_interpretation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").notNull().references(() => studyCorpora.id, { onDelete: "cascade" }),
    metricGroupKey: text("metric_group_key").notNull(),
    metricGroupVersion: integer("metric_group_version").notNull().default(1),
    normalizedFilter: jsonb("normalized_filter").notNull(),
    filtersHash: text("filters_hash").notNull(),
    dataScope: jsonb("data_scope").notNull().default(sql`'{}'::jsonb`),
    dataWatermarkHash: text("data_watermark_hash").notNull(),
    packet: jsonb("packet").notNull(),
    packetHash: text("packet_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    modelVersion: text("model_version").notNull(),
    provider: text("provider").notNull().default("anthropic"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    budgetCapUsd: numeric("budget_cap_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    timeoutMs: integer("timeout_ms").notNull(),
    errorCode: text("error_code"),
    errorSummary: jsonb("error_summary").notNull().default(sql`'{}'::jsonb`),
    fallbackReason: text("fallback_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    check("metric_interpretation_runs_status", sql`${table.status} IN ('queued', 'running', 'completed', 'skipped', 'failed', 'dead_letter')`),
    unique("uq_metric_interpretation_runs_idempotency").on(table.idempotencyKey),
    index("idx_metric_interpretation_runs_scope").on(
      table.workspaceId, table.metricGroupKey, table.filtersHash, table.dataWatermarkHash, table.createdAt
    )
  ]
);

export const metricInterpretations = pgTable(
  "metric_interpretations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => metricInterpretationRuns.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id").notNull().references(() => studyCorpora.id, { onDelete: "cascade" }),
    metricGroupKey: text("metric_group_key").notNull(),
    metricGroupVersion: integer("metric_group_version").notNull(),
    revision: integer("revision").notNull().default(1),
    filtersHash: text("filters_hash").notNull(),
    dataWatermarkHash: text("data_watermark_hash").notNull(),
    packetHash: text("packet_hash").notNull(),
    dataScope: jsonb("data_scope").notNull(),
    content: jsonb("content").notNull(),
    facts: jsonb("facts").notNull().default(sql`'[]'::jsonb`),
    hypotheses: jsonb("hypotheses").notNull().default(sql`'[]'::jsonb`),
    causalClaims: jsonb("causal_claims").notNull().default(sql`'[]'::jsonb`),
    recommendations: jsonb("recommendations").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("fresh"),
    reviewStatus: text("review_status").notNull(),
    generatedBy: text("generated_by").notNull(),
    staleReason: text("stale_reason"),
    createdAt: now(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" })
  },
  (table) => [
    check("metric_interpretations_status", sql`${table.status} IN ('fresh', 'stale', 'pending', 'partial', 'not_available')`),
    check("metric_interpretations_review_status", sql`${table.reviewStatus} IN ('auto_published', 'needs_review', 'approved', 'rejected')`),
    unique("uq_metric_interpretations_scope_revision").on(
      table.workspaceId, table.metricGroupKey, table.metricGroupVersion,
      table.filtersHash, table.dataWatermarkHash, table.revision
    ),
    index("idx_metric_interpretations_serving").on(
      table.workspaceId, table.metricGroupKey, table.filtersHash, table.status, table.createdAt
    )
  ]
);

export const metricInterpretationEvidence = pgTable(
  "metric_interpretation_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    interpretationId: uuid("interpretation_id").notNull().references(() => metricInterpretations.id, { onDelete: "cascade" }),
    // Migration 0052 owns this FK because metric_materializations is declared later.
    materializationId: uuid("materialization_id").notNull(),
    claimIndex: integer("claim_index").notNull(),
    claimKind: text("claim_kind").notNull(),
    field: text("field"),
    citedNumericValue: numeric("cited_numeric_value"),
    createdAt: now()
  },
  (table) => [
    index("idx_metric_interpretation_evidence_materialization").on(table.materializationId, table.interpretationId)
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    studyCorpusId: uuid("study_corpus_id")
      .references(() => studyCorpora.id, { onDelete: "restrict" }),
    contributedByStudyCorpusId: uuid("contributed_by_study_corpus_id")
      .references(() => studyCorpora.id, { onDelete: "restrict" }),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references((): AnyPgColumn => dataSources.id, { onDelete: "restrict" }),
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
    ingestionPhase: text("ingestion_phase").notNull().default("legacy"),
    storageBucket: text("storage_bucket"),
    storageObjectKey: text("storage_object_key"),
    uploadProtocol: text("upload_protocol"),
    expectedFileSizeBytes: bigint("expected_file_size_bytes", { mode: "number" }),
    storagePartCount: integer("storage_part_count"),
    storagePartSizeBytes: bigint("storage_part_size_bytes", { mode: "number" }),
    processedBytes: bigint("processed_bytes", { mode: "number" }).notNull().default(0),
    progressRecordCount: integer("progress_record_count").notNull().default(0),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureDetail: jsonb("failure_detail"),
    workerJobId: text("worker_job_id"),
    supersedesImportBatchId: uuid("supersedes_import_batch_id")
      .references((): AnyPgColumn => importBatches.id, { onDelete: "restrict" }),
    storageSourceImportBatchId: uuid("storage_source_import_batch_id")
      .references((): AnyPgColumn => importBatches.id, { onDelete: "restrict" }),
    storageContentHash: text("storage_content_hash"),
    processingMetrics: jsonb("processing_metrics").notNull().default({}),
    productIdempotencyKey: text("product_idempotency_key"),
    productRequestDigest: text("product_request_digest"),
    acquisitionContractVersion: text("acquisition_contract_version"),
    acquisitionPlanId: uuid("acquisition_plan_id")
      .references((): AnyPgColumn => signalAcquisitionPlans.id, { onDelete: "restrict" }),
    acquisitionSlotId: uuid("acquisition_slot_id")
      .references((): AnyPgColumn => signalAcquisitionSlots.id, { onDelete: "restrict" }),
    acquisitionQueryVersionId: uuid("acquisition_query_version_id")
      .references((): AnyPgColumn => signalAcquisitionQueryVersions.id, { onDelete: "restrict" }),
    capturePeriodStart: date("capture_period_start"),
    capturePeriodEnd: date("capture_period_end"),
    captureTimezone: text("capture_timezone"),
    acquisitionPlanDigest: text("acquisition_plan_digest"),
    acquisitionSlotDigest: text("acquisition_slot_digest"),
    acquisitionQueryDigest: text("acquisition_query_digest"),
    acquisitionBrandOsDigest: text("acquisition_brand_os_digest"),
    acquisitionIdentityCatalogDigest: text("acquisition_identity_catalog_digest"),
    providerSchemaVersion: text("provider_schema_version"),
    providerObservationProjectionState: text("provider_observation_projection_state"),
    providerObservationHeaderHash: text("provider_observation_header_hash"),
    providerObservationCount: integer("provider_observation_count"),
    acquisitionSealedAt: timestamp("acquisition_sealed_at", { withTimezone: true }),
    acquisitionQueryEvidenceClass: text("acquisition_query_evidence_class"),
    acquisitionQueryEvidenceReason: text("acquisition_query_evidence_reason"),
    acquisitionQueryEvidenceActorUserId: uuid("acquisition_query_evidence_actor_user_id")
      .references(() => users.id, { onDelete: "restrict" }),
    acquisitionQueryEvidenceAttestedAt: timestamp("acquisition_query_evidence_attested_at", { withTimezone: true }),
    providerExecutionReferenceHash: text("provider_execution_reference_hash"),
    providerExecutionAdapterKey: text("provider_execution_adapter_key"),
    providerExecutionVerifiedAt: timestamp("provider_execution_verified_at", { withTimezone: true }),
    acquisitionImportSealDigest: text("acquisition_import_seal_digest"),
    importedByUserId: uuid("imported_by_user_id").references(() => users.id),
    recordCount: integer("record_count").default(0),
    includedCount: integer("included_count").default(0),
    excludedCount: integer("excluded_count").default(0),
    duplicateCount: integer("duplicate_count").default(0),
    status: text("status").notNull(),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_import_batches_workspace").on(table.workspaceId, table.status, table.createdAt),
    index("idx_import_batches_source").on(table.dataSourceId, table.createdAt),
    index("idx_import_batches_contributing_study").on(table.contributedByStudyCorpusId, table.createdAt),
    index("idx_import_batches_corpus").on(table.studyCorpusId),
    index("idx_import_batches_entity").on(table.studyCorpusId, table.mentionType, table.entityKind),
    index("idx_import_batches_corpus_entity").on(table.studyCorpusId, table.corpusEntityId),
    index("idx_import_batches_competitor").on(table.studyCorpusId, table.competitorId),
    index("idx_import_batches_query_pack").on(table.studyCorpusId, table.queryPackId),
    index("idx_import_batches_validation_run").on(table.queryValidationRunId),
    index("idx_import_batches_status").on(table.status),
    index("idx_import_batches_async_poll").on(table.workspaceId, table.dataSourceId, table.updatedAt),
    index("idx_import_batches_query_evidence").on(
      table.workspaceId,table.acquisitionQueryEvidenceClass,table.createdAt,table.id
    ),
    index("idx_import_batches_supersedes").on(table.supersedesImportBatchId),
    uniqueIndex("uq_import_batches_active_storage_recovery")
      .on(table.supersedesImportBatchId)
      .where(sql`${table.supersedesImportBatchId} IS NOT NULL AND ${table.status} IN ('queued','processing','completed')`),
    check("import_batches_product_operation_shape",sql`(
      ${table.productIdempotencyKey} IS NULL AND ${table.productRequestDigest} IS NULL
    ) OR (
      ${table.productIdempotencyKey} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.productRequestDigest} ~ '^sha256:[0-9a-f]{64}$'
    )`),
    uniqueIndex("uq_import_batches_product_idempotency")
      .on(table.workspaceId,table.productIdempotencyKey)
      .where(sql`${table.productIdempotencyKey} IS NOT NULL`)
  ]
);

export const signalWorkspaceImportOutbox = pgTable(
  "signal_workspace_import_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull()
      .references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").notNull()
      .references(() => importBatches.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    workerJobId: text("worker_job_id").notNull(),
    errorSummary: jsonb("error_summary"),
    createdAt: now(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    unique("uq_signal_workspace_import_outbox_batch").on(table.importBatchId),
    unique("uq_signal_workspace_import_outbox_job").on(table.workerJobId),
    index("idx_signal_workspace_import_outbox_claim").on(
      table.status,table.availableAt,table.createdAt
    )
  ]
);

export const signalWorkspaceImportEvents = pgTable(
  "signal_workspace_import_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull()
      .references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").notNull()
      .references(() => importBatches.id, { onDelete: "restrict" }),
    outboxId: uuid("outbox_id")
      .references(() => signalWorkspaceImportOutbox.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    index("idx_signal_workspace_import_events_batch").on(
      table.importBatchId,table.createdAt,table.id
    )
  ]
);

// Snapshots: frozen views of which mentions were 'included' at a point in time.
export const corpusSnapshots = pgTable(
  "corpus_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    populationId: uuid("population_id").references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    populationVersion: integer("population_version"),
    populationDefinitionHash: text("population_definition_hash"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    timezone: text("timezone"),
    snapshotDigest: text("snapshot_digest"),
    sourceWatermarkDigest: text("source_watermark_digest"),
    scopeFrozenAt: timestamp("scope_frozen_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    strategicAuthorityVersion: text("strategic_authority_version"),
    policyBundleId: uuid("policy_bundle_id").references(
      (): AnyPgColumn => signalPopulationPolicyBundles.id,
      { onDelete: "restrict" }
    ),
    policyCompilationId: uuid("policy_compilation_id").references(
      (): AnyPgColumn => signalPopulationPolicyCompilations.id,
      { onDelete: "restrict" }
    ),
    governanceEvaluationId: uuid("governance_evaluation_id").references(
      (): AnyPgColumn => signalDataGovernanceEvaluations.id,
      { onDelete: "restrict" }
    ),
    policyDefinitionHash: text("policy_definition_hash"),
    compiledPlanHash: text("compiled_plan_hash"),
    governanceDigest: text("governance_digest"),
    provenanceDigest: text("provenance_digest"),
    usagePurposes: text("usage_purposes").array().notNull().default(emptyTextArray),
    watermarkCapturedAt: timestamp("watermark_captured_at", { withTimezone: true }),
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
  (table) => [
    index("idx_snap_corpus").on(table.studyCorpusId),
    index("idx_snap_workspace_population").on(table.workspaceId, table.populationId, table.createdAt),
    uniqueIndex("uq_signal_strategic_snapshot_idempotency")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.kind} = 'analysis' AND ${table.idempotencyKey} IS NOT NULL`),
    index("idx_signal_strategic_snapshot_identity")
      .on(table.workspaceId, table.populationId, table.scopeFrozenAt)
      .where(sql`${table.kind} = 'analysis'`),
    check("corpus_snapshots_kind", sql`${table.kind} IN ('manual', 'approval', 'analysis')`),
    check("corpus_snapshots_population_version_positive", sql`${table.populationVersion} IS NULL OR ${table.populationVersion} >= 1`),
    check("corpus_snapshots_population_window", sql`${table.periodStart} IS NULL OR ${table.periodEnd} IS NULL OR ${table.periodStart} <= ${table.periodEnd}`),
    check("corpus_snapshots_population_hash", sql`${table.populationDefinitionHash} IS NULL OR ${table.populationDefinitionHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check("corpus_snapshots_timezone", sql`${table.timezone} IS NULL OR btrim(${table.timezone}) <> ''`),
    check("corpus_snapshots_snapshot_digest", sql`${table.snapshotDigest} IS NULL OR ${table.snapshotDigest} ~ '^sha256:[0-9a-f]{64}$'`),
    check("corpus_snapshots_source_watermark_digest", sql`${table.sourceWatermarkDigest} IS NULL OR ${table.sourceWatermarkDigest} ~ '^sha256:[0-9a-f]{64}$'`),
    check("corpus_snapshots_idempotency_key", sql`${table.idempotencyKey} IS NULL OR ${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`)
  ]
);

export const signalSnapshotWatermarks = pgTable(
  "signal_snapshot_watermarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => corpusSnapshots.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references((): AnyPgColumn => dataSources.id, { onDelete: "set null" }),
    sourceSyncRunId: uuid("source_sync_run_id").references((): AnyPgColumn => sourceSyncRuns.id, { onDelete: "set null" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    dataThroughAt: timestamp("data_through_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    watermarkHash: text("watermark_hash").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_snapshot_watermark_source").on(table.snapshotId, table.dataSourceId),
    check("signal_snapshot_watermark_hash", sql`${table.watermarkHash} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_signal_snapshot_watermarks_snapshot").on(table.snapshotId, table.acceptedAt)
  ]
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

// Canonical rows belong to a Signal workspace. If volume later requires
// partitioning, partition by workspace/time; study_corpus_id is provenance only.
export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    studyCorpusId: uuid("study_corpus_id")
      .references(() => studyCorpora.id, { onDelete: "restrict" }),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references((): AnyPgColumn => dataSources.id, { onDelete: "restrict" }),
    canonicalMentionId: uuid("canonical_mention_id")
      .notNull()
      .references((): AnyPgColumn => mentions.id, { onDelete: "restrict" }),
    providerRecordId: text("provider_record_id").notNull(),
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
    /** Materialized at ingest (see infrastructure/db/sentione-csv-ingest.ts) so Signal dashboard
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
    uniqueIndex("uq_mentions_workspace_text_canonical")
      .on(table.workspaceId, table.textHash)
      .where(sql`${table.canonicalMentionId} = ${table.id}`),
    uniqueIndex("uq_mentions_workspace_provider_canonical")
      .on(table.workspaceId, table.sourceSystem, table.providerRecordId)
      .where(sql`${table.canonicalMentionId} = ${table.id}`),
    index("idx_mentions_workspace_acceptance").on(table.workspaceId, table.inclusionStatus, table.publishedAt, table.id),
    index("idx_mentions_semantic_review_accepted_roots")
      .on(table.workspaceId, table.publishedAt.desc(), table.id.desc())
      .where(sql`${table.inclusionStatus} = 'included' AND ${table.canonicalMentionId} = ${table.id}`),
    index("idx_mentions_canonical_root").on(table.canonicalMentionId, table.workspaceId),
    index("idx_mentions_corpus_platform").on(table.studyCorpusId, table.platform),
    index("idx_mentions_corpus_inclusion").on(table.studyCorpusId, table.inclusionStatus),
    index("idx_mentions_signal_materialization")
      .on(table.studyCorpusId, table.publishedAt, table.id)
      .where(sql`${table.inclusionStatus} = 'included'`),
    index("idx_mentions_signal_facets")
      .on(table.studyCorpusId, table.resolvedPlatform, table.publishedAt, table.id)
      .where(sql`${table.inclusionStatus} = 'included'`),
    index("idx_mentions_published").on(table.publishedAt),
    index("idx_mentions_text_hash").on(table.textHash)
  ]
);

export const signalMentionStudyMemberships = pgTable(
  "signal_mention_study_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    studyCorpusId: uuid("study_corpus_id")
      .notNull()
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    membershipRole: text("membership_role").notNull().default("contributed"),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_mention_study_membership").on(
      table.mentionId,
      table.studyCorpusId,
      table.membershipRole
    ),
    check("signal_mention_study_membership_role", sql`${table.membershipRole} IN ('contributed', 'selected', 'analyzed')`),
    index("idx_signal_mention_study_memberships_study").on(table.studyCorpusId, table.membershipRole, table.mentionId),
    index("idx_signal_mention_study_memberships_workspace").on(table.workspaceId, table.mentionId)
  ]
);

export const signalMentionImportMemberships = pgTable(
  "signal_mention_import_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    importBatchId: uuid("import_batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references((): AnyPgColumn => dataSources.id, { onDelete: "restrict" }),
    ingestionDisposition: text("ingestion_disposition"),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_mention_import_membership").on(table.mentionId, table.importBatchId),
    index("idx_signal_mention_import_memberships_batch").on(table.importBatchId, table.mentionId),
    index("idx_signal_mention_import_memberships_workspace").on(table.workspaceId, table.mentionId)
  ]
);

export const signalMentionAttributions = pgTable(
  "signal_mention_attributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references((): AnyPgColumn => dataSources.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id")
      .references(() => importBatches.id, { onDelete: "set null" }),
    scope: text("scope").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    entityLabel: text("entity_label"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    reviewStatus: text("review_status").notNull().default("pending"),
    attributionSource: text("attribution_source").notNull(),
    policyVersion: text("policy_version").notNull(),
    modelVersion: text("model_version"),
    attributionBasis: text("attribution_basis").notNull().default("source_intent"),
    eligibilityStatus: text("eligibility_status").notNull().default("not_eligible"),
    evidenceKind: text("evidence_kind"),
    evidenceHash: text("evidence_hash"),
    semanticPolicyKey: text("semantic_policy_key"),
    assertionVersion: integer("assertion_version").notNull().default(1),
    supersedesAttributionId: uuid("supersedes_attribution_id")
      .references((): AnyPgColumn => signalMentionAttributions.id, { onDelete: "restrict" }),
    isCurrent: boolean("is_current").notNull().default(true),
    idempotencyKey: text("idempotency_key"),
    acquisitionQueryEvidenceClass: text("acquisition_query_evidence_class"),
    acquisitionQueryVersionId: uuid("acquisition_query_version_id"),
    acquisitionQueryEvidenceActorUserId: uuid("acquisition_query_evidence_actor_user_id")
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvalSource: text("approval_source"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("uq_signal_mention_source_intent_provenance")
      .on(
        table.mentionId,
        table.dataSourceId,
        sql`COALESCE(${table.importBatchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.scope,
        table.entityType,
        sql`COALESCE(${table.entityId}, '00000000-0000-0000-0000-000000000000'::uuid)`
      )
      .where(sql`${table.attributionBasis} = 'source_intent'`),
    uniqueIndex("uq_signal_mention_semantic_idempotency")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.attributionBasis} = 'mention_semantic'`),
    uniqueIndex("uq_signal_mention_semantic_version")
      .on(
        table.mentionId,
        table.semanticPolicyKey,
        table.assertionVersion
      )
      .where(sql`${table.attributionBasis} = 'mention_semantic'`),
    uniqueIndex("uq_signal_mention_semantic_current")
      .on(
        table.mentionId,
        table.scope,
        table.entityType,
        sql`COALESCE(${table.entityId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.semanticPolicyKey
      )
      .where(sql`${table.attributionBasis} = 'mention_semantic' AND ${table.isCurrent} = true`),
    check("signal_mention_attribution_scope", sql`${table.scope} IN ('primary_brand', 'competitor', 'category', 'reference', 'unattributed')`),
    check("signal_mention_attribution_entity_type", sql`${table.entityType} IN ('brand', 'competitor', 'category', 'reference', 'unattributed')`),
    check("signal_mention_attribution_confidence", sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`),
    check("signal_mention_attribution_review", sql`${table.reviewStatus} IN ('pending', 'approved', 'rejected')`),
    check("signal_mention_attribution_basis", sql`${table.attributionBasis} IN ('source_intent', 'mention_semantic')`),
    check("signal_mention_attribution_eligibility", sql`${table.eligibilityStatus} IN ('not_eligible', 'candidate', 'eligible')`),
    check("signal_mention_attribution_policy", sql`btrim(${table.policyVersion}) <> ''`),
    check("signal_mention_attribution_approval", sql`${table.reviewStatus} <> 'approved' OR (${table.approvalSource} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`),
    index("idx_signal_mention_attributions_scope").on(table.workspaceId, table.scope, table.reviewStatus, table.mentionId),
    index("idx_signal_mention_semantic_eligible")
      .on(table.workspaceId, table.scope, table.entityType, table.entityId, table.mentionId)
      .where(sql`${table.attributionBasis} = 'mention_semantic' AND ${table.isCurrent} = true AND ${table.reviewStatus} = 'approved' AND ${table.eligibilityStatus} = 'eligible'`),
    index("idx_signal_mention_attributions_provenance").on(table.importBatchId, table.dataSourceId, table.mentionId),
    index("idx_signal_mention_source_intent_workspace_root")
      .on(table.workspaceId, table.mentionId, table.importBatchId)
      .where(sql`${table.attributionBasis} = 'source_intent'`),
    index("idx_signal_mention_attributions_entity").on(table.entityType, table.entityId)
  ]
);

export const signalMentionAttributionReviewEvents = pgTable(
  "signal_mention_attribution_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    attributionId: uuid("attribution_id")
      .notNull()
      .references(() => signalMentionAttributions.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    previousReviewStatus: text("previous_review_status").notNull(),
    nextReviewStatus: text("next_review_status").notNull(),
    previousEligibilityStatus: text("previous_eligibility_status").notNull(),
    nextEligibilityStatus: text("next_eligibility_status").notNull(),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewPolicyKey: text("review_policy_key").notNull(),
    reviewPolicyVersion: text("review_policy_version").notNull(),
    rationaleHash: text("rationale_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_mention_attribution_review_idempotency").on(
      table.workspaceId,
      table.idempotencyKey
    ),
    check("signal_mention_attribution_review_action", sql`${table.action} IN ('approved', 'rejected', 'superseded')`),
    check("signal_mention_attribution_review_rationale_hash", sql`${table.rationaleHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_mention_attribution_review_idempotency_key", sql`${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_signal_mention_attribution_review_events_assertion").on(
      table.attributionId,
      table.createdAt,
      table.id
    )
  ]
);

export const signalMentionGovernanceEvents = pgTable(
  "signal_mention_governance_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    previousInclusionStatus: text("previous_inclusion_status").notNull(),
    nextInclusionStatus: text("next_inclusion_status").notNull(),
    previousExclusionReason: text("previous_exclusion_reason"),
    nextExclusionReason: text("next_exclusion_reason"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    revertsEventId: uuid("reverts_event_id")
      .references((): AnyPgColumn => signalMentionGovernanceEvents.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_mention_governance_idempotency").on(table.workspaceId, table.idempotencyKey),
    uniqueIndex("uq_signal_mention_governance_reverted_event")
      .on(table.revertsEventId)
      .where(sql`${table.revertsEventId} IS NOT NULL`),
    check("signal_mention_governance_action", sql`${table.action} IN ('include', 'exclude', 'revert', 'send_to_review')`),
    check("signal_mention_governance_previous_status", sql`${table.previousInclusionStatus} IN ('pending', 'included', 'excluded')`),
    check("signal_mention_governance_next_status", sql`${table.nextInclusionStatus} IN ('pending', 'included', 'excluded')`),
    check("signal_mention_governance_reason", sql`btrim(${table.reason}) <> ''`),
    check("signal_mention_governance_idempotency_key", sql`${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_mention_governance_exclusion_reason", sql`${table.nextInclusionStatus} <> 'excluded' OR NULLIF(btrim(${table.nextExclusionReason}), '') IS NOT NULL`),
    check("signal_mention_governance_revert_shape", sql`(${table.action} = 'revert' AND ${table.revertsEventId} IS NOT NULL) OR (${table.action} <> 'revert' AND ${table.revertsEventId} IS NULL)`),
    index("idx_signal_mention_governance_history").on(table.workspaceId, table.mentionId, table.createdAt, table.id)
  ]
);

export const signalSemanticReviewProjectionState = pgTable(
  "signal_semantic_review_projection_state",
  {
    workspaceId: uuid("workspace_id").primaryKey().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    currentGeneration: bigint("current_generation", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("stale"),
    snapshotDigest: text("snapshot_digest"),
    populationDigest: text("population_digest"),
    identityDigest: text("identity_digest"),
    governanceDigest: text("governance_digest"),
    resolutionSelectionDigest: text("resolution_selection_digest"),
    resolutionSelectedCharacterCount: bigint("resolution_selected_character_count", { mode: "number" }).notNull().default(0),
    resolutionNextPolicyTransitionAt: timestamp("resolution_next_policy_transition_at", { withTimezone: true }),
    incompleteProvenanceCount: integer("incomplete_provenance_count").notNull().default(0),
    projectedRootCount: integer("projected_root_count").notNull().default(0),
    dirtyRootCount: integer("dirty_root_count").notNull().default(0),
    fullRebuildRequired: boolean("full_rebuild_required").notNull().default(true),
    lastReason: text("last_reason").notNull().default("initial_projection_required"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    updatedAt: updatedAt()
  }
);

export const signalSemanticReviewProjectionItems = pgTable(
  "signal_semantic_review_projection_items",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    generation: bigint("generation", { mode: "number" }).notNull(),
    mentionId: uuid("mention_id").notNull().references(() => mentions.id, { onDelete: "cascade" }),
    queueState: text("queue_state").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    platform: text("platform").notNull(),
    excerpt: text("excerpt").notNull(),
    title: text("title"),
    account: jsonb("account"),
    urlHost: text("url_host"),
    sourceIntents: jsonb("source_intents").notNull().default(sql`'[]'::jsonb`),
    sourceIds: uuid("source_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    proposedAssertions: jsonb("proposed_assertions").notNull().default(sql`'[]'::jsonb`),
    proposedScopes: text("proposed_scopes").array().notNull().default(emptyTextArray),
    currentScopes: text("current_scopes").array().notNull().default(emptyTextArray),
    confidenceBands: text("confidence_bands").array().notNull().default(emptyTextArray),
    currentAssertions: jsonb("current_assertions").notNull().default(sql`'[]'::jsonb`),
    candidateResolution: text("candidate_resolution").notNull(),
    resolutionEligibility: text("resolution_eligibility").notNull().default("licensing_unknown"),
    resolutionAuthorityDigest: text("resolution_authority_digest"),
    resolutionNextPolicyTransitionAt: timestamp("resolution_next_policy_transition_at", { withTimezone: true }),
    characterCount: integer("character_count").notNull().default(0),
    contextHash: text("context_hash").notNull(),
    projectionHash: text("projection_hash").notNull(),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.generation, table.mentionId] }),
    index("idx_signal_semantic_review_projection_page").on(table.workspaceId, table.generation, table.queueState, table.publishedAt, table.mentionId),
    index("idx_signal_semantic_review_projection_resolution").on(table.workspaceId, table.generation, table.resolutionEligibility, table.queueState, table.mentionId)
  ]
);

export const signalSemanticReviewProjectionAggregates = pgTable(
  "signal_semantic_review_projection_aggregates",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    generation: bigint("generation", { mode: "number" }).notNull(),
    dimension: text("dimension").notNull(),
    dimensionValue: text("dimension_value").notNull(),
    rootCount: integer("root_count").notNull()
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.generation, table.dimension, table.dimensionValue] })]
);

export const signalSemanticReviewProjectionDirtyRoots = pgTable(
  "signal_semantic_review_projection_dirty_roots",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id").notNull().references(() => mentions.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    dirtyAt: timestamp("dirty_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.mentionId] })]
);

export const signalSemanticReviewProjectionOutbox = pgTable(
  "signal_semantic_review_projection_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    reason: text("reason").notNull(),
    attempt: integer("attempt").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: now(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  }
);

export const signalSemanticResolutionRuns = pgTable(
  "signal_semantic_resolution_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("queued"),
    modelVersion: text("model_version").notNull(),
    policyKey: text("policy_key").notNull(),
    policyVersion: text("policy_version").notNull(),
    queueDigest: text("queue_digest").notNull(),
    totalItems: integer("total_items").notNull(),
    completedItems: integer("completed_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    budgetThresholdUsd: numeric("budget_threshold_usd", { precision: 12, scale: 6 }).notNull(),
    budgetCapUsd: numeric("budget_cap_usd", { precision: 12, scale: 6 }).notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull(),
    actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    overBudgetConfirmed: boolean("over_budget_confirmed").notNull().default(false),
    providerBatchId: text("provider_batch_id"),
    providerBatchStatus: text("provider_batch_status").notNull().default("not_submitted"),
    providerProcessingItems: integer("provider_processing_items").notNull().default(0),
    providerSucceededItems: integer("provider_succeeded_items").notNull().default(0),
    providerErroredItems: integer("provider_errored_items").notNull().default(0),
    providerCanceledItems: integer("provider_canceled_items").notNull().default(0),
    providerExpiredItems: integer("provider_expired_items").notNull().default(0),
    providerSubmittedAt: timestamp("provider_submitted_at", { withTimezone: true }),
    providerEndedAt: timestamp("provider_ended_at", { withTimezone: true }),
    providerResultsImportedAt: timestamp("provider_results_imported_at", { withTimezone: true }),
    projectionSnapshotDigest: text("projection_snapshot_digest"),
    populationDigest: text("population_digest"),
    governanceDigest: text("governance_digest"),
    pricingVersion: text("pricing_version"),
    inputUsdPerMillionTokens: numeric("input_usd_per_million_tokens", { precision: 18, scale: 6 }),
    outputUsdPerMillionTokens: numeric("output_usd_per_million_tokens", { precision: 18, scale: 6 }),
    preflightDigest: text("preflight_digest"),
    requestDigest: text("request_digest"),
    idempotencyKey: text("idempotency_key"),
    estimatedCostMicroUsd: bigint("estimated_cost_micro_usd", { mode: "number" }),
    hardCapMicroUsd: bigint("hard_cap_micro_usd", { mode: "number" }),
    supersedesRunId: uuid("supersedes_run_id").references((): AnyPgColumn => signalSemanticResolutionRuns.id, { onDelete: "restrict" }),
    nextPolicyTransitionAt: timestamp("next_policy_transition_at", { withTimezone: true }),
    providerBatchItemLimit: integer("provider_batch_item_limit"),
    childBatchCount: integer("child_batch_count").notNull().default(0),
    completedChildBatchCount: integer("completed_child_batch_count").notNull().default(0),
    failedChildBatchCount: integer("failed_child_batch_count").notNull().default(0),
    canceledChildBatchCount: integer("canceled_child_batch_count").notNull().default(0),
    cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("uq_signal_semantic_resolution_active_workspace")
      .on(table.workspaceId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    index("idx_signal_semantic_resolution_runs_workspace")
      .on(table.workspaceId, table.createdAt, table.id),
    uniqueIndex("uq_signal_semantic_resolution_provider_batch")
      .on(table.providerBatchId)
      .where(sql`${table.providerBatchId} IS NOT NULL`)
  ]
);

export const signalSemanticResolutionChildBatches = pgTable(
  "signal_semantic_resolution_child_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => signalSemanticResolutionRuns.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    status: text("status").notNull().default("queued"),
    itemCount: integer("item_count").notNull(),
    completedItems: integer("completed_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    providerBatchId: text("provider_batch_id"),
    providerBatchStatus: text("provider_batch_status").notNull().default("not_submitted"),
    estimatedInputTokens: bigint("estimated_input_tokens", { mode: "number" }).notNull(),
    estimatedOutputTokens: bigint("estimated_output_tokens", { mode: "number" }).notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull(),
    estimatedCostMicroUsd: bigint("estimated_cost_micro_usd", { mode: "number" }).notNull(),
    reservedCostUsd: numeric("reserved_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    reservedCostMicroUsd: bigint("reserved_cost_micro_usd", { mode: "number" }).notNull().default(0),
    actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    actualCostMicroUsd: bigint("actual_cost_micro_usd", { mode: "number" }).notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorCode: text("error_code"),
    supersedesChildBatchId: uuid("supersedes_child_batch_id").references((): AnyPgColumn => signalSemanticResolutionChildBatches.id, { onDelete: "restrict" }),
    resumeIdempotencyKey: text("resume_idempotency_key"),
    createdAt: now(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_semantic_resolution_child_ordinal").on(table.runId, table.ordinal),
    unique("uq_signal_semantic_resolution_child_provider").on(table.providerBatchId),
    uniqueIndex("uq_signal_semantic_resolution_child_resume").on(table.runId, table.resumeIdempotencyKey).where(sql`${table.resumeIdempotencyKey} IS NOT NULL`)
  ]
);

export const signalSemanticResolutionRunItems = pgTable(
  "signal_semantic_resolution_run_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => signalSemanticResolutionRuns.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    contextHash: text("context_hash").notNull(),
    decision: jsonb("decision"),
    providerCustomId: text("provider_custom_id"),
    providerResultStatus: text("provider_result_status"),
    providerInputTokens: integer("provider_input_tokens").notNull().default(0),
    providerOutputTokens: integer("provider_output_tokens").notNull().default(0),
    providerCacheCreationInputTokens: integer("provider_cache_creation_input_tokens").notNull().default(0),
    providerCacheReadInputTokens: integer("provider_cache_read_input_tokens").notNull().default(0),
    providerCostUsd: numeric("provider_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    childBatchId: uuid("child_batch_id").references(() => signalSemanticResolutionChildBatches.id, { onDelete: "restrict" }),
    providerErrorCode: text("provider_error_code"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_semantic_resolution_run_item").on(table.runId, table.mentionId),
    index("idx_signal_semantic_resolution_items_pending")
      .on(table.runId, table.status, table.createdAt, table.id),
    index("idx_signal_semantic_resolution_items_mention")
      .on(table.workspaceId, table.mentionId, table.createdAt),
    uniqueIndex("uq_signal_semantic_resolution_provider_custom_id")
      .on(table.runId, table.providerCustomId)
      .where(sql`${table.providerCustomId} IS NOT NULL`),
    index("idx_signal_semantic_resolution_provider_results")
      .on(table.runId, table.providerResultStatus, table.providerCustomId)
  ]
);

export const signalSemanticResolutionChildOutbox = pgTable(
  "signal_semantic_resolution_child_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => signalSemanticResolutionRuns.id, { onDelete: "cascade" }),
    childBatchId: uuid("child_batch_id").notNull().references(() => signalSemanticResolutionChildBatches.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: now(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [unique("uq_signal_semantic_resolution_child_outbox").on(table.childBatchId)]
);

export const signalSemanticResolutionItemAttempts = pgTable(
  "signal_semantic_resolution_item_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runItemId: uuid("run_item_id").notNull().references(() => signalSemanticResolutionRunItems.id, { onDelete: "restrict" }),
    childBatchId: uuid("child_batch_id").notNull().references(() => signalSemanticResolutionChildBatches.id, { onDelete: "restrict" }),
    attempt: integer("attempt").notNull(),
    providerResultStatus: text("provider_result_status"),
    decisionDigest: text("decision_digest"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    errorCode: text("error_code"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("uq_signal_semantic_resolution_item_attempt").on(table.runItemId, table.childBatchId, table.attempt)]
);

export const signalSemanticResolutionRunEvents = pgTable(
  "signal_semantic_resolution_run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => signalSemanticResolutionRuns.id, { onDelete: "restrict" }),
    childBatchId: uuid("child_batch_id").references(() => signalSemanticResolutionChildBatches.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [unique("uq_signal_semantic_resolution_run_event").on(table.workspaceId, table.idempotencyKey)]
);

export const signalPopulationMemberships = pgTable(
  "signal_population_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    populationId: uuid("population_id")
      .notNull()
      .references(() => signalPopulationDefinitions.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id")
      .notNull()
      .references(() => mentions.id, { onDelete: "cascade" }),
    membershipStatus: text("membership_status").notNull().default("included"),
    membershipReason: text("membership_reason").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_population_membership").on(table.populationId, table.mentionId),
    check("signal_population_membership_status", sql`${table.membershipStatus} IN ('included', 'excluded')`),
    index("idx_signal_population_memberships_serving")
      .on(table.populationId, table.membershipStatus, table.mentionId)
      .where(sql`${table.removedAt} IS NULL`),
    index("idx_signal_population_memberships_workspace").on(table.workspaceId, table.mentionId)
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
    methodologySlug: text("methodology_slug"),
    promptVersion: text("prompt_version"),
    modelVersion: text("model_version"),
    corpusRevision: integer("corpus_revision"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    snapshotMentionCount: integer("snapshot_mention_count"),
    snapshotDigest: text("snapshot_digest"),
    scopeFrozenAt: timestamp("scope_frozen_at", { withTimezone: true }),
    workspaceId: uuid("workspace_id").references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    reportKey: text("report_key"),
    populationId: uuid("population_id").references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    populationVersion: integer("population_version"),
    populationDefinitionHash: text("population_definition_hash"),
    timezone: text("timezone"),
    runIdempotencyKey: text("run_idempotency_key"),
    strategicContractVersion: text("strategic_contract_version"),
    comparisonBaseAnalysisId: uuid("comparison_base_analysis_id").references(
      (): AnyPgColumn => tbAnalyses.id,
      { onDelete: "restrict" }
    ),
    comparisonCompatibilityState: text("comparison_compatibility_state"),
    comparisonCompatibility: jsonb("comparison_compatibility").notNull().default(sql`'{}'::jsonb`),

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
    check(
      "tb_analyses_temporal_period",
      sql`${table.periodStart} IS NULL OR ${table.periodEnd} IS NULL OR ${table.periodStart} <= ${table.periodEnd}`
    ),
    check(
      "tb_analyses_corpus_revision_nonnegative",
      sql`${table.corpusRevision} IS NULL OR ${table.corpusRevision} >= 0`
    ),
    check(
      "tb_analyses_snapshot_mention_count_nonnegative",
      sql`${table.snapshotMentionCount} IS NULL OR ${table.snapshotMentionCount} >= 0`
    ),
    check("tb_analyses_report_key", sql`${table.reportKey} IS NULL OR ${table.reportKey} ~ '^[a-z][a-z0-9-]*$'`),
    check("tb_analyses_population_version_positive", sql`${table.populationVersion} IS NULL OR ${table.populationVersion} >= 1`),
    check("tb_analyses_population_hash", sql`${table.populationDefinitionHash} IS NULL OR ${table.populationDefinitionHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check("tb_analyses_run_idempotency_key", sql`${table.runIdempotencyKey} IS NULL OR ${table.runIdempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    check("tb_analyses_strategic_identity", sql`${table.strategicContractVersion} IS NULL OR (
      ${table.strategicContractVersion} IN ('signal-tb-strategic-v1', 'signal-tb-strategic-v2')
      AND ${table.workspaceId} IS NOT NULL
      AND ${table.reportKey} IS NOT NULL
      AND ${table.populationId} IS NOT NULL
      AND ${table.populationVersion} >= 1
      AND ${table.populationDefinitionHash} ~ '^sha256:[0-9a-f]{64}$'
      AND NULLIF(btrim(${table.timezone}), '') IS NOT NULL
      AND ${table.runIdempotencyKey} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.snapshotDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.scopeFrozenAt} IS NOT NULL
    )`),
    check(
      "tb_analyses_comparison_compatibility_state",
      sql`${table.comparisonCompatibilityState} IS NULL OR ${table.comparisonCompatibilityState} IN ('not_evaluated', 'compatible', 'incompatible')`
    ),
    index("idx_tb_analyses_corpus").on(table.studyCorpusId, table.createdAt),
    index("idx_tb_analyses_status").on(table.status),
    index("idx_tb_analyses_temporal_scope").on(
      table.studyCorpusId,
      table.periodEnd,
      table.scopeFrozenAt
    ),
    index("idx_tb_analyses_comparison_base").on(table.comparisonBaseAnalysisId)
  ]
);

export const signalStrategicRunOutbox = pgTable(
  "signal_strategic_run_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    tbAnalysisId: uuid("tb_analysis_id").notNull().references(() => tbAnalyses.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => corpusSnapshots.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    bullmqJobId: text("bullmq_job_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    lastError: jsonb("last_error").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_strategic_run_outbox_analysis").on(table.tbAnalysisId),
    unique("uq_signal_strategic_run_outbox_idempotency").on(table.workspaceId, table.reportKey, table.idempotencyKey),
    check("signal_strategic_run_outbox_report_key", sql`${table.reportKey} ~ '^[a-z][a-z0-9-]*$'`),
    check("signal_strategic_run_outbox_status", sql`${table.status} IN ('pending', 'dispatching', 'dispatched', 'completed', 'failed', 'dead_letter')`),
    check("signal_strategic_run_outbox_attempt", sql`${table.attempt} >= 0`),
    check("signal_strategic_run_outbox_key", sql`${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_signal_strategic_run_outbox_dispatch")
      .on(table.availableAt, table.createdAt, table.id)
      .where(sql`${table.status} IN ('pending', 'failed')`),
    index("idx_signal_strategic_run_outbox_recovery")
      .on(table.status, table.availableAt, table.leaseExpiresAt, table.createdAt, table.id)
      .where(sql`${table.status} IN ('pending', 'failed', 'dispatching')`),
    index("idx_signal_strategic_run_outbox_bullmq_job")
      .on(table.bullmqJobId)
      .where(sql`${table.bullmqJobId} IS NOT NULL`)
  ]
);

export const tbAnalysisContextRefs = pgTable(
  "tb_analysis_context_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id").notNull().references(() => tbAnalyses.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceVersion: text("source_version").notNull(),
    sourceDigest: text("source_digest").notNull(),
    contextRole: text("context_role").notNull().default("contextual"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_analysis_context_ref").on(table.tbAnalysisId, table.sourceType, table.sourceId),
    check("tb_analysis_context_ref_source", sql`${table.sourceType} IN ('brand_knowledge_source', 'study_knowledge_source', 'knowledge_base', 'data_asset', 'data_contract', 'data_observation', 'data_asset_record')`),
    check("tb_analysis_context_ref_role", sql`${table.contextRole} IN ('contextual', 'structured_evidence', 'limitation')`),
    check("tb_analysis_context_ref_version", sql`btrim(${table.sourceVersion}) <> ''`),
    check("tb_analysis_context_ref_digest", sql`${table.sourceDigest} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_tb_analysis_context_refs_analysis").on(table.tbAnalysisId, table.sourceType, table.sourceId)
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

/**
 * Claim-specific governed evidence selected during T&B hierarchy synthesis.
 * Migration 0053 verifies that each reference is accepted and belongs to the
 * same corpus as the finding.
 */
export const tbFindingStructuredEvidenceRefs = pgTable(
  "tb_finding_structured_evidence_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => tbFindings.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    dataObservationId: uuid("data_observation_id").references(
      (): AnyPgColumn => dataObservations.id,
      { onDelete: "restrict" }
    ),
    dataAssetRecordId: uuid("data_asset_record_id").references(
      (): AnyPgColumn => dataAssetRecords.id,
      { onDelete: "restrict" }
    ),
    evidenceRole: text("evidence_role").notNull().default("claim_specific"),
    referenceToken: text("reference_token").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    check(
      "tb_finding_structured_evidence_refs_source_type",
      sql`${table.sourceType} IN ('data_observation', 'data_asset_record')`
    ),
    check(
      "tb_finding_structured_evidence_refs_role",
      sql`${table.evidenceRole} IN ('claim_specific', 'contextual', 'limitation')`
    ),
    check(
      "tb_finding_structured_evidence_refs_exactly_one_source",
      sql`((${table.dataObservationId} IS NOT NULL)::int + (${table.dataAssetRecordId} IS NOT NULL)::int) = 1`
    ),
    check(
      "tb_finding_structured_evidence_refs_source_matches",
      sql`(${table.sourceType} = 'data_observation' AND ${table.dataObservationId} IS NOT NULL)
        OR (${table.sourceType} = 'data_asset_record' AND ${table.dataAssetRecordId} IS NOT NULL)`
    ),
    unique("uq_tb_finding_structured_evidence_ref").on(table.findingId, table.referenceToken),
    index("idx_tb_finding_structured_evidence_finding").on(table.findingId, table.evidenceRole),
    index("idx_tb_finding_structured_evidence_observation").on(table.dataObservationId),
    index("idx_tb_finding_structured_evidence_record").on(table.dataAssetRecordId)
  ]
);

export const tbTemporalMetrics = pgTable(
  "tb_temporal_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    tbFindingId: uuid("tb_finding_id").references(() => tbFindings.id, { onDelete: "cascade" }),
    materializationKey: text("materialization_key").notNull().unique(),
    metricKey: text("metric_key").notNull(),
    metricVersion: integer("metric_version").notNull().default(1),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    platform: text("platform"),
    entityType: text("entity_type"),
    entityKey: text("entity_key"),
    polarity: text("polarity"),
    layer: text("layer"),
    findingKey: text("finding_key"),
    dimensions: jsonb("dimensions").notNull().default(sql`'{}'::jsonb`),
    value: numeric("value"),
    denominator: numeric("denominator"),
    sampleSize: integer("sample_size"),
    qualityState: text("quality_state").notNull().default("not_available"),
    qualityReasons: jsonb("quality_reasons").notNull().default(sql`'[]'::jsonb`),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => corpusSnapshots.id, { onDelete: "restrict" }),
    corpusRevision: integer("corpus_revision").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("tb_temporal_metrics_period", sql`${table.periodStart} <= ${table.periodEnd}`),
    check("tb_temporal_metrics_version_positive", sql`${table.metricVersion} >= 1`),
    check(
      "tb_temporal_metrics_sample_nonnegative",
      sql`${table.sampleSize} IS NULL OR ${table.sampleSize} >= 0`
    ),
    check(
      "tb_temporal_metrics_quality_state",
      sql`${table.qualityState} IN ('pass', 'partial', 'not_available')`
    ),
    index("idx_tb_temporal_metrics_analysis_metric").on(
      table.tbAnalysisId,
      table.metricKey,
      table.periodStart,
      table.periodEnd
    ),
    index("idx_tb_temporal_metrics_filter").on(
      table.tbAnalysisId,
      table.polarity,
      table.layer,
      table.platform,
      table.entityType,
      table.entityKey,
      table.findingKey
    ),
    index("idx_tb_temporal_metrics_finding").on(table.tbFindingId, table.metricKey)
  ]
);

export const tbFindingTemporalComparisons = pgTable(
  "tb_finding_temporal_comparisons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id")
      .notNull()
      .references(() => tbAnalyses.id, { onDelete: "cascade" }),
    comparisonBaseAnalysisId: uuid("comparison_base_analysis_id").references(
      () => tbAnalyses.id,
      { onDelete: "restrict" }
    ),
    currentFindingId: uuid("current_finding_id").references(() => tbFindings.id, { onDelete: "cascade" }),
    previousFindingId: uuid("previous_finding_id").references(() => tbFindings.id, { onDelete: "restrict" }),
    semanticKey: text("semantic_key").notNull(),
    movement: text("movement").notNull(),
    reason: text("reason").notNull(),
    currentValues: jsonb("current_values").notNull().default(sql`'{}'::jsonb`),
    previousValues: jsonb("previous_values").notNull().default(sql`'{}'::jsonb`),
    deltas: jsonb("deltas").notNull().default(sql`'{}'::jsonb`),
    similarity: numeric("similarity", { precision: 7, scale: 6 }),
    qualityState: text("quality_state").notNull(),
    qualityReasons: jsonb("quality_reasons").notNull().default(sql`'[]'::jsonb`),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("uq_tb_finding_temporal_comparison").on(table.tbAnalysisId, table.semanticKey),
    check(
      "tb_finding_temporal_comparisons_movement",
      sql`${table.movement} IN ('emerging', 'growing', 'declining', 'persistent', 'mutated', 'disappeared')`
    ),
    check(
      "tb_finding_temporal_comparisons_quality",
      sql`${table.qualityState} IN ('pass', 'partial', 'not_available')`
    ),
    check(
      "tb_finding_temporal_comparisons_pair",
      sql`${table.currentFindingId} IS NOT NULL OR ${table.previousFindingId} IS NOT NULL`
    ),
    index("idx_tb_finding_temporal_comparisons_analysis").on(
      table.tbAnalysisId,
      table.movement,
      table.qualityState
    ),
    index("idx_tb_finding_temporal_comparisons_base").on(table.comparisonBaseAnalysisId)
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    provider: text("provider").notNull(),
    connectionMethod: text("connection_method").notNull(),
    name: text("name").notNull(),
    sourceContractVersion: text("source_contract_version").notNull()
      .default("signal-data-source-scope-compat-v1"),
    sourceKey: text("source_key").notNull().default(""),
    mapping: jsonb("mapping").notNull().default(sql`'{}'::jsonb`),
    mappingVersion: integer("mapping_version").notNull().default(1),
    role: jsonb("role").notNull().default(sql`'{}'::jsonb`),
    governedScope: text("governed_scope"),
    governedEntityType: text("governed_entity_type"),
    governedEntityId: uuid("governed_entity_id"),
    scopePolicyVersion: text("scope_policy_version"),
    scopeReviewStatus: text("scope_review_status").notNull().default("pending"),
    scopeApprovedByUserId: uuid("scope_approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    scopeApprovalSource: text("scope_approval_source"),
    scopeApprovedAt: timestamp("scope_approved_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("internal"),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("idx_data_sources_workspace").on(table.workspaceId, table.sourceType, table.status),
    index("idx_data_sources_corpus").on(table.studyCorpusId, table.sourceType, table.status),
    index("idx_data_sources_brand").on(table.brandId, table.sourceType, table.status),
    index("idx_data_sources_governed_scope").on(table.workspaceId, table.governedScope, table.scopeReviewStatus),
    unique("uq_data_sources_workspace_source_key").on(table.workspaceId, table.sourceKey),
    check("data_sources_governed_scope", sql`${table.governedScope} IS NULL OR ${table.governedScope} IN ('primary_brand', 'competitor', 'category', 'reference', 'unattributed')`),
    check("data_sources_governed_entity_type", sql`${table.governedEntityType} IS NULL OR ${table.governedEntityType} IN ('brand', 'competitor', 'category', 'reference', 'unattributed')`),
    check("data_sources_scope_review", sql`${table.scopeReviewStatus} IN ('pending', 'approved', 'rejected')`),
    check("data_sources_scope_policy", sql`${table.scopePolicyVersion} IS NULL OR btrim(${table.scopePolicyVersion}) <> ''`),
    check("data_sources_scope_approval", sql`${table.scopeReviewStatus} <> 'approved' OR (
      ${table.governedScope} IS NOT NULL
      AND ${table.governedEntityType} IS NOT NULL
      AND ${table.scopeApprovalSource} IS NOT NULL
      AND ${table.scopeApprovedAt} IS NOT NULL
    )`)
  ]
);

export const sourceSyncRuns = pgTable(
  "source_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    importBatchId: uuid("import_batch_id")
      .references(() => importBatches.id, { onDelete: "restrict" }),
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
    index("idx_source_sync_runs_workspace").on(table.workspaceId, table.createdAt),
    index("idx_source_sync_runs_source").on(table.dataSourceId, table.createdAt)
    ,uniqueIndex("uq_source_sync_runs_import_batch")
      .on(table.importBatchId)
      .where(sql`${table.importBatchId} IS NOT NULL`)
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
      .references(() => studyCorpora.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    discoveryRunDigest: text("discovery_run_digest"),
    workspaceArtifactKind: text("workspace_artifact_kind"),
    workspaceAuthorityDigest: text("workspace_authority_digest"),
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
      sql`(
        ${table.studyCorpusId} IS NOT NULL AND ${table.workspaceId} IS NULL
        AND ${table.workspaceArtifactKind} IS NULL AND ${table.workspaceAuthorityDigest} IS NULL
        AND ${table.discoveryRunDigest} IS NULL
        AND ((${table.tbAnalysisId} IS NOT NULL)::int + (${table.engineAnalysisId} IS NOT NULL)::int) = 1
      ) OR (
        ${table.studyCorpusId} IS NULL AND ${table.workspaceId} IS NOT NULL
        AND ${table.tbAnalysisId} IS NULL AND ${table.engineAnalysisId} IS NULL
        AND ${table.workspaceArtifactKind} = 'topic_discovery'
        AND ${table.discoveryRunDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND ${table.workspaceAuthorityDigest} = ${table.discoveryRunDigest}
      ) OR (
        ${table.studyCorpusId} IS NULL AND ${table.workspaceId} IS NOT NULL
        AND ${table.tbAnalysisId} IS NULL AND ${table.engineAnalysisId} IS NULL
        AND ${table.workspaceArtifactKind} = 'semantic_context'
        AND ${table.discoveryRunDigest} IS NULL
        AND ${table.workspaceAuthorityDigest} ~ '^sha256:[0-9a-f]{64}$'
      )`
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
    uniqueIndex("uq_analysis_artifacts_discovery_key_revision")
      .on(table.workspaceId, table.discoveryRunDigest, table.artifactKey, table.revision)
      .where(sql`${table.workspaceId} IS NOT NULL AND ${table.discoveryRunDigest} IS NOT NULL`),
    uniqueIndex("uq_analysis_artifacts_semantic_context_key_revision")
      .on(table.workspaceId, table.workspaceAuthorityDigest, table.artifactKey, table.revision)
      .where(sql`${table.workspaceArtifactKind} = 'semantic_context'`),
    index("idx_analysis_artifacts_corpus_type").on(
      table.studyCorpusId,
      table.artifactType,
      table.reviewStatus,
      table.position
    ),
    index("idx_analysis_artifacts_tb").on(table.tbAnalysisId, table.artifactType, table.position),
    index("idx_analysis_artifacts_engine").on(table.engineAnalysisId, table.artifactType, table.position),
    index("idx_analysis_artifacts_discovery_review")
      .on(table.workspaceId, table.discoveryRunDigest, table.artifactType, table.reviewStatus, table.position)
      .where(sql`${table.workspaceId} IS NOT NULL`),
    index("idx_analysis_artifacts_semantic_context")
      .on(table.workspaceId, table.artifactType, table.reviewStatus, table.position)
      .where(sql`${table.workspaceArtifactKind} = 'semantic_context'`),
    unique("uq_analysis_artifacts_id_workspace").on(table.id, table.workspaceId)
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
    check(
      "analysis_artifact_review_events_action",
      sql`${table.action} IN ('accept', 'correct', 'limit', 'reject', 'accept_analysis')`
    ),
    check(
      "analysis_artifact_review_events_previous_status",
      sql`${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('draft', 'needs_review', 'accepted', 'corrected', 'rejected', 'limited')`
    ),
    check(
      "analysis_artifact_review_events_next_status",
      sql`${table.nextStatus} IN ('draft', 'needs_review', 'accepted', 'corrected', 'rejected', 'limited')`
    ),
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
    registryContractVersion: text("registry_contract_version"),
    artifactDigest: text("artifact_digest"),
    runtimeKind: text("runtime_kind"),
    artifactFormat: text("artifact_format"),
    configuration: jsonb("configuration"),
    configurationDigest: text("configuration_digest"),
    datasetDigest: text("dataset_digest"),
    goldSetDigest: text("gold_set_digest"),
    licenseKey: text("license_key"),
    provenanceDigest: text("provenance_digest"),
    taxonomyProfileId: uuid("taxonomy_profile_id").references(
      (): AnyPgColumn => signalTaxonomyProfiles.id,
      { onDelete: "restrict" }
    ),
    supersedesModelVersionId: uuid("supersedes_model_version_id").references(
      (): AnyPgColumn => taggingModelVersions.id,
      { onDelete: "restrict" }
    ),
    registryOperationId: uuid("registry_operation_id").references(
      (): AnyPgColumn => signalClassificationOperations.id,
      { onDelete: "restrict" }
    ),
    registeredByUserId: uuid("registered_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    unique("uq_tagging_model_versions_key_version").on(table.modelKey, table.version),
    uniqueIndex("uq_tagging_model_registry_supersedes")
      .on(table.supersedesModelVersionId)
      .where(sql`${table.supersedesModelVersionId} IS NOT NULL`)
  ]
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

export const signalQualityPolicies = pgTable(
  "signal_quality_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    policyKey: text("policy_key").notNull(),
    policyVersion: integer("policy_version").notNull(),
    status: text("status").notNull().default("draft"),
    minQualityScore: integer("min_quality_score"),
    requiredQualityFlags: text("required_quality_flags").array().notNull().default(emptyTextArray),
    forbiddenQualityFlags: text("forbidden_quality_flags").array().notNull().default(emptyTextArray),
    canonicalRootDisposition: text("canonical_root_disposition").notNull().default("evaluate"),
    definitionHash: text("definition_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    activatedByUserId: uuid("activated_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    creationIdempotencyKey: text("creation_idempotency_key").notNull(),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_quality_policy_version").on(table.workspaceId, table.policyKey, table.policyVersion),
    unique("uq_signal_quality_policy_creation").on(table.workspaceId, table.creationIdempotencyKey),
    uniqueIndex("uq_signal_quality_policy_active").on(table.workspaceId, table.policyKey).where(sql`${table.status} = 'active'`),
    index("idx_signal_quality_policies_workspace").on(table.workspaceId, table.status, table.policyKey, table.policyVersion)
  ]
);

export const signalRetentionPolicies = pgTable(
  "signal_retention_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    policyKey: text("policy_key").notNull(),
    policyVersion: integer("policy_version").notNull(),
    status: text("status").notNull().default("draft"),
    retentionState: text("retention_state").notNull(),
    retentionMode: text("retention_mode").notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }),
    expiryAction: text("expiry_action").notNull(),
    approvalEvidenceHash: text("approval_evidence_hash"),
    definitionHash: text("definition_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    creationIdempotencyKey: text("creation_idempotency_key").notNull(),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_retention_policy_version").on(table.workspaceId, table.policyKey, table.policyVersion),
    unique("uq_signal_retention_policy_creation").on(table.workspaceId, table.creationIdempotencyKey),
    uniqueIndex("uq_signal_retention_policy_active").on(table.workspaceId, table.policyKey).where(sql`${table.status} = 'active'`),
    index("idx_signal_retention_policies_workspace").on(table.workspaceId, table.status, table.policyKey, table.policyVersion)
  ]
);

export const signalLicensingPolicies = pgTable(
  "signal_licensing_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    policyKey: text("policy_key").notNull(),
    policyVersion: integer("policy_version").notNull(),
    status: text("status").notNull().default("draft"),
    approvalEvidenceHash: text("approval_evidence_hash"),
    definitionHash: text("definition_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    creationIdempotencyKey: text("creation_idempotency_key").notNull(),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_licensing_policy_version").on(table.workspaceId, table.policyKey, table.policyVersion),
    unique("uq_signal_licensing_policy_creation").on(table.workspaceId, table.creationIdempotencyKey),
    uniqueIndex("uq_signal_licensing_policy_active").on(table.workspaceId, table.policyKey).where(sql`${table.status} = 'active'`),
    index("idx_signal_licensing_policies_workspace").on(table.workspaceId, table.status, table.policyKey, table.policyVersion)
  ]
);

export const signalLicensingPolicyUsages = pgTable(
  "signal_licensing_policy_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    licensingPolicyId: uuid("licensing_policy_id").notNull().references(() => signalLicensingPolicies.id, { onDelete: "cascade" }),
    usagePurpose: text("usage_purpose").notNull(),
    decision: text("decision").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_licensing_policy_usage").on(table.licensingPolicyId, table.usagePurpose),
    index("idx_signal_licensing_policy_usages_workspace").on(table.workspaceId, table.usagePurpose, table.decision, table.licensingPolicyId)
  ]
);

export const signalProvenancePolicyBindings = pgTable(
  "signal_provenance_policy_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "restrict" }),
    bindingVersion: integer("binding_version").notNull(),
    status: text("status").notNull().default("draft"),
    qualityPolicyId: uuid("quality_policy_id").notNull().references(() => signalQualityPolicies.id, { onDelete: "restrict" }),
    retentionPolicyId: uuid("retention_policy_id").notNull().references(() => signalRetentionPolicies.id, { onDelete: "restrict" }),
    licensingPolicyId: uuid("licensing_policy_id").notNull().references(() => signalLicensingPolicies.id, { onDelete: "restrict" }),
    definitionHash: text("definition_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    activatedByUserId: uuid("activated_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    creationIdempotencyKey: text("creation_idempotency_key").notNull(),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_provenance_policy_binding_version").on(
      table.workspaceId, table.dataSourceId, table.importBatchId, table.bindingVersion
    ),
    unique("uq_signal_provenance_policy_binding_creation").on(table.workspaceId, table.creationIdempotencyKey),
    index("idx_signal_provenance_policy_bindings_source").on(table.workspaceId, table.dataSourceId, table.importBatchId, table.status)
  ]
);

export const signalDataGovernancePolicyEvents = pgTable(
  "signal_data_governance_policy_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    objectKind: text("object_kind").notNull(),
    objectId: uuid("object_id").notNull(),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    inputHash: text("input_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_data_governance_policy_event").on(table.workspaceId, table.idempotencyKey),
    index("idx_signal_data_governance_policy_events_object").on(table.workspaceId, table.objectKind, table.objectId, table.createdAt, table.id)
  ]
);

export const signalPopulationPolicyBundles = pgTable(
  "signal_population_policy_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    policyKey: text("policy_key").notNull(),
    policyVersion: integer("policy_version").notNull(),
    status: text("status").notNull().default("draft"),
    authorizedModules: text("authorized_modules").array().notNull(),
    allowedScopes: text("allowed_scopes").array().notNull(),
    acceptanceStatus: text("acceptance_status").notNull().default("included"),
    qualityContractStatus: text("quality_contract_status").notNull().default("not_available"),
    qualityPolicyKey: text("quality_policy_key"),
    qualityPolicyVersion: integer("quality_policy_version"),
    minQualityScore: integer("min_quality_score"),
    requiredQualityFlags: text("required_quality_flags").array().notNull().default(emptyTextArray),
    forbiddenQualityFlags: text("forbidden_quality_flags").array().notNull().default(emptyTextArray),
    eligibilityPolicy: text("eligibility_policy").notNull(),
    deduplicationPolicy: text("deduplication_policy").notNull().default("canonical-root"),
    visibilityClass: text("visibility_class").notNull(),
    denominatorKey: text("denominator_key").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    timezone: text("timezone"),
    retentionPolicyRef: text("retention_policy_ref"),
    licensingPolicyRef: text("licensing_policy_ref"),
    dataGovernanceContractStatus: text("data_governance_contract_status").notNull().default("not_available"),
    qualityPolicyId: uuid("quality_policy_id").references(() => signalQualityPolicies.id, { onDelete: "restrict" }),
    requiredUsagePurposes: text("required_usage_purposes").array().notNull().default(emptyTextArray),
    definitionHash: text("definition_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    activatedByUserId: uuid("activated_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_population_policy_bundle_version").on(table.workspaceId, table.policyKey, table.policyVersion),
    check("signal_population_policy_bundle_key", sql`${table.policyKey} ~ '^[a-z][a-z0-9-]*$'`),
    check("signal_population_policy_bundle_version_positive", sql`${table.policyVersion} >= 1 AND (${table.qualityPolicyVersion} IS NULL OR ${table.qualityPolicyVersion} >= 1)`),
    check("signal_population_policy_bundle_status", sql`${table.status} IN ('draft', 'active', 'retired')`),
    check("signal_population_policy_bundle_modules", sql`cardinality(${table.authorizedModules}) > 0 AND ${table.authorizedModules} <@ ARRAY['brand-monitoring', 'mentions', 'topics-narratives', 'triggers-barriers', 'admin-mentions']::text[]`),
    check("signal_population_policy_bundle_scopes", sql`${table.allowedScopes} <@ ARRAY['primary_brand', 'competitor', 'category', 'reference', 'unattributed']::text[]`),
    check("signal_population_policy_bundle_acceptance", sql`${table.acceptanceStatus} IN ('included', 'any')`),
    check("signal_population_policy_bundle_quality_contract", sql`(${table.qualityContractStatus} = 'resolved' AND ${table.qualityPolicyKey} ~ '^[a-z][a-z0-9-]*$' AND ${table.qualityPolicyVersion} IS NOT NULL) OR (${table.qualityContractStatus} = 'not_available' AND ${table.qualityPolicyKey} IS NULL AND ${table.qualityPolicyVersion} IS NULL AND ${table.minQualityScore} IS NULL AND cardinality(${table.requiredQualityFlags}) = 0 AND cardinality(${table.forbiddenQualityFlags}) = 0)`),
    check("signal_population_policy_bundle_quality_score", sql`${table.minQualityScore} IS NULL OR ${table.minQualityScore} BETWEEN 0 AND 10`),
    check("signal_population_policy_bundle_quality_flags", sql`NOT (${table.requiredQualityFlags} && ${table.forbiddenQualityFlags})`),
    check("signal_population_policy_bundle_eligibility", sql`${table.eligibilityPolicy} IN ('semantic-approved-eligible', 'workspace-reservoir', 'snapshot-membership')`),
    check("signal_population_policy_bundle_deduplication", sql`${table.deduplicationPolicy} = 'canonical-root'`),
    check("signal_population_policy_bundle_visibility", sql`${table.visibilityClass} IN ('client-safe', 'operator-only', 'strategic-internal')`),
    check("signal_population_policy_bundle_denominator", sql`${table.denominatorKey} IN ('eligible-canonical-roots', 'workspace-canonical-roots', 'snapshot-canonical-roots')`),
    check("signal_population_policy_bundle_period", sql`(${table.periodStart} IS NULL AND ${table.periodEnd} IS NULL AND ${table.timezone} IS NULL) OR (${table.periodStart} IS NOT NULL AND ${table.periodEnd} IS NOT NULL AND ${table.periodStart} <= ${table.periodEnd} AND NULLIF(btrim(${table.timezone}), '') IS NOT NULL)`),
    check("signal_population_policy_bundle_refs", sql`(${table.retentionPolicyRef} IS NULL OR ${table.retentionPolicyRef} ~ '^[a-z][a-z0-9-]*$') AND (${table.licensingPolicyRef} IS NULL OR ${table.licensingPolicyRef} ~ '^[a-z][a-z0-9-]*$')`),
    check("signal_population_policy_bundle_hash", sql`${table.definitionHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_population_policy_bundle_activation", sql`(${table.status} = 'draft' AND ${table.activatedByUserId} IS NULL AND ${table.activatedAt} IS NULL) OR (${table.status} IN ('active', 'retired') AND ${table.activatedByUserId} IS NOT NULL AND ${table.activatedAt} IS NOT NULL)`),
    check("signal_population_policy_bundle_effective_window", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`),
    index("idx_signal_population_policy_bundles_workspace").on(table.workspaceId, table.status, table.policyKey, table.policyVersion),
    index("idx_signal_population_policy_bundles_effective").on(table.workspaceId, table.effectiveFrom, table.effectiveTo).where(sql`${table.status} = 'active'`)
  ]
);

export const signalPopulationPolicyEntities = pgTable(
  "signal_population_policy_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    policyBundleId: uuid("policy_bundle_id").notNull().references(() => signalPopulationPolicyBundles.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: now()
  },
  (table) => [
    check("signal_population_policy_entity_scope", sql`${table.scope} IN ('primary_brand', 'competitor', 'category', 'reference')`),
    check("signal_population_policy_entity_type", sql`${table.entityType} IN ('brand', 'competitor', 'category', 'reference')`),
    check("signal_population_policy_entity_shape", sql`(${table.scope} = 'primary_brand' AND ${table.entityType} = 'brand') OR (${table.scope} = 'competitor' AND ${table.entityType} = 'competitor') OR (${table.scope} = 'category' AND ${table.entityType} = 'category') OR (${table.scope} = 'reference' AND ${table.entityType} = 'reference')`),
    unique("uq_signal_population_policy_entity").on(table.policyBundleId, table.scope, table.entityType, table.entityId),
    index("idx_signal_population_policy_entities_bundle").on(table.policyBundleId, table.scope, table.entityType, table.entityId),
    index("idx_signal_population_policy_entities_workspace").on(table.workspaceId, table.entityType, table.entityId)
  ]
);

export const signalGovernedViewPopulationDerivations = pgTable(
  "signal_governed_view_population_derivations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    viewKey: text("view_key").notNull(),
    policyBundleId: uuid("policy_bundle_id").notNull().references(() => signalPopulationPolicyBundles.id, { onDelete: "restrict" }),
    basePopulationId: uuid("base_population_id").notNull().references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    resolvedPopulationId: uuid("resolved_population_id").notNull().references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    policyDefinitionHash: text("policy_definition_hash").notNull(),
    compiledPlanHash: text("compiled_plan_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_governed_view_population_derivation").on(
      table.workspaceId,
      table.moduleKey,
      table.viewKey,
      table.policyBundleId
    ),
    unique("uq_signal_governed_view_resolved_population").on(table.resolvedPopulationId),
    check("signal_governed_view_population_derivation_identity", sql`${table.moduleKey} IN ('brand-monitoring', 'mentions', 'topics-narratives') AND ${table.viewKey} IN ('brand', 'competition', 'category', 'all-governed')`),
    check("signal_governed_view_population_derivation_distinct", sql`${table.basePopulationId} <> ${table.resolvedPopulationId}`),
    check("signal_governed_view_population_derivation_hashes", sql`${table.policyDefinitionHash} ~ '^sha256:[0-9a-f]{64}$' AND ${table.compiledPlanHash} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_signal_governed_view_population_derivations_base").on(
      table.workspaceId,
      table.basePopulationId,
      table.moduleKey,
      table.viewKey
    )
  ]
);

export const signalDataGovernanceEvaluations = pgTable(
  "signal_data_governance_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    policyBundleId: uuid("policy_bundle_id").notNull().references(() => signalPopulationPolicyBundles.id, { onDelete: "restrict" }),
    populationId: uuid("population_id").notNull().references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    qualityPolicyId: uuid("quality_policy_id").notNull().references(() => signalQualityPolicies.id, { onDelete: "restrict" }),
    moduleKey: text("module_key").notNull().default("brand-monitoring"),
    viewKey: text("view_key").notNull().default("brand"),
    usagePurposes: text("usage_purposes").array().notNull(),
    evaluationStatus: text("evaluation_status").notNull().default("draft"),
    candidateRootCount: integer("candidate_root_count").notNull().default(0),
    authorizedRootCount: integer("authorized_root_count").notNull().default(0),
    qualityBlockedCount: integer("quality_blocked_count").notNull().default(0),
    retentionBlockedCount: integer("retention_blocked_count").notNull().default(0),
    licensingBlockedCount: integer("licensing_blocked_count").notNull().default(0),
    governanceUnknownCount: integer("governance_unknown_count"),
    retentionPolicyDigest: text("retention_policy_digest").notNull(),
    licensingPolicyDigest: text("licensing_policy_digest").notNull(),
    policyEvaluationWatermark: timestamp("policy_evaluation_watermark", { withTimezone: true }).notNull(),
    nextPolicyTransitionAt: timestamp("next_policy_transition_at", { withTimezone: true }),
    governanceDigest: text("governance_digest").notNull(),
    definitionHash: text("definition_hash").notNull(),
    evaluatedByUserId: uuid("evaluated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_data_governance_evaluation").on(table.workspaceId, table.idempotencyKey),
    check("signal_data_governance_evaluation_module", sql`${table.moduleKey} IN ('brand-monitoring', 'mentions', 'topics-narratives') AND ${table.viewKey} IN ('brand', 'competition', 'category', 'all-governed')`),
    check("signal_data_governance_evaluation_transition", sql`${table.nextPolicyTransitionAt} IS NULL OR ${table.nextPolicyTransitionAt} > ${table.policyEvaluationWatermark}`),
    index("idx_signal_data_governance_evaluations_population").on(table.workspaceId, table.populationId, table.evaluationStatus, table.createdAt)
  ]
);

export const signalDataGovernanceEvaluationItems = pgTable(
  "signal_data_governance_evaluation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationId: uuid("evaluation_id").notNull().references(() => signalDataGovernanceEvaluations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    mentionId: uuid("mention_id").notNull().references(() => mentions.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    reasonCode: text("reason_code").notNull(),
    importMembershipId: uuid("import_membership_id").references(() => signalMentionImportMemberships.id, { onDelete: "restrict" }),
    provenanceBindingId: uuid("provenance_binding_id").references(() => signalProvenancePolicyBindings.id, { onDelete: "restrict" }),
    qualityPolicyId: uuid("quality_policy_id").notNull().references(() => signalQualityPolicies.id, { onDelete: "restrict" }),
    retentionPolicyId: uuid("retention_policy_id").references(() => signalRetentionPolicies.id, { onDelete: "restrict" }),
    licensingPolicyId: uuid("licensing_policy_id").references(() => signalLicensingPolicies.id, { onDelete: "restrict" }),
    governancePathHash: text("governance_path_hash").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_data_governance_evaluation_item").on(table.evaluationId, table.mentionId),
    index("idx_signal_data_governance_evaluation_items_reason").on(table.evaluationId, table.decision, table.reasonCode, table.mentionId),
    index("idx_signal_data_governance_evaluation_items_source").on(table.workspaceId, table.provenanceBindingId, table.mentionId)
  ]
);

export const signalPopulationPolicyCompilations = pgTable(
  "signal_population_policy_compilations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    policyBundleId: uuid("policy_bundle_id").notNull().references(() => signalPopulationPolicyBundles.id, { onDelete: "restrict" }),
    populationId: uuid("population_id").notNull().references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    moduleKey: text("module_key").notNull().default("brand-monitoring"),
    viewKey: text("view_key").notNull().default("brand"),
    compilationVersion: integer("compilation_version").notNull(),
    compiledPlanHash: text("compiled_plan_hash").notNull(),
    policyDefinitionHash: text("policy_definition_hash").notNull(),
    populationVersion: integer("population_version").notNull(),
    populationDefinitionHash: text("population_definition_hash").notNull(),
    membershipDigest: text("membership_digest").notNull(),
    sourceWatermarkHash: text("source_watermark_hash").notNull(),
    sourceWatermarkAt: timestamp("source_watermark_at", { withTimezone: true }),
    compilationStatus: text("compilation_status").notNull(),
    blockingReasons: text("blocking_reasons").array().notNull().default(emptyTextArray),
    governanceEvaluationId: uuid("governance_evaluation_id").references(() => signalDataGovernanceEvaluations.id, { onDelete: "restrict" }),
    qualityPolicyId: uuid("quality_policy_id").references(() => signalQualityPolicies.id, { onDelete: "restrict" }),
    qualityPolicyVersion: integer("quality_policy_version"),
    qualityPolicyHash: text("quality_policy_hash"),
    retentionPolicyDigest: text("retention_policy_digest"),
    licensingPolicyDigest: text("licensing_policy_digest"),
    usagePurposes: text("usage_purposes").array().notNull().default(emptyTextArray),
    authorizedRootCount: integer("authorized_root_count").notNull().default(0),
    qualityBlockedCount: integer("quality_blocked_count").notNull().default(0),
    retentionBlockedCount: integer("retention_blocked_count").notNull().default(0),
    licensingBlockedCount: integer("licensing_blocked_count").notNull().default(0),
    governanceUnknownCount: integer("governance_unknown_count"),
    policyEvaluationWatermark: timestamp("policy_evaluation_watermark", { withTimezone: true }),
    nextPolicyTransitionAt: timestamp("next_policy_transition_at", { withTimezone: true }),
    governanceDataWatermarkId: uuid("governance_data_watermark_id").references(() => signalDataWatermarks.id, { onDelete: "restrict" }),
    governanceDigest: text("governance_digest"),
    isCurrent: boolean("is_current").notNull().default(true),
    compiledByUserId: uuid("compiled_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    compiledAt: timestamp("compiled_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_population_policy_compilation_version").on(table.policyBundleId, table.populationId, table.compilationVersion),
    uniqueIndex("uq_signal_population_policy_compilation_current").on(table.policyBundleId, table.populationId, table.moduleKey, table.viewKey).where(sql`${table.isCurrent}`),
    check("signal_population_policy_compilation_version_positive", sql`${table.compilationVersion} >= 1 AND ${table.populationVersion} >= 1`),
    check("signal_population_policy_compilation_hashes", sql`${table.compiledPlanHash} ~ '^sha256:[0-9a-f]{64}$' AND ${table.policyDefinitionHash} ~ '^sha256:[0-9a-f]{64}$' AND ${table.populationDefinitionHash} ~ '^sha256:[0-9a-f]{64}$' AND ${table.membershipDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${table.sourceWatermarkHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_population_policy_compilation_status", sql`${table.compilationStatus} IN ('ready', 'stale', 'blocked')`),
    check("signal_population_policy_compilation_blockers", sql`(cardinality(${table.blockingReasons}) = 0 OR array_to_string(${table.blockingReasons}, ',') ~ '^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$') AND ((${table.compilationStatus} = 'ready' AND cardinality(${table.blockingReasons}) = 0) OR ${table.compilationStatus} = 'stale' OR (${table.compilationStatus} = 'blocked' AND cardinality(${table.blockingReasons}) > 0))`),
    check("signal_population_policy_compilation_current_window", sql`(${table.isCurrent} AND ${table.retiredAt} IS NULL) OR (NOT ${table.isCurrent} AND ${table.retiredAt} IS NOT NULL AND ${table.retiredAt} >= ${table.compiledAt})`),
    check("signal_population_policy_compilation_module", sql`(${table.moduleKey} IN ('brand-monitoring', 'mentions', 'topics-narratives') AND ${table.viewKey} IN ('brand', 'competition', 'category', 'all-governed')) OR (${table.moduleKey} = 'triggers-barriers' AND ${table.viewKey} = 'strategic')`),
    check("signal_population_policy_compilation_transition", sql`${table.nextPolicyTransitionAt} IS NULL OR ${table.policyEvaluationWatermark} IS NULL OR ${table.nextPolicyTransitionAt} > ${table.policyEvaluationWatermark}`),
    index("idx_signal_population_policy_compilations_workspace").on(table.workspaceId, table.compilationStatus, table.policyBundleId, table.populationId).where(sql`${table.isCurrent}`),
    index("idx_signal_population_policy_compilations_population").on(table.populationId, table.compilationStatus, table.isCurrent),
    index("idx_signal_population_policy_compilation_transition").on(table.workspaceId, table.nextPolicyTransitionAt, table.moduleKey, table.viewKey).where(sql`${table.isCurrent} AND ${table.nextPolicyTransitionAt} IS NOT NULL`)
  ]
);

export const signalStrategicRunControls = pgTable(
  "signal_strategic_run_controls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    reportKey: text("report_key").notNull().default("triggers-barriers"),
    tbAnalysisId: uuid("tb_analysis_id").notNull().references(() => tbAnalyses.id, { onDelete: "cascade" }).unique(),
    snapshotId: uuid("snapshot_id").notNull().references(() => corpusSnapshots.id, { onDelete: "restrict" }).unique(),
    bindingId: uuid("binding_id").notNull().references(() => signalGovernedViewBindings.id, { onDelete: "restrict" }),
    policyBundleId: uuid("policy_bundle_id").notNull().references(() => signalPopulationPolicyBundles.id, { onDelete: "restrict" }),
    policyCompilationId: uuid("policy_compilation_id").notNull().references(() => signalPopulationPolicyCompilations.id, { onDelete: "restrict" }),
    governanceEvaluationId: uuid("governance_evaluation_id").notNull().references(() => signalDataGovernanceEvaluations.id, { onDelete: "restrict" }),
    populationId: uuid("population_id").notNull().references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    preflightDigest: text("preflight_digest").notNull(),
    requestDigest: text("request_digest").notNull(),
    snapshotAuthorityDigest: text("snapshot_authority_digest").notNull(),
    policyDefinitionHash: text("policy_definition_hash").notNull(),
    compiledPlanHash: text("compiled_plan_hash").notNull(),
    membershipDigest: text("membership_digest").notNull(),
    governanceDigest: text("governance_digest").notNull(),
    provenanceDigest: text("provenance_digest").notNull(),
    watermarkHash: text("watermark_hash").notNull(),
    authorityValidUntil: timestamp("authority_valid_until", { withTimezone: true }),
    usagePurposes: text("usage_purposes").array().notNull(),
    sampleAlgorithm: text("sample_algorithm").notNull(),
    sampleSeed: text("sample_seed").notNull(),
    sampleCount: integer("sample_count").notNull(),
    sampleDigest: text("sample_digest").notNull(),
    executionPlanVersion: text("execution_plan_version").notNull(),
    executionPlanDigest: text("execution_plan_digest").notNull(),
    executionPlan: jsonb("execution_plan").notNull(),
    plannedProviderCalls: integer("planned_provider_calls").notNull(),
    plannedInputTokens: bigint("planned_input_tokens", { mode: "number" }).notNull(),
    plannedOutputTokens: bigint("planned_output_tokens", { mode: "number" }).notNull(),
    provider: text("provider").notNull(),
    providerConfigDigest: text("provider_config_digest").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    pricingVersion: text("pricing_version").notNull(),
    inputUsdPerMillionTokens: numeric("input_usd_per_million_tokens", { precision: 14, scale: 6 }).notNull(),
    outputUsdPerMillionTokens: numeric("output_usd_per_million_tokens", { precision: 14, scale: 6 }).notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 6 }).notNull(),
    hardCapUsd: numeric("hard_cap_usd", { precision: 14, scale: 6 }).notNull(),
    reservedCostUsd: numeric("reserved_cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
    actualCostUsd: numeric("actual_cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
    status: text("status").notNull().default("queued"),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_strategic_run_control_key").on(table.workspaceId, table.reportKey, table.idempotencyKey),
    index("idx_signal_strategic_run_controls_workspace").on(table.workspaceId, table.createdAt)
  ]
);

export const signalStrategicSealedSampleItems = pgTable(
  "signal_strategic_sealed_sample_items",
  {
    runControlId: uuid("run_control_id").notNull().references(() => signalStrategicRunControls.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => corpusSnapshots.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    mentionId: uuid("mention_id").notNull().references(() => mentions.id, { onDelete: "restrict" }),
    rankHash: text("rank_hash").notNull(),
    createdAt: now()
  },
  (table) => [
    primaryKey({ columns: [table.runControlId, table.ordinal] }),
    unique("uq_signal_strategic_sealed_sample_root").on(table.runControlId, table.mentionId)
  ]
);

export const signalStrategicBudgetReservations = pgTable(
  "signal_strategic_budget_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runControlId: uuid("run_control_id").notNull().references(() => signalStrategicRunControls.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    operationKey: text("operation_key").notNull(),
    reservationUsd: numeric("reservation_usd", { precision: 14, scale: 6 }).notNull(),
    reservedInputTokens: bigint("reserved_input_tokens", { mode: "number" }),
    reservedOutputTokens: bigint("reserved_output_tokens", { mode: "number" }),
    inputTokens: bigint("input_tokens", { mode: "number" }),
    outputTokens: bigint("output_tokens", { mode: "number" }),
    actualUsd: numeric("actual_usd", { precision: 14, scale: 6 }),
    status: text("status").notNull().default("reserved"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now(),
    settledAt: timestamp("settled_at", { withTimezone: true })
  },
  (table) => [
    unique("uq_signal_strategic_budget_reservation_key").on(table.runControlId, table.idempotencyKey)
    ,unique("uq_signal_strategic_budget_reservation_operation").on(table.runControlId, table.operationKey)
  ]
);

export const signalStrategicStepOutbox = pgTable(
  "signal_strategic_step_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runControlId: uuid("run_control_id").notNull().references(() => signalStrategicRunControls.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    tbAnalysisId: uuid("tb_analysis_id").notNull().references(() => tbAnalyses.id, { onDelete: "cascade" }),
    pipelineStepId: uuid("pipeline_step_id").notNull().references(() => tbPipelineSteps.id, { onDelete: "cascade" }).unique(),
    pipelineStep: text("pipeline_step").notNull(),
    attempt: integer("attempt").notNull().default(1),
    dispatchAttempt: integer("dispatch_attempt").notNull().default(0),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    bullmqJobId: text("bullmq_job_id"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    lastError: jsonb("last_error").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_strategic_step_outbox_key").on(table.runControlId, table.idempotencyKey),
    unique("uq_signal_strategic_step_outbox_attempt").on(table.runControlId, table.pipelineStep, table.attempt),
    index("idx_signal_strategic_step_outbox_recovery").on(table.availableAt, table.createdAt, table.id)
  ]
);

export const signalStrategicStepOutboxEvents = pgTable(
  "signal_strategic_step_outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outboxId: uuid("outbox_id").notNull().references(() => signalStrategicStepOutbox.id, { onDelete: "restrict" }),
    runControlId: uuid("run_control_id").notNull().references(() => signalStrategicRunControls.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    previousStatus: text("previous_status"),
    nextStatus: text("next_status").notNull(),
    transitionKey: text("transition_key").notNull(),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_strategic_step_outbox_event").on(table.outboxId, table.transitionKey),
    index("idx_signal_strategic_step_outbox_events_run").on(table.runControlId, table.createdAt, table.id)
  ]
);

export const signalStrategicReviewReleaseOperations = pgTable(
  "signal_strategic_review_release_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    tbAnalysisId: uuid("tb_analysis_id").notNull().references(() => tbAnalyses.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    requestDigest: text("request_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    releaseId: uuid("release_id").notNull().references(() => signalWorkspaceReleases.id, { onDelete: "restrict" }),
    reviewedAssertionCount: integer("reviewed_assertion_count").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_strategic_review_release_operation").on(table.workspaceId, table.idempotencyKey)
  ]
);

export const signalStrategicReleasePromotionOperations = pgTable(
  "signal_strategic_release_promotion_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    reportKey: text("report_key").notNull(),
    releaseId: uuid("release_id").notNull().references(() => signalWorkspaceReleases.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    requestDigest: text("request_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_strategic_release_promotion_operation").on(table.workspaceId, table.idempotencyKey),
    check("signal_strategic_release_promotion_identity", sql`${table.reportKey} = 'triggers-barriers' AND ${table.action} = 'publish'`),
    check("signal_strategic_release_promotion_hashes", sql`${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`)
  ]
);

export const signalDataGovernanceInvalidations = pgTable(
  "signal_data_governance_invalidations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    policyCompilationId: uuid("policy_compilation_id").notNull().references(() => signalPopulationPolicyCompilations.id, { onDelete: "cascade" }),
    reasonCode: text("reason_code").notNull(),
    objectKind: text("object_kind").notNull(),
    objectIdentityHash: text("object_identity_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_data_governance_invalidation").on(table.idempotencyKey),
    index("idx_signal_data_governance_invalidations_compilation").on(table.policyCompilationId, table.createdAt)
  ]
);

export const signalGovernedViewBindings = pgTable(
  "signal_governed_view_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    viewKey: text("view_key").notNull(),
    bindingVersion: integer("binding_version").notNull(),
    policyBundleId: uuid("policy_bundle_id").notNull().references(() => signalPopulationPolicyBundles.id, { onDelete: "restrict" }),
    policyDefinitionHash: text("policy_definition_hash").notNull(),
    populationId: uuid("population_id").references(() => signalPopulationDefinitions.id, { onDelete: "restrict" }),
    policyCompilationId: uuid("policy_compilation_id").references(() => signalPopulationPolicyCompilations.id, { onDelete: "restrict" }),
    bindingStatus: text("binding_status").notNull().default("current"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    promotedByUserId: uuid("promoted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_governed_view_binding_version").on(table.workspaceId, table.moduleKey, table.viewKey, table.bindingVersion),
    uniqueIndex("uq_signal_governed_view_binding_current").on(table.workspaceId, table.moduleKey, table.viewKey).where(sql`${table.bindingStatus} = 'current'`),
    check("signal_governed_view_binding_module", sql`${table.moduleKey} IN ('brand-monitoring', 'mentions', 'topics-narratives', 'triggers-barriers', 'admin-mentions')`),
    check("signal_governed_view_binding_view", sql`${table.viewKey} IN ('brand', 'competition', 'category', 'all-governed', 'strategic', 'admin-reservoir')`),
    check("signal_governed_view_binding_version_positive", sql`${table.bindingVersion} >= 1`),
    check("signal_governed_view_binding_hash", sql`${table.policyDefinitionHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_governed_view_binding_compilation_shape", sql`(${table.populationId} IS NULL AND ${table.policyCompilationId} IS NULL) OR (${table.populationId} IS NOT NULL AND ${table.policyCompilationId} IS NOT NULL)`),
    check("signal_governed_view_binding_status", sql`${table.bindingStatus} IN ('current', 'retired')`),
    check("signal_governed_view_binding_window", sql`(${table.bindingStatus} = 'current' AND ${table.effectiveTo} IS NULL) OR (${table.bindingStatus} = 'retired' AND ${table.effectiveTo} IS NOT NULL AND ${table.effectiveTo} >= ${table.effectiveFrom})`),
    index("idx_signal_governed_view_bindings_policy").on(table.policyBundleId, table.bindingStatus),
    index("idx_signal_governed_view_bindings_population").on(table.populationId, table.bindingStatus).where(sql`${table.populationId} IS NOT NULL`),
    index("idx_signal_governed_view_bindings_compilation").on(table.policyCompilationId, table.bindingStatus).where(sql`${table.policyCompilationId} IS NOT NULL`)
  ]
);

export const signalGovernedViewBindingEvents = pgTable(
  "signal_governed_view_binding_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    viewKey: text("view_key").notNull(),
    action: text("action").notNull(),
    previousBindingId: uuid("previous_binding_id").references(() => signalGovernedViewBindings.id, { onDelete: "restrict" }),
    nextBindingId: uuid("next_binding_id").references(() => signalGovernedViewBindings.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest"),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_governed_view_binding_event_idempotency").on(table.workspaceId, table.idempotencyKey),
    check("signal_governed_view_binding_event_module", sql`${table.moduleKey} IN ('brand-monitoring', 'mentions', 'topics-narratives', 'triggers-barriers', 'admin-mentions')`),
    check("signal_governed_view_binding_event_view", sql`${table.viewKey} IN ('brand', 'competition', 'category', 'all-governed', 'strategic', 'admin-reservoir')`),
    check("signal_governed_view_binding_event_action", sql`${table.action} IN ('promote', 'rollback', 'withdraw-to-bridge', 'withdraw-to-absence')`),
    check("signal_governed_view_binding_event_key", sql`${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_governed_view_binding_event_request_digest", sql`${table.requestDigest} IS NULL OR ${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_governed_view_binding_event_transition_shape", sql`(${table.action} IN ('promote', 'rollback') AND ${table.nextBindingId} IS NOT NULL) OR (${table.action} = 'withdraw-to-bridge' AND ${table.viewKey} = 'brand' AND ${table.previousBindingId} IS NOT NULL AND ${table.nextBindingId} IS NULL AND ${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$') OR (${table.action} = 'withdraw-to-absence' AND ${table.viewKey} IN ('competition', 'category', 'all-governed') AND ${table.previousBindingId} IS NOT NULL AND ${table.nextBindingId} IS NULL AND ${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$')`),
    index("idx_signal_governed_view_binding_events_history").on(table.workspaceId, table.moduleKey, table.viewKey, table.createdAt, table.id)
  ]
);

export const signalGovernedBrandBindingSetOperations = pgTable(
  "signal_governed_brand_binding_set_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    viewKey: text("view_key").notNull().default("brand"),
    action: text("action").notNull(),
    policyBundleId: uuid("policy_bundle_id").notNull().references(() => signalPopulationPolicyBundles.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    requestDigest: text("request_digest").notNull(),
    resultDigest: text("result_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_governed_brand_binding_set_idempotency").on(table.workspaceId, table.idempotencyKey),
    check("signal_governed_brand_binding_set_action", sql`(${table.viewKey} = 'brand' AND ${table.action} IN ('promote', 'withdraw-to-bridge')) OR (${table.viewKey} IN ('competition', 'category', 'all-governed') AND ${table.action} IN ('promote', 'withdraw-to-absence'))`),
    check("signal_governed_view_binding_set_view", sql`${table.viewKey} IN ('brand', 'competition', 'category', 'all-governed')`),
    check("signal_governed_brand_binding_set_hashes", sql`${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${table.resultDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_signal_governed_brand_binding_set_history").on(table.workspaceId, table.createdAt, table.id)
  ]
);

export const signalGovernedBrandBindingSetOperationItems = pgTable(
  "signal_governed_brand_binding_set_operation_items",
  {
    operationId: uuid("operation_id").notNull().references(() => signalGovernedBrandBindingSetOperations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    viewKey: text("view_key").notNull().default("brand"),
    previousBindingId: uuid("previous_binding_id").references(() => signalGovernedViewBindings.id, { onDelete: "restrict" }),
    nextBindingId: uuid("next_binding_id").references(() => signalGovernedViewBindings.id, { onDelete: "restrict" }),
    bindingEventId: uuid("binding_event_id").notNull().references(() => signalGovernedViewBindingEvents.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.moduleKey, table.viewKey] }),
    unique("uq_signal_governed_brand_binding_set_event").on(table.bindingEventId),
    check("signal_governed_brand_binding_set_item_identity", sql`${table.moduleKey} IN ('brand-monitoring', 'mentions', 'topics-narratives') AND ${table.viewKey} IN ('brand', 'competition', 'category', 'all-governed')`)
  ]
);

export const signalGovernanceControlOperations = pgTable(
  "signal_governance_control_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    requestDigest: text("request_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("in_progress"),
    result: jsonb("result"),
    semanticContextDecisionInput: jsonb("semantic_context_decision_input"),
    semanticContextDecisionInputDigest: text("semantic_context_decision_input_digest"),
    createdAt: now(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    unique("uq_signal_governance_control_operation").on(table.workspaceId,table.idempotencyKey),
    check("signal_governance_control_action",sql`${table.action} IN (
      'create-quality-draft','create-retention-draft','create-licensing-draft',
      'activate-policy','create-provenance-binding-draft','activate-provenance-binding',
      'upsert-identity','update-timezone','reconcile-brand-os',
      'create-source','import-source','reconcile-governed-view',
      'reconcile-strategic-authority','promote-strategic-authority',
      'reconcile-acquisition-plan','promote-acquisition-plan','create-acquisition-query',
      'review-acquisition-query','retire-acquisition-slot','decide-acquisition-reference',
      'retire-competitor','reactivate-competitor','create-competitor','seal-acquisition-import',
      'seal-acquisition-brief','generate-acquisition-queries','authorize-acquisition-benchmark',
      'register-topic-discovery-review','save-topic-discovery-review-draft',
      'save-topic-discovery-outlier-draft','finalize-topic-discovery-review',
      'supersede-topic-discovery-review','create-semantic-context-draft','reconcile-semantic-context-generation',
      'append-semantic-context-proposals','decide-semantic-context-element',
      'bulk-approve-semantic-context-elements','publish-semantic-context-generation',
      'start-semantic-context-proposal-run','retry-semantic-context-proposal-run',
      'revalidate-semantic-context-proposal-run','merge-semantic-context-elements',
      'correct-semantic-context-element','annotate-semantic-context-element',
      'resolve-semantic-context-annotation','repair-semantic-context-annotation-resolution',
      'decide-semantic-context-locale-authority','edit-semantic-context-element-v1',
      'create-semantic-context-element-v1'
    )`),
    check("signal_governance_control_hashes",sql`${table.requestDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_governance_control_status",sql`${table.status} IN ('in_progress','completed')`),
    index("idx_signal_governance_control_operations_workspace").on(table.workspaceId,table.createdAt)
  ]
);

export const signalTopicDiscoveryReviewPackets = pgTable(
  "signal_topic_discovery_review_packets",
  {
    artifactId: uuid("artifact_id").primaryKey().references(() => analysisArtifacts.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    discoveryRunDigest: text("discovery_run_digest").notNull(),
    candidateArtifactDigest: text("candidate_artifact_digest").notNull(),
    packetDigest: text("packet_digest").notNull(),
    packetFileDigest: text("packet_file_digest").notNull(),
    sourceManifestDigest: text("source_manifest_digest").notNull(),
    packetPolicyVersion: text("packet_policy_version").notNull(),
    packetPolicyDigest: text("packet_policy_digest").notNull(),
    referenceSeed: integer("reference_seed").notNull(),
    rightsDigest: text("rights_digest").notNull(),
    rightsValidUntil: timestamp("rights_valid_until", { withTimezone: true }),
    modelingDenominator: integer("modeling_denominator").notNull(),
    proposalCount: integer("proposal_count").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    outlierEvidenceCount: integer("outlier_evidence_count").notNull(),
    reviewScope: text("review_scope").notNull(),
    sourceHoldoutState: text("source_holdout_state").notNull(),
    registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    registeredAt: now()
  },
  (table) => [
    unique("uq_signal_topic_discovery_review_packet_digest").on(table.workspaceId, table.packetDigest),
    check("signal_topic_discovery_review_packet_digests", sql`
      ${table.discoveryRunDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.candidateArtifactDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.packetDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.packetFileDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.sourceManifestDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.packetPolicyDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.rightsDigest} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_topic_discovery_review_packet_counts", sql`
      ${table.modelingDenominator} > 0 AND ${table.proposalCount} > 0
      AND ${table.evidenceCount} >= ${table.proposalCount} AND ${table.outlierEvidenceCount} >= 0`),
    check("signal_topic_discovery_review_packet_scope", sql`
      ${table.reviewScope} = 'complete_cluster_census' AND ${table.sourceHoldoutState} = 'sealed'`)
  ]
);

export const signalTopicDiscoveryReviews = pgTable(
  "signal_topic_discovery_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    packetArtifactId: uuid("packet_artifact_id").notNull().references(() => signalTopicDiscoveryReviewPackets.artifactId, { onDelete: "restrict" }),
    reviewRevision: integer("review_revision").notNull(),
    supersedesReviewId: uuid("supersedes_review_id").references((): AnyPgColumn => signalTopicDiscoveryReviews.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    check("signal_topic_discovery_review_revision_positive", sql`${table.reviewRevision} > 0`),
    unique("uq_signal_topic_discovery_review_revision").on(table.packetArtifactId, table.reviewRevision),
    uniqueIndex("uq_signal_topic_discovery_review_successor").on(table.supersedesReviewId)
      .where(sql`${table.supersedesReviewId} IS NOT NULL`),
    index("idx_signal_topic_discovery_reviews_workspace").on(table.workspaceId, table.packetArtifactId, table.reviewRevision)
  ]
);

export const signalTopicDiscoveryReviewDecisions = pgTable(
  "signal_topic_discovery_review_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    reviewId: uuid("review_id").notNull().references(() => signalTopicDiscoveryReviews.id, { onDelete: "restrict" }),
    proposalArtifactId: uuid("proposal_artifact_id").notNull().references(() => analysisArtifacts.id, { onDelete: "restrict" }),
    decisionRevision: integer("decision_revision").notNull(),
    supersedesDecisionId: uuid("supersedes_decision_id").references((): AnyPgColumn => signalTopicDiscoveryReviewDecisions.id, { onDelete: "restrict" }),
    state: text("state").notNull(),
    candidateArtifactDigest: text("candidate_artifact_digest").notNull(),
    discoveryProposalKey: text("discovery_proposal_key").notNull(),
    clusterKey: text("cluster_key").notNull(),
    evidenceRefs: text("evidence_refs").array().notNull(),
    dataSplit: text("data_split").notNull(),
    reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    internalCoherence: smallint("internal_coherence"),
    neighborDistinction: smallint("neighbor_distinction"),
    humanNameability: smallint("human_nameability"),
    strategicUtility: smallint("strategic_utility"),
    mergeNeeded: boolean("merge_needed"),
    splitNeeded: boolean("split_needed"),
    convertToTopicContractCandidate: boolean("convert_to_topic_contract_candidate"),
    noneAcceptable: boolean("none_acceptable"),
    notes: text("notes"),
    decisionDigest: text("decision_digest").notNull(),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_topic_discovery_review_decision_revision")
      .on(table.reviewId, table.proposalArtifactId, table.decisionRevision),
    uniqueIndex("uq_signal_topic_discovery_review_decision_successor").on(table.supersedesDecisionId)
      .where(sql`${table.supersedesDecisionId} IS NOT NULL`),
    index("idx_signal_topic_discovery_review_decision_current")
      .on(table.reviewId, table.proposalArtifactId, table.decisionRevision),
    check("signal_topic_discovery_review_decision_revision_positive", sql`${table.decisionRevision} > 0`),
    check("signal_topic_discovery_review_decision_state", sql`${table.state} IN ('draft','finalized')`),
    check("signal_topic_discovery_review_decision_score_ranges", sql`
      (${table.internalCoherence} IS NULL OR ${table.internalCoherence} BETWEEN 1 AND 5)
      AND (${table.neighborDistinction} IS NULL OR ${table.neighborDistinction} BETWEEN 1 AND 5)
      AND (${table.humanNameability} IS NULL OR ${table.humanNameability} BETWEEN 1 AND 5)
      AND (${table.strategicUtility} IS NULL OR ${table.strategicUtility} BETWEEN 1 AND 5)`),
    check("signal_topic_discovery_review_decision_final_complete", sql`${table.state} = 'draft' OR (
      ${table.internalCoherence} IS NOT NULL AND ${table.neighborDistinction} IS NOT NULL
      AND ${table.humanNameability} IS NOT NULL AND ${table.strategicUtility} IS NOT NULL
      AND ${table.mergeNeeded} IS NOT NULL AND ${table.splitNeeded} IS NOT NULL
      AND ${table.convertToTopicContractCandidate} IS NOT NULL AND ${table.noneAcceptable} IS NOT NULL
    )`),
    check("signal_topic_discovery_review_decision_authority_separation", sql`
      NOT (COALESCE(${table.noneAcceptable},false) AND COALESCE(${table.convertToTopicContractCandidate},false))`),
    check("signal_topic_discovery_review_decision_digests", sql`
      ${table.candidateArtifactDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.decisionDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND cardinality(${table.evidenceRefs}) > 0`)
  ]
);

export const signalTopicDiscoveryOutlierDecisions = pgTable(
  "signal_topic_discovery_outlier_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    reviewId: uuid("review_id").notNull().references(() => signalTopicDiscoveryReviews.id, { onDelete: "restrict" }),
    decisionRevision: integer("decision_revision").notNull(),
    supersedesDecisionId: uuid("supersedes_decision_id").references((): AnyPgColumn => signalTopicDiscoveryOutlierDecisions.id, { onDelete: "restrict" }),
    state: text("state").notNull(),
    studyBoundaryThresholds: boolean("study_boundary_thresholds"),
    studyMissingTopicFamilies: boolean("study_missing_topic_families"),
    studyLaterRecovery: boolean("study_later_recovery"),
    notes: text("notes"),
    reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    decisionDigest: text("decision_digest").notNull(),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_topic_discovery_outlier_decision_revision").on(table.reviewId, table.decisionRevision),
    uniqueIndex("uq_signal_topic_discovery_outlier_decision_successor").on(table.supersedesDecisionId)
      .where(sql`${table.supersedesDecisionId} IS NOT NULL`),
    check("signal_topic_discovery_outlier_decision_revision_positive", sql`${table.decisionRevision} > 0`),
    check("signal_topic_discovery_outlier_decision_state", sql`${table.state} IN ('draft','finalized')`),
    check("signal_topic_discovery_outlier_decision_final_complete", sql`${table.state} = 'draft' OR (
      ${table.studyBoundaryThresholds} IS NOT NULL
      AND ${table.studyMissingTopicFamilies} IS NOT NULL
      AND ${table.studyLaterRecovery} IS NOT NULL
    )`),
    check("signal_topic_discovery_outlier_decision_digest", sql`${table.decisionDigest} ~ '^sha256:[0-9a-f]{64}$'`)
  ]
);

export const signalTopicDiscoveryReviewEvents = pgTable(
  "signal_topic_discovery_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    reviewId: uuid("review_id").notNull().references(() => signalTopicDiscoveryReviews.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    eventIndex: integer("event_index").notNull(),
    eventKind: text("event_kind").notNull(),
    previousState: text("previous_state"),
    nextState: text("next_state").notNull(),
    outcome: text("outcome"),
    outlierDecisionDigest: text("outlier_decision_digest"),
    scoreSheetDigest: text("score_sheet_digest"),
    decisionSheetDigest: text("decision_sheet_digest"),
    reviewDigest: text("review_digest").notNull(),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_topic_discovery_review_operation_event").on(table.operationId, table.eventIndex),
    index("idx_signal_topic_discovery_review_events_history").on(table.reviewId, table.createdAt, table.id),
    check("signal_topic_discovery_review_event_index_nonnegative", sql`${table.eventIndex} >= 0`),
    check("signal_topic_discovery_review_event_kind", sql`${table.eventKind} IN ('review_opened','review_finalized','review_superseded')`),
    check("signal_topic_discovery_review_event_state", sql`
      (${table.previousState} IS NULL OR ${table.previousState} IN ('open','finalized','superseded'))
      AND ${table.nextState} IN ('open','finalized','superseded')`),
    check("signal_topic_discovery_review_event_outcome", sql`
      ${table.outcome} IS NULL OR ${table.outcome} IN ('candidate_preferred','none_acceptable','rerun_requested')`),
    check("signal_topic_discovery_review_event_digests", sql`${table.reviewDigest} ~ '^sha256:[0-9a-f]{64}$'`)
  ]
);

export const signalSemanticContextGenerations = pgTable(
  "signal_semantic_context_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    artifactId: uuid("artifact_id").notNull().references(() => analysisArtifacts.id, { onDelete: "restrict" }),
    generationKey: text("generation_key").notNull(),
    generationVersion: integer("generation_version").notNull(),
    status: text("status").notNull().default("draft"),
    supersedesGenerationId: uuid("supersedes_generation_id")
      .references((): AnyPgColumn => signalSemanticContextGenerations.id, { onDelete: "restrict" }),
    supersessionReason: text("supersession_reason"),
    brandOsProfileId: uuid("brand_os_profile_id").notNull().references(() => brandOsProfiles.id, { onDelete: "restrict" }),
    brandOsProfileVersion: integer("brand_os_profile_version").notNull(),
    brandOsDigest: text("brand_os_digest").notNull(),
    knowledgeGenerationKey: text("knowledge_generation_key").notNull(),
    knowledgeDigest: text("knowledge_digest").notNull(),
    localeContextDigest: text("locale_context_digest").notNull(),
    primaryLocale: text("primary_locale").notNull(),
    localeVariants: text("locale_variants").array().notNull(),
    markets: text("markets").array().notNull(),
    timezone: text("timezone").notNull(),
    proposalModel: text("proposal_model"),
    proposalModelVersion: text("proposal_model_version"),
    proposalPromptDigest: text("proposal_prompt_digest"),
    proposalPricingVersion: text("proposal_pricing_version"),
    draftDigest: text("draft_digest").notNull(),
    packDigest: text("pack_digest"),
    createdOperationId: uuid("created_operation_id").notNull()
      .references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    publishedOperationId: uuid("published_operation_id")
      .references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: now(),
    publishedAt: timestamp("published_at", { withTimezone: true })
  },
  (table) => [
    unique("uq_signal_semantic_context_generation_artifact").on(table.artifactId, table.workspaceId),
    unique("uq_signal_semantic_context_generation_id_workspace").on(table.id, table.workspaceId),
    unique("uq_signal_semantic_context_generation_version").on(table.workspaceId, table.generationVersion),
    unique("uq_signal_semantic_context_generation_key").on(table.workspaceId, table.generationKey),
    uniqueIndex("uq_signal_semantic_context_generation_successor").on(table.supersedesGenerationId)
      .where(sql`${table.supersedesGenerationId} IS NOT NULL`),
    index("idx_signal_semantic_context_generation_history").on(table.workspaceId, table.generationVersion),
    index("idx_signal_semantic_context_draft_history").on(table.workspaceId, table.generationVersion)
      .where(sql`${table.status}='draft'`),
    check("signal_semantic_context_generation_version_positive", sql`${table.generationVersion}>0`),
    check("signal_semantic_context_generation_status", sql`${table.status} IN ('draft','published')`),
    check("signal_semantic_context_generation_supersession_reason", sql`
      ${table.supersessionReason} IS NULL OR ${table.supersessionReason} IN (
        'brand_os_drift','knowledge_drift','locale_market_drift','provider_lineage_missing',
        'provider_lineage_changed','operator_requested_reconciliation')`),
    check("signal_semantic_context_generation_digests", sql`
      ${table.brandOsDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.knowledgeDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.localeContextDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.draftDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND (${table.packDigest} IS NULL OR ${table.packDigest} ~ '^sha256:[0-9a-f]{64}$')`),
    check("signal_semantic_context_generation_publication", sql`
      (${table.status}='draft' AND ${table.packDigest} IS NULL AND ${table.publishedAt} IS NULL)
      OR (${table.status}='published' AND ${table.packDigest} IS NOT NULL AND ${table.publishedAt} IS NOT NULL)`)
  ]
);

export const signalSemanticContextElementVersions = pgTable(
  "signal_semantic_context_element_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    generationId: uuid("generation_id").notNull().references(() => signalSemanticContextGenerations.id, { onDelete: "restrict" }),
    artifactId: uuid("artifact_id").notNull().references(() => analysisArtifacts.id, { onDelete: "restrict" }),
    evidenceGroupId: uuid("evidence_group_id").notNull().references(() => analysisEvidenceGroups.id, { onDelete: "restrict" }),
    elementKey: text("element_key").notNull(),
    elementVersion: integer("element_version").notNull(),
    elementKind: text("element_kind").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    displayText: text("display_text").notNull(),
    scope: text("scope"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    locale: text("locale"),
    relationKind: text("relation_kind"),
    relationTargetKey: text("relation_target_key"),
    confidence: numeric("confidence", { precision: 7, scale: 6 }),
    disposition: text("disposition").notNull(),
    originKind: text("origin_kind").notNull(),
    supersedesElementId: uuid("supersedes_element_id")
      .references((): AnyPgColumn => signalSemanticContextElementVersions.id, { onDelete: "restrict" }),
    originalProposalElementId: uuid("original_proposal_element_id")
      .references((): AnyPgColumn => signalSemanticContextElementVersions.id, { onDelete: "restrict" }),
    sourceRefsDigest: text("source_refs_digest").notNull(),
    elementDigest: text("element_digest").notNull(),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    proposedByUserId: uuid("proposed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    decisionContractVersion: text("decision_contract_version"),
    decisionReasonCode: text("decision_reason_code"),
    decisionRationale: text("decision_rationale"),
    decisionBasisDigest: text("decision_basis_digest"),
    localeDecisionContractVersion: text("locale_decision_contract_version"),
    localeDecisionDisposition: text("locale_decision_disposition"),
    localeDecisionLocale: text("locale_decision_locale"),
    localeDecisionReasonCode: text("locale_decision_reason_code"),
    localeDecisionRationale: text("locale_decision_rationale"),
    localeDecisionBasisDigest: text("locale_decision_basis_digest"),
    localeDecisionInputDigest: text("locale_decision_input_digest"),
    localeDecisionAuthoritySnapshot: jsonb("locale_decision_authority_snapshot"),
    localeDecisionAuthorityDigest: text("locale_decision_authority_digest"),
    localeDecisionPrestateDigest: text("locale_decision_prestate_digest"),
    localeDecisionPoststateDigest: text("locale_decision_poststate_digest"),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    ordinaryCommandContractVersion: text("ordinary_command_contract_version"),
    ordinaryCommandAction: text("ordinary_command_action"),
    ordinaryCommandBasis: jsonb("ordinary_command_basis"),
    ordinaryCommandBasisDigest: text("ordinary_command_basis_digest"),
    ordinaryCommandInputDigest: text("ordinary_command_input_digest"),
    ordinaryCommandPrestateDigest: text("ordinary_command_prestate_digest"),
    ordinaryCommandPoststateDigest: text("ordinary_command_poststate_digest"),
    creationContractVersion: text("creation_contract_version"),
    creationBasis: jsonb("creation_basis"),
    creationBasisDigest: text("creation_basis_digest"),
    creationInputDigest: text("creation_input_digest"),
    creationPoststateDigest: text("creation_poststate_digest"),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_semantic_context_element_artifact").on(table.artifactId, table.workspaceId),
    unique("uq_signal_semantic_context_element_id_workspace").on(table.id, table.workspaceId),
    unique("uq_signal_semantic_context_element_evidence_group").on(table.evidenceGroupId),
    unique("uq_signal_semantic_context_element_version").on(table.generationId, table.elementKey, table.elementVersion),
    uniqueIndex("uq_signal_semantic_context_element_successor").on(table.supersedesElementId)
      .where(sql`${table.supersedesElementId} IS NOT NULL`),
    index("idx_signal_semantic_context_element_current").on(table.generationId, table.elementKey, table.elementVersion),
    index("idx_signal_semantic_context_element_disposition").on(table.generationId, table.disposition, table.elementKind),
    check("signal_semantic_context_element_version_positive", sql`${table.elementVersion}>0`),
    check("signal_semantic_context_element_disposition", sql`${table.disposition} IN ('pending','approved','rejected','merged','archived')`),
    check("signal_semantic_context_element_origin", sql`${table.originKind} IN ('server_projection','provider_proposal','operator_decision','operator_correction','operator_merge','operator_ordinary','operator_created')`),
    check("signal_semantic_context_element_confidence", sql`${table.confidence} IS NULL OR (${table.confidence}>=0 AND ${table.confidence}<=1)`),
    check("signal_semantic_context_element_digests", sql`
      ${table.sourceRefsDigest} ~ '^sha256:[0-9a-f]{64}$'
      AND ${table.elementDigest} ~ '^sha256:[0-9a-f]{64}$'`),
    check("signal_semantic_context_creation_all_or_none", sql`
      (${table.creationContractVersion} IS NULL AND ${table.creationBasis} IS NULL
        AND ${table.creationBasisDigest} IS NULL AND ${table.creationInputDigest} IS NULL
        AND ${table.creationPoststateDigest} IS NULL)
      OR (${table.creationContractVersion}='create-semantic-context-element-v1'
        AND jsonb_typeof(${table.creationBasis})='object'
        AND ${table.creationBasisDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND ${table.creationInputDigest} ~ '^sha256:[0-9a-f]{64}$'
        AND ${table.creationPoststateDigest} ~ '^sha256:[0-9a-f]{64}$')`)
  ]
);

export const signalSemanticContextEvents = pgTable(
  "signal_semantic_context_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    generationId: uuid("generation_id").notNull().references(() => signalSemanticContextGenerations.id, { onDelete: "restrict" }),
    elementId: uuid("element_id").references(() => signalSemanticContextElementVersions.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    eventIndex: integer("event_index").notNull(),
    eventKind: text("event_kind").notNull(),
    previousStateDigest: text("previous_state_digest"),
    nextStateDigest: text("next_state_digest").notNull(),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_semantic_context_operation_event").on(table.operationId, table.eventIndex),
    index("idx_signal_semantic_context_events_history").on(table.generationId, table.createdAt, table.id),
    check("signal_semantic_context_event_index", sql`${table.eventIndex}>=0`),
    check("signal_semantic_context_event_digests", sql`
      (${table.previousStateDigest} IS NULL OR ${table.previousStateDigest} ~ '^sha256:[0-9a-f]{64}$')
      AND ${table.nextStateDigest} ~ '^sha256:[0-9a-f]{64}$'`)
  ]
);

export const signalSemanticContextProposalRuns = pgTable(
  "signal_semantic_context_proposal_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    generationId: uuid("generation_id").notNull().references(() => signalSemanticContextGenerations.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    runKey: text("run_key").notNull(), status: text("status").notNull().default("queued"),
    preflightDigest: text("preflight_digest").notNull(), brandOsDigest: text("brand_os_digest").notNull(),
    knowledgeDigest: text("knowledge_digest").notNull(), localeContextDigest: text("locale_context_digest").notNull(),
    promptDigest: text("prompt_digest").notNull(), contextInputDigest: text("context_input_digest").notNull(),
    provider: text("provider").notNull(), model: text("model").notNull(),
    modelVersion: text("model_version").notNull(), pricingVersion: text("pricing_version").notNull(),
    maxInputTokens: integer("max_input_tokens").notNull(), maxOutputTokens: integer("max_output_tokens").notNull(),
    inputUsdPerMillionTokens: numeric("input_usd_per_million_tokens", { precision: 14, scale: 6 }).notNull(),
    outputUsdPerMillionTokens: numeric("output_usd_per_million_tokens", { precision: 14, scale: 6 }).notNull(),
    hardCapMicroUsd: bigint("hard_cap_micro_usd", { mode: "bigint" }).notNull(),
    reservationMicroUsd: bigint("reservation_micro_usd", { mode: "bigint" }).notNull(),
    providerRequestIdentity: text("provider_request_identity").notNull(),
    providerRequestId: text("provider_request_id"), providerCallState: text("provider_call_state").notNull().default("not_started"),
    providerCallCount: integer("provider_call_count").notNull().default(0),
    providerResponsePrivate: text("provider_response_private"), providerResponseDigest: text("provider_response_digest"),
    inputTokens: bigint("input_tokens", { mode: "bigint" }), outputTokens: bigint("output_tokens", { mode: "bigint" }),
    settledMicroUsd: bigint("settled_micro_usd", { mode: "bigint" }), validatedOutputDigest: text("validated_output_digest"),
    appendedOperationId: uuid("appended_operation_id").references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    proposalCount: integer("proposal_count"), resultDigest: text("result_digest"),
    attemptCount: integer("attempt_count").notNull().default(0), leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), errorCode: text("error_code"),
    errorSummary: text("error_summary"), createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }), validatingAt: timestamp("validating_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }), failedAt: timestamp("failed_at", { withTimezone: true }),
    staleAt: timestamp("stale_at", { withTimezone: true }), deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    createdAt: now(), updatedAt: updatedAt()
  },
  (table) => [unique("uq_signal_semantic_context_proposal_run_generation").on(table.generationId),
    unique("uq_signal_semantic_context_proposal_run_key").on(table.workspaceId, table.runKey),
    index("idx_signal_semantic_context_proposal_run_status").on(table.status, table.updatedAt, table.id),
    index("idx_signal_semantic_context_proposal_run_recovery").on(table.leaseExpiresAt, table.status)
      .where(sql`${table.status} IN ('processing','validating')`)]
);

export const signalSemanticContextBudgetReservations = pgTable(
  "signal_semantic_context_budget_reservations",
  { id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    runId: uuid("run_id").notNull().references(() => signalSemanticContextProposalRuns.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("reserved"),
    reservationMicroUsd: bigint("reservation_micro_usd", { mode: "bigint" }).notNull(),
    reservedInputTokens: bigint("reserved_input_tokens", { mode: "bigint" }).notNull(),
    reservedOutputTokens: bigint("reserved_output_tokens", { mode: "bigint" }).notNull(),
    inputTokens: bigint("input_tokens", { mode: "bigint" }), outputTokens: bigint("output_tokens", { mode: "bigint" }),
    actualMicroUsd: bigint("actual_micro_usd", { mode: "bigint" }), reservationDigest: text("reservation_digest").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }), releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason") },
  (table) => [unique("uq_signal_semantic_context_budget_run").on(table.runId)]
);

export const signalSemanticContextProposalOutbox = pgTable(
  "signal_semantic_context_proposal_outbox",
  { id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    runId: uuid("run_id").notNull().references(() => signalSemanticContextProposalRuns.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"), workerJobId: text("worker_job_id").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorSummary: text("error_summary"), dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }), createdAt: now(), updatedAt: updatedAt() },
  (table) => [unique("uq_signal_semantic_context_proposal_outbox_run").on(table.runId),
    index("idx_signal_semantic_context_proposal_outbox_claim").on(table.status, table.availableAt, table.createdAt)]
);

export const signalSemanticContextProposalRunEvents = pgTable(
  "signal_semantic_context_proposal_run_events",
  { id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    runId: uuid("run_id").notNull().references(() => signalSemanticContextProposalRuns.id, { onDelete: "restrict" }),
    transitionKey: text("transition_key").notNull(), eventKind: text("event_kind").notNull(),
    stateDigest: text("state_digest").notNull(), detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    createdAt: now() },
  (table) => [unique("uq_signal_semantic_context_proposal_event").on(table.runId, table.transitionKey),
    index("idx_signal_semantic_context_proposal_events").on(table.runId, table.createdAt, table.id)]
);

export const signalCompetitorLifecycleEvents = pgTable(
  "signal_competitor_lifecycle_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    competitorId: uuid("competitor_id").notNull().references(() => competitors.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    eventIndex: integer("event_index").notNull(),
    eventKind: text("event_kind").notNull(),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    previousStatus: text("previous_status"),
    nextStatus: text("next_status").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    eventDigest: text("event_digest").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_competitor_lifecycle_operation_event").on(table.operationId, table.eventIndex),
    index("idx_signal_competitor_lifecycle_history").on(table.workspaceId, table.competitorId, table.createdAt, table.id)
  ]
);

export const signalAcquisitionPlans = pgTable(
  "signal_acquisition_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    planVersion: integer("plan_version").notNull(),
    status: text("status").notNull(),
    brandOsProfileId: uuid("brand_os_profile_id").notNull().references(() => brandOsProfiles.id, { onDelete: "restrict" }),
    brandOsProfileVersion: integer("brand_os_profile_version").notNull(),
    brandOsDigest: text("brand_os_digest").notNull(),
    identityCatalogDigest: text("identity_catalog_digest").notNull(),
    acquisitionBriefContractVersion: text("acquisition_brief_contract_version"),
    acquisitionBrief: jsonb("acquisition_brief"),
    acquisitionBriefDigest: text("acquisition_brief_digest"),
    draftRevision: integer("draft_revision").notNull().default(0),
    draftDigest: text("draft_digest").notNull(),
    definitionHash: text("definition_hash"),
    supersedesPlanId: uuid("supersedes_plan_id").references((): AnyPgColumn => signalAcquisitionPlans.id, { onDelete: "restrict" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    promotedByUserId: uuid("promoted_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    retiredByUserId: uuid("retired_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: now(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    creationIdempotencyKey: text("creation_idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull()
  },
  (table) => [
    unique("uq_signal_acquisition_plan_version").on(table.workspaceId, table.planVersion),
    unique("uq_signal_acquisition_plan_creation").on(table.workspaceId, table.creationIdempotencyKey),
    uniqueIndex("uq_signal_acquisition_plan_current").on(table.workspaceId).where(sql`${table.status} = 'current'`),
    uniqueIndex("uq_signal_acquisition_plan_open_draft").on(table.workspaceId).where(sql`${table.status} = 'draft'`),
    index("idx_signal_acquisition_plans_workspace").on(table.workspaceId, table.status, table.planVersion)
  ]
);

export const signalAcquisitionReferenceDecisions = pgTable(
  "signal_acquisition_reference_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    intelligenceEntityId: uuid("intelligence_entity_id").notNull().references(() => intelligenceEntities.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    evidenceReference: text("evidence_reference").notNull(),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    decisionHash: text("decision_hash").notNull(),
    supersedesDecisionId: uuid("supersedes_decision_id")
      .references((): AnyPgColumn => signalAcquisitionReferenceDecisions.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    index("idx_signal_acquisition_reference_history").on(table.workspaceId, table.intelligenceEntityId, table.createdAt)
  ]
);

export const signalAcquisitionSlots = pgTable(
  "signal_acquisition_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    planId: uuid("plan_id").notNull().references(() => signalAcquisitionPlans.id, { onDelete: "restrict" }),
    slotKey: text("slot_key").notNull(),
    slotVersion: integer("slot_version").notNull(),
    scope: text("scope").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityRevisionDigest: text("entity_revision_digest").notNull(),
    label: text("label").notNull(),
    desiredState: text("desired_state").notNull(),
    position: integer("position").notNull(),
    supersedesSlotId: uuid("supersedes_slot_id").references((): AnyPgColumn => signalAcquisitionSlots.id, { onDelete: "restrict" }),
    referenceDecisionId: uuid("reference_decision_id").references(() => signalAcquisitionReferenceDecisions.id, { onDelete: "restrict" }),
    definitionHash: text("definition_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_acquisition_slot_plan_version").on(table.planId, table.slotKey, table.slotVersion),
    unique("uq_signal_acquisition_slot_workspace_version").on(table.workspaceId, table.slotKey, table.slotVersion),
    index("idx_signal_acquisition_slots_identity").on(table.workspaceId, table.scope, table.entityId, table.planId)
  ]
);

export const signalAcquisitionQueryVersions = pgTable(
  "signal_acquisition_query_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    planId: uuid("plan_id").notNull().references(() => signalAcquisitionPlans.id, { onDelete: "restrict" }),
    slotId: uuid("slot_id").notNull().references(() => signalAcquisitionSlots.id, { onDelete: "restrict" }),
    queryKey: text("query_key").notNull(),
    queryVersion: integer("query_version").notNull(),
    dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "restrict" }),
    providerKey: text("provider_key").notNull(),
    providerSyntaxVersion: text("provider_syntax_version").notNull(),
    providerSchemaVersion: text("provider_schema_version").notNull(),
    queryTextPrivate: text("query_text_private").notNull(),
    structuredTerms: jsonb("structured_terms").notNull(),
    queryHash: text("query_hash").notNull(),
    definitionHash: text("definition_hash").notNull(),
    cadence: text("cadence").notNull(),
    defaultPeriodStart: date("default_period_start"),
    defaultPeriodEnd: date("default_period_end"),
    timezone: text("timezone").notNull(),
    status: text("status").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    supersedesQueryVersionId: uuid("supersedes_query_version_id")
      .references((): AnyPgColumn => signalAcquisitionQueryVersions.id, { onDelete: "restrict" }),
    carriedFromQueryVersionId: uuid("carried_from_query_version_id")
      .references((): AnyPgColumn => signalAcquisitionQueryVersions.id, { onDelete: "restrict" }),
    originKind: text("origin_kind").notNull(),
    originReferenceId: uuid("origin_reference_id"),
    generationContractVersion: text("generation_contract_version"),
    generationModel: text("generation_model"),
    generationPipelineVersion: text("generation_pipeline_version"),
    generationPromptTemplateDigest: text("generation_prompt_template_digest"),
    generationContextDigest: text("generation_context_digest"),
    generationConstructionPlanDigest: text("generation_construction_plan_digest"),
    generationValidationReportDigest: text("generation_validation_report_digest"),
    generationFallbackUsed: boolean("generation_fallback_used"),
    generationFallbackReason: text("generation_fallback_reason"),
    generationStudyReferenceHash: text("generation_study_reference_hash"),
    generationStudyContextDigest: text("generation_study_context_digest"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: now(),
    creationIdempotencyKey: text("creation_idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull()
  },
  (table) => [
    unique("uq_signal_acquisition_query_creation").on(table.workspaceId, table.creationIdempotencyKey),
    unique("uq_signal_acquisition_query_version").on(table.workspaceId, table.planId, table.queryKey, table.queryVersion),
    index("idx_signal_acquisition_queries_slot").on(table.workspaceId, table.planId, table.slotId, table.providerKey, table.dataSourceId, table.queryVersion)
  ]
);

export const signalAcquisitionQueryReviewEvents = pgTable(
  "signal_acquisition_query_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventSequence: bigint("event_sequence", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    queryVersionId: uuid("query_version_id").notNull().references(() => signalAcquisitionQueryVersions.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    evidence: text("evidence").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    decidedByUserId: uuid("decided_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    eventHash: text("event_hash").notNull()
  },
  (table) => [
    unique("uq_signal_acquisition_query_review_sequence").on(table.eventSequence),
    unique("uq_signal_acquisition_query_review_operation").on(table.workspaceId, table.operationId),
    unique("uq_signal_acquisition_query_review_hash").on(table.workspaceId, table.eventHash),
    index("idx_signal_acquisition_query_reviews_latest").on(
      table.workspaceId,table.queryVersionId,table.eventSequence
    )
  ]
);

export const signalAcquisitionPlanEvents = pgTable(
  "signal_acquisition_plan_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalGovernanceControlOperations.id, { onDelete: "restrict" }),
    eventIndex: integer("event_index").notNull(),
    eventKind: text("event_kind").notNull(),
    planId: uuid("plan_id").references(() => signalAcquisitionPlans.id, { onDelete: "restrict" }),
    slotId: uuid("slot_id").references(() => signalAcquisitionSlots.id, { onDelete: "restrict" }),
    queryVersionId: uuid("query_version_id").references(() => signalAcquisitionQueryVersions.id, { onDelete: "restrict" }),
    referenceDecisionId: uuid("reference_decision_id").references(() => signalAcquisitionReferenceDecisions.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "restrict" }),
    previousStateDigest: text("previous_state_digest"),
    nextStateDigest: text("next_state_digest").notNull(),
    eventDigest: text("event_digest").notNull(),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_acquisition_plan_event_operation_index").on(table.operationId, table.eventIndex),
    index("idx_signal_acquisition_plan_events_workspace").on(table.workspaceId, table.createdAt, table.id)
  ]
);

export const signalProviderMentionObservations = pgTable(
  "signal_provider_mention_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "restrict" }),
    importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
    mentionId: uuid("mention_id").notNull().references(() => mentions.id, { onDelete: "restrict" }),
    providerKey: text("provider_key").notNull(),
    providerRecordKeyHash: text("provider_record_key_hash").notNull(),
    acquisitionPlanId: uuid("acquisition_plan_id").references(() => signalAcquisitionPlans.id, { onDelete: "restrict" }),
    acquisitionSlotId: uuid("acquisition_slot_id").references(() => signalAcquisitionSlots.id, { onDelete: "restrict" }),
    acquisitionQueryVersionId: uuid("acquisition_query_version_id").references(() => signalAcquisitionQueryVersions.id, { onDelete: "restrict" }),
    acquisitionPlanDigest: text("acquisition_plan_digest"),
    acquisitionSlotDigest: text("acquisition_slot_digest"),
    acquisitionQueryDigest: text("acquisition_query_digest"),
    providerSchemaVersion: text("provider_schema_version").notNull(),
    providerHeaderHash: text("provider_header_hash").notNull(),
    observationVersion: integer("observation_version").notNull(),
    observationHash: text("observation_hash").notNull(),
    supersedesObservationId: uuid("supersedes_observation_id")
      .references((): AnyPgColumn => signalProviderMentionObservations.id, { onDelete: "restrict" }),
    providerProjectRefHash: text("provider_project_ref_hash"),
    platform: text("platform"),
    publicDomain: text("public_domain"),
    providerDomainCategory: text("provider_domain_category"),
    providerSourceType: text("provider_source_type"),
    providerContentType: text("provider_content_type"),
    providerThreadKeyHash: text("provider_thread_key_hash"),
    threadRole: text("thread_role").notNull().default("unknown"),
    languageCode: text("language_code"),
    countryCode: text("country_code"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    providerCollectedAt: timestamp("provider_collected_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    providerSentimentLabel: text("provider_sentiment_label"),
    providerSentimentScore: numeric("provider_sentiment_score"),
    ratingValue: numeric("rating_value"),
    influenceScore: numeric("influence_score"),
    engagementTotal: bigint("engagement_total", { mode: "number" }),
    commentsCount: bigint("comments_count", { mode: "number" }),
    viewsCount: bigint("views_count", { mode: "number" }),
    sharesCount: bigint("shares_count", { mode: "number" }),
    reactionWowCount: bigint("reaction_wow_count", { mode: "number" }),
    reactionLoveCount: bigint("reaction_love_count", { mode: "number" }),
    reactionLikeCount: bigint("reaction_like_count", { mode: "number" }),
    reactionHahaCount: bigint("reaction_haha_count", { mode: "number" }),
    reactionSadCount: bigint("reaction_sad_count", { mode: "number" }),
    reactionAngryCount: bigint("reaction_angry_count", { mode: "number" }),
    reactionThankfulCount: bigint("reaction_thankful_count", { mode: "number" }),
    uniqueViewsCount: bigint("unique_views_count", { mode: "number" }),
    fansCount: bigint("fans_count", { mode: "number" }),
    repostCount: bigint("repost_count", { mode: "number" }),
    favoritesCount: bigint("favorites_count", { mode: "number" }),
    heartsCount: bigint("hearts_count", { mode: "number" }),
    likesCount: bigint("likes_count", { mode: "number" }),
    dislikesCount: bigint("dislikes_count", { mode: "number" }),
    followersCount: bigint("followers_count", { mode: "number" }),
    authorRefHash: text("author_ref_hash"),
    provenanceBindingId: uuid("provenance_binding_id").references(() => signalProvenancePolicyBindings.id, { onDelete: "restrict" }),
    rightsDefinitionHash: text("rights_definition_hash"),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_provider_observation_version").on(table.importBatchId, table.providerRecordKeyHash, table.observationVersion),
    index("idx_signal_provider_observation_root").on(table.workspaceId, table.mentionId, table.importBatchId),
    index("idx_signal_provider_observation_import").on(table.importBatchId, table.mentionId),
    index("idx_signal_provider_observation_platform_time").on(table.workspaceId, table.platform, table.publishedAt, table.id),
    index("idx_signal_provider_observation_thread").on(table.workspaceId, table.providerThreadKeyHash, table.publishedAt, table.id)
  ]
);

export const signalProviderMentionObservationTerms = pgTable(
  "signal_provider_mention_observation_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    observationId: uuid("observation_id").notNull().references(() => signalProviderMentionObservations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    termKind: text("term_kind").notNull(),
    ordinal: integer("ordinal").notNull(),
    termPrivate: text("term_private").notNull(),
    termHash: text("term_hash").notNull(),
    normalizedTerm: text("normalized_term").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_provider_observation_term").on(table.observationId, table.termKind, table.termHash),
    index("idx_signal_provider_observation_terms_lookup").on(table.workspaceId, table.termKind, table.termHash, table.observationId)
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
    signalTaxonomyProfileId: uuid("signal_taxonomy_profile_id").references(
      () => signalTaxonomyProfiles.id,
      { onDelete: "restrict" }
    ),
    tbAnalysisId: uuid("tb_analysis_id").references(() => tbAnalyses.id, { onDelete: "cascade" }),
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    approvalSource: text("approval_source"),
    approvalPolicyVersion: text("approval_policy_version"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    classificationAssignmentId: uuid("classification_assignment_id").references(
      (): AnyPgColumn => signalClassificationAssignments.id,
      { onDelete: "restrict" }
    ),
    classificationGenerationId: uuid("classification_generation_id").references(
      (): AnyPgColumn => signalClassificationGenerations.id,
      { onDelete: "restrict" }
    ),
    classificationProjectionContract: text("classification_projection_contract"),
    createdAt: now()
  },
  (table) => [
    index("idx_record_tags_scope").on(table.studyCorpusId, table.subjectType, table.taxonomyTermId),
    index("idx_record_tags_subject").on(table.subjectType, table.subjectId),
    index("idx_record_tags_review").on(table.studyCorpusId, table.reviewStatus),
    index("idx_record_tags_signal_approved_subject")
      .on(table.subjectType, table.subjectId, table.taxonomyTermId)
      .where(sql`${table.reviewStatus} = 'approved'`),
    index("idx_record_tags_signal_profile_review")
      .on(table.signalTaxonomyProfileId, table.reviewStatus, table.taxonomyTermId, table.subjectId)
      .where(sql`${table.subjectType} = 'mention' AND ${table.signalTaxonomyProfileId} IS NOT NULL`),
    index("idx_record_tags_tb_analysis").on(table.tbAnalysisId, table.subjectType, table.taxonomyTermId),
    check("record_tags_approval_source", sql`${table.approvalSource} IS NULL OR ${table.approvalSource} IN ('human', 'policy')`),
    check("record_tags_approved_provenance", sql`${table.reviewStatus} <> 'approved' OR (
      ${table.approvalSource} IS NOT NULL
      AND ${table.approvedAt} IS NOT NULL
      AND (${table.approvalSource} <> 'policy' OR NULLIF(btrim(${table.approvalPolicyVersion}), '') IS NOT NULL)
    )`),
    check("record_tags_classification_projection_shape", sql`(
      ${table.classificationProjectionContract} IS NULL
      AND ${table.classificationAssignmentId} IS NULL
      AND ${table.classificationGenerationId} IS NULL
    ) OR (
      ${table.classificationProjectionContract} = 'signal-record-tags-projector-v1'
      AND ${table.classificationAssignmentId} IS NOT NULL
      AND ${table.classificationGenerationId} IS NOT NULL
      AND ${table.source} = 'signal-classification-projector-v1'
      AND ${table.reviewStatus} = 'approved'
    )`),
    unique("uq_record_tags_subject_term_source").on(table.subjectType, table.subjectId, table.taxonomyTermId, table.source),
    uniqueIndex("uq_record_tags_signal_profile_assignment")
      .on(table.subjectId, table.signalTaxonomyProfileId, table.taxonomyTermId, table.modelVersionId)
      .where(sql`${table.subjectType} = 'mention' AND ${table.signalTaxonomyProfileId} IS NOT NULL`),
    uniqueIndex("uq_record_tags_classification_assignment")
      .on(table.classificationAssignmentId)
      .where(sql`${table.classificationAssignmentId} IS NOT NULL`)
  ]
);

export const signalClassificationOperations = pgTable(
  "signal_classification_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    operationKind: text("operation_kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    status: text("status").notNull().default("in_progress"),
    result: jsonb("result"),
    createdAt: now(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    unique("uq_signal_classification_operation").on(table.workspaceId, table.idempotencyKey),
    index("idx_signal_classification_operations_workspace").on(table.workspaceId, table.createdAt)
  ]
);

export const signalClassificationEvents = pgTable(
  "signal_classification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    eventIndex: integer("event_index").notNull(),
    eventKind: text("event_kind").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    previousStateDigest: text("previous_state_digest"),
    nextStateDigest: text("next_state_digest").notNull(),
    eventDigest: text("event_digest").notNull(),
    createdAt: now()
  },
  (table) => [unique("uq_signal_classification_event_operation").on(table.operationId, table.eventIndex)]
);

export const signalLabelingFunctionVersions = pgTable(
  "signal_labeling_function_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    ownerKind: text("owner_kind").notNull(),
    functionKey: text("function_key").notNull(),
    version: integer("version").notNull(),
    contractVersion: text("contract_version").notNull().default("signal-labeling-function-v1"),
    taxonomyProfileId: uuid("taxonomy_profile_id").references(() => signalTaxonomyProfiles.id, { onDelete: "restrict" }),
    taxonomyTermId: uuid("taxonomy_term_id").notNull().references(() => taxonomyTerms.id, { onDelete: "restrict" }),
    inputContract: jsonb("input_contract").notNull(),
    outputContract: jsonb("output_contract").notNull(),
    definitionHash: text("definition_hash").notNull(),
    status: text("status").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => signalLabelingFunctionVersions.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_labeling_function_version").on(table.ownerKind, table.workspaceId, table.functionKey, table.version),
    uniqueIndex("uq_signal_labeling_function_platform_version")
      .on(table.functionKey, table.version).where(sql`${table.ownerKind} = 'platform'`),
    uniqueIndex("uq_signal_labeling_function_supersedes")
      .on(table.supersedesId).where(sql`${table.supersedesId} IS NOT NULL`)
  ]
);

export const signalClassificationApprovalPolicies = pgTable(
  "signal_classification_approval_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    taxonomyProfileId: uuid("taxonomy_profile_id").notNull().references(() => signalTaxonomyProfiles.id, { onDelete: "restrict" }),
    policyKey: text("policy_key").notNull(),
    version: integer("version").notNull(),
    authorityKind: text("authority_kind").notNull(),
    labelingFunctionVersionId: uuid("labeling_function_version_id").references(() => signalLabelingFunctionVersions.id, { onDelete: "restrict" }),
    modelVersionId: uuid("model_version_id").references(() => taggingModelVersions.id, { onDelete: "restrict" }),
    exactContractHash: text("exact_contract_hash"),
    definitionHash: text("definition_hash").notNull(),
    status: text("status").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => signalClassificationApprovalPolicies.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_classification_policy_version").on(table.workspaceId, table.policyKey, table.version),
    uniqueIndex("uq_signal_classification_policy_supersedes")
      .on(table.supersedesId).where(sql`${table.supersedesId} IS NOT NULL`)
  ]
);

export const signalClassificationGenerations = pgTable(
  "signal_classification_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    taxonomyProfileId: uuid("taxonomy_profile_id").notNull().references(() => signalTaxonomyProfiles.id, { onDelete: "restrict" }),
    generationKey: text("generation_key").notNull(),
    generationVersion: integer("generation_version").notNull(),
    status: text("status").notNull().default("open"),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "restrict" }),
    inputPopulationDigest: text("input_population_digest").notNull(),
    inputWatermarkDigest: text("input_watermark_digest").notNull(),
    identityCatalogDigest: text("identity_catalog_digest").notNull(),
    denominator: integer("denominator").notNull(),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    supersedesGenerationId: uuid("supersedes_generation_id").references((): AnyPgColumn => signalClassificationGenerations.id, { onDelete: "restrict" }),
    definitionDigest: text("definition_digest").notNull(),
    finalizedDigest: text("finalized_digest"),
    createdAt: now(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
  },
  (table) => [
    unique("uq_signal_classification_generation_version").on(table.workspaceId, table.generationKey, table.generationVersion),
    uniqueIndex("uq_signal_classification_generation_supersedes")
      .on(table.supersedesGenerationId)
      .where(sql`${table.supersedesGenerationId} IS NOT NULL`),
    index("idx_signal_classification_generation_profile").on(table.workspaceId, table.taxonomyProfileId, table.status)
  ]
);

export const signalClassificationGenerationItems = pgTable(
  "signal_classification_generation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    generationId: uuid("generation_id").notNull().references(() => signalClassificationGenerations.id, { onDelete: "restrict" }),
    canonicalRootId: uuid("canonical_root_id").notNull().references(() => mentions.id, { onDelete: "restrict" }),
    resolutionState: text("resolution_state").notNull(),
    technicalErrorCode: text("technical_error_code"),
    itemDigest: text("item_digest").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_classification_generation_item").on(table.generationId, table.canonicalRootId),
    index("idx_signal_classification_items_coverage").on(table.generationId, table.resolutionState, table.canonicalRootId)
  ]
);

export const signalClassificationAssignments = pgTable(
  "signal_classification_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    generationId: uuid("generation_id").notNull().references(() => signalClassificationGenerations.id, { onDelete: "restrict" }),
    generationItemId: uuid("generation_item_id").notNull().references(() => signalClassificationGenerationItems.id, { onDelete: "restrict" }),
    canonicalRootId: uuid("canonical_root_id").notNull().references(() => mentions.id, { onDelete: "restrict" }),
    taxonomyProfileId: uuid("taxonomy_profile_id").notNull().references(() => signalTaxonomyProfiles.id, { onDelete: "restrict" }),
    taxonomyTermId: uuid("taxonomy_term_id").references(() => taxonomyTerms.id, { onDelete: "restrict" }),
    resolutionMethod: text("resolution_method").notNull(),
    disposition: text("disposition").notNull(),
    labelingFunctionVersionId: uuid("labeling_function_version_id").references(() => signalLabelingFunctionVersions.id, { onDelete: "restrict" }),
    modelVersionId: uuid("model_version_id").references(() => taggingModelVersions.id, { onDelete: "restrict" }),
    approvalPolicyId: uuid("approval_policy_id").references(() => signalClassificationApprovalPolicies.id, { onDelete: "restrict" }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    score: numeric("score"),
    confidence: text("confidence"),
    evidenceDigest: text("evidence_digest").notNull(),
    lineageDigest: text("lineage_digest").notNull(),
    supersedesAssignmentId: uuid("supersedes_assignment_id").references((): AnyPgColumn => signalClassificationAssignments.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    createdAt: now()
  },
  (table) => [
    index("idx_signal_classification_assignments_current").on(table.generationId, table.disposition, table.taxonomyTermId, table.canonicalRootId),
    index("idx_signal_classification_assignments_supersession").on(table.supersedesAssignmentId),
    uniqueIndex("uq_signal_classification_assignment_supersedes")
      .on(table.supersedesAssignmentId)
      .where(sql`${table.supersedesAssignmentId} IS NOT NULL`)
  ]
);

export const signalClassificationGoldSetVersions = pgTable(
  "signal_classification_gold_set_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    taxonomyProfileId: uuid("taxonomy_profile_id").notNull().references(() => signalTaxonomyProfiles.id, { onDelete: "restrict" }),
    goldSetKey: text("gold_set_key").notNull(),
    version: integer("version").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    status: text("status").notNull().default("draft"),
    expectedItemCount: integer("expected_item_count").notNull(),
    finalizedDigest: text("finalized_digest"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => signalClassificationGoldSetVersions.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    unique("uq_signal_classification_gold_set_version").on(table.workspaceId, table.goldSetKey, table.version),
    uniqueIndex("uq_signal_classification_gold_set_supersedes")
      .on(table.supersedesId).where(sql`${table.supersedesId} IS NOT NULL`)
  ]
);

export const signalClassificationGoldItems = pgTable(
  "signal_classification_gold_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    goldSetVersionId: uuid("gold_set_version_id").notNull().references(() => signalClassificationGoldSetVersions.id, { onDelete: "restrict" }),
    canonicalRootId: uuid("canonical_root_id").notNull().references(() => mentions.id, { onDelete: "restrict" }),
    split: text("split").notNull(),
    expectedDisposition: text("expected_disposition").notNull(),
    expectedTaxonomyTermId: uuid("expected_taxonomy_term_id").references(() => taxonomyTerms.id, { onDelete: "restrict" }),
    sliceKeys: text("slice_keys").array().notNull().default(emptyTextArray),
    evidenceDigest: text("evidence_digest").notNull(),
    labeledByUserId: uuid("labeled_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    itemDigest: text("item_digest").notNull(),
    createdAt: now()
  },
  (table) => [unique("uq_signal_classification_gold_root_split").on(table.goldSetVersionId, table.canonicalRootId)]
);

export const signalClassificationEvaluations = pgTable(
  "signal_classification_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    taxonomyProfileId: uuid("taxonomy_profile_id").notNull().references(() => signalTaxonomyProfiles.id, { onDelete: "restrict" }),
    generationId: uuid("generation_id").notNull().references(() => signalClassificationGenerations.id, { onDelete: "restrict" }),
    goldSetVersionId: uuid("gold_set_version_id").references(() => signalClassificationGoldSetVersions.id, { onDelete: "restrict" }),
    evaluatedModelVersionId: uuid("evaluated_model_version_id").references(() => taggingModelVersions.id, { onDelete: "restrict" }),
    evaluatedLabelingFunctionVersionId: uuid("evaluated_labeling_function_version_id").references(() => signalLabelingFunctionVersions.id, { onDelete: "restrict" }),
    split: text("split"),
    denominator: integer("denominator").notNull(),
    resolved: integer("resolved").notNull(),
    approved: integer("approved").notNull(),
    pending: integer("pending").notNull(),
    rejected: integer("rejected").notNull(),
    abstained: integer("abstained").notNull(),
    error: integer("error").notNull(),
    coverage: numeric("coverage"),
    precisionScore: numeric("precision_score"),
    recallScore: numeric("recall_score"),
    f1Score: numeric("f1_score"),
    inputDigest: text("input_digest").notNull(),
    artifactDigest: text("artifact_digest").notNull(),
    policyDigest: text("policy_digest").notNull(),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: now()
  }
);

export const signalClassificationEvaluationSlices = pgTable(
  "signal_classification_evaluation_slices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationId: uuid("evaluation_id").notNull().references(() => signalClassificationEvaluations.id, { onDelete: "restrict" }),
    sliceKey: text("slice_key").notNull(),
    split: text("split").notNull(),
    denominator: integer("denominator").notNull(),
    resolved: integer("resolved").notNull(),
    precisionScore: numeric("precision_score"),
    recallScore: numeric("recall_score"),
    f1Score: numeric("f1_score"),
    sliceDigest: text("slice_digest").notNull(),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" })
  },
  (table) => [unique("uq_signal_classification_evaluation_slice").on(table.evaluationId, table.sliceKey, table.split)]
);

export const signalTaggingModelVersionEvents = pgTable(
  "signal_tagging_model_version_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    modelVersionId: uuid("model_version_id").notNull().references(() => taggingModelVersions.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    eventIndex: integer("event_index").notNull(),
    status: text("status").notNull(),
    evaluationId: uuid("evaluation_id").references(() => signalClassificationEvaluations.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    createdAt: now()
  },
  (table) => [unique("uq_signal_tagging_model_event_operation").on(table.operationId, table.eventIndex)]
);

export const signalClassificationProjectionRuns = pgTable(
  "signal_classification_projection_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "restrict" }),
    generationId: uuid("generation_id").notNull().references(() => signalClassificationGenerations.id, { onDelete: "restrict" }),
    operationId: uuid("operation_id").notNull().references(() => signalClassificationOperations.id, { onDelete: "restrict" }),
    projectedCount: integer("projected_count").notNull(),
    projectionDigest: text("projection_digest").notNull(),
    invalidationDigest: text("invalidation_digest").notNull(),
    createdAt: now()
  },
  (table) => [unique("uq_signal_classification_projection_digest").on(table.workspaceId, table.generationId, table.projectionDigest)]
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

export const tbReusableAssertionReviewEvents = pgTable(
  "tb_reusable_assertion_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tbAnalysisId: uuid("tb_analysis_id").notNull().references(() => tbAnalyses.id, { onDelete: "restrict" }),
    sourceRecordTagId: uuid("source_record_tag_id").notNull().references(() => recordTags.id, { onDelete: "restrict" }),
    resolvedRecordTagId: uuid("resolved_record_tag_id").notNull().references(() => recordTags.id, { onDelete: "restrict" }),
    sourceMentionId: uuid("source_mention_id").notNull().references(() => mentions.id, { onDelete: "restrict" }),
    canonicalMentionId: uuid("canonical_mention_id").notNull().references(() => mentions.id, { onDelete: "restrict" }),
    reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    previousState: jsonb("previous_state").notNull().default(sql`'{}'::jsonb`),
    nextState: jsonb("next_state").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: now()
  },
  (table) => [
    unique("uq_tb_reusable_assertion_review_idempotency").on(table.tbAnalysisId, table.idempotencyKey),
    check("tb_reusable_assertion_review_decision", sql`${table.decision} IN ('approve', 'correct', 'reject')`),
    check("tb_reusable_assertion_review_key", sql`${table.idempotencyKey} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_tb_reusable_assertion_reviews_canonical").on(table.canonicalMentionId, table.createdAt)
  ]
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
    workspaceId: uuid("workspace_id").references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    materializationKey: text("materialization_key"),
    metricDefinitionId: uuid("metric_definition_id")
      .notNull()
      .references(() => metricDefinitions.id, { onDelete: "cascade" }),
    metricKey: text("metric_key"),
    metricVersion: integer("metric_version"),
    metricGroupKey: text("metric_group_key"),
    semanticModelId: uuid("semantic_model_id").references(() => semanticModels.id, { onDelete: "set null" }),
    studyCorpusId: uuid("study_corpus_id").references(() => studyCorpora.id, { onDelete: "cascade" }),
    populationId: uuid("population_id").references(() => signalPopulationDefinitions.id, { onDelete: "cascade" }),
    populationVersion: integer("population_version"),
    populationDefinitionHash: text("population_definition_hash"),
    periodId: uuid("period_id").references(() => reportPeriods.id, { onDelete: "set null" }),
    granularity: text("granularity"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    normalizedFilter: jsonb("normalized_filter"),
    filtersHash: text("filters_hash").notNull().default("default"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    typedPayload: jsonb("typed_payload"),
    value: numeric("value"),
    denominator: numeric("denominator"),
    sampleSize: integer("sample_size"),
    qualityState: text("quality_state"),
    dataWatermarkId: uuid("data_watermark_id").references(() => signalDataWatermarks.id, { onDelete: "set null" }),
    dataWatermark: jsonb("data_watermark"),
    dataWatermarkHash: text("data_watermark_hash"),
    materializationState: text("materialization_state"),
    cacheScope: text("cache_scope"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    staleAfter: timestamp("stale_after", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
  },
  (table) => [
    index("idx_metric_materializations_lookup").on(table.studyCorpusId, table.metricDefinitionId, table.periodId),
    unique("uq_metric_materializations_ref").on(table.metricDefinitionId, table.studyCorpusId, table.periodId, table.filtersHash),
    uniqueIndex("uq_metric_materializations_signal_key")
      .on(table.materializationKey)
      .where(sql`${table.materializationKey} IS NOT NULL`),
    index("idx_metric_materializations_signal_series")
      .on(
        table.workspaceId,
        table.metricGroupKey,
        table.metricKey,
        table.metricVersion,
        table.filtersHash,
        table.granularity,
        table.periodStart
      )
      .where(sql`${table.workspaceId} IS NOT NULL`),
    index("idx_metric_materializations_signal_freshness")
      .on(table.workspaceId, table.materializationState, table.staleAfter, table.computedAt)
      .where(sql`${table.workspaceId} IS NOT NULL`),
    index("idx_metric_materializations_signal_corpus_period")
      .on(table.studyCorpusId, table.periodStart, table.periodEnd)
      .where(sql`${table.workspaceId} IS NOT NULL`),
    index("idx_metric_materializations_signal_ad_hoc_expiry")
      .on(table.expiresAt)
      .where(sql`${table.cacheScope} = 'ad_hoc'`),
    index("idx_metric_materializations_signal_facade")
      .on(
        table.workspaceId,
        table.studyCorpusId,
        table.filtersHash,
        table.metricKey,
        table.metricVersion,
        table.computedAt
      )
      .where(sql`${table.workspaceId} IS NOT NULL`),
    index("idx_metric_materializations_signal_population_facade")
      .on(
        table.workspaceId,
        table.populationId,
        table.populationVersion,
        table.filtersHash,
        table.metricKey,
        table.metricVersion,
        table.computedAt
      )
      .where(sql`${table.workspaceId} IS NOT NULL AND ${table.populationId} IS NOT NULL`),
    index("idx_metric_materializations_signal_population_period")
      .on(table.populationId, table.populationVersion, table.periodStart, table.periodEnd)
      .where(sql`${table.populationId} IS NOT NULL`),
    check("metric_materializations_operational_scope", sql`${table.workspaceId} IS NULL OR (
      (${table.studyCorpusId} IS NOT NULL AND ${table.populationId} IS NULL
        AND ${table.populationVersion} IS NULL AND ${table.populationDefinitionHash} IS NULL)
      OR
      (${table.studyCorpusId} IS NULL AND ${table.populationId} IS NOT NULL
        AND ${table.populationVersion} >= 1
        AND ${table.populationDefinitionHash} ~ '^sha256:[0-9a-f]{64}$')
    )`),
    check(
      "metric_materializations_signal_v1_shape",
      sql`${table.workspaceId} IS NULL OR (
        ${table.materializationKey} IS NOT NULL
        AND ${table.metricKey} IS NOT NULL
        AND ${table.metricVersion} >= 1
        AND ${table.metricGroupKey} IS NOT NULL
        AND ${table.granularity} IN ('day', 'week', 'month')
        AND ${table.periodStart} IS NOT NULL
        AND ${table.periodEnd} >= ${table.periodStart}
        AND ${table.normalizedFilter} IS NOT NULL
        AND ${table.filtersHash} ~ '^sha256:[0-9a-f]{64}$'
        AND ${table.typedPayload} IS NOT NULL
        AND ${table.sampleSize} >= 0
        AND ${table.qualityState} IN ('pass', 'partial', 'failed', 'unknown')
        AND ${table.dataWatermark} IS NOT NULL
        AND ${table.dataWatermarkHash} ~ '^sha256:[0-9a-f]{64}$'
        AND ${table.materializationState} IN ('fresh', 'stale', 'pending', 'partial', 'not_available')
        AND ${table.cacheScope} IN ('default', 'precomputed', 'ad_hoc')
      )`
    ),
    check(
      "metric_materializations_null_semantics",
      sql`${table.workspaceId} IS NULL OR ${table.materializationState} NOT IN ('pending', 'not_available') OR ${table.value} IS NULL`
    )
  ]
);

export const signalOperationalServingShadowResults = pgTable(
  "signal_operational_serving_shadow_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    populationId: uuid("population_id").notNull().references(() => signalPopulationDefinitions.id, { onDelete: "cascade" }),
    legacyStudyCorpusId: uuid("legacy_study_corpus_id").references(() => studyCorpora.id, { onDelete: "set null" }),
    module: text("module").notNull(),
    filtersHash: text("filters_hash").notNull(),
    populationVersion: integer("population_version").notNull(),
    populationDefinitionHash: text("population_definition_hash").notNull(),
    state: text("state").notNull(),
    contractViolationCount: integer("contract_violation_count").notNull().default(0),
    unexplainedCount: integer("unexplained_count").notNull().default(0),
    legacyDifferencesByScope: jsonb("legacy_differences_by_scope").notNull().default(sql`'{}'::jsonb`),
    governedSummary: jsonb("governed_summary").notNull().default(sql`'{}'::jsonb`),
    baselineSummary: jsonb("baseline_summary").notNull().default(sql`'{}'::jsonb`),
    legacySummary: jsonb("legacy_summary").notNull().default(sql`'{}'::jsonb`),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: now()
  },
  (table) => [
    check("signal_operational_serving_shadow_module", sql`${table.module} IN ('brand_monitoring', 'mentions', 'topics_narratives')`),
    check("signal_operational_serving_shadow_state", sql`${table.state} IN ('exact', 'correct_with_explained_legacy_differences', 'failed')`),
    check("signal_operational_serving_shadow_nonnegative", sql`${table.contractViolationCount} >= 0 AND ${table.unexplainedCount} >= 0 AND ${table.durationMs} >= 0`),
    check("signal_operational_serving_shadow_hash", sql`${table.filtersHash} ~ '^sha256:[0-9a-f]{64}$' AND ${table.populationDefinitionHash} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_signal_operational_serving_shadow_latest").on(table.workspaceId, table.module, table.createdAt)
  ]
);

export const signalOperationalShadowRequests = pgTable(
  "signal_operational_shadow_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => signalWorkspaces.id, { onDelete: "cascade" }),
    populationId: uuid("population_id").notNull().references(() => signalPopulationDefinitions.id, { onDelete: "cascade" }),
    legacyStudyCorpusId: uuid("legacy_study_corpus_id").references(() => studyCorpora.id, { onDelete: "set null" }),
    module: text("module").notNull(),
    filters: jsonb("filters").notNull(),
    filtersHash: text("filters_hash").notNull(),
    request: jsonb("request").notNull().default(sql`'{}'::jsonb`),
    dedupeKey: text("dedupe_key").notNull(),
    populationVersion: integer("population_version").notNull(),
    populationDefinitionHash: text("population_definition_hash").notNull(),
    isInternalUser: boolean("is_internal_user").notNull().default(false),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorSummary: jsonb("error_summary").notNull().default(sql`'{}'::jsonb`),
    createdAt: now(),
    updatedAt: updatedAt()
  },
  (table) => [
    unique("uq_signal_operational_shadow_request_dedupe").on(table.dedupeKey),
    check("signal_operational_shadow_request_module", sql`${table.module} IN ('brand_monitoring', 'mentions', 'topics_narratives')`),
    check("signal_operational_shadow_request_status", sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'dead_letter', 'superseded')`),
    check("signal_operational_shadow_request_nonnegative", sql`${table.attempt} >= 0`),
    check("signal_operational_shadow_request_hashes", sql`${table.filtersHash} ~ '^sha256:[0-9a-f]{64}$' AND ${table.populationDefinitionHash} ~ '^sha256:[0-9a-f]{64}$' AND ${table.dedupeKey} ~ '^sha256:[0-9a-f]{64}$'`),
    index("idx_signal_operational_shadow_requests_recovery")
      .on(table.availableAt, table.createdAt, table.id)
      .where(sql`${table.status} IN ('pending', 'failed')`),
    index("idx_signal_operational_shadow_requests_workspace_module")
      .on(table.workspaceId, table.module, table.createdAt)
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
