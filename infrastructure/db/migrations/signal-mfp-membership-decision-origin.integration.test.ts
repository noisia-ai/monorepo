import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
// An isolated transactional schema only. No product rows, providers or shared migrations.
test('0260: human evaluation excludes assisted, unknown, superseded and stale decisions',
 {skip:process.env.NOISIA_MEMBERSHIP_ORIGIN_PG_APPROVED!=='true'&&process.env.NOISIA_MFP_PG_CI!=='true',timeout:30_000},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
 const c=await pool.connect(),schema=`origin_test_${randomUUID().replaceAll('-','')}`;
 try{await c.query('BEGIN');await c.query(`CREATE SCHEMA ${schema}`);await c.query(`SET LOCAL search_path TO ${schema},pg_catalog`);
  await c.query(`CREATE TABLE signal_concept_membership_overrides(id int PRIMARY KEY,workspace_id text,root_id text,concept_key text,verdict text,
   actor_user_id text,definition_digest text,root_fingerprint text,created_at timestamptz DEFAULT now(),superseded_at timestamptz);
   CREATE TABLE signal_concept_memberships_current_v1(workspace_id text,root_id text,concept_key text,definition_digest text,root_fingerprint text,source text,verdict text,requires_override_review boolean)`);
  await c.query(await readFile(new URL('./0260_signal_membership_decision_origin.sql',import.meta.url),'utf8'));
  for(const [id,origin] of [[1,'human_ui'],[2,'agent_assisted'],[3,null],[4,'human_ui'],[5,'human_ui']] as const){
   await c.query(`INSERT INTO signal_concept_membership_overrides(id,workspace_id,root_id,concept_key,verdict,actor_user_id,definition_digest,root_fingerprint,decided_via,superseded_at)
    VALUES($1::int,'w',($1::int)::text,'c','belongs','a','d','f',$2,CASE WHEN $1::int=4 THEN now() END)`,[id,origin]);
   await c.query(`INSERT INTO signal_concept_memberships_current_v1 VALUES('w',$1,'c',CASE WHEN $1='5' THEN 'new' ELSE 'd' END,'f','human','belongs',false)`,[String(id)]);
  }
  assert.deepEqual((await c.query('SELECT id FROM signal_concept_membership_human_evaluation_v1')).rows,[{id:1}]);
  await c.query('SAVEPOINT invalid');await assert.rejects(c.query("UPDATE signal_concept_membership_overrides SET decided_via='inferred' WHERE id=3"),/signal_membership_decision_origin_valid/);
  await c.query('ROLLBACK TO SAVEPOINT invalid');
  assert.equal((await c.query('SELECT count(*)::int count FROM signal_concept_membership_overrides')).rows[0].count,5);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
