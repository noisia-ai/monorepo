import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {signalWorkspaceMassLabelingConfigV3,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {authorizeSignalListeningV1,listeningTransactionV1,listeningFailV1,type SignalListeningAccessV1} from './signal-listening-configuration';
import {assertMassLabelingMapCurrentV1} from './signal-mass-labeling';
import {snapshotSignalListeningDiscoveryOrphansWithClientV1,type ListeningDiscoveryGenerationV1} from './signal-listening-discovery';
import {lockSignalListeningDiscoveryPolicyWithClientV1,buildSignalListeningDiscoveryRoundV1,enqueueSignalListeningDiscoveryRoundWithClientV1,
 type ListeningDiscoveryExecutionV1,type ListeningDiscoveryRoundV1,type ListeningDiscoveryOrphanManifestV1} from './signal-listening-discovery-money';

type Database=SignalListeningAccessV1['database'];
export type ListeningDiscoveryAdvanceLeaseV1={execution_id:string;workspace_id:string;actor_user_id:string;execution_token:string;
 source_generation_id:string;next_ordinal:number;policy_version_id:string;policy_digest:string;human_revision_digest:string};
export type ListeningDiscoveryAdvanceContextV1={execution:ListeningDiscoveryExecutionV1;latest_round:ListeningDiscoveryRoundV1|null;
 source_generation:ListeningDiscoveryGenerationV1|null;classification_status:string;policy_version_id:string;policy_digest:string;human_revision_digest:string;stop_decision?:{stop:boolean;reason:string}};
export type ListeningDiscoveryAdvanceSubsetV1={id:string;workspace_id:string;generation_id:string;root_count:number;cached_count:number;subset_digest:string};
export type ListeningDiscoveryStoredNumericV1={manifest_json:string;manifest_sha256:string;verified:true};
export type ListeningDiscoveryNumericCheckpointV1=ListeningDiscoveryStoredNumericV1|{status:'pending';manifest_sha256:string};
export type ListeningDiscoveryNumericArtifactDescriptorV1={workspace_id:string;execution_id:string;checkpoint_id:string;name:string;sha256:string;size_bytes:number;storage_key?:string};
export type ListeningDiscoveryNumericStorageV1={reference(d:ListeningDiscoveryNumericArtifactDescriptorV1):{storage_key:string};
 store(d:ListeningDiscoveryNumericArtifactDescriptorV1):Promise<{storage_key:string;sha256:string;size_bytes:number;verified:true}>;
 verify(d:ListeningDiscoveryNumericArtifactDescriptorV1&{storage_key:string}):Promise<boolean>};
export type ListeningDiscoveryNumericInputV1={manifest_json:string;manifest_sha256:string;artifacts:Array<{name:string;sha256:string;size_bytes:number}>};
export type ListeningDiscoveryAdvanceEnqueueResultV1=ListeningDiscoveryRoundV1|{status:'budget_exhausted';execution_id:string;workspace_id:string;
 error_code:'listening_discovery_parent_budget_exhausted';cap_micro_usd:string;exposure_micro_usd:string;reservation_micro_usd:string}|null;
type LeaseArgs={database:Database;lease:ListeningDiscoveryAdvanceLeaseV1};
type Hop=ListeningDiscoveryAdvanceLeaseV1&{id:string;configuration_id:string;source_digest:string;root_census_digest:string;live?:boolean};
type Source=Omit<ListeningDiscoveryAdvanceLeaseV1,'execution_id'|'execution_token'>&{map_id:string;configuration_id:string;classification_run_id:string;latest_round_id:string|null;stop_decision:{stop:boolean;reason:string}};
type NumericRow={id:string;workspace_id:string;advance_id:string;execution_id:string;generation_id:string;subset_id:string;numeric_config_digest:string;
 manifest_json:string;manifest_sha256:string;source_proofs_sha256:string;source_proofs_digest:string;artifact_manifest:Array<{name:string;storage_key:string;sha256:string;size_bytes:number}>;
 artifacts_digest:string;verification_status:'planned'|'verified'};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u,hash=/^sha256:[a-f0-9]{64}$/u;
const sha=(raw:string)=>'sha256:'+createHash('sha256').update(raw,'utf8').digest('hex');
function fail(code:string,status=409):never{return listeningFailV1(code,status);}
function validateLease(lease:ListeningDiscoveryAdvanceLeaseV1){
 if(!lease||![lease.execution_id,lease.workspace_id,lease.actor_user_id,lease.execution_token,lease.source_generation_id,lease.policy_version_id].every(id=>typeof id==='string'&&uuid.test(id))
  ||![lease.policy_digest,lease.human_revision_digest].every(value=>typeof value==='string'&&hash.test(value))||!Number.isInteger(lease.next_ordinal)||lease.next_ordinal<1||lease.next_ordinal>3)fail('listening_discovery_advance_lease_invalid',422);
}
async function source(c:PoolClient,execution:string){return(await c.query<Source>('SELECT * FROM signal_listening_discovery_advance_source_v1($1)',[execution])).rows[0]??null;}
function sameSource(lease:ListeningDiscoveryAdvanceLeaseV1,s:Source|null){return!!s&&!s.stop_decision.stop&&lease.workspace_id===s.workspace_id&&lease.actor_user_id===s.actor_user_id
 &&lease.source_generation_id===s.source_generation_id&&lease.next_ordinal===s.next_ordinal&&lease.policy_version_id===s.policy_version_id&&lease.policy_digest===s.policy_digest&&lease.human_revision_digest===s.human_revision_digest;}
async function lockedHop(c:PoolClient,lease:ListeningDiscoveryAdvanceLeaseV1):Promise<Hop>{
 validateLease(lease);
 const h=(await c.query<Hop>(`WITH locked AS MATERIALIZED(SELECT * FROM signal_listening_discovery_advances
  WHERE execution_id=$1 AND workspace_id=$2 AND actor_user_id=$3 AND next_ordinal=$4 AND execution_token=$5 FOR UPDATE)
  SELECT locked.*,execution_expires_at>clock_timestamp() live FROM locked`,[lease.execution_id,lease.workspace_id,lease.actor_user_id,lease.next_ordinal,lease.execution_token])).rows[0];
 if(!h?.live||h.source_generation_id!==lease.source_generation_id||h.policy_version_id!==lease.policy_version_id||h.policy_digest!==lease.policy_digest||h.human_revision_digest!==lease.human_revision_digest)fail('listening_discovery_advance_lease_lost');return h;
}
/** Organization/day -> configuration -> mutable actor -> parent -> hop. */
async function readyAuthority(c:PoolClient,execution:string,lease?:ListeningDiscoveryAdvanceLeaseV1){
 const scope=(await c.query<ListeningDiscoveryExecutionV1>('SELECT * FROM signal_listening_discovery_executions WHERE id=$1',[execution])).rows[0];if(!scope)return null;
 const policy=await lockSignalListeningDiscoveryPolicyWithClientV1(c,scope.workspace_id);
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-listening-config:'||$1,0))",[scope.workspace_id]);
 await authorizeSignalListeningV1(c,scope,'process');
 const p=(await c.query<ListeningDiscoveryExecutionV1>('SELECT * FROM signal_listening_discovery_executions WHERE id=$1 FOR UPDATE',[execution])).rows[0]!;
 if(p.policy_version_id!==policy.id)return null;
 const s=await source(c,p.id);if(!s||lease&&!sameSource(lease,s))return null;
 await assertMassLabelingMapCurrentV1(c,p.workspace_id,p.map_id);return{p,s};
}
function expectedStop(error:unknown){return error instanceof Error&&/^(listening_forbidden|listening_not_enabled|listening_discovery_policy_unavailable|mass_labeling_map_stale|mass_labeling_context_changed)$/u.test(error.message);}

export async function claimSignalListeningDiscoveryAdvanceV1(args:{database:Database;execution_id:string}):Promise<ListeningDiscoveryAdvanceLeaseV1|null>{
 if(!uuid.test(args.execution_id))fail('listening_discovery_advance_invalid',422);
 try{return await listeningTransactionV1(args.database,async c=>{
  const ready=await readyAuthority(c,args.execution_id);if(!ready)return null;const {p,s}=ready;
  if(s.stop_decision.stop){await c.query("UPDATE signal_listening_discovery_executions SET status='completed',error_code='listening_discovery_no_category_population' WHERE id=$1",[p.id]);return null;}
  const old=(await c.query<{id:string;held:boolean}>(`WITH locked AS MATERIALIZED(SELECT * FROM signal_listening_discovery_advances WHERE execution_id=$1 AND next_ordinal=$2 FOR UPDATE)
   SELECT id,execution_token IS NOT NULL AND execution_expires_at>clock_timestamp() held FROM locked`,[p.id,s.next_ordinal])).rows[0];if(old?.held)return null;
  const token=randomUUID();
  const row=(await c.query<Hop>(old?`UPDATE signal_listening_discovery_advances SET execution_token=$2,execution_expires_at=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp() WHERE id=$1 RETURNING *`:
   `INSERT INTO signal_listening_discovery_advances(execution_id,workspace_id,actor_user_id,source_generation_id,configuration_id,next_ordinal,policy_version_id,policy_digest,human_revision_digest,source_digest,root_census_digest,execution_token,execution_expires_at)
    SELECT p.id,$2,$3,$4,$5,$6,$7,$8,$9,g.snapshot_digest,p.root_census_digest,$10,clock_timestamp()+interval '300 seconds'
    FROM signal_listening_discovery_executions p JOIN signal_listening_discovery_generations g ON g.id=$4 AND g.workspace_id=p.workspace_id WHERE p.id=$1 RETURNING *`,
   old?[old.id,token]:[p.id,p.workspace_id,p.actor_user_id,s.source_generation_id,s.configuration_id,s.next_ordinal,s.policy_version_id,s.policy_digest,s.human_revision_digest,token])).rows[0]!;
  return{execution_id:row.execution_id,workspace_id:row.workspace_id,actor_user_id:row.actor_user_id,execution_token:row.execution_token,source_generation_id:row.source_generation_id,next_ordinal:row.next_ordinal,policy_version_id:row.policy_version_id,policy_digest:row.policy_digest,human_revision_digest:row.human_revision_digest};
 });}catch(error){if(expectedStop(error))return null;throw error;}
}
export async function getSignalListeningDiscoveryAdvanceContextV1(args:LeaseArgs):Promise<ListeningDiscoveryAdvanceContextV1|null>{
 validateLease(args.lease);
 try{return await listeningTransactionV1(args.database,async c=>{
  const ready=await readyAuthority(c,args.lease.execution_id,args.lease);if(!ready)return null;await lockedHop(c,args.lease);
  const g=(await c.query<ListeningDiscoveryGenerationV1>('SELECT * FROM signal_listening_discovery_generations WHERE workspace_id=$1 AND id=$2',[args.lease.workspace_id,args.lease.source_generation_id])).rows[0]!;
  const last=ready.s.latest_round_id?(await c.query<ListeningDiscoveryRoundV1>('SELECT * FROM signal_listening_discovery_rounds WHERE workspace_id=$1 AND id=$2',[args.lease.workspace_id,ready.s.latest_round_id])).rows[0]!:null;
  return{execution:ready.p,latest_round:last,source_generation:g,classification_status:'completed',policy_version_id:ready.s.policy_version_id,policy_digest:ready.s.policy_digest,human_revision_digest:ready.s.human_revision_digest,stop_decision:ready.s.stop_decision};
 });}catch(error){if(expectedStop(error)||error instanceof Error&&error.message==='listening_discovery_advance_lease_lost')return null;throw error;}
}
export async function renewSignalListeningDiscoveryAdvanceV1(args:LeaseArgs):Promise<boolean>{
 validateLease(args.lease);return listeningTransactionV1(args.database,async c=>{let h:Hop;try{h=await lockedHop(c,args.lease);}catch(error){if(error instanceof Error&&error.message==='listening_discovery_advance_lease_lost')return false;throw error;}
  return(await c.query("UPDATE signal_listening_discovery_advances SET execution_expires_at=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp() WHERE id=$1 RETURNING id",[h.id])).rows.length===1;});
}
export async function releaseSignalListeningDiscoveryAdvanceV1(args:LeaseArgs):Promise<boolean>{
 validateLease(args.lease);return listeningTransactionV1(args.database,async c=>{let h:Hop;try{h=await lockedHop(c,args.lease);}catch(error){if(error instanceof Error&&error.message==='listening_discovery_advance_lease_lost')return false;throw error;}
  return(await c.query('UPDATE signal_listening_discovery_advances SET execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING id',[h.id])).rows.length===1;});
}
export async function ensureSignalListeningDiscoveryAdvanceSubsetV1(args:LeaseArgs&{generation_id:string}):Promise<ListeningDiscoveryAdvanceSubsetV1>{
 if(args.generation_id!==args.lease.source_generation_id)fail('listening_discovery_advance_source_invalid');
 return listeningTransactionV1(args.database,async c=>{
  if(!await readyAuthority(c,args.lease.execution_id,args.lease))fail('listening_discovery_advance_source_invalid');await lockedHop(c,args.lease);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('listening-discovery-subset:'||$1,0))",[args.generation_id]);
  const existing=(await c.query<ListeningDiscoveryAdvanceSubsetV1>(`SELECT s.* FROM signal_listening_discovery_subset_bindings b JOIN signal_listening_discovery_subsets s ON s.id=b.subset_id AND s.generation_id=b.generation_id
   WHERE b.workspace_id=$1 AND b.generation_id=$2`,[args.lease.workspace_id,args.generation_id])).rows[0];if(existing)return existing;
  const prior=(await c.query<ListeningDiscoveryAdvanceSubsetV1>(`SELECT * FROM signal_listening_discovery_subsets WHERE workspace_id=$1 AND generation_id=$2 AND status='ready'
   AND signal_listening_discovery_subset_complete_v1(id,generation_id) ORDER BY created_at,id LIMIT 1`,[args.lease.workspace_id,args.generation_id])).rows[0];
  const subset=prior??await snapshotSignalListeningDiscoveryOrphansWithClientV1(c,{database:args.database,workspace_id:args.lease.workspace_id,actor_user_id:args.lease.actor_user_id,generation_id:args.generation_id});
  await c.query('INSERT INTO signal_listening_discovery_subset_bindings(generation_id,workspace_id,subset_id,created_by_user_id) VALUES($1,$2,$3,$4)',[args.generation_id,args.lease.workspace_id,subset.id,args.lease.actor_user_id]);return subset;
 });
}

