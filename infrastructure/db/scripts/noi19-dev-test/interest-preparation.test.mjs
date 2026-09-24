import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {guardInterestPreparationEnvironment,guardInterestPreparationPositiveMode} from './target-guard.mjs';
import {validateInterestPreparationMigration,assertInterestPreparationBase} from './interest-preparation-plan.mjs';

const base=JSON.parse(await readFile(new URL('./target-seal.json',import.meta.url),'utf8'));
const manifest=JSON.parse(await readFile(new URL('./interest-preparation-manifest.json',import.meta.url),'utf8'));
const migration=await readFile(new URL('../../migrations/0183_signal_topic_interest_review.sql',import.meta.url));
const seal={...base,runner_service_id:'00000000-0000-4000-8000-000000000001',table_count:299,
 system_identifier:'1234567890123456789',schema_sha256:'a'.repeat(64)};
const env={RAILWAY_ENVIRONMENT_ID:seal.environment_id,RAILWAY_ENVIRONMENT_NAME:seal.environment_name,
 RAILWAY_SERVICE_ID:seal.runner_service_id,NOISIA_DEV_TEST_DATABASE_SERVICE_ID:seal.database_service_id,
 NOISIA_INTEREST_PREPARATION_PRIVATE_TEST_APPROVED:'true',
 DATABASE_URL:'postgresql://noisia_dev:synthetic-password@pgvector.railway.internal:5432/noisia_dev_test'};
