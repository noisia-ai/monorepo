import type { HybridStageResultV1 } from '../../infrastructure/db/signal-hybrid-runs';
type Call={id:string;run_id:string;stage:string;source_run_id:string|null;status:string;results:HybridStageResultV1[]};
/** All calls remain in the ledger. Only their governed semantic successor replaces a pair in scoring. */
export function hybridReceiptResultsV1(calls:Call[]){
 const jev=new Map<string,HybridStageResultV1>(),claude=new Map<string,HybridStageResultV1>();
 const prior=new Map<string,{call:Call;result:HybridStageResultV1}>();
 for(const call of calls){
  if(call.status!=='settled'&&call.status!=='failed')continue;
  for(const result of call.results??[]){
   const key=`${result.root_id}:${result.concept_key}`;
   if(call.stage==='jev'){
    if(jev.has(key)&&jev.get(key)!.jev.verdict!=='error')throw new Error('hybrid_duplicate_result');
    jev.set(key,result);continue;
   }
   const p=prior.get(key);
   if(call.stage==='citation'){
    if(!p||p.call.stage!=='claude'||call.source_run_id!==p.call.run_id||result.claude_call_id!==p.call.id)
     throw new Error('hybrid_citation_chain_invalid');
   }else if(call.stage==='claude'){
    if(p&&!(p.result.claude?.verdict==='error'||p.call.stage==='citation'&&p.result.claude?.verification?.supported===false&&call.source_run_id===p.call.run_id))
     throw new Error('hybrid_duplicate_result');
   }else throw new Error('hybrid_stage_invalid');
   claude.set(key,result);prior.set(key,{call,result});
  }
 }
 return {jev,claude};
}
