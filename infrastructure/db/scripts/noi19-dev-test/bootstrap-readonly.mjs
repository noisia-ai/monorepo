import {readFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import {guardBootstrapEnvironment,guardBootstrapDatabase,guardDns} from './target-guard.mjs';
import {identitySql,publicTables,verifyEmpty,schemaFingerprint} from './database-checks.mjs';

// Separate entry point; does not import the mutating runner, fixture or Worker.
const seal=JSON.parse(await readFile(new URL('./target-seal.json',import.meta.url),'utf8'));
let client,pool;
try{
 const connection=guardBootstrapEnvironment(process.env,seal);
 const addresses=await lookup(connection.host,{all:true});guardDns(addresses);
 const {default:pg}=await import('pg');
 pool=new pg.Pool({...connection,host:addresses[0].address,ssl:false,max:1,connectionTimeoutMillis:10_000,
  application_name:'noi19-private-readonly-bootstrap',statement_timeout:15_000,
  options:'-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=30000'});
 client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query('SET LOCAL search_path=public,extensions,pg_temp');
 const identity=(await client.query(identitySql)).rows[0];guardBootstrapDatabase(identity,seal,addresses.map(row=>row.address));
 const tables=await publicTables(client);await verifyEmpty(client,tables);
 const schema_sha256=await schemaFingerprint(client);
 await client.query('ROLLBACK');
 process.stdout.write(JSON.stringify({contract_version:'noi19-private-bootstrap-v1',status:'verified',
  system_identifier:identity.system_identifier,schema_sha256,tables:tables.length,empty:true,read_only:true})+'\n');
}catch(error){
 const fixed=/^noi19_dev_test_[a-z_]+$/u.test(error?.message??'')
  ?error.message:'noi19_dev_test_bootstrap_rejected';
 process.stderr.write(fixed+'\n');process.exitCode=1;
}finally{
 if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}
 if(pool)await pool.end().catch(()=>{});
}
