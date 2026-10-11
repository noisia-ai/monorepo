import type { HybridStageResultV1 } from '../../infrastructure/db/signal-hybrid-runs';
type Call={id:string;run_id:string;stage:string;source_run_id:string|null;status:string;results:HybridStageResultV1[]};
/** All calls remain in the ledger. Only their governed semantic successor replaces a pair in scoring. */
export function hybridReceiptResultsV1(calls:Call[]){
 const jev=new Map<string,HybridStageResultV1>(),claude=new Map<string,HybridStageResultV1>();
 const judgements=new Map<string,HybridStageResultV1>();
 const judgeCalls=new Map<string,Call>();
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
    const judge=judgeCalls.get(key);
    if(!p||!judge||!(p.call.stage==='claude'||p.call.stage==='citation'&&p.result.claude?.verdict==='error'&&!p.result.claude.verification)
      ||call.source_run_id!==judge.run_id||result.claude_call_id!==judge.id)
     throw new Error('hybrid_citation_chain_invalid');
   }else if(call.stage==='claude'){
    if(p&&!(p.result.claude?.verdict==='error'||p.call.stage==='citation'&&p.result.claude?.verification?.supported===false&&call.source_run_id===p.call.run_id))
     throw new Error('hybrid_duplicate_result');
    judgements.set(key,result);
    judgeCalls.set(key,call);
   }else throw new Error('hybrid_stage_invalid');
   claude.set(key,result);prior.set(key,{call,result});
  }
 }
 return {jev,claude,judgements};
}
