import type { PoolClient } from "pg";

import {
  auditDataOsCorpus as auditDataOsCorpusContract,
  type DataOsCorpusAudit,
  type DataOsCorpusAuditStage,
  type DataOsSqlExecutor
} from "@noisia/query-engine";
import { pool } from "@/lib/db";

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

function asExecutor(client: PoolClient): DataOsSqlExecutor {
  return async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
    const result = await client.query(sql, params);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount
    };
  };
}
