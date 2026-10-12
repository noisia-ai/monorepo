import assert from 'node:assert/strict';import test from 'node:test';
import {reduceHybridWindowResultsV1} from '../signal-hybrid-window-results';
test('window results wait for full coverage and a technical error cannot become a negative or supported positive',()=>{
 const make=(index:number,verdict:string)=>({root_id:'root',root_fingerprint:'fp',concept_key:'c',definition_digest:'d',entity_context_digest:'ce',effective_entities_digest:'e',text:'0123456789',citation_window:{start:index*5,end:(index+1)*5,index,count:2},claude:{verdict},error_code:verdict==='error'?'membership_evidence_invalid':undefined}) as never;
 assert.equal(reduceHybridWindowResultsV1([make(0,'not_belongs')]).length,0);
 assert.equal(reduceHybridWindowResultsV1([make(0,'not_belongs'),make(1,'belongs')])[0]?.claude?.verdict,'belongs');
 assert.equal(reduceHybridWindowResultsV1([make(0,'error'),make(1,'belongs')])[0]?.error_code,'membership_evidence_invalid');
 assert.throws(()=>reduceHybridWindowResultsV1([make(0,'belongs'),make(0,'belongs')]),/duplicate_window/);
});
