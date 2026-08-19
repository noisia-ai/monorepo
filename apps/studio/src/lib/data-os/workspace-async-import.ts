import { createHash,randomUUID } from "node:crypto";

import {
  SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION,
  SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION,
  signalAcquisitionImportSealDigestV2,
  type SignalAcquisitionQueryUnavailableReasonV2
} from "@noisia/query-engine";

import type { ResolvedSignalWorkspace,SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import { loadSignalAcquisitionPlanV1 } from "@/lib/data-os/signal-acquisition-plan";
import { pool } from "@/lib/db";
import {
  createWorkspaceImportSignedUploadsV1,
  resolveWorkspaceImportStorageV1,
  statWorkspaceImportObjectV1,
  uploadWorkspaceImportMultipartStreamV1,
  type WorkspaceImportUploadAuthorityV1,
  WORKSPACE_IMPORT_PART_BYTES,
  workspaceImportObjectKeyV1
} from "@/lib/data-os/workspace-import-storage";

type WorkspaceImportCreationStorageV1={
  resolve:()=>{bucket:string};
  createSignedUploads:(args:{objectPrefix:string;fileSizeBytes:number})=>Promise<WorkspaceImportUploadAuthorityV1>;
};

export const WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION = "signal-workspace-async-import-v1";

export type WorkspaceAsyncImportStatusV1 =
  | "queued" | "processing" | "completed" | "failed";

export async function resolveWorkspaceConnectorByKeyV1(workspaceId:string,sourceKey:string){
  if(!/^source-sha256-[0-9a-f]{64}$/u.test(sourceKey))return null;
  const result=await pool.query<{id:string;source_key:string}>(`
    SELECT id::text,source_key FROM data_sources
    WHERE workspace_id=$1::uuid AND source_key=$2
      AND source_contract_version='signal-data-source-connector-v1' AND status='active'
  `,[workspaceId,sourceKey]);
  return result.rows[0]??null;
}

export async function resolveWorkspaceImportConnectorV1(workspaceId:string,importBatchId:string){
  const result=await pool.query<{id:string;source_key:string}>(`
    SELECT source.id::text,source.source_key
    FROM import_batches batch JOIN data_sources source ON source.id=batch.data_source_id
      AND source.workspace_id=batch.workspace_id
    WHERE batch.workspace_id=$1::uuid AND batch.id=$2::uuid
      AND batch.acquisition_contract_version IN ('signal-acquisition-import-v1','signal-acquisition-import-v2')
      AND source.source_contract_version='signal-data-source-connector-v1'
  `,[workspaceId,importBatchId]);
  return result.rows[0]??null;
}

export async function createWorkspaceImportUploadV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  sourceId: string;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
  contributedByStudyCorpusId: string | null;
  supersedesImportBatchId: string | null;
  idempotencyKey: string;
  acquisition?: {
    sourceKey: string;slotKey: string;
    queryEvidence:
      | { class:"operator_attested";queryVersion:number;reason:null }
      | { class:"unavailable";queryVersion:null;reason:SignalAcquisitionQueryUnavailableReasonV2 }
      | { class:"provider_verified";queryVersion:number;reason:null;
          providerExecutionReferenceHash:string;providerExecutionAdapterKey:"sentione-server-api-v1" };
    period: { start: string;end: string;timezone: string };
  } | null;
  storage?:WorkspaceImportCreationStorageV1;
}) {
  validateFile(args.fileName,args.fileSizeBytes,args.contentType);
  const idempotencyHash = hashValue(args.idempotencyKey);
  const batchId = randomUUID();
  const objectKey = workspaceImportObjectKeyV1({
    workspaceId: args.workspace.id,importBatchId: batchId,fileName: args.fileName
  });
  const requestDigest = hashValue(stable({
    action: "create-workspace-import-upload",
    workspace_id: args.workspace.id,
    source_id: args.sourceId,
    file_name: args.fileName,
    file_size_bytes: args.fileSizeBytes,
    content_type: args.contentType,
    contributed_by_study_corpus_id: args.contributedByStudyCorpusId,
    supersedes_import_batch_id: args.supersedesImportBatchId,
    acquisition: args.acquisition ?? null
  }));
  // Resolve only the server-owned bucket before the transaction. The signed
  // upload authority is minted after the workspace/source/idempotency row is
  // durable, so rejected or replayed requests cannot leave orphan upload
  // grants for an unpersisted batch identity.
  const storage = args.storage?.resolve()??resolveWorkspaceImportStorageV1();
  const client = await pool.connect();
  let persistedId: string = batchId;
  let replayed = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
      `workspace-import:${args.workspace.id}:${idempotencyHash}`
    ]);
    const sourceResult = await client.query<{
      provider: string;name: string;governed_scope: string | null;
      governed_entity_id: string | null;status: string;scope_review_status: string;
      source_key: string;source_contract_version: string;
    }>(`
      SELECT provider,name,governed_scope,governed_entity_id,status,scope_review_status,
        source_key,source_contract_version
      FROM data_sources
      WHERE id=$1::uuid AND workspace_id=$2::uuid
      FOR SHARE
    `,[args.sourceId,args.workspace.id]);
    const source = sourceResult.rows[0];
    const targetAcquisition = args.acquisition ?? null;
    if (!source || source.status!=="active"
        || (targetAcquisition
          ? source.source_contract_version!=="signal-data-source-connector-v1"
            || source.source_key!==targetAcquisition.sourceKey
          : !source.governed_scope || source.scope_review_status!=="approved")) {
      throw new WorkspaceAsyncImportError("source_not_ready",409);
    }
    if(targetAcquisition){
      const readiness=await loadSignalAcquisitionPlanV1({
        queryable:client,workspace:args.workspace,actor:args.actor
      });
      if(readiness.state!=="current")throw new WorkspaceAsyncImportError("acquisition_plan_stale",409);
    }
    const queryVersion=targetAcquisition?.queryEvidence.queryVersion??null;
    const acquisition = targetAcquisition ? await client.query<{
      plan_id:string;slot_id:string;query_id:string|null;plan_digest:string;slot_digest:string;
      query_digest:string|null;brand_os_digest:string;catalog_digest:string;provider_schema_version:string;
    }>(`
      SELECT plan.id::text plan_id,slot.id::text slot_id,query.id::text query_id,
        plan.definition_hash plan_digest,slot.definition_hash slot_digest,
        query.definition_hash query_digest,plan.brand_os_digest,
        plan.identity_catalog_digest catalog_digest,
        COALESCE(query.provider_schema_version,'sentione-csv-47-v1') provider_schema_version
      FROM signal_acquisition_plans plan
      JOIN LATERAL(SELECT * FROM signal_acquisition_slots candidate
        WHERE candidate.plan_id=plan.id AND candidate.slot_key=$2
        ORDER BY candidate.slot_version DESC LIMIT 1) slot ON slot.desired_state='active'
      LEFT JOIN signal_acquisition_query_versions query ON query.plan_id=plan.id AND query.slot_id=slot.id
        AND query.query_version=$3 AND query.data_source_id=$4::uuid AND query.status='current'
      WHERE plan.workspace_id=$1::uuid AND plan.status='current'
        AND ($3::int IS NULL OR query.id IS NOT NULL)
        AND ($3::int IS NULL OR $5::date>=COALESCE(query.default_period_start,$5::date))
        AND ($3::int IS NULL OR $6::date<=COALESCE(query.default_period_end,$6::date))
        AND EXISTS(SELECT 1 FROM signal_provenance_policy_bindings binding
          JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id AND quality.status='active'
            AND quality.effective_from<=clock_timestamp()
            AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
          JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
            AND retention.status='active' AND retention.effective_from<=clock_timestamp()
            AND (retention.effective_to IS NULL OR retention.effective_to>clock_timestamp())
            AND (retention.retain_until IS NULL OR retention.retain_until>clock_timestamp())
          JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id AND licensing.status='active'
            AND licensing.effective_from<=clock_timestamp()
            AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp())
          WHERE binding.workspace_id=plan.workspace_id AND binding.data_source_id=$4::uuid
            AND binding.import_batch_id IS NULL AND binding.status='active'
            AND binding.effective_from<=clock_timestamp()
            AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp()))
      FOR SHARE OF plan,slot
    `,[args.workspace.id,targetAcquisition.slotKey,queryVersion,args.sourceId,
      targetAcquisition.period.start,targetAcquisition.period.end]) : null;
    const acquisitionRow=acquisition?.rows[0]??null;
    if(targetAcquisition&&!acquisitionRow)throw new WorkspaceAsyncImportError("acquisition_authority_unavailable",409);
    if(targetAcquisition?.queryEvidence.class==="provider_verified"
      && (!/^sha256:[0-9a-f]{64}$/u.test(targetAcquisition.queryEvidence.providerExecutionReferenceHash)
        || targetAcquisition.queryEvidence.providerExecutionAdapterKey!=="sentione-server-api-v1")) {
      throw new WorkspaceAsyncImportError("provider_execution_evidence_required",422);
    }
    const attestedAt=targetAcquisition ? new Date().toISOString() : null;
    const importSealDigest=targetAcquisition&&acquisitionRow&&attestedAt
      ? signalAcquisitionImportSealDigestV2({
          contract_version:SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION,
          source_key:targetAcquisition.sourceKey,slot_key:targetAcquisition.slotKey,
          query_evidence_class:targetAcquisition.queryEvidence.class,
          query_version:targetAcquisition.queryEvidence.queryVersion,
          query_evidence_reason:targetAcquisition.queryEvidence.reason,
          provider_execution_reference_hash:targetAcquisition.queryEvidence.class==="provider_verified"
            ? targetAcquisition.queryEvidence.providerExecutionReferenceHash:null,
          operator_actor_ref_hash:hashValue(args.actor.id),operator_attested_at:attestedAt,
          capture_period_start:targetAcquisition.period.start,
          capture_period_end:targetAcquisition.period.end,capture_timezone:targetAcquisition.period.timezone,
          plan_digest:acquisitionRow.plan_digest,slot_digest:acquisitionRow.slot_digest,
          query_digest:acquisitionRow.query_digest,brand_os_digest:acquisitionRow.brand_os_digest,
          identity_catalog_digest:acquisitionRow.catalog_digest,
          provider_schema_version:SIGNAL_SENTIONE_PROVIDER_SCHEMA_VERSION
        }) : null;
    if (targetAcquisition) await client.query(`
      INSERT INTO signal_governance_control_operations(
        workspace_id,actor_user_id,action,request_digest,idempotency_key,status
      ) VALUES($1::uuid,$2::uuid,'seal-acquisition-import',$3,$4,'in_progress')
      ON CONFLICT(workspace_id,idempotency_key) DO NOTHING
    `,[args.workspace.id,args.actor.id,requestDigest,idempotencyHash]);
    const acquisitionOperation = targetAcquisition ? await client.query<{
      id:string;action:string;request_digest:string;actor_user_id:string;status:string;
    }>(`
      SELECT id::text,action,request_digest,actor_user_id::text,status
      FROM signal_governance_control_operations
      WHERE workspace_id=$1::uuid AND idempotency_key=$2 FOR UPDATE
    `,[args.workspace.id,idempotencyHash]) : null;
    const acquisitionOperationRow=acquisitionOperation?.rows[0]??null;
    if(targetAcquisition && (!acquisitionOperationRow
      || acquisitionOperationRow.action!=="seal-acquisition-import"
      || acquisitionOperationRow.request_digest!==requestDigest
      || acquisitionOperationRow.actor_user_id!==args.actor.id)) {
      throw new WorkspaceAsyncImportError("idempotency_conflict",409);
    }
    if (args.contributedByStudyCorpusId) {
      const contribution = await client.query(`
        SELECT 1 FROM study_corpora corpus
        JOIN signal_workspaces workspace
          ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
         AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
        WHERE workspace.id=$1::uuid AND corpus.id=$2::uuid
      `,[args.workspace.id,args.contributedByStudyCorpusId]);
      if (!contribution.rows[0]) throw new WorkspaceAsyncImportError("study_cross_workspace",422);
    }
    const existing = await client.query<{
      id: string;product_request_digest: string;status: WorkspaceAsyncImportStatusV1;
      ingestion_phase: string;storage_object_key: string | null;
    }>(`
      SELECT id::text,product_request_digest,status,ingestion_phase,storage_object_key
      FROM import_batches
      WHERE workspace_id=$1::uuid AND product_idempotency_key=$2
      FOR UPDATE
    `,[args.workspace.id,idempotencyHash]);
    const prior = existing.rows[0];
    if (prior) {
      if (prior.product_request_digest!==requestDigest) {
        throw new WorkspaceAsyncImportError("idempotency_conflict",409);
      }
      persistedId = prior.id;
      replayed = true;
      if (prior.storage_object_key!==objectKey && prior.id!==batchId) {
        // The object key is batch-derived. Replays use the persisted key and a
        // fresh signed token after the transaction.
      }
    } else {
      const legacy = targetAcquisition ? { mentionType:null,entityKind:null } : legacyScope(source.governed_scope!);
      await client.query(`
        INSERT INTO import_batches(
          id,workspace_id,study_corpus_id,contributed_by_study_corpus_id,data_source_id,
          mention_type,competitor_id,entity_kind,entity_label,source_system,
          source_file_name,product_idempotency_key,product_request_digest,
          imported_by_user_id,status,ingestion_phase,storage_bucket,storage_object_key,
          upload_protocol,expected_file_size_bytes,storage_part_count,
          storage_part_size_bytes,supersedes_import_batch_id,
          acquisition_contract_version,acquisition_plan_id,acquisition_slot_id,
          acquisition_query_version_id,capture_period_start,capture_period_end,capture_timezone,
          acquisition_plan_digest,acquisition_slot_digest,acquisition_query_digest,
          acquisition_brand_os_digest,acquisition_identity_catalog_digest,provider_schema_version,
          provider_observation_projection_state,provider_observation_count,acquisition_sealed_at,
          acquisition_query_evidence_class,acquisition_query_evidence_reason,
          acquisition_query_evidence_actor_user_id,acquisition_query_evidence_attested_at,
          provider_execution_reference_hash,provider_execution_adapter_key,
          provider_execution_verified_at,acquisition_import_seal_digest
        ) VALUES(
          $1::uuid,$2::uuid,$3::uuid,$3::uuid,$4::uuid,$5,
          CASE WHEN $6='competitor' THEN $7::uuid ELSE NULL END,
          $6,$8,$9,$10,$11,$12,$13::uuid,'queued','uploading',$14,$15,
          'supabase-multipart-tus',$16,$17,$18,$19::uuid,
          $20::text,$21::uuid,$22::uuid,$23::uuid,$24::date,$25::date,$26,
          $27,$28,$29,$30,$31,$32,
          CASE WHEN $20::text IS NULL THEN NULL ELSE 'pending' END,
          CASE WHEN $20::text IS NULL THEN NULL ELSE 0 END,
          CASE WHEN $20::text IS NULL THEN NULL ELSE $33::timestamptz END,
          $34,$35,$36::uuid,$33::timestamptz,$37,$38,
          CASE WHEN $34='provider_verified' THEN $33::timestamptz ELSE NULL END,$39
        )
      `,[batchId,args.workspace.id,args.contributedByStudyCorpusId,args.sourceId,
        legacy.mentionType,legacy.entityKind,source.governed_entity_id,
        source.name,source.provider,args.fileName,idempotencyHash,requestDigest,
        args.actor.id,storage.bucket,objectKey,args.fileSizeBytes,
        Math.ceil(args.fileSizeBytes/WORKSPACE_IMPORT_PART_BYTES),
        WORKSPACE_IMPORT_PART_BYTES,args.supersedesImportBatchId,
        targetAcquisition?SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION:null,acquisitionRow?.plan_id??null,
        acquisitionRow?.slot_id??null,acquisitionRow?.query_id??null,
        targetAcquisition?.period.start??null,targetAcquisition?.period.end??null,
        targetAcquisition?.period.timezone??null,acquisitionRow?.plan_digest??null,
        acquisitionRow?.slot_digest??null,acquisitionRow?.query_digest??null,
        acquisitionRow?.brand_os_digest??null,acquisitionRow?.catalog_digest??null,
        acquisitionRow?.provider_schema_version??null,attestedAt,
        targetAcquisition?.queryEvidence.class??null,
        targetAcquisition?.queryEvidence.reason??null,targetAcquisition?args.actor.id:null,
        targetAcquisition?.queryEvidence.class==="provider_verified"
          ? targetAcquisition.queryEvidence.providerExecutionReferenceHash:null,
        targetAcquisition?.queryEvidence.class==="provider_verified"
          ? targetAcquisition.queryEvidence.providerExecutionAdapterKey:null,
        importSealDigest]);
      await client.query(`
        INSERT INTO signal_workspace_import_events(
          workspace_id,import_batch_id,event_type,actor_user_id,detail
        ) VALUES($1::uuid,$2::uuid,$3,$4::uuid,jsonb_build_object(
          'file_size_bytes',$5::bigint,'protocol','supabase-multipart-tus'
        ))
      `,[args.workspace.id,batchId,
        args.supersedesImportBatchId ? "retry-created" : "upload-created",
        args.actor.id,args.fileSizeBytes]);
      if (targetAcquisition && acquisitionOperationRow && acquisitionRow) {
        const eventDigest=hashValue(stable({
          operation_id:acquisitionOperationRow.id,event_kind:"import-sealed",
          plan_digest:acquisitionRow.plan_digest,slot_digest:acquisitionRow.slot_digest,
          import_seal_digest:importSealDigest,import_ref:hashValue(batchId)
        }));
        await client.query(`
          INSERT INTO signal_acquisition_plan_events(
            workspace_id,operation_id,event_index,event_kind,plan_id,slot_id,
            query_version_id,import_batch_id,next_state_digest,event_digest,detail
          ) VALUES($1::uuid,$2::uuid,0,'import-sealed',$3::uuid,$4::uuid,$5::uuid,$6::uuid,
            $7,$8,jsonb_build_object('import_ref',$9::text,'query_evidence_class',$10::text))
        `,[args.workspace.id,acquisitionOperationRow.id,acquisitionRow.plan_id,
          acquisitionRow.slot_id,acquisitionRow.query_id,batchId,importSealDigest,
          eventDigest,hashValue(batchId),targetAcquisition.queryEvidence.class]);
        await client.query(`
          UPDATE signal_governance_control_operations
          SET status='completed',result=jsonb_build_object('state','sealed','import_ref',$3::text),
            completed_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='in_progress'
        `,[acquisitionOperationRow.id,args.workspace.id,hashValue(batchId)]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }

  const persisted = await loadWorkspaceImportInternalV1(args.workspace.id,persistedId);
  if (!persisted) throw new WorkspaceAsyncImportError("import_not_found",404);
  const upload = persisted.status==="queued" && persisted.ingestion_phase==="uploading"
    ? await (args.storage?.createSignedUploads??createWorkspaceImportSignedUploadsV1)({
      objectPrefix: persisted.storage_object_key!,
      fileSizeBytes: Number(persisted.expected_file_size_bytes)
    })
    : null;
  return { batch: operatorImport(persisted),upload,replayed };
}

export async function uploadWorkspaceImportRequestBodyV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  sourceId: string;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
  contributedByStudyCorpusId: string | null;
  supersedesImportBatchId: string | null;
  idempotencyKey: string;
  body: ReadableStream<Uint8Array>;
}) {
  const created = await createWorkspaceImportUploadV1(args);
  if (!created.upload) return created;
  await uploadWorkspaceImportMultipartStreamV1({
    upload: created.upload,body: args.body,contentType: args.contentType
  });
  return created;
}

