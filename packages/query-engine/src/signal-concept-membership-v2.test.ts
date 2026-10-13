import assert from 'node:assert/strict';
import test from 'node:test';
import { membershipLabelerIdentityV1, type MembershipInputV1, type ConceptForJudgeV1 } from './signal-concept-membership-v1';
import { membershipLabelerIdentityV2, buildMembershipRequestV2, parseMembershipGroupV2, MEMBERSHIP_PROMPT_V2 } from './signal-concept-membership-v2';
import { signalWorkspaceEmbeddingDigestV1 as digest } from './signal-workspace-embeddings-v1';
const concept={concept_key:'experience',label:'Experience',scope:'all_conversations',definition:'A completed activity at a destination.',inclusion:[],exclusion:[],positive_examples:[],negative_examples:[],definition_digest:'sha256:'+'a'.repeat(64)} as ConceptForJudgeV1;
const text='The customer completed the activity. The destination was named. Another fact. Fourth fact.';
const input={root_id:'root',input_digest:'i',root_fingerprint:'f',text,entity_context_digest:'c',effective_entities_digest:'e',evaluated_concepts:[concept],entities:[],title:null,platform:null,content_type:null,author:null,voice:'consumer',act:'experience'} as unknown as MembershipInputV1;
const response=(ids:string[])=>JSON.stringify({contract_version:'concept-membership-judge-v1',roots:{r0:{memberships:[{concept_key:'experience',verdict:'belongs',span_ids:ids,rationale:'The completed activity and destination are stated.'}]}}});
test('standard v2 has a new identity, preserves v1 and groups every compatible concept in cached Batches',()=>{
 const before=membershipLabelerIdentityV1();const id=membershipLabelerIdentityV2();
 assert.notEqual(digest(id),digest(before));assert.equal(id.params.effort,'low');
 const request=buildMembershipRequestV2([input],{entities:[]},[concept],id);
 assert.equal(request.output_config.effort,'low');assert.equal(request.system[0]!.cache_control.ttl,'1h');
 assert.deepEqual(membershipLabelerIdentityV1(),before);
 assert.throws(()=>buildMembershipRequestV2([input],{entities:[]},[concept],before),/identity_invalid/);
 assert.deepEqual(JSON.parse(request.messages[0]!.content).roots[0].evaluated_concepts,['experience']);
});
test('standard v2 generic rules cover decisive facts, own-text entity, hypotheses and promotional voice across concepts',()=>{
 assert.match(MEMBERSHIP_PROMPT_V2,/decisive fact/i);assert.match(MEMBERSHIP_PROMPT_V2,/own text.*insufficient/i);
 assert.match(MEMBERSHIP_PROMPT_V2,/hypotheses.*possibilities.*generic comments/i);
 for(const value of ['brand_official','retail_promo','promotion'])assert.ok(MEMBERSHIP_PROMPT_V2.includes(value));
 assert.doesNotMatch(MEMBERSHIP_PROMPT_V2,/National|Alexa|rent(?:al)? cars/i);
 assert.match(MEMBERSHIP_PROMPT_V2,/official.*non-promotional/i);
});
test('standard v2 reconstructs one to three complete sentences and rejects foreign, duplicate or excess citations',()=>{
 const parsed=parseMembershipGroupV2(response(['r0c0s0','r0c0s1']),[input]);
 assert.equal(parsed.results[0]?.verdict,'belongs');assert.equal(parsed.results[0]?.citations.length,2);
 for(const citation of parsed.results[0]!.citations)assert.equal(text.slice(citation.quote_start,citation.quote_end),citation.quote);
 assert.equal(parsed.results[0]?.citations[0]?.quote,'The customer completed the activity. ');
 for(const ids of [['r1c0s0'],['r0c0s0','r0c0s0'],['r0c0s0','r0c0s1','r0c0s2','r0c0s3']])assert.equal(parseMembershipGroupV2(response(ids),[input]).results[0]?.verdict,'error');
 assert.equal(parseMembershipGroupV2(response(['r0c0s0']),[input],'max_tokens').split,true);
});
test('standard v2 keeps sparse negatives only after complete ordinal coverage',()=>{
 const empty=JSON.stringify({contract_version:'concept-membership-judge-v1',roots:{r0:{memberships:[]}}});
 assert.equal(parseMembershipGroupV2(empty,[input]).results[0]?.verdict,'not_belongs');
 assert.equal(parseMembershipGroupV2(empty,[input,{...input,root_id:'other'}]).split,true);
});
test('v2 normalizes only 31–33 rationale words, preserving exact verdicts and citations; v1 stays strict',async()=>{
 const {normalizeMembershipRationaleV2}=await import('./signal-concept-membership-v2');
 const {parseMembershipGroupV1}=await import('./signal-concept-membership-v1');
 for(const count of [31,32,33]){
  const raw=JSON.parse(response(['r0c0s0','r0c0s1']));raw.roots.r0.memberships[0].rationale=Array.from({length:count},(_,i)=>`word${i}`).join(' ');
  const text=JSON.stringify(raw),normalized=normalizeMembershipRationaleV2(text),shape=JSON.parse(normalized.text);
  assert.equal(normalized.normalizations.length,1);assert.equal(shape.roots.r0.memberships[0].rationale.split(/\s+/u).length,30);
  assert.equal(shape.roots.r0.memberships[0].verdict,raw.roots.r0.memberships[0].verdict);
  assert.deepEqual(shape.roots.r0.memberships[0].span_ids,raw.roots.r0.memberships[0].span_ids);
  assert.deepEqual(parseMembershipGroupV2(text,[input]).results.map(r=>({verdict:r.verdict,citations:r.citations})),parseMembershipGroupV2(normalized.text,[input]).results.map(r=>({verdict:r.verdict,citations:r.citations})));
  assert.equal(parseMembershipGroupV1(text,[input]).results[0]?.verdict,'error');
 }
 for(const change of [(member:any)=>{member.rationale='word '.repeat(34);},(member:any)=>{member.span_ids=[];},(member:any)=>{member.extra=true;}]){
  const raw=JSON.parse(response(['r0c0s0']));raw.roots.r0.memberships[0].rationale='word '.repeat(31);change(raw.roots.r0.memberships[0]);
  assert.equal(parseMembershipGroupV2(JSON.stringify(raw),[input]).results[0]?.verdict,'error');
 }
});
