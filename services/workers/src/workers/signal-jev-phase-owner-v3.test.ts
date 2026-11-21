import assert from 'node:assert/strict';
import test from 'node:test';
import {createTypesafeJevClientV1} from '../providers/typesafe-jev';
import {jevLegacyCaptureProfileV3,createJevListeningPhaseBindingV3} from './signal-jev-phase-profile-v3';
import {tryCreateJevPhaseBudgetOwnerV3,resolveJevPhaseClosedBindingV3} from './signal-jev-response-budget-v3';

function fixture(limit=512*1024*1024){
 const provider=createTypesafeJevClientV1({enabled:false,max_response_bytes:16384}),mapper={};
 const execution={max_in_flight:3,window_size:4,flush_size:1,max_flushes:2,flush_interval_ms:250,max_buffered_bytes:limit};
 const profile=jevLegacyCaptureProfileV3(provider,execution)!,binding=createJevListeningPhaseBindingV3(provider,execution,mapper)!;
 let used=0;const shared={limit,used:()=>used,tryClaim:(bytes:number)=>{if(bytes>limit-used)return false;used+=bytes;return true;},release:(bytes:number)=>{used-=bytes;}};
 const owner=tryCreateJevPhaseBudgetOwnerV3({binding,provider_owner:provider,mapper_owner:mapper,shared})!;
 const quote=()=>owner.quoteCall({capture_bytes:profile.max_capture_bytes,retained_bound_bytes:profile.max_retained_bytes,
  max_raw_wrapper_bytes:profile.max_raw_wrapper_bytes,max_row_flush_bytes:profile.max_row_flush_bytes});
 return{owner,profile,binding,provider,mapper,shared,quote};
}
test('explicit legacy capture mode has exact inherited P and no fictitious header bound',()=>{
 const f=fixture();assert.equal(f.profile.capture_mode,'legacy_capture');assert.equal('header_bound_bytes'in f.profile,false);
 assert.equal(f.profile.max_capture_bytes,24*16384+65536);
 assert.deepEqual(resolveJevPhaseClosedBindingV3({binding:f.binding,provider_owner:f.provider,mapper_owner:f.mapper}),f.profile);
 assert.equal(resolveJevPhaseClosedBindingV3({binding:{...f.binding},provider_owner:f.provider,mapper_owner:f.mapper}),null);
 assert.equal(resolveJevPhaseClosedBindingV3({binding:f.binding,provider_owner:{...f.provider},mapper_owner:f.mapper}),null);
 assert.equal(resolveJevPhaseClosedBindingV3({binding:f.binding,provider_owner:f.provider,mapper_owner:f.mapper,recovery_only:true}),null);
 f.owner.close();assert.equal(f.shared.used(),0);
});
test('quarantine returns only exited F, keeps R and G, closes admission and requires actual reconciliation',()=>{
 const f=fixture(),held=f.owner.reservePrefix([f.quote(),f.quote()])!;
 for(const lease of held.leases)f.owner.transferToRetained(lease,{retained_bytes:1000,raw_wrapper_bytes:100,row_flush_bytes:10000});
 const first=f.owner.takeFlushPrefix([held.leases[0]!])!,second=f.owner.takeFlushPrefix([held.leases[1]!])!;
 assert.equal(first.additional_bytes,0);assert.equal(second.additional_bytes,10000+f.profile.flush_fixed_bytes);
 const before=f.owner.snapshot(),quarantined=f.owner.quarantineFlush(first.lease),after=f.owner.snapshot();
 assert.equal(after.retained_bytes,2000);assert.equal(after.protected_bytes,before.protected_bytes);assert.equal(after.active_flushes,1);
 assert.equal(after.quarantined_calls,1);assert.equal(after.admission_closed,true);assert.equal(after.owned_bytes,before.owned_bytes);
 assert.equal(f.owner.reservePrefix([f.quote()]),null);assert.throws(()=>f.owner.close(),/owner_busy/);
 const next=f.owner.snapshot();assert.throws(()=>f.owner.quarantineFlush(first.lease),/flush_lease_invalid/);assert.deepEqual(f.owner.snapshot(),next);
 f.owner.finishFlush(second.lease);assert.equal(f.owner.snapshot().retained_bytes,1000);
 assert.equal(f.owner.snapshot().protected_bytes,before.protected_bytes);assert.throws(()=>f.owner.close(),/owner_busy/);
 f.owner.reconcileQuarantined(quarantined);assert.equal(f.owner.snapshot().retained_bytes,0);
 const reconciled=f.owner.snapshot();assert.throws(()=>f.owner.reconcileQuarantined(quarantined),/capture_lease_invalid/);assert.deepEqual(f.owner.snapshot(),reconciled);
 f.owner.close();assert.equal(f.shared.used(),0);
});
test('external Native/Survey workspace and fresh shared changes shrink the same ordered pre-COMMIT prefix',()=>{
 const sizing=fixture(),p=sizing.profile;sizing.owner.close();
 const limit=p.ledger_bytes+2*(p.flush_fixed_bytes+p.max_row_flush_bytes)+2*p.max_capture_bytes+100;
 const f=fixture(limit),quotes=[f.quote(),f.quote()],used=f.shared.used();
 assert.equal(f.owner.quotePrefix(quotes).count,2);assert.equal(f.owner.quotePrefix(quotes,2,500).count,1);
 assert.equal(f.shared.used(),used,'planning does not reserve or invent ownership');
 assert.equal(f.shared.tryClaim(500),true);const held=f.owner.reservePrefix(quotes)!;assert.equal(held.leases.length,1);
 assert.equal(f.owner.snapshot().capture_bytes,p.max_capture_bytes);assert.ok(f.owner.snapshot().protected_bytes>0);
 f.owner.releaseUnsent(held.leases[0]!);f.shared.release(500);f.owner.close();assert.equal(f.shared.used(),0);
});

test('opaque primary F aliases remain charged after R reconciliation and cannot falsely close',()=>{
 const f=fixture(),held=f.owner.reservePrefix([f.quote()])!;
 f.owner.transferToRetained(held.leases[0]!,{retained_bytes:1000,raw_wrapper_bytes:100,row_flush_bytes:10000});
 const frame=f.owner.takeFlushPrefix(held.leases)!,before=f.owner.snapshot();
 const rows=f.owner.quarantineFlush(frame.lease,true),quarantined=f.owner.snapshot();
 assert.equal(quarantined.error_retained_bytes,frame.working_bytes);
 assert.equal(quarantined.error_protected_bytes,before.error_protected_bytes);
 assert.equal(quarantined.protected_bytes,before.protected_bytes);
 f.owner.reconcileQuarantined(rows);const egress=f.owner.snapshot();assert.equal(egress.retained_bytes,0);
 assert.ok(egress.error_retained_bytes>0);assert.equal(egress.closed,false);
 assert.throws(()=>f.owner.close(),/owner_busy/);assert.deepEqual(f.owner.snapshot(),egress);
 assert.equal(f.owner.reservePrefix([f.quote()]),null);
});
