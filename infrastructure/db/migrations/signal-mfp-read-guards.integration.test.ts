import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {readFile} from 'node:fs/promises';

// Acceptance first: old and factored reads must agree, including live revocation.
// The runner supplies an existing, sealed plan; every mutation rolls back.
test('MFP factored read guards preserve plan, unit, root and live authority semantics', {
  skip:process.env.NOISIA_MFP_READ_GUARDS_PLAN_ID===undefined&&process.env.NOISIA_MFP_PG_CI!=='true',timeout:300_000,
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const plan=process.env.NOISIA_MFP_READ_GUARDS_PLAN_ID;
  if(!plan){
   const r=(await c.query('SELECT workspace_incremental_editorial_plan_valid_v1(gen_random_uuid()) valid')).rows[0];
   assert.equal(r.valid,false);
   const grants=(await c.query(`SELECT proname,has_function_privilege('anon',oid,'EXECUTE') anon,
     has_function_privilege('authenticated',oid,'EXECUTE') authenticated FROM pg_proc
     WHERE proname IN('signal_workspace_projection_assignments_current_v1','signal_workspace_classification_assignment_row_current_v1',
     'signal_workspace_fit_membership_row_current_v1','signal_workspace_incremental_membership_row_current_v1')`)).rows;
   assert.equal(grants.length,4);for(const grant of grants){assert.equal(grant.anon,false);assert.equal(grant.authenticated,false);}
   return;
  }
  const historical=await readFile(new URL('./0242_signal_workspace_incremental_empty_component.sql',import.meta.url),'utf8');
  const original=historical.match(/CREATE OR REPLACE FUNCTION workspace_incremental_editorial_plan_valid_v1[\s\S]*?\$\$;/)![0];
  await c.query(original.replace('workspace_incremental_editorial_plan_valid_v1(target uuid)','mfp_read_guard_baseline_plan_v1(target uuid)'));
  const before=(await c.query('SELECT workspace_incremental_editorial_plan_valid_v1($1) valid',[plan])).rows[0].valid;
  assert.equal(before,true,'acceptance requires a valid sealed plan');
  if(!(await c.query("SELECT to_regprocedure('signal_workspace_projection_assignments_current_v1(signal_classification_generations)') present")).rows[0].present)
   await c.query(await readFile(new URL('./0264_mfp_factored_read_guards.sql',import.meta.url),'utf8'));
  const compare=async()=>{
   const r=(await c.query('SELECT mfp_read_guard_baseline_plan_v1($1) old,workspace_incremental_editorial_plan_valid_v1($1) current',[plan])).rows[0];
   assert.equal(r.current,r.old);return r.current;
  };
  assert.equal(await compare(),true);
  const source=(await c.query("SELECT e.* FROM analysis_artifacts p JOIN signal_topic_catalog_executions e ON e.id=(p.metadata->>'numeric_execution_id')::uuid WHERE p.id=$1",[plan])).rows[0];
  for(const sql of ["UPDATE users SET status='inactive' WHERE id=$1","UPDATE data_sources SET status='archived' WHERE workspace_id=$1"]){
   await c.query('SAVEPOINT stale');
   await c.query(sql,[sql.includes('users')?source.actor_user_id:source.workspace_id]);
   assert.equal(await compare(),false);
   await c.query('ROLLBACK TO SAVEPOINT stale');
  }
  for(const [name,signature] of [['old','mfp_read_guard_baseline_plan_v1(uuid)'],['current','workspace_incremental_editorial_plan_valid_v1(uuid)']] as const){
   const body=(await c.query('SELECT pg_get_functiondef($1::regprocedure) body',[signature])).rows[0].body as string;
   const shadow=body.replace(/(?:public\.)?(?:mfp_read_guard_baseline_plan_v1|workspace_incremental_editorial_plan_valid_v1)\(target uuid\)/,
    `mfp_read_guard_shadow_${name}(target uuid, override_artifact uuid, override_body jsonb)`)
    .replaceAll('FROM analysis_artifacts unit WHERE',`FROM (SELECT (jsonb_populate_record(NULL::analysis_artifacts,
     to_jsonb(original)||CASE WHEN original.id=override_artifact THEN override_body ELSE '{}'::jsonb END)).*
     FROM analysis_artifacts original) unit WHERE`);
   await c.query(shadow);
  }
  const unit=(await c.query(`SELECT id,metadata FROM analysis_artifacts WHERE metadata->>'plan_artifact_id'=$1
   AND metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' ORDER BY id LIMIT 1`,[plan])).rows[0];
  assert.ok(unit);
  for(const [key,value] of [['birth_membership_digest',`sha256:${'0'.repeat(64)}`],['status','unknown'],['root_count',9007199254740991]]){
   const patch={metadata:{...unit.metadata,unit:{...unit.metadata.unit,[key as string]:value}}};
   const r:{old:boolean;current:boolean}=(await c.query('SELECT mfp_read_guard_shadow_old($1,$2,$3) old,mfp_read_guard_shadow_current($1,$2,$3) current',
    [plan,unit.id,JSON.stringify(patch)])).rows[0];
   assert.deepEqual(r,{old:false,current:false},`corrupt unit ${key} never passes either complete-plan predicate`);
  }
  const generations=(await c.query('SELECT g.* FROM signal_classification_generations g WHERE workspace_id=$1 AND input_snapshot ? \'source_projection\'',[source.workspace_id])).rows;
  assert.ok(generations.length);
  for(const g of generations){
   const r=(await c.query(`SELECT signal_workspace_projection_source_current_v1(g) AND NOT EXISTS(
     SELECT 1 FROM signal_classification_assignments a WHERE a.generation_id=g.id
     AND NOT signal_workspace_classification_assignment_current_v1(a,g)) old,
     signal_workspace_projection_assignments_current_v1(g) current
     FROM signal_classification_generations g WHERE g.id=$1`,[g.id])).rows[0];
   assert.equal(r.current,r.old);
  }
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
