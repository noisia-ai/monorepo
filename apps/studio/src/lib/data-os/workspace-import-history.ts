import { pool } from "@/lib/db";
import { listWorkspaceImportsV1, WorkspaceAsyncImportError } from "./workspace-async-import";

export type WorkspaceImportHistoryCountersV1 = {
  attempt_count: number; completed_count: number; failed_count: number; already_imported_count: number;
  uploading_count: number; processing_count: number;
  records: number; included: number; excluded: number; duplicates: number;
  last_import_at: string | null;
};
type SummaryRow = WorkspaceImportHistoryCountersV1 & { slot_key: string | null; is_total: boolean };

export function parseWorkspaceImportHistoryPageV1(params: URLSearchParams) {
  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  const cursor = params.get("cursor");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || (cursor !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(cursor))) {
    throw new WorkspaceAsyncImportError("invalid_history_page", 422);
  }
  return { limit, cursor };
}

export async function loadWorkspaceAcquisitionImportHistoryV1(args: {
  workspaceId: string; sourceId: string | null; slotKey: string | null; limit: number; cursor: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (args.cursor) {
      const boundary = await client.query(`
        SELECT batch.id FROM import_batches batch
        JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=batch.workspace_id
        JOIN signal_acquisition_slots slot ON slot.id=batch.acquisition_slot_id AND slot.workspace_id=batch.workspace_id
        WHERE batch.workspace_id=$1::uuid AND batch.id=$2::uuid
          AND ($3::uuid IS NULL OR batch.data_source_id=$3::uuid)
          AND ($4::text IS NULL OR slot.slot_key=$4)
          AND batch.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2')
          AND source.source_contract_version='signal-data-source-connector-v1'
      `, [args.workspaceId, args.cursor, args.sourceId, args.slotKey]);
      if (!boundary.rows[0]) throw new WorkspaceAsyncImportError("invalid_history_page", 422);
    }
    const rows = await listWorkspaceImportsV1({ ...args, acquisitionOnly: true, queryable: client, limit: args.limit + 1 });
    const summaries = await client.query<SummaryRow>(`
      SELECT slot.slot_key, GROUPING(slot.slot_key)=1 is_total,
        count(*)::int attempt_count,
        count(*) FILTER(WHERE batch.status='completed')::int completed_count,
        count(*) FILTER(WHERE batch.status='failed' AND batch.failure_code IS DISTINCT FROM 'content_already_accepted')::int failed_count,
        count(*) FILTER(WHERE batch.status='failed' AND batch.failure_code='content_already_accepted')::int already_imported_count,
        count(*) FILTER(WHERE batch.status='queued' AND batch.ingestion_phase='uploading')::int uploading_count,
        count(*) FILTER(WHERE batch.status='processing' OR (batch.status='queued' AND batch.ingestion_phase<>'uploading'))::int processing_count,
        COALESCE(sum(batch.record_count) FILTER(WHERE batch.status='completed'),0)::float8 records,
        COALESCE(sum(batch.included_count) FILTER(WHERE batch.status='completed'),0)::float8 included,
        COALESCE(sum(batch.excluded_count) FILTER(WHERE batch.status='completed'),0)::float8 excluded,
        COALESCE(sum(batch.duplicate_count) FILTER(WHERE batch.status='completed'),0)::float8 duplicates,
        to_char(max(batch.created_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') last_import_at
      FROM import_batches batch
      JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=batch.workspace_id
      LEFT JOIN signal_acquisition_slots slot ON slot.id=batch.acquisition_slot_id AND slot.workspace_id=batch.workspace_id
      WHERE batch.workspace_id=$1::uuid AND ($2::uuid IS NULL OR batch.data_source_id=$2::uuid)
        AND ($3::text IS NULL OR slot.slot_key=$3)
        AND batch.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2')
        AND source.source_contract_version='signal-data-source-connector-v1'
      GROUP BY GROUPING SETS ((slot.slot_key),())
      ORDER BY GROUPING(slot.slot_key),slot.slot_key
    `, [args.workspaceId, args.sourceId, args.slotKey]);
    await client.query("COMMIT");
    const imports = rows.slice(0, args.limit);
    return {
      imports,
      next_cursor: rows.length > args.limit ? imports.at(-1)!.id : null,
      summary: {
        slots: summaries.rows.filter(row => !row.is_total).map(row => ({ slot_key: row.slot_key, ...withoutGrouping(row) })),
        totals: withoutGrouping(summaries.rows.find(row => row.is_total)!)
      }
    };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

function withoutGrouping(row: SummaryRow): WorkspaceImportHistoryCountersV1 {
  return {
    attempt_count: row.attempt_count, completed_count: row.completed_count, failed_count: row.failed_count,
    already_imported_count: row.already_imported_count, uploading_count: row.uploading_count,
    processing_count: row.processing_count, records: row.records, included: row.included,
    excluded: row.excluded, duplicates: row.duplicates, last_import_at: row.last_import_at
  };
}
