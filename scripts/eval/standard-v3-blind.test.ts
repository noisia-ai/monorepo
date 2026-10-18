import assert from 'node:assert/strict';
import test from 'node:test';
import {selectFreshPrevalenceSampleV3,reviewedPairExclusionV3} from './standard-v3-blind';
test('new blinded cases exclude all 120 prior reviewed cases before stratification and remain deterministic',()=>{
 const prior=Array.from({length:120},(_,i)=>({root_id:`old${i}`,concept_key:i%2?'a':'b'}));
 const exclusion=reviewedPairExclusionV3({positive_items:prior.slice(0,60),disagreement_items:prior.slice(60)});
 const fresh=Array.from({length:100},(_,i)=>({root_id:`new${i}`,concept_key:i%2?'a':'b'}));
 const rows=[...prior,...fresh],chosen=selectFreshPrevalenceSampleV3(rows,exclusion,'seed',60);
 assert.equal(chosen.length,60);assert.equal(chosen.filter(r=>r.concept_key==='a').length,30);
 assert.ok(chosen.every(r=>r.root_id.startsWith('new')));assert.deepEqual(selectFreshPrevalenceSampleV3(rows,exclusion,'seed',60),chosen);
 assert.throws(()=>selectFreshPrevalenceSampleV3(prior,exclusion,'seed',60),/sample_population_invalid/);
 assert.throws(()=>reviewedPairExclusionV3({positive_items:prior.slice(0,59),disagreement_items:prior.slice(60)}),/previous_review_population_invalid/);
});