export async function finalizeWorkspaceImportUploadV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  sourceId: string;
  importBatchId: string;
  idempotencyKey: string;
}) {
  const batch = await loadWorkspaceImportInternalV1(args.workspace.id,args.importBatchId);
  if (!batch || batch.data_source_id!==args.sourceId) {
    throw new WorkspaceAsyncImportError("import_not_found",404);
  }
  if (batch.status!=="queued") return { batch: operatorImport(batch),replayed: true };
  if (!batch.storage_bucket || !batch.storage_object_key || !batch.expected_file_size_bytes) {
    throw new WorkspaceAsyncImportError("upload_not_ready",409);
  }
  if (!batch.storage_part_count || !batch.storage_part_size_bytes) {
    throw new WorkspaceAsyncImportError("upload_not_ready",409);
  }
  const parts = await Promise.all(Array.from(
    { length: batch.storage_part_count },async (_,index) => statWorkspaceImportObjectV1({
      bucket: batch.storage_bucket!,
      objectKey: `${batch.storage_object_key}.part-${String(index+1).padStart(5,"0")}`
    })
  ));
  const uploadedBytes = parts.reduce((total,part) => total+part.sizeBytes,0);
  if (uploadedBytes!==Number(batch.expected_file_size_bytes)
      || parts.some((part,index) => part.sizeBytes!==Math.min(
        Number(batch.storage_part_size_bytes),
        Number(batch.expected_file_size_bytes)-(index*Number(batch.storage_part_size_bytes))
      ))) {
    throw new WorkspaceAsyncImportError("upload_size_mismatch",409);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
      `workspace-import-finalize:${args.importBatchId}`
    ]);
    const result = await client.query<{
      outbox_id: string;worker_job_id: string;created: boolean;
    }>(`
      SELECT outbox_id::text,worker_job_id,created
      FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)
    `,[args.importBatchId,args.actor.id]);
    await client.query(`
      INSERT INTO signal_workspace_import_events(
        workspace_id,import_batch_id,outbox_id,event_type,actor_user_id,detail
      ) SELECT workspace_id,id,$2::uuid,'upload-completed',$3::uuid,
        jsonb_build_object('size_bytes',$4::bigint)
      FROM import_batches batch WHERE batch.id=$1::uuid
        AND NOT EXISTS (SELECT 1 FROM signal_workspace_import_events event
          WHERE event.import_batch_id=batch.id AND event.event_type='upload-completed')
    `,[args.importBatchId,result.rows[0]?.outbox_id ?? null,args.actor.id,uploadedBytes]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  const queued = await loadWorkspaceImportInternalV1(args.workspace.id,args.importBatchId);
  if (!queued) throw new WorkspaceAsyncImportError("import_not_found",404);
  return { batch: operatorImport(queued),replayed: false };
}

