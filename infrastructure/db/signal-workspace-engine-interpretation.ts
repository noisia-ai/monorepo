import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {signalWorkspaceEmbeddingDigestV1,SIGNAL_WORKSPACE_INTERPRETATION_REPAIR_PROTOCOL_DIGEST_V1} from '@noisia/query-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {loadSignalWorkspaceEngineInputIdentityV1,type SignalWorkspaceEngineAnalysisConfigV1,type SignalWorkspaceEngineInterpretationRevisionV1} from './signal-workspace-engine';
export type SignalWorkspaceEngineInterpretationDatabaseV1=Pick<Pool,'query'|'connect'>;
export class SignalWorkspaceEngineInterpretationError extends Error{
 constructor(readonly code:string,readonly status=409){super(code);this.name='SignalWorkspaceEngineInterpretationError';}
}
export type SignalWorkspaceEngineEditorialRepairV1={
 contract_version:'workspace-editorial-repair-v1';source_call_id:string;source_request_digest:string;
 source_response_sha256:string;diagnostic:'output_invalid';protocol_digest:string;
};
export type SignalWorkspaceEngineInterpretationCallV1={
 call_id:string;execution_id:string;workspace_id:string;attempt_token:string;retry_of_call_id:string|null;
 state:'reserved'|'in_flight'|'response_persisted'|'settled'|'outcome_unknown'|'definitely_not_sent'|'terminal_confirmed';
 reserved_micro_usd:number;settled_micro_usd:number|null;request_digest:string;interpretation_revision_digest:string|null;
 editorial_repair:SignalWorkspaceEngineEditorialRepairV1|null;
 response:null|{storage_key:string;sha256:string;size_bytes:number;http_status:number;provider_request_id:string|null;complete:boolean};
};
export type SignalWorkspaceEngineInterpretationConfigurationV1={
 provider:'anthropic';model:string;prompt_digest:string;schema_digest:string;pricing_version:string;
 input_micro_usd_per_million_tokens:number;output_micro_usd_per_million_tokens:number;
 cache_read_micro_usd_per_million_tokens:number;cache_creation_micro_usd_per_million_tokens:number;
};
export type SignalWorkspaceEngineInterpretationUsageV1={
 input_tokens:number;output_tokens:number;cache_read_input_tokens:number;cache_creation_input_tokens:number;
};
/** Terminal reservations remain a subset of reserved, never settled or invoiced. */
export type SignalWorkspaceEngineInterpretationBudgetV1={
 confirmed_micro_usd:number;reserved_micro_usd:number;unknown_reserved_micro_usd:number;terminal_reserved_micro_usd:number;
 observed_exception_micro_usd:number;hard_cap_micro_usd:number;
};
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceEngineInterpretationError(code,status);};
const digest=/^sha256:[0-9a-f]{64}$/u;
const natural=(value:unknown):number=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)return fail('workspace_engine_interpretation_count_invalid',503);return n;};
const validKey=(key:string)=>/^[A-Za-z0-9._:-]{8,200}$/u.test(key);
async function tx<T>(database:SignalWorkspaceEngineInterpretationDatabaseV1,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 const c=await database.connect();try{await c.query('BEGIN');await c.query('SET LOCAL search_path=public,extensions,pg_temp');
  const result=await work(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK').catch(()=>undefined);throw error;}finally{c.release();}
}
type Row={id:string;workspace_id:string;catalog_execution_id:string;actor_user_id:string;request_digest:string;request_seal:string;
 call_state:SignalWorkspaceEngineInterpretationCallV1['state'];attempt_token:string;retry_of_call_id:string|null;reserved_micro_usd:string;settled_micro_usd:string|null;
 call_configuration:SignalWorkspaceEngineInterpretationConfigurationV1;response_storage_key:string|null;response_sha256:string|null;response_size_bytes:string|null;
 response_http_status:number|null;provider_request_id:string|null;response_complete:boolean;budget_date:string;budget_timezone:string;budget_daily_cap_micro_usd:string;failure_code:string|null;
 interpretation_revision_digest:string|null;editorial_repair:SignalWorkspaceEngineEditorialRepairV1|null};
const view=(r:Row):SignalWorkspaceEngineInterpretationCallV1=>({call_id:r.id,execution_id:r.catalog_execution_id,workspace_id:r.workspace_id,attempt_token:r.attempt_token,retry_of_call_id:r.retry_of_call_id,
 state:r.call_state,reserved_micro_usd:natural(r.reserved_micro_usd),settled_micro_usd:r.settled_micro_usd===null?null:natural(r.settled_micro_usd),request_digest:r.request_digest,interpretation_revision_digest:r.interpretation_revision_digest??null,editorial_repair:r.editorial_repair,
 response:r.response_storage_key?{storage_key:r.response_storage_key,sha256:r.response_sha256!,size_bytes:natural(r.response_size_bytes),http_status:r.response_http_status!,provider_request_id:r.provider_request_id,complete:r.response_complete}:null});
async function authorize(c:PoolClient,workspace:string,actor:string,execute=true){const cap=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,workspace_id:workspace,actor_user_id:actor});
 if(!(execute?cap.can_execute_topics:cap.can_view))return fail('workspace_engine_interpretation_forbidden',403);}
