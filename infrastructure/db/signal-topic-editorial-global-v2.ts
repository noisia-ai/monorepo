import {
  parseSignalTopicConsolidationRevisionV1,signalTopicConsolidationDigestV1,
  type SignalTopicConsolidationRevisionV1,
} from './signal-topic-consolidation';
import {
  buildSignalTopicEditorialGlobalReviewV2,
  validateSignalTopicEditorialGlobalResultV2,
  type SignalTopicEditorialGlobalReviewV2,type SignalTopicEditorialGlobalUnitV2,
} from '../../packages/query-engine/src';
import type {Pool} from 'pg';

export type SignalTopicEditorialGlobalCatalogV2={revision:SignalTopicConsolidationRevisionV1;
  concept_metadata:Map<string,{priority_rank:number;priority_rationale:string;global_request_digest:string;cited_ref_ids:string[]}>;
  outcome_counts:{topic:number;narrative:number;noise:number;insufficient_evidence:number;technical_error:number}};

/** Read the accepted screening receipts from a single stable snapshot. A
 * rejected or still-pending group cannot silently disappear from the global
 * request. The owner remains the same paid execution and no SQL is written. */
export async function loadSignalTopicEditorialGlobalReviewV2(args:{database:Pick<Pool,'connect'>;
  workspace_id:string;actor_user_id:string;execution_id:string}):Promise<{
  numeric_run_id:string;units:SignalTopicEditorialGlobalUnitV2[];review:SignalTopicEditorialGlobalReviewV2}>{
  const client=await args.database.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const owner=(await client.query<{numeric_run_id:string;expected:number;stage:string;contract_version:string}>(`
      SELECT e.numeric_run_id::text,jsonb_array_length(e.plan->'requests') expected,o.stage,
        e.plan->>'contract_version' contract_version
      FROM signal_topic_editorial_executions e JOIN signal_topic_editorial_batch_owners_v2 o
        ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
      WHERE e.id=$1::uuid AND e.workspace_id=$2::uuid AND e.actor_user_id=$3::uuid`,
    [args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
    if(!owner||owner.contract_version!=='signal-topic-editorial-admission-header-v3'
      ||owner.stage!=='review_pending'||owner.expected<1)
      throw new Error('topic_editorial_global_not_ready');
    const units:SignalTopicEditorialGlobalUnitV2[]=[];
    for(let offset=0;offset<owner.expected;offset+=128){
      const rows=(await client.query<{request:SignalTopicEditorialGlobalUnitV2['request'];
        reused:SignalTopicEditorialGlobalUnitV2['decision'];accepted:SignalTopicEditorialGlobalUnitV2['decision'];
        settled:boolean}>(`
        SELECT r.receipts->'request' request,reused.decision reused,
          item.validation->'decision' accepted,item.settled
        FROM signal_topic_editorial_requests r
        LEFT JOIN signal_topic_editorial_reused_decisions_v2 reused ON reused.request_id=r.id
        LEFT JOIN LATERAL (
          SELECT entry.validation,c.status='settled' settled
          FROM signal_topic_editorial_batch_items_v2 entry
          JOIN signal_topic_editorial_calls c ON c.id=entry.call_id
          WHERE entry.request_id=r.id AND entry.validation->>'status'='accepted' AND c.status='settled'
          ORDER BY entry.validated_at DESC,entry.batch_id DESC LIMIT 1
        ) item ON true
        WHERE r.execution_id=$1::uuid ORDER BY r.batch_index LIMIT $2 OFFSET $3`,
      [args.execution_id,128,offset])).rows;
      if(!rows.length)throw new Error('topic_editorial_global_coverage_incomplete');
      for(const row of rows){
        if(Boolean(row.reused)===Boolean(row.accepted)||row.accepted&&!row.settled)
          throw new Error('topic_editorial_global_decision_missing');
        units.push({request:row.request,decision:row.reused??row.accepted,technical_error_code:null});
      }
    }
    if(units.length!==owner.expected)throw new Error('topic_editorial_global_coverage_incomplete');
    const review=buildSignalTopicEditorialGlobalReviewV2({units,expected_group_count:owner.expected});
    await client.query('COMMIT');
    return {numeric_run_id:owner.numeric_run_id,units,review};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally{client.release();}
}

/** The paid per-group decisions remain immutable. This is the provider-free
 * bridge from the reviewed global result to the existing revision graph;
 * nothing is activated or served by constructing this value. */
export function buildSignalTopicEditorialGlobalCatalogV2(args:{review:SignalTopicEditorialGlobalReviewV2;
  result:unknown;units:SignalTopicEditorialGlobalUnitV2[];revision:number}):SignalTopicEditorialGlobalCatalogV2{
  const result=validateSignalTopicEditorialGlobalResultV2({review:args.review,value:args.result});
  if(!Number.isSafeInteger(args.revision)||args.revision<1||args.units.length!==args.review.group_count)
    throw new Error('topic_editorial_global_catalog_input_invalid');
  const original=new Map(args.units.map(unit=>[unit.request.receipt.group_key,unit]));
  if(original.size!==args.review.group_count)throw new Error('topic_editorial_global_catalog_input_invalid');
  const final=new Map<string,{kind:'topic'|'narrative'|'noise'|'unresolved';concept_key:string|null}>();
  const metadata:SignalTopicEditorialGlobalCatalogV2['concept_metadata']=new Map();
  for(const concept of result.concepts){
    metadata.set(concept.concept_key,{priority_rank:concept.priority_rank,priority_rationale:concept.priority_rationale,
      global_request_digest:result.request_digest,cited_ref_ids:concept.cited_ref_ids});
    for(const group_key of concept.member_group_keys)final.set(group_key,{kind:concept.kind,concept_key:concept.concept_key});
  }
  for(const group_key of result.noise_group_keys)final.set(group_key,{kind:'noise',concept_key:null});
  for(const group_key of result.unresolved_group_keys)final.set(group_key,{kind:'unresolved',concept_key:null});
  if(final.size!==original.size||[...final.keys()].some(key=>!original.has(key)))
    throw new Error('topic_editorial_global_catalog_coverage_invalid');
  const concepts=result.concepts.map(item=>({concept_key:item.concept_key,kind:item.kind,label:item.label,
    definition:item.definition,locale:item.locale,source:'model' as const}));
  const decisions=[...final].map(([group_key,item])=>{
    const screening=original.get(group_key)!.decision;
    if(!screening||original.get(group_key)!.technical_error_code!==null)
      throw new Error('topic_editorial_global_catalog_technical_error');
    const unchanged=screening.disposition===item.kind;
    return {group_key,disposition:item.kind,concept_key:item.concept_key,source:'model' as const,
      confidence:unchanged?screening.confidence:null,rationale:unchanged?screening.rationale:null};
  });
  const body={contract_version:'signal-topic-consolidation-revision-v1' as const,revision:args.revision,concepts,decisions};
  const revision=parseSignalTopicConsolidationRevisionV1({...body,revision_digest:signalTopicConsolidationDigestV1(body)},
    [...original.keys()]);
  return {revision,concept_metadata:metadata,outcome_counts:{
    topic:decisions.filter(item=>item.disposition==='topic').length,
    narrative:decisions.filter(item=>item.disposition==='narrative').length,
    noise:decisions.filter(item=>item.disposition==='noise').length,
    insufficient_evidence:decisions.filter(item=>item.disposition==='unresolved').length,technical_error:0,
  }};
}
