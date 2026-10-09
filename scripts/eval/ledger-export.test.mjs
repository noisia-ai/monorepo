import test from 'node:test';
import assert from 'node:assert/strict';
import {facetPredictions,membershipPredictions,ledgerCosts,loadJevReceiptBodies,currentFacetCalls,thresholdMembershipPredictions} from './ledger-export.ts';
const base={status:'settled',settled_micro_usd:'123',reserved_micro_usd:'200',created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T00:00:01Z',inputs:[],request:{},raw_body:null};
test('JEV export loads verified storage receipts and fails closed when a settled receipt is absent',async()=>{
 const call={...base,run_id:'run',raw_storage_key:'private/key',raw_sha256:'sha256:'+'a'.repeat(64),raw_size_bytes:7,
  results:[{root_id:'root',input_digest:'sha256:a',status:'labeled'}]};
 let loaded=0;
 await loadJevReceiptBodies([call],async()=>{loaded++;return '{"body":"{}"}';},1);
 assert.equal(loaded,1);assert.equal(call.raw_body,'{"body":"{}"}');
 await assert.rejects(loadJevReceiptBodies([{...call,raw_body:null,raw_storage_key:null,raw_sha256:null,raw_size_bytes:null}],async()=>''),/mfp_eval_jev_receipt_missing/);
 await assert.rejects(loadJevReceiptBodies([{...call,raw_body:null,raw_sha256:null}],async()=>''),/mfp_eval_jev_receipt_reference_invalid/);
});
test('JEV calibration uses independent persisted noul and choice probabilities',()=>{
 const call={...base,request:{state:{entity_context:{entities:[{entity_id:'entity-1'}]}}},
 raw_body:JSON.stringify({body:JSON.stringify({answers:{entity_0:{type:'noul',noul:0.7},main_0:{type:'noul',noul:0.8},spam_or_bot:{type:'noul',noul:0.2},voice:{type:'choice',choice:'individual',confidence:0.9},act:{type:'choice',choice:'opinion',confidence:0.6}}})}),
 results:[{root_id:'root-1',input_digest:'sha256:a',status:'labeled',facets:{entities:{value:[],confidence:0.11,abstained:false}}}]};
 const [prediction]=facetPredictions([call],true);
 assert.deepEqual(prediction.probabilities,[{task:'entity',key:'entity-1',probability:0.7},{task:'salience',key:'entity-1',probability:0.8},{task:'spam',key:'true',probability:0.2},{task:'voice',key:'individual',probability:0.9},{task:'act',key:'opinion',probability:0.6}]);
 assert.equal(ledgerCosts([call],1).settled_usd,0.000123);
});
test('missing membership remains missing, never inferred negative',()=>{
 const call={...base,results:[{root_id:'root-1',input_digest:'sha256:a',concept_key:'concept_a',verdict:'belongs'}]};
 const [prediction]=membershipPredictions([call]);
 assert.deepEqual(prediction.memberships,{concept_a:'belongs'});
 assert.equal(prediction.memberships.concept_b,undefined);
});
test('membership export projects only the three preregistered gold concepts',()=>{
 const call={...base,results:[
  {root_id:'root-1',input_digest:'sha256:a',concept_key:'concept_a',verdict:'belongs'},
  {root_id:'root-1',input_digest:'sha256:a',concept_key:'unrelated_catalog_topic',verdict:'not_belongs'}]};
 const [prediction]=membershipPredictions([call],new Set(['concept_a','concept_b','concept_c']));
 assert.deepEqual(prediction.memberships,{concept_a:'belongs'});
});
test('reused JEV receipts retain full cost while predictions exclude superseded calls',()=>{
 const stale={...base,id:'old',settled_micro_usd:'100',results:[{root_id:'same',input_digest:'old',status:'labeled'}]};
 const current={...base,id:'new',settled_micro_usd:'200',results:[{root_id:'same',input_digest:'current',status:'labeled'}]};
 const calls=[stale,current];
 assert.deepEqual(facetPredictions(currentFacetCalls(calls,new Set(['new'])),false).map(row=>row.input_digest),['current']);
 assert.equal(ledgerCosts(calls,1).settled_usd,0.0003);
 assert.throws(()=>currentFacetCalls(calls,new Set(['missing'])),/mfp_eval_current_facets_incomplete/);
});
test('dev-selected JEV membership threshold remaps probabilities without inventing negatives',()=>{
 const keys=['one','two','three'];
 const row={root_id:'root',input_digest:'digest',status:'labeled',memberships:{one:'not_belongs',two:'not_belongs',three:'belongs'},
  probabilities:keys.map((key,index)=>({task:'membership',key,probability:[0.45,0.1,0.8][index]}))};
 assert.deepEqual(thresholdMembershipPredictions([row],keys,0.4)[0].memberships,{one:'belongs',two:'not_belongs',three:'belongs'});
 assert.deepEqual(row.memberships,{one:'not_belongs',two:'not_belongs',three:'belongs'});
 assert.deepEqual(thresholdMembershipPredictions([{root_id:'missing',input_digest:'digest',status:'pending'}],keys,0.4)[0].memberships,undefined);
 assert.throws(()=>thresholdMembershipPredictions([{...row,probabilities:row.probabilities.slice(1)}],keys,0.4),/mfp_eval_membership_probability_missing/);
});
