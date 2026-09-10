import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { signalWorkspaceEmbeddingDigestV1 as digest } from '@noisia/query-engine';
import {
  SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1,
  claimSignalWorkspaceIncrementalEditorialPreparationV1,
  readSignalWorkspaceIncrementalEditorialPreparationContextV1,
  readSignalWorkspaceIncrementalEditorialPreparationOriginsV1,
  readSignalWorkspaceIncrementalEditorialPreparationExclusionsV1,
  readSignalWorkspaceIncrementalEditorialPreparationRootsV1,
  readSignalWorkspaceIncrementalEditorialPreparationFragmentsV1,
  heartbeatSignalWorkspaceIncrementalEditorialPreparationV1,
  completeSignalWorkspaceIncrementalEditorialPreparationV1,
  failSignalWorkspaceIncrementalEditorialPreparationV1,
  rejectSignalWorkspaceIncrementalEditorialPreparationDispatchV1,
  type SignalWorkspaceEngineDatabaseV1, type SignalWorkspaceIncrementalCheckpointV1,
  type SignalWorkspaceIncrementalArtifactRefV1,
  type SignalWorkspaceIncrementalEditorialPreparationLeaseV1,
} from '@noisia/db';
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from './signal-workspace-engine-storage';
import { prepareWorkspaceIncrementalProjectionFilesV1 as prepare } from './signal-workspace-incremental-projection-files';
import { storeWorkspaceIncrementalEditorialEvidenceV1 as storeEvidence } from './signal-workspace-incremental-editorial-evidence-storage';
import type { WorkspaceIncrementalEditorialOriginV1, WorkspaceIncrementalEditorialExclusionV1 } from './signal-workspace-incremental-editorial-evidence';

export const workspaceIncrementalEditorialEvidenceStoresV1 = {
  claim: claimSignalWorkspaceIncrementalEditorialPreparationV1, context: readSignalWorkspaceIncrementalEditorialPreparationContextV1,
  origins: readSignalWorkspaceIncrementalEditorialPreparationOriginsV1, exclusions: readSignalWorkspaceIncrementalEditorialPreparationExclusionsV1,
  roots: readSignalWorkspaceIncrementalEditorialPreparationRootsV1, fragments: readSignalWorkspaceIncrementalEditorialPreparationFragmentsV1,
  heartbeat: heartbeatSignalWorkspaceIncrementalEditorialPreparationV1, complete: completeSignalWorkspaceIncrementalEditorialPreparationV1,
  fail: failSignalWorkspaceIncrementalEditorialPreparationV1,
  reject: rejectSignalWorkspaceIncrementalEditorialPreparationDispatchV1,
};
export type WorkspaceIncrementalEditorialEvidenceStoresV1 = typeof workspaceIncrementalEditorialEvidenceStoresV1;
type Options = { database?: SignalWorkspaceEngineDatabaseV1; stores?: WorkspaceIncrementalEditorialEvidenceStoresV1;
  storage?: WorkspaceEngineStorageV1; scratch_root?: string };
type Job = { name: string; id?: string; data: unknown; updateProgress?(value: number): Promise<unknown> };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const hash = /^sha256:[0-9a-f]{64}$/u;
const MAX_METADATA = 8 * 1024 * 1024;
const fail = (suffix: string): never => { throw new Error(`workspace_incremental_editorial_preparation_${suffix}`); };
export function safeWorkspaceIncrementalEditorialPreparationErrorV1(error: unknown) {
  const code=error && typeof error==='object' && 'code' in error ? String(error.code) : '';
  const message=error instanceof Error ? error.message : '';
  if(['ECONNRESET','ETIMEDOUT','ECONNREFUSED','EPIPE','ENOTFOUND','57P01','57P02','57P03','08000','08003','08006','40001','40P01'].includes(code)
    || ['workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable'].includes(message))
    return 'workspace_incremental_editorial_preparation_transport_unavailable';
  return /^workspace_(?:incremental_editorial_preparation|incremental_editorial_evidence|incremental_projection_files|engine_storage)_[a-z_]{1,100}$/u.test(message)
    ? message : 'workspace_incremental_editorial_preparation_failed';
}

/** Free, explicit preparation only. Every reference and actor comes from the
 * accepted DB operation. No models, embedding cache, provider or engine lease. */
