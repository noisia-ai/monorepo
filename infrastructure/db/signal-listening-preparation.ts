import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {buildSignalListeningPrototypePlanV1,quoteSignalWorkspaceEmbeddingCostV1,
 signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalListeningPrototypePlanV1} from '@noisia/query-engine';
import {authorizeSignalListeningV1,listeningTransactionV1,loadSignalListeningConfigurationWithClientV1,
 listeningFailV1 as fail,type SignalListeningAccessV1} from './signal-listening-configuration';
import {admitSignalProcessingWithClientV1} from './signal-processing-policy';
import {mapCurrent} from './signal-mass-labeling';
import {requestSignalListeningV1} from './signal-listening-runs';
import {lockSignalListeningDiscoveryInitialRequestWithClientV1,createSignalListeningDiscoveryInitialIntentWithClientV1} from './signal-listening-discovery-initial';

export type SignalListeningPreparationQuoteV1={contract_version:'signal-listening-preparation-quote-v1';workspace_id:string;
 configuration_id:string;map_id:string;policy_version_id:string;prototype_plan:SignalListeningPrototypePlanV1;
 prototype_quote:{missing_inputs:number;input_bytes:number;tokens_upper:number;estimated_upper_micro_usd:number};
 jev_estimated_upper_micro_usd:number;quote_digest:string};
export type SignalListeningPreparationV1={id:string;workspace_id:string;configuration_id:string;map_id:string;actor_user_id:string;
 policy_version_id:string;idempotency_key:string;request_digest:string;cap_micro_usd:string;prototype_cap_micro_usd:string;
 quote:SignalListeningPreparationQuoteV1;planned_prototype_run_id:string|null;prototype_run_id:string|null;listening_run_id:string|null;
 status:'preparing'|'waiting_prototypes'|'ready_for_labeling'|'labeling'|'completed'|'failed';error_code:string|null;
 discovery_origin?:'initial'|'discovery_child'|null;auto_discovery?:boolean|null};
