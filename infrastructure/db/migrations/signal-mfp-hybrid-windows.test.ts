import assert from 'node:assert/strict';import test from 'node:test';
import {reduceHybridWindowResultsV1} from '../signal-hybrid-window-results';
import {groupHybridCitationInputsV1} from '../signal-hybrid-citation-runs';
test('window results preserve a positive candidate and verified belongs despite another window error',()=>{
 const make=(index:number,verdict:string)=>({root_id:'root',root_fingerprint:'fp',concept_key:'c',definition_digest:'d',entity_context_digest:'ce',effective_entities_digest:'e',text:'0123456789',citation_window:{start:index*5,end:(index+1)*5,index,count:2},claude:{verdict},error_code:verdict==='error'?'membership_evidence_invalid':undefined}) as never;
 assert.equal(reduceHybridWindowResultsV1([make(0,'not_belongs')]).length,0);
 assert.equal(reduceHybridWindowResultsV1([make(0,'not_belongs'),make(1,'belongs')])[0]?.claude?.verdict,'belongs');
 assert.equal(reduceHybridWindowResultsV1([make(0,'error'),make(1,'belongs')])[0]?.claude?.verdict,'belongs');
 const verified={...(make(1,'belongs') as Record<string,unknown>),claude:{verdict:'belongs',verification:{supported:true}}} as never;
 assert.equal(reduceHybridWindowResultsV1([make(0,'error'),verified])[0]?.claude?.verification?.supported,true);
 assert.equal(reduceHybridWindowResultsV1([make(0,'error'),make(1,'not_belongs')])[0]?.error_code,'membership_evidence_invalid');
 assert.throws(()=>reduceHybridWindowResultsV1([make(0,'belongs'),make(0,'belongs')]),/duplicate_window/);
});
test('repairs for different concepts on one root retain their distinct original windows',()=>{
 const rows=[0,1].map(index=>({input:{root_id:'root',text:'0123456789',evaluated_concepts:[{concept_key:`c${index}`,definition_digest:`d${index}`}],
  citation_window:{start:index*5,end:(index+1)*5,index,count:2}},result:{concept_key:`c${index}`,definition_digest:`d${index}`,
  jev:{verdict:'belongs'},jev_call_id:'j',claude:{citations:[]}}})) as never;
 const repair=groupHybridCitationInputsV1(rows,'claude');
 assert.equal(repair.length,2);
 for(const [index,input] of repair.entries()){
  assert.equal(input.citation_window?.index,index);assert.deepEqual(input.evaluated_concepts.map(c=>c.concept_key),[`c${index}`]);
 }
});
