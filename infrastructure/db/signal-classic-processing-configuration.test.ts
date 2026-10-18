import assert from 'node:assert/strict';
import test from 'node:test';
import { signalClassicPolicyCompletionConfigurationV1 } from './signal-classic-processing-configuration';
const env={NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID:'10000000-0000-4000-8000-000000000001',
 NOISIA_SEMANTIC_CONTEXT_MODEL:'claude-sonnet-4-6',NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION:'claude-sonnet-4-6',
 NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION:'synthetic-test',NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS:'10000',
 NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS:'64000',NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS:'3',
 NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS:'15'};
test('classic completion requires explicit identity/prices and preserves absent or configured strict maxima',()=>{
 const config=signalClassicPolicyCompletionConfigurationV1(env);
 assert.equal(config.available,true);assert.equal(config.semanticCap,null);assert.equal(config.prototypeCap,null);
 assert.equal(signalClassicPolicyCompletionConfigurationV1({}).available,false);
 const strict=signalClassicPolicyCompletionConfigurationV1({...env,NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD:'123',NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD:'456'});
 assert.equal(strict.semanticCap,'123');assert.equal(strict.prototypeCap,'456');
 for(const bad of ['0','-1','NaN','']){
  assert.equal(signalClassicPolicyCompletionConfigurationV1({...env,NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD:bad}).available,false);
  assert.equal(signalClassicPolicyCompletionConfigurationV1({...env,NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD:bad}).available,false);
 }
});
