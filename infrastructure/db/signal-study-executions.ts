import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {StudyRuntimeLeaseV1,StudyRuntimeSourceV1} from '../../services/workers/src/workers/signal-study-runtime';
import {studyTransactionV1,studyAuthorizeV1,studyPolicyLockV1,studyConfigurationWithClientV1,studyDigestV1 as digest,studyFailV1 as fail,studyUuidV1,
 type StudyAccessV1,type StudyDatabaseV1,type SignalStudyExecutionRecordV1} from './signal-study-core';
import {prepareSignalStudySourceWithClientV1,readSignalStudySourceWithClientV1} from './signal-study-source';
import {mapCurrent} from './signal-mass-labeling';
export async function requestSignalStudyExecutionV1(args:StudyAccessV1&{configuration_id:string;idempotency_key:string;cap_micro_usd:number;
 query_terms?:string[];problem_terms?:string[]}){
 if(!studyUuidV1.test(args.configuration_id)||!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)||!Number.isSafeInteger(args.cap_micro_usd)||args.cap_micro_usd<=0)fail('request_invalid',422);
 for(const terms of [args.query_terms??[],args.problem_terms??[]])if(terms.length>500||terms.some(v=>typeof v!=='string'||!v.trim()||v.length>240))fail('query_metadata_invalid',422);
 return studyTransactionV1(args.database,async c=>{
  await studyAuthorizeV1(c,args,'view');const policy=await studyPolicyLockV1(c,args.workspace_id);
  if(policy.max_execution_micro_usd!==null&&BigInt(args.cap_micro_usd)>BigInt(policy.max_execution_micro_usd))fail('policy_cap_exceeded');
  const cfg=await studyConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);if(!cfg)fail('configuration_unavailable');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-study-config:'||$1,0))",[cfg.study_id]);await studyAuthorizeV1(c,args,'process');
  if((await c.query('SELECT id FROM signal_study_configurations WHERE study_id=$1 ORDER BY revision DESC LIMIT 1',[cfg.study_id])).rows[0]?.id!==cfg.id)fail('configuration_changed');
  if(!(await c.query("SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='mass_labeling_jev' AND provider='typesafe' AND model='jev-1.13.0' AND configuration='{\"contract_version\":\"mass-labeling-jev-v2\",\"provider\":\"typesafe\",\"model\":\"jev-1.13.0\"}'::jsonb",[policy.id])).rows.length)fail('jev_policy_unavailable');
  const metadata={query_terms:args.query_terms??[],problem_terms:args.problem_terms??[]},request_digest=digest({contract_version:'signal-study-execution-v1',configuration_id:cfg.id,configuration_digest:cfg.configuration_digest,cap_micro_usd:args.cap_micro_usd,metadata});
  const old=(await c.query<SignalStudyExecutionRecordV1&{request_digest:string}>('SELECT * FROM signal_study_executions WHERE workspace_id=$1 AND actor_user_id=$2 AND idempotency_key=$3',[args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
  if(old){if(old.request_digest!==request_digest)fail('idempotency_conflict');return old;}
  if((await c.query("SELECT 1 FROM signal_study_executions WHERE study_id=$1 AND status IN('building','queued','running','outcome_unknown')",[cfg.study_id])).rows.length)fail('already_active');
  const snapshot=(await c.query<{map_id:string;current:boolean}>(`SELECT s.map_id,signal_listening_discovery_source_current_v1(s.generation_id) current FROM signal_study_configuration_sources_v1 s WHERE s.study_configuration_id=$1 AND s.workspace_id=$2`,[cfg.id,args.workspace_id])).rows[0];
  if(!snapshot?.current)fail('listening_source_unavailable');const map=await mapCurrent(c,args.workspace_id,snapshot.map_id);
  const id=randomUUID(),ready=await prepareSignalStudySourceWithClientV1(c,cfg,id,metadata),{roots:_roots,source_digest:_digest,...header}=ready.source;
  await c.query(`INSERT INTO signal_study_executions(id,workspace_id,organization_id,study_id,configuration_id,actor_user_id,policy_version_id,configuration_digest,human_revision_digest,
   entity_context_digest,map_id,cap_micro_usd,idempotency_key,request_digest,source_header,source_roots,source_bytes)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,[id,args.workspace_id,policy.organization_id,cfg.study_id,cfg.id,args.actor_user_id,policy.id,cfg.configuration_digest,cfg.human_revision_digest,map.entity_context_digest,map.id,args.cap_micro_usd,args.idempotency_key,request_digest,JSON.stringify(header),ready.records.length,ready.working_bytes]);
  if(ready.records.length)await c.query(`INSERT INTO signal_study_source_roots(execution_id,workspace_id,root_id,map_id,input_digest,asset_sha256,chunk_policy_version,chunk_sha256,chunk_index,start_offset,end_offset,embedding_config_digest,embedding_call_id,embedding_run_id,
   native_vector_sha256,base_cache,attributes,listening_topic_keys,question_cache_ids,occurred_at,channel,source_url,private_person_names,proof_json,proof_digest)
   SELECT $1,$2,x.root_id,$3,x.input_digest,x.asset_sha256,x.chunk_policy_version,x.chunk_sha256,x.chunk_index,x.start_offset,x.end_offset,x.embedding_config_digest,x.embedding_call_id,x.embedding_run_id,x.native_vector_sha256,
   x.base_cache,x.attributes,x.listening_topic_keys,x.question_cache_ids,x.occurred_at,x.channel,x.source_url,x.private_person_names,x.proof_json,x.proof_digest
   FROM jsonb_to_recordset($4::jsonb)x(root_id uuid,input_digest text,asset_sha256 text,chunk_policy_version text,chunk_sha256 text,chunk_index integer,start_offset integer,end_offset integer,embedding_config_digest text,embedding_call_id uuid,embedding_run_id uuid,
    native_vector_sha256 text,base_cache jsonb,attributes jsonb,listening_topic_keys text[],question_cache_ids uuid[],occurred_at timestamptz,channel text,source_url text,private_person_names text[],proof_json text,proof_digest text)`,
   [id,args.workspace_id,map.id,JSON.stringify(ready.records.map(({row,proof_json,proof_digest})=>{const{full_text:_text,fragment:_fragment,vector_json,...saved}=row;return{...saved,native_vector_sha256:JSON.parse(proof_json).embedding_sha256,proof_json,proof_digest};}))]);
  await c.query('ANALYZE signal_study_source_roots');
  await c.query("SELECT set_config('noisia.study_source_verified_v1',$1,true)",[JSON.stringify({execution_id:id,source_digest:ready.source.source_digest,source_census_digest:ready.census})]);
  return(await c.query<SignalStudyExecutionRecordV1>("UPDATE signal_study_executions SET source_digest=$2,source_census_digest=$3,status='queued' WHERE id=$1 RETURNING *",[id,ready.source.source_digest,ready.census])).rows[0]!;
 });
}
export function validateSignalStudyLeaseV1(lease:StudyRuntimeLeaseV1){
 if(!lease||![lease.execution_id,lease.workspace_id,lease.execution_token].every(v=>studyUuidV1.test(v))||![lease.source_digest,lease.configuration_digest,lease.human_revision_digest].every(v=>/^sha256:[a-f0-9]{64}$/u.test(v)))fail('lease_invalid',422);
}
/** Money/policy -> Study configuration -> mutable actor -> parent CAS. */
export async function lockSignalStudyExecutionWithClientV1(c:PoolClient,lease:StudyRuntimeLeaseV1,current:boolean|'owner'=true){
 validateSignalStudyLeaseV1(lease);
 const scope=(await c.query<SignalStudyExecutionRecordV1>('SELECT * FROM signal_study_executions WHERE id=$1 AND workspace_id=$2',[lease.execution_id,lease.workspace_id])).rows[0];if(!scope)fail('execution_unavailable');
 if(current)await studyPolicyLockV1(c,scope.workspace_id,scope.policy_version_id);
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-study-config:'||$1,0))",[scope.study_id]);
 if(current)await studyAuthorizeV1(c,scope,'process');
 const p=(await c.query<SignalStudyExecutionRecordV1&{live:boolean}>(`WITH locked AS MATERIALIZED(SELECT * FROM signal_study_executions WHERE id=$1 AND workspace_id=$2 FOR UPDATE)
  SELECT locked.*,execution_token=$3::uuid AND execution_expires_at>clock_timestamp() live FROM locked`,[lease.execution_id,lease.workspace_id,lease.execution_token])).rows[0]!;
 if(!p.live||p.source_digest!==lease.source_digest||p.configuration_digest!==lease.configuration_digest||p.human_revision_digest!==lease.human_revision_digest)fail('lease_lost');
 if(current&&(p.status!=='running'||!(await c.query<{current:boolean}>(current==='owner'?'SELECT signal_study_owner_current_v1($1) current':'SELECT signal_study_source_current_v1($1) current',[p.id])).rows[0]?.current))fail('source_changed');
 return p;
}
export async function claimSignalStudyExecutionV1(args:{database:StudyDatabaseV1;execution_id:string}):Promise<StudyRuntimeLeaseV1|null>{
 if(!studyUuidV1.test(args.execution_id))fail('execution_invalid',422);
 return studyTransactionV1(args.database,async c=>{
  const scope=(await c.query<SignalStudyExecutionRecordV1>('SELECT * FROM signal_study_executions WHERE id=$1',[args.execution_id])).rows[0];if(!scope||!['queued','running','outcome_unknown'].includes(scope.status))return null;
  try{await studyPolicyLockV1(c,scope.workspace_id,scope.policy_version_id);await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-study-config:'||$1,0))",[scope.study_id]);await studyAuthorizeV1(c,scope,'process');await mapCurrent(c,scope.workspace_id,scope.map_id);}
  catch(error){if(error instanceof Error&&/study_(policy_unavailable|forbidden|not_enabled)|mass_labeling_(map_stale|context_changed)/u.test(error.message)){await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-study-config:'||$1,0))",[scope.study_id]);await c.query("UPDATE signal_study_executions SET status='stale',error_code='study_authority_changed' WHERE id=$1 AND status IN('queued','running','outcome_unknown')",[scope.id]);return null;}throw error;}
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-study-config:'||$1,0))",[scope.study_id]);
  const row=(await c.query<SignalStudyExecutionRecordV1&{held:boolean}>(`WITH locked AS MATERIALIZED(SELECT * FROM signal_study_executions WHERE id=$1 FOR UPDATE)
   SELECT locked.*,execution_token IS NOT NULL AND execution_expires_at>clock_timestamp() held FROM locked`,[scope.id])).rows[0]!;
  if(row.held||!['queued','running','outcome_unknown'].includes(row.status)||!(await c.query<{current:boolean}>('SELECT signal_study_source_current_v1($1) current',[row.id])).rows[0]?.current)return null;
  if((await c.query<{blocked:boolean}>(`SELECT EXISTS(SELECT 1 FROM signal_study_steps s JOIN engine_cost_events call ON call.study_step_id=s.id JOIN signal_study_receipts raw ON raw.step_id=s.id AND raw.verification_status='verified'
   WHERE s.execution_id=$1 AND s.status='unknown' AND(call.call_state='outcome_unknown' OR s.error_code='study_response_invalid')) blocked`,[row.id])).rows[0]?.blocked)return null;
  const ambiguous=(await c.query<{blocked:boolean}>(`SELECT EXISTS(SELECT 1 FROM signal_study_steps s JOIN engine_cost_events call ON call.study_step_id=s.id WHERE s.execution_id=$1 AND(s.status='unknown' AND s.error_code='study_response_invalid' OR call.call_state IN('in_flight','outcome_unknown') AND call.response_storage_key IS NULL)) blocked`,[row.id])).rows[0]!.blocked;
  if(ambiguous){await c.query("UPDATE engine_cost_events SET call_state='outcome_unknown' WHERE study_step_id IN(SELECT id FROM signal_study_steps WHERE execution_id=$1) AND call_state='in_flight' AND response_storage_key IS NULL",[row.id]);await c.query("UPDATE signal_study_steps SET status='unknown',error_code=COALESCE(error_code,'study_send_ack_unknown') WHERE execution_id=$1 AND status='sent'",[row.id]);await c.query("UPDATE signal_study_executions SET status='outcome_unknown',error_code='study_send_ack_unknown' WHERE id=$1",[row.id]);return null;}
  const token=randomUUID();await c.query("UPDATE signal_study_executions SET status='running',execution_token=$2,execution_expires_at=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp() WHERE id=$1",[row.id,token]);
  return{execution_id:row.id,workspace_id:row.workspace_id,execution_token:token,source_digest:row.source_digest,configuration_digest:row.configuration_digest,human_revision_digest:row.human_revision_digest};
 });
}
export async function renewSignalStudyExecutionV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1}){
 try{return await studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,args.lease);await c.query("UPDATE signal_study_executions SET execution_expires_at=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp() WHERE id=$1",[p.id]);return true;});}
 catch(error){if(error instanceof Error&&/^study_(lease_lost|source_changed|policy_unavailable|forbidden|not_enabled)$/u.test(error.message))return false;throw error;}
}
export async function releaseSignalStudyExecutionV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1}){
 validateSignalStudyLeaseV1(args.lease);await args.database.query('UPDATE signal_study_executions SET execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND workspace_id=$2 AND execution_token=$3',[args.lease.execution_id,args.lease.workspace_id,args.lease.execution_token]);
}
export async function readSignalStudyRuntimeSourceV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1}):Promise<StudyRuntimeSourceV1|null>{
 try{return await studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,args.lease);return readSignalStudySourceWithClientV1(c,p);});}
 catch(error){if(error instanceof Error&&/^study_(lease_lost|source_changed|policy_unavailable|forbidden|not_enabled)$/u.test(error.message))return null;throw error;}
}
export async function pendingSignalStudyExecutionsV1(args:{database:StudyDatabaseV1;limit?:number}){
 const limit=args.limit??20;if(!Number.isInteger(limit)||limit<1||limit>200)fail('limit_invalid',422);
 return(await args.database.query<{execution_id:string}>(`SELECT p.id execution_id FROM signal_study_executions p WHERE(
  p.status IN('queued','running','outcome_unknown') AND(p.execution_token IS NULL OR p.execution_expires_at<=clock_timestamp())
  AND(p.status<>'outcome_unknown' OR EXISTS(SELECT 1 FROM signal_study_steps s JOIN signal_study_receipts r ON r.step_id=s.id WHERE s.execution_id=p.id AND r.verification_status='planned'))
  AND(p.status IN('queued','running') OR signal_study_owner_current_v1(p.id) OR EXISTS(SELECT 1 FROM signal_study_steps s JOIN signal_study_receipts r ON r.step_id=s.id JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=p.id AND(c.call_state IN('in_flight','response_persisted') OR r.verification_status='planned')))
  AND NOT EXISTS(SELECT 1 FROM signal_study_steps s JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=p.id AND(c.call_state='outcome_unknown' AND NOT EXISTS(SELECT 1 FROM signal_study_receipts r WHERE r.step_id=s.id AND r.verification_status='planned') OR s.error_code='study_response_invalid'))
 ) OR(p.status IN('stale','failed','budget_exhausted') AND EXISTS(SELECT 1 FROM signal_study_steps s JOIN engine_cost_events c ON c.study_step_id=s.id LEFT JOIN signal_study_receipts r ON r.step_id=s.id WHERE s.execution_id=p.id AND(c.call_state='reserved' AND c.sent_at IS NULL OR c.call_state='response_persisted' OR r.verification_status='planned')))
 ORDER BY p.created_at,p.id LIMIT $1`,[limit])).rows;
}
