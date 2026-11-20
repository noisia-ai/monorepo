import type {PoolClient} from 'pg';
import {authorizeSignalListeningV1,listeningTransactionV1,listeningFailV1,type SignalListeningAccessV1} from './signal-listening-configuration';
import {signalWorkspaceEmbeddingDigestV1 as digest,type SignalStudyExecutionConfigurationV1} from '@noisia/query-engine';
export type StudyAccessV1=SignalListeningAccessV1;
export type StudyDatabaseV1=StudyAccessV1['database'];
export type SignalStudyConfigurationRecordV1={id:string;workspace_id:string;study_id:string;revision:number;envelope:SignalStudyExecutionConfigurationV1;
 configuration_digest:string;human_revision_digest:string;provenance:'human'|'agent';listening_snapshot_id:string;listening_source_kind?:'serving'|'human_edit'|null;listening_source_id?:string|null;listening_generation_id?:string|null;listening_source_digest?:string|null;listening_human_edit_id?:string|null;listening_configuration_id:string;listening_configuration_digest:string};
export type SignalStudyExecutionRecordV1={id:string;workspace_id:string;organization_id:string;study_id:string;configuration_id:string;actor_user_id:string;
 policy_version_id:string;configuration_digest:string;human_revision_digest:string;entity_context_digest:string;map_id:string;cap_micro_usd:string;
 source_header:Record<string,unknown>;source_digest:string;source_census_digest:string;source_roots:number;source_bytes:string;
 status:'building'|'queued'|'running'|'outcome_unknown'|'stale'|'budget_exhausted'|'completed'|'failed';execution_token:string|null;execution_expires_at:Date|string|null;error_code:string|null};
export const studyDigestV1=digest;
export function studyFailV1(code:string,status=409):never{return listeningFailV1('study_'+code,status);}
export const studyUuidV1=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
export async function studyTransactionV1<T>(db:StudyDatabaseV1,fn:(c:PoolClient)=>Promise<T>){return listeningTransactionV1(db,async c=>{await c.query('SET LOCAL search_path=public,extensions,pg_temp');return fn(c);});}
export async function studyAuthorizeV1(c:Pick<PoolClient,'query'>,a:Omit<StudyAccessV1,'database'>,mode:'view'|'edit'|'process'='view'){
 try{return await authorizeSignalListeningV1(c,a,mode);}catch(error){if(error instanceof Error&&error.message==='listening_forbidden')studyFailV1('forbidden',403);if(error instanceof Error&&error.message==='listening_not_enabled')studyFailV1('not_enabled',404);throw error;}
}
export async function studyPolicyLockV1(c:PoolClient,workspace:string,policyId?:string){
 const scope=(await c.query<{organization_id:string}>('SELECT organization_id FROM signal_workspaces WHERE id=$1',[workspace])).rows[0];if(!scope)studyFailV1('scope_invalid');
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[scope.organization_id]);
 const p=(await c.query<{id:string;organization_id:string;budget_timezone:string;daily_cap_micro_usd:string|null;max_execution_micro_usd:string|null}>(`SELECT p.id,p.organization_id,p.budget_timezone,p.daily_cap_micro_usd::text,a.max_execution_micro_usd::text
 FROM signal_processing_policy_versions p JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id AND a.action='study_analysis'
 WHERE p.organization_id=$1 AND p.status='active' AND p.valid_from<=clock_timestamp() AND p.valid_until>clock_timestamp()
 AND a.provider='anthropic' AND a.model='claude-sonnet-4-6' AND a.configuration=signal_study_analysis_configuration_v1()`,[scope.organization_id])).rows[0];
 if(!p||policyId&&p.id!==policyId)studyFailV1('policy_unavailable');await c.query('SELECT signal_processing_lock_v1($1,(clock_timestamp() AT TIME ZONE $2)::date)',[p.organization_id,p.budget_timezone]);return p;
}
export async function studyConfigurationWithClientV1(c:Pick<PoolClient,'query'>,workspace:string,id:string){
 return(await c.query<SignalStudyConfigurationRecordV1>('SELECT * FROM signal_study_configurations WHERE workspace_id=$1 AND id=$2',[workspace,id])).rows[0]??null;
}
