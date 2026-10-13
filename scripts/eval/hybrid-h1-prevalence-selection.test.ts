import assert from 'node:assert/strict';
import test from 'node:test';
import {selectPrevalencePositivesV1} from './hybrid-h1-prevalence-selection';

test('blind sample follows full positive prevalence, with deterministic distinct roots and whole-root exclusions',()=>{
 const rows=[...Array.from({length:90},(_,i)=>({root_id:`common${i}`,concept_key:'common'})),
  ...Array.from({length:10},(_,i)=>({root_id:`rare${i}`,concept_key:'rare'}))];
 const sample=selectPrevalencePositivesV1(rows,new Set(['common0','rare0']),'fixed-seed',20);
 assert.deepEqual(sample.quotas,{common:18,rare:2});
 assert.equal(sample.items.length,20);assert.equal(new Set(sample.items.map(r=>r.root_id)).size,20);
 assert.equal(sample.items.filter(r=>r.concept_key==='rare').length,2);
 assert.equal(sample.items.some(r=>['common0','rare0'].includes(r.root_id)),false);
 assert.deepEqual(selectPrevalencePositivesV1([...rows].reverse(),new Set(['common0','rare0']),'fixed-seed',20),sample);
});

test('matching preserves quotas even when one root belongs to several strata',()=>{
 const rows=[{root_id:'shared',concept_key:'a'},{root_id:'other',concept_key:'a'},{root_id:'shared',concept_key:'b'}];
 const sample=selectPrevalencePositivesV1(rows,new Set(),'seed',2);
 assert.deepEqual(sample.quotas,{a:1,b:1});
 assert.deepEqual(sample.items.map(r=>`${r.concept_key}:${r.root_id}`).sort(),['a:other','b:shared']);
 assert.throws(()=>selectPrevalencePositivesV1(rows,new Set(['shared']),'seed',2),/blind_stratum_insufficient/);
});
