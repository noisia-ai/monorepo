import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {r16ListeningWorkloadV1} from '../../../scripts/r16/listening-workload';
import {installBoundedCustomPlanOracleV1 as references,assertBoundedCustomPlanOracleV1 as equal} from './signal-listening-bounded-custom-plan.oracle';
const enabled=process.env.NOISIA_R16_LISTENING_BOUNDED_CUSTOM_PLAN_PG==='true';

// The fixture enters its owned native lab only when ROOT enables this acceptance
// in CI. No provider transport is used; fixture preparation is synthetic.
test('bounded dispatch survives 32-root warmups, repeated4096 roots and a return to small/full queries',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:4096,execution_cap_micro_usd:1000000,import_batch_size:256,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async f=>{
 const cfg=await saveSignalListeningConfigurationV1({database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,
  expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV1('defined_consumer_second_pass').configuration});
 const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
 const c=await f.database.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='60s'");await references(c);
  const scope=[f.workspace_id,cfg.id,f.map_id,context];
  const roots=(await c.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[f.workspace_id,f.map_id])).rows.map(r=>r.root_id as string);
  assert.equal(roots.length,4096);
  for(let n=0;n<6;n++)assert.equal((await equal(c,scope,roots.slice(0,32))).length,128);
  const observations:Array<{phase:string;roots:number;rows:number;wall_ms:number}>=[];
  for(let n=0;n<4;n++){const started=performance.now(),rows=await equal(c,scope,roots);assert.equal(rows.length,16384);
   observations.push({phase:'old_new_oracle',roots:4096,rows:rows.length,wall_ms:performance.now()-started});}
  const full=await equal(c,scope,null,'llm-processing');assert.equal(full.length,16384);
  assert.deepEqual(await equal(c,scope,roots,'llm-processing'),full,'full and bounded outputs retain all14 fields');
  const small=roots.slice(0,3);assert.deepEqual(await equal(c,scope,small),full.filter(row=>small.includes(row.root_id)));
  assert.equal((await equal(c,scope,[])).length,0);assert.equal((await equal(c,scope,[randomUUID()])).length,0);
  assert.equal((await equal(c,scope,Array(4097).fill(roots[0]))).length,0);
  // Report actual aggregate plans after the same cardinality sequence. Times and
  // buffers are evidence, never a timing or join-shape assertion on noisy CI.
  for(const [version,fn]of [['0317','pg_temp.r16_population_before_0321'],['current','signal_listening_population_roots_v1']]){
   const result=await c.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM ${fn}($1,$2,$3,$4,$5::uuid[],$6)`,[...scope,roots,'llm-processing']);
   const actual=result.rows[0]['QUERY PLAN'][0],plan=actual.Plan;assert.equal(plan['Actual Rows'],16384);
   console.log('# bounded custom plan '+JSON.stringify({version,roots:4096,rows:plan['Actual Rows'],execution_ms:actual['Execution Time'],estimated_rows:plan['Plan Rows'],total_cost:plan['Total Cost'],temp_read_blocks:plan['Temp Read Blocks']??0,temp_written_blocks:plan['Temp Written Blocks']??0}));
  }
  console.log('# bounded custom oracle '+JSON.stringify(observations));
 }finally{await c.query('ROLLBACK');c.release();}
}}}));
