import { pool } from "@/lib/db";

type AdminUser = {
  id: string;
  userType: string;
};

export type AdminOperationalState = "good" | "warning" | "danger" | "not_available";

export type AdminBrandWorkspaceRow = {
  brandId: string;
  brandName: string;
  brandSlug: string;
  brandStatus: string;
  organizationId: string;
  organizationName: string;
  industry: string | null;
  workspaceId: string | null;
  workspaceSlug: string | null;
  workspaceStatus: string | null;
  timezone: string | null;
  populationId: string | null;
  populationVersion: number | null;
  governedMentions: number;
  coverageFrom: string | null;
  coverageThrough: string | null;
  coverageState: AdminOperationalState;
  freshnessState: AdminOperationalState;
  freshnessLabel: string;
  qualityState: AdminOperationalState;
  activeSources: number;
  staleSources: number;
  failedSources: number;
  pendingImports: number;
  importsFailed: number;
  reportState: string;
  currentReportRevision: number | null;
  reportsNeedingReview: number;
  latestActivityAt: string | null;
};

type AdminBrandSqlRow = {
  brand_id: string;
  brand_name: string;
  brand_slug: string;
  brand_status: string;
  organization_id: string;
  organization_name: string;
  industry: string | null;
  workspace_id: string | null;
  workspace_slug: string | null;
  workspace_status: string | null;
  timezone: string | null;
  population_id: string | null;
  population_version: number | null;
  governed_mentions: number;
  coverage_from: string | null;
  coverage_through: string | null;
  active_sources: number;
  stale_sources: number;
  failed_sources: number;
  unreviewed_sources: number;
  pending_imports: number;
  imports_failed: number;
  freshness_state: string | null;
  current_report_revision: number | null;
  current_report_status: string | null;
  reports_needing_review: number;
  analyses_running: number;
  latest_activity_at: Date | string | null;
};

