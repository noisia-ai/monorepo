import assert from 'node:assert/strict';
import test from 'node:test';
import {selectFreshPrevalenceSampleV3,reviewedPairExclusionV3,selectFreshDisagreementsV3} from './standard-v3-blind';
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

test('disagreement packet caps all arms at 60 total with concept prevalence and prior-case exclusion',()=>{
 const excluded=new Set(['old:a']);
 const candidates=Array.from({length:100},(_,i)=>({root_id:`new${i}`,concept_key:i<80?'a':'b'}));
 const rows=[{root_id:'old',concept_key:'a'},...candidates];
 const low=selectFreshDisagreementsV3(rows,excluded,'low',2);
 const medium=selectFreshDisagreementsV3(rows,excluded,'medium',2);
 assert.equal(low.length+medium.length,60);
 for(const selected of [low,medium]){assert.equal(selected.length,30);assert.equal(selected.filter(r=>r.concept_key==='a').length,24);assert.ok(selected.every(r=>r.root_id!=='old'));}
 assert.deepEqual(selectFreshDisagreementsV3(rows,excluded,'low',2),low);
 assert.equal(selectFreshDisagreementsV3(rows,excluded,'medium',1).length,60);
 assert.equal(selectFreshDisagreementsV3(rows.slice(0,5),excluded,'low',2).length,4);
 assert.deepEqual(selectFreshDisagreementsV3([],excluded,'low',2),[]);
});
