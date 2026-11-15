import assert from'node:assert/strict';
import test from'node:test';
import{randomUUID,createHash}from'node:crypto';
import{LISTENING_DISCOVERY_POLICY_V1,listeningDiscoveryPolicyDigestV1,signalWorkspaceMassLabelingConfigV3,signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
import type{ListeningDiscoveryExecutionV1,ListeningDiscoveryGenerationV1,ListeningDiscoveryRoundV1}from'@noisia/db';
import{signalListeningDiscoveryAdvanceJobV1,drainSignalListeningDiscoveryAdvancesOnceV1,type ListeningDiscoveryAdvanceLeaseV1,
 type ListeningDiscoveryAdvanceContextV1,type ListeningDiscoveryAdvanceStoresV1,type ListeningDiscoveryStoredNumericV1}from'./signal-listening-discovery-auto-loop';
import type{ListeningOrphanSubsetV1,ListeningOrphanNumericManifestV1,ListeningOrphanNumericResultV1}from'./signal-listening-orphan-regroup';
const sha=(v:string)=>'sha256:'+createHash('sha256').update(v).digest('hex');
function fixture(){
 const workspace_id=randomUUID(),actor_user_id=randomUUID(),execution_id=randomUUID(),configuration_id=randomUUID(),map_id=randomUUID(),policy_version_id=randomUUID();
 const policy_digest=listeningDiscoveryPolicyDigestV1(LISTENING_DISCOVERY_POLICY_V1),human_revision_digest=digest('human-freeze');
 const execution={id:execution_id,workspace_id,actor_user_id,initial_configuration_id:configuration_id,map_id,policy_version_id,status:'active'}as ListeningDiscoveryExecutionV1;
 const initial={id:randomUUID(),workspace_id,configuration_id,map_id,kind:'confirmed_members',round:1,status:'ready',snapshot_digest:digest('generation0')}as ListeningDiscoveryGenerationV1;
 execution.initial_generation_id=initial.id;
 const context:ListeningDiscoveryAdvanceContextV1={execution,latest_round:null,source_generation:initial,classification_status:'completed',policy_version_id,policy_digest,human_revision_digest};
 const numericBySubset=new Map<string,ListeningDiscoveryStoredNumericV1>(),subsets=new Map<string,ListeningOrphanSubsetV1>(),rounds:ListeningDiscoveryRoundV1[]=[];
 let computations=0,persists=0,admissions=0,releases=0,renewed=true,persistAckLost=false,enqueueAckLost=false,staleAtEnqueue=false;
 const stores:ListeningDiscoveryAdvanceStoresV1={
  async claim(){return{execution_id,workspace_id,actor_user_id,execution_token:randomUUID(),source_generation_id:context.source_generation?.id??initial.id,
   next_ordinal:(context.latest_round?.ordinal??0)+1,policy_version_id:execution.policy_version_id,policy_digest,human_revision_digest}as ListeningDiscoveryAdvanceLeaseV1;},
  async context(){return context;},async renew(){return renewed;},async release(){releases++;return true;},
  async ensureSubset({generation_id}){let subset=subsets.get(generation_id);if(!subset){subset={id:randomUUID(),workspace_id,generation_id,root_count:0,cached_count:0,subset_digest:digest('subset'+generation_id)};subsets.set(generation_id,subset);}return subset;},
  async loadNumeric({subset_id}){return numericBySubset.get(subset_id)??null;},
  async persistNumeric({subset_id,numeric}){persists++;const saved={manifest_json:numeric.manifest_json,manifest_sha256:numeric.manifest_sha256,verified:true as const};numericBySubset.set(subset_id,saved);
   if(persistAckLost){persistAckLost=false;throw Error('synthetic_persist_ack_lost');}return saved;},
  async enqueue(args){
   assert.equal(args.expected_policy_version_id,execution.policy_version_id);assert.equal(args.expected_policy_digest,policy_digest);assert.equal(args.expected_human_revision_digest,human_revision_digest);
   if(staleAtEnqueue)throw Error('listening_discovery_configuration_changed');
   const old=rounds.find(r=>r.ordinal===args.expected_ordinal);if(old)return old;
   admissions++;const round={id:randomUUID(),workspace_id,execution_id,ordinal:args.expected_ordinal,input_generation_id:args.generation_id,status:'queued',
    configuration_id:context.source_generation!.configuration_id,output_configuration_id:null,output_generation_id:null,stop_decision:null}as ListeningDiscoveryRoundV1;
   rounds.push(round);context.latest_round=round;
   if(enqueueAckLost){enqueueAckLost=false;throw Error('synthetic_enqueue_ack_lost');}return round;
  },async pending(){return[{execution_id}];},
 };
 const numeric=async({generation:g,subset:s}:Parameters<typeof import('./signal-listening-orphan-regroup')['regroupSignalListeningOrphansV1']>[0])=>{
  computations++;const config=signalWorkspaceMassLabelingConfigV3(0);
  const manifest:ListeningOrphanNumericManifestV1={contract_version:'listening-orphan-numeric-v1',workspace_id,generation_id:g.id,generation_digest:g.snapshot_digest,
   subset_id:s.id,subset_digest:s.subset_digest,source_proofs_sha256:sha(''),root_count:0,cached_count:0,uncached_count:0,grouped_count:0,unclustered_count:0,status:'empty',
   numeric_config:config,numeric_config_digest:digest(config),input_manifest_sha256:null,output_manifest_sha256:null,groups:[],group_digests:{}};
  const manifest_json=JSON.stringify(manifest);return{manifest,manifest_json,manifest_sha256:sha(manifest_json),artifacts:[],dispose:async()=>{}}as ListeningOrphanNumericResultV1;
 };
 const options={database:{}as never,stores,numeric,enabled:true,provider_available:true};
 function complete(stop=false,reason='continue'){
  const last=context.latest_round!;last.status='completed';last.output_configuration_id=randomUUID();last.output_generation_id=randomUUID();last.stop_decision={stop,reason};
  context.source_generation={...initial,id:last.output_generation_id,configuration_id:last.output_configuration_id,round:last.ordinal,snapshot_digest:digest('generation'+last.ordinal)};
 }
 return{execution_id,options,context,stores,numeric,rounds,numericBySubset,subsets,complete,
  counts:()=>({computations,persists,admissions,releases}),setPersistAckLost:()=>{persistAckLost=true;},setEnqueueAckLost:()=>{enqueueAckLost=true;},
  setStaleAtEnqueue:()=>{staleAtEnqueue=true;},setRenewalLost:()=>{renewed=false;}};
}

test('automatic owner advances three rounds through native admission and resumes without duplicate numeric work or editorial admission',async()=>{
 const f=fixture();for(let ordinal=1;ordinal<=3;ordinal++){
  assert.deepEqual(await signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options),{status:'enqueued',round_id:f.rounds.at(-1)!.id,ordinal});
  assert.equal((await signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options)).status,'waiting_round');
  f.complete();
 }
 assert.deepEqual(await signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options),{status:'stopped',reason:'max_rounds'});
 assert.equal(f.counts().admissions,3);assert.equal(f.counts().computations,3);
});
test('staged numeric persistence ACK loss resumes sealed custody without regrouping and enqueue ACK loss never opens another review',async()=>{
 const f=fixture();f.setPersistAckLost();await assert.rejects(signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options),/persist_ack_lost/);
 assert.equal(f.counts().admissions,0);f.setEnqueueAckLost();await assert.rejects(signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options),/enqueue_ack_lost/);
 assert.equal(f.counts().computations,1);assert.equal(f.counts().persists,1,'existing custody bypasses persistence and its upload callback');assert.equal(f.counts().admissions,1);
 assert.equal((await signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options)).status,'waiting_round');assert.equal(f.counts().admissions,1);
});
test('sealed native stop decisions, stale policy/map and human freeze prevent automatic admission',async()=>{
 for(const changed of ['stop','policy','map','human','classification','execution']as const){const f=fixture();
  if(changed==='stop'){await signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options);f.complete(true,'stagnation');}
  if(changed==='policy')f.context.policy_version_id=randomUUID();
  if(changed==='map')f.context.source_generation!.map_id=randomUUID();
  if(changed==='human')f.context.human_revision_digest=digest('later-human-edit');
  if(changed==='classification')f.context.classification_status='running';
  if(changed==='execution')f.context.execution.status='stale';
  const before=f.counts().admissions;
  if(changed==='map')await assert.rejects(signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options),/source_binding_invalid/);
  else assert.notEqual((await signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options)).status,'enqueued');
  assert.equal(f.counts().admissions,before);
 }
 const f=fixture();f.setStaleAtEnqueue();await assert.rejects(signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options),/configuration_changed/);
 assert.equal(f.counts().admissions,0);assert.equal(f.counts().releases,1,'native CAS veto still releases only its own lease');
});
test('disabled admission, missing provider, corrupt custody and lost lease never fall back to an editorial provider',async()=>{
 const disabled=fixture();assert.equal((await drainSignalListeningDiscoveryAdvancesOnceV1({...disabled.options,enabled:false})).candidates,0);assert.equal(disabled.counts().computations,0);
 const unavailable=fixture();assert.equal((await signalListeningDiscoveryAdvanceJobV1(unavailable.execution_id,{...unavailable.options,provider_available:false})).status,'provider_unavailable');assert.equal(unavailable.counts().admissions,0);
 const corrupt=fixture();const persist=corrupt.stores.persistNumeric;corrupt.stores.persistNumeric=async args=>({...await persist(args),manifest_json:'{}'});
 await assert.rejects(signalListeningDiscoveryAdvanceJobV1(corrupt.execution_id,corrupt.options),/numeric_receipt_invalid/);assert.equal(corrupt.counts().admissions,0);
 const lost=fixture();lost.setRenewalLost();const compute=lost.options.numeric;lost.options.numeric=async args=>{
  const result=await compute(args);await new Promise(resolve=>setTimeout(resolve,5));await args.heartbeat?.();return result;};
 await assert.rejects(signalListeningDiscoveryAdvanceJobV1(lost.execution_id,{...lost.options,renewal_ms:1}),/lease_lost/);assert.equal(lost.counts().admissions,0);assert.equal(lost.counts().persists,0);
});

