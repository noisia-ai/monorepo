import type { PoolClient } from "pg";

import {
  reconcileListeningDataOs as reconcileListeningDataOsContract,
  type DataOsSqlExecutor,
  type ListeningDataOsReconciliation
} from "@noisia/query-engine";
import { pool } from "../db/client";

export async function reconcileListeningDataOs(params: {
  corpusId: string;
  importBatchId?: string | null;
}): Promise<ListeningDataOsReconciliation> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await reconcileListeningDataOsContract(asExecutor(client), params);
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
