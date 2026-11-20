import assert from 'node:assert/strict';
import test from 'node:test';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1} from './signal-listening-contracts';
import {buildSignalListeningPrototypePlanV1} from './signal-listening-prototypes';

test('defined prototype inputs preserve exact positive bytes, deduplicate physical text and never invent taxonomy identities',()=>{
 const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['bike']});
 const topics=Array.from({length:9},(_,i)=>({key:`defined_${i}`,type:'noul' as const,text:`Does topic ${i} apply?`,positive:i<2?'Repair café — 🍵':`Definition ${i}`,
  negative:'Unrelated',scope:'all' as const,origin:'brand_os' as const,human_locked:true,topic_source:'defined' as const}));
 const c=validateSignalListeningConfigurationV1({...base,questions:[...base.questions,...topics]});
 const plan=buildSignalListeningPrototypePlanV1({workspace_id:'workspace',configuration_id:'config',configuration:c});
 assert.equal(plan.inputs.length,9);assert.equal(Object.keys(plan.texts).length,8);
 assert.ok(Object.values(plan.texts).includes('Repair café — 🍵'));
 assert.equal(plan.inputs[0]!.text_sha256,plan.inputs[1]!.text_sha256);
 assert.notEqual(plan.inputs[0]!.input_digest,plan.inputs[1]!.input_digest);
 assert.doesNotMatch(JSON.stringify(plan),/taxonomy_term_id|taxonomy_profile_id/u);
 assert.equal(buildSignalListeningPrototypePlanV1({workspace_id:'workspace',configuration_id:'other',configuration:{...c,questions:[...base.questions,...topics.slice(0,8)]}}).inputs.length,0);
});
