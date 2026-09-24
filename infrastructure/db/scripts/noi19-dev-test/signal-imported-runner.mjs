import {readFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {guardSignalImportedEnvironment,sealedTableCount,guardDns,guardDatabase} from './target-guard.mjs';

import {identitySql,publicTables,verifyEmpty,schemaFingerprint} from './database-checks.mjs';
import {savepointQueryable,assertImportedServingSchema} from './signal-imported-transaction.mjs';

const seal=JSON.parse(await readFile(new URL('./target-seal.json',import.meta.url),'utf8'));
const report={contract_version:'signal-imported-private-dev-test-receipt-v1',status:'blocked',remote_connected:false,remote_executed:false,fixture_mutations_started:false,
 synthetic_roots:3,provider_transports:0,assertions:[],physical_rollback:false,post_rollback_empty:false};
let pool,client,outer=false,closed=false,heartbeat,cleanup;
const fixedError=(error)=>/^noi19_dev_test_[a-z_]+$/u.test(error?.message??'')?error.message:'noi19_dev_test_execution_failed';
try{
 const connection=guardSignalImportedEnvironment(process.env,seal);
 const tableCount=sealedTableCount(seal,{requireExplicit:true});
 const addresses=await lookup(connection.host,{all:true});guardDns(addresses);
 // Block HTTP even if an imported handler accidentally constructs a real provider.
 const denied=()=>{report.provider_transports++;throw Error('noi19_dev_test_transport_forbidden');};
 globalThis.fetch=denied;http.request=denied;http.get=denied;https.request=denied;https.get=denied;
 const {default:pg}=await import('pg');
 pool=new pg.Pool({...connection,host:addresses[0].address,ssl:false,max:1,connectionTimeoutMillis:10_000,
  application_name:'signal-imported-private-synthetic-test',statement_timeout:30_000,idle_in_transaction_session_timeout:45_000});
 client=await pool.connect();
 report.remote_connected=true;report.remote_executed=true;
 // Bound all connected work, including schema/emptiness checks before fixture setup.
 heartbeat=setTimeout(()=>{client.release(true);process.stderr.write('noi19_dev_test_timeout\n');process.exit(1);},180_000);
 const identity=(await client.query(identitySql)).rows[0];
 guardDatabase(identity,seal,addresses.map(row=>row.address));
 // READ COMMITTED is deliberate: the table locks may wait for a previous
 // writer, and the subsequent empty check must see that writer's commit.
 await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');outer=true;
 await client.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL jit=off; SET LOCAL lock_timeout='5s'");
 if(!(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('noi19-private-dev-test-single-runner-v1',0)) locked")).rows[0].locked)
  throw Error('noi19_dev_test_runner_busy');
 const tables=await publicTables(client,tableCount);
 // SHARE locks exclude concurrent inserts/updates after the empty-schema check.
 await client.query(`LOCK TABLE ${tables.map(row=>row.quoted).join(',')} IN SHARE MODE`);
 const emptiness=()=>verifyEmpty(client,tables,tableCount);
 await emptiness();
 const schemaDigest=()=>schemaFingerprint(client);
 const beforeSchema=await schemaDigest();
 if(beforeSchema!==seal.schema_sha256)throw Error('noi19_dev_test_schema_mismatch');
 await assertImportedServingSchema(client);
 const nested=savepointQueryable(client),query=nested.query;
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
 // Registration happens after destination and empty-schema guards, never env/load.
 const {register}=await import('tsx/esm/api');register();
 const {assertSignalWorkspaceImportedServingV1}=await import('../../migrations/signal-workspace-imported-serving.assertions.ts');
 report.fixture_mutations_started=true;
 await assertSignalWorkspaceImportedServingV1({test:async(name,fn)=>{await fn();report.assertions.push({name,status:'passed'});}},
  {database,scoped,query,cleanup});
 if(nested.depth)throw Error('noi19_dev_test_unbalanced_transaction');
 if(report.assertions.length!==6)throw Error('noi19_dev_test_assertions_incomplete');
 if(report.provider_transports!==0)throw Error('noi19_dev_test_transport_forbidden');
 report.table_count=tableCount;report.schema_sha256=beforeSchema;report.status='passed';
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
