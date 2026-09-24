import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {guardEnvironment,guardBootstrapEnvironment,guardDns,guardDatabase,guardEmptyTables} from './target-guard.mjs';
const shipped=JSON.parse(await readFile(new URL('./target-seal.json',import.meta.url),'utf8'));
// Invented IDs/fingerprint only for pure guard tests, never connection arguments.
const seal={...shipped,runner_service_id:'00000000-0000-4000-8000-000000000001',system_identifier:'1234567890123456789',schema_sha256:'a'.repeat(64)};
const env={RAILWAY_ENVIRONMENT_ID:seal.environment_id,RAILWAY_ENVIRONMENT_NAME:'dev-test',RAILWAY_SERVICE_ID:seal.runner_service_id,
 NOISIA_DEV_TEST_DATABASE_SERVICE_ID:seal.database_service_id,NOISIA_NOI19_PRIVATE_TEST_APPROVED:'true',
 DATABASE_URL:'postgresql://noisia_dev:synthetic-password@pgvector.railway.internal:5432/noisia_dev_test'};
const row={database:'noisia_dev_test',user:'noisia_dev',address:'fd12:3456::1',port:5432,version:'170005',system_identifier:seal.system_identifier};
test('the mutating runner refuses an unsealed database even when environment/host match',()=>{
 assert.throws(()=>guardEnvironment(env,{...seal,system_identifier:null}),/target_unsealed/u);
 assert.throws(()=>guardEnvironment(env,{...seal,schema_sha256:null}),/target_unsealed/u);
 assert.throws(()=>guardBootstrapEnvironment(env,{...seal,runner_service_id:null}),/target_unsealed/u);
 assert.equal(guardBootstrapEnvironment(env,{...seal,system_identifier:null,schema_sha256:null}).host,seal.host);
});
test('private environment, runner, database service, URL database and role must all match',()=>{
 assert.equal(guardEnvironment(env,seal).database,'noisia_dev_test');
 assert.equal(guardEnvironment(env,seal).user,'noisia_dev');
 assert.throws(()=>guardEnvironment(env,{...seal,database:'railway'}),/seal_invalid/u);
 assert.throws(()=>guardEnvironment(env,{...seal,user:'postgres'}),/seal_invalid/u);
 for(const key of ['RAILWAY_ENVIRONMENT_ID','RAILWAY_ENVIRONMENT_NAME','RAILWAY_SERVICE_ID','NOISIA_DEV_TEST_DATABASE_SERVICE_ID','NOISIA_NOI19_PRIVATE_TEST_APPROVED'])
  assert.throws(()=>guardEnvironment({...env,[key]:'wrong'},seal),/environment_mismatch/u);
 for(const url of [env.DATABASE_URL.replace('railway.internal','proxy.rlwy.net'),env.DATABASE_URL+'?host=evil.example.test',env.DATABASE_URL+'#secret',
  env.DATABASE_URL.replace('/noisia_dev_test','/production'),env.DATABASE_URL.replace('noisia_dev:','wrong:'),env.DATABASE_URL.replace(':5432',':6543'),
  env.DATABASE_URL.replace('postgresql:','https:'),'not-a-url'])
  assert.throws(()=>guardEnvironment({...env,DATABASE_URL:url},seal),/noi19_dev_test_/u);
});
test('ambient PG, Node loader and external credentials cannot alter target or enable a provider',()=>{
 for(const key of ['PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGOPTIONS','PGSERVICE','PGSERVICEFILE','PGPASSFILE','NODE_OPTIONS','NODE_PATH','DATABASE_PUBLIC_URL',
  'ANTHROPIC_API_KEY','VOYAGE_API_KEY','OPENAI_API_KEY','REDIS_URL','UPSTASH_REDIS_REST_TOKEN','SUPABASE_SERVICE_ROLE_KEY','AWS_SECRET_ACCESS_KEY'])
  assert.throws(()=>guardEnvironment({...env,[key]:'forbidden-sensitive-value'},seal),error=>!error.message.includes('sensitive-value'));
});
test('all DNS answers must be private; connected server must match pinned DNS and sealed identity',()=>{
 guardDns([{address:row.address}]);guardDatabase(row,seal,[row.address]);
 for(const address of ['127.0.0.1','::1','8.8.8.8','2606:4700::1111','pgvector.railway.internal'])
  assert.throws(()=>guardDns([{address:row.address},{address}]),/dns_not_private/u);
 assert.throws(()=>guardDns([]),/dns_not_private/u);
 for(const [key,value] of Object.entries({database:'other',user:'other',address:'fd12:3456::2',port:6543,version:'160000',system_identifier:'9999999999999999999'}))
  assert.throws(()=>guardDatabase({...row,[key]:value},seal,[row.address]),/database_identity_mismatch/u);
});
test('an empty population is required for every public table, never just an empty chosen workspace',()=>{
 const rows=Array.from({length:269},(_,index)=>({name:`synthetic_${index}`,nonempty:false}));guardEmptyTables(rows);
 assert.throws(()=>guardEmptyTables(rows.slice(1)),/database_not_empty/u);
 assert.throws(()=>guardEmptyTables(rows.map((row,index)=>index===268?{...row,nonempty:true}:row)),/database_not_empty/u);
 assert.throws(()=>guardEmptyTables(rows.map((row,index)=>index===0?{...row,nonempty:null}:row)),/database_not_empty/u);
});
test('checked-in entrypoints reject invented runtime identity before DNS/PG; stdout is secret-free',()=>{
 assert.notEqual(env.RAILWAY_SERVICE_ID,shipped.runner_service_id);assert.match(shipped.runner_service_id,/^[0-9a-f-]{36}$/u);
 for(const name of ['runner.mjs','bootstrap-readonly.mjs']){
  const result=spawnSync(process.execPath,[new URL(name,import.meta.url).pathname],{env:{...env,DATABASE_URL:'never-print-this-secret'},encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,/never-print-this-secret|synthetic-password/u);
  if(name==='runner.mjs'){const receipt=JSON.parse(result.stdout);assert.equal(receipt.remote_executed,false);assert.match(receipt.error_code,/^noi19_dev_test_(target_unsealed|environment_mismatch)$/u);}
 }
});

test('new imported gate requires its own approval and an explicit reviewed count; old count defaults to 269',async()=>{
 const {sealedTableCount,guardSignalImportedEnvironment}=await import('./target-guard.mjs');
 assert.equal(sealedTableCount(seal),269);
 assert.equal(sealedTableCount({...seal,table_count:300}),300);
 for(const count of [undefined,null,0,-1,1.5,'300',Number.MAX_SAFE_INTEGER+1])
  assert.throws(()=>guardSignalImportedEnvironment({...env,NOISIA_SIGNAL_IMPORTED_PRIVATE_TEST_APPROVED:'true'},{...seal,table_count:count}),/target_unsealed/u);
 assert.throws(()=>guardSignalImportedEnvironment(env,{...seal,table_count:300}),/environment_mismatch/u);
 assert.equal(guardSignalImportedEnvironment({...env,NOISIA_NOI19_PRIVATE_TEST_APPROVED:undefined,
  NOISIA_SIGNAL_IMPORTED_PRIVATE_TEST_APPROVED:'true'},{...seal,table_count:300}).database,'noisia_dev_test');
 assert.throws(()=>guardSignalImportedEnvironment({...env,NOISIA_SIGNAL_IMPORTED_PRIVATE_TEST_APPROVED:'true'},
  {...seal,table_count:300,schema_sha256:null}),/target_unsealed/u);
});

test('read-only table inventory accepts newer schemas but mutation uses the exact sealed count',async()=>{
 const {publicTables,tableEmptiness,verifyEmpty}=await import('./database-checks.mjs');
 let nonempty=false;
 const client={query:async(sql)=>({rows:sql.includes('pg_class')
  ?Array.from({length:300},(_,i)=>({name:`synthetic_${i}`})):[{nonempty}]})};
 const inventory=await publicTables(client,null);assert.equal(inventory.length,300);
 await assert.rejects(publicTables(client),/schema_mismatch/u);
 await assert.rejects(publicTables(client,299),/schema_mismatch/u);
 const tables=await publicTables(client,300);await verifyEmpty(client,tables,300);
 await assert.rejects(verifyEmpty(client,tables),/database_not_empty/u);
 nonempty=true;
 assert.equal((await tableEmptiness(client,tables)).every(row=>row.nonempty),true);
 await assert.rejects(verifyEmpty(client,tables,300),/database_not_empty/u);
});

test('imported entrypoint rejects unsealed target before DNS and prints no input secrets',()=>{
 const result=spawnSync(process.execPath,[new URL('signal-imported-runner.mjs',import.meta.url).pathname],
  {env:{...env,NOISIA_SIGNAL_IMPORTED_PRIVATE_TEST_APPROVED:'true',DATABASE_URL:'do-not-print-imported-secret'},encoding:'utf8',timeout:5000});
 assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,/do-not-print-imported-secret|synthetic-password/u);
 const report=JSON.parse(result.stdout);assert.match(report.error_code,/^noi19_dev_test_(target_unsealed|environment_mismatch)$/u);
 assert.equal(report.remote_connected,false);assert.equal(report.fixture_mutations_started,false);
 assert.equal(report.physical_rollback,false);assert.equal(report.post_rollback_empty,false);
});

