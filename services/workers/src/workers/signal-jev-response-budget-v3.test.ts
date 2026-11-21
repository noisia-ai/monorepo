import test from 'node:test';
import assert from 'node:assert/strict';
import {registerJevPhaseClosedBindingV3,retireJevPhaseClosedBindingV3,resolveJevPhaseClosedBindingV3,
  tryCreateJevPhaseBudgetOwnerV3,type JevPhaseBudgetParametersV3,type JevPhaseSharedBudgetV3,
  type JevPhaseCaptureLeaseV3,type JevPhaseFlushLeaseV3} from './signal-jev-response-budget-v3';

// Abstract byte-accounting fixtures. These small numbers DO NOT bind an actual
// provider's headers/body/mapper or claim a peak heap or throughput result.
const base:JevPhaseBudgetParametersV3={body_bound_bytes:1,header_bound_bytes:1,ledger_bytes:7,
  max_capture_bytes:64,max_retained_bytes:32,max_raw_wrapper_bytes:16,max_row_flush_bytes:128,
  flush_fixed_bytes:4,raw_member_overhead_bytes:2,max_page_bytes:256,max_pending_calls:8,max_active_flushes:2,max_flush_rows:4};
function fixture(limit=1000,patch:Partial<JevPhaseBudgetParametersV3>={}){
  let memory=0;const history:number[]=[];
  const shared:JevPhaseSharedBudgetV3={limit,used:()=>memory,tryClaim(bytes){if(memory+bytes>limit)return false;memory+=bytes;history.push(memory);return true;},
    release(bytes){assert.ok(bytes>=0&&bytes<=memory);memory-=bytes;history.push(memory);}};
  const provider={},mapper={},profile={...base,...patch},binding=registerJevPhaseClosedBindingV3({provider_owner:provider,mapper_owner:mapper,parameters:profile});
  const owner=tryCreateJevPhaseBudgetOwnerV3({binding,provider_owner:provider,mapper_owner:mapper,shared});assert.ok(owner);
  const quote=(maxWork=50,capture=40,retained=20,maxRaw=10)=>owner.quoteCall({capture_bytes:capture,retained_bound_bytes:retained,max_raw_wrapper_bytes:maxRaw,max_row_flush_bytes:maxWork});
  const retain=(lease:JevPhaseCaptureLeaseV3,bytes=10,work=12,raw=4)=>owner.transferToRetained(lease,{retained_bytes:bytes,row_flush_bytes:work,raw_wrapper_bytes:raw});
  const external=(bytes:number)=>{assert.equal(shared.tryClaim(bytes),true);let released=false;return()=>{assert.equal(released,false);released=true;shared.release(bytes);};};
  return{owner,shared,provider,mapper,binding,profile,quote,retain,external,history};
}

test('V3 absent/foreign/spread/recovery bindings select LEGACY without claiming shared bytes',()=>{
  const f=fixture();const before=f.shared.used();
  for(const binding of [undefined,null,{},JSON.parse(JSON.stringify(f.binding)),{...f.binding}]){
    assert.equal(tryCreateJevPhaseBudgetOwnerV3({binding,provider_owner:f.provider,mapper_owner:f.mapper,shared:f.shared}),null);
  }
  assert.equal(tryCreateJevPhaseBudgetOwnerV3({binding:f.binding,provider_owner:{...f.provider},mapper_owner:f.mapper,shared:f.shared}),null);
  assert.equal(tryCreateJevPhaseBudgetOwnerV3({binding:f.binding,provider_owner:f.provider,mapper_owner:()=>{},shared:f.shared}),null);
  assert.equal(tryCreateJevPhaseBudgetOwnerV3({binding:f.binding,provider_owner:f.provider,mapper_owner:f.mapper,recovery_only:true,shared:f.shared}),null);
  assert.equal(f.shared.used(),before);assert.equal(retireJevPhaseClosedBindingV3(f.binding),true);
  assert.equal(resolveJevPhaseClosedBindingV3({binding:f.binding,provider_owner:f.provider,mapper_owner:f.mapper}),null);
  assert.equal(retireJevPhaseClosedBindingV3(f.binding),false);f.owner.close();assert.equal(f.shared.used(),0);
});

