import assert from "node:assert/strict";
import test from "node:test";
import {massLabelingReceiptRecoveryFixtureV2 as fixture,syntheticNativeReceiptShaV2 as sha} from "./signal-mass-labeling-receipt-recovery-v2.synthetic.fixture";
import {buildMassLabelingConsolidationRecoveryDecisionV2 as build,recoverMassLabelingConsolidationResponseV1 as recover,parseMassLabelingConsolidationResponseV1 as parse} from "./signal-mass-labeling-consolidation-v1";

test("native V2 recovers only evidenced mixed singleton exclusions and existing English, with immutable raw and metering",()=>{
 const f=fixture(),before=JSON.stringify(f);assert.throws(()=>parse(f.batch,f.raw));
 const first=recover(f.batch,f.raw,f.decision);assert.deepEqual(recover(f.batch,f.raw,build({batch:f.batch,raw_response:f.raw,call_id:f.call_id})),first);
 assert.equal(JSON.stringify(f),before);assert.equal(first.output.topics.length,2);assert.equal(first.output.excluded_groups.length,2);
 assert.deepEqual(first.output.topics.map(t=>t.group_ids).flat(),f.batch.source_groups.slice(2).map(g=>g.group_id));
 assert.deepEqual(first.output.excluded_groups,f.output.excluded_groups);assert.deepEqual(first.output.category_lexicon,f.output.category_lexicon);
 assert.equal(first.output.topics[0]!.definition,f.output.topics[2]!.localization.en.definition);
 assert.deepEqual(first.usage,{input_tokens:100,output_tokens:80,cache_read_input_tokens:0,cache_creation_input_tokens:0});
});
test("V2 is bound to the exact scope, raw, plan, configuration, reason and wording digests",()=>{
 const f=fixture();for(const field of ['workspace_id','execution_id','request_digest','source_groups_digest','response_sha256'] as const){
  assert.throws(()=>recover(f.batch,f.raw,{...f.decision,[field]:field.endsWith('_id')?f.call_id:sha('changed')}));
 }
 for(const mutate of [(d:typeof f.decision)=>{d.singleton_exclusions[0]!.reason_sha256=sha('changed');},(d:typeof f.decision)=>{d.english_definition_reconciliations[0]!.english_definition_sha256=sha('changed');},(d:typeof f.decision)=>{d.singleton_exclusions.pop();}]){
  const d=structuredClone(f.decision);mutate(d);assert.throws(()=>recover(f.batch,f.raw,d));
 }
 assert.throws(()=>recover(f.batch,f.raw+' ',f.decision));
 const batch=structuredClone(f.batch);batch.category_context!.terms.push('changed');assert.throws(()=>build({batch,raw_response:f.raw,call_id:f.call_id}));
});
test("V2 rejects unsupported editorial changes and incomplete or ambiguous coverage",()=>{
 const f=fixture();const mutations:Array<(o:typeof f.output)=>void>=[
 o=>{o.topics[0]!.definition+=' invented';},o=>{o.topics[0]!.group_ids.push(o.topics[3]!.group_ids[0]!);},
 o=>{o.topics[2]!.definition='no '+o.topics[2]!.localization.en.definition;},o=>{o.topics[2]!.name+=' changed';},
 o=>{o.topics[3]!.definition='as '+o.topics[3]!.definition;},o=>{o.excluded_groups[0]!.reason='';},
 o=>{o.excluded_groups[0]!.reason='An unrelated exclusion.';},o=>{o.excluded_groups.splice(0);},
 o=>{o.topics[3]!.group_ids.push('guided:foreign');},o=>{o.topics[3]!.group_ids.push(o.topics[2]!.group_ids[0]!);},
 o=>{o.topics[3]!.topic_key=o.topics[2]!.topic_key;},o=>{o.topics[0]!.definition='as '+o.topics[0]!.definition;},
 ];
 for(const mutate of mutations){const output=structuredClone(f.output);mutate(output);const raw=JSON.stringify({...f.envelope,content:[{type:'text',text:JSON.stringify(output)}]});assert.throws(()=>build({batch:f.batch,raw_response:raw,call_id:f.call_id}));}
 const batch=structuredClone(f.batch);batch.source_groups[0]!.status='coherent';assert.throws(()=>build({batch,raw_response:f.raw,call_id:f.call_id}));
});