/** Reproduce the numerical spooler's exact JSONL bytes in bounded native pages.
 * No JS round-trip of PostgreSQL vector decimals or proof JSON is permitted. */
async function nativeSourceProofSha(c:PoolClient,s:ListeningDiscoveryAdvanceSubsetV1,g:ListeningDiscoveryGenerationV1){
 const h=createHash('sha256');let cursor:string|null=null,count=0,cached=0;
 type ProofRow={root_id:string;proof_digest:string;proof_json:string;vector_json:string|null;expected_vector_sha:string|null;expected_call_id:string|null;actual_call_id:string|null};
 for(;;){const rows:ProofRow[]=(await c.query<ProofRow>(`
  SELECT r.root_id,r.proof_digest,signal_labeling_json_v1(r.proof) proof_json,
   CASE WHEN receipt.status='settled' THEN e.embedding::text END vector_json,r.proof->>'embedding_sha256' expected_vector_sha,
   r.proof->>'embedding_call_id' expected_call_id,receipt.id::text actual_call_id
  FROM signal_listening_discovery_subset_roots chosen JOIN signal_listening_discovery_roots r ON r.generation_id=chosen.generation_id AND r.root_id=chosen.root_id AND r.proof_digest=chosen.proof_digest
  LEFT JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=r.workspace_id AND e.config_digest=$4 AND e.chunk_sha256=r.proof->>'chunk_sha256'
  LEFT JOIN signal_workspace_embedding_calls receipt ON receipt.id=e.call_id AND receipt.workspace_id=r.workspace_id AND receipt.status='settled'
  WHERE chosen.subset_id=$1 AND chosen.generation_id=$2 AND r.workspace_id=$3 AND($5::uuid IS NULL OR r.root_id>$5)
  ORDER BY r.root_id LIMIT 256`,[s.id,g.id,g.workspace_id,g.embedding_config_digest,cursor])).rows;
  for(const row of rows){
   if(sha(row.proof_json)!==row.proof_digest||row.expected_call_id!==row.actual_call_id
    ||(row.vector_json===null?row.expected_vector_sha!==null:sha(row.vector_json)!==row.expected_vector_sha))fail('listening_discovery_numeric_source_stale');
   h.update(JSON.stringify({root_id:row.root_id,proof_digest:row.proof_digest,proof_json:row.proof_json,vector_json:row.vector_json})+'\n');
   count++;if(row.vector_json!==null)cached++;
  }
  if(rows.length<256)break;cursor=rows.at(-1)!.root_id;
 }
 if(count!==s.root_count||cached!==s.cached_count)fail('listening_discovery_numeric_source_stale');return'sha256:'+h.digest('hex');
}
function parseNumeric(numeric:ListeningDiscoveryNumericInputV1){
 if(typeof numeric.manifest_json!=='string'||Buffer.byteLength(numeric.manifest_json)>32*1024*1024||Buffer.from(numeric.manifest_json).toString('utf8')!==numeric.manifest_json
  ||!hash.test(numeric.manifest_sha256)||sha(numeric.manifest_json)!==numeric.manifest_sha256||!Array.isArray(numeric.artifacts)||numeric.artifacts.length<2||numeric.artifacts.length>64)fail('listening_discovery_numeric_invalid',422);
 let m:Record<string,unknown>;try{m=JSON.parse(numeric.manifest_json);}catch{return fail('listening_discovery_numeric_invalid',422);}
 if(!m||Array.isArray(m)||typeof m!=='object'||m.contract_version!=='listening-orphan-numeric-v1')fail('listening_discovery_numeric_invalid',422);
 const artifacts=numeric.artifacts.map(a=>({name:a.name,sha256:a.sha256,size_bytes:a.size_bytes})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 if(new Set(artifacts.map(a=>a.name)).size!==artifacts.length||artifacts.some(a=>! /^(numeric-manifest\.json|source-proofs\.jsonl|(input|output)\/[a-z0-9][a-z0-9_.-]{0,100})$/u.test(a.name)||a.name.includes('..')||!hash.test(a.sha256)||!Number.isSafeInteger(a.size_bytes)||a.size_bytes<0))fail('listening_discovery_numeric_artifacts_invalid',422);
 const main=artifacts.find(a=>a.name==='numeric-manifest.json');if(main?.sha256!==numeric.manifest_sha256||main.size_bytes!==Buffer.byteLength(numeric.manifest_json))fail('listening_discovery_numeric_artifacts_invalid',422);
 return{m,artifacts};
}
async function validateNumericSource(args:LeaseArgs&{subset_id:string;numeric:ListeningDiscoveryNumericInputV1}){
 const parsed=parseNumeric(args.numeric);
 return listeningTransactionV1(args.database,async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const lease=args.lease;validateLease(lease);
  if(!(await c.query('SELECT 1 FROM signal_listening_discovery_advances WHERE execution_id=$1 AND workspace_id=$2 AND actor_user_id=$3 AND next_ordinal=$4 AND execution_token=$5 AND execution_expires_at>clock_timestamp()',
   [lease.execution_id,lease.workspace_id,lease.actor_user_id,lease.next_ordinal,lease.execution_token])).rows.length)fail('listening_discovery_advance_lease_lost');
  const s=await source(c,lease.execution_id);if(!sameSource(lease,s))fail('listening_discovery_advance_source_invalid');
  const subset=(await c.query<ListeningDiscoveryAdvanceSubsetV1>(`SELECT subset.* FROM signal_listening_discovery_subsets subset
   JOIN signal_listening_discovery_subset_bindings b ON b.subset_id=subset.id AND b.generation_id=subset.generation_id AND b.workspace_id=subset.workspace_id
   WHERE subset.id=$1 AND subset.generation_id=$2 AND subset.workspace_id=$3 AND subset.status='ready'`,[args.subset_id,lease.source_generation_id,lease.workspace_id])).rows[0];if(!subset)fail('listening_discovery_numeric_subset_invalid');
  const g=(await c.query<ListeningDiscoveryGenerationV1>('SELECT * FROM signal_listening_discovery_generations WHERE id=$1 AND workspace_id=$2',[lease.source_generation_id,lease.workspace_id])).rows[0]!;
  const {m}=parsed,configuration=signalWorkspaceMassLabelingConfigV3(subset.cached_count);
  if(m.workspace_id!==g.workspace_id||m.generation_id!==g.id||m.generation_digest!==g.snapshot_digest||m.subset_id!==subset.id||m.subset_digest!==subset.subset_digest
   ||m.root_count!==subset.root_count||m.cached_count!==subset.cached_count||m.uncached_count!==subset.root_count-subset.cached_count
   ||digest(m.numeric_config)!==digest(configuration)||m.numeric_config_digest!==digest(configuration)
   ||!(await c.query<{valid:boolean}>('SELECT signal_listening_discovery_numeric_groups_v1($1,$2::jsonb) valid',[subset.id,args.numeric.manifest_json])).rows[0]?.valid)fail('listening_discovery_numeric_source_invalid');
  const expected=await nativeSourceProofSha(c,subset,g);if(m.source_proofs_sha256!==expected||parsed.artifacts.find(a=>a.name==='source-proofs.jsonl')?.sha256!==expected)fail('listening_discovery_numeric_source_invalid');
  return{...parsed,source_proofs_sha256:expected,source_proofs_digest:(await c.query<{digest:string}>('SELECT signal_listening_discovery_subset_proofs_v1($1) digest',[subset.id])).rows[0]!.digest,numeric_config_digest:digest(configuration)};
 });
}
function descriptor(c:NumericRow,a:NumericRow['artifact_manifest'][number]):ListeningDiscoveryNumericArtifactDescriptorV1&{storage_key:string}{
 return{workspace_id:c.workspace_id,execution_id:c.execution_id,checkpoint_id:c.id,...a};
}
async function verifyArtifacts(c:NumericRow,storage:ListeningDiscoveryNumericStorageV1){
 let next=0,valid=true;await Promise.all(Array.from({length:Math.min(4,c.artifact_manifest.length)},async()=>{
  for(;;){const artifact=c.artifact_manifest[next++];if(!artifact)return;try{if(!await storage.verify(descriptor(c,artifact)))valid=false;}catch{valid=false;}}
 }));return valid;
}
async function markNumericVerified(args:LeaseArgs,c:NumericRow):Promise<ListeningDiscoveryStoredNumericV1>{
 return listeningTransactionV1(args.database,async client=>{
  const h=await lockedHop(client,args.lease);
  const current=(await client.query<NumericRow>('SELECT * FROM signal_listening_discovery_numeric_checkpoints WHERE id=$1 AND advance_id=$2 AND workspace_id=$3 FOR UPDATE',[c.id,h.id,h.workspace_id])).rows[0];
  if(!current||current.manifest_sha256!==c.manifest_sha256||current.artifacts_digest!==c.artifacts_digest)fail('listening_discovery_numeric_intent_immutable');
  if(current.verification_status==='planned'){
   const marker={contract_version:'listening-discovery-numeric-verification-v1',checkpoint_id:current.id,execution_token:h.execution_token,manifest_sha256:current.manifest_sha256,artifacts_digest:current.artifacts_digest};
   await client.query("SELECT set_config('noisia.listening_discovery_numeric_verification_v1',$1,true)",[JSON.stringify(marker)]);
   await client.query("UPDATE signal_listening_discovery_numeric_checkpoints SET verification_status='verified',verified_at=clock_timestamp(),verification_token=$2 WHERE id=$1",[current.id,h.execution_token]);
   await client.query("SELECT set_config('noisia.listening_discovery_numeric_verification_v1','',true)");
  }
  return{manifest_json:current.manifest_json,manifest_sha256:current.manifest_sha256,verified:true};
 });
}
export async function loadSignalListeningDiscoveryAdvanceNumericV1(args:LeaseArgs&{subset_id:string;numeric_config_digest:string;numeric_storage:ListeningDiscoveryNumericStorageV1}):Promise<ListeningDiscoveryNumericCheckpointV1|null>{
 if(!uuid.test(args.subset_id)||!hash.test(args.numeric_config_digest))fail('listening_discovery_numeric_invalid',422);
 const c=await listeningTransactionV1(args.database,async client=>{const h=await lockedHop(client,args.lease);
  const row=(await client.query<NumericRow>('SELECT * FROM signal_listening_discovery_numeric_checkpoints WHERE advance_id=$1 AND workspace_id=$2',[h.id,h.workspace_id])).rows[0];
  if(row&&(row.subset_id!==args.subset_id||row.numeric_config_digest!==args.numeric_config_digest||row.generation_id!==h.source_generation_id))fail('listening_discovery_numeric_checkpoint_binding_invalid');return row??null;
 });
 if(!c)return null;
 if(!await verifyArtifacts(c,args.numeric_storage))return{status:'pending',manifest_sha256:c.manifest_sha256};
 return markNumericVerified(args,c);
}
/** Stage and verify every byte before an intent can survive a restart. A crash
 * before the intent may repeat a free fit. An existing intent is read-only
 * recovery: never another fit, upload, manifest or admission. */