const count=(v:unknown)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0)fail('listening_count_invalid',503);return n;};
async function budget(c:PoolClient,args:Omit<SignalListeningAccessV1,'database'>,policy?:string){
 const row=(await c.query<{id:string;organization_id:string;budget_timezone:string;configuration:unknown;provider:string;model:string;
  max_execution_micro_usd:string|null}>(`SELECT p.id,w.organization_id,p.budget_timezone,a.configuration,a.provider,a.model,a.max_execution_micro_usd::text
  FROM signal_workspaces w JOIN signal_processing_policy_versions p ON p.organization_id=w.organization_id AND p.status='active'
   AND p.valid_from<=clock_timestamp() AND p.valid_until>clock_timestamp()
  JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id AND a.action='mass_labeling_jev' WHERE w.id=$1`,[args.workspace_id])).rows[0];
 if(!row||row.provider!=='typesafe'||row.model!=='jev-1.13.0'||digest(row.configuration)!==digest({contract_version:'mass-labeling-jev-v2',provider:'typesafe',model:'jev-1.13.0'})||policy&&row.id!==policy)return fail('listening_policy_changed');
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[row.organization_id]);
 await c.query("SELECT signal_processing_lock_v1($1,(clock_timestamp() AT TIME ZONE $2)::date)",[row.organization_id,row.budget_timezone]);
 await authorizeSignalListeningV1(c,args,'process');return row;
}
async function quoteWithClient(c:PoolClient,args:SignalListeningAccessV1&{configuration_id:string;map_id:string}):Promise<SignalListeningPreparationQuoteV1>{
 const policy=await budget(c,args);
 const cfg=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);
 if(!cfg||cfg.state!=='published'||(await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id))?.id!==cfg.id)return fail('listening_configuration_changed');
 const map=await mapCurrent(c,args.workspace_id,args.map_id);
 const plan=buildSignalListeningPrototypePlanV1({workspace_id:args.workspace_id,configuration_id:cfg.id,configuration:cfg.configuration});
 if(map.embedding_config_digest!==plan.embedding_profile.config_digest)fail('listening_embedding_space_invalid');
 const hashes=Object.keys(plan.texts);
 const cached=new Set((await c.query<{chunk_sha256:string}>(`SELECT cache.chunk_sha256 FROM signal_workspace_chunk_embeddings cache
  JOIN signal_workspace_embedding_calls receipt ON receipt.id=cache.call_id AND receipt.workspace_id=cache.workspace_id
  WHERE cache.workspace_id=$1 AND cache.config_digest=$2 AND cache.chunk_sha256=ANY($3::text[]) AND receipt.status='settled'`,
  [args.workspace_id,plan.embedding_profile.config_digest,hashes])).rows.map(r=>r.chunk_sha256));
 const missing=hashes.filter(h=>!cached.has(h));
 if(missing.length){
  const unresolved=(await c.query(`SELECT 1 FROM signal_workspace_embedding_calls call WHERE call.workspace_id=$1 AND call.config_digest=$2
   AND call.input_keys&&$3::text[] AND call.status<>'definitely_not_sent'
   AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_runs active WHERE active.id=call.run_id AND active.status IN('queued','running')) LIMIT 1`,
   [args.workspace_id,plan.embedding_profile.config_digest,missing])).rows.length;
  if(unresolved)fail('listening_prototype_prior_outcome_unresolved');
  const prototypeAction=(await c.query<{configuration:unknown;provider:string;model:string}>(`SELECT configuration,provider,model
   FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='topic_prototype_embeddings'`,[policy.id])).rows[0];
  if(!prototypeAction||prototypeAction.provider!=='voyage'||prototypeAction.model!=='voyage-4-large'||digest(prototypeAction.configuration)!==digest(plan.embedding_profile))
   fail('listening_prototype_policy_unavailable');
 }
 const bytes=missing.reduce((n,h)=>n+Buffer.byteLength(plan.texts[h]!),0),cost=quoteSignalWorkspaceEmbeddingCostV1({input_bytes:bytes,chunk_count:missing.length});
 const roots=(await c.query<{bytes:string}>(`SELECT COALESCE(sum(p.body_chars+p.wire_chars+512),0)::text bytes
  FROM signal_listening_compact_population_v1($1,$2,$3,$4) p WHERE p.scope_state<>'excluded' AND p.answer IS NULL`,
  [args.workspace_id,cfg.id,map.id,map.entity_context_digest])).rows[0]!;
 const value={contract_version:'signal-listening-preparation-quote-v1' as const,workspace_id:args.workspace_id,configuration_id:cfg.id,map_id:map.id,
  policy_version_id:policy.id,prototype_plan:plan,prototype_quote:{missing_inputs:missing.length,input_bytes:bytes,tokens_upper:cost.token_upper_bound,
   estimated_upper_micro_usd:cost.estimated_max_cost_micro_usd},jev_estimated_upper_micro_usd:Math.ceil(count(roots.bytes)*4*.042)};
 return {...value,quote_digest:digest(value)};
}
export async function quoteSignalListeningPreparationV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string}){
 return listeningTransactionV1(args.database,c=>quoteWithClient(c,args));
}
async function bindCached(c:PoolClient,args:SignalListeningAccessV1,plan:SignalListeningPrototypePlanV1){
 if(!plan.inputs.length)return;
 await c.query(`INSERT INTO signal_topic_definition_embeddings(workspace_id,definition_digest,embedding_model,provider,embedding,
  embedding_config_digest,input_text_sha256,source_embedding_call_id)
 SELECT $1,input.input_digest,$3,'voyage',cache.embedding,$2,input.text_sha256,cache.call_id
 FROM jsonb_to_recordset($4::jsonb) input(input_digest text,text_sha256 text)
 JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$1 AND cache.config_digest=$2 AND cache.chunk_sha256=input.text_sha256
 JOIN signal_workspace_embedding_calls receipt ON receipt.id=cache.call_id AND receipt.workspace_id=$1 AND receipt.status='settled'
 ON CONFLICT DO NOTHING`,[args.workspace_id,plan.embedding_profile.config_digest,plan.embedding_profile.model,JSON.stringify(plan.inputs)]);
 await c.query(`INSERT INTO signal_listening_question_vectors(workspace_id,configuration_id,question_key,question_digest,embedding_config_digest,
  prototype_embedding_id,source_embedding_call_id,created_by_user_id)
 SELECT $1,$2,input.question_key,input.input_digest,$3,p.id,p.source_embedding_call_id,$5
 FROM jsonb_to_recordset($4::jsonb) input(question_key text,input_digest text,text_sha256 text)
 JOIN signal_topic_definition_embeddings p ON p.workspace_id=$1 AND p.embedding_config_digest=$3 AND p.definition_digest=input.input_digest
  AND p.input_text_sha256=input.text_sha256 AND p.provider='voyage' AND p.embedding_model='voyage-4-large'
 ON CONFLICT(configuration_id,question_key,embedding_config_digest) DO NOTHING`,
 [args.workspace_id,plan.configuration_id,plan.embedding_profile.config_digest,JSON.stringify(plan.inputs),args.actor_user_id]);
}
export async function prepareSignalListeningV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string;idempotency_key:string;
 cap_micro_usd:number;provider_available:boolean;prototype_provider_available?:boolean;auto_discovery?:boolean;origin?:'initial'|'discovery_child';automatic?:boolean}){
 if(!Number.isSafeInteger(args.cap_micro_usd)||args.cap_micro_usd<=0||!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))fail('listening_request_invalid',422);
 if(args.automatic===true||args.origin!==undefined&&!['initial','discovery_child'].includes(args.origin)||args.auto_discovery===true&&args.origin==='discovery_child')fail('listening_discovery_initial_origin_invalid',422);
 const provenance=args.origin!==undefined||args.auto_discovery!==undefined;
 const flow=await listeningTransactionV1(args.database,async c=>{
  if(args.auto_discovery)await lockSignalListeningDiscoveryInitialRequestWithClientV1(c,args);
  const policy=await budget(c,args);
  if(policy.max_execution_micro_usd!==null&&args.cap_micro_usd>count(policy.max_execution_micro_usd))fail('listening_policy_cap_exceeded');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('listening-preparation:'||$1,0))",[args.workspace_id]);
  const old=(await c.query<SignalListeningPreparationV1>('SELECT * FROM signal_listening_preparations WHERE workspace_id=$1 AND actor_user_id=$2 AND idempotency_key=$3',
   [args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
  if(old){if(old.configuration_id!==args.configuration_id||old.map_id!==args.map_id||count(old.cap_micro_usd)!==args.cap_micro_usd||Boolean(old.auto_discovery)!==Boolean(args.auto_discovery)||old.discovery_origin&&args.origin&&old.discovery_origin!==args.origin)fail('listening_idempotency_conflict');return old;}
  const quote=await quoteWithClient(c,args),prototypeCap=quote.prototype_quote.estimated_upper_micro_usd;
  if(prototypeCap>=args.cap_micro_usd)fail('listening_cap_exhausted');
  if(quote.prototype_quote.missing_inputs&&!args.prototype_provider_available)fail('listening_prototype_provider_unavailable',503);
  await bindCached(c,args,quote.prototype_plan);
  const id=randomUUID(),request_digest=digest({version:'signal-listening-preparation-v1',configuration_id:args.configuration_id,
   map_id:args.map_id,cap_micro_usd:args.cap_micro_usd,quote_digest:quote.quote_digest,...(provenance?{origin:args.origin??'initial',auto_discovery:args.auto_discovery??false}:{})});
  const created=(await c.query<SignalListeningPreparationV1>(`INSERT INTO signal_listening_preparations(id,workspace_id,configuration_id,map_id,actor_user_id,
   policy_version_id,idempotency_key,request_digest,cap_micro_usd,prototype_cap_micro_usd,quote,planned_prototype_run_id,status${provenance?',discovery_origin,auto_discovery':''})
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13${provenance?',$14,$15':''}) RETURNING *`,[id,args.workspace_id,args.configuration_id,args.map_id,args.actor_user_id,
   quote.policy_version_id,args.idempotency_key,request_digest,args.cap_micro_usd,prototypeCap,JSON.stringify(quote),prototypeCap?randomUUID():null,
   prototypeCap?'preparing':'ready_for_labeling',...(provenance?[args.origin??'initial',args.auto_discovery??false]:[])])).rows[0]!;
  if(args.auto_discovery)await createSignalListeningDiscoveryInitialIntentWithClientV1(c,{...args,preparation:created});
  return created;
 });
 return continueSignalListeningPreparationV1({...args,preparation_id:flow.id});
}
export async function continueSignalListeningPreparationV1(args:SignalListeningAccessV1&{preparation_id:string;provider_available?:boolean}){
 const flow=await listeningTransactionV1(args.database,async c=>{
  // The existing prototype worker takes the taxonomy lock before money.
  // Read authorization first; mutable authority is revalidated under budget().
  await authorizeSignalListeningV1(c,args,'view');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-taxonomy:${args.workspace_id}:topic`]);
  await budget(c,args);
  const row=(await c.query<SignalListeningPreparationV1>('SELECT * FROM signal_listening_preparations WHERE id=$1 AND workspace_id=$2 AND actor_user_id=$3 FOR UPDATE',
   [args.preparation_id,args.workspace_id,args.actor_user_id])).rows[0];
  if(!row)return fail('listening_preparation_unavailable');
  await budget(c,args,row.policy_version_id);
  if(row.listening_run_id){
   const child=(await c.query<{status:string;error_code:string|null}>('SELECT status,error_code FROM signal_labeling_runs WHERE id=$1',[row.listening_run_id])).rows[0]!;
   if(['completed','failed','canceled'].includes(child.status))await c.query('UPDATE signal_listening_preparations SET status=$2,error_code=$3,updated_at=clock_timestamp() WHERE id=$1',
    [row.id,child.status==='completed'?'completed':'failed',child.error_code]);
   return {...row,status:child.status==='completed'?'completed' as const:child.status==='failed'||child.status==='canceled'?'failed' as const:row.status};
  }
  if(row.status==='failed')return row;
  const current=async()=>{
   const cfg=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id);
   if(cfg?.id!==row.configuration_id){
    await c.query("UPDATE signal_listening_preparations SET status='failed',error_code='listening_configuration_changed',updated_at=clock_timestamp() WHERE id=$1",[row.id]);
    return false;
   }
   await mapCurrent(c,args.workspace_id,row.map_id);return true;
  };
  if(row.status==='preparing'){
   if(!await current())return {...row,status:'failed' as const,error_code:'listening_configuration_changed'};
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-taxonomy:${row.workspace_id}:topic`]);
   if((await c.query(`SELECT 1 FROM signal_workspace_embedding_runs WHERE workspace_id=$1 AND config_digest=$2 AND status IN('queued','running') LIMIT 1`,
    [row.workspace_id,row.quote.prototype_plan.embedding_profile.config_digest])).rows.length)return row;
   await createPrototypeRun(c,args,row);
   await c.query("UPDATE signal_listening_preparations SET prototype_run_id=planned_prototype_run_id,status='waiting_prototypes',updated_at=clock_timestamp() WHERE id=$1",[row.id]);
   return {...row,prototype_run_id:row.planned_prototype_run_id,status:'waiting_prototypes' as const};
  }
  if(row.status==='waiting_prototypes'){
   const proto=(await c.query<{status:string;settled_micro_usd:string;reserved_micro_usd:string;unknown_reserved_micro_usd:string;observed_exception_micro_usd:string;error_code:string|null}>(
    'SELECT status,settled_micro_usd::text,reserved_micro_usd::text,unknown_reserved_micro_usd::text,observed_exception_micro_usd::text,error_code FROM signal_workspace_embedding_runs WHERE id=$1',[row.prototype_run_id])).rows[0]!;
   if(proto.status!=='completed'){
    if(['failed','stale','canceled','outcome_unknown'].includes(proto.status)){
     const error=proto.status==='outcome_unknown'||count(proto.unknown_reserved_micro_usd)>0?'listening_prototype_outcome_unknown':proto.error_code??'listening_prototype_failed';
     await c.query("UPDATE signal_listening_preparations SET status='failed',error_code=$2,updated_at=clock_timestamp() WHERE id=$1",[row.id,error]);
     return {...row,status:'failed' as const,error_code:error};
    }return row;
   }
   // Terminal child metadata is read using its frozen identity before checking
   // whether another configuration may start new work. No provider or reserve is repeated.
   if(!await current())return {...row,status:'failed' as const,error_code:'listening_configuration_changed'};
   if(count(proto.reserved_micro_usd)||count(proto.unknown_reserved_micro_usd)||count(proto.observed_exception_micro_usd))fail('listening_prototype_outcome_unknown');
   await bindCached(c,args,row.quote.prototype_plan);
   await c.query("UPDATE signal_listening_preparations SET status='ready_for_labeling',updated_at=clock_timestamp() WHERE id=$1",[row.id]);
   return {...row,status:'ready_for_labeling' as const};
  }
  if(row.status==='ready_for_labeling'&&!await current())return {...row,status:'failed' as const,error_code:'listening_configuration_changed'};
  return row;
 });
 if(flow.status==='ready_for_labeling'){
  const spent=flow.prototype_run_id?count((await args.database.query<{spent:string}>('SELECT settled_micro_usd::text spent FROM signal_workspace_embedding_runs WHERE id=$1',[flow.prototype_run_id])).rows[0]!.spent):0;
  const admitted=await requestSignalListeningV1({...args,configuration_id:flow.configuration_id,map_id:flow.map_id,
   idempotency_key:'listening-preparation:'+flow.id,cap_micro_usd:count(flow.cap_micro_usd)-spent,
   provider_available:args.provider_available??true,preparation_id:flow.id,...(flow.auto_discovery?{initial_discovery:true}:{})});
  return {preparation_id:flow.id,status:'labeling' as const,prototype_run_id:flow.prototype_run_id,run_id:admitted.run_id,
   cap_micro_usd:count(flow.cap_micro_usd),remaining_cap_micro_usd:count(flow.cap_micro_usd)-spent};
 }
 return {preparation_id:flow.id,status:flow.status,prototype_run_id:flow.prototype_run_id,run_id:flow.listening_run_id,
  cap_micro_usd:count(flow.cap_micro_usd),error_code:flow.error_code};
}
async function createPrototypeRun(c:PoolClient,args:SignalListeningAccessV1,row:SignalListeningPreparationV1){
 const plan=row.quote.prototype_plan,run=row.planned_prototype_run_id!;
 const request_digest=digest({contract_version:'listening-prototype-admission-v1',preparation_id:row.id,plan_digest:plan.plan_digest,cap_micro_usd:count(row.prototype_cap_micro_usd)});
 await c.query(`INSERT INTO signal_listening_prototype_runs(run_id,workspace_id,preparation_id,configuration_id,map_id,actor_user_id,
  policy_version_id,plan,plan_digest,quote_digest,request_digest,cap_micro_usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
 [run,row.workspace_id,row.id,row.configuration_id,row.map_id,row.actor_user_id,row.policy_version_id,JSON.stringify(plan),plan.plan_digest,
  row.quote.quote_digest,request_digest,row.prototype_cap_micro_usd]);
 const key='listening-prototype:'+row.id;
 const admission=await admitSignalProcessingWithClientV1(c,{workspace_id:row.workspace_id,actor_user_id:row.actor_user_id,action:'topic_prototype_embeddings',
  target_id:run,idempotency_key:key,request_digest,execution_cap_micro_usd:row.prototype_cap_micro_usd,automatic:false});
 const total=Object.keys(plan.texts).length,counts={total_topics:plan.topics.length,completed_topics:0,partial_topics:0,pending_topics:plan.topics.length,
  total_input_references:plan.inputs.length,processed_input_references:0,total_unique_inputs:total,processed_unique_inputs:0,cache_hits:0,embedded_unique_inputs:0};
 await c.query(`INSERT INTO signal_workspace_embedding_runs(id,workspace_id,preparation_run_id,actor_user_id,input_revision,policy_valid_until,
  profile,config_digest,quote_digest,request_keys,hard_cap_micro_usd,estimated_upper_micro_usd,counts,input_contract,taxonomy_profile_id,
  topic_input_snapshot,topic_input_digest,worker_job_id,processing_admission_id)
 VALUES($1,$2,NULL,$3,NULL,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$9,$10::jsonb,'topic_prototypes',NULL,$11::jsonb,$12,$13,$14)`,
 [run,row.workspace_id,row.actor_user_id,admission.receipt.admission_not_after,JSON.stringify(plan.embedding_profile),plan.embedding_profile.config_digest,
  row.quote.quote_digest,JSON.stringify({[key]:{actor_user_id:row.actor_user_id,request_digest}}),row.prototype_cap_micro_usd,JSON.stringify(counts),JSON.stringify(plan),
  plan.plan_digest,`signal-workspace-embedding-${run}-1`,admission.receipt.id]);
}

/** Durable dispatcher selection; each continuation rechecks its original actor and current authority. */
export async function pendingSignalListeningPreparationsV1(args:{database:SignalListeningAccessV1['database'];limit?:number}){
 const limit=args.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>200)fail('listening_limit_invalid',422);
 return (await args.database.query<{id:string;workspace_id:string;actor_user_id:string}>(`SELECT id,workspace_id,actor_user_id FROM signal_listening_preparations
  WHERE status IN('preparing','waiting_prototypes','ready_for_labeling','labeling') ORDER BY updated_at,id LIMIT $1`,[limit])).rows;
}
