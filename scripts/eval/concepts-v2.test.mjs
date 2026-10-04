import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedConceptUpdates } from './concepts-v2.ts';
const key=n=>`concept-${n}`;
const proposed=n=>({concept_key:key(n),label:`Concept ${n}`,definition:'Documented process',inclusions:['Attributed practice'],
  exclusions:['Generic advice'],examples_positive:['Positive example'],examples_negative:['Negative example'],labeling_rules:['Use insufficient for ambiguous text']});
const current=n=>({term_key:key(n),scope:'primary_brand',definition_revision:1,definition_digest:'sha256:'+'a'.repeat(64),
  label:`Concept ${n}`,definition:'Old',inclusion:[],exclusion:[],positive_examples:[],negative_examples:[]});
test('v2 installation preserves catalog scope and requires exact fixed selection',()=>{
  const input=[1,2,3].map(proposed),catalog=[1,2,3].map(current),keys=[1,2,3].map(key);
  const plan=plannedConceptUpdates(input,catalog,keys);
  assert.equal(plan.length,3);assert.equal(plan[0].input.scope,'primary_brand');assert.equal(plan[0].unchanged,false);
  assert.match(plan[0].input.definition,/Use insufficient for ambiguous text/);
  assert.throws(()=>plannedConceptUpdates(input.slice(1),catalog,keys),/selection_mismatch/);
  assert.throws(()=>plannedConceptUpdates(input,catalog.slice(1),keys),/catalog_concept_missing/);
});