export async function persistSignalListeningDiscoveryAdvanceNumericV1(args:LeaseArgs&{subset_id:string;numeric:ListeningDiscoveryNumericInputV1;numeric_storage:ListeningDiscoveryNumericStorageV1}):Promise<ListeningDiscoveryNumericCheckpointV1>{
 const parsed=parseNumeric(args.numeric);
 const before=await listeningTransactionV1(args.database,async c=>{const h=await lockedHop(c,args.lease);
  return(await c.query<NumericRow>('SELECT * FROM signal_listening_discovery_numeric_checkpoints WHERE advance_id=$1 AND workspace_id=$2',[h.id,h.workspace_id])).rows[0]??null;
 });
 function assertSame(c:NumericRow){if(c.manifest_json!==args.numeric.manifest_json||c.manifest_sha256!==args.numeric.manifest_sha256||c.subset_id!==args.subset_id
  ||digest(c.artifact_manifest.map(({name,sha256,size_bytes})=>({name,sha256,size_bytes})))!==digest(parsed.artifacts))fail('listening_discovery_numeric_intent_immutable');}
 if(before){assertSame(before);return(await loadSignalListeningDiscoveryAdvanceNumericV1({...args,numeric_config_digest:before.numeric_config_digest}))!;}
 const validated=await validateNumericSource(args);
 const id=randomUUID();
 const artifacts=validated.artifacts.map(a=>{
  const key=args.numeric_storage.reference({workspace_id:args.lease.workspace_id,execution_id:args.lease.execution_id,checkpoint_id:id,...a}).storage_key;
  if(!key.startsWith('workspace-engine/'+args.lease.workspace_id+'/'+id+'/')||key.includes('..'))fail('listening_discovery_numeric_storage_invalid');return{...a,storage_key:key};
 });
 // These private blobs have no database/model authority yet. CAS failure leaves
 // them unattributed; it cannot fabricate a paid outcome or replace a receipt.
 for(const a of artifacts){const d={workspace_id:args.lease.workspace_id,execution_id:args.lease.execution_id,checkpoint_id:id,...a};
  if(await args.numeric_storage.verify(d))continue;const stored=await args.numeric_storage.store(d);
  if(stored.verified!==true||stored.storage_key!==a.storage_key||stored.sha256!==a.sha256||stored.size_bytes!==a.size_bytes||!await args.numeric_storage.verify(d))fail('listening_discovery_numeric_storage_unverified');
 }
 const planned=await listeningTransactionV1(args.database,async client=>{
  if(!await readyAuthority(client,args.lease.execution_id,args.lease))fail('listening_discovery_advance_source_invalid');const h=await lockedHop(client,args.lease);
  const old=(await client.query<NumericRow>('SELECT * FROM signal_listening_discovery_numeric_checkpoints WHERE advance_id=$1 AND workspace_id=$2 FOR UPDATE',[h.id,h.workspace_id])).rows[0];
  if(old){assertSame(old);if(old.numeric_config_digest!==validated.numeric_config_digest)fail('listening_discovery_numeric_intent_immutable');return old;}
  const artifacts_digest=digest(artifacts);
  await client.query("SELECT set_config('noisia.listening_discovery_numeric_staging_v1',$1,true)",[JSON.stringify({contract_version:'listening-discovery-numeric-staging-v1',checkpoint_id:id,execution_token:h.execution_token,manifest_sha256:args.numeric.manifest_sha256,artifacts_digest})]);
  const row=(await client.query<NumericRow>(`INSERT INTO signal_listening_discovery_numeric_checkpoints(id,workspace_id,advance_id,execution_id,generation_id,subset_id,numeric_config_digest,
   manifest_json,manifest_sha256,source_proofs_sha256,source_proofs_digest,artifact_manifest,artifacts_digest,planned_by_token)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,signal_labeling_digest_v1($12::jsonb),$13) RETURNING *`,
   [id,h.workspace_id,h.id,h.execution_id,h.source_generation_id,args.subset_id,validated.numeric_config_digest,args.numeric.manifest_json,args.numeric.manifest_sha256,validated.source_proofs_sha256,validated.source_proofs_digest,JSON.stringify(artifacts),h.execution_token])).rows[0]!;
  await client.query(`INSERT INTO signal_listening_discovery_numeric_artifacts(checkpoint_id,workspace_id,name,storage_key,sha256,size_bytes)
   SELECT $1,$2,x.name,x.storage_key,x.sha256,x.size_bytes FROM jsonb_to_recordset($3::jsonb)x(name text,storage_key text,sha256 text,size_bytes bigint)`,[id,h.workspace_id,JSON.stringify(artifacts)]);
  await client.query("SELECT set_config('noisia.listening_discovery_numeric_staging_v1','',true)");return row;
 });
 if(planned.id!==id)return(await loadSignalListeningDiscoveryAdvanceNumericV1({...args,numeric_config_digest:planned.numeric_config_digest}))!;
 return markNumericVerified(args,planned);
}