export async function failWorkspaceImportUploadV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  sourceId: string;
  importBatchId: string;
  failureCode: "upload_aborted" | "upload_transport_failed";
}) {
  const client = await pool.connect();
  let replayed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
      `workspace-import-upload-failure:${args.importBatchId}`
    ]);
    const locked = await client.query<WorkspaceImportRow>(`
      SELECT batch.*,outbox.status AS outbox_status,outbox.attempt_count AS outbox_attempt_count
      FROM import_batches batch
      LEFT JOIN signal_workspace_import_outbox outbox ON outbox.import_batch_id=batch.id
      WHERE batch.id=$1::uuid AND batch.workspace_id=$2::uuid
        AND batch.data_source_id=$3::uuid
      FOR UPDATE OF batch
    `,[args.importBatchId,args.workspace.id,args.sourceId]);
    const batch = locked.rows[0];
    if (!batch) throw new WorkspaceAsyncImportError("import_not_found",404);
    if (batch.status==="failed") {
      replayed = true;
    } else {
      if (batch.status!=="queued" || batch.ingestion_phase!=="uploading") {
        throw new WorkspaceAsyncImportError("upload_failure_state_conflict",409);
      }
      await client.query(`
        UPDATE import_batches SET status='failed',ingestion_phase='failed',failed_at=now(),
          failure_code=$2,failure_detail=jsonb_build_object(
            'stage','upload','recoverable',true,'reported_by','product-client'
          )
        WHERE id=$1::uuid
      `,[args.importBatchId,args.failureCode]);
      await client.query(`
        INSERT INTO signal_workspace_import_events(
          workspace_id,import_batch_id,event_type,actor_user_id,detail
        ) SELECT workspace_id,id,'failed',$2::uuid,
          jsonb_build_object('stage','upload','code',$3::text,'recoverable',true)
        FROM import_batches batch WHERE batch.id=$1::uuid
          AND NOT EXISTS(
            SELECT 1 FROM signal_workspace_import_events event
            WHERE event.import_batch_id=batch.id AND event.event_type='failed'
              AND event.detail->>'stage'='upload'
          )
      `,[args.importBatchId,args.actor.id,args.failureCode]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  const failed = await loadWorkspaceImportInternalV1(args.workspace.id,args.importBatchId);
  if (!failed) throw new WorkspaceAsyncImportError("import_not_found",404);
  return { batch: operatorImport(failed),replayed };
}

export async function retryWorkspaceImportFromStorageV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  sourceId: string;
  importBatchId: string;
  idempotencyKey: string;
}) {
  const failed=await loadWorkspaceImportInternalV1(args.workspace.id,args.importBatchId);
  if (!failed || failed.data_source_id!==args.sourceId) {
    throw new WorkspaceAsyncImportError("import_not_found",404);
  }
  if (failed.status!=="failed" || failed.ingestion_phase!=="failed"
      || !failed.storage_bucket || !failed.storage_object_key
      || !failed.storage_part_count || !failed.storage_part_size_bytes
      || !failed.expected_file_size_bytes) {
    throw new WorkspaceAsyncImportError("storage_recovery_unavailable",409);
  }
  const expectedPrefix=`workspace-imports/${args.workspace.id}/${failed.id}/`;
  if (!failed.storage_object_key.startsWith(expectedPrefix)) {
    throw new WorkspaceAsyncImportError("storage_authority_mismatch",409);
  }
  const parts=await Promise.all(Array.from(
    { length: Number(failed.storage_part_count) },async (_,index)=>
      statWorkspaceImportObjectV1({
        bucket: failed.storage_bucket!,
        objectKey: `${failed.storage_object_key}.part-${String(index+1).padStart(5,"0")}`
      })
  ));
  const expectedSize=Number(failed.expected_file_size_bytes);
  const partSize=Number(failed.storage_part_size_bytes);
  const verifiedSize=parts.reduce((total,part)=>total+part.sizeBytes,0);
  if (verifiedSize!==expectedSize || parts.some((part,index)=>
    part.sizeBytes!==Math.min(partSize,expectedSize-(index*partSize)))) {
    throw new WorkspaceAsyncImportError("upload_size_mismatch",409);
  }
  const idempotencyHash=hashValue(args.idempotencyKey);
  const requestDigest=hashValue(stable({
    action: "retry-workspace-import-from-storage",
    workspace_id: args.workspace.id,
    source_id: args.sourceId,
    failed_import_batch_id: failed.id,
    verified_size_bytes: verifiedSize,
    storage_part_count: parts.length
  }));
  const client=await pool.connect();
  let operation:{import_batch_id:string;outbox_id:string;worker_job_id:string;created:boolean}|undefined;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    let controlOperation:{id:string;action:string;request_digest:string;actor_user_id:string;status:string}|undefined;
    if(["signal-acquisition-import-v1","signal-acquisition-import-v2"]
      .includes(failed.acquisition_contract_version??"")){
      await client.query(`INSERT INTO signal_governance_control_operations(
        workspace_id,actor_user_id,action,request_digest,idempotency_key,status
      ) VALUES($1::uuid,$2::uuid,'seal-acquisition-import',$3,$4,'in_progress')
      ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`,[
        args.workspace.id,args.actor.id,requestDigest,idempotencyHash]);
      const loaded=await client.query<{
        id:string;action:string;request_digest:string;actor_user_id:string;status:string;
      }>(`
        SELECT id::text,action,request_digest,actor_user_id::text,status
        FROM signal_governance_control_operations
        WHERE workspace_id=$1::uuid AND idempotency_key=$2 FOR UPDATE
      `,[args.workspace.id,idempotencyHash]);
      controlOperation=loaded.rows[0];
      if(!controlOperation || controlOperation.action!=="seal-acquisition-import"
        || controlOperation.request_digest!==requestDigest || controlOperation.actor_user_id!==args.actor.id){
        throw new WorkspaceAsyncImportError("idempotency_conflict",409);
      }
    }
    const result=await client.query<{
      import_batch_id: string;outbox_id: string;worker_job_id: string;created: boolean;
    }>(`
      SELECT import_batch_id::text,outbox_id::text,worker_job_id,created
      FROM create_signal_workspace_import_storage_recovery_v1(
        $1::uuid,$2::uuid,$3,$4,$5
      )
    `,[failed.id,args.actor.id,idempotencyHash,requestDigest,null]);
    operation=result.rows[0];
    if(operation && controlOperation?.status==="in_progress"){
      const seal=await client.query<{
        plan_id:string;slot_id:string;query_id:string|null;query_digest:string|null;
        import_seal_digest:string|null;query_evidence_class:string|null;
      }>(`SELECT acquisition_plan_id::text plan_id,acquisition_slot_id::text slot_id,
        acquisition_query_version_id::text query_id,acquisition_query_digest query_digest,
        acquisition_import_seal_digest import_seal_digest,
        acquisition_query_evidence_class query_evidence_class
        FROM import_batches WHERE id=$1::uuid AND workspace_id=$2::uuid`,[
        operation.import_batch_id,args.workspace.id]);
      const authority=seal.rows[0];
      const nextDigest=authority?.import_seal_digest??authority?.query_digest??null;
      if(!authority?.plan_id||!authority.slot_id||!nextDigest){
        throw new WorkspaceAsyncImportError("storage_recovery_unavailable",409);
      }
      const eventDigest=hashValue(stable({operation_id:controlOperation.id,event_kind:"import-sealed",
        original_import_ref:hashValue(failed.id),recovery_import_ref:hashValue(operation.import_batch_id),
        import_seal_digest:nextDigest,query_evidence_class:authority.query_evidence_class}));
      await client.query(`INSERT INTO signal_acquisition_plan_events(
        workspace_id,operation_id,event_index,event_kind,plan_id,slot_id,query_version_id,
        import_batch_id,next_state_digest,event_digest,detail
      ) VALUES($1::uuid,$2::uuid,0,'import-sealed',$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,
        jsonb_build_object('storage_reused',true,'original_import_ref',$9::text,
          'query_evidence_class',$10::text))
        ON CONFLICT(operation_id,event_index) DO NOTHING`,[
        args.workspace.id,controlOperation.id,authority.plan_id,authority.slot_id,authority.query_id,
        operation.import_batch_id,nextDigest,eventDigest,hashValue(failed.id),
        authority.query_evidence_class]);
      await client.query(`UPDATE signal_governance_control_operations SET status='completed',
        result=jsonb_build_object('state','sealed-recovery','import_ref',$3::text),
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='in_progress'`,[
        controlOperation.id,args.workspace.id,hashValue(operation.import_batch_id)]);
    }
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  if (!operation) throw new WorkspaceAsyncImportError("storage_recovery_unavailable",409);
  const recovery=await loadWorkspaceImportInternalV1(args.workspace.id,operation.import_batch_id);
  if (!recovery) throw new WorkspaceAsyncImportError("import_not_found",404);
  return {
    batch: operatorImport(recovery),
    replayed: !operation.created,
    jobId: operation.worker_job_id
  };
}