async function actorLock(c:PoolClient,actor:string){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-interpretation-budget:${actor}`]);}
async function execution(c:PoolClient,workspace:string,id:string,actor:string,checkCurrent=true,executionToken?:string){
 const row=(await c.query<{id:string;actor_user_id:string;status:string;execution_token:string|null;lease_live:boolean;fit_checkpoint:unknown;
  interpretation_revision:SignalWorkspaceEngineInterpretationRevisionV1|null;input_snapshot:{context_digest:string;catalog_digest:string;claude_cap_micro_usd:number;interpretation_config?:SignalWorkspaceEngineAnalysisConfigV1};current:boolean}>(`
 SELECT execution.id,execution.actor_user_id,execution.status,execution.input_snapshot-'guides' input_snapshot,execution.interpretation_revision,
  execution.execution_token,execution.execution_expires_at>clock_timestamp() lease_live,execution.result_summary->'fit_checkpoint' fit_checkpoint,
  execution.input_revision=state.input_revision AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp()) current
 FROM signal_topic_catalog_executions execution JOIN signal_corpus_preparation_input_state state USING(workspace_id)
 WHERE execution.id=$1::uuid AND execution.workspace_id=$2::uuid AND execution.input_contract='workspace-topic-engine-v1' FOR UPDATE OF execution`,[id,workspace])).rows[0];
 if(!row||row.actor_user_id!==actor)return fail('workspace_engine_interpretation_forbidden',403);
 if(row.input_snapshot.interpretation_config){
  if(row.status!=='running'||!row.fit_checkpoint)return fail('workspace_engine_interpretation_fit_required');
  if(!executionToken||row.execution_token!==executionToken||!row.lease_live)return fail('workspace_engine_interpretation_lease_conflict');
 }else if(row.status!=='ready')return fail('workspace_engine_interpretation_fit_required');
 if(checkCurrent){if(!row.current)return fail('workspace_engine_interpretation_inputs_stale');
  const identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:c,workspace_id:workspace,actor_user_id:actor});
  if(identity.context_digest!==row.input_snapshot.context_digest||identity.catalog_digest!==row.input_snapshot.catalog_digest)return fail('workspace_engine_interpretation_inputs_stale');}
 return row;
}
const rowSQL=`SELECT id,workspace_id,catalog_execution_id,actor_user_id,request_digest,request_seal,call_state,attempt_token,retry_of_call_id,
 reserved_micro_usd::text,settled_micro_usd::text,call_configuration,response_storage_key,response_sha256,response_size_bytes::text,
 response_http_status,provider_request_id,COALESCE((metadata->>'response_complete')::boolean,true) response_complete,budget_date::text,budget_timezone,budget_daily_cap_micro_usd::text,failure_code,
 metadata->'editorial_repair' editorial_repair,metadata->>'interpretation_revision_digest' interpretation_revision_digest
 FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1'`;