test('native initial stop, missing context and enqueue CAS veto cannot create another round',async()=>{
 const empty=fixture();empty.context.stop_decision={stop:true,reason:'no_category_population'};
 assert.deepEqual(await signalListeningDiscoveryAdvanceJobV1(empty.execution_id,empty.options),{status:'stopped',reason:'no_category_population'});assert.equal(empty.counts().computations,0);
 const absent=fixture();absent.stores.context=async()=>null;await assert.rejects(signalListeningDiscoveryAdvanceJobV1(absent.execution_id,absent.options),/lease_lost/);assert.equal(absent.counts().admissions,0);
 const veto=fixture();veto.stores.enqueue=async()=>null;assert.equal((await signalListeningDiscoveryAdvanceJobV1(veto.execution_id,veto.options)).status,'not_enqueued');assert.equal(veto.counts().admissions,0);
 const stopped=fixture();let closed=false;const compute=stopped.options.numeric;
 stopped.options.numeric=async args=>{const result=await compute(args);closed=true;return result;};
 await assert.rejects(signalListeningDiscoveryAdvanceJobV1(stopped.execution_id,{...stopped.options,should_stop:()=>closed}),/lease_lost/);
 assert.equal(stopped.counts().persists,0);assert.equal(stopped.counts().admissions,0);
});

