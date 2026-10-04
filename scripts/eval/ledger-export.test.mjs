import test from 'node:test';
import assert from 'node:assert/strict';
import {facetPredictions,membershipPredictions,ledgerCosts} from './ledger-export.ts';
const base={status:'settled',settled_micro_usd:'123',reserved_micro_usd:'200',created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T00:00:01Z',inputs:[],request:{},raw_body:null};
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