test('V3 profile requires finite bounded integer H/B and rejects accessor parameters',()=>{
  for(const key of ['body_bound_bytes','header_bound_bytes']as const)for(const value of [NaN,Infinity,-1,0,.5,2*1024*1024+1]){
    assert.throws(()=>registerJevPhaseClosedBindingV3({provider_owner:{},mapper_owner:{},parameters:{...base,[key]:value}}),/profile_invalid/);
  }
  let invoked=false;const profile={...base};Object.defineProperty(profile,'max_capture_bytes',{get(){invoked=true;throw Error('not data');},enumerable:true});
  assert.throws(()=>registerJevPhaseClosedBindingV3({provider_owner:{},mapper_owner:{},parameters:profile}),/profile_invalid/);assert.equal(invoked,false);
  assert.throws(()=>registerJevPhaseClosedBindingV3({provider_owner:{},mapper_owner:{},parameters:{...base,max_page_bytes:4}}),/profile_invalid/);
});

test('V3 numeric prefix quotes are pure, ordered and monotone before a pre-COMMIT claim',()=>{
  const f=fixture(1000),quotes=[f.quote(20,20,10),f.quote(50,40,20),f.quote(70,50,30)],before=f.shared.used();
  const values=quotes.map((_q,i)=>f.owner.quotePrefix(quotes,i+1));
  assert.deepEqual(values.map(v=>v.count),[1,2,3]);assert.deepEqual(values.map(v=>v.headroom_after_bytes),[24,54,74]);
  assert.deepEqual(values.map(v=>v.required_bytes),[44,114,184]);assert.equal(f.shared.used(),before);
  const reserved=f.owner.reservePrefix(quotes);assert.ok(reserved);assert.equal(reserved.quote.required_bytes,184);
  assert.equal(f.shared.used(),base.ledger_bytes+184);assert.equal(f.owner.snapshot().reserved_calls,3);
  for(const lease of reserved.leases)f.owner.releaseUnsent(lease);
  assert.equal(f.owner.snapshot().protected_bytes,74);f.owner.close();assert.equal(f.shared.used(),0);
});

test('V3 a stale prefix shrinks against current shared Survey/Native credit before COMMIT',()=>{
  const f=fixture(200),q=f.quote(),quotes=[q,q,q],old=f.owner.quotePrefix(quotes);assert.equal(old.count,3);
  const releaseSurvey=f.external(60),reserved=f.owner.reservePrefix(quotes);assert.ok(reserved);
  assert.equal(reserved.quote.count,1);assert.equal(reserved.quote.capture_bytes,40);assert.equal(reserved.quote.headroom_delta_bytes,54);
  assert.equal(f.shared.used(),161);f.owner.releaseUnsent(reserved.leases[0]!);f.owner.close();assert.equal(f.shared.used(),60);releaseSurvey();assert.equal(f.shared.used(),0);
});

test('V3 no fitting call changes neither G nor the shared counter',()=>{
  const f=fixture(50),before=f.owner.snapshot();assert.equal(f.owner.reservePrefix([f.quote()]),null);
  assert.deepEqual(f.owner.snapshot(),before);f.owner.close();assert.equal(f.shared.used(),0);
});

