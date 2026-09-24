import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {guardUpgradeEnvironment,loadUpgradePlan,assertUpgradeSource,applyEmptyUpgrade,commitAndVerifyUpgrade} from './upgrade-0152-0182-plan.mjs';
import {schemaFingerprint} from './database-checks.mjs';

const shipped=JSON.parse(await readFile(new URL('./target-seal.json',import.meta.url),'utf8'));
const seal={...shipped,runner_service_id:'00000000-0000-4000-8000-000000000001',system_identifier:'1234567890123456789',schema_sha256:'a'.repeat(64),table_count:269};
const env={RAILWAY_ENVIRONMENT_ID:seal.environment_id,RAILWAY_ENVIRONMENT_NAME:'dev-test',RAILWAY_SERVICE_ID:seal.runner_service_id,
 NOISIA_DEV_TEST_DATABASE_SERVICE_ID:seal.database_service_id,NOISIA_DEV_TEST_SCHEMA_UPGRADE_APPROVED:'true',
 DATABASE_URL:'postgresql://noisia_dev:synthetic-password@pgvector.railway.internal:5432/noisia_dev_test'};
const flag=['--commit-empty-0152-to-0182'];
const manifest=JSON.parse(await readFile(new URL('./upgrade-0152-0182-manifest.json',import.meta.url),'utf8'));
const plan=await loadUpgradePlan(manifest);

test('upgrade needs explicit command, dedicated approval, exact old count and reviewed identity/SHA',()=>{
 assert.equal(guardUpgradeEnvironment(env,seal,flag).database,'noisia_dev_test');
 for(const args of [[],['--commit'],[...flag,'--force']])assert.throws(()=>guardUpgradeEnvironment(env,seal,args),/upgrade_command_required/u);
 for(const value of [undefined,298,268,'269'])assert.throws(()=>guardUpgradeEnvironment(env,{...seal,table_count:value},flag),/target_unsealed|upgrade_source_invalid/u);
 for(const key of ['system_identifier','schema_sha256'])assert.throws(()=>guardUpgradeEnvironment(env,{...seal,[key]:null},flag),/target_unsealed/u);
 for(const key of ['RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','NOISIA_DEV_TEST_DATABASE_SERVICE_ID','NOISIA_DEV_TEST_SCHEMA_UPGRADE_APPROVED'])
  assert.throws(()=>guardUpgradeEnvironment({...env,[key]:'wrong'},seal,flag),/environment_mismatch/u);
 assert.throws(()=>guardUpgradeEnvironment({...env,NOISIA_DEV_TEST_SCHEMA_UPGRADE_APPROVED:undefined,NOISIA_SIGNAL_IMPORTED_PRIVATE_TEST_APPROVED:'true'},seal,flag),/environment_mismatch/u);
 assert.throws(()=>guardUpgradeEnvironment({...env,DATABASE_URL:env.DATABASE_URL.replace('railway.internal','proxy.rlwy.net')},seal,flag),/target_mismatch/u);
 assert.throws(()=>guardUpgradeEnvironment({...env,ANTHROPIC_API_KEY:'never-print'},seal,flag),/external_credentials_present/u);
});

test('manifest covers exactly 30 unchanged SQL files in order and 30 permanent added tables',async()=>{
 assert.equal(plan.migrations.length,30);assert.equal(plan.added_tables.length,30);
 await assert.rejects(loadUpgradePlan({...manifest,migrations:manifest.migrations.slice(1)}),/manifest_invalid/u);
 await assert.rejects(loadUpgradePlan({...manifest,migrations:manifest.migrations.toReversed()}),/manifest_invalid/u);
 await assert.rejects(loadUpgradePlan({...manifest,after_table_count:300}),/manifest_invalid/u);
 await assert.rejects(loadUpgradePlan(manifest,async()=>Buffer.from('SELECT 1;')),/source_hash_mismatch/u);
 // Reviewed migrations have no top-level transaction boundary. Do not mistake
 // PL/pgSQL BEGIN blocks for physical transaction commands.
 for(const migration of plan.migrations)assert.doesNotMatch(migration.sql,/^(?:BEGIN|COMMIT|ROLLBACK)\s*;/mu);
 const created=plan.migrations.flatMap(row=>[...row.sql.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/gmu)].map(match=>match[1]));
 const dropped=plan.migrations.flatMap(row=>[...row.sql.matchAll(/^DROP TABLE ([a-z_]+)/gmu)].map(match=>match[1]));
 assert.deepEqual(dropped,['signal_mention_text_digest_backfill_state']);
 assert.deepEqual(created.filter(name=>!dropped.includes(name)).sort(),plan.added_tables);
});