export async function signalWorkspaceIncrementalEditorialEvidenceJobV1(job: Job, options: Options = {}) {
  const data=job.data as { execution_id?: unknown; workspace_id?: unknown; actor_user_id?: unknown } | null;
  if(job.name!==SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_EVIDENCE_JOB_V1 || !job.id || !data
    || ![data.execution_id,data.workspace_id,data.actor_user_id].every(value=>typeof value==='string'&&uuid.test(value))
    || !new RegExp(`^workspace-incremental-editorial-evidence-${data.execution_id}-[0-9a-f]{64}$`,'u').test(job.id)) return fail('job_invalid');
  const database=options.database??(await import('../db/client')).pool, stores=options.stores??workspaceIncrementalEditorialEvidenceStoresV1;
  const scope={ database, numeric_execution_id:data.execution_id as string, workspace_id:data.workspace_id as string,
    actor_user_id:data.actor_user_id as string, worker_job_id:job.id };
  let lease:SignalWorkspaceIncrementalEditorialPreparationLeaseV1|undefined, directory:string|undefined;
  let pending:Promise<unknown>|undefined, heartbeatError:unknown, timer:ReturnType<typeof setInterval>|undefined;
  const heartbeat=async()=>{if(heartbeatError)throw heartbeatError;if(!lease)return;
    pending??=stores.heartbeat({database,lease}).catch(error=>{heartbeatError=error;throw error;}).finally(()=>{pending=undefined;});await pending;};
  try {
    const claimed=await stores.claim(scope); if(claimed.completed)return{artifact_id:claimed.artifact_id,replayed:true};
    lease=claimed.lease;
    if(lease.numeric_execution_id!==scope.numeric_execution_id||lease.workspace_id!==scope.workspace_id||lease.actor_user_id!==scope.actor_user_id
      || lease.worker_job_id!==job.id||!uuid.test(lease.preparation_token)||!hash.test(lease.source_digest))return fail('lease_invalid');
    timer=setInterval(()=>{void heartbeat().catch(()=>undefined);},15000);timer.unref();
    const request={database,lease},context=await stores.context(request);
    if(digest(context.lease)!==digest(lease))return fail('source_changed');
    const storage=options.storage??createWorkspaceEngineStorageV1(),scratch=resolve(options.scratch_root??join(tmpdir(),'noisia-editorial-evidence'));
    await mkdir(scratch,{recursive:true,mode:0o700});const storage_root=await realpath(scratch);directory=await mkdtemp(join(storage_root,'prepare-'));
    type Files=Parameters<typeof prepare>[0];
    const local=new Map<string,{files:Files;refs:Map<string,SignalWorkspaceIncrementalArtifactRefV1>}>();
    async function download(owner:string,checkpoint:SignalWorkspaceIncrementalCheckpointV1,refs:SignalWorkspaceIncrementalArtifactRefV1[],candidate:boolean):Promise<Files>{
      const allowed=['manifest.json','roots.jsonl','population.jsonl','memberships.jsonl','pending-cohort.jsonl','model-components.json',...(candidate?['candidate-groups.json']:[])];
      if(!uuid.test(owner)||refs.length!==allowed.length||new Set(refs.map(ref=>ref.artifact_key)).size!==allowed.length
        || refs.some(ref=>ref.owner_execution_id!==owner||!allowed.includes(ref.artifact_key)||!hash.test(ref.sha256)||!Number.isSafeInteger(ref.size_bytes)||ref.size_bytes<0))return fail('artifact_invalid');
      const prior=local.get(owner),destination=prior?.files.directory??join(directory!,owner);
      if(!prior)await mkdir(destination,{mode:0o700});
      for(const ref of refs){const existing=prior?.refs.get(ref.artifact_key);
        if(existing){if(digest(existing)!==digest(ref))return fail('artifact_changed');continue;}
        await storage.get({workspace_id:scope.workspace_id,execution_id:owner,stored:ref,destination:join(destination,ref.artifact_key)});await heartbeat();}
      const manifest=refs.find(ref=>ref.artifact_id===checkpoint.output_artifact_id);
      if(!manifest||manifest.artifact_key!=='manifest.json')return fail('manifest_missing');
      const files:Files={storage_root,directory:destination,manifest_ref:{file:'manifest.json',sha256:manifest.sha256,bytes:manifest.size_bytes},
        checkpoint:{...checkpoint,workspace_id:scope.workspace_id,execution_id:owner,
          discovery_status:checkpoint.discovery_status as Files['checkpoint']['discovery_status'],relations_status:checkpoint.relations_status as Files['checkpoint']['relations_status']}};
      local.set(owner,{files,refs:new Map(refs.map(ref=>[ref.artifact_key,ref]))});return files;
    }
    const current=await download(scope.numeric_execution_id,context.checkpoint,context.artifacts,false),validated=await prepare(current);
    const roots=validated.roots()[Symbol.asyncIterator]();let next=await roots.next(),afterRoot:string|undefined;
    try {for(;;){const page=await stores.roots({...request,after_root_id:afterRoot,limit:128});
      if(page.items.length>128||!page.done&&!page.items.length)return fail('root_page_invalid');
      for(const root of page.items){if(next.done||afterRoot!==undefined&&root.root_id<=afterRoot)return fail('population_changed');
        const {unit_keys:_units,state:_state,discovery_pending:_pending,...identity}=next.value.root;
        if(digest(root)!==digest(identity))return fail('population_changed');afterRoot=root.root_id;next=await roots.next();}
      if(page.next_cursor!==(afterRoot??null))return fail('root_page_invalid');await heartbeat();if(page.done)break;}
      if(!next.done)return fail('population_changed');
    }finally{await roots.return?.();}
    const origins:WorkspaceIncrementalEditorialOriginV1[]=[],exclusions:WorkspaceIncrementalEditorialExclusionV1[]=[];
    let afterOrigin:string|undefined,afterUnit:string|undefined,metadataBytes=0;
    for(;;){const page=await stores.origins({...request,after_execution_id:afterOrigin,limit:64});
      if(page.items.length>128||!page.done&&!page.items.length)return fail('origin_page_invalid');
      for(const origin of page.items){metadataBytes+=Buffer.byteLength(JSON.stringify(origin));if(metadataBytes>MAX_METADATA)return fail('metadata_capacity_exceeded');
        const owner=origin.kind==='full_fit'?origin.model_origin.execution_id:origin.execution_id;
        if(afterOrigin!==undefined&&owner<=afterOrigin)return fail('origin_page_invalid');
        if(origin.kind==='full_fit')origins.push(origin);else origins.push({kind:'incremental',files:await download(owner,origin.checkpoint,origin.artifacts,true)});}
      const last=page.items.at(-1),lastId=last?(last.kind==='full_fit'?last.model_origin.execution_id:last.execution_id):null;
      if(page.next_cursor!==lastId)return fail('origin_page_invalid');afterOrigin=page.next_cursor??undefined;await heartbeat();if(page.done)break;}
    for(;;){const page=await stores.exclusions({...request,after_unit_key:afterUnit,limit:128});
      if(page.items.length>128||!page.done&&!page.items.length)return fail('exclusion_page_invalid');
      for(const exclusion of page.items){if(afterUnit!==undefined&&exclusion.unit_key<=afterUnit)return fail('exclusion_page_invalid');
        metadataBytes+=Buffer.byteLength(JSON.stringify(exclusion));if(metadataBytes>MAX_METADATA)return fail('metadata_capacity_exceeded');exclusions.push(exclusion);afterUnit=exclusion.unit_key;}
      if(page.next_cursor!==(afterUnit??null))return fail('exclusion_page_invalid');await heartbeat();if(page.done)break;}
    const result=await storeEvidence({workspace_id:scope.workspace_id,numeric_execution_id:scope.numeric_execution_id,scratch_root:directory,
      storage,evidence:{current,origins,exclusions,read_fragments:async references=>{await heartbeat();return stores.fragments({...request,references});}}});
    await heartbeat();
    const completed=await stores.complete({...request,evidence:result.evidence,stored:result.stream});
    await job.updateProgress?.(100).catch(()=>undefined);return completed;
  } catch(error) {
    const code=safeWorkspaceIncrementalEditorialPreparationErrorV1(error);
    if(lease)await stores.fail({database,lease,error_code:code}).catch(()=>undefined);
    else await stores.reject({...scope,error_code:code}).catch(()=>undefined);
    throw new Error(code);
  } finally {
    if(timer)clearInterval(timer);await pending?.catch(()=>undefined);
    if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>undefined);
  }
}