export type AdminWorkspaceSource = {
  id: string;
  name: string;
  provider: string;
  sourceType: string;
  connectionMethod: string;
  scope: string | null;
  scopeReviewStatus: string;
  status: string;
  cadence: string | null;
  freshnessState: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  latestImport: AdminWorkspaceImport | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminWorkspaceImport = {
  id: string;
  sourceId: string;
  sourceFileName: string | null;
  status: string;
  records: number;
  included: number;
  excluded: number;
  duplicates: number;
  phase?: string;
  progressRecords?: number;
  progressBytes?: number;
  totalBytes?: number | null;
  failureCode?: string | null;
  supersedesImportBatchId?: string | null;
  createdAt: string;
};

export type AdminWorkspaceReport = {
  reportKey: string;
  title: string;
  status: string;
  currentRevision: number | null;
  currentReleaseStatus: string | null;
  currentReleasePublishedAt: string | null;
  latestRunStatus: string | null;
  latestRunStep: string | null;
  latestRunAt: string | null;
  latestRunId: string | null;
  latestRunContractVersion: string | null;
  executionCorpusId: string | null;
  runsNeedingReview: number;
};

export type AdminWorkspaceProfile = {
  kind: string;
  version: number;
  status: string;
  updatedAt: string;
};

export type AdminBrandWorkspace = {
  summary: AdminBrandWorkspaceRow;
  sources: AdminWorkspaceSource[];
  imports: AdminWorkspaceImport[];
  reports: AdminWorkspaceReport[];
  profiles: AdminWorkspaceProfile[];
  activeAccessCount: number;
  compatibilityCorporaCount: number;
};

export async function listAdminBrandWorkspaces(user: AdminUser): Promise<AdminBrandWorkspaceRow[]> {
  if (user.userType !== "noisia_internal") return [];
  const result = await pool.query<AdminBrandSqlRow>(ADMIN_BRAND_WORKSPACES_SQL);
  return result.rows.map(mapBrandWorkspaceRow);
}

export async function getAdminDashboard(user: AdminUser) {
  const brands = await listAdminBrandWorkspaces(user);
  const priorities = brands
    .flatMap((brand) => brandPriorities(brand))
    .sort((left, right) => priorityRank(left.state) - priorityRank(right.state))
    .slice(0, 12);
  return {
    brands,
    totals: {
      brands: brands.length,
      governedMentions: brands.reduce((total, brand) => total + brand.governedMentions, 0),
      sourcesRequiringAttention: brands.reduce(
        (total, brand) => total + brand.staleSources + brand.failedSources,
        0
      ),
      pendingImports: brands.reduce((total, brand) => total + brand.pendingImports, 0),
      reportsNeedingReview: brands.reduce((total, brand) => total + brand.reportsNeedingReview, 0)
    },
    priorities
  };
}

export async function getAdminBrandWorkspace(user: AdminUser, brandLookup: string) {
  const brands = await listAdminBrandWorkspaces(user);
  const summary = brands.find((brand) => (
    brand.brandId === brandLookup || brand.brandSlug === brandLookup
  ));
  if (!summary) return null;
  if (!summary.workspaceId) {
    return {
      summary,
      sources: [],
      imports: [],
      reports: [],
      profiles: [],
      activeAccessCount: 0,
      compatibilityCorporaCount: 0
    } satisfies AdminBrandWorkspace;
  }

  const [sourceRows, importRows, reportRows, profileRows, counts] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      provider: string;
      source_type: string;
      connection_method: string;
      governed_scope: string | null;
      scope_review_status: string;
      status: string;
      cadence: string | null;
      freshness_state: string | null;
      last_sync_at: Date | string | null;
      last_sync_status: string | null;
      latest_import_id: string | null;
      latest_import_file_name: string | null;
      latest_import_status: string | null;
      latest_import_records: number | null;
      latest_import_included: number | null;
      latest_import_excluded: number | null;
      latest_import_duplicates: number | null;
      latest_import_created_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(ADMIN_WORKSPACE_SOURCES_SQL, [summary.workspaceId]),
    pool.query<{
      id: string;
      data_source_id: string;
      source_file_name: string | null;
      status: string;
      record_count: number | null;
      included_count: number | null;
      excluded_count: number | null;
      duplicate_count: number | null;
      ingestion_phase: string;
      progress_record_count: number;
      processed_bytes: number | string;
      expected_file_size_bytes: number | string | null;
      failure_code: string | null;
      supersedes_import_batch_id: string | null;
      created_at: Date | string;
    }>(ADMIN_WORKSPACE_IMPORTS_SQL, [summary.workspaceId]),
    pool.query<{
      report_key: string;
      title: string;
      status: string;
      current_revision: number | null;
      current_release_status: string | null;
      current_release_published_at: Date | string | null;
      latest_run_status: string | null;
      latest_run_step: string | null;
      latest_run_at: Date | string | null;
      latest_run_id: string | null;
      latest_run_contract_version: string | null;
      execution_corpus_id: string | null;
      runs_needing_review: number;
    }>(ADMIN_WORKSPACE_REPORTS_SQL, [summary.workspaceId]),
    pool.query<{
      kind: string;
      version: number;
      status: string;
      updated_at: Date | string;
    }>(ADMIN_WORKSPACE_PROFILES_SQL, [summary.workspaceId]),
    pool.query<{ active_access_count: number; compatibility_corpora_count: number }>(
      ADMIN_WORKSPACE_COUNTS_SQL,
      [summary.workspaceId, summary.brandId]
    )
  ]);

  const imports = importRows.rows.map(mapImport);
  return {
    summary,
    sources: sourceRows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      sourceType: row.source_type,
      connectionMethod: row.connection_method,
      scope: row.governed_scope,
      scopeReviewStatus: row.scope_review_status,
      status: row.status,
      cadence: row.cadence,
      freshnessState: row.freshness_state ?? "not_available",
      lastSyncAt: iso(row.last_sync_at),
      lastSyncStatus: row.last_sync_status,
      latestImport: row.latest_import_id ? {
        id: row.latest_import_id,
        sourceId: row.id,
        sourceFileName: row.latest_import_file_name,
        status: row.latest_import_status ?? "not_available",
        records: Number(row.latest_import_records ?? 0),
        included: Number(row.latest_import_included ?? 0),
        excluded: Number(row.latest_import_excluded ?? 0),
        duplicates: Number(row.latest_import_duplicates ?? 0),
        createdAt: iso(row.latest_import_created_at) ?? ""
      } : null,
      createdAt: iso(row.created_at) ?? "",
      updatedAt: iso(row.updated_at) ?? ""
    })),
    imports,
    reports: reportRows.rows.map((row) => ({
      reportKey: row.report_key,
      title: row.title,
      status: row.status,
      currentRevision: row.current_revision == null ? null : Number(row.current_revision),
      currentReleaseStatus: row.current_release_status,
      currentReleasePublishedAt: iso(row.current_release_published_at),
      latestRunStatus: row.latest_run_status,
      latestRunStep: row.latest_run_step,
      latestRunAt: iso(row.latest_run_at),
      latestRunId: row.latest_run_id,
      latestRunContractVersion: row.latest_run_contract_version,
      executionCorpusId: row.execution_corpus_id,
      runsNeedingReview: Number(row.runs_needing_review ?? 0)
    })),
    profiles: profileRows.rows.map((row) => ({
      kind: row.kind,
      version: Number(row.version),
      status: row.status,
      updatedAt: iso(row.updated_at) ?? ""
    })),
    activeAccessCount: Number(counts.rows[0]?.active_access_count ?? 0),
    compatibilityCorporaCount: Number(counts.rows[0]?.compatibility_corpora_count ?? 0)
  } satisfies AdminBrandWorkspace;
}