export async function loadWorkspaceImportV1(args: {
  workspaceId: string;sourceId: string;importBatchId: string;
}) {
  const row = await loadWorkspaceImportInternalV1(args.workspaceId,args.importBatchId);
  return row?.data_source_id===args.sourceId ? operatorImport(row) : null;
}

export async function listWorkspaceImportsV1(args: {
  workspaceId: string;sourceId: string;slotKey?: string | null;
}) {
  const result = await pool.query<WorkspaceImportRow>(`
    SELECT batch.*,batch.capture_period_start::text AS capture_period_start,
      batch.capture_period_end::text AS capture_period_end,
      outbox.status AS outbox_status,outbox.attempt_count AS outbox_attempt_count,
      slot.slot_key AS acquisition_slot_key,query.query_version AS acquisition_query_version,
      observed.period_start AS observed_period_start,observed.period_end AS observed_period_end,
      observed.languages AS observed_languages,observed.countries AS observed_countries,
      observed.platforms AS observed_platforms,
      COALESCE(plan.acquisition_brief->'countries','[]'::jsonb) AS declared_countries,
      COALESCE(plan.acquisition_brief->'languages','[]'::jsonb) AS declared_languages
    FROM import_batches batch
    LEFT JOIN signal_workspace_import_outbox outbox ON outbox.import_batch_id=batch.id
    LEFT JOIN signal_acquisition_slots slot ON slot.id=batch.acquisition_slot_id
      AND slot.workspace_id=batch.workspace_id
    LEFT JOIN signal_acquisition_query_versions query ON query.id=batch.acquisition_query_version_id
      AND query.workspace_id=batch.workspace_id
    LEFT JOIN signal_acquisition_plans plan ON plan.id=batch.acquisition_plan_id
      AND plan.workspace_id=batch.workspace_id
    LEFT JOIN LATERAL(
      SELECT min(observation.published_at)::text period_start,max(observation.published_at)::text period_end,
        COALESCE(array_agg(DISTINCT observation.language_code)
          FILTER(WHERE observation.language_code IS NOT NULL),ARRAY[]::text[]) languages,
        COALESCE(array_agg(DISTINCT observation.country_code)
          FILTER(WHERE observation.country_code IS NOT NULL),ARRAY[]::text[]) countries,
        COALESCE(array_agg(DISTINCT observation.platform)
          FILTER(WHERE observation.platform IS NOT NULL),ARRAY[]::text[]) platforms
      FROM signal_provider_mention_observations observation
      WHERE observation.import_batch_id=batch.id AND NOT EXISTS(
        SELECT 1 FROM signal_provider_mention_observations successor
        WHERE successor.supersedes_observation_id=observation.id)
    ) observed ON batch.status='completed'
    WHERE batch.workspace_id=$1::uuid AND batch.data_source_id=$2::uuid
      AND ($3::text IS NULL OR slot.slot_key=$3)
    ORDER BY batch.created_at DESC,batch.id DESC LIMIT 100
  `,[args.workspaceId,args.sourceId,args.slotKey ?? null]);
  return result.rows.map(operatorImport);
}

