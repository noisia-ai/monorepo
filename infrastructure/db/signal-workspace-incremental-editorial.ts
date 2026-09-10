import {randomUUID,createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {SignalWorkspaceEngineError,withSignalWorkspaceEngineTransactionV1,loadSignalWorkspaceEngineInputIdentityV1,type SignalWorkspaceEngineDatabaseV1} from './signal-workspace-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';

/** Admission only. No full-fit lease, provider route or dispatch is created. */
export type SignalWorkspaceIncrementalEditorialScopeV1={database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;numeric_execution_id:string};
export type SignalWorkspaceIncrementalEditorialReceiptV1={
 contract_version:'workspace-incremental-editorial-admission-v1';operation_id:string;execution_id:string;workspace_id:string;
 action:'authorize_interpretation'|'revoke_interpretation';grant_digest:string;prior_admission_operation_id:string|null;
 authorized_by_user_id:string;budget_actor_user_id:string;input_digest:string;numeric_execution_id:string;numeric_checkpoint_digest:string;
 target_unit_digest:string;target_binding_digest:string;evidence_plan_artifact_id:string;configuration_digest:string;budget_timezone:string;budget_date:string;authorized_at:string;admission_not_after:string;
 grant_cap_micro_usd:number;run_cap_micro_usd:number;daily_cap_micro_usd:number;
};
export type SignalWorkspaceIncrementalEditorialAdmissionV1={
 numeric_execution_id:string;numeric_checkpoint_digest:string;history_cut_digest:string;target_unit_digest:string|null;target_binding_digest:string|null;evidence_plan_artifact_id:string|null;
 expected_units:number;target_units:number;legacy_units:number;claimed_units:number;is_current:boolean;can_authorize:boolean;blocked_reason:string|null;
 budget_actor_user_id:string;budget_timezone:string;budget_date:string;maximum_admission_not_after:string;daily_cap_micro_usd:number;
 confirmed_micro_usd:number;reserved_micro_usd:number;terminal_reserved_micro_usd:number;maximum_grant_micro_usd:number;
 model:'claude-sonnet-4-6';adapter_available:false;
 operation:{execution_id:string;status:string;is_current:boolean;can_revoke:boolean;requires_authorization:boolean;receipt:SignalWorkspaceIncrementalEditorialReceiptV1}|null;
 request:{idempotency_key:string;receipt:SignalWorkspaceIncrementalEditorialReceiptV1}|null;
};
export type SignalWorkspaceIncrementalEditorialBeginArgsV1=SignalWorkspaceIncrementalEditorialScopeV1&{
 expected_evidence_plan_artifact_id:string;expected_numeric_checkpoint_digest:string;expected_target_unit_digest:string;expected_history_cut_digest:string;
 idempotency_key:string;cap_micro_usd:number;admission_not_after:string;
};
export type SignalWorkspaceIncrementalEditorialResultV1={execution_id:string;receipt:SignalWorkspaceIncrementalEditorialReceiptV1;replayed:boolean};
export type SignalWorkspaceIncrementalEditorialRevokeArgsV1=Omit<SignalWorkspaceIncrementalEditorialScopeV1,'numeric_execution_id'>&{
 execution_id:string;expected_admission_operation_id:string;idempotency_key:string;
};
type Queryable=Pick<PoolClient,'query'>;
const fail=(suffix:string,status=409):never=>{throw new SignalWorkspaceEngineError(`workspace_incremental_editorial_${suffix}`,status);};
const key=(value:string)=>{if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(value))return fail('request_invalid',422);return digest({contract:'workspace-incremental-editorial-key-v1',key:value});};
const uuid=(value:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value))return fail('request_invalid',422);return value.toLowerCase();};
const canonicalDate=(value:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const hash=/^sha256:[0-9a-f]{64}$/u;
async function admin(client:Queryable,scope:{workspace_id:string;actor_user_id:string}){if(!(await client.query<{valid:boolean}>('SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid',[scope.workspace_id,scope.actor_user_id])).rows[0]?.valid)return fail('forbidden',403);}
async function request(client:Queryable,scope:{workspace_id:string;actor_user_id:string},idempotency_key?:string){
 if(idempotency_key===undefined)return null;
 return(await client.query<{request_digest:string;result:SignalWorkspaceIncrementalEditorialReceiptV1}>(`SELECT request_digest,result FROM signal_classification_operations
 WHERE workspace_id=$1::uuid AND actor_user_id=$2::uuid AND idempotency_key=$3 AND result->>'contract_version'='workspace-incremental-editorial-admission-v1'`,
 [scope.workspace_id,scope.actor_user_id,key(idempotency_key)])).rows[0]??null;
}
/** Scoped historical receipt lookup also enforces current workspace read authority. */
export async function readSignalWorkspaceIncrementalEditorialRequestWithQueryableV1(client:Queryable,scope:{workspace_id:string;actor_user_id:string},idempotency_key:string){
 if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,...scope})).can_view)return fail('forbidden',403);
 return request(client,scope,idempotency_key);
}
type Source={id:string;actor_user_id:string;input_snapshot:{context_digest:string;catalog_digest:string};checkpoint:{checkpoint_digest:string;population_digest:string;model_bank_artifact_id:string};bank_sha256:string;
 policy:{source_execution_id:string;budget_actor_user_id:string;budget_timezone:string;daily_cap_micro_usd:number}|null;targets:{expected_units:number;unique_units:number;target_units:number;target_unit_digest:string;legacy_units:number;claimed_units:number};
 census:string|null;history:string;valid:boolean;profile_id:string;input_revision:string};