async function lockedCall(c:PoolClient,id:string,token:string){
 const scope=(await c.query<{actor_user_id:string;catalog_execution_id:string}>("SELECT actor_user_id,catalog_execution_id FROM engine_cost_events WHERE id=$1::uuid AND workspace_contract='workspace-engine-interpretation-v1'",[id])).rows[0];
 if(!scope)return fail('workspace_engine_interpretation_call_not_found',404);await actorLock(c,scope.actor_user_id);
 await c.query('SELECT id FROM signal_topic_catalog_executions WHERE id=$1::uuid FOR UPDATE',[scope.catalog_execution_id]);
 const row=(await c.query<Row>(`${rowSQL} AND id=$1::uuid FOR UPDATE`,[id])).rows[0]!;
 if(row.attempt_token!==token)return fail('workspace_engine_interpretation_attempt_conflict');return row;
}
// A sealed editorial grant expires independently of the lease. Diagnose only a
// DB-clock-proven expiry; malformed or unrelated DB failures remain failures.
// Call after idempotent receipt lookup, only before a new reservation or send.
async function assertEditorialAdmission(c:PoolClient,revision:SignalWorkspaceEngineInterpretationRevisionV1|null){
 if(!revision)return;
 const row=(await c.query<{expired:boolean|null}>(`SELECT instant.now >= $1::timestamptz
  OR to_char(instant.now AT TIME ZONE $2,'YYYY-MM-DD') <> $3 expired
  FROM (SELECT clock_timestamp() now) instant`,
  [revision.admission_not_after,revision.configuration.budget_timezone,revision.budget_date])).rows[0];
 if(row?.expired===true)return fail('workspace_engine_interpretation_daily_authority_expired');
 if(row?.expired!==false)return fail('workspace_engine_interpretation_config_mismatch');
}
const exposureSQL=`CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END`;
export async function reserveSignalWorkspaceEngineInterpretationV1(args:{database:SignalWorkspaceEngineInterpretationDatabaseV1;
 workspace_id:string;actor_user_id:string;execution_id:string;idempotency_key:string;request_digest:string;
 configuration:SignalWorkspaceEngineInterpretationConfigurationV1;reserved_micro_usd:number;budget_timezone:string;daily_cap_micro_usd:number;
 retry_of_call_id?:string;execution_token?:string;interpretation_revision_digest?:string;editorial_repair?:SignalWorkspaceEngineEditorialRepairV1}):Promise<SignalWorkspaceEngineInterpretationCallV1>{
 const config=args.configuration;
 if(!validKey(args.idempotency_key)||!digest.test(args.request_digest)||!digest.test(config.prompt_digest)||!digest.test(config.schema_digest)
  ||config.provider!=='anthropic'||!config.model||config.model.length>120||!config.pricing_version||config.pricing_version.length>200
  ||![config.input_micro_usd_per_million_tokens,config.output_micro_usd_per_million_tokens,config.cache_read_micro_usd_per_million_tokens,config.cache_creation_micro_usd_per_million_tokens]
   .every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isSafeInteger(args.reserved_micro_usd)||args.reserved_micro_usd<=0
  ||!Number.isSafeInteger(args.daily_cap_micro_usd)||args.daily_cap_micro_usd<=0||args.budget_timezone.length>100)return fail('workspace_engine_interpretation_request_invalid',422);
 const repair=args.editorial_repair;
 if(repair&&(Object.keys(repair).sort().join(',')!=='contract_version,diagnostic,protocol_digest,source_call_id,source_request_digest,source_response_sha256'
  ||repair.contract_version!=='workspace-editorial-repair-v1'||repair.diagnostic!=='output_invalid'
  ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(repair.source_call_id)
  ||!digest.test(repair.source_request_digest)||!digest.test(repair.source_response_sha256)
  ||repair.protocol_digest!==SIGNAL_WORKSPACE_INTERPRETATION_REPAIR_PROTOCOL_DIGEST_V1||repair.source_request_digest===args.request_digest))
   return fail('workspace_engine_interpretation_repair_invalid',422);
 const seal=signalWorkspaceEmbeddingDigestV1({request_digest:args.request_digest,configuration:config,reserved_micro_usd:args.reserved_micro_usd,
  budget_timezone:args.budget_timezone,daily_cap_micro_usd:args.daily_cap_micro_usd,execution_id:args.execution_id,retry_of_call_id:args.retry_of_call_id??null,
  ...(repair?{editorial_repair:repair}:{}),...(args.interpretation_revision_digest?{interpretation_revision_digest:args.interpretation_revision_digest}:{})});
 return tx(args.database,async c=>{await authorize(c,args.workspace_id,args.actor_user_id);await actorLock(c,args.actor_user_id);
  const byKey=(await c.query<Row>(`${rowSQL} AND workspace_id=$1::uuid AND idempotency_key=$2 FOR UPDATE`,[args.workspace_id,args.idempotency_key])).rows[0];
  if(byKey){if(byKey.actor_user_id!==args.actor_user_id||byKey.request_seal!==seal)return fail('workspace_engine_interpretation_idempotency_conflict');return view(byKey);}
  const attempts=(await c.query<Row>(`${rowSQL} AND workspace_id=$1::uuid AND catalog_execution_id=$2::uuid AND request_digest=$3 ORDER BY created_at DESC,id DESC FOR UPDATE`,
   [args.workspace_id,args.execution_id,args.request_digest])).rows;
  const active=attempts.find(row=>!['definitely_not_sent','terminal_confirmed'].includes(row.call_state));
  if(active){if(active.actor_user_id!==args.actor_user_id||active.request_seal!==seal)return fail('workspace_engine_interpretation_idempotency_conflict');return view(active);}
  if(args.retry_of_call_id){const prior=attempts.find(row=>row.id===args.retry_of_call_id);
   if(!prior||prior.actor_user_id!==args.actor_user_id||!['definitely_not_sent','terminal_confirmed'].includes(prior.call_state)||prior.response_storage_key!==null
    ||natural(prior.reserved_micro_usd)!==args.reserved_micro_usd||signalWorkspaceEmbeddingDigestV1(prior.call_configuration)!==signalWorkspaceEmbeddingDigestV1(config)
    ||signalWorkspaceEmbeddingDigestV1(prior.editorial_repair)!==signalWorkspaceEmbeddingDigestV1(repair??null)
    ||attempts.some(row=>row.retry_of_call_id===prior.id))return fail('workspace_engine_interpretation_retry_unavailable');
   if(prior.call_state==='terminal_confirmed'&&attempts.filter(row=>row.call_state==='terminal_confirmed').length>1)
    return fail('workspace_engine_interpretation_transport_retry_exhausted');
  }else if(attempts.length){const prior=attempts[0]!;
   if(prior.actor_user_id!==args.actor_user_id||prior.request_seal!==seal)return fail('workspace_engine_interpretation_idempotency_conflict');return view(prior);}
  const run=await execution(c,args.workspace_id,args.execution_id,args.actor_user_id,true,args.execution_token);
  const sealed=run.interpretation_revision?.configuration??run.input_snapshot.interpretation_config;
  if((run.interpretation_revision?.revision_digest??null)!==(args.interpretation_revision_digest??null))return fail('workspace_engine_interpretation_revision_mismatch');
  if(sealed&&(signalWorkspaceEmbeddingDigestV1(config)!==signalWorkspaceEmbeddingDigestV1(sealed.call_configuration)
    ||args.budget_timezone!==sealed.budget_timezone||args.daily_cap_micro_usd!==sealed.daily_cap_micro_usd))return fail('workspace_engine_interpretation_config_mismatch');
  if(repair){
   const source=(await c.query<Row>(`${rowSQL} AND id=$1::uuid FOR UPDATE`,[repair.source_call_id])).rows[0];
   if(!sealed||!source||source.workspace_id!==args.workspace_id||source.catalog_execution_id!==args.execution_id||source.actor_user_id!==args.actor_user_id
    ||source.call_state!=='settled'||!source.response_storage_key||source.response_http_status!==200||!source.response_complete||source.editorial_repair!==null
    ||source.request_digest!==repair.source_request_digest||source.response_sha256!==repair.source_response_sha256
    ||signalWorkspaceEmbeddingDigestV1(source.call_configuration)!==signalWorkspaceEmbeddingDigestV1(config)
    ||(await c.query("SELECT 1 FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND metadata->>'call_id'=$2 LIMIT 1",[args.execution_id,source?.id??''])).rows.length)
     return fail('workspace_engine_interpretation_repair_unavailable');
   if((await c.query("SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND call_state IN('in_flight','response_persisted','outcome_unknown') LIMIT 1",[args.execution_id])).rows.length)
     return fail('workspace_engine_interpretation_outcome_unknown');
   if(!args.retry_of_call_id&&(await c.query("SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND lower(metadata->'editorial_repair'->>'source_call_id')=lower($2::text) AND retry_of_call_id IS NULL LIMIT 1",[args.execution_id,repair.source_call_id])).rows.length)
     return fail('workspace_engine_interpretation_repair_unavailable');
  }
  if(attempts.some(row=>row.call_state==='terminal_confirmed')){
   if(!(await c.query<{valid:boolean}>('SELECT workspace_engine_terminal_checkpoint_v1($1::uuid) valid',[args.execution_id])).rows[0]?.valid)
    return fail('workspace_engine_checkpoint_invalid');
   if((await c.query("SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND call_state IN('in_flight','response_persisted','outcome_unknown') LIMIT 1",[args.execution_id])).rows.length)
    return fail('workspace_engine_interpretation_outcome_unknown');
  }
  await assertEditorialAdmission(c,run.interpretation_revision);
  if(!(await c.query('SELECT name FROM pg_timezone_names WHERE name=$1',[args.budget_timezone])).rows[0])return fail('workspace_engine_interpretation_timezone_invalid',422);
  const date=(await c.query<{date:string}>("SELECT to_char(clock_timestamp() AT TIME ZONE $1,'YYYY-MM-DD') date",[args.budget_timezone])).rows[0]!.date;
  const spent=(await c.query<{run_spent:string;day_spent:string}>(`SELECT
    COALESCE(sum(${exposureSQL}) FILTER(WHERE catalog_execution_id=$1::uuid),0)::text run_spent,
    COALESCE(sum(${exposureSQL}) FILTER(WHERE budget_date=$3::date),0)::text day_spent
    FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=$2::uuid`,[args.execution_id,args.actor_user_id,date])).rows[0]!;
  if(natural(spent.run_spent)+args.reserved_micro_usd>natural(run.input_snapshot.claude_cap_micro_usd))return fail('workspace_engine_interpretation_run_cap_exceeded');
  if(natural(spent.day_spent)+args.reserved_micro_usd>args.daily_cap_micro_usd)return fail('workspace_engine_interpretation_daily_cap_exceeded');
  const id=randomUUID(),token=randomUUID();await c.query(`INSERT INTO engine_cost_events(id,workspace_contract,workspace_id,catalog_execution_id,actor_user_id,
   provider,model,operation,idempotency_key,request_digest,request_seal,call_configuration,call_state,attempt_token,reserved_micro_usd,budget_date,budget_timezone,budget_daily_cap_micro_usd,retry_of_call_id,metadata)
   VALUES($1::uuid,'workspace-engine-interpretation-v1',$2::uuid,$3::uuid,$4::uuid,'anthropic',$5,'workspace-engine-interpretation',
    $6,$7,$8,$9::jsonb,'reserved',$10::uuid,$11,$12::date,$13,$14,$15::uuid,$16::jsonb)`,[id,args.workspace_id,args.execution_id,args.actor_user_id,config.model,
    args.idempotency_key,args.request_digest,seal,JSON.stringify(config),token,args.reserved_micro_usd,date,args.budget_timezone,args.daily_cap_micro_usd,args.retry_of_call_id??null,JSON.stringify({...repair?{editorial_repair:repair}:{},...args.interpretation_revision_digest?{interpretation_revision_digest:args.interpretation_revision_digest}:{}})]);
  return view((await c.query<Row>(`${rowSQL} AND id=$1::uuid`,[id])).rows[0]!);
 });
}
export async function markSignalWorkspaceEngineInterpretationSentV1(args:{database:SignalWorkspaceEngineInterpretationDatabaseV1;call_id:string;attempt_token:string;execution_token?:string}):Promise<{call:SignalWorkspaceEngineInterpretationCallV1;send_authorized:boolean}>{
 return tx(args.database,async c=>{const row=await lockedCall(c,args.call_id,args.attempt_token);
  if(row.call_state!=='reserved')return{call:view(row),send_authorized:false};
  await authorize(c,row.workspace_id,row.actor_user_id);const run=await execution(c,row.workspace_id,row.catalog_execution_id,row.actor_user_id,true,args.execution_token);
  if(row.editorial_repair&&(await c.query("SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND id<>$2::uuid AND call_state IN('in_flight','response_persisted','outcome_unknown') LIMIT 1",[row.catalog_execution_id,row.id])).rows.length)
    return fail('workspace_engine_interpretation_outcome_unknown');
  await assertEditorialAdmission(c,run.interpretation_revision);
  const today=(await c.query<{date:string}>("SELECT to_char(clock_timestamp() AT TIME ZONE $1,'YYYY-MM-DD') date",[row.budget_timezone])).rows[0]!.date;
  if(today!==row.budget_date)return fail('workspace_engine_interpretation_daily_authority_expired');
  const spent=(await c.query<{run_spent:string;day_spent:string}>(`SELECT
   COALESCE(sum(${exposureSQL}) FILTER(WHERE catalog_execution_id=$1::uuid),0)::text run_spent,
   COALESCE(sum(${exposureSQL}) FILTER(WHERE budget_date=$3::date),0)::text day_spent
   FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=$2::uuid`,[row.catalog_execution_id,row.actor_user_id,today])).rows[0]!;
  if(natural(spent.run_spent)>natural(run.input_snapshot.claude_cap_micro_usd))return fail('workspace_engine_interpretation_run_cap_exceeded');
  if(natural(spent.day_spent)>natural(row.budget_daily_cap_micro_usd))return fail('workspace_engine_interpretation_daily_cap_exceeded');
  await c.query("UPDATE engine_cost_events SET call_state='in_flight',sent_at=clock_timestamp() WHERE id=$1::uuid",[row.id]);
  return{call:view({...row,call_state:'in_flight'}),send_authorized:true};
 });
}
export async function persistSignalWorkspaceEngineInterpretationResponseV1(args:{database:SignalWorkspaceEngineInterpretationDatabaseV1;call_id:string;attempt_token:string;
 response:{storage_key:string;sha256:string;size_bytes:number;http_status:number;provider_request_id:string|null;complete?:boolean}}):Promise<SignalWorkspaceEngineInterpretationCallV1>{
 const response=args.response;if(!digest.test(response.sha256)||!Number.isSafeInteger(response.size_bytes)||response.size_bytes<0||!Number.isInteger(response.http_status)
  ||response.http_status<100||response.http_status>599||response.storage_key.includes('..')||response.complete!==undefined&&typeof response.complete!=='boolean'
  ||response.provider_request_id!==null&&response.provider_request_id.length>240)return fail('workspace_engine_interpretation_response_invalid',422);
 return tx(args.database,async c=>{const row=await lockedCall(c,args.call_id,args.attempt_token);
  if(!response.storage_key.startsWith(`workspace-engine/${row.workspace_id}/${row.catalog_execution_id}/`))return fail('workspace_engine_interpretation_response_invalid',422);
  if(row.response_storage_key){if(row.response_storage_key!==response.storage_key||row.response_sha256!==response.sha256||natural(row.response_size_bytes)!==response.size_bytes
    ||row.response_http_status!==response.http_status||row.provider_request_id!==response.provider_request_id||row.response_complete!==(response.complete??true))return fail('workspace_engine_interpretation_response_conflict');return view(row);}
  if(!['in_flight','outcome_unknown'].includes(row.call_state))return fail('workspace_engine_interpretation_response_conflict');
  await c.query(`UPDATE engine_cost_events SET call_state='response_persisted',response_storage_key=$2,response_sha256=$3,response_size_bytes=$4,
   response_http_status=$5,provider_request_id=$6,response_received_at=clock_timestamp(),metadata=metadata||jsonb_build_object('response_complete',$7::boolean) WHERE id=$1::uuid`,[row.id,response.storage_key,response.sha256,response.size_bytes,response.http_status,response.provider_request_id,response.complete??true]);
  return view({...row,call_state:'response_persisted',response_storage_key:response.storage_key,response_sha256:response.sha256,response_size_bytes:String(response.size_bytes),response_http_status:response.http_status,provider_request_id:response.provider_request_id,response_complete:response.complete??true});
 });
}
export async function settleSignalWorkspaceEngineInterpretationV1(args:{database:SignalWorkspaceEngineInterpretationDatabaseV1;call_id:string;attempt_token:string;
 usage:SignalWorkspaceEngineInterpretationUsageV1}):Promise<SignalWorkspaceEngineInterpretationCallV1>{
 if(!Object.values(args.usage).every(n=>Number.isSafeInteger(n)&&n>=0)||Object.keys(args.usage).sort().join(',')!=='cache_creation_input_tokens,cache_read_input_tokens,input_tokens,output_tokens')return fail('workspace_engine_interpretation_usage_invalid',422);
 return tx(args.database,async c=>{const row=await lockedCall(c,args.call_id,args.attempt_token);
  const config=row.call_configuration,u=args.usage;
  const micro=(BigInt(u.input_tokens)*BigInt(config.input_micro_usd_per_million_tokens)+BigInt(u.output_tokens)*BigInt(config.output_micro_usd_per_million_tokens)
   +BigInt(u.cache_read_input_tokens)*BigInt(config.cache_read_micro_usd_per_million_tokens)+BigInt(u.cache_creation_input_tokens)*BigInt(config.cache_creation_micro_usd_per_million_tokens)+999999n)/1000000n;
  if(micro>BigInt(Number.MAX_SAFE_INTEGER))return fail('workspace_engine_interpretation_cost_invalid');
  const actual=Number(micro),input=u.input_tokens+u.cache_read_input_tokens+u.cache_creation_input_tokens,total=input+u.output_tokens;
  if(input>2147483647||u.output_tokens>2147483647||total>2147483647)return fail('workspace_engine_interpretation_usage_invalid',422);
  if(row.call_state==='settled'){
   const prior=(await c.query<{usage:unknown}>('SELECT metadata->\'usage\' usage FROM engine_cost_events WHERE id=$1::uuid',[row.id])).rows[0]!.usage;
   if(natural(row.settled_micro_usd)!==actual||signalWorkspaceEmbeddingDigestV1(prior)!==signalWorkspaceEmbeddingDigestV1(u))return fail('workspace_engine_interpretation_usage_conflict');return view(row);}
  if(!['response_persisted','outcome_unknown'].includes(row.call_state)||!row.response_storage_key)return fail('workspace_engine_interpretation_response_required');
  if(!row.response_complete)return fail('workspace_engine_interpretation_response_incomplete');
  await c.query(`UPDATE engine_cost_events SET call_state='settled',settled_micro_usd=$2::bigint,input_tokens=$3,output_tokens=$4,total_tokens=$5,
   estimated_cost_usd=($2::bigint)::numeric/1000000,metadata=metadata||jsonb_build_object('usage',$6::jsonb),settled_at=clock_timestamp() WHERE id=$1::uuid`,
   [row.id,actual,input,u.output_tokens,total,JSON.stringify(u)]);
  return view({...row,call_state:'settled',settled_micro_usd:String(actual)});
 });
}
export async function failSignalWorkspaceEngineInterpretationV1(args:{database:SignalWorkspaceEngineInterpretationDatabaseV1;call_id:string;attempt_token:string;
 outcome:'definitely_not_sent'|'outcome_unknown';error_code:string}):Promise<SignalWorkspaceEngineInterpretationCallV1>{
 const code=/^workspace_engine_[a-z_]{1,100}$/u.test(args.error_code)?args.error_code:'workspace_engine_interpretation_failed';
 return tx(args.database,async c=>{const row=await lockedCall(c,args.call_id,args.attempt_token);
  if(['settled','definitely_not_sent','terminal_confirmed'].includes(row.call_state))return view(row);
  if(args.outcome==='outcome_unknown'&&code==='workspace_engine_interpretation_receipt_persistence_unknown'
    &&row.call_state==='response_persisted'&&row.response_storage_key&&row.response_complete)return view(row);
  if(args.outcome==='definitely_not_sent'&&row.response_storage_key)return fail('workspace_engine_interpretation_response_already_received');
  if(args.outcome==='outcome_unknown'&&row.call_state==='reserved')return fail('workspace_engine_interpretation_not_sent');
  await c.query('UPDATE engine_cost_events SET call_state=$2,failure_code=$3 WHERE id=$1::uuid',[row.id,args.outcome,code]);
  return view({...row,call_state:args.outcome,failure_code:code});
 });
}
export async function loadSignalWorkspaceEngineInterpretationBudgetV1(args:{database:SignalWorkspaceEngineInterpretationDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string}):Promise<SignalWorkspaceEngineInterpretationBudgetV1>{
 return tx(args.database,async c=>{await authorize(c,args.workspace_id,args.actor_user_id,false);
  const result=(await c.query<{hard_cap_micro_usd:string;confirmed_micro_usd:string;reserved_micro_usd:string;unknown_reserved_micro_usd:string;terminal_reserved_micro_usd:string;observed_exception_micro_usd:string}>(`
   SELECT execution.input_snapshot->>'claude_cap_micro_usd' hard_cap_micro_usd,
    COALESCE(sum(call.settled_micro_usd) FILTER(WHERE call.call_state='settled'),0)::text confirmed_micro_usd,
    COALESCE(sum(call.reserved_micro_usd) FILTER(WHERE call.call_state IN('reserved','in_flight','response_persisted','outcome_unknown','terminal_confirmed')),0)::text reserved_micro_usd,
    COALESCE(sum(call.reserved_micro_usd) FILTER(WHERE call.call_state='outcome_unknown'),0)::text unknown_reserved_micro_usd,
    COALESCE(sum(call.reserved_micro_usd) FILTER(WHERE call.call_state='terminal_confirmed'),0)::text terminal_reserved_micro_usd,
    COALESCE(sum(GREATEST(call.settled_micro_usd-call.reserved_micro_usd,0)) FILTER(WHERE call.call_state='settled'),0)::text observed_exception_micro_usd
   FROM signal_topic_catalog_executions execution LEFT JOIN engine_cost_events call ON call.catalog_execution_id=execution.id AND call.workspace_id=execution.workspace_id
    AND call.workspace_contract='workspace-engine-interpretation-v1'
   WHERE execution.id=$1::uuid AND execution.workspace_id=$2::uuid AND execution.input_contract='workspace-topic-engine-v1'
   GROUP BY execution.id`,[args.execution_id,args.workspace_id])).rows[0];
  if(!result)return fail('workspace_engine_interpretation_not_found',404);
  return Object.fromEntries(Object.entries(result).map(([key,value])=>[key,natural(value)])) as SignalWorkspaceEngineInterpretationBudgetV1;
 });
}

