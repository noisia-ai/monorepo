import {assertSignalListeningDiscoveryInitialPreparationWithClientV1,bindSignalListeningDiscoveryInitialAdmissionWithClientV1} from './signal-listening-discovery-initial';
import type {PoolClient} from 'pg';
import {signalListeningJevIdentityV1,validateSignalListeningConfigurationV1,labelerDigestV1,buildSignalListeningJevRequestV1,
 signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningInputV1,type SignalListeningResultV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {requestMentionFacetsV1,createSignalLabelingStoreV1,type LabelingRunV1,type LabelingCallV1} from './signal-labeling-runs';
import {selectLabelingInputPrefixV1,type LabelingInputBoundsV1} from './signal-labeling-input-bounds';
import type {LabelingDatabaseV1} from './signal-mention-facets';
import {mapCurrent,assertMassLabelingMapCurrentV1} from './signal-mass-labeling';
import {authorizeSignalListeningV1,loadSignalListeningConfigurationWithClientV1,listeningFailV1 as fail,
 listeningTransactionV1,type SignalListeningAccessV1} from './signal-listening-configuration';

const config=(run:LabelingRunV1):SignalListeningConfigurationV1=>validateSignalListeningConfigurationV1(run.identity.params.configuration);
async function latestConfigurationId(c:Pick<PoolClient,'query'>,workspace:string){return(await c.query<{id:string}>("SELECT id FROM signal_listening_configurations WHERE workspace_id=$1 AND state='published' ORDER BY revision DESC LIMIT 1",[workspace])).rows[0]?.id;}
async function owner(c:Pick<PoolClient,'query'>,run:LabelingRunV1,current=true){
 const row=(await c.query<{configuration_id:string;map_id:string;configuration_digest:string}>(`SELECT o.* FROM signal_listening_runs o
  WHERE workspace_id=$1 AND run_id=$2`,[run.workspace_id,run.id])).rows[0];
 if(!row||run.identity.params.request_version!=='listening-jev-v1')return fail('listening_run_unavailable');
 if(labelerDigestV1(run.identity)!==labelerDigestV1(signalListeningJevIdentityV1(config(run))))fail('listening_identity_invalid');
 if(current){
  if(await latestConfigurationId(c,run.workspace_id)!==row.configuration_id)fail('listening_configuration_changed');
 }
 await assertMassLabelingMapCurrentV1(c,run.workspace_id,row.map_id);return row;
}
const population=`signal_listening_population_v1($1::uuid,$2::uuid,$3::uuid,$4::text)`;
const pendingScope=`p.candidate AND p.scope_state='included' AND p.answer IS NULL
 AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest) AND NOT EXISTS(SELECT 1 FROM signal_listening_call_questions sent
 WHERE sent.run_id=$5 AND sent.workspace_id=$1 AND sent.root_id=p.root_id AND sent.question_digest=p.question_digest)`;
async function inputMetadata(c:Pick<PoolClient,'query'>,run:LabelingRunV1,limit:number){
 const o=await owner(c,run,false);
 if(await latestConfigurationId(c,run.workspace_id)!==o.configuration_id)return{o,rows:[]};
 const fixed=Buffer.byteLength(JSON.stringify(run.identity))+Buffer.byteLength(JSON.stringify(run.context))+Buffer.byteLength(JSON.stringify(config(run)));
 const rows=(await c.query<{root_id:string;working_bytes:string}>(`/* labeling_listening_input_metadata_v1 */ WITH pending AS MATERIALIZED(
  SELECT p.root_id,p.question_key,octet_length(p.body)::bigint text_bytes,octet_length(p.wire::text)::bigint wire_bytes,
   (octet_length(p.question_key)+octet_length(p.question_digest)+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,
   octet_length(COALESCE(p.platform,''))::bigint platform_bytes,row_number() OVER(PARTITION BY p.root_id ORDER BY p.question_key) n
  FROM ${population} p WHERE ${pendingScope})
  SELECT root_id,(4::bigint*(12*max(text_bytes)+2*sum(wire_bytes)+6*sum(question_metadata_bytes)+6*max(platform_bytes)+$7::bigint+2048)+8192)::text working_bytes
  FROM pending WHERE n<=256 GROUP BY root_id ORDER BY root_id LIMIT $6`,[run.workspace_id,o.configuration_id,o.map_id,run.entity_context_digest,run.id,limit,fixed])).rows;
 return{o,rows};
}
async function inputs(c:Pick<PoolClient,'query'>,run:LabelingRunV1,limit:number,bounds?:LabelingInputBoundsV1):Promise<SignalListeningInputV1[]>{
 const metadata=bounds?await inputMetadata(c,run,bounds.max_rows):null;
 const selected=metadata?selectLabelingInputPrefixV1(metadata.rows,bounds!):null;if(selected&&!selected.length)return [];
 const o=metadata?.o??await owner(c,run,false);
 if(!metadata&&await latestConfigurationId(c,run.workspace_id)!==o.configuration_id)return [];
 const hydratePopulation=selected?`signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$7::uuid[],'llm-processing')`:population;
 const rows=(await c.query<{root_id:string;input_digest:string;body:string;published_at:Date|string;platform:string|null;
  question_keys:string[];question_digests:Record<string,string>;scope_basis:Record<string,string>}>(`WITH pending AS MATERIALIZED(
  SELECT p.*,row_number() OVER(PARTITION BY root_id ORDER BY question_key) n FROM ${hydratePopulation} p
  WHERE ${pendingScope})
  SELECT root_id,input_digest,body,published_at,platform,array_agg(question_key ORDER BY question_key) question_keys,
   jsonb_object_agg(question_key,question_digest) question_digests,
   COALESCE(jsonb_object_agg(question_key,scope_basis) FILTER(WHERE scope_basis IS NOT NULL),'{}'::jsonb) scope_basis
  FROM pending WHERE n<=256 GROUP BY root_id,input_digest,body,published_at,platform ORDER BY root_id LIMIT $6`,
  [run.workspace_id,o.configuration_id,o.map_id,run.entity_context_digest,run.id,bounds?.max_rows??limit,...(selected?[selected]:[])])).rows;
 return rows.map(row=>({root_id:row.root_id,input_digest:row.input_digest,text:row.body,title:null,platform:row.platform,
  content_type:null,author:null,published_at:new Date(row.published_at).toISOString(),language:null,map_id:o.map_id,
  configuration_digest:o.configuration_digest,question_keys:row.question_keys,question_digests:row.question_digests,scope_basis:row.scope_basis}));
}
export async function requestSignalListeningV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string;
 idempotency_key:string;cap_micro_usd:number;provider_available:boolean;preparation_id?:string;initial_discovery?:boolean}){
 const stored=await getForRequest(args),identity=signalListeningJevIdentityV1(stored.configuration);
 return requestMentionFacetsV1({...args,identity,full_recalculation:true,adapter:{
  request_identity:{contract_version:'signal-listening-run-v1',configuration_id:stored.id,map_id:args.map_id,full_corpus:true,...(args.preparation_id?{preparation_id:args.preparation_id}:{}),...(args.initial_discovery?{initial_discovery:true}:{})},
  policy_action:'mass_labeling_jev',feature:'mass_labeling',select_labeler:false,
  validateIdentity:candidate=>{if(labelerDigestV1(candidate)!==labelerDigestV1(identity))fail('listening_identity_invalid');},
  prepare:async(c,workspace,_run,_labeler,context)=>{
   await authorizeSignalListeningV1(c,args,'process');
   if(args.initial_discovery){if(!args.preparation_id)return fail('listening_discovery_initial_preparation_required');await assertSignalListeningDiscoveryInitialPreparationWithClientV1(c,{...args,preparation_id:args.preparation_id});}
   if(args.preparation_id){
    const flow=(await c.query<{configuration_id:string;map_id:string;cap_micro_usd:string;status:string;actor_user_id:string;spent:string}>(`SELECT f.*,
     COALESCE(p.settled_micro_usd,0)::text spent FROM signal_listening_preparations f
     LEFT JOIN signal_workspace_embedding_runs p ON p.id=f.prototype_run_id
     WHERE f.id=$1 AND f.workspace_id=$2 FOR UPDATE OF f`,[args.preparation_id,workspace])).rows[0];
    if(!flow||flow.actor_user_id!==args.actor_user_id||flow.configuration_id!==stored.id||flow.map_id!==args.map_id
     ||flow.status!=='ready_for_labeling'||Number(flow.cap_micro_usd)-Number(flow.spent)!==args.cap_micro_usd)
     fail('listening_preparation_cap_binding_invalid');
   }
   const latest=await loadSignalListeningConfigurationWithClientV1(c,workspace);
   if(latest?.id!==stored.id)fail('listening_configuration_changed');
   const map=await mapCurrent(c,workspace,args.map_id);
   if((await c.query<{blocked:boolean}>('SELECT signal_listening_prior_outcome_unresolved_v1($1,$2,$3,$4) blocked',[workspace,stored.id,map.id,map.entity_context_digest])).rows[0]?.blocked)fail('listening_prior_outcome_unresolved');
   const stats=(await c.query<{roots:number;chars:string}>(`SELECT count(DISTINCT root_id)::int roots,
    COALESCE(sum(length(body)+length(wire::text)+512),0)::text chars FROM ${population} p
    WHERE candidate AND scope_state<>'excluded' AND answer IS NULL`,[workspace,stored.id,map.id,map.entity_context_digest])).rows[0]!;
   return {roots:stats.roots,estimated_micro_usd:Math.ceil(Number(stats.chars)*4*.042),concept_set_digest:stored.configuration_digest,
    snapshot:{contract_version:'signal-listening-run-v1',configuration_id:stored.id,configuration_digest:stored.configuration_digest,
     map_id:map.id,map_digest:map.map_digest,full_corpus:true}};
  },
  persist:async(c,run,prepared)=>{
   await c.query('UPDATE signal_labeling_runs SET membership_snapshot=$2::jsonb,concept_set_digest=$3 WHERE id=$1',
    [run,JSON.stringify(prepared.snapshot),prepared.concept_set_digest]);
   await c.query(`INSERT INTO signal_listening_runs(run_id,workspace_id,configuration_id,map_id,configuration_digest${args.preparation_id?',preparation_id':''})
    VALUES($1,$2,$3,$4,$5${args.preparation_id?',$6':''})`,[run,args.workspace_id,stored.id,args.map_id,stored.configuration_digest,...(args.preparation_id?[args.preparation_id]:[])]);
   if(args.preparation_id)await c.query("UPDATE signal_listening_preparations SET status='labeling',listening_run_id=$2,updated_at=clock_timestamp() WHERE id=$1",[args.preparation_id,run]);
   if(args.initial_discovery&&args.preparation_id)await bindSignalListeningDiscoveryInitialAdmissionWithClientV1(c,{...args,preparation_id:args.preparation_id,run_id:run});
  },
 }});
}
async function getForRequest(args:SignalListeningAccessV1&{configuration_id:string}){
 return listeningTransactionV1(args.database,async c=>{
  await authorizeSignalListeningV1(c,args,'process');
  const stored=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);
  if(!stored||stored.state!=='published')return fail('listening_configuration_unavailable');return stored;
 });
}

