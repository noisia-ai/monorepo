import type { Pool } from "pg";

/** A verified exact-file upload can reuse an acceptance without reparsing old canonical data. */
export async function completePreviouslyAcceptedWorkspaceImport(args: {
  pool: Pick<Pool, "connect">;
  importBatchId: string;
  workerJobId: string;
  verifiedHash: string;
  verifiedBytes: number;
}) {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    const accepted = (await client.query<{ id: string; record_count: number }>(`
      SELECT accepted.id::text,accepted.record_count
      FROM import_batches target JOIN import_batches accepted
        ON accepted.workspace_id=target.workspace_id AND accepted.data_source_id=target.data_source_id
        AND accepted.source_file_hash=$3 AND accepted.status='completed' AND accepted.id<>target.id
      WHERE target.id=$1::uuid AND target.worker_job_id=$2 AND target.status='processing'
        AND ((target.storage_source_import_batch_id IS NULL AND target.storage_content_hash IS NULL)
          OR target.storage_content_hash=$3)
        AND target.expected_file_size_bytes=$4::bigint
      ORDER BY accepted.completed_at,accepted.id LIMIT 1 FOR SHARE OF accepted
    `, [args.importBatchId, args.workerJobId, args.verifiedHash, args.verifiedBytes])).rows[0];
    if (!accepted) { await client.query("COMMIT"); return null; }
    const result = (await client.query<{ accepted: boolean; accepted_batch_id: string }>(`
      SELECT accepted,accepted_batch_id::text FROM complete_signal_workspace_import_v1(
        $1::uuid,$2,$3,$4,0,0,$4,$5
      )
    `, [args.importBatchId, args.workerJobId, args.verifiedHash, accepted.record_count, args.verifiedBytes])).rows[0];
    if (result?.accepted !== false || result.accepted_batch_id !== accepted.id) {
      throw new Error("Verified workspace import replay lost its accepted authority.");
    }
    await client.query("COMMIT");
    return {
      accepted: false as const,
      accepted_batch_id: accepted.id,
      stats: { record_count: accepted.record_count, included_count: 0, excluded_count: 0, duplicate_count: accepted.record_count }
    };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
