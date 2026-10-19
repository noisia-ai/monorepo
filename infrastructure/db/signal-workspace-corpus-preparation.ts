import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { loadSignalWorkspaceCorpusReadinessStoreV1 } from "./signal-workspace-corpus-readiness";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";

export const SIGNAL_WORKSPACE_CORPUS_PREPARATION_CONTRACT_V1 = "signal-workspace-corpus-preparation-v1" as const;
export const SIGNAL_CORPUS_CHUNK_POLICY_V1 = "corpus-text-chunks-v1" as const;
export type SignalWorkspaceCorpusPreparationDatabaseV1 = Pick<Pool, "query" | "connect">;
export type SignalWorkspaceCorpusPreparationQueryableV1 = {
  query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
};
export type SignalCorpusTextChunksV1 = {
  contract_version: "corpus-text-chunks-v1";
  offset_unit: "utf16";
  max_code_units: 1400;
  text_sha256: string;
  code_units: number;
  chunks: Array<{ start: number; end: number; sha256: string }>;
};
export type SignalWorkspaceCorpusPreparationCountsV1 = {
  total_roots: number; processed_roots: number; eligible_roots: number; excluded_roots: number;
  rights_blocked_roots: number; inclusion_pending_roots: number; missing_text_roots: number; reused_roots: number; new_roots: number;
  changed_roots: number; removed_roots: number; chunk_count: number;
};
export type SignalWorkspaceCorpusPreparationRunV1 = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled" | "superseded";
  phase: "queued" | "snapshotting" | "chunking" | "complete";
  input_revision: number | null;
  counts: SignalWorkspaceCorpusPreparationCountsV1;
  error_code: string | null;
  retryable: boolean;
  created_at: string; updated_at: string; completed_at: string | null;
};
export type SignalWorkspaceCorpusPreparationStatusV1 = {
  contract_version: typeof SIGNAL_WORKSPACE_CORPUS_PREPARATION_CONTRACT_V1;
  workspace_id: string; observed_at: string; input_revision: number;
  active_run: SignalWorkspaceCorpusPreparationRunV1 | null;
  latest_run: SignalWorkspaceCorpusPreparationRunV1 | null;
  latest_completed: SignalWorkspaceCorpusPreparationRunV1 | null;
  is_current: boolean; needs_preparation: boolean;
};
export class SignalWorkspaceCorpusPreparationError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalWorkspaceCorpusPreparationError"; }
}
export type SignalWorkspaceCorpusPreparationDispatchV1 = {
  run_id: string; workspace_id: string; worker_job_id: string; dispatch_token: string;
};
export type SignalWorkspaceCorpusPreparationLeaseV1 = {
  run_id: string; workspace_id: string; execution_token: string;
  phase: "snapshotting" | "chunking"; cursor: string | null;
};
export type SignalWorkspaceCorpusPreparationPageV1 = {
  items: Array<{ root_id: string; asset_sha256: string | null; asset_ready: boolean; disposition: string }>;
  cursor: string | null; next_cursor: string | null; done: boolean;
};

