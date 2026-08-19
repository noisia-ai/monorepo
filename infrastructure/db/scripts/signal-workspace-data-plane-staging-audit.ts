import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import pg from "pg";

import { signalWorkspaceContentHashes } from "./signal-workspace-content-hashes.js";

import {
  databaseUrlLooksProductionLike,
  getDatabaseSslConfig,
  isLocalDatabaseUrl,
  requireSafeDatabaseReadTarget
} from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_AUDIT_ALLOW_REMOTE";
const BRAND_SLUG_ENV = "NOISIA_SIGNAL_WORKSPACE_AUDIT_BRAND_SLUG";
const SAMPLE_SIZE_ENV = "NOISIA_SIGNAL_SCOPE_AUDIT_SAMPLE_SIZE";
const INCLUDE_TEXT_ENV = "NOISIA_SIGNAL_SCOPE_AUDIT_INCLUDE_TEXT";
const PII_APPROVAL_ENV = "NOISIA_SIGNAL_SCOPE_AUDIT_PII_APPROVED";
const SAMPLE_OUTPUT_ENV = "NOISIA_SIGNAL_SCOPE_AUDIT_SAMPLE_OUTPUT";

const SCOPE_EXPRESSION = `CASE
  WHEN batch.mention_type = 'brand' OR batch.entity_kind = 'primary_brand'
    THEN 'primary_brand'
  WHEN batch.mention_type = 'competitor'
    OR batch.entity_kind IN ('competitor', 'competitor_pool')
    THEN 'competitor'
  WHEN batch.mention_type = 'industry' OR batch.entity_kind = 'category'
    THEN 'category'
  WHEN batch.entity_kind = 'reference'
    THEN 'reference'
  ELSE 'unattributed'
END`;

const REASON_EXPRESSION = `CASE
  WHEN batch.mention_type = 'brand' THEN 'batch.mention_type=brand'
  WHEN batch.entity_kind = 'primary_brand' THEN 'batch.entity_kind=primary_brand'
  WHEN batch.mention_type = 'competitor' THEN 'batch.mention_type=competitor'
  WHEN batch.entity_kind = 'competitor' THEN 'batch.entity_kind=competitor'
  WHEN batch.entity_kind = 'competitor_pool' THEN 'batch.entity_kind=competitor_pool'
  WHEN batch.mention_type = 'industry' THEN 'batch.mention_type=industry'
  WHEN batch.entity_kind = 'category' THEN 'batch.entity_kind=category'
  WHEN batch.entity_kind = 'reference' THEN 'batch.entity_kind=reference'
  WHEN batch.id IS NULL THEN 'missing_import_batch'
  ELSE 'no_governed_scope_signal'
END`;

type ScopeSample = {
  mention_id: string;
  text_hash: string | null;
  text_snippet: string | null;
  scope: string;
  assignment_reason: string;
  inclusion_status: string;
  mention_type: string | null;
  entity_kind: string | null;
  entity_label: string | null;
  has_competitor_id: boolean;
};

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function targetFingerprint(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//, ""),
    parsed.username
  ].join("|"));
}

function assertTarget(databaseUrl: string) {
  if (isLocalDatabaseUrl(databaseUrl)) return "local";
  const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  if (target !== "preview" && target !== "staging") {
    throw new Error(
      "Scope audit requires a real isolated target declared as preview or staging."
    );
  }
  if (databaseUrlLooksProductionLike(databaseUrl)) {
    throw new Error("Refusing a production-like DATABASE_URL for staging scope audit.");
  }
  if (process.env[ALLOW_REMOTE_ENV] !== "true") {
    throw new Error(`${ALLOW_REMOTE_ENV}=true is required for remote read-only audit.`);
  }
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "audit Signal workspace data-plane staging data",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  });
  return target;
}

function sampleSize() {
  const parsed = Number(process.env[SAMPLE_SIZE_ENV] ?? "5");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25) {
    throw new Error(`${SAMPLE_SIZE_ENV} must be an integer between 1 and 25.`);
  }
  return parsed;
}

async function tableExists(client: pg.Client, table: string) {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.' || $1) IS NOT NULL AS exists",
    [table]
  );
  return result.rows[0]?.exists === true;
}

