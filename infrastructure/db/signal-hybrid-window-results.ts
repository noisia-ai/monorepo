import type {HybridStageResultV1} from './signal-hybrid-runs';
type Result=HybridStageResultV1&{text:string};
/** Only complete, non-overlapping coverage produces one whole-root decision. */
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
  const selected=ordered.find(r=>r.claude?.verdict==='error')??ordered.find(r=>r.claude?.verdict==='refused')
   ??ordered.find(r=>r.claude?.verdict==='belongs')??ordered.find(r=>r.claude?.verdict==='insufficient')??ordered[0]!;
  ordinary.push(selected);
 }
 return ordinary;
}
