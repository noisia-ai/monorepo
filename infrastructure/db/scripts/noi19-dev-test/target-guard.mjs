import {isIP} from 'node:net';

const fail=(code)=>{throw new Error(`noi19_dev_test_${code}`);};
export function privateAddress(address){
  return isIP(address)===6 && /^(fc|fd)[0-9a-f]{2}:/iu.test(address)
    || isIP(address)===4 && (/^10\./u.test(address)||/^192\.168\./u.test(address)||/^172\.(1[6-9]|2\d|3[01])\./u.test(address));
}
/** Seal is reviewed source, never command-line/body/environment input. Credentials
 * exist only in DATABASE_URL in memory. Every error is a fixed, secret-free code. */
export function guardBootstrapEnvironment(env,seal){
  if(seal.environment_id!=='5bad359d-cfa4-4e8f-aa41-98e6f075375a'
    ||seal.database_service_id!=='8cc1601e-a87a-4b23-ae7c-9a4dc0a315a0'
    ||seal.host!=='pgvector.railway.internal'||seal.port!==5432
    ||seal.database!=='railway'||seal.user!=='postgres')fail('seal_invalid');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(seal.runner_service_id??''))fail('target_unsealed');
  if(env.RAILWAY_ENVIRONMENT_ID!==seal.environment_id||env.RAILWAY_ENVIRONMENT_NAME!==seal.environment_name
    ||env.RAILWAY_SERVICE_ID!==seal.runner_service_id||env.NOISIA_DEV_TEST_DATABASE_SERVICE_ID!==seal.database_service_id
    ||env.NOISIA_NOI19_PRIVATE_TEST_APPROVED!=='true')fail('environment_mismatch');
  for(const [key,value] of Object.entries(env)){
    if(!value)continue;
    if(/^PG[A-Z_]*$/u.test(key)
      ||/^(NODE_OPTIONS|NODE_PATH|DATABASE_PUBLIC_URL|NOISIA_WORKSPACE_ENGINE_TEST_.+|NOISIA_CLIENT_WORKSPACE_ENTRY_PG_APPROVED)$/u.test(key))fail('connection_override');
    if(/(?:ANTHROPIC|VOYAGE|OPENAI|UPSTASH|REDIS|SUPABASE|AWS|S3|KIND[E]?).*(?:KEY|TOKEN|SECRET|URL|PASSWORD)/iu.test(key))fail('external_credentials_present');
  }
  let url;try{url=new URL(env.DATABASE_URL);}catch{fail('url_invalid');}
  if(url.protocol!=='postgresql:'&&url.protocol!=='postgres:')fail('url_invalid');
  if(url.hostname!==seal.host||url.port!==String(seal.port)||url.pathname!==`/${seal.database}`
    ||url.username!==seal.user||!url.password||url.search||url.hash)fail('target_mismatch');
  return {host:seal.host,port:seal.port,database:seal.database,user:seal.user,password:decodeURIComponent(url.password)};
}
export function guardEnvironment(env,seal){
  if(!/^[a-f0-9]{64}$/u.test(seal.schema_sha256??'')||!/^[0-9]{15,25}$/u.test(seal.system_identifier??''))fail('target_unsealed');
  return guardBootstrapEnvironment(env,seal);
}
export function guardBootstrapDatabase(row,seal,addresses){
  if(row.database!==seal.database||row.user!==seal.user||row.port!==seal.port||!addresses.includes(row.address)||!privateAddress(row.address)
    ||!Number.isInteger(Number(row.version))||Number(row.version)<170000||Number(row.version)>=180000||!/^[0-9]{15,25}$/u.test(row.system_identifier))fail('database_identity_mismatch');
}
export function guardDns(records){
  if(!records.length||records.some(row=>!privateAddress(row.address)))fail('dns_not_private');
}
export function guardDatabase(row,seal,addresses){
  if(row.database!==seal.database||row.user!==seal.user||row.system_identifier!==seal.system_identifier
    ||row.port!==seal.port||!addresses.includes(row.address)||!privateAddress(row.address)
    ||!Number.isInteger(Number(row.version))||Number(row.version)<170000||Number(row.version)>=180000)fail('database_identity_mismatch');
}
export function guardEmptyTables(rows){
  if(rows.length!==269||rows.some(row=>row.nonempty!==false))fail('database_not_empty');
}
