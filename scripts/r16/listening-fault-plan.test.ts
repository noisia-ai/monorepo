import assert from 'node:assert/strict';
import test from 'node:test';
import {afterNativeAckLossOnceV1,r16ListeningNativeFaultPlanV1} from './listening-fault-plan';
test('Listening faults bind the exact new configuration/source, retain all ten and cannot claim execution',()=>{
 const plan=r16ListeningNativeFaultPlanV1({source_tree_sha256:'sha256:'+'a'.repeat(64),policy_configuration_digest:'sha256:'+'b'.repeat(64),postgres_system_identifier:'native-pg-id'});
 assert.equal(plan.status,'execution_pending');assert.equal(plan.cases.length,10);assert.equal(new Set(plan.cases.map(c=>c.kind)).size,10);
 assert.ok(plan.cases.every(c=>c.request_version==='listening-jev-v1'&&c.configuration_digest===plan.workload.configuration_digest&&c.root_count===3));
 assert.throws(()=>r16ListeningNativeFaultPlanV1({...plan.source,source_tree_sha256:'legacyMass'}),/source_invalid/);
});
test('ACK-loss injection follows successful native operation; native failure is preserved, restart does not repeat injection',async()=>{
 let commits=0;const wrapped=afterNativeAckLossOnceV1(async(value:string)=>{commits++;return value;},'lost_native_ack');
 await assert.rejects(wrapped('first'),/lost_native_ack/);assert.equal(commits,1);
 assert.equal(await wrapped('recovery'),'recovery');assert.equal(commits,2);
 let succeeds=false;const failing=afterNativeAckLossOnceV1(async()=>{if(!succeeds)throw Error('native_rollback');return 1;},'ack_lost');
 await assert.rejects(failing(),/native_rollback/);succeeds=true;await assert.rejects(failing(),/ack_lost/);assert.equal(await failing(),1);
});