function mapBrandWorkspaceRow(row: AdminBrandSqlRow): AdminBrandWorkspaceRow {
  const governedMentions = Number(row.governed_mentions ?? 0);
  const activeSources = Number(row.active_sources ?? 0);
  const staleSources = Number(row.stale_sources ?? 0);
  const failedSources = Number(row.failed_sources ?? 0);
  const unreviewedSources = Number(row.unreviewed_sources ?? 0);
  const pendingImports = Number(row.pending_imports ?? 0);
  const importsFailed = Number(row.imports_failed ?? 0);
  const reportsNeedingReview = Number(row.reports_needing_review ?? 0);
  const analysesRunning = Number(row.analyses_running ?? 0);
  const coverageState: AdminOperationalState = !row.workspace_id || activeSources === 0
    ? "not_available"
    : governedMentions === 0 || !row.coverage_from || !row.coverage_through
      ? "warning"
      : "good";
  const freshnessState = normalizeFreshness(row.freshness_state, activeSources);
  const qualityState: AdminOperationalState = failedSources > 0 || importsFailed > 0
    ? "danger"
    : unreviewedSources > 0 || pendingImports > 0
      ? "warning"
      : activeSources > 0 ? "good" : "not_available";
  const reportState = reportsNeedingReview > 0
    ? "needs_review"
    : analysesRunning > 0
      ? "running"
      : row.current_report_status === "published"
        ? "published"
        : "not_available";
  return {
    brandId: row.brand_id,
    brandName: row.brand_name,
    brandSlug: row.brand_slug,
    brandStatus: row.brand_status,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    industry: row.industry,
    workspaceId: row.workspace_id,
    workspaceSlug: row.workspace_slug,
    workspaceStatus: row.workspace_status,
    timezone: row.timezone,
    populationId: row.population_id,
    populationVersion: row.population_version == null ? null : Number(row.population_version),
    governedMentions,
    coverageFrom: row.coverage_from,
    coverageThrough: row.coverage_through,
    coverageState,
    freshnessState,
    freshnessLabel: row.freshness_state ?? "not_available",
    qualityState,
    activeSources,
    staleSources,
    failedSources,
    pendingImports,
    importsFailed,
    reportState,
    currentReportRevision: row.current_report_revision == null
      ? null
      : Number(row.current_report_revision),
    reportsNeedingReview,
    latestActivityAt: iso(row.latest_activity_at)
  };
}

