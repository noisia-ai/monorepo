import type {Pool} from 'pg';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1} from '@noisia/query-engine';
import {readMfpPolicySwitchBlockersV1} from './signal-labeling-policy-action-switch';
import {signalClassicPolicyCompletionConfigurationV1} from './signal-classic-processing-configuration';

type Args={database:Pick<Pool,'connect'>;workspace_id:string;brand_id:string;actor_user_id:string;env?:Record<string,string|undefined>};
type Status='provisioned'|'existing_policy'|'configuration_required'|'not_eligible'|'active_work';
export type SignalClassicPolicyCompletionV1={contract_version:'classic-policy-completion-v1';status:Status};
const result=(status:Status):SignalClassicPolicyCompletionV1=>({contract_version:'classic-policy-completion-v1',status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const required=['brand_context_proposal','topic_prototype_embeddings'] as const;

/** Explicit server-owned completion, separate from creation replay. A live actor
 * acts as themselves; this never impersonates the original brand creator. */
export async function completeSignalClassicPolicyV1(args:Args):Promise<SignalClassicPolicyCompletionV1>{
 if(![args.workspace_id,args.brand_id,args.actor_user_id].every(value=>uuid.test(value)))return result('not_eligible');
 const client=await args.database.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const commit=async(status:Status)=>{await client.query('COMMIT');return result(status);};
  const scope=(await client.query<{organization_id:string}>(`SELECT organization_id::text FROM signal_workspaces WHERE id=$1 AND brand_id=$2`,
   [args.workspace_id,args.brand_id])).rows[0];
  if(!scope)return await commit('not_eligible');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::uuid::text,0))",[scope.organization_id]);
  const capabilities=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,lock_authority:true});
  const actor=(await client.query(`SELECT id FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal'
   AND primary_role IN('noisia_admin','founder','admin') FOR SHARE`,[args.actor_user_id])).rows[0];
  if(!actor||!capabilities.can_request_processing)return await commit('not_eligible');
  const prior=(await client.query<{id:string;status:string;version:string;valid_until:string;daily_cap_micro_usd:string|null;budget_timezone:string}>(`
   SELECT id::text,status,version::text,valid_until::text,daily_cap_micro_usd::text,budget_timezone
   FROM signal_processing_policy_versions WHERE organization_id=$1 ORDER BY version DESC LIMIT 1`,[scope.organization_id])).rows[0];
  if(!prior||prior.status!=='active')return await commit('configuration_required');
  const existing=(await client.query<{action:string}>('SELECT action FROM signal_processing_policy_actions WHERE policy_version_id=$1',[prior.id])).rows;
  const missing=required.filter(action=>!existing.some(row=>row.action===action));
  if(!missing.length)return await commit('existing_policy');
  // A terminal run can still hold a paid response awaiting free application.
  // Keep its original policy active until both active owners and stored results drain.
  const pending=(await client.query<{pending:boolean}>(`SELECT EXISTS(SELECT 1 FROM signal_processing_admissions a WHERE a.policy_version_id=$1 AND(
   EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs r WHERE r.processing_admission_id=a.id AND r.status IN('queued','running','outcome_unknown')) OR
   EXISTS(SELECT 1 FROM signal_corpus_preparation_runs r WHERE r.processing_admission_id=a.id AND r.status IN('queued','running')) OR
   EXISTS(SELECT 1 FROM signal_topic_catalog_executions r WHERE r.processing_admission_id=a.id AND r.status IN('queued','running')) OR
   EXISTS(SELECT 1 FROM signal_topic_consolidation_executions r WHERE r.processing_admission_id=a.id AND r.status IN('queued','running')) OR
   EXISTS(SELECT 1 FROM signal_topic_editorial_executions r WHERE r.processing_admission_id=a.id AND r.status IN('queued','running','review_ready')) OR
   EXISTS(SELECT 1 FROM signal_interest_decision_owners_v1 r WHERE r.processing_admission_id=a.id AND r.status IN('open','ready','blocked'))
  )) pending`,[prior.id])).rows[0];
  const labeling=await readMfpPolicySwitchBlockersV1(client,scope.organization_id);
  if(pending?.pending||Object.values(labeling).some(count=>count>0))return await commit('active_work');
  const configuration=signalClassicPolicyCompletionConfigurationV1(args.env??process.env);
  if(!configuration.available||!configuration.creatorUserId||!uuid.test(configuration.creatorUserId)||!configuration.semanticConfiguration)return await commit('configuration_required');
  const creator=(await client.query(`SELECT id FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal'
   AND primary_role IN('noisia_admin','founder','admin') FOR SHARE`,[configuration.creatorUserId])).rows[0];
  if(!creator)return await commit('configuration_required');
  const compatible=(await client.query<{valid:boolean}>(`SELECT $1::timestamptz>clock_timestamp()
   AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$2)
   AND signal_processing_configuration_allows_v1('brand_context_proposal',$3::jsonb,$3::jsonb)
   AND signal_brand_context_prototype_configuration_v1($4::jsonb) valid`,
   [prior.valid_until,prior.budget_timezone,JSON.stringify(configuration.semanticConfiguration),JSON.stringify(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1)])).rows[0];
  if(!compatible?.valid)return await commit('configuration_required');
  const next=(await client.query<{id:string}>(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,
   valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id) VALUES($1,$2::bigint,'draft',clock_timestamp(),$3::timestamptz,$4,$5::bigint,$6) RETURNING id::text`,
   [scope.organization_id,(BigInt(prior.version)+1n).toString(),prior.valid_until,prior.budget_timezone,prior.daily_cap_micro_usd,configuration.creatorUserId])).rows[0]!;
  await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
   configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$2`,[next.id,prior.id]);
  for(const action of missing){
   const semantic=action==='brand_context_proposal';
   const config=semantic?configuration.semanticConfiguration:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1;
   await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
    configuration_digest,max_execution_micro_usd,automatic_allowed) VALUES($1,$2,'provider',$3,$4,$5::jsonb,
    signal_semantic_context_digest_json_v2($5::jsonb),$6::bigint,$7)`,[next.id,action,semantic?'anthropic':'voyage',
    semantic?configuration.semanticConfiguration.model:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.model,JSON.stringify(config),
    semantic?configuration.semanticCap:configuration.prototypeCap,!semantic]);
  }
  await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1 AND status='active'",[prior.id]);
  const activated=await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1 AND status='draft' RETURNING id",[next.id]);
  if(activated.rows.length!==1)throw new Error('classic_policy_completion_incomplete');
  return await commit('provisioned');
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
