import type{SignalListeningAccessV1,ListeningDiscoveryExecutionV1,ListeningDiscoveryGenerationV1,ListeningDiscoveryRoundV1}from'@noisia/db';
import{LISTENING_DISCOVERY_POLICY_V1,listeningDiscoveryPolicyDigestV1,signalWorkspaceMassLabelingConfigV3,
 signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
import{createHash}from'node:crypto';
import{regroupSignalListeningOrphansV1,type ListeningOrphanSubsetV1,type ListeningOrphanNumericResultV1,type ListeningOrphanNumericManifestV1}from'./signal-listening-orphan-regroup';
type Database=SignalListeningAccessV1['database'];
export type ListeningDiscoveryAdvanceLeaseV1={execution_id:string;workspace_id:string;actor_user_id:string;execution_token:string;
 source_generation_id:string;next_ordinal:number;policy_version_id:string;policy_digest:string;human_revision_digest:string};
export type ListeningDiscoveryAdvanceContextV1={execution:ListeningDiscoveryExecutionV1;latest_round:ListeningDiscoveryRoundV1|null;
 source_generation:ListeningDiscoveryGenerationV1|null;stop_decision?:{stop:boolean;reason:string};classification_status:string;policy_version_id:string;policy_digest:string;human_revision_digest:string};
export type ListeningDiscoveryStoredNumericV1={manifest_json:string;manifest_sha256:string;verified:true};
export type ListeningDiscoveryNumericCheckpointV1=ListeningDiscoveryStoredNumericV1|{status:'pending';manifest_sha256:string};
export type ListeningDiscoveryBudgetExhaustedV1={status:'budget_exhausted';execution_id:string;workspace_id:string;
 error_code:'listening_discovery_parent_budget_exhausted';cap_micro_usd:string;exposure_micro_usd:string;reservation_micro_usd:string};
type LeaseArgs={database:Database;lease:ListeningDiscoveryAdvanceLeaseV1};
/** Required native DB contracts; deliberately no SQL fallback or local state.
 * claim/context revalidate admission, map/policy and human precedence. ensureSubset
 * and persistNumeric are idempotent under this lease. Persistence first loads
 * an existing journal without another upload; otherwise it stages and verifies
 * EVERY artifact before a CAS creates the immutable DB intent. A committed
 * intent therefore survives local cleanup with recoverable private byte custody.
 * The CAS also verifies complete subset membership and original numeric hashes.
 * enqueue atomically rechecks owner cap, policy, map, human freeze, stop/max3 and
 * verified numeric checkpoint, then invokes the existing round owner exactly once.
 */
export type ListeningDiscoveryAdvanceStoresV1={
 claim(args:{database:Database;execution_id:string}):Promise<ListeningDiscoveryAdvanceLeaseV1|null>;
 context(args:LeaseArgs):Promise<ListeningDiscoveryAdvanceContextV1|null>;
 renew(args:LeaseArgs):Promise<boolean>;release(args:LeaseArgs):Promise<boolean>;
 ensureSubset(args:LeaseArgs&{generation_id:string}):Promise<ListeningOrphanSubsetV1>;
 loadNumeric(args:LeaseArgs&{subset_id:string;numeric_config_digest:string}):Promise<ListeningDiscoveryNumericCheckpointV1|null>;
 persistNumeric(args:LeaseArgs&{subset_id:string;numeric:ListeningOrphanNumericResultV1}):Promise<ListeningDiscoveryNumericCheckpointV1>;
 enqueue(args:LeaseArgs&{generation_id:string;expected_ordinal:number;expected_policy_version_id:string;expected_policy_digest:string;expected_human_revision_digest:string;
  numeric_manifest_sha256:string;provider_available:boolean}):Promise<ListeningDiscoveryRoundV1|ListeningDiscoveryBudgetExhaustedV1|null>;
 pending?(args:{database:Database;limit:number}):Promise<Array<{execution_id:string}>>;
};
type Options={database:Database;stores:ListeningDiscoveryAdvanceStoresV1;enabled?:boolean;provider_available?:boolean;
 should_stop?:()=>boolean;renewal_ms?:number;numeric?:typeof regroupSignalListeningOrphansV1};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u,hash=/^sha256:[a-f0-9]{64}$/u;
const sha=(text:string)=>'sha256:'+createHash('sha256').update(text).digest('hex');
function fail(suffix:string):never{throw Error('listening_discovery_advance_'+suffix);}
/** One automatic hop of an already admitted owner. The native round worker's
 * successful complete/activate must wake this handler by execution identity;
 * a native pending-owner scan repairs a lost wakeup without another Sonnet send.
 * It never starts an execution or calls a provider, including on restart. */
export async function signalListeningDiscoveryAdvanceJobV1(execution_id:string,options:Options){
 if(!uuid.test(execution_id))fail('job_invalid');
 if(options.enabled!==true||options.should_stop?.())return{status:'disabled' as const};
 const {database,stores}=options,lease=await stores.claim({database,execution_id});if(!lease)return{status:'not_claimed' as const};
 if(lease.execution_id!==execution_id||![lease.execution_id,lease.workspace_id,lease.actor_user_id,lease.execution_token,lease.source_generation_id,lease.policy_version_id].every(id=>uuid.test(id))
  ||![lease.policy_digest,lease.human_revision_digest].every(value=>hash.test(value)))fail('lease_invalid');
 const args={database,lease},interval=options.renewal_ms??30000;
 if(!Number.isSafeInteger(interval)||interval<1||interval>60000){await stores.release(args);fail('renewal_invalid');}
 let lost=false,renewing:Promise<void>|undefined,numeric:ListeningOrphanNumericResultV1|undefined;
 const check=()=>{if(lost||options.should_stop?.())fail('lease_lost');};
 const timer=setInterval(()=>{if(renewing||lost)return;renewing=stores.renew(args).then(ok=>{if(!ok)lost=true;})
  .catch(()=>{lost=true;}).finally(()=>{renewing=undefined;});},interval);timer.unref?.();
 const heartbeat=async()=>{if(renewing)await renewing;check();};
 try{
  const context=await stores.context(args);if(!context)fail('lease_lost');check();
  const {execution:p,latest_round:last,source_generation:g}=context;
  if(p.id!==execution_id||p.workspace_id!==lease.workspace_id||p.actor_user_id!==lease.actor_user_id)fail('scope_invalid');
  if(p.status!=='active')return{status:p.status};
  if(context.stop_decision?.stop)return{status:'stopped' as const,reason:context.stop_decision.reason};
  if(context.policy_version_id!==lease.policy_version_id||p.policy_version_id!==lease.policy_version_id
   ||context.policy_digest!==listeningDiscoveryPolicyDigestV1(LISTENING_DISCOVERY_POLICY_V1)||context.policy_digest!==lease.policy_digest
   ||context.human_revision_digest!==lease.human_revision_digest)return{status:'stale' as const};
  if(last&&(last.execution_id!==execution_id||last.workspace_id!==lease.workspace_id))fail('scope_invalid');
  if(last&&last.status!=='completed')return{status:'waiting_round' as const,round_id:last.id};
  if(last?.stop_decision?.stop===true||last&&last.ordinal>=3)return{status:'stopped' as const,reason:last.ordinal>=3?'max_rounds':last.stop_decision!.reason};
  if(last&&!last.stop_decision)fail('stop_decision_missing');
  if(context.classification_status!=='completed'||!g)return{status:'waiting_classification' as const};
  const ordinal=(last?.ordinal??0)+1;
  if(ordinal!==lease.next_ordinal||ordinal<1||ordinal>3||g.id!==lease.source_generation_id||g.workspace_id!==lease.workspace_id||g.map_id!==p.map_id
   ||g.status!=='ready'||g.kind!=='confirmed_members'
   ||g.configuration_id!==(last?.output_configuration_id??p.initial_configuration_id)
   ||g.id!==(last?.output_generation_id??p.initial_generation_id))fail('source_binding_invalid');
  const access={database,workspace_id:lease.workspace_id,actor_user_id:lease.actor_user_id};
  await heartbeat();const subset=await stores.ensureSubset({...args,generation_id:g.id});
  if(subset.workspace_id!==lease.workspace_id||subset.generation_id!==g.id)fail('subset_binding_invalid');
  const numeric_config_digest=digest(signalWorkspaceMassLabelingConfigV3(subset.cached_count));
  let checkpoint=await stores.loadNumeric({...args,subset_id:subset.id,numeric_config_digest});
  if(checkpoint&&'status'in checkpoint)return{status:'waiting_numeric' as const};
  if(!checkpoint){
   await heartbeat();numeric=await(options.numeric??regroupSignalListeningOrphansV1)({access,generation:g,subset,heartbeat});
   await heartbeat();checkpoint=await stores.persistNumeric({...args,subset_id:subset.id,numeric});
  }
  if('status'in checkpoint)return{status:'waiting_numeric' as const};
  const manifest=verifiedManifest(checkpoint,subset,g);
  if(manifest.numeric_config_digest!==numeric_config_digest)fail('numeric_configuration_invalid');
  await heartbeat();if(options.provider_available!==true)return{status:'provider_unavailable' as const};
  // No direct call to enqueueSignalListeningDiscoveryRoundV1: this required
  // native CAS owns current freeze/policy/cap and duplicate enqueue protection.
  const round=await stores.enqueue({...args,generation_id:g.id,expected_ordinal:ordinal,expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,
   expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:checkpoint.manifest_sha256,provider_available:true});
  if(!round)return{status:'not_enqueued' as const};
  if(round.status==='budget_exhausted'){
   const decimal=(value:string)=>typeof value==='string'&&value.length<=20&&/^(?:0|[1-9][0-9]*)$/u.test(value);
   if(round.execution_id!==execution_id||round.workspace_id!==lease.workspace_id||round.error_code!=='listening_discovery_parent_budget_exhausted'
    ||![round.cap_micro_usd,round.exposure_micro_usd,round.reservation_micro_usd].every(decimal)
    ||BigInt(round.cap_micro_usd)<=0n||BigInt(round.reservation_micro_usd)<=0n
    ||BigInt(round.exposure_micro_usd)+BigInt(round.reservation_micro_usd)<=BigInt(round.cap_micro_usd))fail('budget_outcome_invalid');
   // Native CAS committed a financial failure with zero new admission. This
   // is an auditable budget result, never a scientific convergence decision.
   return round;
  }
  if(round.execution_id!==execution_id||round.workspace_id!==lease.workspace_id||round.ordinal!==ordinal||round.input_generation_id!==g.id)fail('round_binding_invalid');
  return{status:'enqueued' as const,round_id:round.id,ordinal};
 }finally{clearInterval(timer);if(renewing)await renewing;try{await numeric?.dispose();}finally{await stores.release(args).catch(()=>undefined);}}
}
function verifiedManifest(checkpoint:ListeningDiscoveryStoredNumericV1,subset:ListeningOrphanSubsetV1,g:ListeningDiscoveryGenerationV1){
 if(checkpoint.verified!==true||typeof checkpoint.manifest_json!=='string'||Buffer.byteLength(checkpoint.manifest_json)>32*1024*1024
  ||sha(checkpoint.manifest_json)!==checkpoint.manifest_sha256)fail('numeric_receipt_invalid');
 let m:ListeningOrphanNumericManifestV1;try{m=JSON.parse(checkpoint.manifest_json);}catch{return fail('numeric_receipt_invalid');}
 if(!m||m.contract_version!=='listening-orphan-numeric-v1'||m.workspace_id!==g.workspace_id||m.generation_id!==g.id||m.generation_digest!==g.snapshot_digest
  ||m.subset_id!==subset.id||m.subset_digest!==subset.subset_digest||m.root_count!==subset.root_count||m.cached_count!==subset.cached_count
  ||m.uncached_count!==m.root_count-m.cached_count||digest(m.numeric_config)!==m.numeric_config_digest
  ||!['empty','no_cached_vectors','insufficient_population','completed'].includes(m.status)||!hash.test(m.source_proofs_sha256)||!Array.isArray(m.groups)||m.groups.length>200)fail('numeric_receipt_invalid');
 const ids=new Set<string>(),keys=new Set<string>();let grouped=0;
 for(const group of m.groups){
  if(!/^[a-z][a-z0-9_]{0,63}$/u.test(group.group_key)||keys.has(group.group_key)||!Array.isArray(group.root_ids)
   ||group.root_ids.length!==group.root_count||group.root_count<m.numeric_config.hdbscan_min_cluster_size||!Array.isArray(group.representative_root_ids)
   ||group.representative_root_ids.length<20||group.representative_root_ids.length>40)fail('numeric_receipt_invalid');
  keys.add(group.group_key);
  for(const id of group.root_ids){if(!uuid.test(id)||ids.has(id))fail('numeric_receipt_invalid');ids.add(id);}
  if(new Set(group.representative_root_ids).size!==group.representative_root_ids.length||group.representative_root_ids.some(id=>!group.root_ids.includes(id))
   ||m.group_digests[group.group_key]!==digest({subset_id:subset.id,root_ids:[...group.root_ids].sort()}))fail('numeric_receipt_invalid');grouped+=group.root_count;
 }
 if(grouped!==m.grouped_count||m.unclustered_count!==m.root_count-grouped||grouped>m.cached_count)fail('numeric_receipt_invalid');return m;
}

/** A missing DB adapter is a deployment dependency, never an excuse to admit
 * new executions from a ledger row. No registration happens in this checkpoint. */
export async function drainSignalListeningDiscoveryAdvancesOnceV1(options:Options){
 if(options.enabled!==true||options.should_stop?.())return{candidates:0,advanced:0,failed:0};
 if(!options.stores.pending)fail('pending_adapter_missing');
 const rows=await options.stores.pending({database:options.database,limit:20});let advanced=0,failed=0;
 for(const row of rows){if(options.should_stop?.())break;try{const result=await signalListeningDiscoveryAdvanceJobV1(row.execution_id,options);if(result.status==='enqueued')advanced++;}catch{failed++;}}
 return{candidates:rows.length,advanced,failed};
}
