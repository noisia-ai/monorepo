import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import type { Job } from "bullmq";

import {
  createSignalSentioneCsvIngester,
  recordSignalDataAcceptance,
  recordSignalWorkspaceDataAcceptance
} from "@noisia/db";
import { pool } from "../db/client";
import { advanceCorpusRevision } from "./corpus-revision";
import { reconcileListeningDataOs } from "./listening-data-os";

type IngestMentionsCsvJobData = {
  workspaceId?: string;
  dataSourceId?: string;
  corpusId?: string | null;
  importBatchId: string;
  sourceFileName: string;
  storagePath?: string;
  storageBucket?: string;
  storageObjectKey?: string;
  storagePartCount?: number;
  storagePartSizeBytes?: number;
  entityLabel?: string | null;
  testFailAfterRecords?: number;
  testCrashAfterRecords?: number;
};

const { ingestSentioneCsvStream } = createSignalSentioneCsvIngester(pool);

export async function ingestMentionsCsvJob(job: Job<IngestMentionsCsvJobData>) {
  await job.updateProgress(5);
  const existingBatch = await pool.query<{
    workspace_id: string;
    data_source_id: string;
    study_corpus_id: string | null;
    status: string;
    record_count: number | null;
    included_count: number | null;
    excluded_count: number | null;
    duplicate_count: number | null;
    ingestion_phase: string;
    storage_bucket: string | null;
    storage_object_key: string | null;
    expected_file_size_bytes: string | number | null;
    storage_part_count: number | null;
    storage_part_size_bytes: string | number | null;
    processed_bytes: string | number;
    worker_job_id: string | null;
    supersedes_import_batch_id: string | null;
    storage_content_hash: string | null;
  }>(
    `
      SELECT workspace_id, data_source_id, study_corpus_id,
        status, record_count, included_count, excluded_count, duplicate_count,
        ingestion_phase,storage_bucket,storage_object_key,expected_file_size_bytes,
        storage_part_count,storage_part_size_bytes,processed_bytes,worker_job_id,
        supersedes_import_batch_id,storage_content_hash
      FROM import_batches
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [job.data.importBatchId]
  );
  const existing = existingBatch.rows[0];
  if (!existing) throw new Error("Import batch was not found.");
  const ingestion = {
    workspaceId: job.data.workspaceId ?? existing.workspace_id,
    dataSourceId: job.data.dataSourceId ?? existing.data_source_id,
    corpusId: job.data.corpusId ?? existing.study_corpus_id
  };
  if (existing.status === "completed" && existing.ingestion_phase !== "legacy") {
    // Async completion is atomic in complete_signal_workspace_import_v1: the
    // counters, acceptance, watermark, sync run, invalidation and outbox are
    // already durable. A late BullMQ replay must therefore be a pure read and
    // must not publish a second acceptance or advance a corpus revision.
    await job.updateProgress(100);
    return {
      import_batch_id: job.data.importBatchId,
      stats: {
        record_count: existing.record_count ?? 0,
        included_count: existing.included_count ?? 0,
        excluded_count: existing.excluded_count ?? 0,
        duplicate_count: existing.duplicate_count ?? 0
      },
      status: "completed",
      accepted: true,
      replayed: true
    };
  }
  if (existing?.status === "completed") {
    const dataOs = ingestion.corpusId
      ? await reconcileListeningDataOs({
          corpusId: ingestion.corpusId,
          importBatchId: job.data.importBatchId
        })
      : null;
    const acceptances = ingestion.corpusId
      ? await recordSignalDataAcceptance(pool, {
          studyCorpusId: ingestion.corpusId,
          sourceKey: "listening_csv",
          importBatchId: job.data.importBatchId,
          materializedAt: new Date()
        })
      : [];
    const workspaceAcceptance = await recordSignalWorkspaceDataAcceptance(pool, {
      workspaceId: ingestion.workspaceId,
      sourceKey: `source-${ingestion.dataSourceId}`,
      dataSourceId: ingestion.dataSourceId,
      importBatchId: job.data.importBatchId,
      materializedAt: new Date()
    });
    await job.updateProgress(100);
    return {
      import_batch_id: job.data.importBatchId,
      stats: {
        record_count: existing.record_count ?? 0,
        included_count: existing.included_count ?? 0,
        excluded_count: existing.excluded_count ?? 0,
        duplicate_count: existing.duplicate_count ?? 0
      },
      corpus_revision: null,
      data_os: dataOs,
      signal_data_acceptances: acceptances.length,
      workspace_data_acceptance: workspaceAcceptance,
      reconciliation_only: true
    };
  }

  if (existing.ingestion_phase !== "legacy") {
    return ingestWorkspaceAsyncImportJob(job,existing,ingestion);
  }

  await pool.query(
    `UPDATE import_batches SET status = 'processing' WHERE id = $1::uuid`,
    [job.data.importBatchId]
  );

  try {
    if (!job.data.storagePath) throw new Error("Legacy CSV storage path is required.");
    const webStream = Readable.toWeb(createReadStream(job.data.storagePath)) as unknown as ReadableStream<Uint8Array>;
    const { stats, fileHash: hash } = await ingestSentioneCsvStream({
      ...ingestion,
      importBatchId: job.data.importBatchId,
      sourceFileName: job.data.sourceFileName,
      entityLabel: job.data.entityLabel ?? null,
      stream: webStream,
      onProgress: async (progress) => {
        const pct = progress.record_count > 0 ? Math.min(90, 10 + Math.floor(progress.record_count / 5000)) : 10;
        await job.updateProgress(pct);
      }
    });

    await pool.query(
      `
        UPDATE import_batches
        SET record_count = $2,
            included_count = $3,
            excluded_count = $4,
            duplicate_count = $5,
            source_file_hash = $6,
            status = 'completed'
        WHERE id = $1::uuid
      `,
      [
        job.data.importBatchId,
        stats.record_count,
        stats.included_count,
        stats.excluded_count,
        stats.duplicate_count,
        hash
      ]
    );
    const persistedCount = stats.included_count + stats.excluded_count;
    const corpusRevision = persistedCount > 0 && ingestion.corpusId
      ? await advanceCorpusRevision(ingestion.corpusId)
      : null;
    const dataOs = ingestion.corpusId
      ? await reconcileListeningDataOs({
          corpusId: ingestion.corpusId,
          importBatchId: job.data.importBatchId
        })
      : null;
    const acceptances = ingestion.corpusId
      ? await recordSignalDataAcceptance(pool, {
          studyCorpusId: ingestion.corpusId,
          sourceKey: "listening_csv",
          importBatchId: job.data.importBatchId,
          corpusRevision,
          materializedAt: new Date()
        })
      : [];
    const workspaceAcceptance = await recordSignalWorkspaceDataAcceptance(pool, {
      workspaceId: ingestion.workspaceId,
      sourceKey: `source-${ingestion.dataSourceId}`,
      dataSourceId: ingestion.dataSourceId,
      importBatchId: job.data.importBatchId,
      materializedAt: new Date()
    });
    await job.updateProgress(100);
    return {
      import_batch_id: job.data.importBatchId,
      stats,
      corpus_revision: corpusRevision,
      data_os: dataOs,
      signal_data_acceptances: acceptances.length,
      workspace_data_acceptance: workspaceAcceptance,
      reconciliation_only: false
    };
  } catch (error) {
    await pool.query(
      `UPDATE import_batches SET status = 'failed' WHERE id = $1::uuid AND status <> 'completed'`,
      [job.data.importBatchId]
    );
    throw error;
  }
}

async function ingestWorkspaceAsyncImportJob(
  job: Job<IngestMentionsCsvJobData>,
  existing: {
    workspace_id: string;data_source_id: string;study_corpus_id: string | null;
    status: string;record_count: number | null;included_count: number | null;
    excluded_count: number | null;duplicate_count: number | null;
    ingestion_phase: string;storage_bucket: string | null;storage_object_key: string | null;
    expected_file_size_bytes: string | number | null;processed_bytes: string | number;
    storage_part_count: number | null;storage_part_size_bytes: string | number | null;
    worker_job_id: string | null;
    supersedes_import_batch_id: string | null;
    storage_content_hash: string | null;
  },
  ingestion: { workspaceId: string;dataSourceId: string;corpusId: string | null }
) {
  const workerJobId = String(job.id ?? existing.worker_job_id ?? "");
  if (!workerJobId || workerJobId!==existing.worker_job_id) {
    throw new Error("Workspace import worker identity mismatch.");
  }
  const begun = await pool.query<{ begun: boolean }>(
    "SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2) AS begun",
    [job.data.importBatchId,workerJobId]
  );
  if (begun.rows[0]?.begun===false) {
    await job.updateProgress(100);
    return {
      import_batch_id: job.data.importBatchId,
      status: "completed",
      replayed: true
    };
  }
  let lastRecords = 0;
  let lastBytes = 0;
  let parserMetrics: Record<string,unknown> | null=null;
  const processingStartedAt=performance.now();
  try {
    let storageVerificationMs: number | null=null;
    if (existing.supersedes_import_batch_id && !existing.storage_content_hash) {
      const verificationStartedAt=performance.now();
      const verified=await hashWorkspaceImportObjects(openWorkspaceImportObjects({
        bucket: job.data.storageBucket ?? existing.storage_bucket,
        objectPrefix: job.data.storageObjectKey ?? existing.storage_object_key,
        partCount: job.data.storagePartCount ?? existing.storage_part_count
      }));
      await pool.query(`
        SELECT seal_signal_workspace_import_storage_hash_v1($1::uuid,$2,$3,$4)
      `,[job.data.importBatchId,workerJobId,verified.contentHash,verified.sizeBytes]);
      storageVerificationMs=Math.round((performance.now()-verificationStartedAt)*1000)/1000;
    }
    const stream = openWorkspaceImportObjects({
      bucket: job.data.storageBucket ?? existing.storage_bucket,
      objectPrefix: job.data.storageObjectKey ?? existing.storage_object_key,
      partCount: job.data.storagePartCount ?? existing.storage_part_count
    });
    const expectedBytes = Number(existing.expected_file_size_bytes ?? 0);
    const { stats,fileHash,metrics } = await ingestSentioneCsvStream({
      ...ingestion,
      importBatchId: job.data.importBatchId,
      supersedesImportBatchId: existing.supersedes_import_batch_id,
      sourceFileName: job.data.sourceFileName,
      entityLabel: job.data.entityLabel ?? null,
      stream,
      onProgress: async (progress,processedBytes) => {
        lastRecords = progress.record_count;
        lastBytes = processedBytes;
        if (job.data.testFailAfterRecords
            && progress.record_count>=job.data.testFailAfterRecords) {
          throw new IntentionalWorkspaceImportAbort();
        }
        if (job.data.testCrashAfterRecords
            && progress.record_count>=job.data.testCrashAfterRecords) {
          throw new IntentionalWorkspaceWorkerCrash();
        }
        await pool.query(`
          SELECT record_signal_workspace_import_progress_v1($1::uuid,$2,$3,$4)
        `,[job.data.importBatchId,workerJobId,progress.record_count,processedBytes]);
        const pct = expectedBytes>0
          ? Math.min(99,Math.max(1,Math.floor((processedBytes/expectedBytes)*100)))
          : Math.min(99,10+Math.floor(progress.record_count/500));
        await job.updateProgress(pct);
      }
    });
    parserMetrics=metrics;
    const closureStartedAt=performance.now();
    const completion = await pool.query<{
      import_batch_id: string;accepted: boolean;accepted_batch_id: string;
    }>(`
      SELECT import_batch_id::text,accepted,accepted_batch_id::text
      FROM complete_signal_workspace_import_v1(
        $1::uuid,$2,$3,$4,$5,$6,$7,$8
      )
    `,[job.data.importBatchId,workerJobId,fileHash,stats.record_count,
      stats.included_count,stats.excluded_count,stats.duplicate_count,lastBytes]);
    const closureMs=performance.now()-closureStartedAt;
    await pool.query(`
      SELECT record_signal_workspace_import_metrics_v1($1::uuid,$2,$3::jsonb)
    `,[job.data.importBatchId,workerJobId,JSON.stringify({
      ...metrics,
      closure_ms: Math.round(closureMs*1000)/1000,
      worker_total_ms: Math.round((performance.now()-processingStartedAt)*1000)/1000,
      persistence_mode: "set-based-chunk-v1",
      row_fallback_count: 0,
      storage_verification_ms: storageVerificationMs
    })]);
    const accepted = completion.rows[0]?.accepted===true;
    let corpusRevision: number | null = null;
    let dataOs: unknown = null;
    let acceptanceCount = 0;
    if (accepted && ingestion.corpusId) {
      const persistedCount = stats.included_count+stats.excluded_count;
      corpusRevision = persistedCount>0 ? await advanceCorpusRevision(ingestion.corpusId) : null;
      dataOs = await reconcileListeningDataOs({
        corpusId: ingestion.corpusId,importBatchId: job.data.importBatchId
      });
      const acceptances = await recordSignalDataAcceptance(pool,{
        studyCorpusId: ingestion.corpusId,
        sourceKey: `source-${ingestion.dataSourceId}`,
        dataSourceId: ingestion.dataSourceId,
        importBatchId: job.data.importBatchId,
        corpusRevision,materializedAt: new Date()
      });
      acceptanceCount = acceptances.length;
    }
    await job.updateProgress(100);
    return {
      import_batch_id: job.data.importBatchId,
      accepted_batch_id: completion.rows[0]?.accepted_batch_id ?? null,
      accepted,stats,corpus_revision: corpusRevision,data_os: dataOs,
      signal_data_acceptances: acceptanceCount,
      workspace_data_acceptance: accepted
    };
  } catch (error) {
    // A real process loss cannot persist a failure. The durable batch remains
    // processing and the deterministic BullMQ identity may resume it. This
    // branch is reachable only from the local rehearsal-only job field.
    if (error instanceof IntentionalWorkspaceWorkerCrash) throw error;
    const failureCode = error instanceof IntentionalWorkspaceImportAbort
      ? "intentional_rehearsal_abort" : classifyImportFailure(error);
    if (parserMetrics) {
      await pool.query(`
        SELECT record_signal_workspace_import_metrics_v1($1::uuid,$2,$3::jsonb)
      `,[job.data.importBatchId,workerJobId,JSON.stringify({
        ...parserMetrics,
        closure_failed: true,
        worker_total_ms: Math.round((performance.now()-processingStartedAt)*1000)/1000,
        persistence_mode: "set-based-chunk-v1",
        row_fallback_count: 0
      })]).catch(() => undefined);
    }
    await pool.query(`
      SELECT fail_signal_workspace_import_v1($1::uuid,$2,$3,$4::jsonb,$5,$6)
    `,[job.data.importBatchId,workerJobId,failureCode,
      JSON.stringify({ kind: failureCode,recoverable: true }),lastRecords,lastBytes]);
    throw error;
  }
}

async function hashWorkspaceImportObjects(stream: ReadableStream<Uint8Array>) {
  const hash=createHash("sha256");let sizeBytes=0;
  const reader=stream.getReader();
  try {
    while (true) {
      const { done,value }=await reader.read();
      if (done) break;
      if (!value) continue;
      sizeBytes+=value.byteLength;hash.update(value);
    }
  } finally { reader.releaseLock(); }
  return { sizeBytes,contentHash: hash.digest("hex") };
}

function openWorkspaceImportObjects(args: {
  bucket: string | null;objectPrefix: string | null;partCount: number | null;
}) {
  const baseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/u,"");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceRoleKey || !args.bucket || !args.objectPrefix
      || !Number.isSafeInteger(args.partCount) || !args.partCount || args.partCount<1) {
    throw new Error("Workspace import storage is unavailable.");
  }
  const encoded = (value: string) => value.split("/").map(encodeURIComponent).join("/");
  const headers = {
    apikey: serviceRoleKey,
    ...(serviceRoleKey.startsWith("eyJ") ? { Authorization: `Bearer ${serviceRoleKey}` } : {})
  };
  let partNumber = 1;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            if (partNumber>args.partCount!) { controller.close();return; }
            const objectKey = `${args.objectPrefix}.part-${String(partNumber).padStart(5,"0")}`;
            const response = await fetch(
              `${baseUrl}/storage/v1/object/authenticated/${encoded(args.bucket!)}/${encoded(objectKey)}`,
              { headers }
            );
            if (!response.ok || !response.body) {
              throw new Error(`Workspace import object unavailable (${response.status}).`);
            }
            reader=response.body.getReader();partNumber+=1;
          }
          const next = await reader.read();
          if (next.done) { reader.releaseLock();reader=null;continue; }
          controller.enqueue(next.value);return;
        }
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) {
      await reader?.cancel(reason).catch(() => undefined);
      reader=null;
    }
  });
}

function classifyImportFailure(error: unknown) {
  if (error instanceof Error && /storage|object unavailable/iu.test(error.message)) {
    return "storage_read_failed";
  }
  if (error instanceof Error && /CSV|delimiter|header|date/iu.test(error.message)) {
    return "csv_validation_failed";
  }
  return "processing_failed";
}

class IntentionalWorkspaceImportAbort extends Error {
  constructor() { super("Intentional workspace import rehearsal abort."); }
}

class IntentionalWorkspaceWorkerCrash extends Error {
  constructor() { super("Intentional workspace import worker crash rehearsal."); }
}
