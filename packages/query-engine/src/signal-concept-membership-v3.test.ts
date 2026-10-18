import assert from 'node:assert/strict';
import test from 'node:test';
import {membershipLabelerIdentityV1,type MembershipInputV1,type ConceptForJudgeV1} from './signal-concept-membership-v1';
import {membershipLabelerIdentityV2} from './signal-concept-membership-v2';
import {membershipLabelerIdentityV3,buildMembershipRequestV3,parseMembershipGroupV3,MEMBERSHIP_PROMPT_V3} from './signal-concept-membership-v3';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
const concept:ConceptForJudgeV1={concept_key:'completed_service',label:'Completed service',scope:'all_conversations',definition:'A concrete completed service at a named provider.',inclusion:[],exclusion:[],positive_examples:[],negative_examples:[],definition_digest:'sha256:'+'a'.repeat(64)};
const root={root_id:'root',input_digest:'i',root_fingerprint:'f',text:'My bicycle was repaired at the named shop. I collected it on Tuesday.',title:'A repair at the bicycle shop',entities:[{entity_id:'example_shop',kind:'primary_brand',salience:'main'}],voice:'individual',act:'experience',author:'ACCOUNT_MUST_NOT_ESTABLISH_CATEGORY',entity_context_digest:'c',effective_entities_digest:'e',evaluated_concepts:[concept]} as unknown as MembershipInputV1;
test('v3 arms have distinct identities; v1 and v2 stay frozen; effort reaches request',()=>{
 const previous=[membershipLabelerIdentityV1(),membershipLabelerIdentityV2()];
 for(const effort of ['low','medium'] as const){
  const id=membershipLabelerIdentityV3(effort),request=buildMembershipRequestV3([root],{entities:[]},[concept],id);
  assert.equal(id.params.standard_judge_version,3);assert.equal(id.params.rationale_normalization,'bounded-31-33-to-30-words-v1');assert.equal(request.output_config.effort,effort);
  assert.equal(request.system[0]!.text.startsWith(MEMBERSHIP_PROMPT_V3+'\n'),true);
  assert.equal(request.system[0]!.text.includes('Entity context:'),true);
  const payload=JSON.parse(request.messages[0]!.content).roots[0];
  assert.equal(payload.title,root.title);assert.deepEqual(payload.entities,root.entities);assert.equal(payload.voice,root.voice);
  assert.equal(JSON.stringify(request).includes(root.author!),false);
  assert.ok(payload.spans.length);assert.equal(payload.spans[0].text,root.text.slice(0,payload.spans[0].text.length));
 }
 assert.notEqual(digest(membershipLabelerIdentityV3('low')),digest(membershipLabelerIdentityV3('medium')));
 assert.deepEqual([membershipLabelerIdentityV1(),membershipLabelerIdentityV2()],previous);
 assert.throws(()=>buildMembershipRequestV3([root],{entities:[]},[concept],previous[1]),/membership_v3_identity_invalid/);
});
test('v3 complete sentence citations remain literal and technical failures remain errors',()=>{
 const response=(ids:string[])=>JSON.stringify({contract_version:'concept-membership-judge-v1',roots:{r0:{memberships:[{concept_key:concept.concept_key,verdict:'belongs',span_ids:ids,rationale:'A completed repair at the named provider is described.'}]}}});
 const parsed=parseMembershipGroupV3(response(['r0c0s0','r0c0s1']),[root]);
 assert.equal(parsed.results[0]?.verdict,'belongs');
 for(const c of parsed.results[0]!.citations)assert.equal(root.text.slice(c.quote_start,c.quote_end),c.quote);
 assert.equal(parseMembershipGroupV3(response(['r1c0s0']),[root]).results[0]?.verdict,'error');
 assert.equal(parseMembershipGroupV3(response(['r0c0s0']),[root],'max_tokens').split,true);
});
