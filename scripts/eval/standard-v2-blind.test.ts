import assert from 'node:assert/strict';
import test from 'node:test';
import {selectPrevalenceSampleV2,normalizeCitationsV2,blindDisagreementV2} from './standard-v2-blind';
test('prevalence selection is reproducible proportional without duplicate pairs',()=>{
 const rows=['a','b','c'].flatMap((concept_key,index)=>Array.from({length:[83,30,7][index]!},(_,i)=>({root_id:`${concept_key}${i}`,concept_key})));
 const selected=selectPrevalenceSampleV2(rows,'fixed',60);
 assert.deepEqual(selected,selectPrevalenceSampleV2([...rows].reverse(),'fixed',60));
 assert.deepEqual(Object.fromEntries(['a','b','c'].map(key=>[key,selected.filter(row=>row.concept_key===key).length])),{a:42,b:15,c:3});
 assert.equal(new Set(selected.map(row=>row.root_id+row.concept_key)).size,60);
});
test('citation normalization uses identical keys, merges adjacent spans and refuses altered or foreign quotes',()=>{
 const text='One fact. Another fact.';
 const a=normalizeCitationsV2(text,[{quote:'One fact. ',quote_start:0,quote_end:10},{quote:'Another fact.',quote_start:10,quote_end:text.length}]);
 const b=normalizeCitationsV2(text,[{quote:text,start:0,end:text.length}]);
 assert.deepEqual(a,b);assert.deepEqual(Object.keys(a[0]!),['quote','start','end']);
 assert.throws(()=>normalizeCitationsV2(text,[{quote:'False',start:0,end:5}]),/citation/);
});
test('disagreement options hide run identity and rationale, with stable randomized version order',()=>{
 const versions=[{verdict:'belongs',citations:[],run_id:'old',rationale:'old'},{verdict:'not_belongs',citations:[],run_id:'new',rationale:'new'}];
 const a=blindDisagreementV2('root:concept','seed',versions);
 assert.deepEqual(a,blindDisagreementV2('root:concept','seed',versions));
 assert.equal(a.options.length,2);assert.deepEqual(Object.keys(a.options[0]!),['option_id','verdict','citations']);
});