test('V3 capture transfers to retained physical once and RAW workspace is claimed before buffer removal',()=>{
  const f=fixture(200),q=f.quote(),reserved=f.owner.reservePrefix([q,q,q]);assert.ok(reserved);assert.equal(f.shared.used(),181);
  for(const lease of reserved.leases)f.retain(lease);
  assert.equal(f.shared.used(),91);assert.equal(f.owner.snapshot().retained_calls,3);
  const flush=f.owner.takeFlushPrefix(reserved.leases);assert.ok(flush);assert.equal(flush.count,3);assert.equal(flush.raw_page_bytes,30);
  assert.equal(flush.working_bytes,40);assert.equal(flush.additional_bytes,0);assert.equal(flush.borrows_headroom,true);
  assert.equal(f.shared.used(),91);assert.equal(f.owner.snapshot().flushing_calls,3);
  f.owner.finishFlush(flush.lease);assert.equal(f.shared.used(),61);assert.equal(f.owner.snapshot().protected_bytes,54);
  f.owner.close();assert.equal(f.shared.used(),0);assert.ok(f.history.every(n=>n>=0&&n<=200));
});

test('V3 protected G starts the next maximum paid row even at zero shared free bytes',()=>{
  const f=fixture(141),q=f.quote(),reserved=f.owner.reservePrefix([q,q]);assert.ok(reserved);
  for(const lease of reserved.leases)f.retain(lease,10,50,4);
  const releaseSurvey=f.external(60);assert.equal(f.shared.used(),141);
  const first=f.owner.takeFlushPrefix([reserved.leases[0]!],1);assert.ok(first);assert.equal(first.additional_bytes,0);
  f.owner.finishFlush(first.lease);assert.equal(f.owner.snapshot().protected_bytes,54);assert.equal(f.shared.used(),131);
  const releaseNative=f.external(10);assert.equal(f.shared.used(),141);
  const second=f.owner.takeFlushPrefix([reserved.leases[1]!],1);assert.ok(second);assert.equal(second.additional_bytes,0);
  f.owner.finishFlush(second.lease);assert.equal(f.shared.used(),131);f.owner.close();assert.equal(f.shared.used(),70);
  releaseNative();releaseSurvey();assert.equal(f.shared.used(),0);
});

test('V3 only one active flush borrows G and the second pays its complete await-spanning workspace',()=>{
  const f=fixture(200),q=f.quote(),reserved=f.owner.reservePrefix([q,q]);assert.ok(reserved);for(const lease of reserved.leases)f.retain(lease,5,10,2);
  assert.equal(f.shared.used(),71);
  const a=f.owner.takeFlushPrefix([reserved.leases[0]!],1),b=f.owner.takeFlushPrefix([reserved.leases[1]!],1);assert.ok(a&&b);
  assert.equal(a.borrows_headroom,true);assert.equal(a.additional_bytes,0);assert.equal(b.borrows_headroom,false);assert.equal(b.additional_bytes,14);
  assert.equal(f.shared.used(),85);assert.equal(f.owner.snapshot().active_flushes,2);
  f.owner.finishFlush(a.lease);assert.equal(f.shared.used(),80);assert.equal(f.owner.snapshot().protected_bytes,54);
  assert.equal(f.owner.snapshot().headroom_borrowed,false);f.owner.finishFlush(b.lease);assert.equal(f.shared.used(),61);
  f.owner.close();assert.equal(f.shared.used(),0);
});

test('V3 G grows before COMMIT while a borrower keeps its old extra charge until its own close',()=>{
  const f=fixture(200),small=f.quote(20),initial=f.owner.reservePrefix([small,small]);assert.ok(initial);
  for(const lease of initial.leases)f.retain(lease,10,20,4);
  const flush=f.owner.takeFlushPrefix(initial.leases);assert.ok(flush);assert.equal(flush.working_bytes,44);assert.equal(flush.additional_bytes,20);assert.equal(f.shared.used(),71);
  const next=f.owner.reservePrefix([f.quote(70)]);assert.ok(next);assert.equal(next.quote.headroom_delta_bytes,50);
  assert.equal(f.owner.snapshot().protected_bytes,74);assert.equal(f.shared.used(),161,'the old borrower extra20 is not optimistically refunded');
  f.owner.finishFlush(flush.lease);assert.equal(f.shared.used(),121);
  f.owner.releaseUnsent(next.leases[0]!);assert.equal(f.shared.used(),81);f.owner.close();assert.equal(f.shared.used(),0);
});

