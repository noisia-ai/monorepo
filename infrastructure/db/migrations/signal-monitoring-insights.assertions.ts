import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {workspaceMonitoringInsightConfigurationV1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {readMonitoringInsightProofV1,monitoringInsightProofKeyV1} from '../signal-monitoring-insights-source';
import {quoteMonitoringInsightPolicyV1,provisionMonitoringInsightPolicyV1} from '../signal-monitoring-insights-policy';
import * as insights from '../signal-monitoring-insights';

async function rejectedSql(database:Pool,sql:string,values:unknown[],pattern:RegExp){
 const client=await database.connect();
 try{await client.query('BEGIN');await assert.rejects(async()=>{await client.query(sql,values);await client.query('SET CONSTRAINTS ALL IMMEDIATE');},pattern);}
 finally{await client.query('ROLLBACK');client.release();}
}
/** Called on the genuine ready native-map fixture, inside its rollback. No provider. */
export async function assertNativeMonitoringInsightsV1(args:{database:Pool;query:Pool['query'];workspace_id:string;actor_user_id:string;map_id:string}){
 const enabled=process.env.NOISIA_MONITORING_INSIGHTS_ENABLED;
 process.env.NOISIA_MONITORING_INSIGHTS_ENABLED='true';
 const access={database:args.database,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
  conversation_segment:'all' as const,locale:'es-MX' as const,runtime:{enabled:true,provider_available:true}};
 // This assertion runs in its own disposable committed database so preview's
 // repeatable-read snapshot and dispatch's read-committed fence are genuine.
 const setup=await args.database.connect();
 let setupCommitted=false;
 const query:Pool['query']=((...parameters:Parameters<Pool['query']>)=>setupCommitted?args.query(...parameters):setup.query(...parameters)) as Pool['query'];
 await setup.query('BEGIN');
 try{
  assert.ok((await query("SELECT to_regclass('signal_monitoring_insight_runs') present")).rows[0].present);
  const before=await insights.loadWorkspaceMonitoringInsightsV1(access);
  assert.equal(before.authorization.can_request,false,'installation never enables a workspace');
  await query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'monitoring_insights',$2)",[args.workspace_id,args.actor_user_id]);
  const config=workspaceMonitoringInsightConfigurationV1(args.workspace_id);
  assert.deepEqual((await query('SELECT signal_monitoring_insights_configuration_v1($1) configuration',[args.workspace_id])).rows[0].configuration,config);
  await setup.query('COMMIT');setupCommitted=true;
  const policyArgs={database:args.database,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
   valid_until:new Date(Date.now()+86400000).toISOString()};
  const plan=await quoteMonitoringInsightPolicyV1(policyArgs);
  await assert.rejects(provisionMonitoringInsightPolicyV1({...policyArgs,plan_digest:'sha256:'+'0'.repeat(64)}),/monitoring_insights_policy_plan_changed/);
  const provisioned=await provisionMonitoringInsightPolicyV1({...policyArgs,plan_digest:plan.plan_digest});
  const policy=provisioned.policy_id;
  const oldActions=plan.plan.actions.filter(row=>row.action!=='monitoring_insights');
  const preserved=(await query(`SELECT action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd::text,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action<>'monitoring_insights' ORDER BY action`,[policy])).rows;
  assert.deepEqual(preserved,oldActions,'all sibling action configuration and limits are copied exactly');
  const view=await insights.loadWorkspaceMonitoringInsightsV1(access);
  assert.equal(view.monthly_insights.scope_segment,'all');assert.equal(view.monthly_insights.editorial_locale,'es-MX');
  const quote=await insights.quoteWorkspaceMonitoringInsightsV1({...access,budget_cap_micro_usd:2000000});
  assert.ok(quote.reserved_micro_usd>0&&quote.reserved_micro_usd<quote.budget_cap_micro_usd);
  const key=randomUUID(),request={...access,idempotency_key:key,quote_digest:quote.quote_digest,budget_cap_micro_usd:2000000};
  const [started,replayed]=await Promise.all([insights.requestWorkspaceMonitoringInsightsV1(request),insights.requestWorkspaceMonitoringInsightsV1(request)]);
  assert.equal(started.run_id,replayed.run_id,'same-key concurrent requests create one admission/owner');
  await assert.rejects(insights.requestWorkspaceMonitoringInsightsV1({...request,idempotency_key:randomUUID()}),/monitoring_insights_active/);
  await assert.rejects(insights.requestWorkspaceMonitoringInsightsV1({...request,actor_user_id:randomUUID()}));
  assert.equal((await insights.requestWorkspaceMonitoringInsightsV1(request)).run_id,started.run_id);
  await assert.rejects(insights.requestWorkspaceMonitoringInsightsV1({...request,budget_cap_micro_usd:2000001}));
  let lease=await insights.claimMonitoringInsightRunV1({database:args.database,run_id:started.run_id});assert.ok(lease);
  const call=await insights.reserveMonitoringInsightCallV1({database:args.database,lease});
  assert.equal((await insights.reserveMonitoringInsightCallV1({database:args.database,lease})).id,call.id);
  assert.equal(await insights.markMonitoringInsightCallSentV1({database:args.database,lease,call_id:call.id,attempt_token:call.attempt_token}),true);
  assert.equal(await insights.markMonitoringInsightCallSentV1({database:args.database,lease,call_id:call.id,attempt_token:call.attempt_token}),false);
  await rejectedSql(args.database,`UPDATE signal_monitoring_insight_calls SET state='definitely_not_sent',response_body=$2,response_sha256='sha256:'||encode(sha256($2::bytea),'hex'),response_http_status=200,response_complete=true WHERE id=$1`,
   [call.id,Buffer.from('{}')],/monitoring_insights_receipt_cannot_be_unsent/);
  await rejectedSql(args.database,`UPDATE signal_monitoring_insight_calls SET run_id=$2 WHERE id=$1`,[call.id,randomUUID()],/monitoring_insights_call_scope_invalid|monitoring_insights_call_immutable/);
  const native=(await query('SELECT * FROM signal_monitoring_insight_runs WHERE id=$1',[started.run_id])).rows[0];
  assert.equal(native.packet.workspace_id,args.workspace_id);assert.equal(native.configuration.workspace_id,args.workspace_id);
  assert.equal(native.packet_digest,quote.packet_digest);
  assert.equal(digest(native.configuration),digest(config));
  // A metered but invalid editorial reply is retained and charged before parse.
  const body=Buffer.from(JSON.stringify({model:'claude-sonnet-4-6',role:'assistant',stop_reason:'end_turn',
   usage:{input_tokens:100,output_tokens:60},content:[{type:'text',text:'{"invalid":true}'}]}));
  assert.equal(await insights.claimMonitoringInsightRunV1({database:args.database,run_id:started.run_id}),null,'another consumer cannot touch a live sender');
  assert.equal((await query('SELECT state FROM signal_monitoring_insight_calls WHERE id=$1',[call.id])).rows[0].state,'in_flight');
  await query("UPDATE signal_monitoring_insight_runs SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[started.run_id]);
  assert.equal(await insights.claimMonitoringInsightRunV1({database:args.database,run_id:started.run_id}),null,'expired physical attempt is quarantined, never re-sent');
  assert.equal((await query('SELECT status FROM signal_monitoring_insight_runs WHERE id=$1',[started.run_id])).rows[0].status,'outcome_unknown');
  assert.equal((await query('SELECT state FROM signal_monitoring_insight_calls WHERE id=$1',[call.id])).rows[0].state,'outcome_unknown');
  await assert.rejects(insights.reserveMonitoringInsightCallV1({database:args.database,lease}),/monitoring_insights_lease_lost/);
  assert.deepEqual(await insights.listMonitoringInsightRunsV1({database:args.database,enabled:true}),[],'an unknown physical request never resends');
  await insights.persistMonitoringInsightRawV1({database:args.database,call_id:call.id,attempt_token:call.attempt_token,
   receipt:{bytes:body,http_status:200,provider_request_id:'synthetic-monthly',complete:true}});
  assert.deepEqual(await insights.listMonitoringInsightRunsV1({database:args.database,enabled:false}),[started.run_id],'late authenticated raw is recoverable without provider availability');
  const recoveredLease=await insights.claimMonitoringInsightRunV1({database:args.database,run_id:started.run_id});assert.ok(recoveredLease);lease=recoveredLease;
  assert.equal((await insights.reserveMonitoringInsightCallV1({database:args.database,lease})).id,call.id);
  await insights.settleMonitoringInsightCallV1({database:args.database,call_id:call.id,attempt_token:call.attempt_token});
  const charged=(await query('SELECT * FROM signal_monitoring_insight_calls WHERE id=$1',[call.id])).rows[0];
  assert.equal(charged.state,'settled');assert.ok(Number(charged.settled_micro_usd)>0);
  await assert.rejects(insights.completeMonitoringInsightRunV1({database:args.database,lease,call_id:call.id}),/monitoring_insights_response_invalid/);
  assert.deepEqual((await query('SELECT state,settled_micro_usd,response_sha256 FROM signal_monitoring_insight_calls WHERE id=$1',[call.id])).rows[0],
   {state:charged.state,settled_micro_usd:charged.settled_micro_usd,response_sha256:charged.response_sha256});
  await insights.failMonitoringInsightRunV1({database:args.database,lease,call_id:call.id,attempt_token:call.attempt_token,outcome:'local_failure',error_code:'monitoring_insights_response_invalid'});
  assert.deepEqual(await insights.listMonitoringInsightRunsV1({database:args.database,enabled:true}),[],'invalid paid editorial never loops automatically');
  const proof=await readMonitoringInsightProofV1(args.database,args.workspace_id);
  const root=(await query('SELECT root_id FROM signal_mass_labeling_items WHERE map_id=$1 ORDER BY ordinal LIMIT 1',[args.map_id])).rows[0].root_id;
  const feature=randomUUID();
  await query(`INSERT INTO record_feature_values(id,subject_type,subject_id,feature_key,feature_value,source) VALUES($1,'mention',$2,'emotion','"joy"','synthetic-monthly')`,[feature,root]);
  const changed=await readMonitoringInsightProofV1(args.database,args.workspace_id);
  assert.notEqual(monitoringInsightProofKeyV1(changed),monitoringInsightProofKeyV1(proof));
  assert.equal(changed.input_revision,proof.input_revision,'typed emotion changes do not pretend to be corpus revisions');
  assert.equal((await insights.loadWorkspaceMonitoringInsightsV1(access)).monthly_insights.items.length,0,'no stale cards after emotion mutation');
  const nextQuote=await insights.quoteWorkspaceMonitoringInsightsV1({...access,budget_cap_micro_usd:2000000});
  const next=await insights.requestWorkspaceMonitoringInsightsV1({...access,idempotency_key:randomUUID(),quote_digest:nextQuote.quote_digest,budget_cap_micro_usd:2000000});
  const nextLease=await insights.claimMonitoringInsightRunV1({database:args.database,run_id:next.run_id});assert.ok(nextLease);
  const nextCall=await insights.reserveMonitoringInsightCallV1({database:args.database,lease:nextLease});
  assert.equal(await insights.markMonitoringInsightCallSentV1({database:args.database,lease:nextLease,call_id:nextCall.id,attempt_token:nextCall.attempt_token}),true);
  // The valid raw is applied once; source rights are still independent of the
  // processing policy that authorized this already-sent request.
  const raw=Buffer.from(JSON.stringify({model:'claude-sonnet-4-6',role:'assistant',stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:60},
   content:[{type:'text',text:JSON.stringify({contract_version:'signal-monthly-insight-editorial-v1',candidate_hash:nextLease.request.packet_digest,
    summary:'El paquete describe la conversación observada.',items:[{candidate_id:nextLease.request.candidate_ids[0],priority:1,short_title:'Conversación observada',
    explanation:'La actividad describe el periodo disponible.',why_it_matters:'Aporta una referencia del periodo.',confidence:'low',limitations:['Los agregados no establecen causas.']}]})}]}));
  const receipt={database:args.database,call_id:nextCall.id,attempt_token:nextCall.attempt_token,receipt:{bytes:raw,http_status:200,provider_request_id:'synthetic-valid',complete:true}};
  await insights.persistMonitoringInsightRawV1(receipt);await insights.persistMonitoringInsightRawV1(receipt);
  const settled=await insights.settleMonitoringInsightCallV1(receipt);assert.equal(settled.cost_micro_usd,1200);
  await insights.completeMonitoringInsightRunV1({database:args.database,lease:nextLease,call_id:nextCall.id});
  const final=await insights.loadWorkspaceMonitoringInsightsV1(access);
  assert.equal(final.run?.status,'completed');assert.equal(final.monthly_insights.interpretation_state,'claude');assert.equal(final.authorization.can_request,true);
  assert.equal((await query('SELECT count(*)::int n FROM signal_monitoring_insight_calls WHERE run_id=$1',[next.run_id])).rows[0].n,1);
  await query(`UPDATE record_feature_values SET feature_value='"sadness"' WHERE id=$1`,[feature]);
  assert.equal((await insights.loadWorkspaceMonitoringInsightsV1(access)).monthly_insights.items.length,0);
  const thirdQuote=await insights.quoteWorkspaceMonitoringInsightsV1({...access,budget_cap_micro_usd:2000000});
  const third=await insights.requestWorkspaceMonitoringInsightsV1({...access,idempotency_key:randomUUID(),quote_digest:thirdQuote.quote_digest,budget_cap_micro_usd:2000000});
  const thirdLease=await insights.claimMonitoringInsightRunV1({database:args.database,run_id:third.run_id});assert.ok(thirdLease);
  const thirdCall=await insights.reserveMonitoringInsightCallV1({database:args.database,lease:thirdLease});
  assert.equal(await insights.markMonitoringInsightCallSentV1({database:args.database,lease:thirdLease,call_id:thirdCall.id,attempt_token:thirdCall.attempt_token}),true);
  await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[policy]);
  // Governance changes while HTTP is in flight. Persist/settle/application remain
  // evidence-only; a completed owner does not make that stale packet serveable.
  await query(`UPDATE record_feature_values SET feature_value='"joy"' WHERE id=$1`,[feature]);
  const thirdRaw=Buffer.from(raw.toString().replace(nextLease.request.packet_digest,thirdLease.request.packet_digest));
  const thirdReceipt={database:args.database,call_id:thirdCall.id,attempt_token:thirdCall.attempt_token,
   receipt:{bytes:thirdRaw,http_status:200,provider_request_id:'synthetic-after-revocation',complete:true}};
  await insights.persistMonitoringInsightRawV1(thirdReceipt);await insights.settleMonitoringInsightCallV1(thirdReceipt);
  await insights.completeMonitoringInsightRunV1({database:args.database,lease:thirdLease,call_id:thirdCall.id});
  const hidden=await insights.loadWorkspaceMonitoringInsightsV1(access);
  assert.equal(hidden.run?.status,'completed');assert.equal(hidden.monthly_insights.items.length,0);assert.equal(hidden.authorization.can_request,false);
  await rejectedSql(args.database,'SET LOCAL ROLE authenticated; SELECT response_body FROM signal_monitoring_insight_calls',[],/permission denied/);
  await rejectedSql(args.database,`UPDATE signal_monitoring_insight_calls SET state='definitely_not_sent',settled_micro_usd=NULL WHERE id=$1`,[thirdCall.id],/monitoring_insights_call_immutable/);
  const beforeDelete=await readMonitoringInsightProofV1(args.database,args.workspace_id);
  await query('DELETE FROM record_feature_values WHERE id=$1',[feature]);
  assert.notEqual((await readMonitoringInsightProofV1(args.database,args.workspace_id)).metadata_revision,beforeDelete.metadata_revision);
 }finally{
  if(!setupCommitted)await setup.query('ROLLBACK');
  setup.release();
  if(enabled===undefined)delete process.env.NOISIA_MONITORING_INSIGHTS_ENABLED;else process.env.NOISIA_MONITORING_INSIGHTS_ENABLED=enabled;
 }
}