function mapImport(row: {
  id: string;
  data_source_id: string;
  source_file_name: string | null;
  status: string;
  record_count: number | null;
  included_count: number | null;
  excluded_count: number | null;
  duplicate_count: number | null;
  ingestion_phase: string;
  progress_record_count: number;
  processed_bytes: number | string;
  expected_file_size_bytes: number | string | null;
  failure_code: string | null;
  supersedes_import_batch_id: string | null;
  created_at: Date | string;
}): AdminWorkspaceImport {
  return {
    id: row.id,
    sourceId: row.data_source_id,
    sourceFileName: row.source_file_name,
    status: row.status,
    records: Number(row.record_count ?? 0),
    included: Number(row.included_count ?? 0),
    excluded: Number(row.excluded_count ?? 0),
    duplicates: Number(row.duplicate_count ?? 0),
    phase: row.ingestion_phase,
    progressRecords: Number(row.progress_record_count ?? 0),
    progressBytes: Number(row.processed_bytes ?? 0),
    totalBytes: row.expected_file_size_bytes==null ? null : Number(row.expected_file_size_bytes),
    failureCode: row.failure_code,
    supersedesImportBatchId: row.supersedes_import_batch_id,
    createdAt: iso(row.created_at) ?? ""
  };
}

function normalizeFreshness(value: string | null, activeSources: number): AdminOperationalState {
  if (activeSources === 0 || !value || value === "not_available") return "not_available";
  if (value === "fresh") return "good";
  if (value === "failed") return "danger";
  return "warning";
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function priorityRank(state: AdminOperationalState) {
  if (state === "danger") return 0;
  if (state === "warning") return 1;
  if (state === "not_available") return 2;
  return 3;
}

function brandPriorities(brand: AdminBrandWorkspaceRow) {
  const items: Array<{
    brandId: string;
    brandName: string;
    code: string;
    count: number;
    href: string;
    state: AdminOperationalState;
  }> = [];
  if (!brand.workspaceId) {
    items.push({
      brandId: brand.brandId,
      brandName: brand.brandName,
      code: "workspace_missing",
      count: 1,
      href: `/studio/brands/${brand.brandId}/settings`,
      state: "danger"
    });
    return items;
  }
  if (brand.failedSources > 0 || brand.staleSources > 0) {
    items.push({
      brandId: brand.brandId,
      brandName: brand.brandName,
      code: brand.failedSources > 0 ? "source_failed" : "source_stale",
      count: brand.failedSources || brand.staleSources,
      href: `/studio/brands/${brand.brandId}/data`,
      state: brand.failedSources > 0 ? "danger" : "warning"
    });
  }
  if (brand.pendingImports > 0) {
    items.push({
      brandId: brand.brandId,
      brandName: brand.brandName,
      code: "imports_pending",
      count: brand.pendingImports,
      href: `/studio/brands/${brand.brandId}/data`,
      state: "warning"
    });
  }
  if (brand.coverageState !== "good") {
    items.push({
      brandId: brand.brandId,
      brandName: brand.brandName,
      code: "coverage_partial",
      count: brand.governedMentions,
      href: `/studio/brands/${brand.brandId}/data`,
      state: brand.coverageState
    });
  }
  if (brand.reportsNeedingReview > 0) {
    items.push({
      brandId: brand.brandId,
      brandName: brand.brandName,
      code: "reports_needing_review",
      count: brand.reportsNeedingReview,
      href: `/studio/brands/${brand.brandId}/reports`,
      state: "warning"
    });
  }
  return items;
}

const ADMIN_BRAND_WORKSPACES_SQL = `
  SELECT
    brand.id::text AS brand_id,
    COALESCE(brand.display_name, brand.name) AS brand_name,
    brand.slug AS brand_slug,
    brand.status AS brand_status,
    organization.id::text AS organization_id,
    COALESCE(organization.display_name, organization.legal_name, organization.slug) AS organization_name,
    brand.industry,
    workspace.id::text AS workspace_id,
    workspace.slug AS workspace_slug,
    workspace.status AS workspace_status,
    workspace.timezone,
    population.id::text AS population_id,
    population.version AS population_version,
    COALESCE(coverage.governed_mentions, 0)::integer AS governed_mentions,
    coverage.coverage_from::text,
    coverage.coverage_through::text,
    COALESCE(source_state.active_sources, 0)::integer AS active_sources,
    COALESCE(source_state.stale_sources, 0)::integer AS stale_sources,
    COALESCE(source_state.failed_sources, 0)::integer AS failed_sources,
    COALESCE(source_state.unreviewed_sources, 0)::integer AS unreviewed_sources,
    COALESCE(import_state.pending_imports, 0)::integer AS pending_imports,
    COALESCE(import_state.imports_failed, 0)::integer AS imports_failed,
    watermark.freshness_state,
    current_release.report_revision AS current_report_revision,
    current_release.status AS current_report_status,
    COALESCE(report_state.reports_needing_review, 0)::integer AS reports_needing_review,
    COALESCE(report_state.analyses_running, 0)::integer AS analyses_running,
    GREATEST(
      brand.updated_at,
      workspace.updated_at,
      source_state.latest_source_at,
      import_state.latest_import_at,
      report_state.latest_report_at
    ) AS latest_activity_at
  FROM brands brand
  JOIN organizations organization ON organization.id = brand.organization_id
  LEFT JOIN signal_workspaces workspace
    ON workspace.brand_id = brand.id
   AND workspace.organization_id = brand.organization_id
   AND workspace.status <> 'archived'
  LEFT JOIN signal_workspace_population_pointers pointer
    ON pointer.workspace_id = workspace.id
   AND pointer.purpose = 'operational'
  LEFT JOIN signal_population_definitions population
    ON population.id = pointer.population_id
   AND population.workspace_id = workspace.id
   AND population.status = 'active'
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT membership.mention_id)::integer AS governed_mentions,
      min((mention.published_at AT TIME ZONE workspace.timezone)::date) AS coverage_from,
      max((mention.published_at AT TIME ZONE workspace.timezone)::date) AS coverage_through
    FROM signal_population_memberships membership
    JOIN mentions mention
      ON mention.id = membership.mention_id
     AND mention.canonical_mention_id = mention.id
     AND mention.workspace_id = workspace.id
    WHERE membership.population_id = population.id
      AND membership.workspace_id = workspace.id
      AND membership.membership_status = 'included'
      AND membership.removed_at IS NULL
  ) coverage ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE source.status = 'active')::integer AS active_sources,
      count(*) FILTER (WHERE source.status = 'active' AND COALESCE(source_watermark.source_freshness_state, 'not_available') IN ('stale', 'partial'))::integer AS stale_sources,
      count(*) FILTER (WHERE source.status = 'active' AND COALESCE(source_watermark.source_freshness_state, 'not_available') = 'failed')::integer AS failed_sources,
      count(*) FILTER (WHERE source.status = 'active' AND (source.governed_scope IS NULL OR source.scope_review_status <> 'approved'))::integer AS unreviewed_sources,
      max(source.updated_at) AS latest_source_at
    FROM data_sources source
    LEFT JOIN LATERAL (
      SELECT water.source_freshness_state
      FROM signal_data_watermarks water
      WHERE water.workspace_id = workspace.id
        AND water.data_source_id = source.id
      ORDER BY water.accepted_at DESC, water.id DESC
      LIMIT 1
    ) source_watermark ON true
    WHERE source.workspace_id = workspace.id
  ) source_state ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE batch.status IN ('pending', 'processing', 'queued'))::integer AS pending_imports,
      count(*) FILTER (WHERE batch.status = 'failed')::integer AS imports_failed,
      max(batch.created_at) AS latest_import_at
    FROM import_batches batch
    WHERE batch.workspace_id = workspace.id
  ) import_state ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN bool_or(water.data_freshness_state = 'partial') THEN 'partial'
        WHEN bool_or(water.data_freshness_state = 'stale') THEN 'stale'
        WHEN bool_or(water.data_freshness_state = 'fresh') THEN 'fresh'
        ELSE 'not_available'
      END AS freshness_state
    FROM signal_data_watermarks water
    WHERE water.workspace_id = workspace.id
      AND water.study_corpus_id IS NULL
  ) watermark ON true
  LEFT JOIN signal_workspace_report_current_releases current_pointer
    ON current_pointer.workspace_id = workspace.id
   AND current_pointer.report_key = 'triggers-barriers'
  LEFT JOIN signal_workspace_releases current_release
    ON current_release.id = current_pointer.release_id
   AND current_release.workspace_id = workspace.id
   AND current_release.report_key = current_pointer.report_key
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE analysis.status = 'needs_review')::integer AS reports_needing_review,
      count(*) FILTER (WHERE analysis.status = 'running')::integer AS analyses_running,
      max(analysis.updated_at) AS latest_report_at
    FROM tb_analyses analysis
    WHERE analysis.workspace_id = workspace.id
      AND analysis.report_key = 'triggers-barriers'
      AND analysis.strategic_contract_version = 'signal-tb-strategic-v1'
  ) report_state ON true
  ORDER BY lower(COALESCE(brand.display_name, brand.name)), brand.id
`;

const ADMIN_WORKSPACE_SOURCES_SQL = `
  SELECT source.id::text, source.name, source.provider, source.source_type,
    source.connection_method, source.governed_scope, source.scope_review_status,
    source.status, policy.cadence,
    COALESCE(watermark.source_freshness_state, 'not_available') AS freshness_state,
    sync.finished_at AS last_sync_at, sync.status AS last_sync_status,
    latest_import.id::text AS latest_import_id,
    latest_import.source_file_name AS latest_import_file_name,
    latest_import.status AS latest_import_status,
    latest_import.record_count AS latest_import_records,
    latest_import.included_count AS latest_import_included,
    latest_import.excluded_count AS latest_import_excluded,
    latest_import.duplicate_count AS latest_import_duplicates,
    latest_import.created_at AS latest_import_created_at,
    source.created_at, source.updated_at
  FROM data_sources source
  LEFT JOIN signal_refresh_policies policy
    ON policy.workspace_id = source.workspace_id
   AND policy.data_source_id = source.id
  LEFT JOIN LATERAL (
    SELECT run.finished_at, run.status
    FROM source_sync_runs run
    WHERE run.workspace_id = source.workspace_id AND run.data_source_id = source.id
    ORDER BY run.created_at DESC, run.id DESC
    LIMIT 1
  ) sync ON true
  LEFT JOIN LATERAL (
    SELECT water.source_freshness_state
    FROM signal_data_watermarks water
    WHERE water.workspace_id = source.workspace_id AND water.data_source_id = source.id
    ORDER BY water.accepted_at DESC, water.id DESC
    LIMIT 1
  ) watermark ON true
  LEFT JOIN LATERAL (
    SELECT batch.*
    FROM import_batches batch
    WHERE batch.workspace_id = source.workspace_id AND batch.data_source_id = source.id
    ORDER BY batch.created_at DESC, batch.id DESC
    LIMIT 1
  ) latest_import ON true
  WHERE source.workspace_id = $1::uuid
  ORDER BY source.updated_at DESC, source.id
`;

const ADMIN_WORKSPACE_IMPORTS_SQL = `
  SELECT id::text, data_source_id::text, source_file_name, status,
    record_count, included_count, excluded_count, duplicate_count,ingestion_phase,
    progress_record_count,processed_bytes,expected_file_size_bytes,failure_code,
    supersedes_import_batch_id::text,created_at
  FROM import_batches
  WHERE workspace_id = $1::uuid
  ORDER BY created_at DESC, id DESC
  LIMIT 250
`;

const ADMIN_WORKSPACE_REPORTS_SQL = `
  SELECT report.report_key, report.title, report.status,
    current_release.report_revision AS current_revision,
    current_release.status AS current_release_status,
    current_release.published_at AS current_release_published_at,
    latest_run.status AS latest_run_status,
    latest_run.current_step AS latest_run_step,
    latest_run.updated_at AS latest_run_at,
    latest_run.id::text AS latest_run_id,
    latest_run.strategic_contract_version AS latest_run_contract_version,
    latest_run.study_corpus_id::text AS execution_corpus_id,
    COALESCE(review_state.runs_needing_review, 0)::integer AS runs_needing_review
  FROM signal_workspace_reports report
  LEFT JOIN signal_workspace_report_current_releases pointer
    ON pointer.workspace_id = report.workspace_id
   AND pointer.report_key = report.report_key
  LEFT JOIN signal_workspace_releases current_release
    ON current_release.id = pointer.release_id
   AND current_release.workspace_id = report.workspace_id
   AND current_release.report_key = report.report_key
  LEFT JOIN LATERAL (
    SELECT analysis.id, analysis.study_corpus_id, analysis.strategic_contract_version,
      COALESCE(control.status, analysis.status) AS status,
      analysis.current_step, analysis.updated_at
    FROM tb_analyses analysis
    LEFT JOIN signal_strategic_run_controls control
      ON control.workspace_id = analysis.workspace_id
     AND control.tb_analysis_id = analysis.id
     AND control.snapshot_id = analysis.snapshot_id
    WHERE analysis.workspace_id = report.workspace_id
      AND analysis.report_key = report.report_key
      AND analysis.strategic_contract_version IN (
        'signal-tb-strategic-v1',
        'signal-tb-strategic-v2'
      )
      AND (
        analysis.strategic_contract_version = 'signal-tb-strategic-v1'
        OR control.id IS NOT NULL
      )
    ORDER BY analysis.created_at DESC, analysis.id DESC
    LIMIT 1
  ) latest_run ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (
      WHERE COALESCE(control.status, analysis.status) = 'needs_review'
    )::integer AS runs_needing_review
    FROM tb_analyses analysis
    LEFT JOIN signal_strategic_run_controls control
      ON control.workspace_id = analysis.workspace_id
     AND control.tb_analysis_id = analysis.id
     AND control.snapshot_id = analysis.snapshot_id
    WHERE analysis.workspace_id = report.workspace_id
      AND analysis.report_key = report.report_key
      AND analysis.strategic_contract_version IN (
        'signal-tb-strategic-v1',
        'signal-tb-strategic-v2'
      )
      AND (
        analysis.strategic_contract_version = 'signal-tb-strategic-v1'
        OR control.id IS NOT NULL
      )
  ) review_state ON true
  WHERE report.workspace_id = $1::uuid
  ORDER BY report.created_at, report.report_key
`;

const ADMIN_WORKSPACE_PROFILES_SQL = `
  SELECT kind, version, status, updated_at
  FROM signal_taxonomy_profiles
  WHERE workspace_id = $1::uuid
    AND status <> 'retired'
  ORDER BY kind, version DESC
`;

const ADMIN_WORKSPACE_COUNTS_SQL = `
  SELECT
    (SELECT count(*)::integer FROM user_brand_access access
      WHERE access.brand_id = $2::uuid AND access.revoked_at IS NULL) AS active_access_count,
    (SELECT count(*)::integer FROM signal_workspace_corpora corpus
      WHERE corpus.workspace_id = $1::uuid AND corpus.valid_to IS NULL) AS compatibility_corpora_count
`;