test('source gate rejects existing 0153/0182 markers, absent controlled pgcrypto or enabled DDL event triggers',async()=>{
 const valid={absent_0153:true,absent_0182:true,digest_ready:true,no_event_triggers:true};
 await assertUpgradeSource({query:async()=>({rows:[valid]})});
 for(const key of Object.keys(valid))await assert.rejects(assertUpgradeSource({query:async()=>({rows:[{...valid,[key]:false}]})}),/upgrade_source_invalid/u);
});

function fakeDatabase(options={}){
 const statements=[];let applied=0;
 const old=Array.from({length:269},(_,i)=>({name:`old_${i}`}));
 const query=async sql=>{
  statements.push(sql);
  if(sql==='COMMIT'){
   if(options.lostCommitAck)throw Error('synthetic_connection_lost');
   return{rows:[],command:options.commitTag??'COMMIT'};
  }
  const migration=plan.migrations.find(item=>item.sql===sql);
  if(migration){if(options.failAt===applied)throw Error('synthetic_sql_failure');applied++;return{rows:[]};}
  if(sql.includes('pg_try_advisory_xact_lock'))return{rows:[{locked:options.busy!==true}]};
  if(sql.includes('SELECT c.relname name'))return{rows:applied===30?old.concat(plan.added_tables.map(name=>({name}))):old};
  if(sql.includes('nonempty'))return{rows:[{nonempty:options.nonempty===true||(options.postNonempty===true&&applied===30)}]};
  if(sql.includes('absent_0153'))return{rows:[{absent_0153:!options.reapplied,absent_0182:true,digest_ready:true,no_event_triggers:true}]};
  if(sql.includes('public.backfill_signal_mention_text_clean_sha256_v1(1)'))return{rows:[{empty:true,updated:options.backfill??0}]};
  if(sql.includes('digest_validated'))return{rows:[{binding:true,snapshot:true,successor:true,projection:true,digest_validated:true,digest_required:true,digest_maintained:true}]};
  if(sql.includes('column_0182'))return{rows:[{column_0182:true,trigger_0182:true}]};
  if(sql.includes("to_regclass('public.signal_mention_text_digest_backfill_state')"))return{rows:[{absent:true}]};
  if(sql.includes('jsonb_agg'))return{rows:[{schema:applied===30?'new':'old'}]};
  return{rows:[]};
 };
 return {query,statements,get applied(){return applied;}};
}
const oldSha=await schemaFingerprint(fakeDatabase());
const receipt=()=>({mutations_started:false,applied_migrations:[]});
test('all guards precede SQL; valid empty upgrade keeps order, checks backfill, verifies postempty, never commits itself',async()=>{
 const db=fakeDatabase(),report=receipt();await applyEmptyUpgrade(db,{...seal,schema_sha256:oldSha},plan,report);
 assert.equal(db.applied,30);assert.equal(report.before.table_count,269);assert.equal(report.after.table_count,299);
 assert.notEqual(report.before.schema_sha256,report.after.schema_sha256);assert.equal(report.after.empty,true);
 assert.deepEqual(report.applied_migrations,manifest.migrations);
 const position=fragment=>db.statements.findIndex(sql=>sql.includes(fragment));
 assert.ok(position('ACCESS EXCLUSIVE')<position('nonempty'),'lock before empty check');
 assert.ok(position('absent_0153')<db.statements.indexOf(plan.migrations[0].sql),'source gate before SQL');
 assert.ok(position('backfill_signal_mention_text_clean_sha256_v1(1)')>db.statements.indexOf(plan.migrations[14].sql),'backfill after0167');
 assert.ok(position('backfill_signal_mention_text_clean_sha256_v1(1)')<db.statements.indexOf(plan.migrations[15].sql),'backfill before0168');
 assert.equal(db.statements.some(sql=>/^(COMMIT|ROLLBACK|BEGIN)\b/u.test(sql)),false);
});
test('busy lock, populated database, wrong SHA and prior migration all block before first SQL',async()=>{
 for(const options of [{busy:true},{nonempty:true},{reapplied:true},{}]){
  const db=fakeDatabase(options),report=receipt();
  const expected=Object.keys(options).length?oldSha:'b'.repeat(64);
  await assert.rejects(applyEmptyUpgrade(db,{...seal,schema_sha256:expected},plan,report));
  assert.equal(db.applied,0);assert.equal(report.mutations_started,false);
 }
});
test('SQL failure, nonzero backfill and post-upgrade data cannot reach the caller COMMIT',async()=>{
 for(const options of [{failAt:4},{backfill:1},{postNonempty:true}]){
  const db=fakeDatabase(options);let commitReached=false;
  await assert.rejects((async()=>{await applyEmptyUpgrade(db,{...seal,schema_sha256:oldSha},plan,receipt());commitReached=true;})());
  assert.equal(commitReached,false);
 }
});
test('one acknowledged COMMIT is followed by a fresh read-only identity/schema/empty verification',async()=>{
 const db=fakeDatabase(),report=receipt();await applyEmptyUpgrade(db,{...seal,schema_sha256:oldSha},plan,report);
 let identityChecks=0;await commitAndVerifyUpgrade(db,plan,report,async()=>{identityChecks++;});
 assert.equal(db.statements.filter(sql=>sql==='COMMIT').length,1);assert.equal(identityChecks,1);
 assert.equal(report.commit_acknowledged,true);assert.equal(report.post_commit_verified,true);assert.equal(report.status,'committed');
 const commit=db.statements.indexOf('COMMIT');assert.equal(db.statements[commit+1],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(db.statements.at(-1),'ROLLBACK');
});
test('lost or invalid commit acknowledgment never retries or claims rollback/verification',async()=>{
 for(const options of [{lostCommitAck:true},{commitTag:'ROLLBACK'}]){
  const db=fakeDatabase(options),report=receipt();await applyEmptyUpgrade(db,{...seal,schema_sha256:oldSha},plan,report);
  await assert.rejects(commitAndVerifyUpgrade(db,plan,report,async()=>{}));
  assert.equal(report.commit_attempted,true);assert.notEqual(report.commit_acknowledged,true);
  assert.notEqual(report.post_commit_verified,true);assert.equal(db.statements.at(-1),'COMMIT');
  assert.equal(db.statements.filter(sql=>sql==='COMMIT').length,1);
 }
});
test('incomplete upgrade cannot commit, and failed post-commit identity cannot claim complete verification',async()=>{
 const db=fakeDatabase(),report=receipt();await assert.rejects(commitAndVerifyUpgrade(db,plan,report,async()=>{}),/upgrade_incomplete/u);
 assert.equal(db.statements.length,0);
 await applyEmptyUpgrade(db,{...seal,schema_sha256:oldSha},plan,report);
 await assert.rejects(commitAndVerifyUpgrade(db,plan,report,async()=>{throw Error('synthetic_identity_mismatch');}));
 assert.equal(report.commit_acknowledged,true);assert.notEqual(report.post_commit_verified,true);
 assert.equal(db.statements.filter(sql=>sql==='COMMIT').length,1);
});
test('entrypoint requires explicit mode and rejects invented identity without DNS/PG or secret output',()=>{
 for(const args of [[],flag]){
  const result=spawnSync(process.execPath,[new URL('./upgrade-0152-0182.mjs',import.meta.url).pathname,...args],
   {env:{...env,DATABASE_URL:'never-print-upgrade-secret'},encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,/never-print-upgrade-secret|synthetic-password/u);
  const report=JSON.parse(result.stdout);assert.equal(report.remote_connected,false);assert.equal(report.commit_attempted,false);
  assert.equal(report.mutations_started,false);assert.equal(report.post_commit_verified,false);
 }
});
