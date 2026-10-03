import {readFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {guardEnvironment,guardDns,guardDatabase} from './target-guard.mjs';

import {identitySql,publicTables,verifyEmpty,schemaFingerprint} from './database-checks.mjs';

const seal=JSON.parse(await readFile(new URL('./target-seal.json',import.meta.url),'utf8'));
const report={contract_version:'noi19-private-dev-test-receipt-v1',status:'blocked',remote_connected:false,remote_executed:false,fixture_mutations_started:false,
 synthetic_roots:3,provider_transports:0,assertions:[],physical_rollback:false,post_rollback_empty:false};
let pool,client,outer=false,closed=false,heartbeat,cleanup;
const fixedError=(error)=>/^noi19_dev_test_[a-z_]+$/u.test(error?.message??'')?error.message:'noi19_dev_test_execution_failed';
try{
 const connection=guardEnvironment(process.env,seal);
 const addresses=await lookup(connection.host,{all:true});guardDns(addresses);
 // Block HTTP even if an imported handler accidentally constructs a real provider.
 const denied=()=>{report.provider_transports++;throw Error('noi19_dev_test_transport_forbidden');};
 globalThis.fetch=denied;http.request=denied;http.get=denied;https.request=denied;https.get=denied;
 const {default:pg}=await import('pg');
 pool=new pg.Pool({...connection,host:addresses[0].address,ssl:false,max:1,connectionTimeoutMillis:10_000,
  application_name:'noi19-private-synthetic-test',statement_timeout:30_000,idle_in_transaction_session_timeout:45_000});
 client=await pool.connect();
 report.remote_connected=true;report.remote_executed=true;
 const identity=(await client.query(identitySql)).rows[0];
 guardDatabase(identity,seal,addresses.map(row=>row.address));
 // READ COMMITTED is deliberate: the table locks may wait for a previous
 // writer, and the subsequent empty check must see that writer's commit.
 await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');outer=true;
 await client.query("SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL jit=off; SET LOCAL lock_timeout='5s'");
 if(!(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('noi19-private-dev-test-single-runner-v1',0)) locked")).rows[0].locked)
  throw Error('noi19_dev_test_runner_busy');
 const tables=await publicTables(client);
 // SHARE locks exclude concurrent inserts/updates after the empty-schema check.
 await client.query(`LOCK TABLE ${tables.map(row=>row.quoted).join(',')} IN SHARE MODE`);
 const emptiness=()=>verifyEmpty(client,tables);
 await emptiness();
 const funcs=(await client.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY($1::text[])`,[[
   'workspace_incremental_editorial_renewal_state_v1','workspace_incremental_editorial_renewal_releasable_v1',
   'workspace_incremental_editorial_execution_current_v1','workspace_incremental_editorial_output_complete_v1',
   'workspace_interpretation_admission_receipt_v1']])).rows;
 if(funcs.length!==5)throw Error('noi19_dev_test_schema_mismatch');
 const schemaDigest=()=>schemaFingerprint(client);
 const beforeSchema=await schemaDigest();
 if(beforeSchema!==seal.schema_sha256)throw Error('noi19_dev_test_schema_mismatch');
 const stack=[];let serial=0;
 const query=async(sql,params)=>{
  if(/^BEGIN(?:\s|$)/u.test(sql)){const savepoint=`noi19_${++serial}`;stack.push(savepoint);return client.query(`SAVEPOINT ${savepoint}`);}
  if(sql==='COMMIT'||sql==='ROLLBACK'){
   const savepoint=stack.pop();if(!savepoint)throw Error('noi19_dev_test_unbalanced_transaction');
   if(sql==='ROLLBACK')await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
   return client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
  return client.query(sql,params);
 };
 const scoped=Object.create(client);scoped.query=query;scoped.release=()=>{};
 const database=Object.assign(Object.create(pool),{query,connect:async()=>scoped});
 cleanup=async()=>{
  if(closed)return;closed=true;
  await client.query('ROLLBACK');outer=false;report.physical_rollback=true;
  // Fresh READ ONLY snapshot on the same verified server; fixture savepoints
  // cannot stand in for this check. No retries or replay after an uncertain end.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');outer=true;
  await emptiness();if(await schemaDigest()!==beforeSchema)throw Error('noi19_dev_test_schema_changed');
  await client.query('ROLLBACK');outer=false;report.post_rollback_empty=true;
 };
 // A finite watchdog closes the physical connection (PostgreSQL rolls it back).
 heartbeat=setTimeout(()=>{client.release(true);process.stderr.write('noi19_dev_test_timeout\n');process.exit(1);},180_000);
 // Registration happens after destination and empty-schema guards, never env/load.
 const {register}=await import('tsx/esm/api');register();
 const {syntheticClientWorkspaceFixtureV1}=await import('../../migrations/signal-client-workspace-entry.synthetic.fixture.ts');
 const {assertClientWorkspaceEntryV1}=await import('../../migrations/signal-client-workspace-entry.assertions.ts');
 report.fixture_mutations_started=true;
 const fixture=await syntheticClientWorkspaceFixtureV1({database,scoped,query,cleanup});
 await assertClientWorkspaceEntryV1({test:async(name,fn)=>{await fn();report.assertions.push({name,status:'passed'});}},fixture);
 if(stack.length)throw Error('noi19_dev_test_unbalanced_transaction');
 if(report.provider_transports!==0)throw Error('noi19_dev_test_transport_forbidden');
 report.schema_sha256=beforeSchema;report.status='passed';
}catch(error){report.error_code=fixedError(error);report.status=report.fixture_mutations_started?'failed':'blocked';
 if(/^[A-Z0-9]{5}$/u.test(error?.code??''))report.sqlstate=error.code;process.exitCode=1;}
finally{
 clearTimeout(heartbeat);
 if(cleanup&&!closed)await cleanup().catch(()=>{report.status='failed';report.error_code='noi19_dev_test_rollback_verification_failed';process.exitCode=1;});
 if(client){if(outer)await client.query('ROLLBACK').then(()=>{report.physical_rollback=true;}).catch(()=>{});client.release();}
 if(pool)await pool.end().catch(()=>{});
 // Only fixed codes/counts and source-defined test names. Never error objects,
 // SQL params, connection strings, provider bodies, rows or environment dumps.
 process.stdout.write(JSON.stringify(report)+'\n');
}
