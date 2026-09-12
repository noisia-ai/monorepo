import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import pg from 'pg';
const file=process.env.NOISIA_EDITORIAL_PG_URL_FILE;
const migration=readFileSync(new URL('./migrations/0178_signal_topic_editorial_catalog_contract.sql',import.meta.url),'utf8');
const start=migration.indexOf('CREATE OR REPLACE FUNCTION signal_topic_editorial_owner_guard_v1()');
const end=migration.indexOf('CREATE OR REPLACE FUNCTION signal_topic_editorial_state_guard_v1()',start);
const guard=migration.slice(start,end).replace('CREATE OR REPLACE FUNCTION signal_topic_editorial_owner_guard_v1()','CREATE FUNCTION pg_temp.editorial_owner_guard_fixture()').replace('SET search_path=public,extensions,pg_temp','SET search_path=pg_temp,public,extensions');
test('owner guard compares heavy fields directly and protects future fields, owner, source, cap, plan and terminal state',{skip:!file,timeout:60000},async t=>{
 const pool=new pg.Pool({connectionString:readFileSync(file!,'utf8').trim(),max:1,ssl:process.env.NOISIA_EDITORIAL_PG_TLS==='1'?{rejectUnauthorized:false}:undefined});const c=await pool.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='15s'");
  await c.query(`CREATE TEMP TABLE editorial_owner_fixture(id uuid,plan jsonb,state_body text,state_digest text,status text,owner text,source jsonb,hard_cap bigint,future_column text);
   INSERT INTO editorial_owner_fixture VALUES(gen_random_uuid(),jsonb_build_object('body',repeat('Synthetic long sealed body. ',650000)),NULL,NULL,'running','original','{"version":1}',20000000,'immutable');`);
  await c.query(guard);await c.query('CREATE TRIGGER editorial_owner_guard BEFORE UPDATE OR DELETE ON pg_temp.editorial_owner_fixture FOR EACH ROW EXECUTE FUNCTION pg_temp.editorial_owner_guard_fixture()');
  const reject=async(sql:string,code:RegExp)=>{await c.query('SAVEPOINT reject');try{await assert.rejects(c.query(sql),code);}finally{await c.query('ROLLBACK TO SAVEPOINT reject');}};
  for(const update of ["plan=plan||'{\"tampered\":true}'::jsonb","owner='foreign'","source='{}'::jsonb","hard_cap=30000000","future_column='changed'"])await reject(`UPDATE editorial_owner_fixture SET ${update}`,/owner_immutable/u);
  await reject("UPDATE editorial_owner_fixture SET state_body='{}',state_digest='wrong'",/state_invalid/u);
  const started=performance.now();await c.query(`DO $$BEGIN FOR i IN 1..44 LOOP UPDATE pg_temp.editorial_owner_fixture SET state_body=jsonb_build_object('phase','screening','index',i)::text,state_digest=signal_semantic_context_digest_v1(jsonb_build_object('phase','screening','index',i)::text);END LOOP;END$$`);
  const ms=Math.round(performance.now()-started);t.diagnostic(`44 owner saves with 17 MB plan: ${ms} ms`);assert.ok(ms<15000);
  await c.query(`UPDATE editorial_owner_fixture SET state_body='{"phase":"completed"}',state_digest=signal_semantic_context_digest_v1('{"phase":"completed"}'),status='review_ready'`);
  await reject(`UPDATE editorial_owner_fixture SET state_body='{"phase":"completed","extra":1}',state_digest=signal_semantic_context_digest_v1('{"phase":"completed","extra":1}')`,/owner_immutable/u);
  await reject("UPDATE editorial_owner_fixture SET status='running'",/owner_immutable/u);
  await reject('DELETE FROM editorial_owner_fixture',/history_retained/u);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
