import assert from 'node:assert/strict';
import test from 'node:test';
import { hybridCitationJudgeIdentityV1, hybridSentenceSpansV1, buildHybridCitationRequestV1,
  parseHybridCitationGroupV1, buildHybridCitationVerificationV1, mapHybridCitationVerificationV1,
  hybridCitationOutcomeV1 } from './signal-hybrid-citation-quality-v1';
import type { MembershipInputV1, ConceptForJudgeV1 } from './signal-concept-membership-v1';
const concept = {concept_key:'practice',label:'Practice',scope:'all_conversations',definition:'A completed activity and a named destination',inclusion:['completed activity','named destination'],exclusion:['hypothesis'],positive_examples:[],negative_examples:[],definition_digest:'sha256:'+ 'a'.repeat(64)} as ConceptForJudgeV1;
const text='A customer completed the activity. The destination was named explicitly. A hypothesis is excluded.';
const input={root_id:'root',input_digest:'i',root_fingerprint:'f',text,entity_context_digest:'c',effective_entities_digest:'e',evaluated_concepts:[concept],entities:[],title:null,platform:null,content_type:null,author:null} as unknown as MembershipInputV1;
const response=(ids:string[])=>JSON.stringify({contract_version:'concept-membership-judge-v1',roots:[{root_ordinal:0,memberships:[{concept_key:'practice',verdict:'belongs',span_ids:ids,rationale:'The completed activity and destination are explicit.'}]}]});
test('H1 sentence partition preserves full sentences, exact UTF-16 offsets and root ownership',()=>{
 const spans=hybridSentenceSpansV1([input]);assert.equal(spans.length,3);
 assert.equal(spans.map(s=>s.quote).join(''),text);
 for(const s of spans)assert.equal(text.slice(s.quote_start,s.quote_end),s.quote);
 const long='A '+ 'word '.repeat(90)+'.';assert.equal(hybridSentenceSpansV1([{...input,text:long}]).length,1);
});
test('H1 accepts up to three same-root fragments and rejects four, duplicates and other roots',()=>{
 assert.equal(parseHybridCitationGroupV1(response(['r0c0s0','r0c0s1']),[input]).results[0]?.citations.length,2);
 for(const ids of [['r0c0s0','r0c0s1','r0c0s2','r0c0s3'],['r0c0s0','r0c0s0'],['r1c0s0']])
  assert.equal(parseHybridCitationGroupV1(response(ids),[input]).results[0]?.verdict,'error');
});
test('H1 uses a new identity, fixed batch schema, low effort and a generic decisive-fact prompt',()=>{
 const id=hybridCitationJudgeIdentityV1();const request=buildHybridCitationRequestV1([input],{entities:[]},[concept],id);
 const second=buildHybridCitationRequestV1([input,{...input,root_id:'other'}],{entities:[]},[concept],id);
 assert.deepEqual(request.output_config.format.schema,second.output_config.format.schema);
 assert.equal(request.output_config.effort,'low');assert.equal(request.system[0]!.cache_control.ttl,'1h');
 assert.match(request.system[0]!.text,/decisive fact/);assert.match(request.system[0]!.text,/hypotheses/i);
 assert.doesNotMatch(request.system[0]!.text,/National|Alexa|rent(?:al)? cars/i);
});
test('one noul verification uses only cited fragments and full concept; one retry then review',()=>{
 const citations=[{quote:'A customer completed the activity. ',start:0,end:35}];
 const request=buildHybridCitationVerificationV1(concept,citations);
 assert.equal(request.questions.support?.type,'noul');assert.deepEqual(request.state,{fragments:citations.map(c=>c.quote)});
 assert.equal(mapHybridCitationVerificationV1({model:'jev-1.13.0',usage:{input_tokens:1,output_tokens:0},answers:{support:{type:'noul',noul:.8}}}).supported,true);
 assert.equal(hybridCitationOutcomeV1(false,0),'retry');assert.equal(hybridCitationOutcomeV1(false,1),'review_required');
 assert.equal(hybridCitationOutcomeV1(true,1),'belongs');
});
test('invalid or missing noul is a technical failure, never a semantic support rejection',()=>{
 for(const answers of [{},{support:{type:'noul',noul:NaN}},{support:{type:'noul',noul:1.1}}])
  assert.throws(()=>mapHybridCitationVerificationV1({model:'jev-1.13.0',usage:{input_tokens:1,output_tokens:0},answers} as never),/hybrid_citation_answer_invalid/);
 assert.equal(mapHybridCitationVerificationV1({model:'jev-1.13.0',usage:{input_tokens:1,output_tokens:0},answers:{support:{type:'noul',noul:0.1}}}).supported,false);
});
test('first valid rejection stays pending; only a second valid rejection becomes review_required',async()=>{
 const {decideHybridMembershipV1}=await import('./signal-hybrid-membership-v1');
 const citation={quote:text,start:0,end:text.length};
 const jev={verdict:'belongs' as const,probability:0.8,citation};
 const claude={verdict:'belongs' as const,citation,citations:[citation]};
 assert.equal(decideHybridMembershipV1(text,jev,{...claude,verification:{supported:false,probability:0.1,attempt:0}}).verdict,'pending');
 assert.equal(decideHybridMembershipV1(text,jev,{...claude,verification:{supported:false,probability:0.1,attempt:1}}).verdict,'review_required');
 assert.equal(decideHybridMembershipV1(text,jev,{...claude,verification:{supported:false,probability:null,attempt:1}}).verdict,'error');
});
