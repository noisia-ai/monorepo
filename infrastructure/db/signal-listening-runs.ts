import {assertSignalListeningDiscoveryInitialPreparationWithClientV1,bindSignalListeningDiscoveryInitialAdmissionWithClientV1} from './signal-listening-discovery-initial';
import type {PoolClient} from 'pg';
import {signalListeningJevIdentityV1,validateSignalListeningConfigurationV1,labelerDigestV1,compileSignalListeningSnapshotV1,buildSignalListeningCompiledRequestV1,
 signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningInputV1,type SignalListeningResultV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {requestMentionFacetsV1,createSignalLabelingStoreV1,type LabelingRunV1,type LabelingCallV1} from './signal-labeling-runs';
import {type LabelingInputBoundsV1} from './signal-labeling-input-bounds';
import {hydrateListeningInputProjectionV1,type ListeningInputProjectionRowV1} from './signal-listening-input-projection';
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
const unansweredScope=`p.candidate AND p.scope_state='included' AND p.answer IS NULL
 AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)`;
// FULL joins below consume scoped sets; filters stay beyond the materialized
// barrier so a missing reservation never becomes a repeated correlated scan.
const unresolvedScope="p.candidate AND p.scope_state='included' AND p.answer IS NULL";
const noHumanDecision=`NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)`;
async function inputMetadata(c:Pick<PoolClient,'query'>,run:LabelingRunV1,limit:number){
 const o=await owner(c,run,false);
 if(await latestConfigurationId(c,run.workspace_id)!==o.configuration_id)return{o,rows:[]};
 const fixed=Buffer.byteLength(JSON.stringify(run.identity))+Buffer.byteLength(JSON.stringify(run.context))+Buffer.byteLength(JSON.stringify(config(run)));
 // This cursor belongs only to the caller's RR snapshot. Never retain it on
 // the run: applying base answers may enable an earlier consumer root next TX.
 const rows:Array<{root_id:string;working_bytes:string}>=[];
 let cursor:string|null=null;
 const sliceSize=Math.min(4096,Math.max(64,limit));
 while(rows.length<limit){
  const ids:string[]=(await c.query<{root_id:string}>(`/* labeling_listening_root_page_v1 */
   SELECT i.root_id FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$2
    AND EXISTS(SELECT 1 FROM signal_listening_questions q WHERE q.configuration_id=$4::uuid
     AND NOT EXISTS(SELECT 1 FROM signal_listening_call_questions sent
      WHERE sent.workspace_id=$1 AND sent.run_id=$5::uuid AND sent.root_id=i.root_id AND sent.question_digest=q.question_digest))
    ${cursor?'AND i.root_id>$6::uuid':''} ORDER BY i.root_id LIMIT $3`,
   [run.workspace_id,o.map_id,sliceSize,o.configuration_id,run.id,...(cursor?[cursor]:[])])).rows.map(row=>row.root_id);
  if(!ids.length)break;
  const page=(await c.query<{root_id:string;working_bytes:string}>(`/* labeling_listening_input_metadata_v1 */ WITH candidates AS MATERIALIZED(
   SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,octet_length(p.body)::bigint text_bytes,octet_length(p.wire::text)::bigint wire_bytes,
    (octet_length(p.question_key)+octet_length(p.question_digest)+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,
    octet_length(COALESCE(p.platform,''))::bigint platform_bytes
   FROM signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing') p WHERE ${unresolvedScope}
  ), sent AS MATERIALIZED(
   SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5 AND root_id=ANY($8::uuid[])
  ), reservation_matches AS MATERIALIZED(
   SELECT p.*,sent.root_id reserved_root_id FROM candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest
  ), pending AS MATERIALIZED(
   SELECT root_id,question_key,text_bytes,wire_bytes,question_metadata_bytes,platform_bytes,
    row_number() OVER(PARTITION BY root_id ORDER BY question_key) n
   FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL AND ${noHumanDecision})
   SELECT root_id,(4::bigint*(12*max(text_bytes)+2*sum(wire_bytes)+6*sum(question_metadata_bytes)+6*max(platform_bytes)+$7::bigint+2048)+8192)::text working_bytes
   FROM pending WHERE n<=256 GROUP BY root_id ORDER BY root_id LIMIT $6`,
   [run.workspace_id,o.configuration_id,o.map_id,run.entity_context_digest,run.id,limit-rows.length,fixed,ids])).rows;
  rows.push(...page);cursor=ids.at(-1)!;
  // An excluded/awaiting-base/reserved slice is not exhaustion. Only the
  // source ID page can establish that there are no later roots in this TX.
  if(ids.length<sliceSize)break;
 }

 return{o,rows};
}
// Bounded read only: projection lifetime ends with the caller's RR snapshot.
async function inputProjectionMetadata(c:Pick<PoolClient,'query'>,run:LabelingRunV1,bounds:LabelingInputBoundsV1){
 const limit=bounds.max_rows;
 const o=await owner(c,run,false);
 if(await latestConfigurationId(c,run.workspace_id)!==o.configuration_id)return{o,rows:[]};
 const fixed=Buffer.byteLength(JSON.stringify(run.identity))+Buffer.byteLength(JSON.stringify(run.context))+Buffer.byteLength(JSON.stringify(config(run)));
 // This cursor belongs only to the caller's RR snapshot. Never retain it on
 // the run: applying base answers may enable an earlier consumer root next TX.
 const rows:ListeningInputProjectionRowV1[]=[];
 let remaining=BigInt(bounds.max_working_bytes);
 let cursor:string|null=null;
 const sliceSize=Math.min(4096,Math.max(64,limit));
 while(rows.length<limit){
  const ids:string[]=(await c.query<{root_id:string}>(`/* labeling_listening_root_page_v1 */
   SELECT i.root_id FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$2
    AND EXISTS(SELECT 1 FROM signal_listening_questions q WHERE q.configuration_id=$4::uuid
     AND NOT EXISTS(SELECT 1 FROM signal_listening_call_questions sent
      WHERE sent.workspace_id=$1 AND sent.run_id=$5::uuid AND sent.root_id=i.root_id AND sent.question_digest=q.question_digest))
    ${cursor?'AND i.root_id>$6::uuid':''} ORDER BY i.root_id LIMIT $3`,
   [run.workspace_id,o.map_id,sliceSize,o.configuration_id,run.id,...(cursor?[cursor]:[])])).rows.map(row=>row.root_id);
  if(!ids.length)break;
  const page=(await c.query<ListeningInputProjectionRowV1>(`/* labeling_listening_input_metadata_v1 */ WITH candidates AS MATERIALIZED(
   SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,p.body_octets::bigint text_bytes,octet_length(p.wire::text)::bigint wire_bytes,
    (octet_length(p.question_key)+octet_length(p.question_digest)+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,
    p.platform_octets::bigint platform_bytes
   FROM signal_listening_wire_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing') p WHERE ${unresolvedScope}
  ), sent AS MATERIALIZED(
   SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5 AND root_id=ANY($8::uuid[])
  ), reservation_matches AS MATERIALIZED(
   SELECT p.*,sent.root_id reserved_root_id FROM candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest
  ), pending AS MATERIALIZED(
   SELECT root_id,input_digest,question_key,question_digest,scope_basis,text_bytes,wire_bytes,question_metadata_bytes,platform_bytes,
    row_number() OVER(PARTITION BY root_id ORDER BY question_key) n
   FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL AND ${noHumanDecision})
   , root_metadata AS MATERIALIZED(
    SELECT root_id,(4::bigint*(12*max(text_bytes)+2*sum(wire_bytes)+6*sum(question_metadata_bytes)+6*max(platform_bytes)+$7::bigint+2048)+8192)::text working_bytes
    FROM pending WHERE n<=256 GROUP BY root_id ORDER BY root_id LIMIT $6
   ), prefix AS MATERIALIZED(
    SELECT root_id,working_bytes,sum(working_bytes::numeric) OVER(ORDER BY root_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cumulative_bytes
    FROM root_metadata
   ), fitting AS MATERIALIZED(SELECT root_id FROM prefix WHERE cumulative_bytes<=$9::numeric),
   fit_matches AS MATERIALIZED(
    SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,p.n,f.root_id fitting_root_id
    FROM pending p FULL JOIN fitting f ON f.root_id=p.root_id
   ), projections AS MATERIALIZED(
    SELECT p.root_id,p.input_digest,array_agg(p.question_key ORDER BY p.question_key) question_keys,
     jsonb_object_agg(p.question_key,p.question_digest) question_digests,
     COALESCE(jsonb_object_agg(p.question_key,p.scope_basis) FILTER(WHERE p.scope_basis IS NOT NULL),'{}'::jsonb) scope_basis
    FROM fit_matches p WHERE p.root_id IS NOT NULL AND p.fitting_root_id IS NOT NULL AND p.n<=256 GROUP BY p.root_id,p.input_digest
   ), projection_rows AS MATERIALIZED(
    SELECT prefix.root_id,prefix.working_bytes,projections.root_id projection_root_id,projections.input_digest,
     projections.question_keys,projections.question_digests,projections.scope_basis
    FROM prefix FULL JOIN projections ON projections.root_id=prefix.root_id
   )
   SELECT root_id,working_bytes,CASE WHEN projection_root_id IS NOT NULL THEN
    jsonb_build_object('input_digest',input_digest,'question_keys',question_keys,
      'question_digests',question_digests,'scope_basis',scope_basis) END projection
   FROM projection_rows WHERE root_id IS NOT NULL ORDER BY root_id`,
   [run.workspace_id,o.configuration_id,o.map_id,run.entity_context_digest,run.id,limit-rows.length,fixed,ids,remaining.toString()])).rows;
  rows.push(...page);
  // Budget belongs to the complete ordered read, never to each ID slice.
  // A non-fitting sentinel still reaches the canonical JS prefix validator.
  for(const row of page)remaining-=BigInt(row.working_bytes);
  if(remaining<0n)remaining=0n;
  cursor=ids.at(-1)!;
  if(page.length&&remaining===0n)break;
  // An excluded/awaiting-base/reserved slice is not exhaustion. Only the
  // source ID page can establish that there are no later roots in this TX.
  if(ids.length<sliceSize)break;
 }

 return{o,rows};
}
async function inputs(c:Pick<PoolClient,'query'>,run:LabelingRunV1,limit:number,bounds?:LabelingInputBoundsV1):Promise<SignalListeningInputV1[]>{
 if(bounds){
  const metadata=await inputProjectionMetadata(c,run,bounds);
  return hydrateListeningInputProjectionV1(c,{workspace_id:run.workspace_id,map_id:metadata.o.map_id,
   configuration_digest:metadata.o.configuration_digest},metadata.rows,bounds);
 }
 const selected=null;
 const o=await owner(c,run,false);
 if(await latestConfigurationId(c,run.workspace_id)!==o.configuration_id)return [];
 const hydratePopulation=population;
 const rows=(await c.query<{root_id:string;input_digest:string;body:string;published_at:Date|string;platform:string|null;
  question_keys:string[];question_digests:Record<string,string>;scope_basis:Record<string,string>}>(`/* labeling_listening_inputs_v1 */ WITH candidates AS MATERIALIZED(
  SELECT p.root_id,p.input_digest,p.body,p.published_at,p.platform,p.question_key,p.question_digest,p.scope_basis
  FROM ${hydratePopulation} p WHERE ${unresolvedScope}
 ), sent AS MATERIALIZED(
  SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5
   AND root_id=ANY(${selected?'$7::uuid[]':`ARRAY(SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$3)`})
 ), reservation_matches AS MATERIALIZED(
  SELECT p.*,sent.root_id reserved_root_id FROM candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest
 ), pending AS MATERIALIZED(
  SELECT root_id,input_digest,body,published_at,platform,question_key,question_digest,scope_basis,
   row_number() OVER(PARTITION BY root_id ORDER BY question_key) n
  FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL AND ${noHumanDecision})
  SELECT root_id,input_digest,body,published_at,platform,array_agg(question_key ORDER BY question_key) question_keys,
   jsonb_object_agg(question_key,question_digest) question_digests,
   COALESCE(jsonb_object_agg(question_key,scope_basis) FILTER(WHERE scope_basis IS NOT NULL),'{}'::jsonb) scope_basis
  FROM pending WHERE n<=256 GROUP BY root_id,input_digest,body,published_at,platform ORDER BY root_id LIMIT $6`,
  [run.workspace_id,o.configuration_id,o.map_id,run.entity_context_digest,run.id,limit,...(selected?[selected]:[])])).rows;
 return rows.map(row=>({root_id:row.root_id,input_digest:row.input_digest,text:row.body,title:null,platform:row.platform,
  content_type:null,author:null,published_at:new Date(row.published_at).toISOString(),language:null,map_id:o.map_id,
  configuration_digest:o.configuration_digest,question_keys:row.question_keys,question_digests:row.question_digests,scope_basis:row.scope_basis}));
}
async function pendingAndAvailable(c:Pick<PoolClient,'query'>,run:LabelingRunV1):Promise<{pending:number;available:boolean}>{
 const o=await owner(c,run,false);
 const row=(await c.query<{pending:number;available:boolean}>(`/* labeling_listening_pending_available_v1 */
  WITH pending AS MATERIALIZED(
   SELECT p.root_id,p.question_digest FROM signal_listening_compact_population_v1($1::uuid,$2::uuid,$3::uuid,$4::text) p WHERE ${unansweredScope}
    AND $2::uuid=(SELECT id FROM signal_listening_configurations WHERE workspace_id=$1 AND state='published' ORDER BY revision DESC LIMIT 1)
  ) SELECT count(DISTINCT root_id)::int pending,EXISTS(
   SELECT 1 FROM pending p WHERE NOT EXISTS(SELECT 1 FROM signal_listening_call_questions sent
    WHERE sent.run_id=$5 AND sent.workspace_id=$1 AND sent.root_id=p.root_id AND sent.question_digest=p.question_digest)
  ) available FROM pending`,[run.workspace_id,o.configuration_id,o.map_id,run.entity_context_digest,run.id])).rows[0]!;
 return row;
}
export async function requestSignalListeningV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string;
 idempotency_key:string;cap_micro_usd:number;provider_available:boolean;preparation_id?:string;initial_discovery?:boolean}){
 const stored=await getForRequest(args),identity=signalListeningJevIdentityV1(stored.configuration);
 return requestMentionFacetsV1({...args,identity,full_recalculation:true,adapter:{
  request_identity:{contract_version:'signal-listening-run-v1',configuration_id:stored.id,map_id:args.map_id,full_corpus:true,...(args.preparation_id?{preparation_id:args.preparation_id}:{}),...(args.initial_discovery?{initial_discovery:true}:{})},
  context_registration:'change_only',
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
    COALESCE(sum(body_chars+wire_chars+512),0)::text chars FROM signal_listening_compact_population_v1($1::uuid,$2::uuid,$3::uuid,$4::text) p
    WHERE candidate AND scope_state<>'excluded' AND answer IS NULL
     AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)`,[workspace,stored.id,map.id,map.entity_context_digest])).rows[0]!;
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
  kind:'mass_labeling',recover_failed_raw:true,policy_action:'mass_labeling_jev',feature:'mass_labeling',pending_calls_only:true,persist_results_before_write:true,parallel_native_pages:Boolean(options.rawPages),
  reserve_selection:'native_listening_pending',
  inputs:(c,run)=>inputs(c,run,limit),
  bounded_inputs:(c,run,bounds)=>inputs(c,run,limit,bounds),
  has_inputs:async(c,run)=>(await inputMetadata(c,run,1)).rows.length>0,
  authority:async(c,run)=>{await owner(c,run,false);},
  beforeSubmit:async(c,run,calls)=>{
   await owner(c,run);
   const snapshot=compileSignalListeningSnapshotV1(config(run));
   for(const call of calls){if(call.inputs.length!==1||digest(call.request)!==digest(buildSignalListeningCompiledRequestV1(call.inputs[0]!,snapshot)))fail('listening_request_invalid');}
  },
  pending:async(c,run)=>(await pendingAndAvailable(c,run)).pending,
  pending_and_available:pendingAndAvailable,
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
