import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confirmedConceptsV3, conceptInputV3, unchangedConceptV3, assertCatalogPreservedV3} from './concepts-v3';

const proposal=JSON.parse(readFileSync(new URL('../../docs/product/PROMPT_LOOPING/PROPOSED_MFP_CONCEPTS_V3_2026-10-11.json',import.meta.url),'utf8'));
test('confirmed v3 maps exact data, preserves scopes and rejects missing/extra concepts',()=>{
  const concepts=confirmedConceptsV3(proposal);
  assert.equal(concepts.length,4);
  assert.equal(conceptInputV3(concepts[0],'all_conversations').definition,concepts[0].definition);
  assert.equal(conceptInputV3(concepts[2],'primary_brand').scope,'category');
  assert.equal(conceptInputV3(concepts[3],'category').scope,'primary_brand');
  assert.throws(()=>confirmedConceptsV3({...proposal,concepts:proposal.concepts.slice(1)}),/selection/);
  assert.throws(()=>confirmedConceptsV3({...proposal,concepts:[...proposal.concepts,proposal.concepts[0]]}),/selection/);
  const input=conceptInputV3(concepts[0],'all_conversations');
  assert.equal(unchangedConceptV3({...input},input),true);
  assert.equal(unchangedConceptV3({...input,definition:'changed'},input),false);
});
test('acceptance preservation rejects unrelated edits and adoption attributed to evaluation equivalents',()=>{
  const original={term_key:'reserva_entrega',definition:'v2',definition_revision:3,definition_digest:'sha256:x',origin:'manual',source:null};
  const discovery={term_key:proposal.concepts[2].concept_key,origin:'workspace_discovery',source:{run_key:'original',candidate_key:'original'},definition:'old'};
  const next={...discovery,definition:'confirmed'};
  assertCatalogPreservedV3([original,discovery],[original,next],[discovery.term_key],false);
  assert.throws(()=>assertCatalogPreservedV3([original,discovery],[{...original,definition:'changed'},next],[discovery.term_key],false),/unrelated/);
  assert.throws(()=>assertCatalogPreservedV3([original,discovery],[original,{...next,source:null}],[discovery.term_key],false),/provenance/);
  assert.throws(()=>assertCatalogPreservedV3([original],[original,next],[discovery.term_key],true),/provenance/);
  assertCatalogPreservedV3([original],[original,{...next,origin:'manual',source:null}],[discovery.term_key],true);
});