export async function enqueueSignalListeningDiscoveryAdvanceV1(args:LeaseArgs&{generation_id:string;expected_ordinal:number;expected_policy_version_id:string;
 expected_policy_digest:string;expected_human_revision_digest:string;numeric_manifest_sha256:string;provider_available:boolean;numeric_storage:ListeningDiscoveryNumericStorageV1}):Promise<ListeningDiscoveryAdvanceEnqueueResultV1>{
 validateLease(args.lease);const lease=args.lease;
 if(args.generation_id!==lease.source_generation_id||args.expected_ordinal!==lease.next_ordinal||args.expected_policy_version_id!==lease.policy_version_id
  ||args.expected_policy_digest!==lease.policy_digest||args.expected_human_revision_digest!==lease.human_revision_digest||!hash.test(args.numeric_manifest_sha256))fail('listening_discovery_advance_expected_binding_invalid');
 const known=await listeningTransactionV1(args.database,async c=>{const h=await lockedHop(c,lease);
  const checkpoint=(await c.query<NumericRow>('SELECT * FROM signal_listening_discovery_numeric_checkpoints WHERE advance_id=$1 AND workspace_id=$2',[h.id,h.workspace_id])).rows[0];
  if(!checkpoint||checkpoint.manifest_sha256!==args.numeric_manifest_sha256)fail('listening_discovery_numeric_checkpoint_required');
  const existing=(await c.query<ListeningDiscoveryRoundV1>('SELECT * FROM signal_listening_discovery_rounds WHERE advance_id=$1 AND workspace_id=$2',[h.id,h.workspace_id])).rows[0];return{checkpoint,existing};
 });
 if(known.existing)return known.existing;if(!args.provider_available)return null;
 const verified=await loadSignalListeningDiscoveryAdvanceNumericV1({...args,subset_id:known.checkpoint.subset_id,numeric_config_digest:known.checkpoint.numeric_config_digest});
 if(!verified||'status'in verified)return null;
 const manifest=JSON.parse(verified.manifest_json) as{groups:ListeningDiscoveryOrphanManifestV1[]};
 const access={database:args.database,workspace_id:lease.workspace_id,actor_user_id:lease.actor_user_id};
 const built=await buildSignalListeningDiscoveryRoundV1({...access,generation_id:lease.source_generation_id,ordinal:lease.next_ordinal,orphan_groups:manifest.groups});
 if(Buffer.byteLength(built.request.request_body)+4096+64000>1000000)fail('listening_discovery_context_bound_exceeded',422);
 try{return await listeningTransactionV1(args.database,async c=>{
  const ready=await readyAuthority(c,lease.execution_id,lease);if(!ready)return null;const h=await lockedHop(c,lease);
  const existing=(await c.query<ListeningDiscoveryRoundV1>('SELECT * FROM signal_listening_discovery_rounds WHERE advance_id=$1 AND workspace_id=$2',[h.id,h.workspace_id])).rows[0];if(existing)return existing;
  const current=(await c.query<NumericRow>("SELECT * FROM signal_listening_discovery_numeric_checkpoints WHERE id=$1 AND advance_id=$2 AND workspace_id=$3 AND verification_status='verified' FOR UPDATE",[known.checkpoint.id,h.id,h.workspace_id])).rows[0];
  if(!current||current.manifest_sha256!==verified.manifest_sha256||current.manifest_json!==verified.manifest_json)fail('listening_discovery_numeric_intent_immutable');
  const exposure=String((await c.query<{value:string}>('SELECT signal_listening_discovery_exposure_v1($1)::text value',[lease.execution_id])).rows[0]!.value);
  const reservation=BigInt((Buffer.byteLength(built.request.request_body)+4096)*6+64000*15);
  if(BigInt(exposure)+reservation>BigInt(ready.p.cap_micro_usd)){
   await c.query("UPDATE signal_listening_discovery_executions SET status='failed',error_code='listening_discovery_parent_budget_exhausted',updated_at=clock_timestamp() WHERE id=$1",[ready.p.id]);
   return{status:'budget_exhausted' as const,execution_id:ready.p.id,workspace_id:ready.p.workspace_id,error_code:'listening_discovery_parent_budget_exhausted' as const,
    cap_micro_usd:String(ready.p.cap_micro_usd),exposure_micro_usd:exposure,reservation_micro_usd:reservation.toString()};
  }
  const marker={contract_version:'listening-discovery-advance-enqueue-v1',advance_id:h.id,execution_token:h.execution_token,checkpoint_id:current.id,manifest_sha256:current.manifest_sha256};
  await c.query("SELECT set_config('noisia.listening_discovery_advance_enqueue_v1',$1,true)",[JSON.stringify(marker)]);
  const result=await enqueueSignalListeningDiscoveryRoundWithClientV1(c,{...access,execution_id:lease.execution_id,generation_id:lease.source_generation_id,ordinal:lease.next_ordinal,
   orphan_groups:manifest.groups,provider_available:true,built,advance_id:h.id,advance_token:h.execution_token});
  await c.query("SELECT set_config('noisia.listening_discovery_advance_enqueue_v1','',true)");return result;
 });}catch(error){if(expectedStop(error))return null;throw error;}
}

