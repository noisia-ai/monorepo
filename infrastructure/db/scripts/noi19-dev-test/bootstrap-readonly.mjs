import {readFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import {guardBootstrapEnvironment,guardBootstrapDatabase,guardDns} from './target-guard.mjs';
import {identitySql,publicTables,tableEmptiness,schemaFingerprint} from './database-checks.mjs';

// Separate entry point; does not import the mutating runner, fixture or Worker.
const seal=JSON.parse(await readFile(new URL('./target-seal.json',import.meta.url),'utf8'));
let client,pool,stage='environment';
try{
 const connection=guardBootstrapEnvironment(process.env,seal);
 stage='dns';
 const addresses=await lookup(connection.host,{all:true});guardDns(addresses);
 stage='driver';
 const {default:pg}=await import('pg');
 pool=new pg.Pool({...connection,host:addresses[0].address,ssl:false,max:1,connectionTimeoutMillis:10_000,
  application_name:'noi19-private-readonly-bootstrap',statement_timeout:15_000,
  options:'-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=30000'});
 stage='connection';
 client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query('SET LOCAL search_path=public,extensions,pg_temp');
 stage='identity';
 const identity=(await client.query(identitySql)).rows[0];guardBootstrapDatabase(identity,seal,addresses.map(row=>row.address));
 stage='inventory';
 const tables=await publicTables(client,null);
 const inventory=await tableEmptiness(client,tables);
 const nonempty=inventory.filter(row=>row.nonempty!==false).length;
 stage='fingerprint';
 const schema_sha256=await schemaFingerprint(client);
 await client.query('ROLLBACK');
 process.stdout.write(JSON.stringify({contract_version:'noi19-private-bootstrap-v1',status:'observed',
  system_identifier:identity.system_identifier,schema_sha256,tables:tables.length,table_count:tables.length,nonempty_tables:nonempty,empty:nonempty===0,read_only:true})+'\n');
}catch(error){
 const fixed=/^noi19_dev_test_[a-z_]+$/u.test(error?.message??'')
  ?error.message:'noi19_dev_test_bootstrap_rejected';
 const code=/^[A-Z0-9]{5}$/u.test(error?.code??'') || ['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','ECONNRESET'].includes(error?.code) ? error.code : undefined;
 process.stderr.write(JSON.stringify({status:'rejected',stage,error_code:fixed,...(code?{cause_code:code}:{})})+'\n');process.exitCode=1;
}finally{
 if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}
 if(pool)await pool.end().catch(()=>{});
}
