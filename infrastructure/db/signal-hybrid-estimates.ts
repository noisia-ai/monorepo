import {llmCostMicroUsdV1,llmPriceV1} from '@noisia/query-engine';

/** Advisory worst-case remaining stages. Future estimates are never booked as paid calls. */
export function hybridPipelineEstimateV1(population:{characters:string;pairs:number},
 stage:'jev'|'claude'|'citation',citationRetry:boolean,jevPrice:number){
 const tokens=Math.ceil(Number(population.characters)/3.5)+population.pairs*500;
 const usage={input_tokens:tokens,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0,
  cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}};
 const jev=llmCostMicroUsdV1(usage,llmPriceV1('typesafe','jev-1.13.0','sync',jevPrice));
 const claude=llmCostMicroUsdV1({...usage,output_tokens:population.pairs*512},llmPriceV1('anthropic','claude-sonnet-5-5','batch'));
 const amounts={jev_micro_usd:stage==='jev'?jev:0,
  claude_initial_micro_usd:stage!=='citation'&&!citationRetry?claude:0,
  citation_initial_micro_usd:!citationRetry?jev:0,
  claude_repair_micro_usd:!citationRetry||stage==='claude'?claude:0,
  citation_final_micro_usd:jev};
 return {...amounts,total_micro_usd:Object.values(amounts).reduce((sum,n)=>sum+n,0),
  current_stage_micro_usd:stage==='claude'?claude:jev,
  basis:'all_remaining_pairs_positive_and_one_semantic_repair' as const};
}