/** Paginate exact timestamps so stale early owners cannot starve later ones.
 * A released unchanged hop backs off; a new source/ordinal is immediately ready. */
export async function pendingSignalListeningDiscoveryAdvancesV1(args:{database:Database;limit:number}):Promise<Array<{execution_id:string}>>{
 if(!Number.isInteger(args.limit)||args.limit<1||args.limit>20)fail('listening_discovery_advance_limit_invalid',422);
 const found:Array<{execution_id:string}>=[];let cursor:{created_at:string;id:string}|null=null;
 type Candidate={id:string;workspace_id:string;map_id:string;created_at:string};
 for(;;){const rows:Candidate[]=(await args.database.query<Candidate>(`SELECT p.id,p.workspace_id,p.map_id,p.created_at::text created_at
  FROM signal_listening_discovery_executions p CROSS JOIN LATERAL signal_listening_discovery_advance_source_v1(p.id) s
  LEFT JOIN signal_listening_discovery_advances h ON h.execution_id=p.id AND h.next_ordinal=s.next_ordinal
  WHERE($1::timestamptz IS NULL OR(p.created_at,p.id)>($1::timestamptz,$2::uuid))
   AND(h.id IS NULL OR h.execution_token IS NOT NULL AND h.execution_expires_at<=clock_timestamp()
    OR h.execution_token IS NULL AND h.updated_at<=clock_timestamp()-interval '30 seconds')
  ORDER BY p.created_at,p.id LIMIT 100`,[cursor?.created_at??null,cursor?.id??null])).rows;
  for(const p of rows){cursor={created_at:p.created_at,id:p.id};
   try{await assertMassLabelingMapCurrentV1(args.database,p.workspace_id,p.map_id);}catch(error){if(expectedStop(error))continue;throw error;}
   found.push({execution_id:p.id});if(found.length>=args.limit)return found;
  }
  if(rows.length<100)return found;
 }
}