test('savepoint adapter preserves ordered reader settings and never commits the physical transaction',async()=>{
 const {savepointQueryable}=await import('./signal-imported-transaction.mjs');
 const statements=[];const nested=savepointQueryable({query:async(sql)=>{statements.push(sql);return{rows:[]};}});
 await nested.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL enable_nestloop=off; SET LOCAL jit=off");
 assert.equal(nested.depth,1);
 await nested.query('BEGIN');await nested.query('ROLLBACK');await nested.query('COMMIT');assert.equal(nested.depth,0);
 assert.deepEqual(statements,["SAVEPOINT signal_imported_1","SET LOCAL TIME ZONE 'UTC'","SET LOCAL search_path=public,extensions,pg_temp",
  'SET LOCAL enable_nestloop=off','SET LOCAL jit=off','SAVEPOINT signal_imported_2','ROLLBACK TO SAVEPOINT signal_imported_2',
  'RELEASE SAVEPOINT signal_imported_2','RELEASE SAVEPOINT signal_imported_1']);
 await assert.rejects(nested.query('COMMIT'),/unbalanced_transaction/u);
 await assert.rejects(nested.query('BEGIN; DELETE FROM mentions'),/transaction_setup_invalid/u);
});

test('savepoint setup failure can roll back the nested transaction',async()=>{
 const {savepointQueryable}=await import('./signal-imported-transaction.mjs');const statements=[];
 const nested=savepointQueryable({query:async(sql)=>{statements.push(sql);if(sql==='SET LOCAL jit=off')throw Error('synthetic setup failure');return{rows:[]};}});
 await assert.rejects(nested.query('BEGIN; SET LOCAL jit=off'),/synthetic setup failure/u);
 assert.equal(nested.depth,1);await nested.query('ROLLBACK');assert.equal(nested.depth,0);
 assert.deepEqual(statements.slice(-2),['ROLLBACK TO SAVEPOINT signal_imported_1','RELEASE SAVEPOINT signal_imported_1']);
});

test('imported schema gate requires all current signatures and the validated exact-text invariant',async()=>{
 const {assertImportedServingSchema}=await import('./signal-imported-transaction.mjs');
 const valid={binding:true,snapshot:true,successor:true,projection:true,digest_validated:true,digest_required:true,digest_maintained:true};
 await assertImportedServingSchema({query:async()=>({rows:[valid]})});
 for(const key of Object.keys(valid))await assert.rejects(assertImportedServingSchema({query:async()=>({rows:[{...valid,[key]:false}]})}),/schema_mismatch/u);
});
