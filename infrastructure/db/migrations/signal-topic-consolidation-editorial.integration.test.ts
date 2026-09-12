import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
const enabled=process.env.NOISIA_TOPIC_EDITORIAL_PG_APPROVED==='true';
const migration=readFileSync(new URL('./0176_signal_topic_consolidation_editorial.sql',import.meta.url),'utf8');
test('0176 PostgreSQL install, exact config, disabled reserve/send, RLS/ACL and DDL rollback',{skip:!enabled,timeout:30000},async()=>{
 const url=new URL(process.env.DATABASE_URL??'');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');
 assert.match(url.pathname,/^\/noisia_topic_consolidation_(?:smoke|test)_[a-z0-9_]+$/u);
 const client=new pg.Client({connectionString:url.href,ssl:false});await client.connect();
 let transaction=false;
 try {
  assert.equal((await client.query('SELECT count(*)::int n FROM organizations')).rows[0].n,0,'dedicated empty synthetic schema only');
  assert.equal((await client.query("SELECT to_regclass('public.signal_topic_editorial_executions') value")).rows[0].value,null,'refuse repeat application');
  const exposureBefore=(await client.query("SELECT pg_get_functiondef('signal_processing_org_exposure_v1(uuid,date,text,text,uuid)'::regprocedure) body")).rows[0].body;
  await client.query('BEGIN');transaction=true;
  await client.query("SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='2s'");await client.query(migration);
  const configuration=(await client.query('SELECT signal_topic_editorial_configuration_v1() body')).rows[0].body;
  assert.equal(configuration.screening.model,'claude-sonnet-4-6');assert.equal(configuration.screening_batch_size,40);
  const source=(await client.query("SELECT signal_topic_editorial_source_v1('00000000-0000-4000-8000-000000000001') body")).rows[0].body;
  assert.equal(source,null);
  for(const statement of ["SELECT reserve_signal_topic_editorial_call_v1(NULL,NULL,NULL,false)","SELECT mark_sent_signal_topic_editorial_call_v1(NULL,NULL,NULL,false)",
   "SELECT assert_signal_topic_consolidation_worker_lease_v1(NULL,NULL,NULL,NULL)"]){
   await client.query('SAVEPOINT denied');await assert.rejects(client.query(statement),/topic_editorial_provider_disabled|topic_consolidation_lease_conflict/u);
   await client.query('ROLLBACK TO SAVEPOINT denied');await client.query('RELEASE SAVEPOINT denied');
  }
  const tables=(await client.query("SELECT relname,relrowsecurity,relacl FROM pg_class WHERE relname IN('signal_topic_editorial_executions','signal_topic_editorial_requests','signal_topic_editorial_calls','signal_topic_editorial_outbox','signal_topic_editorial_request_keys')")).rows;
  assert.equal(tables.length,5);assert.ok(tables.every(row=>row.relrowsecurity));
  const grants=(await client.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
   LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public'
   AND(p.proname LIKE '%topic_editorial%v1' OR p.proname='assert_signal_topic_consolidation_worker_lease_v1') AND a.grantee=0`)).rows;
  assert.equal(grants.length,0,'no PUBLIC function grant');
  for(const table of tables)assert.equal((await client.query(`SELECT count(*)::int n FROM ${table.relname}`)).rows[0].n,0);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('ROLLBACK');transaction=false;
  assert.equal((await client.query("SELECT to_regclass('public.signal_topic_editorial_executions') value")).rows[0].value,null);
  assert.equal((await client.query("SELECT pg_get_functiondef('signal_processing_org_exposure_v1(uuid,date,text,text,uuid)'::regprocedure) body")).rows[0].body,exposureBefore);
  assert.equal((await client.query('SELECT count(*)::int n FROM organizations')).rows[0].n,0);
 }finally{if(transaction)await client.query('ROLLBACK');await client.end();}
});
test('0176 paid ledger + complete numeric source -> 42 screenings/global requires composed source fixture',
 {skip:'Source fixture/paid response matrix is the next review; this installation gate does not certify provider activation or materialization.'},()=>{});
