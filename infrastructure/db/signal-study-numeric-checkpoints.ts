import{createHash,randomUUID}from'node:crypto';
import type{StudyRuntimeLeaseV1,StudyRuntimeNumericPlanV1,StudyRuntimeNumericComputedV1,StudyRuntimeStoredNumericV1}from'../../services/workers/src/workers/signal-study-runtime';
import type{StudyNumericManifestV1}from'@noisia/query-engine';
import type{ListeningDiscoveryNumericStorageV1 as Storage,ListeningDiscoveryNumericArtifactDescriptorV1 as Descriptor}from'./signal-listening-discovery-advance';
import{studyTransactionV1,studyFailV1 as fail,studyDigestV1 as digest,type StudyDatabaseV1}from'./signal-study-core';
import{lockSignalStudyExecutionWithClientV1}from'./signal-study-executions';
import{loadSignalStudyNumericSourceWithClientV1}from'./signal-study-numeric-source';
const sha=(text:string)=>'sha256:'+createHash('sha256').update(text).digest('hex');
type NumericRow={id:string;workspace_id:string;execution_id:string;numeric_key:string;manifest_json:string;manifest_sha256:string;artifact_manifest:Array<{name:string;sha256:string;size_bytes:number;storage_key:string}>;artifacts_digest:string;verification_status:'planned'|'verified';value:StudyRuntimeNumericComputedV1['value'];value_digest:string;request_sha256:string;fit_plan_digest:string};
type Args={database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeNumericPlanV1;storage:Storage};
async function existing(args:Args){return(await args.database.query<NumericRow>('SELECT * FROM signal_study_numeric_checkpoints WHERE execution_id=$1 AND workspace_id=$2 AND numeric_key=$3',[args.lease.execution_id,args.lease.workspace_id,args.plan.key])).rows[0]??null;}
function stored(row:NumericRow):StudyRuntimeStoredNumericV1{return{value:row.value,value_digest:row.value_digest,manifest_json:row.manifest_json,manifest_sha256:row.manifest_sha256,verified:true};}
function descriptor(row:NumericRow,a:NumericRow['artifact_manifest'][number]):Descriptor&{storage_key:string}{return{workspace_id:row.workspace_id,execution_id:row.execution_id,checkpoint_id:row.id,...a};}
async function verifyAll(row:NumericRow,storage:Storage){for(const a of row.artifact_manifest){try{if(!await storage.verify(descriptor(row,a)))return false;}catch{return false;}}return true;}
async function verifyAndAttach(args:Args,row:NumericRow):Promise<StudyRuntimeStoredNumericV1>{
 if(row.request_sha256!==args.plan.request_sha256||row.fit_plan_digest!==args.plan.fit_plan_digest||sha(row.manifest_json)!==row.manifest_sha256||digest(row.artifact_manifest)!==row.artifacts_digest)fail('numeric_intent_conflict');
 if(!await verifyAll(row,args.storage))return{status:'pending',manifest_sha256:row.manifest_sha256};
 return studyTransactionV1(args.database,async c=>{await lockSignalStudyExecutionWithClientV1(c,args.lease);const held=(await c.query<NumericRow>('SELECT * FROM signal_study_numeric_checkpoints WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[row.id,args.lease.workspace_id])).rows[0];if(!held||held.manifest_sha256!==row.manifest_sha256||held.artifacts_digest!==row.artifacts_digest)fail('numeric_intent_conflict');
  if(held.verification_status!=='verified'){await c.query("SELECT set_config('noisia.study_numeric_verified_v1',$1,true)",[JSON.stringify({checkpoint_id:row.id,execution_token:args.lease.execution_token,manifest_sha256:row.manifest_sha256,artifacts_digest:row.artifacts_digest})]);await c.query("UPDATE signal_study_numeric_checkpoints SET verification_status='verified',verification_token=$2,verified_at=clock_timestamp() WHERE id=$1",[row.id,args.lease.execution_token]);}return stored(held);});
}
export async function readSignalStudyNumericCheckpointV1(args:Args):Promise<StudyRuntimeStoredNumericV1|null>{
 const row=await existing(args);if(!row)return null;return verifyAndAttach(args,row);
}
export async function persistSignalStudyNumericV1(args:Args&{computed:StudyRuntimeNumericComputedV1}):Promise<StudyRuntimeStoredNumericV1>{
 const old=await existing(args);if(old)return verifyAndAttach(args,old); // NEVER upload/refit an existing immutable result.
 const value=args.computed;if(sha(value.manifest_json)!==value.manifest_sha256||value.artifacts.length<2||value.artifacts.length>64)fail('numeric_manifest_invalid',422);
 let manifest:StudyNumericManifestV1;try{manifest=JSON.parse(value.manifest_json);}catch{return fail('numeric_manifest_invalid',422);}
 const artifacts=value.artifacts.map(({name,sha256,size_bytes})=>({name,sha256,size_bytes})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 if(new Set(artifacts.map(a=>a.name)).size!==artifacts.length||artifacts.some(a=>! /^(numeric-manifest\.json|source-proofs\.jsonl|(input|output)\/[a-z0-9][a-z0-9_.-]{0,100})$/u.test(a.name)||a.name.includes('..')||!/^sha256:[a-f0-9]{64}$/u.test(a.sha256)||!Number.isSafeInteger(a.size_bytes)||a.size_bytes<0))fail('numeric_artifact_invalid',422);
 const main=artifacts.find(a=>a.name==='numeric-manifest.json');if(!main||main.sha256!==value.manifest_sha256||main.size_bytes!==Buffer.byteLength(value.manifest_json)||digest([...manifest.artifacts].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0))!==digest(artifacts.filter(a=>a.name!=='numeric-manifest.json')))fail('numeric_artifact_manifest_invalid');
 await studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,args.lease),source=await loadSignalStudyNumericSourceWithClientV1(c,p,args.plan);if(!source||manifest.proof_census_digest!==source.context.proof_census_digest||manifest.fit_plan_digest!==source.fit_plan_digest)fail('numeric_source_unavailable');});
 const id=randomUUID(),references=artifacts.map(a=>{const storage_key=args.storage.reference({workspace_id:args.lease.workspace_id,execution_id:args.lease.execution_id,checkpoint_id:id,...a}).storage_key;
  if(!storage_key.startsWith('workspace-engine/'+args.lease.workspace_id+'/'+id+'/'))fail('numeric_storage_scope_invalid');return{...a,storage_key};});
 // Every byte is recoverable remotely BEFORE an intent is admitted. A lost
 // race leaves private unreferenced blobs, never a fabricated result or bill.
 for(const a of references){const d={workspace_id:args.lease.workspace_id,execution_id:args.lease.execution_id,checkpoint_id:id,...a},put=await args.storage.store(d);if(!put.verified||put.storage_key!==a.storage_key||put.sha256!==a.sha256||put.size_bytes!==a.size_bytes||!await args.storage.verify(d))fail('numeric_storage_verification_failed');}
 const row=await studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,args.lease),prior=(await c.query<NumericRow>('SELECT * FROM signal_study_numeric_checkpoints WHERE execution_id=$1 AND workspace_id=$2 AND numeric_key=$3',[p.id,p.workspace_id,args.plan.key])).rows[0];if(prior)return prior;
  const source=await loadSignalStudyNumericSourceWithClientV1(c,p,args.plan);if(!source||source.context.proof_census_digest!==manifest.proof_census_digest)fail('numeric_source_changed');const artifacts_digest=digest(references);
  await c.query("SELECT set_config('noisia.study_numeric_staged_v1',$1,true)",[JSON.stringify({checkpoint_id:id,execution_token:args.lease.execution_token,manifest_sha256:value.manifest_sha256,artifacts_digest})]);
  const inserted=(await c.query<NumericRow>(`INSERT INTO signal_study_numeric_checkpoints(id,workspace_id,execution_id,numeric_key,request_body,request_sha256,source_digest,fit_plan_digest,manifest_json,manifest_sha256,artifact_manifest,artifacts_digest,value,value_digest,planned_by_token)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15) RETURNING *`,[id,p.workspace_id,p.id,args.plan.key,args.plan.request_body,args.plan.request_sha256,p.source_digest,args.plan.fit_plan_digest,value.manifest_json,value.manifest_sha256,JSON.stringify(references),artifacts_digest,JSON.stringify(value.value),digest(value.value),args.lease.execution_token])).rows[0]!;
  await c.query(`INSERT INTO signal_study_numeric_artifacts(checkpoint_id,workspace_id,name,storage_key,sha256,size_bytes) SELECT $1,$2,x.name,x.storage_key,x.sha256,x.size_bytes FROM jsonb_to_recordset($3::jsonb)x(name text,storage_key text,sha256 text,size_bytes bigint)`,[id,p.workspace_id,JSON.stringify(references)]);return inserted;});
 if(row.manifest_sha256!==value.manifest_sha256||row.value_digest!==digest(value.value))fail('numeric_race_result_conflict');return verifyAndAttach(args,row);
}
