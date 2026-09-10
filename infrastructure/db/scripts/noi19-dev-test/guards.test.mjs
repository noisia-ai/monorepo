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
 DATABASE_URL:'postgresql://postgres:synthetic-password@pgvector.railway.internal:5432/railway'};
const row={database:'railway',user:'postgres',address:'fd12:3456::1',port:5432,version:'170005',system_identifier:seal.system_identifier};
test('the mutating runner refuses an unsealed database even when environment/host match',()=>{
 assert.throws(()=>guardEnvironment(env,{...seal,system_identifier:null}),/target_unsealed/u);
 assert.throws(()=>guardEnvironment(env,{...seal,schema_sha256:null}),/target_unsealed/u);
 assert.throws(()=>guardBootstrapEnvironment(env,{...seal,runner_service_id:null}),/target_unsealed/u);
 assert.equal(guardBootstrapEnvironment(env,{...seal,system_identifier:null,schema_sha256:null}).host,seal.host);
});
test('private environment, runner, database service, URL database and role must all match',()=>{
 assert.equal(guardEnvironment(env,seal).database,'railway');
 for(const key of ['RAILWAY_ENVIRONMENT_ID','RAILWAY_ENVIRONMENT_NAME','RAILWAY_SERVICE_ID','NOISIA_DEV_TEST_DATABASE_SERVICE_ID','NOISIA_NOI19_PRIVATE_TEST_APPROVED'])
  assert.throws(()=>guardEnvironment({...env,[key]:'wrong'},seal),/environment_mismatch/u);
 for(const url of [env.DATABASE_URL.replace('railway.internal','proxy.rlwy.net'),env.DATABASE_URL+'?host=evil.example.test',env.DATABASE_URL+'#secret',
  env.DATABASE_URL.replace('/railway','/production'),env.DATABASE_URL.replace('postgres:','wrong:'),env.DATABASE_URL.replace(':5432',':6543'),
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
test('checked-in entrypoints fail before DNS/PG with the incomplete source seal; stdout is secret-free',()=>{
 assert.equal(shipped.system_identifier,null);assert.equal(shipped.runner_service_id,null);
 for(const name of ['runner.mjs','bootstrap-readonly.mjs']){
  const result=spawnSync(process.execPath,[new URL(name,import.meta.url).pathname],{env:{...env,DATABASE_URL:'never-print-this-secret'},encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,/never-print-this-secret|synthetic-password/u);
  if(name==='runner.mjs'){const receipt=JSON.parse(result.stdout);assert.equal(receipt.remote_executed,false);assert.equal(receipt.error_code,'noi19_dev_test_target_unsealed');}
 }
});