test('V3 two deferred flush ACK owners coexist with new receipt custody and an external Survey',async()=>{
  const f=fixture(200),q=f.quote(),initial=f.owner.reservePrefix([q,q]);assert.ok(initial);for(const lease of initial.leases)f.retain(lease,5,10,2);
  const a=f.owner.takeFlushPrefix([initial.leases[0]!],1),b=f.owner.takeFlushPrefix([initial.leases[1]!],1);assert.ok(a&&b);
  let ackA!:()=>void,ackB!:()=>void;
  const taskA=new Promise<void>(resolve=>{ackA=resolve;}).then(()=>f.owner.finishFlush(a.lease));
  const taskB=new Promise<void>(resolve=>{ackB=resolve;}).then(()=>f.owner.finishFlush(b.lease));
  const next=f.owner.reservePrefix([q]);assert.ok(next);assert.equal(f.shared.used(),125);
  const releaseSurvey=f.external(75);assert.equal(f.shared.used(),200);
  f.retain(next.leases[0]!,10,10,2);assert.equal(f.shared.used(),170);
  assert.equal(f.owner.takeFlushPrefix([next.leases[0]!]),null,'both independent flush owners retain their workspace until ACK');
  ackA();await taskA;assert.equal(f.shared.used(),165);
  const third=f.owner.takeFlushPrefix([next.leases[0]!]);assert.ok(third);assert.equal(third.additional_bytes,0,'G returns to its owner, not to new admission');
  f.owner.finishFlush(third.lease);ackB();await taskB;f.owner.close();assert.equal(f.shared.used(),75);releaseSurvey();assert.equal(f.shared.used(),0);
});

test('V3 RAW codec page cap shrinks the ordered flush prefix without discarding the remainder',()=>{
  const f=fixture(200,{max_raw_wrapper_bytes:10,max_page_bytes:20}),q=f.quote(50,40,20,10),reserved=f.owner.reservePrefix([q,q]);assert.ok(reserved);
  for(const lease of reserved.leases)f.retain(lease,10,20,8);
  const a=f.owner.takeFlushPrefix(reserved.leases);assert.ok(a);assert.equal(a.count,1);assert.equal(a.raw_page_bytes,14);f.owner.finishFlush(a.lease);
  const b=f.owner.takeFlushPrefix([reserved.leases[1]!]);assert.ok(b);assert.equal(b.count,1);f.owner.finishFlush(b.lease);f.owner.close();assert.equal(f.shared.used(),0);
});

test('V3 invalid observations and aliased leases never mutate credit or permit double release',()=>{
  const f=fixture(200),q=f.quote(),reserved=f.owner.reservePrefix([q]);assert.ok(reserved);const lease=reserved.leases[0]!,before=f.shared.used();
  assert.throws(()=>f.owner.transferToRetained(lease,{retained_bytes:21,raw_wrapper_bytes:4,row_flush_bytes:12}),/retained_bound_invalid/);
  assert.equal(f.shared.used(),before);f.retain(lease);
  assert.throws(()=>f.retain(lease),/capture_lease_invalid/);assert.throws(()=>f.owner.releaseUnsent(lease),/capture_lease_invalid/);
  const after=f.shared.used();assert.throws(()=>f.owner.takeFlushPrefix([lease,lease]),/flush_alias_invalid/);assert.equal(f.shared.used(),after);
  assert.throws(()=>f.owner.releaseUnsent({}as JevPhaseCaptureLeaseV3),/capture_lease_invalid/);
  const flush=f.owner.takeFlushPrefix([lease]);assert.ok(flush);assert.throws(()=>f.owner.close(),/owner_busy/);f.owner.finishFlush(flush.lease);
  const closedRow=f.shared.used();assert.throws(()=>f.owner.finishFlush(flush.lease),/flush_lease_invalid/);assert.throws(()=>f.owner.finishFlush({}as JevPhaseFlushLeaseV3),/flush_lease_invalid/);assert.equal(f.shared.used(),closedRow);
  f.owner.close();assert.equal(f.shared.used(),0);assert.throws(()=>f.owner.close(),/owner_closed/);assert.equal(f.shared.used(),0);
});

