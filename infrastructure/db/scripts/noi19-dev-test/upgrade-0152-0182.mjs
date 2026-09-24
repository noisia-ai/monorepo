import {readFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {guardDns,guardDatabase} from './target-guard.mjs';
import {identitySql} from './database-checks.mjs';
import {guardUpgradeEnvironment,loadUpgradePlan,applyEmptyUpgrade,commitAndVerifyUpgrade} from './upgrade-0152-0182-plan.mjs';

const report={contract_version:'dev-test-empty-0152-to-0182-receipt-v1',status:'blocked',remote_connected:false,
 mutations_started:false,commit_attempted:false,commit_acknowledged:false,physical_rollback:false,
 post_commit_verified:false,provider_transports:0,source_migrations:[],applied_migrations:[]};
let client,transaction=false,timer,destroy=false;
const fixedError=error=>/^noi19_dev_test_[a-z_]+$/u.test(error?.message??'')?error.message:'noi19_dev_test_upgrade_failed';
try{
 const seal=JSON.parse(await readFile(new URL('./target-seal.json',import.meta.url),'utf8'));
 const connection=guardUpgradeEnvironment(process.env,seal,process.argv.slice(2));
 const manifest=JSON.parse(await readFile(new URL('./upgrade-0152-0182-manifest.json',import.meta.url),'utf8'));
 const plan=await loadUpgradePlan(manifest);
 report.source_migrations=plan.migrations.map(({file,sha256})=>({file,sha256}));
 const addresses=await lookup(connection.host,{all:true});guardDns(addresses);
 const denied=()=>{report.provider_transports++;throw Error('noi19_dev_test_transport_forbidden');};
 globalThis.fetch=denied;http.request=denied;http.get=denied;https.request=denied;https.get=denied;
 const {default:pg}=await import('pg');
 client=new pg.Client({...connection,host:addresses[0].address,ssl:false,connectionTimeoutMillis:10_000,
  application_name:'dev-test-empty-0152-to-0182',statement_timeout:30_000,idle_in_transaction_session_timeout:45_000});
 await client.connect();report.remote_connected=true;
 timer=setTimeout(()=>{
  report.status=report.commit_attempted?'commit_outcome_unverified':'failed';
  report.error_code='noi19_dev_test_timeout';
  // Closing the socket rolls back an open transaction, but a lost COMMIT ACK
  // is never proof of rollback. No automatic second attempt is permitted.
  client.connection.stream.destroy();
  process.stdout.write(JSON.stringify(report)+'\n');process.exit(1);
 },180_000);
 const identity=(await client.query(identitySql)).rows[0];
 guardDatabase(identity,seal,addresses.map(row=>row.address));
 report.target={environment_id:seal.environment_id,database_service_id:seal.database_service_id,
  runner_service_id:seal.runner_service_id,system_identifier:identity.system_identifier};
 await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');transaction=true;
 await applyEmptyUpgrade(client,seal,plan,report);
 if(report.provider_transports!==0)throw Error('noi19_dev_test_transport_forbidden');
 await commitAndVerifyUpgrade(client,plan,report,async()=>{
  guardDatabase((await client.query(identitySql)).rows[0],seal,addresses.map(row=>row.address));
 });
 transaction=false;
}catch(error){
 report.error_code=fixedError(error);process.exitCode=1;
 if(/^[A-Z0-9]{5}$/u.test(error?.code??''))report.sqlstate=error.code;
 if(report.commit_attempted){
  report.status=report.commit_acknowledged?'committed_verification_failed':'commit_outcome_unverified';
  destroy=true;
 }else{
  report.status=report.mutations_started?'failed':'blocked';
  if(transaction)try{await client.query('ROLLBACK');transaction=false;report.physical_rollback=true;}
   catch{destroy=true;report.error_code='noi19_dev_test_rollback_unverified';}
 }
}finally{
 clearTimeout(timer);
 if(client){if(destroy)client.connection?.stream?.destroy();await client.end().catch(()=>{});}
 // One bounded, secret-free receipt: no row contents, SQL, env or error objects.
 process.stdout.write(JSON.stringify(report)+'\n');
}
