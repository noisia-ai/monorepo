import assert from 'node:assert/strict';
import test from 'node:test';
import {hybridPipelineEstimateV1} from '../signal-hybrid-estimates';
test('H1 forecasts every remaining stage without booking duplicate future reservations or a cap',()=>{
 const initial=hybridPipelineEstimateV1({characters:'3500',pairs:2},'claude',false,.042);
 assert.ok(initial.citation_initial_micro_usd>0);assert.ok(initial.claude_repair_micro_usd>0);assert.ok(initial.citation_final_micro_usd>0);
 assert.equal(initial.total_micro_usd,initial.claude_initial_micro_usd+initial.citation_initial_micro_usd+initial.claude_repair_micro_usd+initial.citation_final_micro_usd);
 const final=hybridPipelineEstimateV1({characters:'3500',pairs:2},'citation',true,.042);
 assert.equal(final.total_micro_usd,final.citation_final_micro_usd);
 assert.equal(hybridPipelineEstimateV1({characters:'0',pairs:0},'jev',false,.042).total_micro_usd,0);
});