test('V3 foreign numeric quote identities cannot reserve bytes under another owner',()=>{
  const f=fixture(),other=fixture(),q=other.quote(),before=f.shared.used();
  assert.throws(()=>f.owner.reservePrefix([q]),/quote_invalid/);assert.equal(f.shared.used(),before);
  assert.throws(()=>f.owner.reservePrefix([JSON.parse(JSON.stringify(f.quote()))]),/quote_invalid/);assert.equal(f.shared.used(),before);
  f.owner.close();other.owner.close();assert.equal(f.shared.used(),0);assert.equal(other.shared.used(),0);
});

test('V3 a shared-counter exception poisons the owner and preserves a falsy first cause',()=>{
  for(const first of [null,undefined,0]){
    let memory=0,breakClaim=false,calls=0;const provider={},mapper={};
    const shared:JevPhaseSharedBudgetV3={limit:1000,used:()=>memory,tryClaim(n){calls++;if(breakClaim)throw first;memory+=n;return true;},release(n){memory-=n;}};
    const binding=registerJevPhaseClosedBindingV3({provider_owner:provider,mapper_owner:mapper,parameters:base});
    const owner=tryCreateJevPhaseBudgetOwnerV3({binding,provider_owner:provider,mapper_owner:mapper,shared});assert.ok(owner);
    const q=owner.quoteCall({capture_bytes:40,retained_bound_bytes:20,max_raw_wrapper_bytes:10,max_row_flush_bytes:50});breakClaim=true;
    let known=false,caught:unknown;try{owner.reservePrefix([q]);}catch(error){known=true;caught=error;}
    assert.equal(known,true);assert.strictEqual(caught,first);assert.equal(owner.snapshot().counter_uncertain,true);assert.equal(owner.snapshot().shared_used_bytes,null);
    const count=calls;known=false;try{owner.close();}catch(error){known=true;assert.strictEqual(error,first);}
    assert.equal(known,true);assert.equal(calls,count,'uncertainty never retries or blindly releases the shared counter');
  }
});


test('V3 an oversized finite capture quote is a no-fit prefix, not an arithmetic exception',()=>{
  const f=fixture(200,{max_capture_bytes:Number.MAX_SAFE_INTEGER}),q=f.quote(50,Number.MAX_SAFE_INTEGER),before=f.owner.snapshot();
  assert.equal(f.owner.quotePrefix([q]).count,0);assert.equal(f.owner.reservePrefix([q]),null);
  assert.deepEqual(f.owner.snapshot(),before);f.owner.close();assert.equal(f.shared.used(),0);
});

test('V3 a huge finite flush prefix truncates before its addition could overflow',()=>{
  const work=Number.MAX_SAFE_INTEGER-100,f=fixture(Number.MAX_SAFE_INTEGER,{max_row_flush_bytes:work}),q=f.quote(work),reserved=f.owner.reservePrefix([q,q]);assert.ok(reserved);assert.equal(reserved.leases.length,2);
  for(const lease of reserved.leases)f.retain(lease,1,work,1);
  const first=f.owner.takeFlushPrefix(reserved.leases);assert.ok(first);assert.equal(first.count,1);assert.equal(first.additional_bytes,0);
  f.owner.finishFlush(first.lease);const second=f.owner.takeFlushPrefix([reserved.leases[1]!]);assert.ok(second);assert.equal(second.count,1);
  f.owner.finishFlush(second.lease);f.owner.close();assert.equal(f.shared.used(),0);
});
