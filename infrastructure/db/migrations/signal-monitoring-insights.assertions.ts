import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {workspaceMonitoringInsightConfigurationV1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {readMonitoringInsightProofV1,monitoringInsightProofKeyV1,monitoringInsightNotAfterV1,monitoringInsightDeadlineMillisV1} from '../signal-monitoring-insights-source';
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
  // Invented base policies exercise the actual infinity/finite database values.
  // Setup copies every action; no helper is allowed to extend that base expiry.
  const seedExpiry=async(validUntil:string,version?:string)=>{
   const client=await args.database.connect();
   try{
    await client.query('BEGIN');
    const prior=(await client.query(`SELECT p.* FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status<>'draft' ORDER BY p.version DESC LIMIT 1`,[args.workspace_id])).rows[0];
    const next=(await client.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
     SELECT organization_id,COALESCE($4::bigint,(SELECT max(version)+1 FROM signal_processing_policy_versions WHERE organization_id=p.organization_id)),'draft',clock_timestamp(),$2::timestamptz,budget_timezone,daily_cap_micro_usd,$3 FROM signal_processing_policy_versions p WHERE id=$1 RETURNING id,version::text,valid_until::text`,[prior.id,validUntil,args.actor_user_id,version??null])).rows[0];
    await client.query(`INSERT INTO signal_processing_policy_actions SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action<>'monitoring_insights'`,[next.id,prior.id]);
    await client.query(`INSERT INTO signal_processing_policy_actions VALUES($1,'monitoring_insights','provider','anthropic','claude-sonnet-4-6',$2,signal_semantic_context_digest_json_v2($2::jsonb),2000000,false)`,[next.id,JSON.stringify(config)]);
    await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1 AND status='active'",[prior.id]);
    await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[next.id]);
    await client.query('COMMIT');return next as {id:string;version:string;valid_until:string};
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  };
  await seedExpiry('infinity');
  const infinityQuote=await insights.quoteWorkspaceMonitoringInsightsV1({...access,budget_cap_micro_usd:2000000});
  assert.ok(Number.isFinite(Date.parse(infinityQuote.expires_at)));
  assert.ok(Date.parse(infinityQuote.expires_at)<=Date.now()+300000,'infinite policy never makes the quote infinite');
  const futureCompetitor=async(effectiveFrom:string)=>{
   const seed=randomUUID();
   await query('INSERT INTO brand_seeds(id,canonical_name,active) VALUES($1,$2,true)',[seed,'Synthetic future boundary '+seed]);
   await query(`INSERT INTO competitors(brand_id,competitor_brand_seed_id,status,effective_from,updated_at)
    SELECT brand_id,$2,'current',$3::timestamptz,clock_timestamp() FROM signal_workspaces WHERE id=$1`,[args.workspace_id,seed,effectiveFrom]);
  };
  // A future, not-yet-effective identity leaves the native map current, while
  // exercising the genuine PostgreSQL infinity returned by the boundary reader.
  await futureCompetitor('infinity');
  const infiniteProof=await readMonitoringInsightProofV1(args.database,args.workspace_id);
  assert.equal(infiniteProof.entity_not_after,'infinity');
  const infiniteSourceQuote=await insights.quoteWorkspaceMonitoringInsightsV1({...access,budget_cap_micro_usd:2000000});
  assert.ok(Number.isFinite(Date.parse(infiniteSourceQuote.expires_at)));
  const finiteBoundary=(await query("SELECT (clock_timestamp()+interval '20 minutes')::text value")).rows[0].value;
  await futureCompetitor(finiteBoundary);
  const mixedProof=await readMonitoringInsightProofV1(args.database,args.workspace_id);
  assert.equal(monitoringInsightNotAfterV1([infiniteProof.entity_not_after,mixedProof.entity_not_after]),new Date(finiteBoundary).toISOString());
  assert.equal(monitoringInsightNotAfterV1([infiniteProof.entity_not_after,Infinity,null]),null);
  assert.throws(()=>monitoringInsightNotAfterV1(['invalid deadline']),/monitoring_insights_deadline_invalid/);
  assert.throws(()=>monitoringInsightDeadlineMillisV1('-infinity'),/monitoring_insights_deadline_invalid/);
  const mixedQuote=await insights.quoteWorkspaceMonitoringInsightsV1({...access,budget_cap_micro_usd:2000000});
  const budgetEnd=(await query(`SELECT ((clock_timestamp() AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone value
   FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'`,[args.workspace_id])).rows[0].value;
  assert.ok(Date.parse(mixedQuote.expires_at)<=Math.min(Date.now()+300000,Date.parse(finiteBoundary),new Date(budgetEnd).getTime()),'five-minute, day and finite source limits remain binding');

  const policyArgs={database:args.database,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id};
  const plan=await quoteMonitoringInsightPolicyV1(policyArgs);
  assert.equal(plan.plan.valid_until,'infinity');
  assert.equal((await quoteMonitoringInsightPolicyV1({...policyArgs,valid_until:'infinity'})).plan_digest,plan.plan_digest);
  await assert.rejects(provisionMonitoringInsightPolicyV1({...policyArgs,plan_digest:'sha256:'+'0'.repeat(64)}),/monitoring_insights_policy_plan_changed/);
  const provisioned=await provisionMonitoringInsightPolicyV1({...policyArgs,plan_digest:plan.plan_digest});
  let policy=provisioned.policy_id;
  const inherited=(await query('SELECT valid_until::text,daily_cap_micro_usd::text FROM signal_processing_policy_versions WHERE id=$1',[policy])).rows[0];
  assert.equal(inherited.valid_until,'infinity');assert.equal(inherited.daily_cap_micro_usd,plan.prior.daily_cap_micro_usd);
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
  const originalTimezone=(await query('SELECT timezone FROM signal_workspaces WHERE id=$1',[args.workspace_id])).rows[0].timezone;
  await query('UPDATE signal_workspaces SET timezone=$2 WHERE id=$1',[args.workspace_id,originalTimezone==='UTC'?'America/Mexico_City':'UTC']);
  await assert.rejects(insights.markMonitoringInsightCallSentV1({database:args.database,lease,call_id:call.id,attempt_token:call.attempt_token}),/monitoring_insights_(authority_invalid|source_changed)/);
  await rejectedSql(args.database,`UPDATE signal_monitoring_insight_calls SET state='in_flight',sent_at=clock_timestamp() WHERE id=$1`,[call.id],/monitoring_insights_authority_invalid/);
  assert.equal((await query('SELECT state FROM signal_monitoring_insight_calls WHERE id=$1',[call.id])).rows[0].state,'reserved');
  await query('UPDATE signal_workspaces SET timezone=$2 WHERE id=$1',[args.workspace_id,originalTimezone]);
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
  await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[policy]);
  const licensed=await insights.loadWorkspaceMonitoringInsightsV1(access);
  assert.equal(licensed.monthly_insights.interpretation_state,'claude','spending-policy revocation alone does not erase licensed paid copy');
  assert.equal(licensed.authorization.can_request,false);
  await assert.rejects(quoteMonitoringInsightPolicyV1(policyArgs),/monitoring_insights_base_policy_required/);
  await seedExpiry('infinity');
  const renewalPlan=await quoteMonitoringInsightPolicyV1(policyArgs);
  policy=(await provisionMonitoringInsightPolicyV1({...policyArgs,plan_digest:renewalPlan.plan_digest})).policy_id;

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
  assert.equal(await insights.markMonitoringInsightCallSentV1({database:args.database,lease:thirdLease,call_id:thirdCall.id,attempt_token:thirdCall.attempt_token}),false,'a changed source cannot turn another in-flight sender into definitely-not-sent');
  assert.equal((await query('SELECT state FROM signal_monitoring_insight_calls WHERE id=$1',[thirdCall.id])).rows[0].state,'in_flight');
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
  await query(`INSERT INTO record_feature_values(id,subject_type,subject_id,feature_key,feature_value,source) VALUES($1,'mention',$2,'emotion','"surprise"','synthetic-monthly-brand')`,[feature,root]);
  await seedExpiry('infinity');
  const brandPlan=await quoteMonitoringInsightPolicyV1(policyArgs);
  await provisionMonitoringInsightPolicyV1({...policyArgs,plan_digest:brandPlan.plan_digest});
  const brandQuote=await insights.quoteWorkspaceMonitoringInsightsV1({...access,budget_cap_micro_usd:2000000});
  const brandRun=await insights.requestWorkspaceMonitoringInsightsV1({...access,idempotency_key:randomUUID(),quote_digest:brandQuote.quote_digest,budget_cap_micro_usd:2000000});
  const brandLease=await insights.claimMonitoringInsightRunV1({database:args.database,run_id:brandRun.run_id});assert.ok(brandLease);
  const brandCall=await insights.reserveMonitoringInsightCallV1({database:args.database,lease:brandLease});
  const brand=(await query(`SELECT b.id,b.display_name,b.name FROM signal_workspaces w JOIN brands b ON b.id=w.brand_id WHERE w.id=$1`,[args.workspace_id])).rows[0];
  const identityQueries:string[]=[];
  const identityReader={query:((sql:string,values?:unknown[])=>{identityQueries.push(sql);return args.database.query(sql,values);}) as Pool['query']};
  const beforeBrand=await readMonitoringInsightProofV1(identityReader,args.workspace_id);
  for(const sql of identityQueries)assert.doesNotMatch(sql,/FROM mentions|FROM signal_mention_facet_labels|FROM brand_os_objectives|FROM brand_os_briefs/u,'cheap identity proof never scans roots or narrative knowledge');
  assert.equal(beforeBrand.entity_context_digest,(await query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[args.map_id])).rows[0].entity_context_digest);

  await query('UPDATE brands SET display_name=$2 WHERE id=$1',[brand.id,(brand.display_name??brand.name)+' changed identity']);
  const afterBrand=await readMonitoringInsightProofV1(args.database,args.workspace_id);
  assert.equal(afterBrand.input_revision,beforeBrand.input_revision,'Brand OS identity does not pretend to be a corpus edit');
  assert.notEqual(afterBrand.entity_context_digest,beforeBrand.entity_context_digest,'same native canonical digest detects the legitimate identity edit');
  assert.notEqual(afterBrand.metadata_revision,beforeBrand.metadata_revision,'direct SQL source fence sees the opted-in identity epoch');
  await rejectedSql(args.database,`UPDATE signal_monitoring_insight_calls SET state='in_flight',sent_at=clock_timestamp() WHERE id=$1`,[brandCall.id],/monitoring_insights_authority_invalid/);
  await assert.rejects(insights.markMonitoringInsightCallSentV1({database:args.database,lease:brandLease,call_id:brandCall.id,attempt_token:brandCall.attempt_token}),/monitoring_insights_(authority_invalid|source_changed)/);
  assert.equal((await query('SELECT state FROM signal_monitoring_insight_calls WHERE id=$1',[brandCall.id])).rows[0].state,'reserved');
  assert.equal((await insights.loadWorkspaceMonitoringInsightsV1(access)).monthly_insights.items.length,0,'native stale identity also hides cached monthly cards');
  await query('UPDATE brands SET display_name=$2 WHERE id=$1',[brand.id,brand.display_name]);
  assert.equal((await insights.reserveMonitoringInsightCallV1({database:args.database,lease:brandLease})).id,brandCall.id,'restoration never creates another call');
  await insights.failMonitoringInsightRunV1({database:args.database,lease:brandLease,call_id:brandCall.id,attempt_token:brandCall.attempt_token,outcome:'definitely_not_sent',error_code:'monitoring_insights_source_changed'});
  assert.equal((await query('SELECT count(*)::int n FROM signal_monitoring_insight_calls WHERE run_id=$1',[brandRun.run_id])).rows[0].n,1);
  const farFuture=(await query("SELECT (clock_timestamp()+interval '60 days'+interval '123 microseconds')::text value")).rows[0].value;
  const finite=await seedExpiry(farFuture);
  const higherRevoked=await seedExpiry('infinity',(BigInt(finite.version)+10n).toString());
  await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[higherRevoked.id]);
  const currentFinite=await seedExpiry(finite.valid_until,(BigInt(finite.version)+5n).toString());
  const draftVersion=(BigInt(finite.version)+20n).toString();
  const draft=(await query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT organization_id,$2,'draft',clock_timestamp(),valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING id`,[currentFinite.id,draftVersion])).rows[0];
  const finitePlan=await quoteMonitoringInsightPolicyV1(policyArgs);
  assert.equal((await quoteMonitoringInsightPolicyV1({...policyArgs,valid_until:finite.valid_until})).plan_digest,finitePlan.plan_digest);
  assert.equal(finitePlan.prior.id,currentFinite.id,'a numerically later revoked policy is never a source of authority');
  assert.equal(finitePlan.plan.next_version,(BigInt(draftVersion)+1n).toString());
  const finiteProvisioned=await provisionMonitoringInsightPolicyV1({...policyArgs,plan_digest:finitePlan.plan_digest});
  assert.equal((await query('SELECT version::text FROM signal_processing_policy_versions WHERE id=$1',[finiteProvisioned.policy_id])).rows[0].version,finitePlan.plan.next_version);
  assert.equal((await query('SELECT status FROM signal_processing_policy_versions WHERE id=$1',[draft.id])).rows[0].status,'draft','unrelated draft is untouched');
  assert.equal((await query('SELECT valid_until=$2::timestamptz exact FROM signal_processing_policy_versions WHERE id=$1',[finiteProvisioned.policy_id,finite.valid_until])).rows[0].exact,true,'finite expiry including microseconds is preserved beyond the new-date thirty-day limit');
  await assert.rejects(quoteMonitoringInsightPolicyV1({...policyArgs,valid_until:'infinity'}),/monitoring_insights_policy_dates_invalid/);
  const shortFuture=(await query("SELECT (clock_timestamp()+interval '14 days')::text value")).rows[0].value;
  const shortBase=await seedExpiry(shortFuture);
  assert.equal((await quoteMonitoringInsightPolicyV1(policyArgs)).prior.id,shortBase.id,'the latest numeric policy version is selected even across nine to ten');
  const extension=(await query("SELECT (clock_timestamp()+interval '20 days')::text value")).rows[0].value;
  await assert.rejects(quoteMonitoringInsightPolicyV1({...policyArgs,valid_until:extension}),/monitoring_insights_policy_dates_invalid/);
  const shortened=(await query("SELECT (clock_timestamp()+interval '7 days')::text value")).rows[0].value;
  await quoteMonitoringInsightPolicyV1({...policyArgs,valid_until:shortened});


 }finally{
  if(!setupCommitted)await setup.query('ROLLBACK');
  setup.release();
  if(enabled===undefined)delete process.env.NOISIA_MONITORING_INSIGHTS_ENABLED;else process.env.NOISIA_MONITORING_INSIGHTS_ENABLED=enabled;
 }
}