async function columnExists(client: pg.Client, table: string, column: string) {
  const result = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    ) AS exists
  `, [table, column]);
  return result.rows[0]?.exists === true;
}

async function loadBrand(client: pg.Client, brandSlug: string) {
  const result = await client.query<{ id: string; organization_id: string }>(`
    SELECT id::text, organization_id::text
    FROM brands
    WHERE lower(slug) = lower($1)
    ORDER BY created_at
  `, [brandSlug]);
  if (result.rowCount !== 1 || !result.rows[0]) {
    throw new Error(`Expected exactly one brand for slug ${brandSlug}.`);
  }
  return result.rows[0];
}

async function loadLegacyScopeAudit(
  client: pg.Client,
  brandId: string,
  limit: number,
  includeText: boolean
) {
  const counts = await client.query<{
    scope: string;
    inclusion_status: string;
    count: number;
  }>(`
    SELECT
      ${SCOPE_EXPRESSION} AS scope,
      mention.inclusion_status,
      count(*)::int AS count
    FROM mentions mention
    JOIN study_corpora corpus ON corpus.id = mention.study_corpus_id
    LEFT JOIN import_batches batch ON batch.id = mention.source_file_id
    WHERE corpus.brand_id = $1::uuid
    GROUP BY 1, 2
    ORDER BY 1, 2
  `, [brandId]);

  const samples = await client.query<ScopeSample>(`
    WITH ranked AS (
      SELECT
        mention.id::text AS mention_id,
        mention.text_hash,
        ${includeText ? "mention.text_snippet" : "NULL::text"} AS text_snippet,
        ${SCOPE_EXPRESSION} AS scope,
        ${REASON_EXPRESSION} AS assignment_reason,
        mention.inclusion_status,
        batch.mention_type,
        batch.entity_kind,
        batch.entity_label,
        batch.competitor_id IS NOT NULL AS has_competitor_id,
        row_number() OVER (
          PARTITION BY ${SCOPE_EXPRESSION}
          ORDER BY md5(mention.id::text), mention.id
        ) AS sample_rank
      FROM mentions mention
      JOIN study_corpora corpus ON corpus.id = mention.study_corpus_id
      LEFT JOIN import_batches batch ON batch.id = mention.source_file_id
      WHERE corpus.brand_id = $1::uuid
        AND mention.inclusion_status = 'included'
    )
    SELECT mention_id, text_hash, text_snippet, scope, assignment_reason,
           inclusion_status, mention_type, entity_kind, entity_label,
           has_competitor_id
    FROM ranked
    WHERE sample_rank <= $2::int
    ORDER BY scope, sample_rank
  `, [brandId, limit]);

  const ambiguous = await client.query<{ reason: string; count: number }>(`
    SELECT reason, count(*)::int AS count
    FROM (
      SELECT CASE
        WHEN batch.id IS NULL THEN 'missing_import_batch'
        WHEN batch.mention_type = 'brand'
          AND batch.entity_kind IN ('competitor', 'competitor_pool', 'category')
          THEN 'brand_type_conflicts_with_entity_kind'
        WHEN batch.mention_type = 'competitor'
          AND batch.entity_kind IN ('primary_brand', 'category')
          THEN 'competitor_type_conflicts_with_entity_kind'
        WHEN batch.mention_type = 'industry'
          AND batch.entity_kind IN ('primary_brand', 'competitor', 'competitor_pool')
          THEN 'industry_type_conflicts_with_entity_kind'
        WHEN batch.mention_type IS NULL AND batch.entity_kind IS NULL
          THEN 'no_scope_signal'
        ELSE NULL
      END AS reason
      FROM mentions mention
      JOIN study_corpora corpus ON corpus.id = mention.study_corpus_id
      LEFT JOIN import_batches batch ON batch.id = mention.source_file_id
      WHERE corpus.brand_id = $1::uuid
        AND mention.inclusion_status = 'included'
    ) classified
    WHERE reason IS NOT NULL
    GROUP BY reason
    ORDER BY reason
  `, [brandId]);

  const digest = await client.query<{ mention_count: number; membership_digest: string }>(`
    SELECT
      count(*)::int AS mention_count,
      md5(COALESCE(string_agg(mention.id::text, ',' ORDER BY mention.id), ''))
        AS membership_digest
    FROM mentions mention
    JOIN study_corpora corpus ON corpus.id = mention.study_corpus_id
    WHERE corpus.brand_id = $1::uuid
  `, [brandId]);

  return {
    rules: [
      "primary_brand: import_batches.mention_type=brand OR entity_kind=primary_brand",
      "competitor: mention_type=competitor OR entity_kind IN (competitor, competitor_pool)",
      "category: mention_type=industry OR entity_kind=category",
      "reference: entity_kind=reference",
      "unattributed: no recognized server-owned batch scope signal"
    ],
    counts: counts.rows,
    ambiguous: ambiguous.rows,
    digest: digest.rows[0],
    samples: samples.rows
  };
}

async function loadSyncAudit(client: pg.Client, brandId: string) {
  const result = await client.query<{
    status: string;
    started_at: string | null;
    finished_at: string | null;
    created_at: string | null;
    source_type: string;
    connection_method: string;
    records_total: number | null;
    records_valid: number | null;
    records_duplicate: number | null;
    records_failed: number | null;
    last_activity_at: string | null;
    idle_seconds: string | null;
    asset_records: number;
    observations: number;
    quality_results: number;
  }>(`
    WITH target AS (
      SELECT run.*
      FROM source_sync_runs run
      JOIN data_sources source ON source.id = run.data_source_id
      WHERE source.brand_id = $1::uuid AND run.status = 'running'
    ), activity AS (
      SELECT
        target.id,
        greatest(
          target.started_at,
          target.created_at,
          (SELECT max(greatest(record.created_at, record.materialized_at))
           FROM data_asset_records record WHERE record.source_sync_run_id = target.id),
          (SELECT max(greatest(observation.created_at, observation.materialized_at))
           FROM data_observations observation WHERE observation.source_sync_run_id = target.id)
        ) AS last_activity_at,
        (SELECT count(*) FROM data_asset_records record
         WHERE record.source_sync_run_id = target.id)::int AS asset_records,
        (SELECT count(*) FROM data_observations observation
         WHERE observation.source_sync_run_id = target.id)::int AS observations,
        (SELECT count(*) FROM data_quality_results quality
         WHERE quality.source_sync_run_id = target.id)::int AS quality_results
      FROM target
    )
    SELECT
      target.status,
      target.started_at::text,
      target.finished_at::text,
      target.created_at::text,
      source.source_type,
      source.connection_method,
      target.records_total,
      target.records_valid,
      target.records_duplicate,
      target.records_failed,
      activity.last_activity_at::text,
      extract(epoch FROM now() - activity.last_activity_at)::bigint::text AS idle_seconds,
      activity.asset_records,
      activity.observations,
      activity.quality_results
    FROM target
    JOIN activity ON activity.id = target.id
    JOIN data_sources source ON source.id = target.data_source_id
    ORDER BY target.created_at
  `, [brandId]);
  return {
    rows: result.rows,
    persisted_job_id_available: false,
    heartbeat_available: false,
    note: "source_sync_runs has no job or heartbeat column; activity is inferred from canonical child rows"
  };
}

async function loadPostMigrationAudit(
  client: pg.Client,
  brandId: string,
  brandSlug: string
) {
  if (!(await columnExists(client, "mentions", "workspace_id"))) return { available: false };
  const workspace = await client.query<{ id: string }>(`
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid ORDER BY created_at
  `, [brandId]);
  if (workspace.rowCount !== 1 || !workspace.rows[0]) {
    return { available: true, workspace_resolution: "invalid" };
  }
  const workspaceId = workspace.rows[0].id;
  const counts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM mentions WHERE workspace_id = $1::uuid) AS mentions,
      (SELECT count(*)::int FROM mentions
       WHERE workspace_id = $1::uuid AND canonical_mention_id = id) AS canonical_roots,
      (SELECT count(*)::int FROM mentions
       WHERE workspace_id = $1::uuid AND canonical_mention_id <> id) AS aliases,
      (SELECT count(*)::int FROM signal_mention_attributions
       WHERE workspace_id = $1::uuid AND review_status = 'approved') AS approved_attributions,
      (SELECT count(*)::int FROM signal_mention_import_memberships
       WHERE workspace_id = $1::uuid) AS import_provenance,
      (SELECT count(*)::int FROM signal_mention_study_memberships
       WHERE workspace_id = $1::uuid) AS study_provenance,
      (SELECT count(*)::int
       FROM signal_workspace_population_pointers pointer
       JOIN signal_population_memberships membership
         ON membership.population_id = pointer.population_id
        AND membership.workspace_id = pointer.workspace_id
       WHERE pointer.workspace_id = $1::uuid
         AND pointer.purpose = 'operational') AS operational_membership_rows,
      (SELECT count(*)::int FROM signal_workspace_population_pointers
       WHERE workspace_id = $1::uuid AND purpose = 'operational') AS current_operational_pointers,
      (SELECT count(*)::int
       FROM signal_workspace_population_pointers pointer
       JOIN signal_population_memberships membership
         ON membership.population_id = pointer.population_id
       WHERE pointer.workspace_id = $1::uuid
         AND pointer.purpose = 'operational'
         AND membership.membership_status = 'included'
         AND membership.removed_at IS NULL)
        AS active_operational_memberships,
      (SELECT count(*)::int FROM data_sources
       WHERE workspace_id IS NULL AND brand_id = $2::uuid)
        AS unresolved_source_workspace,
      (SELECT count(*)::int
       FROM import_batches batch
       JOIN study_corpora corpus ON corpus.id = batch.study_corpus_id
       WHERE batch.workspace_id IS NULL AND corpus.brand_id = $2::uuid)
        AS unresolved_import_workspace,
      (SELECT count(*)::int
       FROM mentions mention
       JOIN study_corpora corpus ON corpus.id = mention.study_corpus_id
       WHERE mention.workspace_id IS NULL AND corpus.brand_id = $2::uuid)
        AS unresolved_mention_workspace,
      (SELECT count(*)::int
       FROM mentions mention
       WHERE mention.workspace_id = $1::uuid
         AND (mention.canonical_mention_id IS NULL OR NOT EXISTS (
           SELECT 1
           FROM mentions root
           WHERE root.id = mention.canonical_mention_id
             AND root.workspace_id = mention.workspace_id
             AND root.canonical_mention_id = root.id
         ))) AS unresolved_canonical_identity,
      (SELECT count(*)::int
       FROM mentions mention
       WHERE mention.workspace_id = $1::uuid
         AND mention.source_file_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM signal_mention_import_memberships membership
           WHERE membership.workspace_id = mention.workspace_id
             AND membership.mention_id = mention.canonical_mention_id
             AND membership.import_batch_id = mention.source_file_id
         )) AS missing_import_membership,
      (SELECT count(*)::int
       FROM mentions mention
       WHERE mention.workspace_id = $1::uuid
         AND mention.canonical_mention_id = mention.id
         AND NOT EXISTS (
           SELECT 1
           FROM signal_mention_attributions attribution
           WHERE attribution.workspace_id = mention.workspace_id
             AND attribution.mention_id = mention.id
         )) AS missing_attribution
  `, [workspaceId, brandId]);
  const scopes = await client.query(`
    WITH scope_values(scope, ordinal) AS (VALUES
      ('primary_brand'::text, 1), ('competitor', 2), ('category', 3),
      ('reference', 4), ('unattributed', 5)
    ), counts AS (
      SELECT scope, review_status, count(*)::int AS count
      FROM signal_mention_attributions
      WHERE workspace_id = $1::uuid
      GROUP BY scope, review_status
    )
    SELECT scope_values.scope, COALESCE(counts.review_status, 'none') AS review_status,
           COALESCE(counts.count, 0)::int AS count
    FROM scope_values
    LEFT JOIN counts ON counts.scope = scope_values.scope
    ORDER BY scope_values.ordinal, review_status
  `, [workspaceId]);
  const scopeMembershipMatrix = await client.query(`
    WITH current_pointer AS (
      SELECT population_id
      FROM signal_workspace_population_pointers
      WHERE workspace_id = $1::uuid AND purpose = 'operational'
    )
    SELECT attribution.scope, attribution.review_status,
           mention.inclusion_status,
           COALESCE(membership.membership_status, 'missing') AS membership_status,
           (membership.membership_status = 'included'
             AND membership.removed_at IS NULL) AS active_membership,
           count(*)::int AS attribution_rows,
           count(DISTINCT attribution.mention_id)::int AS mentions
    FROM signal_mention_attributions attribution
    JOIN mentions mention
      ON mention.id = attribution.mention_id
     AND mention.workspace_id = attribution.workspace_id
     AND mention.canonical_mention_id = mention.id
    CROSS JOIN current_pointer
    LEFT JOIN signal_population_memberships membership
      ON membership.population_id = current_pointer.population_id
     AND membership.workspace_id = attribution.workspace_id
     AND membership.mention_id = attribution.mention_id
    WHERE attribution.workspace_id = $1::uuid
    GROUP BY attribution.scope, attribution.review_status,
             mention.inclusion_status, membership.membership_status,
             (membership.membership_status = 'included'
               AND membership.removed_at IS NULL)
    ORDER BY attribution.scope, attribution.review_status,
             mention.inclusion_status, membership_status
  `, [workspaceId]);
  const assignmentPolicies = await client.query(`
    SELECT scope, attribution_source, policy_version, review_status,
           count(*)::int AS attribution_rows,
           count(DISTINCT mention_id)::int AS mentions
    FROM signal_mention_attributions
    WHERE workspace_id = $1::uuid
    GROUP BY scope, attribution_source, policy_version, review_status
    ORDER BY scope, attribution_source, policy_version, review_status
  `, [workspaceId]);
  const eligibilityExplanation = await client.query<{ reason: string; count: number }>(`
    WITH current_pointer AS (
      SELECT population_id
      FROM signal_workspace_population_pointers
      WHERE workspace_id = $1::uuid AND purpose = 'operational'
    ), attribution_state AS (
      SELECT mention_id,
        bool_or(scope = 'primary_brand' AND review_status = 'approved')
          AS has_approved_primary,
        bool_or(scope = 'primary_brand' AND review_status <> 'approved')
          AS has_unapproved_primary,
        min(scope) FILTER (
          WHERE scope <> 'primary_brand' AND review_status = 'approved'
        ) AS approved_non_primary_scope
      FROM signal_mention_attributions
      WHERE workspace_id = $1::uuid
      GROUP BY mention_id
    ), classified AS (
      SELECT mention.id,
        CASE
          WHEN membership.membership_status = 'included'
            AND membership.removed_at IS NULL
            THEN 'active_operational_primary_brand'
          WHEN mention.inclusion_status <> 'included'
            THEN 'not_included:' || mention.inclusion_status
          WHEN attribution_state.approved_non_primary_scope IS NOT NULL
            AND NOT COALESCE(attribution_state.has_approved_primary, false)
            THEN 'included_non_primary:' || attribution_state.approved_non_primary_scope
          WHEN COALESCE(attribution_state.has_unapproved_primary, false)
            AND NOT COALESCE(attribution_state.has_approved_primary, false)
            THEN 'primary_brand_review_not_approved'
          WHEN COALESCE(attribution_state.has_approved_primary, false)
            THEN 'approved_primary_brand_missing_active_membership'
          ELSE 'included_without_eligible_attribution'
        END AS reason
      FROM mentions mention
      CROSS JOIN current_pointer
      LEFT JOIN attribution_state ON attribution_state.mention_id = mention.id
      LEFT JOIN signal_population_memberships membership
        ON membership.population_id = current_pointer.population_id
       AND membership.workspace_id = mention.workspace_id
       AND membership.mention_id = mention.id
      WHERE mention.workspace_id = $1::uuid
        AND mention.canonical_mention_id = mention.id
    )
    SELECT reason, count(*)::int AS count
    FROM classified
    GROUP BY reason
    ORDER BY reason
  `, [workspaceId]);
  const population = await client.query(`
    SELECT definition.population_key, definition.version, definition.status,
           count(membership.mention_id)::int AS active_memberships
    FROM signal_workspace_population_pointers pointer
    JOIN signal_population_definitions definition ON definition.id = pointer.population_id
    LEFT JOIN signal_population_memberships membership
      ON membership.population_id = definition.id
     AND membership.membership_status = 'included'
     AND membership.removed_at IS NULL
    WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
    GROUP BY definition.population_key, definition.version, definition.status
  `, [workspaceId]);
  const contentHashes = await signalWorkspaceContentHashes(client, [{
    workspace_id: workspaceId,
    brand_id: brandId,
    brand_slug: brandSlug
  }]);
  const countRow = counts.rows[0] as Record<string, number> | undefined;
  const unresolvedBreakdown = {
    source_workspace: Number(countRow?.unresolved_source_workspace ?? 0),
    import_workspace: Number(countRow?.unresolved_import_workspace ?? 0),
    mention_workspace: Number(countRow?.unresolved_mention_workspace ?? 0),
    canonical_identity: Number(countRow?.unresolved_canonical_identity ?? 0),
    import_membership: Number(countRow?.missing_import_membership ?? 0),
    attribution: Number(countRow?.missing_attribution ?? 0)
  };
  const activeCount = Number(
    eligibilityExplanation.rows.find(
      (row) => row.reason === "active_operational_primary_brand"
    )?.count ?? 0
  );
  const rootCount = Number(countRow?.canonical_roots ?? 0);
  return {
    available: true,
    workspace_resolution: "exactly_one",
    workspace_key: sha256(workspaceId),
    counts: countRow,
    unresolved: {
      count: Object.values(unresolvedBreakdown).reduce((sum, count) => sum + count, 0),
      breakdown: unresolvedBreakdown
    },
    scopes: scopes.rows,
    scope_membership_matrix: scopeMembershipMatrix.rows,
    assignment_policies: assignmentPolicies.rows,
    operational_eligibility_explanation: {
      active_count: activeCount,
      outside_active_count: rootCount - activeCount,
      rows: eligibilityExplanation.rows,
      reconciles_to_canonical_roots:
        eligibilityExplanation.rows.reduce((sum, row) => sum + Number(row.count), 0) === rootCount
    },
    population: population.rows,
    content_hashes: contentHashes
  };
}