async function loadWorkspaceImportInternalV1(workspaceId: string,importBatchId: string) {
  const result = await pool.query<WorkspaceImportRow>(`
    SELECT batch.*,batch.capture_period_start::text AS capture_period_start,
      batch.capture_period_end::text AS capture_period_end,
      outbox.status AS outbox_status,outbox.attempt_count AS outbox_attempt_count,
      slot.slot_key AS acquisition_slot_key,query.query_version AS acquisition_query_version,
      observed.period_start AS observed_period_start,observed.period_end AS observed_period_end,
      observed.languages AS observed_languages,observed.countries AS observed_countries,
      observed.platforms AS observed_platforms,
      COALESCE(plan.acquisition_brief->'countries','[]'::jsonb) AS declared_countries,
      COALESCE(plan.acquisition_brief->'languages','[]'::jsonb) AS declared_languages
    FROM import_batches batch
    LEFT JOIN signal_workspace_import_outbox outbox ON outbox.import_batch_id=batch.id
    LEFT JOIN signal_acquisition_slots slot ON slot.id=batch.acquisition_slot_id
      AND slot.workspace_id=batch.workspace_id
    LEFT JOIN signal_acquisition_query_versions query ON query.id=batch.acquisition_query_version_id
      AND query.workspace_id=batch.workspace_id
    LEFT JOIN signal_acquisition_plans plan ON plan.id=batch.acquisition_plan_id
      AND plan.workspace_id=batch.workspace_id
    LEFT JOIN LATERAL(
      SELECT min(observation.published_at)::text period_start,max(observation.published_at)::text period_end,
        COALESCE(array_agg(DISTINCT observation.language_code)
          FILTER(WHERE observation.language_code IS NOT NULL),ARRAY[]::text[]) languages,
        COALESCE(array_agg(DISTINCT observation.country_code)
          FILTER(WHERE observation.country_code IS NOT NULL),ARRAY[]::text[]) countries,
        COALESCE(array_agg(DISTINCT observation.platform)
          FILTER(WHERE observation.platform IS NOT NULL),ARRAY[]::text[]) platforms
      FROM signal_provider_mention_observations observation
      WHERE observation.import_batch_id=batch.id AND NOT EXISTS(
        SELECT 1 FROM signal_provider_mention_observations successor
        WHERE successor.supersedes_observation_id=observation.id)
    ) observed ON batch.status='completed'
    WHERE batch.workspace_id=$1::uuid AND batch.id=$2::uuid
    LIMIT 1
  `,[workspaceId,importBatchId]);
  return result.rows[0] ?? null;
}

