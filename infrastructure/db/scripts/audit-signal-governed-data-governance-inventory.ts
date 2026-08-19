import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import pg from "pg";

import { getDatabaseSslConfig, requireSafeDatabaseReadTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const EXPECTED_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_INVENTORY_ALLOW_REMOTE";
const FINGERPRINT_ENV = "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_TARGET_FINGERPRINT";
const PRIVATE_OUTPUT_ENV = "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_PRIVATE_MANIFEST";

const MODULE_REQUIREMENTS = [
  { module_key: "brand-monitoring", view_key: "brand", usage_purposes: ["client-derived-metrics"] },
  { module_key: "mentions", view_key: "brand", usage_purposes: ["client-mention-list", "client-text-or-excerpt"] },
  { module_key: "topics-narratives", view_key: "brand", usage_purposes: ["client-derived-metrics"] }
] as const;

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fingerprint(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""),
    parsed.username
  ].join("|"));
}

function sanitizedKey(kind: string, id: string) {
  return `${kind}_${sha256(`${kind}:${id}`).slice(7, 19)}`;
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const observedFingerprint = fingerprint(databaseUrl);
  if (process.env.NOISIA_REMOTE_DATABASE_TARGET !== "preview"
    && process.env.NOISIA_REMOTE_DATABASE_TARGET !== "staging") {
    throw new Error("Governance inventory requires an explicitly classified preview/staging target.");
  }
  if (process.env[ALLOW_REMOTE_ENV] !== "true") throw new Error(`${ALLOW_REMOTE_ENV}=true is required.`);
  if (observedFingerprint !== EXPECTED_FINGERPRINT
    || process.env[FINGERPRINT_ENV] !== observedFingerprint) {
    throw new Error("Governance inventory target fingerprint mismatch.");
  }
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "inventory governed-view quality, retention, licensing and provenance gaps",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  });
  const outputPath = resolve(requireEnv(PRIVATE_OUTPUT_ENV));
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-governed-governance-inventory-readonly"
  });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='10min'");
    const workspaceResult = await client.query<{
      workspace_id: string;
      brand_id: string;
      organization_id: string;
      workspace_status: string;
    }>(`
      SELECT workspace.id AS workspace_id, workspace.brand_id, workspace.organization_id,
        workspace.status AS workspace_status
      FROM brands brand JOIN signal_workspaces workspace ON workspace.brand_id=brand.id
      WHERE brand.slug='laika'
    `);
    if (workspaceResult.rowCount !== 1) throw new Error("Expected exactly one Laika workspace.");
    const workspace = workspaceResult.rows[0]!;

    const sourceResult = await client.query<{
      source_id: string;
      source_name: string;
      source_type: string;
      provider: string;
      status: string;
      visibility: string;
      import_count: number;
      import_membership_rows: number;
      canonical_root_count: number;
      included_root_count: number;
      roots_without_quality_score: number;
      roots_with_quality_flags: number;
      min_quality_score: number | null;
      max_quality_score: number | null;
      watermark_count: number;
      watermark_fresh: number;
      watermark_stale: number;
      watermark_partial: number;
      watermark_failed_or_na: number;
      max_observed_at: string | null;
      max_materialized_at: string | null;
      source_binding_count: number;
      import_override_count: number;
    }>(`
      WITH target_sources AS (
        SELECT source.* FROM data_sources source WHERE source.workspace_id=$1
      ), source_roots AS (
        SELECT membership.data_source_id,
          count(*)::int AS membership_rows,
          count(DISTINCT root.id)::int AS root_count,
          count(DISTINCT root.id) FILTER (WHERE root.inclusion_status='included')::int AS included_count,
          count(DISTINCT root.id) FILTER (WHERE root.quality_score IS NULL)::int AS no_quality_score,
          count(DISTINCT root.id) FILTER (
            WHERE jsonb_typeof(COALESCE(root.quality_flags, '[]'::jsonb))='array'
              AND jsonb_array_length(COALESCE(root.quality_flags, '[]'::jsonb)) > 0
          )::int AS with_quality_flags,
          min(root.quality_score)::int AS min_quality_score,
          max(root.quality_score)::int AS max_quality_score
        FROM signal_mention_import_memberships membership
        JOIN mentions provenance ON provenance.id=membership.mention_id
          AND provenance.workspace_id=membership.workspace_id
        JOIN mentions root ON root.id=provenance.canonical_mention_id
          AND root.workspace_id=membership.workspace_id
        WHERE membership.workspace_id=$1
        GROUP BY membership.data_source_id
      ), imports AS (
        SELECT batch.data_source_id, count(*)::int AS import_count
        FROM import_batches batch WHERE batch.workspace_id=$1 GROUP BY batch.data_source_id
      ), watermarks AS (
        SELECT watermark.data_source_id, count(*)::int AS watermark_count,
          count(*) FILTER (WHERE watermark.data_freshness_state='fresh')::int AS fresh,
          count(*) FILTER (WHERE watermark.data_freshness_state='stale')::int AS stale,
          count(*) FILTER (WHERE watermark.data_freshness_state='partial')::int AS partial,
          count(*) FILTER (WHERE watermark.data_freshness_state IN ('not_available')
            OR watermark.source_freshness_state IN ('failed','not_available'))::int AS failed_or_na,
          max(watermark.max_observed_at)::text AS max_observed_at,
          max(watermark.materialized_at)::text AS max_materialized_at
        FROM signal_data_watermarks watermark WHERE watermark.workspace_id=$1
        GROUP BY watermark.data_source_id
      ), bindings AS (
        SELECT binding.data_source_id,
          count(*) FILTER (WHERE binding.status='active' AND binding.import_batch_id IS NULL)::int AS source_count,
          count(*) FILTER (WHERE binding.status='active' AND binding.import_batch_id IS NOT NULL)::int AS import_count
        FROM signal_provenance_policy_bindings binding WHERE binding.workspace_id=$1
        GROUP BY binding.data_source_id
      )
      SELECT source.id AS source_id, source.name AS source_name, source.source_type,
        source.provider, source.status, source.visibility,
        COALESCE(imports.import_count,0) AS import_count,
        COALESCE(roots.membership_rows,0) AS import_membership_rows,
        COALESCE(roots.root_count,0) AS canonical_root_count,
        COALESCE(roots.included_count,0) AS included_root_count,
        COALESCE(roots.no_quality_score,0) AS roots_without_quality_score,
        COALESCE(roots.with_quality_flags,0) AS roots_with_quality_flags,
        roots.min_quality_score, roots.max_quality_score,
        COALESCE(watermarks.watermark_count,0) AS watermark_count,
        COALESCE(watermarks.fresh,0) AS watermark_fresh,
        COALESCE(watermarks.stale,0) AS watermark_stale,
        COALESCE(watermarks.partial,0) AS watermark_partial,
        COALESCE(watermarks.failed_or_na,0) AS watermark_failed_or_na,
        watermarks.max_observed_at, watermarks.max_materialized_at,
        COALESCE(bindings.source_count,0) AS source_binding_count,
        COALESCE(bindings.import_count,0) AS import_override_count
      FROM target_sources source
      LEFT JOIN source_roots roots ON roots.data_source_id=source.id
      LEFT JOIN imports ON imports.data_source_id=source.id
      LEFT JOIN watermarks ON watermarks.data_source_id=source.id
      LEFT JOIN bindings ON bindings.data_source_id=source.id
      ORDER BY source.id
    `, [workspace.workspace_id]);

    const importResult = await client.query<{
      import_id: string;
      source_id: string;
      status: string;
      record_count: number;
      included_count: number;
      excluded_count: number;
      duplicate_count: number;
      membership_rows: number;
      canonical_root_count: number;
      active_override_count: number;
    }>(`
      SELECT batch.id AS import_id, batch.data_source_id AS source_id, batch.status,
        COALESCE(batch.record_count,0)::int AS record_count,
        COALESCE(batch.included_count,0)::int AS included_count,
        COALESCE(batch.excluded_count,0)::int AS excluded_count,
        COALESCE(batch.duplicate_count,0)::int AS duplicate_count,
        count(membership.id)::int AS membership_rows,
        count(DISTINCT root.id)::int AS canonical_root_count,
        count(DISTINCT binding.id) FILTER (WHERE binding.status='active')::int AS active_override_count
      FROM import_batches batch
      LEFT JOIN signal_mention_import_memberships membership ON membership.import_batch_id=batch.id
        AND membership.workspace_id=batch.workspace_id
      LEFT JOIN mentions provenance ON provenance.id=membership.mention_id
      LEFT JOIN mentions root ON root.id=provenance.canonical_mention_id
      LEFT JOIN signal_provenance_policy_bindings binding ON binding.import_batch_id=batch.id
        AND binding.workspace_id=batch.workspace_id
      WHERE batch.workspace_id=$1
      GROUP BY batch.id ORDER BY batch.id
    `, [workspace.workspace_id]);

    const watermarkResult = await client.query<{
      source_key: string;
      data_source_id: string | null;
      population_id: string | null;
      study_corpus_id: string | null;
      data_freshness_state: string;
      source_freshness_state: string;
      watermark_count: number;
      max_observed_at: string | null;
      max_materialized_at: string | null;
    }>(`
      SELECT watermark.source_key, watermark.data_source_id, watermark.population_id,
        watermark.study_corpus_id, watermark.data_freshness_state,
        watermark.source_freshness_state, count(*)::int AS watermark_count,
        max(watermark.max_observed_at)::text AS max_observed_at,
        max(watermark.materialized_at)::text AS max_materialized_at
      FROM signal_data_watermarks watermark WHERE watermark.workspace_id=$1
      GROUP BY watermark.source_key, watermark.data_source_id, watermark.population_id,
        watermark.study_corpus_id, watermark.data_freshness_state,
        watermark.source_freshness_state
      ORDER BY watermark.source_key, watermark.data_source_id, watermark.population_id
    `, [workspace.workspace_id]);

    const summary = (await client.query<{
      canonical_roots: number;
      included_roots: number;
      included_roots_without_provenance: number;
      quality_policies: number;
      retention_policies: number;
      licensing_policies: number;
      provenance_bindings: number;
      bundles: number;
      derivations: number;
      compilations: number;
      governed_bindings: number;
      data_watermarks: number;
      population_watermarks: number;
    }>(`
      WITH roots AS (
        SELECT mention.id, mention.inclusion_status FROM mentions mention
        WHERE mention.workspace_id=$1 AND mention.canonical_mention_id=mention.id
      )
      SELECT
        (SELECT count(*)::int FROM roots) AS canonical_roots,
        (SELECT count(*)::int FROM roots WHERE inclusion_status='included') AS included_roots,
        (SELECT count(*)::int FROM roots root WHERE root.inclusion_status='included'
          AND NOT EXISTS (
            SELECT 1 FROM mentions provenance
            JOIN signal_mention_import_memberships membership ON membership.mention_id=provenance.id
            WHERE provenance.workspace_id=$1 AND provenance.canonical_mention_id=root.id
          )) AS included_roots_without_provenance,
        (SELECT count(*)::int FROM signal_quality_policies WHERE workspace_id=$1) AS quality_policies,
        (SELECT count(*)::int FROM signal_retention_policies WHERE workspace_id=$1) AS retention_policies,
        (SELECT count(*)::int FROM signal_licensing_policies WHERE workspace_id=$1) AS licensing_policies,
        (SELECT count(*)::int FROM signal_provenance_policy_bindings WHERE workspace_id=$1) AS provenance_bindings,
        (SELECT count(*)::int FROM signal_population_policy_bundles WHERE workspace_id=$1) AS bundles,
        (SELECT count(*)::int FROM signal_governed_view_population_derivations WHERE workspace_id=$1) AS derivations,
        (SELECT count(*)::int FROM signal_population_policy_compilations WHERE workspace_id=$1) AS compilations,
        (SELECT count(*)::int FROM signal_governed_view_bindings WHERE workspace_id=$1) AS governed_bindings,
        (SELECT count(*)::int FROM signal_data_watermarks WHERE workspace_id=$1) AS data_watermarks,
        (SELECT count(*)::int FROM signal_data_watermarks WHERE workspace_id=$1 AND population_id IS NOT NULL)
          AS population_watermarks
    `, [workspace.workspace_id])).rows[0]!;

    const sources = sourceResult.rows.map((source) => {
      const carriesCurrentProvenance = source.canonical_root_count > 0;
      const missingOrNotApplicable = (present: boolean) => !carriesCurrentProvenance
        ? "not_applicable_no_current_provenance"
        : present ? "present" : "missing";
      return {
        ...source,
        source_key: sanitizedKey("source", source.source_id),
        carries_current_provenance: carriesCurrentProvenance,
        governance_decision_required: carriesCurrentProvenance,
        gaps: {
          quality_authority: missingOrNotApplicable(source.source_binding_count > 0),
          retention_authority: missingOrNotApplicable(source.source_binding_count > 0),
          licensing_authority: missingOrNotApplicable(source.source_binding_count > 0),
          provenance_binding: missingOrNotApplicable(source.source_binding_count > 0),
          watermark: missingOrNotApplicable(source.watermark_count > 0)
        },
        operator_decisions_required: carriesCurrentProvenance ? {
        quality: ["policy_key", "policy_version", "min_quality_score_or_null", "required_flags", "forbidden_flags"],
        retention: ["policy_key", "policy_version", "allowed_blocked_or_not_available", "retention_mode", "retain_until_or_null", "expiry_action", "approval_evidence"],
        licensing: MODULE_REQUIREMENTS.map((requirement) => ({
          module_key: requirement.module_key,
          view_key: requirement.view_key,
          usage_purposes: requirement.usage_purposes,
          decision_required_per_usage: true
        })),
        provenance: ["source_level_binding", "optional_explicit_import_exceptions"],
        watermark: source.watermark_count === 0 ? ["establish_population_evaluation_watermark"] : []
        } : null
      };
    });
    const qualityScores = sources
      .filter((source) => source.carries_current_provenance)
      .flatMap((source) => [source.min_quality_score, source.max_quality_score])
      .filter((value): value is number => value !== null);
    const observedQuality = {
      min: qualityScores.length > 0 ? Math.min(...qualityScores) : null,
      max: qualityScores.length > 0 ? Math.max(...qualityScores) : null,
      policy_threshold_contract_min: 0,
      policy_threshold_contract_max: 10,
      scale_compatible: qualityScores.length === 0 || Math.max(...qualityScores) <= 10
    };
    const manifest = {
      manifest_version: "signal-backend-04a-governance-decision-manifest-v1",
      generated_at: new Date().toISOString(),
      read_only: true,
      writes_performed: false,
      target: "noisia-staging",
      target_fingerprint: observedFingerprint,
      selection: {
        brand_slug: "laika",
        workspace_id: workspace.workspace_id,
        brand_id: workspace.brand_id,
        organization_id: workspace.organization_id,
        workspace_status: workspace.workspace_status,
        workspace_count: 1
      },
      module_requirements: MODULE_REQUIREMENTS,
      summary,
      observed_quality_contract: observedQuality,
      sources,
      imports: importResult.rows,
      watermarks: watermarkResult.rows,
      blockers: [
        "No active quality policy is bound to Laika provenance.",
        "No active retention policy is bound to Laika provenance.",
        "No active licensing decisions authorize any client module usage.",
        "No policy bundle, derived population, compilation or governed-view binding exists.",
        ...(summary.included_roots_without_provenance > 0
          ? ["Included canonical roots without import/source provenance cannot be authorized."]
          : []),
        ...(summary.population_watermarks === 0
          ? ["No population-scoped governance watermark exists for the future compilations."]
          : []),
        ...(!observedQuality.scale_compatible
          ? ["Observed mention quality scores exceed the 0-10 policy threshold contract; normalization or contract authority is undecided."]
          : [])
      ],
      acceptance: {
        ready_for_policy_load: false,
        ready_for_bundle_compile: false,
        ready_for_binding_or_promotion: false,
        requires_operator_decisions: true
      }
    };
    const sanitized = {
      ...manifest,
      selection: {
        brand_slug: "laika",
        workspace_key: sanitizedKey("workspace", workspace.workspace_id),
        workspace_status: workspace.workspace_status,
        workspace_count: 1
      },
      sources: sources.map(({ source_id, source_name, ...source }) => ({
        ...source,
        source_name_redacted: true
      })),
      imports: importResult.rows.map(({ import_id, source_id, ...batch }) => ({
        import_key: sanitizedKey("import", import_id),
        source_key: sanitizedKey("source", source_id),
        ...batch
      })),
      watermarks: watermarkResult.rows.map(({ data_source_id, population_id, study_corpus_id, ...watermark }) => ({
        ...watermark,
        data_source_key: data_source_id ? sanitizedKey("source", data_source_id) : null,
        population_key: population_id ? sanitizedKey("population", population_id) : null,
        study_corpus_key: study_corpus_id ? sanitizedKey("corpus", study_corpus_id) : null
      })),
      redaction: {
        ids_hashed: true,
        source_names_removed: true,
        mention_text_included: false,
        urls_handles_or_pii_included: false
      }
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await chmod(outputPath, 0o600);
    console.log(JSON.stringify(sanitized, null, 2));
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