const zeroCounts = (): SignalWorkspaceCorpusPreparationCountsV1 => ({ total_roots: 0, processed_roots: 0,
  eligible_roots: 0, excluded_roots: 0, rights_blocked_roots: 0, inclusion_pending_roots: 0, missing_text_roots: 0,
  reused_roots: 0, new_roots: 0, changed_roots: 0, removed_roots: 0, chunk_count: 0 });
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceCorpusPreparationError(code, status); };
const digest = (text: string) => `sha256:${createHash("sha256").update(text,"utf8").digest("hex")}`;
const leaseSeconds = (value?: number) => Math.max(30, Math.min(600, Math.trunc(value ?? 120)));
async function transaction<T>(database: SignalWorkspaceCorpusPreparationDatabaseV1, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch(error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
type LockedRun = {
  id: string; workspace_id: string; actor_user_id: string; status: string; phase: string;
  worker_job_id: string; execution_token: string | null; execution_live: boolean;
  current_revision: string; input_revision: string | null; policy_live: boolean;
  cursor_root_id: string | null; counts: SignalWorkspaceCorpusPreparationCountsV1;
};
async function lockRun(client: PoolClient, runId: string): Promise<LockedRun> {
  const scope = (await client.query<{workspace_id:string}>("SELECT workspace_id FROM signal_corpus_preparation_runs WHERE id=$1::uuid",[runId])).rows[0];
  if(!scope) return fail("corpus_preparation_not_found",404);
  await client.query("SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE",[scope.workspace_id]);
  const row = (await client.query<LockedRun>(`SELECT run.*,state.input_revision::text current_revision,
    run.input_revision::text,run.execution_expires_at>clock_timestamp() execution_live,
    (run.policy_valid_until IS NULL OR run.policy_valid_until>clock_timestamp()) policy_live
    FROM signal_corpus_preparation_runs run JOIN signal_corpus_preparation_input_state state USING(workspace_id)
    WHERE run.id=$1::uuid FOR UPDATE OF run`,[runId])).rows[0];
  if(!row) return fail("corpus_preparation_not_found",404);
  return row;
}
async function assertActor(client: PoolClient, run: Pick<LockedRun,"workspace_id"|"actor_user_id">) {
  if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:run.workspace_id,
    actor_user_id:run.actor_user_id})).can_import_mentions) fail("corpus_preparation_forbidden",403);
}
async function lockedLease(client: PoolClient, lease: SignalWorkspaceCorpusPreparationLeaseV1, checkInputs=true): Promise<LockedRun> {
  const run = await lockRun(client,lease.run_id);
  if(run.workspace_id!==lease.workspace_id || run.execution_token!==lease.execution_token
    || run.status!=="running" || !run.execution_live) return fail("corpus_preparation_lease_lost");
  await assertActor(client,run);
  if(checkInputs && run.input_revision!==null && (run.input_revision!==run.current_revision || !run.policy_live)) {
    return fail("corpus_preparation_inputs_changed");
  }
  await client.query("UPDATE signal_corpus_preparation_runs SET execution_expires_at=clock_timestamp()+interval '120 seconds' WHERE id=$1::uuid",[run.id]);
  return run;
}
function toLease(run: LockedRun, token: string): SignalWorkspaceCorpusPreparationLeaseV1 {
  return {run_id:run.id,workspace_id:run.workspace_id,execution_token:token,
    phase:run.phase==="chunking"?"chunking":"snapshotting",cursor:run.cursor_root_id};
}
export async function claimSignalWorkspaceCorpusPreparationDispatchV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;limit?:number;lease_seconds?:number}):Promise<SignalWorkspaceCorpusPreparationDispatchV1[]> {
  return transaction(args.database,async client => (await client.query<SignalWorkspaceCorpusPreparationDispatchV1>(`
    WITH candidates AS (SELECT id FROM signal_corpus_preparation_runs WHERE status IN('queued','running')
      AND available_at<=clock_timestamp() AND (dispatch_status='pending' OR dispatch_status='dispatching' AND dispatch_expires_at<clock_timestamp())
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1), claimed AS (
      UPDATE signal_corpus_preparation_runs run SET dispatch_status='dispatching',dispatch_token=gen_random_uuid(),dispatch_attempts=dispatch_attempts+1,
        dispatch_expires_at=clock_timestamp()+make_interval(secs=>$2),updated_at=clock_timestamp()
      FROM candidates WHERE run.id=candidates.id RETURNING run.*)
    SELECT id run_id,workspace_id,worker_job_id,dispatch_token FROM claimed`,
    [Math.max(1,Math.min(32,args.limit??8)),leaseSeconds(args.lease_seconds)])).rows);
}
export async function acknowledgeSignalWorkspaceCorpusPreparationDispatchV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;run_id:string;dispatch_token:string}) {
  await args.database.query(`UPDATE signal_corpus_preparation_runs SET dispatch_status='dispatched',dispatch_token=NULL,dispatch_attempts=0,
    dispatch_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid AND dispatch_token=$2::uuid AND dispatch_status='dispatching' AND status IN('queued','running')`,[args.run_id,args.dispatch_token]);
}
export async function failSignalWorkspaceCorpusPreparationDispatchV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;run_id:string;dispatch_token:string}) {
  await args.database.query(`UPDATE signal_corpus_preparation_runs SET dispatch_status='pending',dispatch_token=NULL,
    dispatch_expires_at=NULL,status=CASE WHEN dispatch_attempts>=8 THEN 'failed' ELSE status END,
    error_code='corpus_preparation_queue_unavailable',
    available_at=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(dispatch_attempts,6))::integer)),
    updated_at=clock_timestamp() WHERE id=$1::uuid AND dispatch_token=$2::uuid AND dispatch_status='dispatching' AND status IN('queued','running')`,[args.run_id,args.dispatch_token]);
}
export async function claimSignalWorkspaceCorpusPreparationRunV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;run_id:string;worker_job_id:string;lease_seconds?:number}):Promise<SignalWorkspaceCorpusPreparationLeaseV1|null> {
  return transaction(args.database,async client => {
    const run = await lockRun(client,args.run_id);
    if(run.worker_job_id!==args.worker_job_id || !["queued","running"].includes(run.status)
      || run.status==="running" && run.execution_live) return null;
    if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id})).can_import_mentions) {
      await client.query(`UPDATE signal_corpus_preparation_runs SET status='failed',error_code='corpus_preparation_forbidden',
        execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id]);
      return null;
    }
    if(run.input_revision!==null && (run.input_revision!==run.current_revision || !run.policy_live)) {
      await client.query(`UPDATE signal_corpus_preparation_runs SET status='superseded',execution_token=NULL,
        execution_expires_at=NULL,error_code='corpus_preparation_inputs_changed',updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id]);
      return null;
    }
    const token=randomUUID();
    await client.query(`UPDATE signal_corpus_preparation_runs SET status='running',phase=$3,dispatch_status='dispatched',
      dispatch_token=NULL,dispatch_expires_at=NULL,dispatch_attempts=0,
      execution_token=$2::uuid,execution_expires_at=clock_timestamp()+make_interval(secs=>$4),error_code=NULL,
      updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,token,run.phase==="chunking"?"chunking":"snapshotting",leaseSeconds(args.lease_seconds)]);
    return toLease(run,token);
  });
}

export function validateSignalCorpusTextChunksV1(text:string,hash:string,chunks:SignalCorpusTextChunksV1):void {
  if(digest(text)!==hash || chunks?.contract_version!==SIGNAL_CORPUS_CHUNK_POLICY_V1 || chunks.offset_unit!=="utf16"
    || chunks.max_code_units!==1400 || chunks.text_sha256!==hash || chunks.code_units!==text.length
    || !Array.isArray(chunks.chunks)) fail("corpus_preparation_chunk_integrity_failed",422);
  let cursor=0;
  for(const chunk of chunks.chunks) {
    const end=chunk.end;
    if(!Number.isSafeInteger(chunk.start)||!Number.isSafeInteger(end)||chunk.start!==cursor
      ||end<=cursor||end>text.length||end-cursor>1400
      ||(end<text.length && /[\uD800-\uDBFF]/u.test(text[end-1]!) && /[\uDC00-\uDFFF]/u.test(text[end]!))
      ||digest(text.slice(cursor,end))!==chunk.sha256) fail("corpus_preparation_chunk_integrity_failed",422);
    cursor=end;
  }
  if(cursor!==text.length) fail("corpus_preparation_chunk_integrity_failed",422);
}
const PAGE_TEXT_BYTES = 6 * 1024 * 1024;
async function readPage(client:PoolClient,run:LockedRun,limit:number):Promise<SignalWorkspaceCorpusPreparationPageV1> {
  const candidates=(await client.query<SignalWorkspaceCorpusPreparationPageV1["items"][number]&{text_bytes:number}>(`
    SELECT item.root_id,item.asset_sha256,item.disposition,(asset.chunks IS NOT NULL) asset_ready,
      CASE WHEN asset.chunks IS NULL THEN COALESCE(octet_length(asset.full_text),0) ELSE 0 END text_bytes
    FROM signal_corpus_preparation_items item LEFT JOIN signal_corpus_text_assets asset
      ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256
      AND asset.chunk_policy_version=item.chunk_policy_version
    WHERE item.run_id=$1::uuid AND ($2::uuid IS NULL OR item.root_id>$2::uuid)
    ORDER BY item.root_id LIMIT $3`,[run.id,run.cursor_root_id,limit])).rows;
  const items:SignalWorkspaceCorpusPreparationPageV1["items"]=[];
  let bytes=0,clipped=false;
  const assets=new Set<string>();
  for(const candidate of candidates){
    const size=candidate.asset_sha256 && !assets.has(candidate.asset_sha256)?candidate.text_bytes:0;
    if(bytes>0 && bytes+size>PAGE_TEXT_BYTES){clipped=true;break;}
    const {text_bytes:_bytes,...item}=candidate;items.push(item);bytes+=size;
    if(candidate.asset_sha256)assets.add(candidate.asset_sha256);
    // The first oversized document is returned whole on its own text page.
    if(bytes>PAGE_TEXT_BYTES){clipped=items.length<candidates.length;break;}
  }
  return {items,cursor:run.cursor_root_id,next_cursor:items.at(-1)?.root_id??run.cursor_root_id,
    done:!clipped && candidates.length<limit};
}
export async function readSignalWorkspaceCorpusPreparationPageV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;lease:SignalWorkspaceCorpusPreparationLeaseV1;limit?:number}):Promise<SignalWorkspaceCorpusPreparationPageV1> {
  return transaction(args.database,async client=>{
    const run=await lockedLease(client,args.lease);
    if(run.phase!=="chunking") return fail("corpus_preparation_snapshot_required");
    return readPage(client,run,Math.max(1,Math.min(100,args.limit??100)));
  });
}
export async function readSignalWorkspaceCorpusPreparationAssetV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;lease:SignalWorkspaceCorpusPreparationLeaseV1;asset_sha256:string}):Promise<{text:string;text_sha256:string;chunks:SignalCorpusTextChunksV1|null}> {
  return transaction(args.database,async client=>{
    const run=await lockedLease(client,args.lease);
    const asset=(await client.query<{text:string;text_sha256:string;chunks:SignalCorpusTextChunksV1|null}>(`
      SELECT asset.full_text text,asset.text_sha256,asset.chunks FROM signal_corpus_text_assets asset
      WHERE asset.workspace_id=$1::uuid AND asset.text_sha256=$2 AND asset.chunk_policy_version=$3
        AND EXISTS(SELECT 1 FROM signal_corpus_preparation_items item WHERE item.run_id=$4::uuid
          AND item.workspace_id=asset.workspace_id AND item.asset_sha256=asset.text_sha256 AND item.disposition='eligible')`,
      [run.workspace_id,args.asset_sha256,SIGNAL_CORPUS_CHUNK_POLICY_V1,run.id])).rows[0];
    if(!asset)return fail("corpus_preparation_asset_not_found",404);
    return asset;
  });
}
export async function readSignalWorkspaceCorpusPreparationAssetsV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;lease:SignalWorkspaceCorpusPreparationLeaseV1;page:SignalWorkspaceCorpusPreparationPageV1}):Promise<Array<{text:string;text_sha256:string;chunks:SignalCorpusTextChunksV1|null}>> {
  return transaction(args.database,async client=>{
    const run=await lockedLease(client,args.lease);
    if(run.phase!=="chunking"||args.page.cursor!==run.cursor_root_id||args.page.items.length>100)
      return fail("corpus_preparation_checkpoint_conflict");
    const actual=await readPage(client,run,Math.max(1,args.page.items.length));
    if(actual.next_cursor!==args.page.next_cursor||actual.items.length!==args.page.items.length
      ||actual.items.some((item,i)=>item.root_id!==args.page.items[i]?.root_id))return fail("corpus_preparation_checkpoint_conflict");
    const hashes=[...new Set(actual.items.filter(item=>item.asset_sha256 && !item.asset_ready).map(item=>item.asset_sha256!))];
    if(hashes.length===0)return [];
    return (await client.query<{text:string;text_sha256:string;chunks:SignalCorpusTextChunksV1|null}>(`
      SELECT full_text text,text_sha256,chunks FROM signal_corpus_text_assets WHERE workspace_id=$1::uuid
        AND text_sha256=ANY($2::text[]) AND chunk_policy_version=$3`,[run.workspace_id,hashes,SIGNAL_CORPUS_CHUNK_POLICY_V1])).rows;
  });
}
export async function commitSignalWorkspaceCorpusPreparationPageV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;lease:SignalWorkspaceCorpusPreparationLeaseV1;page:SignalWorkspaceCorpusPreparationPageV1;assets:Array<{text_sha256:string;chunks:SignalCorpusTextChunksV1}>}):Promise<SignalWorkspaceCorpusPreparationLeaseV1> {
  return transaction(args.database,async client=>{
    const run=await lockedLease(client,args.lease);
    if(run.phase!=="chunking"||args.page.cursor!==run.cursor_root_id||args.lease.cursor!==run.cursor_root_id
      ||args.page.items.length>100) return fail("corpus_preparation_checkpoint_conflict");
    const actual=await readPage(client,run,Math.max(1,args.page.items.length));
    if(actual.next_cursor!==args.page.next_cursor || actual.items.length!==args.page.items.length
      ||actual.items.some((item,i)=>item.root_id!==args.page.items[i]?.root_id)) return fail("corpus_preparation_checkpoint_conflict");
    const allowed=new Set(actual.items.map(item=>item.asset_sha256).filter(Boolean));
    if(args.assets.length>actual.items.length || new Set(args.assets.map(asset=>asset.text_sha256)).size!==args.assets.length)
      return fail("corpus_preparation_chunk_integrity_failed",422);
    for(const entry of args.assets)if(!allowed.has(entry.text_sha256))return fail("corpus_preparation_asset_not_found",404);
    if(args.assets.length>0){
      const fetched=(await client.query<{text_sha256:string;full_text:string;chunks:SignalCorpusTextChunksV1|null}>(`
        SELECT text_sha256,full_text,chunks FROM signal_corpus_text_assets WHERE workspace_id=$1::uuid
          AND text_sha256=ANY($2::text[]) AND chunk_policy_version=$3 FOR UPDATE`,
        [run.workspace_id,args.assets.map(asset=>asset.text_sha256),SIGNAL_CORPUS_CHUNK_POLICY_V1])).rows;
      const byHash=new Map(fetched.map(asset=>[asset.text_sha256,asset]));
      const pending:Array<{text_sha256:string;chunks:SignalCorpusTextChunksV1}>=[];
      for(const entry of args.assets){
        const asset=byHash.get(entry.text_sha256);if(!asset)return fail("corpus_preparation_asset_not_found",404);
        validateSignalCorpusTextChunksV1(asset.full_text,entry.text_sha256,entry.chunks);
        if(asset.chunks===null)pending.push(entry);
        else if(!isDeepStrictEqual(asset.chunks,entry.chunks))return fail("corpus_preparation_chunk_integrity_failed",422);
      }
      if(pending.length>0)await client.query(`UPDATE signal_corpus_text_assets asset SET chunks=incoming.chunks,prepared_at=clock_timestamp()
        FROM jsonb_to_recordset($3::jsonb) incoming(text_sha256 text,chunks jsonb)
        WHERE asset.workspace_id=$1::uuid AND asset.chunk_policy_version=$2 AND asset.text_sha256=incoming.text_sha256 AND asset.chunks IS NULL`,
        [run.workspace_id,SIGNAL_CORPUS_CHUNK_POLICY_V1,JSON.stringify(pending)]);
    }
    const coverage=(await client.query<{missing:string;chunks:string}>(`SELECT
      count(*) FILTER(WHERE item.disposition='eligible' AND asset.chunks IS NULL)::text missing,
      COALESCE(sum(jsonb_array_length(asset.chunks->'chunks')),0)::text chunks
      FROM signal_corpus_preparation_items item LEFT JOIN signal_corpus_text_assets asset
        ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      WHERE item.run_id=$1::uuid AND item.root_id=ANY($2::uuid[])`,[run.id,actual.items.map(item=>item.root_id)])).rows[0]!;
    if(Number(coverage.missing)>0)return fail("corpus_preparation_page_incomplete");
    const counts={...zeroCounts(),...run.counts};counts.processed_roots+=actual.items.length;counts.chunk_count+=Number(coverage.chunks);
    await client.query(`UPDATE signal_corpus_preparation_runs SET cursor_root_id=$2::uuid,counts=$3::jsonb,
      execution_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() WHERE id=$1::uuid`,
    [run.id,actual.next_cursor,JSON.stringify(counts)]);
    return {...args.lease,cursor:actual.next_cursor};
  });
}

export async function snapshotSignalWorkspaceCorpusPreparationV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;lease:SignalWorkspaceCorpusPreparationLeaseV1}):Promise<SignalWorkspaceCorpusPreparationLeaseV1> {
  return transaction(args.database,async client=>{
    const run=await lockedLease(client,args.lease,false);
    if(run.phase==="chunking")return toLease(run,args.lease.execution_token);
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    // Every workspace has a revision row before its first input. Its lock keeps
    // writers' commits outside this capture; no mention rows are locked here.
    const readiness=await loadSignalWorkspaceCorpusReadinessStoreV1({queryable:client,workspace_id:run.workspace_id});
    if(readiness.accepted_files===0)return fail("corpus_preparation_import_required",422);
    if(readiness.reconciliation_errors.some(code=>code!=="included_root_text_missing"&&code!=="canonical_inclusion_pending")) {
      return fail("corpus_preparation_source_incomplete",422);
    }
    await client.query(`CREATE TEMP TABLE corpus_preparation_snapshot_sources ON COMMIT DROP AS
      WITH accepted AS (SELECT * FROM import_batches WHERE workspace_id=$1::uuid AND status='completed')
      SELECT batch.id import_batch_id,batch.data_source_id,
        COALESCE(source.status='active' AND retention.id IS NOT NULL AND licensing.id IS NOT NULL
          AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage
            WHERE usage.workspace_id=$1::uuid AND usage.licensing_policy_id=licensing.id
              AND usage.usage_purpose='llm-processing' AND usage.decision='allowed'),false) authorized,
        jsonb_build_object('import_batch_id',batch.id,'data_source_id',batch.data_source_id,
          'source_file_hash',batch.source_file_hash,'records',batch.record_count,'included',batch.included_count,
          'excluded',batch.excluded_count,'duplicates',batch.duplicate_count,
          'acquisition_slot_id',batch.acquisition_slot_id,'acquisition_plan_digest',batch.acquisition_plan_digest,
          'acquisition_slot_digest',batch.acquisition_slot_digest,'capture_timezone',batch.capture_timezone,
          'capture_period_start',batch.capture_period_start,'capture_period_end',batch.capture_period_end,
          'binding',to_jsonb(binding),'retention',to_jsonb(retention),'license',to_jsonb(licensing)) evidence
      FROM accepted batch LEFT JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1::uuid
      LEFT JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=batch.data_source_id AND candidate.status='active'
          AND candidate.effective_from<=now() AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
          AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
        ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
      LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.workspace_id=$1::uuid AND retention.status='active' AND retention.effective_from<=now()
        AND (retention.effective_to IS NULL OR retention.effective_to>now()) AND retention.retention_state='allowed'
        AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
      LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.workspace_id=$1::uuid AND licensing.status='active' AND licensing.effective_from<=now()
        AND (licensing.effective_to IS NULL OR licensing.effective_to>now())`,[run.workspace_id]);
    await client.query(`CREATE TEMP TABLE corpus_preparation_snapshot_roots ON COMMIT DROP AS
      WITH paths AS (
        SELECT origin.canonical_mention_id root_id,membership.import_batch_id,membership.data_source_id,
          bool_or(source.authorized) authorized,
          min('sha256:'||encode(sha256(convert_to(source.evidence::text,'UTF8')),'hex')) policy_fingerprint
        FROM signal_mention_import_memberships membership
        JOIN corpus_preparation_snapshot_sources source ON source.import_batch_id=membership.import_batch_id
          AND source.data_source_id=membership.data_source_id
        JOIN LATERAL (SELECT id,workspace_id,canonical_mention_id FROM mentions
          WHERE id=membership.mention_id OFFSET 0) origin ON origin.workspace_id=$1::uuid
        WHERE membership.workspace_id=$1::uuid
        GROUP BY origin.canonical_mention_id,membership.import_batch_id,membership.data_source_id
      ), keys AS (
        SELECT root_id,import_batch_id,data_source_id,bool_or(has_path) has_path,bool_or(authorized) authorized,
          max(policy_fingerprint) policy_fingerprint,
          COALESCE(jsonb_agg(assertion ORDER BY assertion->>'id') FILTER(WHERE assertion IS NOT NULL),'[]'::jsonb) assertions
        FROM (SELECT root_id,import_batch_id,data_source_id,true has_path,authorized,policy_fingerprint,NULL::jsonb assertion FROM paths
          UNION ALL SELECT mention_id,import_batch_id,data_source_id,false,false,NULL,
            jsonb_build_object('id',id,'scope',scope,'entity_type',entity_type,'entity_id',entity_id,
              'policy_version',policy_version,'model_version',model_version)
          FROM signal_mention_attributions WHERE workspace_id=$1::uuid AND attribution_basis='mention_semantic'
            AND is_current=true AND review_status='approved' AND eligibility_status='eligible') evidence
        GROUP BY root_id,import_batch_id,data_source_id HAVING bool_or(has_path)
      ), roots AS (
        SELECT root_id,bool_or(authorized) authorized,bool_or(authorized AND jsonb_array_length(assertions)>0) semantic_eligible,
          jsonb_agg(jsonb_build_object('import_batch_id',import_batch_id,'data_source_id',data_source_id,
            'authorized',authorized,'policy_fingerprint',policy_fingerprint,'semantic_assertions',assertions)
            ORDER BY import_batch_id,data_source_id) provenance
        FROM keys GROUP BY root_id
      ) SELECT root.id root_id,
        CASE WHEN root.inclusion_status='excluded' THEN 'excluded'
          WHEN root.inclusion_status<>'included' THEN 'inclusion_pending'
          WHEN NOT roots.authorized THEN 'rights_blocked'
          WHEN NULLIF(btrim(root.text_clean),'') IS NULL THEN 'missing_text' ELSE 'eligible' END disposition,
        CASE WHEN root.inclusion_status='included' AND roots.authorized AND NULLIF(btrim(root.text_clean),'') IS NOT NULL
          THEN 'sha256:'||encode(sha256(convert_to(root.text_clean,'UTF8')),'hex') ELSE NULL END asset_sha256,
        CASE WHEN root.inclusion_status='included' AND roots.authorized AND NULLIF(btrim(root.text_clean),'') IS NOT NULL
          THEN root.text_clean ELSE NULL END full_text,
        jsonb_build_object('inclusion_status',root.inclusion_status,'exclusion_reason',root.exclusion_reason,
          'published_at',root.published_at,'language',root.language,'country',root.country,'platform',root.platform,
          'url',root.url,'text_sha256','sha256:'||encode(sha256(convert_to(root.text_clean,'UTF8')),'hex')) root_metadata,
        roots.provenance,roots.semantic_eligible
      FROM roots JOIN LATERAL (SELECT id,workspace_id,canonical_mention_id,inclusion_status,exclusion_reason,
        text_clean,published_at,language,country,platform,url FROM mentions WHERE id=roots.root_id OFFSET 0) root
        ON root.workspace_id=$1::uuid AND root.id=root.canonical_mention_id`,[run.workspace_id]);
    await client.query(`INSERT INTO signal_corpus_text_assets(workspace_id,text_sha256,chunk_policy_version,full_text)
      SELECT DISTINCT $1::uuid,asset_sha256,$2,full_text FROM corpus_preparation_snapshot_roots
      WHERE asset_sha256 IS NOT NULL ON CONFLICT(workspace_id,text_sha256,chunk_policy_version) DO NOTHING`,[run.workspace_id,SIGNAL_CORPUS_CHUNK_POLICY_V1]);
    await client.query(`INSERT INTO signal_corpus_preparation_items(workspace_id,run_id,root_id,asset_sha256,
      chunk_policy_version,disposition,root_metadata,provenance,semantic_eligible,fingerprint)
      SELECT $1::uuid,$2::uuid,root_id,asset_sha256,$3,disposition,root_metadata,provenance,semantic_eligible,
        'sha256:'||encode(sha256(convert_to(jsonb_build_object('root',root_metadata,'provenance',provenance,
          'asset',asset_sha256,'disposition',disposition,'semantic',semantic_eligible)::text,'UTF8')),'hex')
      FROM corpus_preparation_snapshot_roots`,[run.workspace_id,run.id,SIGNAL_CORPUS_CHUNK_POLICY_V1]);
    // A new run/workspace is absent from old statistics. Refresh only the derived
    // lookup columns once after materialization, never full text, JSONB, or each page.
    await client.query("ANALYZE signal_corpus_text_assets (workspace_id,text_sha256,chunk_policy_version)");
    await client.query("ANALYZE signal_corpus_preparation_items (workspace_id,run_id,root_id,asset_sha256,chunk_policy_version,disposition)");
    const previous=(await client.query<{id:string}>(`SELECT id FROM signal_corpus_preparation_runs WHERE workspace_id=$1::uuid
      AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[run.workspace_id])).rows[0]?.id??null;
    const counted=(await client.query<Record<string,string>>(`SELECT count(*)::text total_roots,
      count(*) FILTER(WHERE disposition='eligible')::text eligible_roots,
      count(*) FILTER(WHERE disposition='excluded')::text excluded_roots,
      count(*) FILTER(WHERE disposition='rights_blocked')::text rights_blocked_roots,
      count(*) FILTER(WHERE disposition='inclusion_pending')::text inclusion_pending_roots,
      count(*) FILTER(WHERE disposition='missing_text')::text missing_text_roots
      FROM signal_corpus_preparation_items WHERE run_id=$1::uuid`,[run.id])).rows[0]!;
    if(Number(counted.total_roots)!==readiness.projection.linked_roots)return fail("corpus_preparation_source_incomplete",422);
    const delta=(await client.query<Record<string,string>>(`WITH compared AS (
      SELECT root_id,bool_or(is_current) current,bool_or(NOT is_current) previous,count(DISTINCT fingerprint) versions
      FROM (SELECT root_id,fingerprint,true is_current FROM signal_corpus_preparation_items WHERE run_id=$1::uuid
        UNION ALL SELECT root_id,fingerprint,false FROM signal_corpus_preparation_items WHERE run_id=$2::uuid) items GROUP BY root_id
    ) SELECT count(*) FILTER(WHERE current AND NOT previous)::text new_roots,
      count(*) FILTER(WHERE current AND previous AND versions=1)::text reused_roots,
      count(*) FILTER(WHERE current AND previous AND versions>1)::text changed_roots,
      count(*) FILTER(WHERE previous AND NOT current)::text removed_roots FROM compared`,[run.id,previous])).rows[0]!;
    const counts={...zeroCounts(),...Object.fromEntries(Object.entries({...counted,...delta}).map(([key,value])=>[key,Number(value)]))};
    // Time-based activation/expiration is an input transition even without a row update.
    await client.query(`UPDATE signal_corpus_preparation_runs SET phase='chunking',input_revision=$2::bigint,
      previous_run_id=$3::uuid,snapshot_at=statement_timestamp(),counts=$4::jsonb,
      accepted_imports=(SELECT COALESCE(jsonb_agg(evidence||jsonb_build_object('authorized',authorized) ORDER BY import_batch_id),'[]'::jsonb)
        FROM corpus_preparation_snapshot_sources),
      policy_valid_until=(SELECT min(boundary) FROM (
        SELECT effective_from boundary FROM signal_provenance_policy_bindings WHERE workspace_id=$5::uuid AND status='active'
        UNION ALL SELECT effective_to FROM signal_provenance_policy_bindings WHERE workspace_id=$5::uuid AND status='active'
        UNION ALL SELECT effective_from FROM signal_retention_policies WHERE workspace_id=$5::uuid AND status='active'
        UNION ALL SELECT effective_to FROM signal_retention_policies WHERE workspace_id=$5::uuid AND status='active'
        UNION ALL SELECT retain_until FROM signal_retention_policies WHERE workspace_id=$5::uuid AND status='active'
        UNION ALL SELECT effective_from FROM signal_licensing_policies WHERE workspace_id=$5::uuid AND status='active'
        UNION ALL SELECT effective_to FROM signal_licensing_policies WHERE workspace_id=$5::uuid AND status='active'
      ) deadlines WHERE boundary>now()),execution_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
      WHERE id=$1::uuid`,[run.id,run.current_revision,previous,JSON.stringify(counts),run.workspace_id]);
    return {...args.lease,phase:"chunking",cursor:null};
  });
}
export async function finishSignalWorkspaceCorpusPreparationV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;lease:SignalWorkspaceCorpusPreparationLeaseV1}):Promise<{status:"completed"|"superseded"}> {
  return transaction(args.database,async client=>{
    const run=await lockedLease(client,args.lease,false);
    if(run.input_revision!==run.current_revision || !run.policy_live){
      await client.query(`UPDATE signal_corpus_preparation_runs SET status='superseded',error_code='corpus_preparation_inputs_changed',
        execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id]);
      return {status:"superseded"};
    }
    if(run.phase!=="chunking"||run.counts.processed_roots!==run.counts.total_roots)return fail("corpus_preparation_page_incomplete");
    const pending=(await client.query<{pending:boolean}>(`SELECT EXISTS(SELECT 1 FROM signal_corpus_preparation_items
      WHERE run_id=$1::uuid AND ($2::uuid IS NULL OR root_id>$2::uuid)) pending`,[run.id,run.cursor_root_id])).rows[0]?.pending;
    if(pending)return fail("corpus_preparation_page_incomplete");
    await client.query(`UPDATE signal_corpus_preparation_runs SET status='completed',phase='complete',error_code=NULL,
      completed_at=clock_timestamp(),updated_at=clock_timestamp(),execution_token=NULL,execution_expires_at=NULL,
      dispatch_status='dispatched',dispatch_token=NULL,dispatch_expires_at=NULL,dispatch_attempts=0 WHERE id=$1::uuid`,[run.id]);
    return {status:"completed"};
  });
}
export async function failSignalWorkspaceCorpusPreparationV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;lease:SignalWorkspaceCorpusPreparationLeaseV1;error_code?:string}) {
  const known=new Set(["corpus_preparation_worker_failed","corpus_preparation_queue_unavailable","corpus_preparation_forbidden",
    "corpus_preparation_inputs_changed","corpus_preparation_asset_hash_mismatch","corpus_preparation_checkpoint_invalid",
    "corpus_preparation_chunk_integrity_failed","corpus_preparation_source_incomplete","corpus_preparation_import_required",
    "corpus_preparation_checkpoint_conflict","corpus_preparation_page_incomplete","corpus_preparation_asset_not_found"]);
  const error=known.has(args.error_code??"")?args.error_code!:"corpus_preparation_worker_failed";
  // Failure must remain persistable after revocation or an input transition. The token
  // still fences off a superseded Worker; no fresh permission is required to stop work.
  await args.database.query(`UPDATE signal_corpus_preparation_runs SET status=$4,error_code=$3,
    execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp()
    WHERE id=$1::uuid AND workspace_id=$5::uuid AND execution_token=$2::uuid AND status='running'`,
  [args.lease.run_id,args.lease.execution_token,error,error==="corpus_preparation_inputs_changed"?"superseded":"failed",args.lease.workspace_id]);
}
export async function scheduleSignalWorkspaceCorpusPreparationV1(args:{database:SignalWorkspaceCorpusPreparationDatabaseV1;limit?:number}):Promise<number> {
  // Recover lost execution independently of Redis acknowledgement. Expired execution
  // gets a new durable dispatch generation; losing dispatch ACK alone keeps its job id.
  await args.database.query(`UPDATE signal_corpus_preparation_runs SET status='queued',dispatch_status='pending',
    dispatch_generation=dispatch_generation+1,worker_job_id='corpus-preparation-'||id::text||'-'||(dispatch_generation+1)::text,
    dispatch_token=NULL,dispatch_expires_at=NULL,execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp()
    WHERE status='running' AND execution_expires_at<clock_timestamp()`);
  await args.database.query(`UPDATE signal_corpus_preparation_runs SET dispatch_status='pending',updated_at=clock_timestamp()
    WHERE status='queued' AND dispatch_status='dispatched' AND updated_at<clock_timestamp()-interval '30 seconds'`);
  const candidates=(await args.database.query<{workspace_id:string;actor_user_id:string;input_revision:string}>(`
    SELECT state.workspace_id,last.actor_user_id,state.input_revision::text
    FROM signal_corpus_preparation_input_state state
    JOIN LATERAL (SELECT * FROM signal_corpus_preparation_runs WHERE workspace_id=state.workspace_id
      ORDER BY created_at DESC,id DESC LIMIT 1) last ON true
    WHERE NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_runs active WHERE active.workspace_id=state.workspace_id AND active.status IN('queued','running'))
      AND (last.input_revision IS DISTINCT FROM state.input_revision
        OR last.policy_valid_until IS NOT NULL AND last.policy_valid_until<=clock_timestamp())
      AND (last.status='completed' OR last.status='superseded' OR last.input_revision IS NOT NULL)
    ORDER BY state.updated_at,state.workspace_id LIMIT $1`,[Math.max(1,Math.min(32,args.limit??8))])).rows;
  let scheduled=0;
  const {requestSignalWorkspaceCorpusPreparationStoreV1}=await import("./signal-workspace-corpus-preparation-management");
  for(const candidate of candidates){
    try {
      await requestSignalWorkspaceCorpusPreparationStoreV1({database:args.database,workspace_id:candidate.workspace_id,
        actor_user_id:candidate.actor_user_id,idempotency_key:`automatic-${candidate.input_revision}-${randomUUID()}`});
      scheduled++;
    }catch(error){if(!(error instanceof SignalWorkspaceCorpusPreparationError && error.status===403))throw error;}
  }
  return scheduled;
}