type WorkspaceImportRow = {
  id: string;workspace_id: string;data_source_id: string;status: WorkspaceAsyncImportStatusV1;
  ingestion_phase: string;source_file_name: string | null;source_file_hash: string | null;
  storage_bucket: string | null;storage_object_key: string | null;
  storage_part_count: number | null;storage_part_size_bytes: string | number | null;
  expected_file_size_bytes: string | number | null;processed_bytes: string | number;
  progress_record_count: number;record_count: number | null;included_count: number | null;
  excluded_count: number | null;duplicate_count: number | null;failure_code: string | null;
  failure_detail: unknown;worker_job_id: string | null;supersedes_import_batch_id: string | null;
  storage_source_import_batch_id: string | null;storage_content_hash: string | null;
  processing_metrics: Record<string,unknown>;
  created_at: Date;updated_at: Date;processing_started_at: Date | null;
  completed_at: Date | null;failed_at: Date | null;outbox_status: string | null;
  outbox_attempt_count: number | null;
  acquisition_contract_version: string | null;
  acquisition_slot_key: string | null;acquisition_query_version: number | null;
  acquisition_query_evidence_class: "provider_verified"|"operator_attested"|"unavailable"|null;
  acquisition_query_evidence_reason: SignalAcquisitionQueryUnavailableReasonV2|null;
  acquisition_query_evidence_attested_at: Date|string|null;
  capture_period_start: Date | string | null;capture_period_end: Date | string | null;
  capture_timezone: string | null;
  observed_period_start:string|null;observed_period_end:string|null;
  observed_languages:string[]|null;observed_countries:string[]|null;observed_platforms:string[]|null;
  declared_countries:string[];declared_languages:string[];
};