/** The host owns local files only in numeric_storage_for_result. Neither file
 * paths nor subprocess handles cross the durable database contract. */
export function createSignalListeningDiscoveryAdvanceStoreV1<T extends ListeningDiscoveryNumericInputV1=ListeningDiscoveryNumericInputV1>(options:{database:Database;
 numeric_storage:ListeningDiscoveryNumericStorageV1;numeric_storage_for_result?:(lease:ListeningDiscoveryAdvanceLeaseV1,numeric:T)=>ListeningDiscoveryNumericStorageV1}){
 const scoped=<A extends{database:Database}>(args:A)=>{if(args.database!==options.database)fail('listening_discovery_advance_database_invalid');return args;};
 return{
  claim:(args:Parameters<typeof claimSignalListeningDiscoveryAdvanceV1>[0])=>claimSignalListeningDiscoveryAdvanceV1(scoped(args)),
  context:(args:LeaseArgs)=>getSignalListeningDiscoveryAdvanceContextV1(scoped(args)),
  renew:(args:LeaseArgs)=>renewSignalListeningDiscoveryAdvanceV1(scoped(args)),
  release:(args:LeaseArgs)=>releaseSignalListeningDiscoveryAdvanceV1(scoped(args)),
  ensureSubset:(args:LeaseArgs&{generation_id:string})=>ensureSignalListeningDiscoveryAdvanceSubsetV1(scoped(args)),
  loadNumeric:(args:LeaseArgs&{subset_id:string;numeric_config_digest:string})=>loadSignalListeningDiscoveryAdvanceNumericV1({...scoped(args),numeric_storage:options.numeric_storage}),
  persistNumeric:(args:LeaseArgs&{subset_id:string;numeric:T})=>persistSignalListeningDiscoveryAdvanceNumericV1({...scoped(args),numeric_storage:options.numeric_storage_for_result?.(args.lease,args.numeric)??options.numeric_storage}),
  enqueue:(args:Omit<Parameters<typeof enqueueSignalListeningDiscoveryAdvanceV1>[0],'numeric_storage'>)=>enqueueSignalListeningDiscoveryAdvanceV1({...scoped(args),numeric_storage:options.numeric_storage}),
  pending:(args:Parameters<typeof pendingSignalListeningDiscoveryAdvancesV1>[0])=>pendingSignalListeningDiscoveryAdvancesV1(scoped(args)),
 };
}
