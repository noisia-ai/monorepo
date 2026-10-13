import type {HybridStageResultV1} from './signal-hybrid-runs';
type Result=HybridStageResultV1&{text:string};
/** Complete coverage preserves a positive witness; only verification can publish it. */
export function reduceHybridWindowResultsV1(results:Result[]):Result[]{
 const groups=new Map<string,Result[]>(),ordinary:Result[]=[];
 for(const result of results){
  if(!result.citation_window){ordinary.push(result);continue;}
  const key=JSON.stringify([result.root_id,result.root_fingerprint,result.concept_key,result.definition_digest,result.entity_context_digest,result.effective_entities_digest]);
  groups.set(key,[...(groups.get(key)??[]),result]);
 }
 for(const group of groups.values()){
  const ordered=[...group].sort((a,b)=>a.citation_window!.index-b.citation_window!.index);
  const count=ordered[0]!.citation_window!.count;
  if(new Set(ordered.map(r=>r.citation_window!.index)).size!==ordered.length)throw Error('hybrid_duplicate_window_result');
  if(ordered.length<count)continue;
  if(ordered.length!==count||ordered.some((r,i)=>r.citation_window!.count!==count||r.citation_window!.index!==i
    ||r.citation_window!.start!==(i===0?0:ordered[i-1]!.citation_window!.end)||r.text!==ordered[0]!.text)
    ||ordered.at(-1)!.citation_window!.end!==ordered[0]!.text.length)throw Error('hybrid_window_coverage_invalid');
  const selected=ordered.find(r=>r.claude?.verdict==='belongs'&&r.claude.verification?.supported)
   ??ordered.find(r=>r.claude?.verdict==='belongs')??ordered.find(r=>r.claude?.verdict==='error')
   ??ordered.find(r=>r.claude?.verdict==='refused')??ordered.find(r=>r.claude?.verdict==='insufficient')??ordered[0]!;
  ordinary.push(selected);
 }
 return ordinary;
}

/** Latest paid result per unchanged pair/window in this run's bounded ancestry.
 * A repair replaces only its rejected window; successful windows keep their receipts. */
export const hybridSettledWindowResultsSqlV1=`WITH RECURSIVE sources AS (
 SELECT id,workspace_id,membership_snapshot,0 depth FROM signal_labeling_runs WHERE id=$1
 UNION ALL
 SELECT parent.id,parent.workspace_id,parent.membership_snapshot,source.depth+1
 FROM sources source JOIN signal_labeling_runs parent ON parent.id::text=source.membership_snapshot->>'source_run_id'
  AND parent.workspace_id=source.workspace_id
  AND parent.membership_snapshot->>'route_digest'=source.membership_snapshot->>'route_digest'
 WHERE source.depth<8
), applied AS (
 SELECT result,input,call.created_at,call.id,source.depth FROM sources source
 JOIN signal_labeling_calls call ON call.run_id=source.id AND call.workspace_id=source.workspace_id
 CROSS JOIN LATERAL jsonb_array_elements(call.results) result
 JOIN LATERAL jsonb_array_elements(call.inputs) input ON input->>'root_id'=result->>'root_id'
  AND input->'citation_window'=result->'citation_window'
 WHERE call.status='settled' AND call.results_applied AND source.membership_snapshot->>'hybrid_stage'='claude'
  AND result ? 'citation_window'
), latest AS (
 SELECT DISTINCT ON(result->>'root_id',result->>'root_fingerprint',result->>'concept_key',result->>'definition_digest',
  result->>'entity_context_digest',result->>'effective_entities_digest',result#>>'{citation_window,index}') *
 FROM applied ORDER BY result->>'root_id',result->>'root_fingerprint',result->>'concept_key',result->>'definition_digest',
  result->>'entity_context_digest',result->>'effective_entities_digest',result#>>'{citation_window,index}',depth,created_at DESC,id DESC
) SELECT result,input,depth,created_at,id FROM latest`;
