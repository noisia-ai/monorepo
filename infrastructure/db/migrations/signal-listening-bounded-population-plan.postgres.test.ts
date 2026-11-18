import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {
  boundedPopulationCounterDeltaV1,
  boundedPopulationRootSetHashV1,
  extractCurrentBoundedPopulationV1,
  runBoundedPopulation32kPlanV1,
  sanitizeBoundedPopulationPlanV1,
} from './signal-listening-bounded-population-plan.synthetic.fixture';

const native=process.env.NOISIA_R16_BOUNDED_POPULATION_PLAN_PG==='true';
const pure=process.env.NOISIA_R16_BOUNDED_POPULATION_PLAN_PURE==='true';
assert.ok(!(native&&pure),'native and pure bounded population modes must stay separate');

test('native bounded population exposes provenance work for 1000 consumer roots in a 32768-root corpus',{
  skip:!native,
},async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','native bounded population is authorized only in CI');
  assert.notEqual(process.env.NOISIA_R16_BOUNDED_POPULATION_PLAN_PURE,'true');
  const directory=process.env.R16_BOUNDED_POPULATION_PLAN_EVIDENCE_DIR;
  assert.ok(directory,'native evidence directory is required');
  const receipt=await runBoundedPopulation32kPlanV1(directory);
  assert.equal(receipt.contract,'r16-bounded-population-plan-v1');
  assert.equal(receipt.status,'observed');
  assert.equal(receipt.diagnostic_only,true);
  assert.equal(receipt.h1_accepted,false);
  assert.equal(receipt.cpu,'UNKNOWN');
  assert.equal(receipt.speedup_claim,false);
  assert.ok(!Object.hasOwn(receipt,'candidate_accepted'));
  const expectedGates=['closure_confirmed','native_state','plan_complete','projection_parity','snapshot_binding','source_binding'];
  assert.deepEqual(Object.keys(receipt.gates).sort(),expectedGates);
  for(const key of expectedGates)assert.equal(receipt.gates[key],true,key+' must be explicitly observed');
  const persisted=JSON.parse(await readFile(join(directory,'bounded-population-plan.json'),'utf8'));
  assert.deepEqual(persisted,receipt,'persisted evidence must match the returned native receipt');
});

if(pure){
  test('0332 extractor binds the exact current bounded population source',async()=>{
    const source=await readFile(new URL('./0332_signal_listening_flat_prefix_preimages.sql',import.meta.url),'utf8');
    const extracted=extractCurrentBoundedPopulationV1(source);
    assert.match(extracted.sql,/^\nWITH eligible_batches AS MATERIALIZED/u);
    assert.match(extracted.body,/base_answer_slice AS MATERIALIZED/u);
    assert.match(extracted.source_sha256,/^[a-f0-9]{64}$/u);
    assert.match(extracted.sql_sha256,/^[a-f0-9]{64}$/u);
    assert.throws(()=>extractCurrentBoundedPopulationV1(source.replace('SELECT DISTINCT root FROM unnest($5)','SELECT root FROM unnest($5)')));
  });

  test('EXPLAIN sanitizer keeps bounded structure and removes SQL-like leaves',()=>{
    const source=[{Plan:{'Node Type':'Nested Loop','Actual Rows':4000,'Actual Loops':1,'Shared Hit Blocks':3,
      Plans:[{'Node Type':'Seq Scan','Relation Name':'mentions',Filter:'PRIVATE_UUID_SQL','Actual Rows':32768,'Actual Loops':1,Output:['PRIVATE TEXT']}]},
      'Planning Time':1,'Execution Time':2,JIT:{Functions:3,Options:{Inlining:false,Optimization:true,Expressions:true,Deforming:true},
        Timing:{Generation:0.1,Inlining:0,Optimization:0.2,Emission:0.3,Total:0.6}}}];
    const sanitized=sanitizeBoundedPopulationPlanV1(source);
    const encoded=JSON.stringify(sanitized.plan);
    assert.equal(sanitized.nodes,2);
    assert.equal(sanitized.jit,'observed');
    assert.ok(!encoded.includes('PRIVATE_UUID_SQL'));
    assert.ok(!encoded.includes('PRIVATE TEXT'));
    assert.ok(!encoded.includes('Filter'));
    assert.ok(!encoded.includes('Output'));
    assert.equal(sanitized.bytes,Buffer.byteLength(encoded));
    assert.match(sanitized.plan_sha256,/^[a-f0-9]{64}$/u);
    assert.match(sanitized.sanitized_sha256,/^[a-f0-9]{64}$/u);
  });

  test('EXPLAIN sanitizer enforces node, depth, and unknown-node bounds',()=>{
    const node=(type='Seq Scan'):Record<string,unknown>=>({'Node Type':type,'Actual Rows':1,'Actual Loops':1});
    const tooMany=Array.from({length:513},()=>node());
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{'Node Type':'Append',Plans:tooMany}}]));
    let deep=node();
    for(let i=0;i<33;i++)deep={...node('Nested Loop'),Plans:[deep]};
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:deep}]));
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:node('Private Executor')}]));
  });

  test('function counter deltas keep absent baselines UNKNOWN and require monotonic values',()=>{
    const after=[{funcid:'24680',schemaname:'public',funcname:'signal_listening_population_roots_v1',calls:'4',total_time:8,self_time:3}];
    const absent=boundedPopulationCounterDeltaV1([],after,'24680');
    assert.equal(absent[0]?.status,'entry_created_baseline_absent');
    assert.equal(absent[0]?.delta,null);
    const before=[{...after[0]!,calls:'2',total_time:3,self_time:1}];
    const observed=boundedPopulationCounterDeltaV1(before,after,'24680');
    assert.equal(observed[0]?.status,'observed_delta');
    assert.deepEqual(observed[0]?.delta,{calls:'2',total_time_ms:5,self_time_ms:2});
    assert.throws(()=>boundedPopulationCounterDeltaV1(after,before,'24680'));
  });

  test('consumer root set hash is order independent and rejects duplicates',()=>{
    const roots=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
    assert.equal(boundedPopulationRootSetHashV1(roots),boundedPopulationRootSetHashV1([...roots].reverse()));
    assert.throws(()=>boundedPopulationRootSetHashV1([roots[0]!,roots[0]!]));
    assert.throws(()=>boundedPopulationRootSetHashV1(['not-a-uuid']));
  });

  test('counter and plan sanitizers reject poisoned numeric or cyclic values',()=>{
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{'Node Type':'Seq Scan','Actual Rows':Number.NaN,'Actual Loops':1}}]));
    const cyclic:Record<string,unknown>={'Node Type':'Nested Loop'};
    cyclic.Plans=[cyclic];
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:cyclic}]));
    const bad=[{funcid:'24680',schemaname:'public',funcname:'signal_listening_population_roots_v1',calls:'NaN',total_time:1,self_time:1}];
    assert.throws(()=>boundedPopulationCounterDeltaV1(bad,bad,'24680'));
  });
}
