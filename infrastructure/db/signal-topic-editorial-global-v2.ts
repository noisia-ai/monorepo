import {
  parseSignalTopicConsolidationRevisionV1,signalTopicConsolidationDigestV1,SignalTopicConsolidationContractError,
  type SignalTopicConsolidationRevisionV1,
} from './signal-topic-consolidation';
import {
  buildSignalTopicEditorialGlobalReviewV2,
  validateSignalTopicEditorialGlobalResultV2,
  type SignalTopicEditorialGlobalReviewV2,type SignalTopicEditorialGlobalUnitV2,
} from '../../packages/query-engine/src';
import type {Pool} from 'pg';
import {materializeSignalTopicConsolidationRevisionV1} from './signal-topic-consolidation';

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
 * nothing is activated or served by constructing this value. The current
 * global-result contract supplies citations per concept, not per member group:
 * persist those refs exactly and do not fabricate a group-level attribution. */
export function buildSignalTopicEditorialGlobalCatalogV2(args:{review:SignalTopicEditorialGlobalReviewV2;
  result:unknown;units:SignalTopicEditorialGlobalUnitV2[];revision:number}):SignalTopicEditorialGlobalCatalogV2{
  const result=validateSignalTopicEditorialGlobalResultV2({review:args.review,value:args.result});
  if(!Number.isSafeInteger(args.revision)||args.revision<1||args.units.length!==args.review.group_count
    ||args.units.some(unit=>unit.technical_error_code!==null||unit.decision===null))
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
  for(const concept of result.concepts){
    const members=new Set(concept.member_group_keys);
    const available=new Set([...members].flatMap(key=>original.get(key)!.request.receipt.evidence.map(item=>item.ref_id)));
    if(!concept.member_group_keys.length||concept.cited_ref_ids.some(ref=>!available.has(ref)))
      throw new Error('topic_editorial_global_catalog_citation_invalid');
  }
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

/** Compare the persisted logical revision, independent of its sequence number.
 * If concepts exist, priority and citation metadata must also match exactly. */
export function signalTopicEditorialGlobalCatalogReplayCompatibleV2(args:{desired:SignalTopicEditorialGlobalCatalogV2;
  existing_revision:unknown;existing_concept_metadata:Map<string,unknown>}):boolean{
  try{
    const groupKeys=args.desired.revision.decisions.map(item=>item.group_key);
    const existing=parseSignalTopicConsolidationRevisionV1(args.existing_revision,groupKeys);
    const logical=(revision:SignalTopicConsolidationRevisionV1)=>({contract_version:revision.contract_version,
      concepts:revision.concepts,decisions:revision.decisions});
    if(signalTopicConsolidationDigestV1(logical(existing))!==signalTopicConsolidationDigestV1(logical(args.desired.revision)))return false;
    if(args.desired.revision.concepts.length===0)return args.existing_concept_metadata.size===0;
    if(args.existing_concept_metadata.size!==args.desired.concept_metadata.size)return false;
    for(const [conceptKey,metadata] of args.desired.concept_metadata){
      const persisted=args.existing_concept_metadata.get(conceptKey);
      const expected={contract_version:'signal-topic-editorial-concept-metadata-v2',...metadata};
      if(!persisted||signalTopicConsolidationDigestV1(persisted)!==signalTopicConsolidationDigestV1(expected))return false;
    }
    return true;
  }catch{return false;}
}

async function findSignalTopicEditorialGlobalCatalogReplayV2(args:{database:Pick<Pool,'connect'>;workspace_id:string;
  numeric_run_id:string;desired:SignalTopicEditorialGlobalCatalogV2}):Promise<{revision_id:string;revision:number;
  revision_digest:string}|null>{
  const client=await args.database.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const candidates=(await client.query<{id:string;revision:number;revision_digest:string;status:string}>(`
      SELECT id::text,revision,revision_digest,status FROM signal_topic_consolidation_revisions
      WHERE workspace_id=$1::uuid AND consolidation_run_id=$2::uuid AND status IN('validated','superseded')
      ORDER BY revision DESC`,[args.workspace_id,args.numeric_run_id])).rows;
    const groupKeys=args.desired.revision.decisions.map(item=>item.group_key);
    for(const candidate of candidates){
      const storedConcepts=(await client.query<{concept_key:string;kind:'topic'|'narrative';label:string;definition:string;locale:string;
        source:'numeric'|'model'|'human';metadata:unknown}>(`SELECT concept_key,kind,label,definition,locale,source,metadata
        FROM signal_topic_editorial_concepts WHERE revision_id=$1::uuid ORDER BY concept_key COLLATE "C"`,[candidate.id])).rows;
      const storedDecisions=(await client.query<{group_key:string;disposition:'topic'|'narrative'|'noise'|'unresolved';concept_key:string|null;
        source:'numeric'|'model'|'human';confidence:number|null;rationale:string|null}>(`SELECT atomic.group_key,decision.disposition,
          concept.concept_key,decision.source,decision.confidence,decision.rationale
        FROM signal_topic_consolidation_decisions decision JOIN signal_topic_atomic_groups atomic
          ON atomic.id=decision.atomic_group_id AND atomic.consolidation_run_id=decision.consolidation_run_id
          AND atomic.workspace_id=decision.workspace_id LEFT JOIN signal_topic_editorial_concepts concept
          ON concept.id=decision.concept_id AND concept.revision_id=decision.revision_id
        WHERE decision.revision_id=$1::uuid ORDER BY atomic.group_key COLLATE "C"`,[candidate.id])).rows;
      if(storedDecisions.length!==groupKeys.length)continue;
      let existingRevision:SignalTopicConsolidationRevisionV1;
      try{existingRevision=parseSignalTopicConsolidationRevisionV1({contract_version:'signal-topic-consolidation-revision-v1',
        revision:candidate.revision,concepts:storedConcepts,decisions:storedDecisions,revision_digest:candidate.revision_digest},groupKeys);}
      catch{continue;}
      const metadata=new Map(storedConcepts.map(concept=>[concept.concept_key,concept.metadata]));
      if(signalTopicEditorialGlobalCatalogReplayCompatibleV2({desired:args.desired,existing_revision:existingRevision,
        existing_concept_metadata:metadata}))
        return {revision_id:candidate.id,revision:candidate.revision,revision_digest:candidate.revision_digest};
    }
    return null;
  }finally{
    await client.query('ROLLBACK').catch(()=>undefined);
    client.release();
  }
}