export type SignalWorkspaceEngineTerminalEvidenceV1={
 source:'anthropic_console';provider_request_id:string;provider_model:string;
 started_at:string;ended_at:string;http_status:499;reason:'client_disconnected';
 usage:SignalWorkspaceEngineInterpretationUsageV1;
 evidence:{storage_key:string;sha256:string;size_bytes:number};
};
/** Operational server entry point. Our DB checks the verifier's internal admin
 * role. Console evidence is a human-audited correlation, not an API response or
 * invoice. It never releases the original reservation or authorizes a send. */
export async function reconcileSignalWorkspaceEngineTerminalV1(args:{database:SignalWorkspaceEngineInterpretationDatabaseV1;
 workspace_id:string;execution_id:string;call_id:string;attempt_token:string;expected_request_digest:string;
 verifier_user_id:string;terminal:SignalWorkspaceEngineTerminalEvidenceV1}):Promise<SignalWorkspaceEngineInterpretationCallV1>{
 const t=args.terminal,u=t.usage;
 if(t.source!=='anthropic_console'||t.http_status!==499||t.reason!=='client_disconnected'
  ||!/^req_[A-Za-z0-9_-]{1,220}$/u.test(t.provider_request_id)||!digest.test(args.expected_request_digest)
  ||!digest.test(t.evidence.sha256)||!Number.isSafeInteger(t.evidence.size_bytes)||t.evidence.size_bytes<=0
  ||t.evidence.storage_key.includes('..')||!t.evidence.storage_key.startsWith(`workspace-engine/${args.workspace_id}/${args.execution_id}/`)
  ||!Number.isFinite(Date.parse(t.started_at))||!Number.isFinite(Date.parse(t.ended_at))||Date.parse(t.ended_at)<Date.parse(t.started_at)
  ||Object.keys(u).sort().join(',')!=='cache_creation_input_tokens,cache_read_input_tokens,input_tokens,output_tokens'
  ||!Object.values(u).every(n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647))return fail('workspace_engine_interpretation_terminal_evidence_invalid',422);
 return tx(args.database,async c=>{
  await authorize(c,args.workspace_id,args.verifier_user_id);
  if(!(await c.query("SELECT 1 FROM users WHERE id=$1::uuid AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','admin','founder')",[args.verifier_user_id])).rows.length)
   return fail('workspace_engine_interpretation_terminal_forbidden',403);
  const row=await lockedCall(c,args.call_id,args.attempt_token);
  if(row.workspace_id!==args.workspace_id||row.catalog_execution_id!==args.execution_id||row.request_digest!==args.expected_request_digest
   ||row.call_configuration.model!==t.provider_model)return fail('workspace_engine_interpretation_terminal_evidence_conflict');
  const prior=(await c.query<{receipt:Record<string,unknown>|null}>("SELECT metadata->'provider_terminal_receipt' receipt FROM engine_cost_events WHERE id=$1::uuid",[row.id])).rows[0]!.receipt;
  const config=row.call_configuration;
  const cost=(BigInt(u.input_tokens)*BigInt(config.input_micro_usd_per_million_tokens)+BigInt(u.output_tokens)*BigInt(config.output_micro_usd_per_million_tokens)
   +BigInt(u.cache_read_input_tokens)*BigInt(config.cache_read_micro_usd_per_million_tokens)+BigInt(u.cache_creation_input_tokens)*BigInt(config.cache_creation_micro_usd_per_million_tokens)+999999n)/1000000n;
  if(cost>BigInt(Number.MAX_SAFE_INTEGER))return fail('workspace_engine_interpretation_cost_invalid');
  const receipt={...t,started_at:new Date(t.started_at).toISOString(),ended_at:new Date(t.ended_at).toISOString(),
   contract_version:'workspace-provider-terminal-evidence-v1',call_id:row.id,attempt_token:row.attempt_token,workspace_id:row.workspace_id,
   execution_id:row.catalog_execution_id,request_digest:row.request_digest,configuration_digest:signalWorkspaceEmbeddingDigestV1(config),
   billing_status:'unreconciled',usage_cost_micro_usd:Number(cost),verified_by_user_id:args.verifier_user_id};
  if(prior){const sealed={...prior};delete sealed.verified_at;
   if(signalWorkspaceEmbeddingDigestV1(sealed)!==signalWorkspaceEmbeddingDigestV1(receipt))return fail('workspace_engine_interpretation_terminal_evidence_conflict');
   return view(row);}
  if(row.call_state!=='outcome_unknown'||row.response_storage_key)return fail('workspace_engine_interpretation_terminal_evidence_unavailable');
  await c.query(`UPDATE engine_cost_events SET call_state='terminal_confirmed',failure_code='workspace_engine_interpretation_transport_terminal_confirmed',
   metadata=metadata||jsonb_build_object('provider_terminal_receipt',$2::jsonb||jsonb_build_object('verified_at',clock_timestamp())) WHERE id=$1::uuid`,[row.id,JSON.stringify(receipt)]);
  await c.query(`UPDATE signal_topic_catalog_executions SET error_code=CASE WHEN EXISTS(
    SELECT 1 FROM engine_cost_events call WHERE call.catalog_execution_id=$1::uuid AND call.call_state='terminal_confirmed'
    GROUP BY call.request_digest HAVING count(*)>1) THEN 'workspace_engine_interpretation_transport_retry_exhausted'
    ELSE 'workspace_engine_interpretation_transport_terminal_confirmed' END,
   result_summary=result_summary||'{"interpretation_evidence_checkpoint_required":true}'::jsonb,updated_at=clock_timestamp()
   WHERE id=$1::uuid AND status='failed'`,[row.catalog_execution_id]);
  return view({...row,call_state:'terminal_confirmed'});
 });
}