function operatorImport(row: WorkspaceImportRow) {
  const expected = Number(row.expected_file_size_bytes ?? 0);
  const processed = Number(row.processed_bytes ?? 0);
  const completed = row.status==="completed";
  const observedWarnings:string[]=[];
  const observedStart=row.observed_period_start?.slice(0,10)??null;
  const observedEnd=row.observed_period_end?.slice(0,10)??null;
  const declaredStart=row.capture_period_start?String(row.capture_period_start).slice(0,10):null;
  const declaredEnd=row.capture_period_end?String(row.capture_period_end).slice(0,10):null;
  if(completed&&observedStart&&observedEnd&&declaredStart&&declaredEnd
      &&(observedStart<declaredStart||observedEnd>declaredEnd)){
    observedWarnings.push("observed_period_outside_declared_period");
  }
  const declaredCountries=new Set((row.declared_countries??[]).map((value)=>value.toUpperCase()));
  if(completed&&declaredCountries.size>0&&(row.observed_countries??[])
      .some((value)=>!declaredCountries.has(value.toUpperCase()))){
    observedWarnings.push("observed_country_outside_declared_market");
  }
  return {
    id: row.id,
    data_source_id: row.data_source_id,
    status: row.status,
    phase: row.ingestion_phase,
    source_file_name: row.source_file_name,
    source_file_hash: completed && row.source_file_hash ? `sha256:${row.source_file_hash}` : null,
    supersedes_import_batch_id: row.supersedes_import_batch_id,
    acquisition: ["signal-acquisition-import-v1","signal-acquisition-import-v2"]
      .includes(row.acquisition_contract_version??"") && row.acquisition_slot_key
      ? {
          slot_key: row.acquisition_slot_key,
          query_version: row.acquisition_query_version===null
            ? null:Number(row.acquisition_query_version),
          query_evidence: row.acquisition_contract_version==="signal-acquisition-import-v2"
            && row.acquisition_query_evidence_class
            ? {
                class:row.acquisition_query_evidence_class,
                reason:row.acquisition_query_evidence_reason,
                attested_at:row.acquisition_query_evidence_attested_at
                  ? new Date(row.acquisition_query_evidence_attested_at).toISOString():null
              }
            : {class:"operator_attested" as const,reason:null,attested_at:null},
          period: row.capture_period_start && row.capture_period_end && row.capture_timezone
            ? {
                start: String(row.capture_period_start).slice(0,10),
                end: String(row.capture_period_end).slice(0,10),
                timezone: row.capture_timezone
              }
            : null
        }
      : null,
    progress: {
      records_processed: row.progress_record_count,
      bytes_processed: processed,
      bytes_total: expected || null,
      percent: expected
        ? completed ? 100 : Math.min(99,Math.floor((processed/expected)*100))
        : null
    },
    final_counts: completed ? {
      record_count: row.record_count,
      included_count: row.included_count,
      excluded_count: row.excluded_count,
      duplicate_count: row.duplicate_count
    } : null,
    observed: completed ? {
      period: observedStart&&observedEnd?{start:observedStart,end:observedEnd}:null,
      languages: row.observed_languages??[],countries:row.observed_countries??[],
      platforms:row.observed_platforms??[],warnings:observedWarnings
    }:null,
    failure: row.status==="failed" ? safeFailure(row.failure_code) : null,
    recovery: {
      storage_reused: row.storage_source_import_batch_id!==null,
      recoverable_from_storage: row.status==="failed"
        && row.storage_bucket!==null && row.storage_object_key!==null
        && row.storage_part_count!==null && row.storage_part_size_bytes!==null
    },
    processing_metrics: completed ? row.processing_metrics : null,
    worker: {
      job_id: row.worker_job_id,
      delivery_status: row.outbox_status,
      dispatch_attempts: row.outbox_attempt_count ?? 0
    },
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    processing_started_at: row.processing_started_at ? new Date(row.processing_started_at).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    failed_at: row.failed_at ? new Date(row.failed_at).toISOString() : null
  };
}