export function createSignalListeningStoreV1(options:Omit<Parameters<typeof createSignalLabelingStoreV1>[0],'adapter'>){
 const limit=options.page_size??200;
 const store=createSignalLabelingStoreV1<SignalListeningInputV1,SignalListeningResultV1>({...options,adapter:{
  kind:'mass_labeling',recover_failed_raw:true,policy_action:'mass_labeling_jev',feature:'mass_labeling',pending_calls_only:true,persist_results_before_write:true,
  inputs:(c,run)=>inputs(c,run,limit),
  bounded_inputs:(c,run,bounds)=>inputs(c,run,limit,bounds),
  has_inputs:async(c,run)=>(await inputMetadata(c,run,1)).rows.length>0,
  authority:async(c,run)=>{await owner(c,run,false);},
  beforeSubmit:async(c,run,calls)=>{
   await owner(c,run);
   const configuration=config(run);
   for(const call of calls){if(call.inputs.length!==1||digest(call.request)!==digest(buildSignalListeningJevRequestV1(call.inputs[0]!,configuration)))fail('listening_request_invalid');}
  },
  pending:async(c,run)=>{
   const o=await owner(c,run,false);
   if((await loadSignalListeningConfigurationWithClientV1(c,run.workspace_id))?.id!==o.configuration_id)return 0;
   return (await c.query<{count:number}>(`SELECT count(DISTINCT root_id)::int count FROM ${population} p
    WHERE candidate AND scope_state='included' AND answer IS NULL
     AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)`,[run.workspace_id,o.configuration_id,o.map_id,run.entity_context_digest])).rows[0]!.count;
  },
  write:async(c,run,pages)=>{
   await authorizeSignalListeningV1(c,{workspace_id:run.workspace_id,actor_user_id:run.actor_user_id},'process');
   // Paid receipts retain their frozen semantic identity when another
   // configuration is published. New sends still require the latest config.
   await owner(c,run,false);
   const rows=pages.flatMap(({call,results})=>{
    if(call.inputs.length!==1||results.length!==1)return fail('listening_result_lineage_invalid');
    const input=call.inputs[0]!,result=results[0]!;
    if(result.root_id!==input.root_id||result.input_digest!==input.input_digest||result.entity_context_digest!==run.entity_context_digest
     ||digest(result.question_digests)!==digest(input.question_digests))fail('listening_result_lineage_invalid');
    if(result.status==='error')return [];
    if(Object.keys(result.answers).sort().join(',')!==[...input.question_keys].sort().join(','))fail('listening_response_invalid');
    return Object.entries(result.answers).map(([key,answer])=>({root_id:input.root_id,input_digest:input.input_digest,
     question_key:key,question_digest:input.question_digests[key],answer,call_id:call.id}));
   });
   if(rows.length)await c.query(`INSERT INTO signal_listening_answers(workspace_id,root_id,input_digest,entity_context_digest,
    question_digest,question_key,answer,run_id,call_id,request_digest,raw_sha256)
    SELECT $1,x.root_id,x.input_digest,$2,x.question_digest,x.question_key,x.answer,$3,x.call_id,call.request_digest,call.raw_sha256
    FROM jsonb_to_recordset($4::jsonb)x(root_id uuid,input_digest text,question_digest text,question_key text,answer jsonb,call_id uuid)
    JOIN signal_labeling_calls call ON call.id=x.call_id AND call.run_id=$3 AND call.workspace_id=$1
    ON CONFLICT(workspace_id,root_id,input_digest,entity_context_digest,question_digest) DO NOTHING`,
    [run.workspace_id,run.entity_context_digest,run.id,JSON.stringify(rows)]);
   const failures=pages.flatMap(p=>p.results[0]?.status==='error'?[{call_id:p.call.id,root_id:p.call.inputs[0]!.root_id,error_code:p.results[0].error_code}]:[]);
   if(failures.length)await c.query(`INSERT INTO signal_listening_failures(call_id,workspace_id,run_id,root_id,error_code)
    SELECT x.call_id,$1,$2,x.root_id,x.error_code FROM jsonb_to_recordset($3::jsonb)x(call_id uuid,root_id uuid,error_code text)
    ON CONFLICT(call_id) DO NOTHING`,[run.workspace_id,run.id,JSON.stringify(failures)]);
  },
 }});
 return {...store,async claim(id:string){
  if(!(await options.database.query('SELECT 1 FROM signal_listening_runs WHERE run_id=$1',[id])).rows.length)return null;
  return store.claim(id);
 }};
}