async function source(client:Queryable,args:SignalWorkspaceIncrementalEditorialScopeV1):Promise<Source>{
 const row=(await client.query<Source>(`SELECT engine.id,engine.actor_user_id,engine.input_snapshot-'guides' input_snapshot,engine.input_revision::text,
 engine.result_summary->'numeric_checkpoint' checkpoint,bank.content->>'sha256' bank_sha256,
 workspace_incremental_editorial_policy_v1(engine.id) policy,workspace_incremental_editorial_targets_v1(engine.id) targets,
 workspace_incremental_editorial_census_v1(engine.id) census,signal_workspace_incremental_projection_editorial_digest_v1(engine.id) history,
 workspace_incremental_editorial_source_v1(engine.id) valid,
 (SELECT id::text FROM signal_taxonomy_profiles WHERE workspace_id=engine.workspace_id AND kind='topic' AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1) profile_id
 FROM signal_topic_catalog_executions engine LEFT JOIN analysis_artifacts bank ON bank.id::text=engine.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'
 WHERE engine.id=$1::uuid AND engine.workspace_id=$2::uuid AND engine.input_contract='workspace-topic-engine-v1' AND engine.input_snapshot ? 'numeric_descriptor'`,
 [uuid(args.numeric_execution_id),args.workspace_id])).rows[0];if(!row?.checkpoint)return fail('source_not_found',404);return row;
}
async function view(client:Queryable,args:SignalWorkspaceIncrementalEditorialScopeV1&{idempotency_key?:string},options:{accepted?:Awaited<ReturnType<typeof request>>;historical?:boolean}={}):Promise<SignalWorkspaceIncrementalEditorialAdmissionV1>{
 if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,...args})).can_view)return fail('forbidden',403);
 const accepted=options.accepted??await request(client,args,args.idempotency_key),row=await source(client,args);
 let identity:{context_digest:string;catalog_digest:string}|null=null;
 try{if(!options.historical||row.valid)identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,...args,actor_user_id:options.historical?row.actor_user_id:args.actor_user_id});}
 catch(error){if(!options.historical||!(error instanceof Error)||!(error instanceof SignalWorkspaceEngineError&&[403,404,409].includes(error.status)
   ||['workspace_topic_catalog_required','workspace_topic_catalog_empty'].includes(error.message)))throw error;}
 const is_current=row.valid&&identity!==null&&identity.context_digest===row.input_snapshot.context_digest&&identity.catalog_digest===row.input_snapshot.catalog_digest;
 const isAdmin=(await client.query<{valid:boolean}>('SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid',[args.workspace_id,args.actor_user_id])).rows[0]!.valid;
 const policy=row.policy;
 const clock=(await client.query<{now:string;date:string;maximum:string}>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now,
  (clock_timestamp() AT TIME ZONE $1)::date::text date,to_char((((clock_timestamp() AT TIME ZONE $1)::date+1)::timestamp AT TIME ZONE $1) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') maximum`,[policy?.budget_timezone??'UTC'])).rows[0]!;
 const money=(await client.query<{confirmed:string;reserved:string;terminal:string}>(`SELECT
 COALESCE(sum(settled_micro_usd) FILTER(WHERE call_state='settled'),0)::text confirmed,
 COALESCE(sum(reserved_micro_usd) FILTER(WHERE call_state NOT IN('settled','definitely_not_sent')),0)::text reserved,
 COALESCE(sum(reserved_micro_usd) FILTER(WHERE call_state='terminal_confirmed'),0)::text terminal
 FROM engine_cost_events WHERE actor_user_id=$1::uuid AND workspace_contract='workspace-engine-interpretation-v1' AND budget_date=$2::date`,[row.actor_user_id,clock.date])).rows[0]!;
 const maximum=Math.max(0,Number(policy?.daily_cap_micro_usd??0)-Number(money.confirmed)-Number(money.reserved));
 const plan=(await client.query<{id:string;metadata:{descriptor:Omit<SignalWorkspaceIncrementalEditorialEvidenceV1,'units'>};valid:boolean}>(`SELECT id,metadata,workspace_incremental_editorial_plan_valid_v1(id) valid FROM analysis_artifacts
 WHERE workspace_id=$1::uuid AND metadata->>'numeric_execution_id'=$2::text AND metadata->>'contract_version'='workspace-incremental-editorial-plan-v1' ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspace_id,row.id])).rows[0];
 const operation=(await client.query<{execution_id:string;status:string;receipt:SignalWorkspaceIncrementalEditorialReceiptV1}>(`SELECT id execution_id,status,workspace_interpretation_admission_receipt_v1(id) receipt FROM signal_topic_catalog_executions
 WHERE workspace_id=$1::uuid AND source_execution_id=$2::uuid AND input_contract='workspace-incremental-editorial-v1'
  AND ($3::uuid IS NULL OR id=$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspace_id,row.id,options.historical?accepted?.result.execution_id??null:null])).rows[0];
 const blocked_reason=!isAdmin?'workspace_incremental_editorial_forbidden':!is_current?'workspace_incremental_editorial_source_stale':!policy?'workspace_incremental_editorial_budget_policy_missing':!row.census||row.targets.expected_units!==row.targets.unique_units?'workspace_incremental_editorial_census_incomplete':operation?'workspace_incremental_editorial_already_owned':!plan?.valid?'workspace_incremental_editorial_evidence_required':plan.metadata.descriptor.stream.rows===0?'workspace_incremental_editorial_no_new_units':maximum<=0?'workspace_incremental_editorial_cap_exceeded':null;
 return{numeric_execution_id:row.id,numeric_checkpoint_digest:row.checkpoint.checkpoint_digest,history_cut_digest:row.history,target_unit_digest:plan?.metadata.descriptor.target_unit_digest??null,target_binding_digest:plan?.metadata.descriptor.target_binding_digest??null,evidence_plan_artifact_id:plan?.id??null,
 expected_units:row.targets.expected_units,target_units:plan?.metadata.descriptor.stream.rows??0,legacy_units:row.targets.legacy_units,claimed_units:row.targets.claimed_units,is_current,can_authorize:blocked_reason===null,blocked_reason,
 budget_actor_user_id:row.actor_user_id,budget_timezone:policy?.budget_timezone??'UTC',budget_date:clock.date,maximum_admission_not_after:clock.maximum,daily_cap_micro_usd:Number(policy?.daily_cap_micro_usd??0),
 confirmed_micro_usd:Number(money.confirmed),reserved_micro_usd:Number(money.reserved),terminal_reserved_micro_usd:Number(money.terminal),maximum_grant_micro_usd:maximum,model:'claude-sonnet-4-6',adapter_available:false,
 operation:operation?.receipt?{...operation,is_current,can_revoke:isAdmin&&operation.receipt.action==='authorize_interpretation',requires_authorization:operation.receipt.action==='revoke_interpretation'||Date.parse(operation.receipt.admission_not_after)<=Date.parse(clock.now)}:null,
 request:accepted?{idempotency_key:args.idempotency_key!,receipt:accepted.result}:null};
}
type AdmissionReadArgs=Omit<SignalWorkspaceIncrementalEditorialScopeV1,'numeric_execution_id'>&{numeric_execution_id?:string;idempotency_key?:string};
export function loadSignalWorkspaceIncrementalEditorialAdmissionV1(args:SignalWorkspaceIncrementalEditorialScopeV1&{idempotency_key?:string}):Promise<SignalWorkspaceIncrementalEditorialAdmissionV1>;
export function loadSignalWorkspaceIncrementalEditorialAdmissionV1(args:AdmissionReadArgs):Promise<SignalWorkspaceIncrementalEditorialAdmissionV1|null>;
/** Accepted begin/revoke keys locate their own immutable source and owner before
 * any current-source lookup. Reading a historical receipt cannot admit spending. */
export async function loadSignalWorkspaceIncrementalEditorialAdmissionV1(args:AdmissionReadArgs):Promise<SignalWorkspaceIncrementalEditorialAdmissionV1|null>{
 const client=await args.database.connect();try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query('SET LOCAL search_path=public,extensions,pg_temp');
  if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,...args})).can_view)return fail('forbidden',403);
  const accepted=args.idempotency_key?await readSignalWorkspaceIncrementalEditorialRequestWithQueryableV1(client,args,args.idempotency_key):null;
  const numeric_execution_id=accepted?.result.numeric_execution_id??args.numeric_execution_id??(await client.query<{id:string}>(`SELECT id FROM signal_topic_catalog_executions
   WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-engine-v1' AND input_snapshot ? 'numeric_descriptor'
    AND result_summary ? 'numeric_checkpoint' ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspace_id])).rows[0]?.id;
  const result=numeric_execution_id?await view(client,{...args,numeric_execution_id},{accepted,historical:true}):null;
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

async function insertReceipt(client:Queryable,args:{workspace_id:string;actor_user_id:string;idempotency_key:string},request_digest:string,body:Omit<SignalWorkspaceIncrementalEditorialReceiptV1,'grant_digest'>){
 const receipt={...body,grant_digest:digest(body)};
 await client.query(`INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,idempotency_key,request_digest,status,result,completed_at)
 VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,'completed',$7::jsonb,clock_timestamp())`,[receipt.operation_id,args.workspace_id,args.actor_user_id,
 receipt.action==='authorize_interpretation'?'authorize-interpretation':'revoke-interpretation',key(args.idempotency_key),request_digest,JSON.stringify(receipt)]);
 await client.query('UPDATE signal_topic_catalog_executions SET interpretation_admission_operation_id=$2::uuid WHERE id=$1::uuid',[receipt.execution_id,receipt.operation_id]);
 await client.query('SET CONSTRAINTS trg_workspace_incremental_editorial_complete IMMEDIATE');await client.query('SET CONSTRAINTS trg_workspace_incremental_editorial_complete DEFERRED');return receipt;
}
function replay(prior:{request_digest:string;result:SignalWorkspaceIncrementalEditorialReceiptV1},expected:string){if(prior.request_digest!==expected)return fail('idempotency_conflict');return{execution_id:prior.result.execution_id,receipt:prior.result,replayed:true};}
export async function beginSignalWorkspaceIncrementalEditorialV1(args:SignalWorkspaceIncrementalEditorialBeginArgsV1):Promise<SignalWorkspaceIncrementalEditorialResultV1>{
 return withSignalWorkspaceEngineTransactionV1(args.database,client=>beginSignalWorkspaceIncrementalEditorialWithClientV1(client,args));
}
/** Existing admission body, composed with an enqueue in the same transaction. */
export async function beginSignalWorkspaceIncrementalEditorialWithClientV1(client:PoolClient,args:SignalWorkspaceIncrementalEditorialBeginArgsV1):Promise<SignalWorkspaceIncrementalEditorialResultV1>{
 const numeric_execution_id=uuid(args.numeric_execution_id),expected_evidence_plan_artifact_id=uuid(args.expected_evidence_plan_artifact_id);key(args.idempotency_key);
 if(!Number.isSafeInteger(args.cap_micro_usd)||args.cap_micro_usd<=0||!canonicalDate(args.admission_not_after)
  ||![args.expected_numeric_checkpoint_digest,args.expected_target_unit_digest,args.expected_history_cut_digest].every(value=>hash.test(value)))return fail('request_invalid',422);
 const request_digest=digest({action:'begin_incremental_editorial',numeric_execution_id,expected_evidence_plan_artifact_id,expected_numeric_checkpoint_digest:args.expected_numeric_checkpoint_digest,
 expected_target_unit_digest:args.expected_target_unit_digest,expected_history_cut_digest:args.expected_history_cut_digest,cap_micro_usd:args.cap_micro_usd,admission_not_after:args.admission_not_after});

  await admin(client,args);const accepted=await request(client,args,args.idempotency_key);if(accepted)return replay(accepted,request_digest);
  const actor=(await client.query<{actor_user_id:string}>('SELECT actor_user_id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid',[numeric_execution_id,args.workspace_id])).rows[0];if(!actor)return fail('source_not_found',404);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-interpretation-budget:${actor.actor_user_id}`]);
  const raced=await request(client,args,args.idempotency_key);if(raced)return replay(raced,request_digest);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  await client.query('SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE',[args.workspace_id]);
  await client.query('SELECT id FROM signal_topic_catalog_executions WHERE id=$1::uuid FOR UPDATE',[numeric_execution_id]);
  const preview=await view(client,{...args,numeric_execution_id});if(!preview.target_unit_digest||!preview.target_binding_digest)return fail('evidence_required');if(!preview.can_authorize)return fail(preview.blocked_reason?.replace('workspace_incremental_editorial_','')??'unavailable');
  if(preview.evidence_plan_artifact_id!==expected_evidence_plan_artifact_id||preview.numeric_checkpoint_digest!==args.expected_numeric_checkpoint_digest||preview.target_unit_digest!==args.expected_target_unit_digest||preview.history_cut_digest!==args.expected_history_cut_digest)return fail('source_changed');
  const now=(await client.query<{now:string}>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`)).rows[0]!.now;
  if(args.cap_micro_usd>preview.maximum_grant_micro_usd||Date.parse(args.admission_not_after)<=Date.parse(now)||Date.parse(args.admission_not_after)>Date.parse(preview.maximum_admission_not_after))return fail('cap_or_deadline_invalid');
  const numeric=await source(client,{...args,numeric_execution_id});const execution_id=randomUUID();
  const snapshot={contract_version:'workspace-incremental-editorial-v1',execution_id,workspace_id:args.workspace_id,numeric_execution_id,
   numeric_checkpoint_digest:preview.numeric_checkpoint_digest,population_digest:numeric.checkpoint.population_digest,input_revision:numeric.input_revision,
   context_digest:numeric.input_snapshot.context_digest,catalog_input_digest:numeric.input_snapshot.catalog_digest,
   model_bank_artifact_id:numeric.checkpoint.model_bank_artifact_id,model_bank_sha256:numeric.bank_sha256,census_derivation_digest:numeric.census,
   expected_units:preview.expected_units,target_units:preview.target_units,target_unit_digest:preview.target_unit_digest,history_cut_digest:preview.history_cut_digest,
   interpretation_configuration:SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,budget_policy:numeric.policy,
   budget_actor_user_id:numeric.actor_user_id,authorized_by_user_id:args.actor_user_id,claude_cap_micro_usd:args.cap_micro_usd};
  const plan=(await client.query<{metadata:{evidence_digest:string}}>('SELECT metadata FROM analysis_artifacts WHERE id=$1::uuid',[expected_evidence_plan_artifact_id])).rows[0]!;
  const sealedSnapshot={...snapshot,evidence_plan_artifact_id:expected_evidence_plan_artifact_id,evidence_digest:plan.metadata.evidence_digest,target_binding_digest:preview.target_binding_digest};
  const input_digest=digest(sealedSnapshot);
  await client.query(`INSERT INTO signal_topic_catalog_executions(id,workspace_id,taxonomy_profile_id,actor_user_id,intent,idempotency_key,request_digest,
   population_digest,identity_catalog_digest,definition_digest,denominator,embedding_model,input_contract,source_execution_id,
   embedding_run_id,preparation_run_id,input_revision,embedding_config_digest,input_snapshot,input_digest,policy_valid_until,expected_chunks,result_summary)
  SELECT $1::uuid,workspace_id,$2::uuid,actor_user_id,'search',$3,$4,$5,identity_catalog_digest,definition_digest,denominator,embedding_model,'workspace-incremental-editorial-v1',id,
   embedding_run_id,preparation_run_id,input_revision,embedding_config_digest,$6::jsonb,$7,policy_valid_until,expected_chunks,'{"phase":"admitted","analysis_complete":false,"provider_enabled":false}'::jsonb
  FROM signal_topic_catalog_executions WHERE id=$8::uuid`,[execution_id,numeric.profile_id,key(args.idempotency_key),request_digest,numeric.checkpoint.population_digest,JSON.stringify(sealedSnapshot),input_digest,numeric_execution_id]);
  const authority=`sha256:${createHash('sha256').update(`${input_digest}:${execution_id}`).digest('hex')}`;
  const claims=await client.query(`INSERT INTO analysis_artifacts(workspace_id,engine_execution_id,artifact_key,artifact_type,title,content,metadata,workspace_artifact_kind,discovery_run_digest,workspace_authority_digest)
   SELECT $1::uuid,$2::uuid,'incremental-editorial-claim-'||substring(workspace_incremental_editorial_digest_v1(jsonb_build_array(units.identity->>'component_key',units.identity->'unit'->>'unit_key')) FROM 8),
   'engine_output','Incremental editorial unit ownership',census.content,
   units.identity||jsonb_build_object('contract_version','workspace-incremental-editorial-unit-claim-v1','numeric_execution_id',$3::text,'owner_execution_id',$2::text,
   'census_artifact_id',units.census_artifact_id::text,'component_artifact_id',units.component_artifact_id::text,'target_unit_digest',$4::text),'topic_discovery',$5,$5
   FROM workspace_incremental_editorial_units_v1($3::uuid) units JOIN analysis_artifacts census ON census.id=units.census_artifact_id WHERE units.emergent AND units.claimed_by IS NULL AND EXISTS(SELECT 1 FROM analysis_artifacts plan_unit WHERE plan_unit.metadata->>'plan_artifact_id'=$6::text AND plan_unit.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND plan_unit.metadata->>'census_artifact_id'=units.census_artifact_id::text AND plan_unit.metadata->'unit'->>'status'='evidence_ready')`,
   [args.workspace_id,execution_id,numeric_execution_id,preview.target_unit_digest,authority,expected_evidence_plan_artifact_id]);
  if(claims.rowCount!==preview.target_units)return fail('claims_changed');
  const receipt=await insertReceipt(client,args,request_digest,{contract_version:'workspace-incremental-editorial-admission-v1',operation_id:randomUUID(),execution_id,workspace_id:args.workspace_id,
   action:'authorize_interpretation',prior_admission_operation_id:null,authorized_by_user_id:args.actor_user_id,budget_actor_user_id:numeric.actor_user_id,input_digest,numeric_execution_id,
   numeric_checkpoint_digest:preview.numeric_checkpoint_digest,target_unit_digest:preview.target_unit_digest,target_binding_digest:preview.target_binding_digest,evidence_plan_artifact_id:expected_evidence_plan_artifact_id,configuration_digest:digest(snapshot.interpretation_configuration),
   budget_timezone:preview.budget_timezone,budget_date:preview.budget_date,authorized_at:now,admission_not_after:args.admission_not_after,
   grant_cap_micro_usd:args.cap_micro_usd,run_cap_micro_usd:args.cap_micro_usd,daily_cap_micro_usd:preview.daily_cap_micro_usd});
  return{execution_id,receipt,replayed:false};

}
export async function revokeSignalWorkspaceIncrementalEditorialV1(args:SignalWorkspaceIncrementalEditorialRevokeArgsV1):Promise<SignalWorkspaceIncrementalEditorialResultV1>{
 const execution_id=uuid(args.execution_id),expected=uuid(args.expected_admission_operation_id);key(args.idempotency_key);
 const request_digest=digest({action:'revoke_incremental_editorial',execution_id,expected_admission_operation_id:expected});
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  await admin(client,args);const accepted=await request(client,args,args.idempotency_key);if(accepted)return replay(accepted,request_digest);
  const scope=(await client.query<{actor_user_id:string}>('SELECT actor_user_id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract=\'workspace-incremental-editorial-v1\'',[execution_id,args.workspace_id])).rows[0];if(!scope)return fail('not_found',404);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-interpretation-budget:${scope.actor_user_id}`]);
  const raced=await request(client,args,args.idempotency_key);if(raced)return replay(raced,request_digest);
  const row=(await client.query<{operation_id:string;receipt:SignalWorkspaceIncrementalEditorialReceiptV1}>('SELECT interpretation_admission_operation_id operation_id,workspace_interpretation_admission_receipt_v1(id) receipt FROM signal_topic_catalog_executions WHERE id=$1::uuid FOR UPDATE',[execution_id])).rows[0]!;
  if(row.operation_id!==expected||row.receipt?.action!=='authorize_interpretation')return fail('admission_changed');
  const now=(await client.query<{now:string}>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`)).rows[0]!.now;
  const {grant_digest:_digest,...prior}=row.receipt;
  const receipt=await insertReceipt(client,args,request_digest,{...prior,operation_id:randomUUID(),action:'revoke_interpretation',authorized_by_user_id:args.actor_user_id,prior_admission_operation_id:expected,authorized_at:now,grant_cap_micro_usd:0});
  return{execution_id,receipt,replayed:false};
 });
}

export type SignalWorkspaceIncrementalEditorialEvidenceUnitV1={unit_key:string;component_key:string;local_label:number;birth_membership_digest:string;
 model_origin:{execution_id:string;model_artifact_sha256:string};lane:'open'|'guided';
 status:'already_interpreted'|'editorial_claimed'|'legacy_full_fit'|'no_current_members'|'evidence_ready';root_count:number;chunk_count:number;cluster_digest:string};
export type SignalWorkspaceIncrementalEditorialEvidenceV1={contract_version:'workspace-incremental-editorial-evidence-stream-v1';numeric_execution_id:string;
 numeric_checkpoint_digest:string;numeric_manifest_sha256:string;population_digest:string;representative_selection_policy:'distinct-roots-affiliation-boundary-v1';
 census:{roots:number;chunks:number;memberships:number;pending_roots:number;pending_occurrences:number;expected_unit_count:number;expected_unit_digest:string;population_digest:string};
 numeric_component_order:string[];origins:Array<{execution_id:string;manifest_sha256:string;candidate_sha256:string}>;units:SignalWorkspaceIncrementalEditorialEvidenceUnitV1[];
 target_unit_digest:string;target_binding_digest:string;stream:{contract_version:'workspace-incremental-editorial-evidence-jsonl-v1';rows:number;bytes:number;sha256:string};evidence_digest:string};
export type SignalWorkspaceIncrementalEditorialEvidenceArgsV1=SignalWorkspaceIncrementalEditorialScopeV1&{evidence:SignalWorkspaceIncrementalEditorialEvidenceV1;
 stored:{storage_key:string;sha256:string;size_bytes:number;media_type:string}};
/** Server-only adapter boundary: the caller supplies the descriptor returned after
 * complete SHA/EOF validation and verified upload. No browser route accepts it. */
export async function persistSignalWorkspaceIncrementalEditorialEvidenceV1(args:SignalWorkspaceIncrementalEditorialEvidenceArgsV1){
 return withSignalWorkspaceEngineTransactionV1(args.database,client=>persistSignalWorkspaceIncrementalEditorialEvidenceWithClientV1(client,args));
}
/** Same 0148 validation and locks, allowing a preparation receipt to commit atomically. */
export async function persistSignalWorkspaceIncrementalEditorialEvidenceWithClientV1(client:PoolClient,args:SignalWorkspaceIncrementalEditorialEvidenceArgsV1){
 const evidence=args.evidence,{evidence_digest,...unsigned}=evidence;
 if(!Array.isArray(evidence.units)||evidence.units.some(unit=>![unit.root_count,unit.chunk_count,unit.local_label].every(n=>Number.isSafeInteger(n)&&n>=0)
  ||unit.chunk_count<unit.root_count||(unit.chunk_count===0)!==(unit.root_count===0))
  ||![evidence.census.roots,evidence.census.chunks,evidence.census.memberships,evidence.census.pending_roots,evidence.census.pending_occurrences,evidence.census.expected_unit_count,evidence.stream.rows,evidence.stream.bytes].every(n=>Number.isSafeInteger(n)&&n>=0))return fail('evidence_invalid',422);
 if(evidence.contract_version!=='workspace-incremental-editorial-evidence-stream-v1'||evidence.numeric_execution_id!==uuid(args.numeric_execution_id)
  ||evidence.representative_selection_policy!=='distinct-roots-affiliation-boundary-v1'||evidence.stream.contract_version!=='workspace-incremental-editorial-evidence-jsonl-v1'
  ||digest(unsigned)!==evidence_digest||args.stored.sha256!==evidence.stream.sha256||args.stored.size_bytes!==evidence.stream.bytes
  ||!hash.test(args.stored.sha256)||!Number.isSafeInteger(args.stored.size_bytes)||args.stored.size_bytes<0||args.stored.media_type.length>120
  ||!args.stored.storage_key.startsWith(`workspace-engine/${args.workspace_id}/${evidence.numeric_execution_id}/`)||args.stored.storage_key.includes('..')
  ||Buffer.byteLength(JSON.stringify(evidence))>8*1024*1024)return fail('evidence_invalid',422);

  await admin(client,args);await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  await client.query('SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE',[args.workspace_id]);
  const numeric=await source(client,args),identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,...args});
  if(!numeric.valid||numeric.checkpoint.checkpoint_digest!==evidence.numeric_checkpoint_digest||identity.context_digest!==numeric.input_snapshot.context_digest||identity.catalog_digest!==numeric.input_snapshot.catalog_digest)return fail('source_stale');
  const content={contract_version:'workspace-engine-private-artifact-v1',...args.stored};
  const prior=(await client.query<{id:string;content:unknown}>(`SELECT id,content FROM analysis_artifacts WHERE workspace_id=$1::uuid AND metadata->>'numeric_execution_id'=$2::text
   AND metadata->>'contract_version'='workspace-incremental-editorial-plan-v1' AND metadata->>'evidence_digest'=$3`,[args.workspace_id,evidence.numeric_execution_id,evidence_digest])).rows[0];
  if(prior){if(digest(prior.content)!==digest(content))return fail('evidence_conflict');return{artifact_id:prior.id,evidence_digest,replayed:true};}
  const plan_id=randomUUID(),known=(await client.query<{census_artifact_id:string;identity:{unit:{unit_key:string}}}>('SELECT census_artifact_id,identity FROM workspace_incremental_editorial_units_v1($1::uuid)',[evidence.numeric_execution_id])).rows;
  const byUnit=new Map(known.map(row=>[row.identity.unit.unit_key,row.census_artifact_id]));
  if(known.length!==evidence.units.length||known.length!==byUnit.size)return fail('census_incomplete');
  const base={plan_artifact_id:plan_id,numeric_execution_id:evidence.numeric_execution_id,actor_user_id:args.actor_user_id,evidence_digest};
  for(let offset=0;offset<evidence.units.length;offset+=128){
   const rows=evidence.units.slice(offset,offset+128).map(unit=>({...base,contract_version:'workspace-incremental-editorial-plan-unit-v1',unit,census_artifact_id:byUnit.get(unit.unit_key)}));
   if(rows.some(row=>!row.census_artifact_id))return fail('unit_invalid');
   await client.query(`INSERT INTO analysis_artifacts(workspace_id,source_entity_type,source_entity_id,artifact_key,artifact_type,title,content,metadata,workspace_artifact_kind,discovery_run_digest,workspace_authority_digest)
    SELECT $1::uuid,NULL,NULL,'incremental-editorial-plan-unit-'||$3||'-'||substring(workspace_incremental_editorial_digest_v1(to_jsonb(row->'unit'->>'unit_key')) FROM 8),
    'engine_output','Incremental editorial evidence census',$4::jsonb,row,'topic_discovery',$5,$5 FROM jsonb_array_elements($6::jsonb) row WHERE row->>'numeric_execution_id'=$2::text`,
    [args.workspace_id,evidence.numeric_execution_id,plan_id,JSON.stringify(content),evidence_digest,JSON.stringify(rows)]);
  }
  const {units:_units,...descriptor}=evidence;
  const metadata={...base,contract_version:'workspace-incremental-editorial-plan-v1',history_cut_digest:numeric.history,descriptor};
  await client.query(`INSERT INTO analysis_artifacts(id,workspace_id,source_entity_type,source_entity_id,artifact_key,artifact_type,title,content,metadata,workspace_artifact_kind,discovery_run_digest,workspace_authority_digest)
   VALUES($1::uuid,$2::uuid,NULL,NULL,$4,'engine_output','Incremental editorial evidence plan',$5::jsonb,$6::jsonb||jsonb_build_object('numeric_execution_id',$3::text),'topic_discovery',$7,$7)`,
   [plan_id,args.workspace_id,evidence.numeric_execution_id,`incremental-editorial-plan-${evidence_digest.slice(7)}`,JSON.stringify(content),JSON.stringify(metadata),evidence_digest]);
  if(!(await client.query<{valid:boolean}>('SELECT workspace_incremental_editorial_plan_valid_v1($1::uuid) valid',[plan_id])).rows[0]?.valid)return fail('evidence_invalid');
  await client.query('SET CONSTRAINTS trg_workspace_incremental_editorial_plan_complete IMMEDIATE');await client.query('SET CONSTRAINTS trg_workspace_incremental_editorial_plan_complete DEFERRED');
  return{artifact_id:plan_id,evidence_digest,replayed:false};

}
