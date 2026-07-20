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
