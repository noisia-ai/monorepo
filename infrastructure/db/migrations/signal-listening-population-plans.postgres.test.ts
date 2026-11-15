import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {r16ListeningWorkloadV1} from '../../../scripts/r16/listening-workload';
const enabled=process.env.NOISIA_R16_LISTENING_POPULATION_PLANS_PG==='true';
async function reference(c:PoolClient){
 const source=await readFile(new URL('./0312_signal_listening_population_batches.sql',import.meta.url),'utf8');
 const query=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION')).replace(
  'CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(',
  'CREATE FUNCTION pg_temp.r16_population_0312(');
 await c.query('CREATE TEMP TABLE r16_population_plan_probe(probe boolean) ON COMMIT DROP');
 await c.query(query);
 // An enclosing generic plan must not force the complete-population branch
 // back to the SQL-language generic plan that this migration replaces.
 await c.query('SET LOCAL plan_cache_mode=force_generic_plan');
}
async function equal(c:PoolClient,scope:unknown[],roots:string[]|null,purpose='client-derived-metrics'){
 const params=[...scope,roots,purpose],read=(name:string)=>c.query(`SELECT * FROM ${name}($1,$2,$3,$4,$5::uuid[],$6) ORDER BY root_id,question_key`,params);
 const old=(await read('pg_temp.r16_population_0312')).rows;
 const current=(await read('signal_listening_population_roots_v1')).rows;
 assert.deepEqual(current,old,'custom full and cached bounded plans retain every native population field');
 return current;
}
test('population planner dispatch preserves null, bounded and denied native populations under a generic caller',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async f=>{
 const cfg=await saveSignalListeningConfigurationV1({database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,
  expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV1('defined_consumer_second_pass').configuration});
 const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
 const c=await f.database.connect();try{await c.query('BEGIN');await reference(c);
  const scope=[f.workspace_id,cfg.id,f.map_id,context],full=await equal(c,scope,null);
  assert.equal(full.length,12);assert.ok(full.some(r=>r.scope_state==='awaiting_base'));
  const roots=[full[0]!.root_id,full[4]!.root_id];
  for(let i=0;i<7;i++)assert.equal((await equal(c,scope,[...roots,roots[0]!])).length,8);
  await equal(c,scope,null,'llm-processing');
  assert.equal((await equal(c,scope,[])).length,0);
  assert.equal((await equal(c,scope,[randomUUID()])).length,0);
  assert.equal((await equal(c,scope,Array(4097).fill(roots[0]))).length,0);
  assert.equal((await equal(c,scope,null,'invalid-purpose')).length,0);
  assert.equal((await equal(c,[randomUUID(),...scope.slice(1)],null)).length,0);
  await c.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);
  assert.equal((await equal(c,scope,null)).length,0);
  assert.equal((await equal(c,scope,roots)).length,0);
 }finally{await c.query('ROLLBACK');c.release();}
}}));
test('population planner dispatch preserves cached answers, call lineage and original frozen serving source',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const c=await f.database.connect();try{await c.query('BEGIN');await reference(c);
  const map=(await c.query('SELECT m.entity_context_digest FROM signal_mass_labeling_maps m WHERE m.id=$1 AND m.workspace_id=$2',[f.map_id,f.workspace_id])).rows[0];
  const scope=[f.workspace_id,f.listening.id,f.map_id,map.entity_context_digest],full=await equal(c,scope,null);
  assert.ok(full.some(r=>r.question_key==='voice'&&r.answer?.choice==='individual'&&r.cache_call_id));
  assert.ok(full.some(r=>r.question_key==='promotion'&&r.answer!==null&&r.cache_call_id));
  await equal(c,scope,[full[0]!.root_id]);await equal(c,scope,null,'llm-processing');
 }finally{await c.query('ROLLBACK');c.release();}
}));