/** Commit only a complete, source-bound global result as a new immutable
 * revision. This is deliberately separate from Signal selection: the first
 * screening pass and a partially imported Batch never become a catalog. */
export async function materializeSignalTopicEditorialGlobalCatalogV2(args:{database:Pool;
  workspace_id:string;actor_user_id:string;execution_id:string;result:unknown}){
  const source=await loadSignalTopicEditorialGlobalReviewV2(args);
  const catalogAtRevisionOne=buildSignalTopicEditorialGlobalCatalogV2({review:source.review,result:args.result,
    units:source.units,revision:1});
  const replay=await findSignalTopicEditorialGlobalCatalogReplayV2({database:args.database,workspace_id:args.workspace_id,
    numeric_run_id:source.numeric_run_id,desired:catalogAtRevisionOne});
  if(replay)return {consolidation_run_id:source.numeric_run_id,...replay,replayed:true,
    outcome_counts:catalogAtRevisionOne.outcome_counts,global_request_digest:source.review.request_digest};
  const revision=(await (async()=>{
    const client=await args.database.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query('SET LOCAL search_path=public,extensions,pg_temp');
      const row=(await client.query<{revision:number}>(`SELECT COALESCE(max(revision),0)+1 revision
        FROM signal_topic_consolidation_revisions WHERE workspace_id=$1::uuid AND consolidation_run_id=$2::uuid`,
      [args.workspace_id,source.numeric_run_id])).rows[0];
      await client.query('COMMIT');
      return row?.revision??1;
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
    finally{client.release();}
  })());
  const catalog=revision===1?catalogAtRevisionOne:buildSignalTopicEditorialGlobalCatalogV2({review:source.review,result:args.result,
    units:source.units,revision});
  let stored;
  try{stored=await materializeSignalTopicConsolidationRevisionV1({database:args.database,
    workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,consolidation_run_id:source.numeric_run_id,
    revision:catalog.revision,concept_metadata:catalog.concept_metadata});}
  catch(error){
    if(!(error instanceof SignalTopicConsolidationContractError)
      ||!['topic_consolidation_revision_replay_conflict','topic_consolidation_revision_sequence_invalid',
        'topic_consolidation_prior_revision_invalid'].includes(error.code))throw error;
    const racedReplay=await findSignalTopicEditorialGlobalCatalogReplayV2({database:args.database,workspace_id:args.workspace_id,
      numeric_run_id:source.numeric_run_id,desired:catalogAtRevisionOne});
    if(!racedReplay)throw error;
    return {consolidation_run_id:source.numeric_run_id,...racedReplay,replayed:true,
      outcome_counts:catalogAtRevisionOne.outcome_counts,global_request_digest:source.review.request_digest};
  }
  return {...stored,outcome_counts:catalog.outcome_counts,global_request_digest:source.review.request_digest};
}