test('an existing legacy planned numeric checkpoint stays pending without recomputation or enqueue and cannot starve another admitted owner',async()=>{
 const planned=fixture();planned.stores.loadNumeric=async()=>({status:'pending',manifest_sha256:digest('planned')});
 assert.equal((await signalListeningDiscoveryAdvanceJobV1(planned.execution_id,planned.options)).status,'waiting_numeric');
 assert.equal(planned.counts().computations,0);assert.equal(planned.counts().admissions,0);assert.equal(planned.counts().releases,1);
 const uploaded=fixture();uploaded.stores.persistNumeric=async()=>({status:'pending',manifest_sha256:digest('pending-verification')});
 assert.equal((await signalListeningDiscoveryAdvanceJobV1(uploaded.execution_id,uploaded.options)).status,'waiting_numeric');assert.equal(uploaded.counts().admissions,0);
 const next=fixture();next.stores.pending=async()=>[{execution_id:'bad-owner-identity'},{execution_id:next.execution_id}];
 assert.deepEqual(await drainSignalListeningDiscoveryAdvancesOnceV1(next.options),{candidates:2,advanced:1,failed:1});
});

test('native parent budget exhaustion is reported as financial failure without another admission or scientific stop',async()=>{
 const f=fixture(),budget={status:'budget_exhausted' as const,execution_id:f.execution_id,workspace_id:f.context.execution.workspace_id,
  error_code:'listening_discovery_parent_budget_exhausted' as const,cap_micro_usd:'1000',exposure_micro_usd:'900',reservation_micro_usd:'250'};
 f.stores.enqueue=async()=>{f.context.execution.status='failed';return budget;};
 const result=await signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options);assert.deepEqual(result,budget);
 assert.equal('reason'in result,false);assert.equal(f.counts().admissions,0);
 assert.equal((await signalListeningDiscoveryAdvanceJobV1(f.execution_id,f.options)).status,'failed');
 assert.equal(f.counts().computations,1);assert.equal(f.counts().persists,1);assert.equal(f.counts().admissions,0);
 const invalid=fixture();invalid.stores.enqueue=async()=>({...budget,execution_id:invalid.execution_id,workspace_id:invalid.context.execution.workspace_id,reservation_micro_usd:'1'});
 await assert.rejects(signalListeningDiscoveryAdvanceJobV1(invalid.execution_id,invalid.options),/budget_outcome_invalid/);
});
