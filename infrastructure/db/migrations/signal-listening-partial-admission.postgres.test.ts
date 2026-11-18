import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {partialAdmissionAmountV1,partialAdmissionBudgetWitnessV1,partialAdmissionErrorKindV1,runListeningPartialAdmissionV1} from './signal-listening-partial-admission.synthetic.fixture';

const native=process.env.NOISIA_R16_LISTENING_PARTIAL_ADMISSION_PG==='true';
const pure=process.env.NOISIA_R16_LISTENING_PARTIAL_ADMISSION_PURE==='true';
assert.ok(!(native&&pure),'partial admission native and pure modes must be separate');

test('native Listening partial admission preserves committed money and terminal idempotency',{skip:!native},async()=>{
 const directory=process.env.R16_LISTENING_PARTIAL_ADMISSION_EVIDENCE_DIR;assert.ok(directory,'private evidence directory required');
 const report=await runListeningPartialAdmissionV1(directory);
 // A fixed cap with no demonstrated interval is diagnostic INCONCLUSIVE, never
 // a successful financial acceptance or a reason to change its ledger/cap.
 assert.equal(report.status,'observed','fixed native cap interval and all financial/closure witnesses must actually be observed');
 assert.equal(report.contract,'r16-listening-partial-admission-v1');assert.equal(report.h1_accepted,false);
 assert.equal(report.scope,'functional240_not_H1_or_scale1024_4096');assert.equal(report.native_population_roots,240);
 const gates=report.gates as Record<string,boolean>;
 assert.deepEqual(Object.keys(gates).sort(),['source_binding','native_cap_interval','committed_before_fetch','delivered_drain','terminal_idempotency','closure_confirmed'].sort());
 assert.ok(Object.values(gates).every(v=>v===true));assert.equal(report.recovery_execution_claimed,false);
 const terminal=report.terminal_restart as {claim_attempted:boolean;claimed:boolean;status:string;new_physical_fetches:number;recovery_execution_claimed:boolean};
 assert.deepEqual(terminal,{claim_attempted:true,claimed:false,status:'not_claimed',new_physical_fetches:0,recovery_execution_claimed:false});
 const persisted=JSON.parse(await readFile(join(directory,'listening-partial-admission.json'),'utf8'));
 assert.deepEqual(persisted,JSON.parse(JSON.stringify(report)));
});

if(pure){
 test('partial admission keeps microUSD arithmetic exact beyond Number safe integers',()=>{
  assert.equal(partialAdmissionAmountV1('9007199254740993'),9007199254740993n);
  const result=partialAdmissionBudgetWitnessV1({cap:'9007199254740993',settled:'9007199254740992',first:'1',denied_exposure:'9007199254740993',denied_exposure_before:'9007199254740993',denied:'1',action_cap:null,daily:'0',daily_cap:null});
  assert.equal(result.first_fits,true);assert.equal(result.denied_exceeds,true);
 });
 test('partial admission needs both a fitting prefix and a strict real run-cap denial',()=>{
  const data={cap:'50000',settled:'1000',first:'4000',denied_exposure:'5000',denied_exposure_before:'6000',denied:'50000',action_cap:'1000000',daily:'6000',daily_cap:'1000000'};
  assert.ok(Object.values(partialAdmissionBudgetWitnessV1(data)).every(v=>v));
  assert.equal(partialAdmissionBudgetWitnessV1({...data,first:'49001'}).first_fits,false);
  assert.equal(partialAdmissionBudgetWitnessV1({...data,denied:'45000'}).denied_exceeds,false,'equal-to-cap is not a denial witness');
 });
 test('action, daily and nonmonotone exposure cannot be disguised as the run-cap interval',()=>{
  const data={cap:'50000',settled:'1000',first:'4000',denied_exposure:'5000',denied_exposure_before:'6000',denied:'50000',action_cap:'1000000',daily:'6000',daily_cap:'1000000'};
  assert.equal(partialAdmissionBudgetWitnessV1({...data,action_cap:'55000'}).action_not_blocking,false,'use pre-denial upper exposure, not its smaller after value');
  assert.equal(partialAdmissionBudgetWitnessV1({...data,daily_cap:'55000'}).daily_not_blocking,false);
  assert.equal(partialAdmissionBudgetWitnessV1({...data,denied_exposure:'6001'}).exposure_nonincreasing,false);
 });
 test('money rejects coercions and cap classification never invokes hostile accessors',()=>{
  for(const value of [1,-1,'-1','01','1.1','NaN','1'.repeat(33),{},null])assert.throws(()=>partialAdmissionAmountV1(value),/partial_admission_amount_invalid/);
  let reads=0;const poisoned=Object.defineProperty({},'code',{get(){reads++;throw new Error('not permitted to escape');}});
  assert.equal(partialAdmissionErrorKindV1(poisoned),'other');assert.equal(reads,0);
  assert.equal(partialAdmissionErrorKindV1({code:'labeling_daily_cap_exhausted'}),'other');
  assert.equal(partialAdmissionErrorKindV1(new Error('labeling_cap_exhausted')),'labeling_cap_exhausted');
 });
}