test('preflight requires its own approval, full seal and exact empty0182 count',()=>{
 assert.equal(guardInterestPreparationEnvironment(env,seal).database,'noisia_dev_test');
 for(const prior of ['NOISIA_NOI19_PRIVATE_TEST_APPROVED','NOISIA_SIGNAL_IMPORTED_PRIVATE_TEST_APPROVED','NOISIA_DEV_TEST_SCHEMA_UPGRADE_APPROVED'])
  assert.throws(()=>guardInterestPreparationEnvironment({...env,NOISIA_INTEREST_PREPARATION_PRIVATE_TEST_APPROVED:undefined,[prior]:'true'},seal),/environment_mismatch/);
 for(const count of [undefined,null,269,298,300,'299'])
  assert.throws(()=>guardInterestPreparationEnvironment(env,{...seal,table_count:count}),/target_unsealed|schema_mismatch/);
 for(const key of ['system_identifier','schema_sha256'])
  assert.throws(()=>guardInterestPreparationEnvironment(env,{...seal,[key]:null}),/target_unsealed/);
});
test('preflight inherits strict private target and credential isolation',()=>{
 for(const changed of [{RAILWAY_ENVIRONMENT_NAME:'production'},{RAILWAY_SERVICE_ID:base.database_service_id},
  {DATABASE_URL:env.DATABASE_URL.replace('railway.internal','proxy.example.test')},{PGHOST:'elsewhere'},
  {ANTHROPIC_API_KEY:'must-not-appear'},{NODE_OPTIONS:'--require ./unsafe.js'}])
  assert.throws(()=>guardInterestPreparationEnvironment({...env,...changed},seal),error=>/^noi19_dev_test_/.test(error.message)&&!error.message.includes('must-not-appear'));
});
test('positive fixture requires explicit mode plus additional approval without inheriting it from preflight',()=>{
 assert.equal(guardInterestPreparationPositiveMode([],env),false);
 assert.throws(()=>guardInterestPreparationPositiveMode(['--positive-preparation'],env),/positive_approval_required/);
 assert.equal(guardInterestPreparationPositiveMode(['--positive-preparation'],{...env,NOISIA_INTEREST_PREPARATION_POSITIVE_APPROVED:'true'}),true);
 for(const argv of [['--positive'],['--positive-preparation','extra']])
  assert.throws(()=>guardInterestPreparationPositiveMode(argv,{...env,NOISIA_INTEREST_PREPARATION_POSITIVE_APPROVED:'true'}),/arguments_invalid/);
});
test('positive entrypoint cannot reach DNS or SQL with an unsealed target and never claims full acceptance',()=>{
 const result=spawnSync(process.execPath,[new URL('./interest-preparation-runner.mjs',import.meta.url).pathname,'--positive-preparation'],
  {env:{...env,NOISIA_INTEREST_PREPARATION_POSITIVE_APPROVED:'true'},encoding:'utf8',timeout:5000});
 assert.equal(result.status,1);const report=JSON.parse(result.stdout);
 assert.equal(report.acceptance_scope,'positive_preparation_with_savepoint_replay_and_physical_rollback');
 assert.equal(report.full_preparation_acceptance,false);assert.equal(report.remote_connected,false);
 assert.equal(report.fixture_mutations_started,false);assert.equal(report.provider_transports,0);
 assert.match(report.error_code,/^noi19_dev_test_(target_unsealed|schema_mismatch|environment_mismatch)$/);
 assert.doesNotMatch(result.stdout+result.stderr,/synthetic-password/);
});
test('migration bytes and manifest cannot silently include an extra or changed migration',()=>{
 validateInterestPreparationMigration(manifest,migration);
 for(const changed of [{migration_file:'0182_signal_topic_editorial_plan_successor.sql'}, {base_table_count:269},
  {installed_table_count:301},{migration_sha256:'b'.repeat(64)}])
  assert.throws(()=>validateInterestPreparationMigration({...manifest,...changed},migration),/migration_mismatch/);
 assert.throws(()=>validateInterestPreparationMigration(manifest,Buffer.concat([migration,Buffer.from('\n-- altered')])),/migration_mismatch/);
});
test('base markers reject previous, partially installed, replayed or event-triggered schemas',async()=>{
 const good={successor:true,plan:true,digest:true,preparation_absent:true,functions_absent:true,no_event_triggers:true};
 const client=value=>({query:async()=>({rows:value===null?[]:[value]})});
 await assertInterestPreparationBase(client(good));
 for(const key of Object.keys(good)) await assert.rejects(assertInterestPreparationBase(client({...good,[key]:false})),/schema_mismatch/);
 await assert.rejects(assertInterestPreparationBase(client(null)),/schema_mismatch/);
});
test('entrypoint cannot connect with the unsealed checked-in target and reports only bounded errors',()=>{
 const result=spawnSync(process.execPath,[new URL('./interest-preparation-runner.mjs',import.meta.url).pathname],
  {env:{...env,DATABASE_URL:'never-print-this-secret'},encoding:'utf8',timeout:5000});
 assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,/never-print-this-secret|synthetic-password/);
 const report=JSON.parse(result.stdout);
 assert.equal(report.acceptance_scope,'ddl_contracts_negative_paths_only');assert.equal(report.full_preparation_acceptance,false);
 assert.equal(report.remote_connected,false);assert.equal(report.remote_executed,false);
 assert.equal(report.migration_installed_in_transaction,false);assert.equal(report.fixture_mutations_started,false);
 assert.equal(report.provider_transports,0);assert.equal(report.physical_rollback,false);
 assert.match(report.error_code,/^noi19_dev_test_(target_unsealed|schema_mismatch|environment_mismatch)$/);
});
test('runner installs only inside guarded rollback transaction and verifies rollback before passing',async()=>{
 const source=await readFile(new URL('./interest-preparation-runner.mjs',import.meta.url),'utf8');
 const order=['guardInterestPreparationEnvironment(process.env,seal)','await lookup(', 'await pool.connect()',
  'guardDatabase(identity,seal',"BEGIN ISOLATION LEVEL READ COMMITTED",'pg_try_advisory_xact_lock',
  'LOCK TABLE','await emptiness()','beforeSchema!==seal.schema_sha256','await assertInterestPreparationBase(client)',
  'cleanup=async()=>','await client.query(migration.toString', 'await assertSignalTopicInterestReviewPreparationV1('];
 let offset=-1;for(const marker of order){const next=source.indexOf(marker,offset+1);assert.ok(next>offset,marker);offset=next;}
 assert.match(source,/ROLLBACK[\s\S]*BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY[\s\S]*await emptiness\(\)[\s\S]*schemaDigest\(\)!==beforeSchema/);
 assert.match(source,/await cleanup\(\);\s+if\(!report.physical_rollback\|\|!report.post_rollback_empty\)/);
 assert.match(source,/globalThis.fetch=denied;http.request=denied/);
 assert.doesNotMatch(source,/query\(['"]COMMIT['"]\)/);
});
