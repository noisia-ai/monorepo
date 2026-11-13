import type {Pool,PoolClient} from 'pg';
import {workspaceMonitoringInsightConfigurationV1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {readClassicPolicyActiveWorkV1} from './signal-classic-policy-completion';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {MonitoringInsightsError} from './signal-monitoring-insights';

type Args={database:Pick<Pool,'connect'>;workspace_id:string;actor_user_id:string;valid_until?:string};
type Prior={id:string;organization_id:string;version:string;status:string;policy_digest:string;budget_timezone:string;daily_cap_micro_usd:string|null;valid_until:string};
async function readPlan(client:PoolClient,args:Args){
 const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,lock_authority:true});
 const scope=(await client.query<{organization_id:string}>(`SELECT w.organization_id FROM signal_workspaces w JOIN users u ON u.id=$2
  WHERE w.id=$1 AND u.status='active' AND u.user_type='noisia_internal' AND u.primary_role='noisia_admin'`,[args.workspace_id,args.actor_user_id])).rows[0];
 if(!scope||!caps.can_request_processing)throw new MonitoringInsightsError('monitoring_insights_forbidden',403);
 const prior=(await client.query<Prior>(`SELECT id,organization_id,version::text,status,policy_digest,budget_timezone,daily_cap_micro_usd::text,valid_until::text
  FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active' AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp()
  ORDER BY signal_processing_policy_versions.version DESC LIMIT 1`,[scope.organization_id])).rows[0];
 if(!prior)throw new MonitoringInsightsError('monitoring_insights_base_policy_required');
 // Inherit the complete organization's existing horizon by default. Explicit
 // dates may retain it or shorten it within thirty days, never extend it.
 // PostgreSQL normalization preserves infinity and finite microseconds exactly.
 const dates=(await client.query<{valid:boolean;valid_until:string}>(`WITH dates AS (
  SELECT COALESCE($1::timestamptz,$2::timestamptz) target,$2::timestamptz prior
 ) SELECT target>clock_timestamp() AND target<=prior
  AND (target=prior OR target<=clock_timestamp()+interval '30 days') valid,
  CASE WHEN target='infinity'::timestamptz THEN 'infinity'
   ELSE to_char(target AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END valid_until FROM dates`,
 [args.valid_until??null,prior.valid_until])).rows[0];
 if(!dates?.valid)throw new MonitoringInsightsError('monitoring_insights_policy_dates_invalid',422);
 if(prior.daily_cap_micro_usd!==null&&BigInt(prior.daily_cap_micro_usd)<2000000n)throw new MonitoringInsightsError('monitoring_insights_daily_limit');
 const actions=(await client.query(`SELECT action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd::text,automatic_allowed
  FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action`,[prior.id])).rows;
 const existing=actions.find(action=>action.action==='monitoring_insights');
 if(existing&&digest(existing.configuration)!==digest(workspaceMonitoringInsightConfigurationV1(args.workspace_id)))
  throw new MonitoringInsightsError('monitoring_insights_other_scope_policy_exists');
 const nextVersion=(await client.query<{value:string}>("SELECT (COALESCE(max(version),0)+1)::text value FROM signal_processing_policy_versions WHERE organization_id=$1",[scope.organization_id])).rows[0]!.value;
 const plan={contract_version:'workspace-monitoring-insights-policy-plan-v1',workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
  prior,actions,next_version:nextVersion,valid_until:dates.valid_until,configuration:workspaceMonitoringInsightConfigurationV1(args.workspace_id),
  max_execution_micro_usd:2000000,automatic_allowed:false};
 return{prior,plan,plan_digest:digest(plan)};
}
/** Explicit operator preview. No activation, opt-in, admission or paid work. */
export async function quoteMonitoringInsightPolicyV1(args:Args){
 const client=await args.database.connect();
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');const result=await readPlan(client,args);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
/** A complete immutable successor, never editing an active action or sibling
 * owner. The reviewed plan is the authority for this one workspace/config. */
export async function provisionMonitoringInsightPolicyV1(args:Args&{plan_digest:string}){
 const client=await args.database.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const scope=(await client.query<{organization_id:string}>('SELECT organization_id FROM signal_workspaces WHERE id=$1',[args.workspace_id])).rows[0];
  if(!scope)throw new MonitoringInsightsError('monitoring_insights_workspace_unavailable',404);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::uuid::text,0))",[scope.organization_id]);
  const read=await readPlan(client,args);
  if(read.plan_digest!==args.plan_digest)throw new MonitoringInsightsError('monitoring_insights_policy_plan_changed');
  if(await readClassicPolicyActiveWorkV1(client,scope.organization_id))throw new MonitoringInsightsError('monitoring_insights_policy_active_work');
  const prior=read.prior;
  const next=(await client.query<{id:string}>(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,
   budget_timezone,daily_cap_micro_usd,created_by_user_id) VALUES($1,$2,'draft',clock_timestamp(),$3,$4,$5,$6) RETURNING id`,
  [prior.organization_id,read.plan.next_version,read.plan.valid_until,prior.budget_timezone,prior.daily_cap_micro_usd,args.actor_user_id])).rows[0]!;
  await client.query(`INSERT INTO signal_processing_policy_actions SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action<>'monitoring_insights'`,[next.id,prior.id]);
  await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   VALUES($1,'monitoring_insights','provider','anthropic','claude-sonnet-4-6',$2,signal_semantic_context_digest_json_v2($2::jsonb),2000000,false)`,
  [next.id,JSON.stringify(read.plan.configuration)]);
  await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1 AND status='active'",[prior.id]);
  await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1 AND status='draft'",[next.id]);
  await client.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'monitoring_insights',$2) ON CONFLICT DO NOTHING",[args.workspace_id,args.actor_user_id]);
  await client.query('COMMIT');return{policy_id:next.id,configuration_digest:digest(read.plan.configuration),max_execution_micro_usd:2000000};
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