function safeFailure(code: string | null) {
  const normalized = code || "processing_failed";
  const recoverable = !["content_already_accepted","cross_workspace"].includes(normalized);
  return { code: normalized,recoverable };
}

function legacyScope(scope: string) {
  if (scope==="primary_brand") return { mentionType: "brand",entityKind: "primary_brand" };
  if (scope==="competitor") return { mentionType: "competitor",entityKind: "competitor" };
  if (scope==="category") return { mentionType: "industry",entityKind: "category" };
  return { mentionType: null,entityKind: scope };
}

function validateFile(fileName: string,size: number,contentType: string) {
  if (!fileName.trim().toLowerCase().endsWith(".csv")) {
    throw new WorkspaceAsyncImportError("csv_required",422);
  }
  if (!Number.isSafeInteger(size) || size<=0 || size>2_000_000_000) {
    throw new WorkspaceAsyncImportError("file_size_invalid",422);
  }
  if (contentType && !["text/csv","application/csv","application/vnd.ms-excel","application/octet-stream"]
    .includes(contentType.toLowerCase())) {
    throw new WorkspaceAsyncImportError("content_type_invalid",422);
  }
}

function hashValue(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value==="object") return `{${Object.entries(value)
    .sort(([left],[right])=>left.localeCompare(right))
    .map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export class WorkspaceAsyncImportError extends Error {
  constructor(public readonly code: string,public readonly status: number) {
    super(code);this.name="WorkspaceAsyncImportError";
  }
}
