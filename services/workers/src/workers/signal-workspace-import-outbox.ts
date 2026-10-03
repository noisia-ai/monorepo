import { randomUUID } from "node:crypto";

import { pool } from "../db/client";
import { enqueueWorkspaceImportJobV1 } from "../queues/query-engine";

const POLL_MS = 2_000;
const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 8;

export function startSignalWorkspaceImportOutboxDrainer() {
  let closed = false;
  let running = false;
  const tick = async () => {
    if (closed || running) return;
    running = true;
    try {
      const claimed = await pool.query<ClaimedWorkspaceImport>(`
        SELECT outbox_id::text,lease_token::text,import_batch_id::text,
          workspace_id::text,worker_job_id,storage_bucket,storage_object_key,
          storage_part_count,storage_part_size_bytes::text,
          source_file_name,data_source_id::text,study_corpus_id::text,entity_label
        FROM claim_signal_workspace_import_dispatch_v1(10,$1,$2)
      `,[LEASE_SECONDS,MAX_ATTEMPTS]);
      for (const row of claimed.rows) await dispatch(row);
    } catch (error) {
      console.warn(`[workspace-import-outbox] claim failed: ${safeKind(error)}`);
    } finally { running=false; }
  };
  void tick();
  const timer = setInterval(() => void tick(),POLL_MS);
  return {
    close: async () => {
      closed=true;clearInterval(timer);
      while (running) await new Promise((resolve)=>setTimeout(resolve,25));
    }
  };
}

async function dispatch(row: ClaimedWorkspaceImport) {
  try {
    await enqueueWorkspaceImportJobV1({
      workspaceId: row.workspace_id,dataSourceId: row.data_source_id,
      corpusId: row.study_corpus_id,importBatchId: row.import_batch_id,
      sourceFileName: row.source_file_name ?? "workspace-import.csv",
      storageBucket: row.storage_bucket,storageObjectKey: row.storage_object_key,
      storagePartCount: row.storage_part_count,
      storagePartSizeBytes: Number(row.storage_part_size_bytes),
      entityLabel: row.entity_label
    },row.worker_job_id);
    await pool.query(
      "SELECT complete_signal_workspace_import_dispatch_v1($1::uuid,$2::uuid)",
      [row.outbox_id,row.lease_token]
    );
  } catch (error) {
    const retryAt = new Date(Date.now()+5_000+Math.floor(Math.random()*2_000));
    await pool.query(`
      SELECT fail_signal_workspace_import_dispatch_v1(
        $1::uuid,$2::uuid,$3,$4::jsonb,$5
      )
    `,[row.outbox_id,row.lease_token,retryAt,
      JSON.stringify({ kind: safeKind(error),attempt: randomUUID().slice(0,8) }),MAX_ATTEMPTS]
    ).catch((failure) => {
      console.warn(`[workspace-import-outbox] failure persistence failed: ${safeKind(failure)}`);
    });
  }
}

type ClaimedWorkspaceImport = {
  outbox_id: string;lease_token: string;import_batch_id: string;workspace_id: string;
  worker_job_id: string;storage_bucket: string;storage_object_key: string;
  storage_part_count: number;storage_part_size_bytes: string;
  source_file_name: string | null;data_source_id: string;study_corpus_id: string | null;
  entity_label: string | null;
};

function safeKind(error: unknown) {
  if (error && typeof error==="object" && "code" in error
      && typeof (error as { code?: unknown }).code==="string") {
    return `database_${(error as { code: string }).code}`;
  }
  return error instanceof Error ? error.name : "unknown_error";
}
