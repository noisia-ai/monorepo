import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {submitSqlHashV1,SubmitWorkerGateV1,submitBlockingEvidenceV1,submitCounterDeltaV1,runSubmitContentionProfileV1,writeSubmitContentionProfileV1} from './signal-listening-submit-contention-profile.synthetic.fixture';
const native=process.env.NOISIA_R16_SUBMIT_CONTENTION_PG==='true',pure=process.env.NOISIA_R16_SUBMIT_CONTENTION_PURE==='true';assert.ok(!(native&&pure));
test('native Reserve and Mark expose policy contention with transaction-local counters',{skip:!native,timeout:780000},async()=>writeSubmitContentionProfileV1(await runSubmitContentionProfileV1()));
if(pure){
 test('contention templates match the existing profiler whitespace and COMMIT hash',()=>{assert.equal(submitSqlHashV1('  COMMIT\n'),'79663c1d3b43ceaf9ee728e501c64b57ae2e4d6cb36ff5c65eddcda1de27342f');assert.equal(submitSqlHashV1("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||organization_id::text,0))\n FROM signal_workspaces WHERE id=$1"),'734790f8a7aea5164a6f60034ca5cbb053614ae18b1f7b8f23bd6a17265867f6');});
 test('logical writer gate permits exactly two operations and never manufactures another pool',()=>{const gate=new SubmitWorkerGateV1(),a=gate.enter('A'),b=gate.enter('B');assert.throws(()=>gate.enter('C'));assert.throws(()=>gate.enter('A'));a();const c=gate.enter('C');assert.throws(()=>a());b();c();});
 const states=()=>({A:{phase:'dml',seq:5,hash:'reserve'},B:{phase:'policy_lock',seq:2,hash:'policy'}});
 const wait=[{pid:11,state:'active',query_start:'2026-01-01T00:00:00Z',wait_event_type:null,wait_event:null,blockers:[]},{pid:22,state:'active',query_start:'2026-01-01T00:00:01Z',wait_event_type:'Lock',wait_event:'advisory',blockers:[11]}];
 test('only a fresh stable owned B to A advisory edge supports a native phase',()=>{const before=states(),after=states();assert.equal(submitBlockingEvidenceV1(wait,11,22,before,after).supported,true);assert.equal(submitBlockingEvidenceV1([wait[0]!,{...wait[1]!,blockers:[99]}],11,22,before,after).supported,false);assert.equal(submitBlockingEvidenceV1(wait,null,22,before,after).supported,false);assert.equal(submitBlockingEvidenceV1([{...wait[0]!,state:'idle in transaction'},wait[1]!],11,22,before,after).reason,'A_idle_client_or_unknown');assert.equal(submitBlockingEvidenceV1(wait,11,11,before,after).supported,false);});
 test('diagnostic counter hold and boundary crossings cannot be attributed to native INSERT or COMMIT',()=>{const before=states();before.A.phase='diagnostic_stats';assert.equal(submitBlockingEvidenceV1(wait,11,22,before,structuredClone(before)).reason,'blocked_during_diagnostic_stats');const changed=states();changed.A.seq++;assert.equal(submitBlockingEvidenceV1(wait,11,22,states(),changed).reason,'phase_changed_during_sample');});
 test('transaction function counters preserve absent baseline and reject decreasing snapshots',()=>{const row={funcid:'1',schemaname:'public',funcname:'synthetic',calls:'4',total_time:2,self_time:1};assert.equal(submitCounterDeltaV1([],[row])[0]!.delta,null);assert.deepEqual(submitCounterDeltaV1([{...row,calls:'2',total_time:1,self_time:.5}],[row])[0]!.delta,{calls:'2',total_time_ms:1,self_time_ms:.5});assert.throws(()=>submitCounterDeltaV1([row],[{...row,calls:'1'}]));});
 test('optional diagnostic seam reverses byte-exactly to the existing acceptance source',async()=>{
  let source=await readFile(new URL('./signal-listening-flat-prefix.synthetic.fixture.ts',import.meta.url),'utf8');
  source=source.replace(/^export type FlatPrefixReadyFixtureV1=.*\n/mu,'').replace('testCase:FlatPrefixNativeCaseV1|{afterSetup:(f:FlatPrefixReadyFixtureV1)=>Promise<void>}','testCase:FlatPrefixNativeCaseV1').replace(/^    if\('afterSetup'in testCase\).*\n/mu,'').replace('\nexport {setupState as readFlatPrefixSetupStateV1};\n','');
  assert.equal(createHash('sha256').update(source).digest('hex'),'61f497f6d5f65278879e7bdc6d56383e56ad2eb6a9d414529bd95bb50cb57110');
 });
}