function redactSamples(samples: ScopeSample[]) {
  return samples.map((sample) => ({
    sample_key: sha256(sample.mention_id),
    content_key: sha256(sample.text_hash ?? sample.mention_id),
    scope: sample.scope,
    assignment_reason: sample.assignment_reason,
    inclusion_status: sample.inclusion_status,
    mention_type: sample.mention_type,
    entity_kind: sample.entity_kind,
    entity_label_key: sample.entity_label ? sha256(sample.entity_label) : null,
    has_competitor_id: sample.has_competitor_id,
    text_redacted: true
  }));
}

function sanitizeReviewSnippet(value: string | null) {
  if (value === null) return null;
  return value
    .replace(/\b(?:https?:\/\/|www\.)[^\s]+/giu, "[url-redacted]")
    .replace(/(^|[\s([{])@[A-Za-z0-9_.-]+/gu, "$1[handle-redacted]");
}

async function maybeWriteHumanReview(samples: ScopeSample[]) {
  if (process.env[INCLUDE_TEXT_ENV] !== "true") return null;
  if (process.env[PII_APPROVAL_ENV] !== "true") {
    throw new Error(`${PII_APPROVAL_ENV}=true is required to export review text.`);
  }
  const configuredPath = requireEnv(SAMPLE_OUTPUT_ENV);
  const outputPath = resolve(configuredPath);
  if (!outputPath.includes(`${process.cwd()}/.data/`) && !outputPath.includes("/.data/")) {
    throw new Error(`${SAMPLE_OUTPUT_ENV} must point inside a .data directory.`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    handling: "internal-human-review-only",
    samples: samples.map((sample) => ({
      ...redactSamples([sample])[0],
      entity_label: sample.entity_label,
      text_snippet: sanitizeReviewSnippet(sample.text_snippet)
    }))
  }, null, 2), { encoding: "utf8", mode: 0o600 });
  return { written: true, sample_count: samples.length, path_redacted: true };
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const target = assertTarget(databaseUrl);
  const brandSlug = requireEnv(BRAND_SLUG_ENV);
  const limit = sampleSize();
  const includeText = process.env[INCLUDE_TEXT_ENV] === "true";
  const client = new pg.Client({ connectionString: databaseUrl, ssl: getDatabaseSslConfig() });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const brand = await loadBrand(client, brandSlug);
    const legacy = await loadLegacyScopeAudit(client, brand.id, limit, includeText);
    const syncs = await loadSyncAudit(client, brand.id);
    const postMigration = await loadPostMigrationAudit(client, brand.id, brandSlug);
    const releaseTable = await tableExists(client, "signal_workspace_report_current_releases");
    await client.query("ROLLBACK");

    const humanReview = await maybeWriteHumanReview(legacy.samples);
    console.log(JSON.stringify({
      ok: true,
      read_only: true,
      writes_performed: false,
      target,
      target_fingerprint: targetFingerprint(databaseUrl),
      inspected_brand_slug: brandSlug,
      inspected_workspace_count:
        postMigration.available && postMigration.workspace_resolution === "exactly_one" ? 1 : 0,
      brand_key: sha256(`${brand.organization_id}:${brand.id}`),
      sample_size_per_scope: limit,
      legacy_scope: {
        rules: legacy.rules,
        counts: legacy.counts,
        ambiguous: legacy.ambiguous,
        digest: legacy.digest,
        samples: redactSamples(legacy.samples)
      },
      running_syncs: syncs,
      post_migration: postMigration,
      composite_report_pointer_available: releaseTable,
      human_review_export: humanReview
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
