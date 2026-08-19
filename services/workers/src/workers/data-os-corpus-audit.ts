import type { PoolClient } from "pg";

import {
  auditDataOsCorpus as auditDataOsCorpusContract,
  type DataOsCorpusAudit,
  type DataOsCorpusAuditStage,
  type DataOsSqlExecutor
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { dataOsAuditGateName, dataOsAuditMetaKey } from "./data-os-audit-gate";

export {
  assertCorpusDataOsAuditReady,
  dataOsAuditGateName,
  summarizeCorpusDataOsAudit
} from "./data-os-audit-gate";

export async function auditCorpusDataOs(args: {
  corpusId: string;
  stage?: DataOsCorpusAuditStage;
  tbAnalysisId?: string | null;
}): Promise<DataOsCorpusAudit> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await auditDataOsCorpusContract(asExecutor(client), args);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Workspace-native T&B runs audit the frozen membership itself. The legacy
 * corpus audit remains available for corpus launch compatibility, but its
 * corpus-wide listening totals must never influence a strategic run.
 */
export async function auditStrategicSnapshotDataOs(args: {
  tbAnalysisId: string;
  stage?: DataOsCorpusAuditStage;
}): Promise<DataOsCorpusAudit> {
  const result = await pool.query<{
    total_records: number;
    invalid_text: number;
    invalid_date: number;
    noncanonical: number;
    completed_imports: number;
    platforms: number;
    covered_months: number;
    coverage_start: string | null;
    coverage_end: string | null;
  }>(
    `SELECT
       count(*)::integer AS total_records,
       count(*) FILTER (WHERE NULLIF(btrim(mention.text_clean), '') IS NULL)::integer AS invalid_text,
       count(*) FILTER (WHERE mention.published_at IS NULL)::integer AS invalid_date,
       count(*) FILTER (WHERE mention.canonical_mention_id <> mention.id)::integer AS noncanonical,
       count(DISTINCT import_membership.import_batch_id)::integer AS completed_imports,
       count(DISTINCT COALESCE(mention.resolved_platform, mention.platform))::integer AS platforms,
       count(DISTINCT date_trunc('month', mention.published_at))::integer AS covered_months,
       min(mention.published_at)::text AS coverage_start,
       max(mention.published_at)::text AS coverage_end
     FROM tb_analyses analysis
     JOIN corpus_snapshot_mentions membership ON membership.snapshot_id = analysis.snapshot_id
     JOIN mentions mention ON mention.id = membership.mention_id
     LEFT JOIN signal_strategic_run_controls control
       ON control.tb_analysis_id=analysis.id
      AND analysis.strategic_contract_version='signal-tb-strategic-v2'
     LEFT JOIN signal_strategic_sealed_sample_items sealed
       ON sealed.run_control_id=control.id AND sealed.mention_id=mention.id
     LEFT JOIN signal_mention_import_memberships import_membership
       ON import_membership.workspace_id = analysis.workspace_id
      AND import_membership.mention_id = mention.id
     WHERE analysis.id = $1::uuid
       AND analysis.strategic_contract_version IN ('signal-tb-strategic-v1','signal-tb-strategic-v2')
       AND (analysis.strategic_contract_version<>'signal-tb-strategic-v2'
         OR sealed.mention_id IS NOT NULL)
       AND (analysis.strategic_contract_version<>'signal-tb-strategic-v2' OR EXISTS (
         SELECT 1 FROM signal_mention_attributions semantic
         WHERE semantic.workspace_id=analysis.workspace_id
           AND semantic.mention_id=mention.id
           AND semantic.attribution_basis='mention_semantic'
           AND semantic.is_current=true
           AND semantic.review_status='approved'
           AND semantic.eligibility_status='eligible'
       ))`,
    [args.tbAnalysisId]
  );
  const row = result.rows[0];
  const total = Number(row?.total_records ?? 0);
  const issues = [
    total === 0 ? { code: "snapshot_empty", message: "The frozen strategic snapshot is empty.", count: 0 } : null,
    Number(row?.invalid_text ?? 0) > 0
      ? { code: "snapshot_text_missing", message: "Frozen mentions are missing canonical text.", count: Number(row?.invalid_text) }
      : null,
    Number(row?.invalid_date ?? 0) > 0
      ? { code: "snapshot_date_missing", message: "Frozen mentions are missing a publication date.", count: Number(row?.invalid_date) }
      : null,
    Number(row?.noncanonical ?? 0) > 0
      ? { code: "snapshot_noncanonical", message: "The snapshot contains alias mention rows.", count: Number(row?.noncanonical) }
      : null
  ].filter((issue): issue is NonNullable<typeof issue> => issue !== null);
  const stage = args.stage ?? "pre_analysis";
  return {
    contract: "noisia_data_os_corpus_audit_v1",
    stage,
    status: issues.length > 0 ? "blocked" : "ready",
    ready_for_claude: issues.length === 0,
    blockers: issues,
    warnings: [],
    corpus: {
      exists: total > 0,
      total_records: total,
      included_records: total,
      excluded_records: 0,
      other_records: 0,
      completed_imports: Number(row?.completed_imports ?? 0),
      duplicate_records: 0,
      ingestion_deduplicated_records: 0,
      covered_months: Number(row?.covered_months ?? 0),
      platforms: Number(row?.platforms ?? 0),
      coverage_start: row?.coverage_start ?? null,
      coverage_end: row?.coverage_end ?? null
    },
    catalog: {
      listening_sources: 0,
      listening_assets: 0,
      listening_asset_rows: total,
      active_contracts: 0,
      canonical_fields: 0,
      active_quality_rules: 0,
      quality_results: 0,
      failed_quality_results: 0,
      warning_quality_results: 0,
      source_asset_lineage: 0,
      source_sync_lineage: 0,
      import_asset_lineage: 0,
      import_source_lineage: 0,
      tb_taxonomy_terms: 0,
      tb_required_bindings: 0
    },
    observations: {
      total: 0,
      accepted: 0,
      review_required: 0,
      rejected: 0,
      listening: 0,
      represented_listening_records: total,
      represented_listening_value: total,
      invalid_currency_contract: 0,
      invalid_unit_contract: 0,
      unknown_metric_family: 0,
      invalid_count_value: 0,
      invalid_ratio_value: 0,
      invalid_duration_value: 0,
      invalid_period_contract: 0,
      invalid_metric_mapping: 0,
      invalid_product_catalog_time: 0
    },
    source_materializations: {
      uploaded_sources: 0,
      processed_sources: 0,
      pending_sources: 0,
      failed_sources: 0,
      canonical_records: total,
      accepted_records: total,
      review_records: 0,
      rejected_records: 0,
      accepted_observations: 0,
      warning_quality_results: 0,
      failed_quality_results: 0,
      sources: []
    },
    capabilities: [],
    tb_bridge: {
      analysis_found: true,
      counts: {
        codings: 0,
        coded_mentions: 0,
        non_irrelevant_mentions: 0,
        ambiguous_mentions: 0,
        missing_layer_mentions: 0,
        missing_emergent_tag_mentions: 0,
        unlinked_finding_mentions: 0,
        record_features: 0,
        feature_lineage_edges: 0,
        polarity_tagged_mentions: 0,
        layer_tagged_mentions: 0,
        record_tags: 0,
        emergent_candidate_tags: 0,
        tag_lineage_edges: 0,
        lineage_edges: 0
      },
      quality: null
    }
  };
}

export async function persistCorpusDataOsAudit(args: {
  tbAnalysisId: string;
  audit: DataOsCorpusAudit;
}): Promise<void> {
  const { tbAnalysisId, audit } = args;
  const gateName = dataOsAuditGateName(audit.stage);
  const blockerSummary = audit.blockers.map((issue) => issue.code).join(", ");
  const warningSummary = audit.warnings.map((issue) => issue.code).join(", ");
  const notes = [
    `${audit.contract}: ${audit.status}`,
    blockerSummary ? `blockers=${blockerSummary}` : "blockers=none",
    warningSummary ? `warnings=${warningSummary}` : "warnings=none"
  ].join(" · ").slice(0, 500);

  await pool.query(
    `INSERT INTO tb_quality_gates (tb_analysis_id, gate_name, passed, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tb_analysis_id, gate_name)
     DO UPDATE SET passed = EXCLUDED.passed, notes = EXCLUDED.notes, checked_at = NOW()`,
    [tbAnalysisId, gateName, audit.ready_for_claude, notes]
  );

  // Preserve the original preflight gate for existing Studio readers while
  // exposing stage-specific gates for coding and release readiness.
  if (audit.stage === "pre_analysis") {
    await pool.query(
      `INSERT INTO tb_quality_gates (tb_analysis_id, gate_name, passed, notes)
       VALUES ($1, 'data_os_contract', $2, $3)
       ON CONFLICT (tb_analysis_id, gate_name)
       DO UPDATE SET passed = EXCLUDED.passed, notes = EXCLUDED.notes, checked_at = NOW()`,
      [tbAnalysisId, audit.ready_for_claude, notes]
    );
  }

  const metaKey = dataOsAuditMetaKey(audit.stage);
  await pool.query(
    `UPDATE tb_analyses
     SET meta_json = jsonb_set(
           jsonb_set(
             COALESCE(meta_json, '{}'::jsonb),
             '{data_os_audits}',
             COALESCE(meta_json->'data_os_audits', '{}'::jsonb)
               || jsonb_build_object($2::text, $3::jsonb),
             true
           ),
           ARRAY[$4::text],
           $3::jsonb,
           true
         ),
         updated_at = NOW()
     WHERE id = $1`,
    [tbAnalysisId, audit.stage, JSON.stringify(audit), metaKey]
  );
}

function asExecutor(client: PoolClient): DataOsSqlExecutor {
  return async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
    const result = await client.query(sql, params);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount
    };
  };
}
