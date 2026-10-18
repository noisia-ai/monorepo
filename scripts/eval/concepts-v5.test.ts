import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {confirmedConceptsV3,conceptInputV3} from './concepts-v3';
test('founder v5 changes only Cobros, retains all catalog scopes and fits the product schema',()=>{
 const old=JSON.parse(readFileSync(new URL('../../docs/product/PROMPT_LOOPING/CONFIRMED_MFP_CONCEPTS_V4_2026-10-13.json',import.meta.url),'utf8'));
 const proposal=JSON.parse(readFileSync(new URL('../../docs/product/PROMPT_LOOPING/CONFIRMED_MFP_CONCEPTS_V5_2026-10-18.json',import.meta.url),'utf8'));
 assert.equal(proposal.version,5);assert.equal(proposal.status,'confirmed_founder_audit_17_7');
 const concepts=confirmedConceptsV3(proposal),previous=confirmedConceptsV3(old);
 for(const concept of concepts){
  assert.doesNotThrow(()=>conceptInputV3(concept,'all_conversations'));
  if(concept.concept_key!=='cobros_depositos_devoluciones')assert.deepEqual(concept,previous.find(c=>c.concept_key===concept.concept_key));
 }
 assert.notDeepEqual(conceptInputV3(concepts[0]!,'all_conversations'),conceptInputV3(previous[0]!,'all_conversations'));
});
