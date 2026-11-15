import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {ListeningDiscoveryCallV1,ListeningDiscoveryLeaseV1} from '@noisia/db';
import {signalWorkspaceEmbeddingDigestV1} from '@noisia/query-engine';
import {signalListeningDiscoveryJobV1,drainSignalListeningDiscoveryOnceV1,startSignalListeningDiscoveryDrainerV1,
  createListeningDiscoveryRawStoreV1,type ListeningDiscoveryWorkerStoresV1,type ListeningDiscoveryWorkerOptionsV1} from './signal-listening-discovery';
import {createWorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import {type ListeningDiscoveryProviderReceiptV1,type ListeningDiscoveryProviderV1} from '../providers/anthropic-listening-discovery';
const ids={round:'10000000-0000-4000-8000-000000000001',workspace:'10000000-0000-4000-8000-000000000002',
  actor:'10000000-0000-4000-8000-000000000003',call:'10000000-0000-4000-8000-000000000004',attempt:'10000000-0000-4000-8000-000000000005',
  preparation:'10000000-0000-4000-8000-000000000006',run:'10000000-0000-4000-8000-000000000007'};
const request_body=JSON.stringify({model:'claude-sonnet-4-6',stream:false,max_tokens:64000,messages:[{role:'user',content:'Synthetic group review'}]});
const receipt=():ListeningDiscoveryProviderReceiptV1=>({bytes:Buffer.from(JSON.stringify({model:'claude-sonnet-4-6',usage:{input_tokens:100,output_tokens:20},content:[]})),http_status:200,provider_request_id:'synthetic-request',complete:true});
const env={NOISIA_LISTENING_DISCOVERY_ENABLED:'true',NOISIA_LISTENING_DISCOVERY_ANTHROPIC_API_KEY:'synthetic-scoped-key',
  NOISIA_SIGNAL_LISTENING_ENABLED:'true',NOISIA_JEV_STREAMING_V2_ENABLED:'true',TYPESAFE_API_KEY:'synthetic-classifier-key'};
function harness(){
  const events:string[]=[],database={}as ListeningDiscoveryWorkerOptionsV1['database'];
  const state={call:undefined as ListeningDiscoveryCallV1|undefined,raw:null as string|null,verified:false,status:'queued',
    leaseToken:null as string|null,child:'completed',activated:false,completed:false,stale:false,revoked:false,
    sends:0,settlements:0,liquidations:0,reserves:0,marks:0,releases:0,renews:0,applies:0,prepares:0,completes:0,activates:0,
    loseRawAck:false,loseSettleAck:false,loseCompleteAck:false,loseActivationAck:false,cas:false,renewFails:false};
  const stores={
    async publicationRecovery(){return state.completed&&!state.activated?{round_id:ids.round,workspace_id:ids.workspace,actor_user_id:ids.actor}:null;},
    async claim(){
      if(state.completed||state.call?.call_state==='outcome_unknown'&&state.verified)return null;
      state.leaseToken=randomUUID();events.push('claim');if(state.status==='queued')state.status='reviewing';
      return{round_id:ids.round,workspace_id:ids.workspace,execution_token:state.leaseToken,request_body,recovery_only:Boolean(state.call&&state.call.call_state!=='reserved')};
    },
    async context(){return{round_id:ids.round,workspace_id:ids.workspace,actor_user_id:ids.actor,request_body,status:state.status,
      output_configuration_id:state.status==='classifying'?'output':null,classification_preparation_id:state.prepares?ids.preparation:null,classification_run_id:state.prepares?ids.run:null};},
    async renew(){state.renews++;return !state.renewFails;},
    async release({lease}:{lease:ListeningDiscoveryLeaseV1}){state.releases++;if(lease.execution_token===state.leaseToken)state.leaseToken=null;},
    async reserve(){state.reserves++;events.push('reserve');state.call??={id:ids.call,workspace_id:ids.workspace,listening_round_id:ids.round,
      attempt_token:ids.attempt,request_digest:signalWorkspaceEmbeddingDigestV1(JSON.parse(request_body)),call_state:'reserved',reserved_micro_usd:'1000000',
      settled_micro_usd:null,response_sha256:null,response_storage_key:null,metadata:{}};return state.call;},
    async markSent(){state.marks++;events.push('mark');if(state.cas)return false;state.call!.call_state='in_flight';return true;},
    async loadRaw(){return state.raw?{raw_text:state.raw,raw_sha256:'sha256:'+createHash('sha256').update(state.raw).digest('hex'),size_bytes:String(Buffer.byteLength(state.raw)),
      storage_key:'private',verification_status:state.verified?'verified':'planned'}:null;},
    async persistRaw({raw_text}:{raw_text:string}){
      events.push('persist');if(state.raw)assert.equal(raw_text,state.raw);state.raw=raw_text;
      if(state.verified)return;
      if(state.loseRawAck){state.loseRawAck=false;throw Error('synthetic raw storage ack lost');}
      state.verified=true;const wrapper=JSON.parse(raw_text);
      state.call!.call_state=wrapper.complete&&wrapper.http_status===200?'response_persisted':'outcome_unknown';
    },
    async settle(){events.push('settle');state.settlements++;assert.ok(state.verified);assert.ok(JSON.parse(state.raw!).complete);
      if(state.call!.call_state==='settled')return{cost_micro_usd:600,replayed:true};state.liquidations++;
      state.call!.call_state='settled';state.call!.settled_micro_usd='600';state.status='reviewed';
      if(state.loseSettleAck){state.loseSettleAck=false;throw Error('synthetic settlement ack lost');}return{cost_micro_usd:600,replayed:state.settlements>1};},
    async fail({outcome}:{outcome:string}){events.push('fail');if(state.call&&!['settled','response_persisted'].includes(state.call.call_state))
      state.call.call_state=outcome==='definitely_not_sent'&&state.call.call_state==='reserved'?'definitely_not_sent':'outcome_unknown';},
    async applyReview(){events.push('apply');state.applies++;assert.equal(state.call!.call_state,'settled');if(state.stale){state.status='stale';return{status:'stale',round_id:ids.round};}
      state.status='classifying';return{status:'classifying',round_id:ids.round,configuration_id:'output',generation_id:'generation'};},
    async prepareChild(){events.push('child');state.prepares++;assert.equal(state.status,'classifying');return{id:ids.preparation,status:state.child,listening_run_id:ids.run};},
    async complete(){events.push('complete');assert.equal(state.child,'completed');state.completes++;state.completed=true;state.status='completed';
      if(state.loseCompleteAck){state.loseCompleteAck=false;throw Error('synthetic complete ack lost');}return{stop_decision:{stop:true,reason:'map_unchanged'}};},
    async activate(){events.push('activate');state.activates++;if(state.revoked)throw Object.assign(Error('listening_discovery_forbidden'),{code:'listening_discovery_forbidden'});
      state.activated=true;if(state.loseActivationAck){state.loseActivationAck=false;throw Error('synthetic activation ack lost');}return{id:'snapshot'};},
  }as unknown as ListeningDiscoveryWorkerStoresV1;
  const provider:ListeningDiscoveryProviderV1={assertReady(body){events.push('preflight');assert.equal(body,request_body);},async generate(body){
    events.push('http');state.sends++;assert.equal(body,request_body);return receipt();}};
  const options:ListeningDiscoveryWorkerOptionsV1={database,stores,provider,env,raw_store:{}as never,
    assert_storage_ready:async()=>{events.push('storage_ready');}};
  return{state,stores,provider,options,events,run:(overrides:Partial<ListeningDiscoveryWorkerOptionsV1>={})=>signalListeningDiscoveryJobV1(ids.round,{...options,...overrides})};
}
test('admitted discovery runs one physical review after preflight, persists before usage, and publishes the completed child',async()=>{
  const h=harness();assert.equal((await h.run()).status,'completed');assert.equal(h.state.sends,1);assert.equal(h.state.settlements,1);assert.equal(h.state.activated,true);
  assert.deepEqual(Buffer.from(JSON.parse(h.state.raw!).body_base64,'base64'),receipt().bytes);
  for(const [a,b]of [['preflight','mark'],['storage_ready','mark'],['mark','http'],['http','persist'],['persist','settle'],['settle','apply'],['apply','child'],['complete','activate']])
    assert.ok(h.events.indexOf(a!)<h.events.indexOf(b!));
  assert.equal((await h.run()).status,'not_claimed');assert.equal(h.state.sends,1);
});
test('a false mark CAS and storage preflight failure never send and never release another sender',async()=>{
  const cas=harness();cas.state.cas=true;assert.equal((await cas.run()).status,'reconciliation_only');assert.equal(cas.state.sends,0);
  assert.equal(cas.state.releases,0);assert.ok(!cas.events.includes('fail'));
  const failed=harness();await assert.rejects(failed.run({assert_storage_ready:async()=>{throw Error('synthetic storage unavailable');}}));
  assert.equal(failed.state.marks,0);assert.equal(failed.state.sends,0);assert.equal(failed.state.call!.call_state,'reserved');
});
test('a global Anthropic key or disabled flag cannot authorize a scoped discovery send',async()=>{
  for(const override of [{...env,NOISIA_LISTENING_DISCOVERY_ANTHROPIC_API_KEY:undefined,ANTHROPIC_API_KEY:'synthetic-global-key'},
    {...env,NOISIA_LISTENING_DISCOVERY_ENABLED:'false'}]){
    const h=harness();assert.equal((await h.run({env:override})).status,'disabled');assert.equal(h.state.sends,0);assert.equal(h.state.marks,0);
  }
});
test('identity mismatch and disabling during preflight close the send gate before CAS',async()=>{
  const h=harness(),base=h.stores.context;
  h.stores.context=async args=>{const context=await base(args);assert.ok(context);return{...context,workspace_id:randomUUID()};};
  await assert.rejects(h.run(),/listening_discovery_scope_invalid/);assert.equal(h.state.reserves,0);assert.equal(h.state.sends,0);
  const changed=harness(),current={...env};
  assert.equal((await changed.run({env:current,assert_storage_ready:async()=>{current.NOISIA_LISTENING_DISCOVERY_ENABLED='false';}})).status,'stopped');
  assert.equal(changed.state.marks,0);assert.equal(changed.state.sends,0);
  const binding=harness(),claim=binding.stores.claim;
  binding.stores.claim=async args=>{const lease=await claim(args);return lease?{...lease,request_body:request_body.replace('Synthetic group review','Altered group review')}:null;};
  binding.provider.assertReady=()=>{};
  await assert.rejects(binding.run(),/listening_discovery_request_binding_invalid/);assert.equal(binding.state.marks,0);assert.equal(binding.state.sends,0);
});
test('raw storage or settlement ACK loss recovers identical paid bytes without a key or another physical request',async()=>{
  for(const phase of ['raw','settle']){
    const h=harness();if(phase==='raw')h.state.loseRawAck=true;else h.state.loseSettleAck=true;
    await assert.rejects(h.run());const original=h.state.raw;assert.ok(original);assert.equal(h.state.sends,1);
    const recovered=await h.run({env:{NOISIA_LISTENING_DISCOVERY_ENABLED:'false'}});
    assert.equal(recovered.status,'recovered');assert.equal(h.state.raw,original);assert.equal(h.state.sends,1);
    assert.equal(h.state.call!.call_state,'settled');assert.equal(h.state.applies,0);assert.equal(h.state.liquidations,1);
  }
});
test('partial valid-JSON HTTP200, invalid UTF8, 429 and 529 remain unknown and never settle or publish',async()=>{
  for(const value of [{...receipt(),complete:false},{...receipt(),bytes:Buffer.from([0xff])},{...receipt(),http_status:429},{...receipt(),http_status:529}]){
    const h=harness();h.provider.generate=async()=>{h.state.sends++;return value;};
    assert.equal((await h.run()).status,'outcome_unknown');assert.ok(h.state.raw);assert.equal(h.state.settlements,0);assert.equal(h.state.applies,0);
    assert.equal((await h.run()).status,'not_claimed');assert.equal(h.state.sends,1);
  }
});
test('unknown transport with no durable bytes is contained and never resent',async()=>{
  const h=harness();h.provider.generate=async()=>{h.state.sends++;throw Error('synthetic network reset');};
  await assert.rejects(h.run());assert.equal(h.state.call!.call_state,'outcome_unknown');
  assert.equal((await h.run()).status,'reconciliation_only');assert.equal(h.state.sends,1);
});
test('waiting child releases immediately and a later human revision wins without repeating the provider',async()=>{
  const h=harness();h.state.child='labeling';assert.equal((await h.run()).status,'waiting_child');assert.equal(h.state.releases,1);
  h.state.child='completed';assert.equal((await h.run()).status,'completed');assert.equal(h.state.sends,1);assert.equal(h.state.applies,1);
  const stale=harness();stale.state.stale=true;assert.equal((await stale.run()).status,'stale');assert.equal(stale.state.prepares,0);assert.equal(stale.state.activated,false);
});
test('a lost completion or activation acknowledgement is recovered without reopening a terminal round',async()=>{
  for(const phase of ['complete','activate']){
    const h=harness();if(phase==='complete')h.state.loseCompleteAck=true;else h.state.loseActivationAck=true;
    await assert.rejects(h.run());assert.equal(h.state.completed,true);assert.equal(h.state.sends,1);
    const result=await h.run({env:{}});assert.equal(result.status,phase==='complete'?'completed':'not_claimed');
    assert.equal(h.state.activated,true);assert.equal(h.state.sends,1);
  }
  const revoked=harness();revoked.state.completed=true;revoked.state.revoked=true;
  await assert.rejects(revoked.run(),/listening_discovery_forbidden/);assert.equal(revoked.state.sends,0);assert.equal(revoked.state.activated,false);
});
test('lease loss during HTTP preserves and settles the receipt but prevents publication under the lost lease',async()=>{
  const h=harness();h.state.renewFails=true;
  h.provider.generate=async()=>{h.state.sends++;await delay(15);return receipt();};
  assert.equal((await h.run({renewal_ms:1})).status,'reconciliation_only');assert.ok(h.state.renews>0);
  assert.equal(h.state.call!.call_state,'settled');assert.equal(h.state.applies,0);assert.equal(h.state.sends,1);
});
test('nullable context and a false renewal CAS before send cannot reserve or dispatch unauthorized work',async()=>{
  const missing=harness();missing.stores.context=async()=>null;
  await assert.rejects(missing.run(),/listening_discovery_lease_lost/);assert.equal(missing.state.reserves,0);assert.equal(missing.state.sends,0);
  const expired=harness();expired.state.renewFails=true;
  await assert.rejects(expired.run({renewal_ms:1,assert_storage_ready:async()=>{await delay(15);}}),/listening_discovery_lease_lost/);
  assert.equal(expired.state.marks,0);assert.equal(expired.state.sends,0);assert.equal(expired.state.call!.call_state,'reserved');
});
test('drainer defaults off, drains only admitted identities and shutdown stops a new send before mark',async()=>{
  const h=harness();let enabled:unknown,runs=0;
  const result=await drainSignalListeningDiscoveryOnceV1({...h.options,env:{},list:async args=>{enabled=args.enabled;return[
    {round_id:ids.round,workspace_id:ids.workspace,actor_user_id:ids.actor,status:'queued'},
    {round_id:randomUUID(),workspace_id:ids.workspace,actor_user_id:ids.actor,status:'classifying'}];},run:async()=>{runs++;return{round_id:ids.round,status:'recovered'};}});
  assert.equal(enabled,false);assert.equal(runs,1);assert.equal(result.reconciled,1);
  let entered!:()=>void,release!:()=>void;const enteredPromise=new Promise<void>(done=>{entered=done;}),gate=new Promise<void>(done=>{release=done;});
  const drainer=startSignalListeningDiscoveryDrainerV1({...h.options,run_immediately:false,interval_ms:60000,
    list:async()=>[{round_id:ids.round,workspace_id:ids.workspace,actor_user_id:ids.actor,status:'queued'}],
    assert_storage_ready:async()=>{entered();await gate;}});
  const active=drainer.drainNow();await enteredPromise;let closed=false;
  const closing=drainer.close().then(()=>{closed=true;});await delay(0);assert.equal(closed,false);release();await active;await closing;
  assert.equal(h.state.sends,0);assert.equal(h.state.marks,0);assert.equal(closed,true);
});
test('shutdown drains an already granted HTTP request into paid custody and prevents its next stage',async()=>{
  const h=harness();let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(done=>{entered=done;}),gate=new Promise<void>(done=>{release=done;});
  h.provider.generate=async()=>{h.state.sends++;entered();await gate;return receipt();};
  const drainer=startSignalListeningDiscoveryDrainerV1({...h.options,run_immediately:false,interval_ms:60000,
    list:async()=>[{round_id:ids.round,workspace_id:ids.workspace,actor_user_id:ids.actor,status:'queued'},
      {round_id:randomUUID(),workspace_id:ids.workspace,actor_user_id:ids.actor,status:'queued'}]});
  const active=drainer.drainNow();await started;let closed=false;
  const closing=drainer.close().then(()=>{closed=true;});await delay(0);assert.equal(closed,false);release();await active;await closing;
  assert.equal(h.state.sends,1);assert.equal(h.state.liquidations,1);assert.equal(h.state.call!.call_state,'settled');
  assert.equal(h.state.applies,0);assert.equal(h.state.prepares,0);assert.equal(closed,true);
});
test('raw adapter uses production immutable multipart upload and authenticated checksum readback',async()=>{
  const objects=new Map<string,Buffer>();let gets=0,puts=0;
  const native=createWorkspaceEngineStorageV1({url:'http://127.0.0.1',service_role_key:'synthetic-private-storage-key',bucket:'corpus-files',
    fetch:async(url,init)=>{
      const path=new URL(String(url)).pathname;if(path.includes('/bucket/'))return Response.json({id:'corpus-files',public:false});
      const key=path.replace('/object/authenticated/','/object/');
      if(init?.method==='POST'){puts++;if(objects.has(key))return new Response(null,{status:409});objects.set(key,Buffer.from(init.body as Uint8Array));return Response.json({});}
      gets++;const value=objects.get(key);return value?new Response(new Uint8Array(value)):new Response(null,{status:404});
    }});
  const store=createListeningDiscoveryRawStoreV1(native),raw_text='{"synthetic":"durable group receipt"}',
    raw_sha256='sha256:'+createHash('sha256').update(raw_text).digest('hex');
  const args={workspace_id:ids.workspace,round_id:ids.round,call_id:ids.call,name:`review-${raw_sha256.slice(7)}.json`,raw_text,
    raw_sha256,size_bytes:Buffer.byteLength(raw_text)};
  await native.assertReady!();const stored=await store.store(args);
  assert.equal(stored.storage_key,store.reference(args).storage_key);assert.equal(await store.load(stored),raw_text);
  assert.equal(puts,2);assert.ok(gets>=4);
  await assert.rejects(store.store({...args,name:'another.json'}),/listening_discovery_raw_invalid/);
  const key=[...objects.keys()].find(key=>key.includes('.part-'))!;objects.set(key,Buffer.from('corrupt'));
  await assert.rejects(store.load(stored),/workspace_engine_storage_/);
});

test('native child recovery state is retained without completing or repeating the paid review',async()=>{
 for(const recovery_pending of [true,false]){
  const h=harness();
  h.stores.prepareChild=async()=>({id:ids.preparation,status:'failed',listening_run_id:ids.run,
   discovery_round_status:'outcome_unknown',recovery_pending} as never);
  const result=await h.run();assert.equal(result.status,'waiting_child_recovery');
  assert.equal('recovery_pending' in result&&result.recovery_pending,recovery_pending);
  assert.equal(h.state.sends,1);assert.equal(h.state.liquidations,1);assert.equal(h.state.completes,0);assert.equal(h.state.activates,0);
 }
 for(const status of ['failed','stale'] as const){
  const h=harness();h.stores.prepareChild=async()=>({id:ids.preparation,status:'completed',listening_run_id:ids.run,
   discovery_round_status:status,recovery_pending:false} as never);
  assert.equal((await h.run()).status,status==='stale'?'stale':'child_failed');assert.equal(h.state.completes,0);assert.equal(h.state.activates,0);
 }
});
