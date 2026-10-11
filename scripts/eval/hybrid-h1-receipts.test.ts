import assert from 'node:assert/strict';
import test from 'node:test';
import { hybridReceiptResultsV1 } from './hybrid-h1-receipts';
const result:any={root_id:'root',concept_key:'concept',jev:{verdict:'belongs'},jev_call_id:'j',claude:{verdict:'belongs'},claude_call_id:'c'};
const call=(id:string,stage:string,run_id:string,source_run_id:string|null,r:any)=>({id,stage,run_id,source_run_id,status:'settled',results:[r]});
test('measurement follows one verification and one authorized repair without counting duplicate semantic outputs',()=>{
 const v={...result,citation_call_id:'v',claude:{...result.claude,verification:{supported:false}}};
 const repair={...result,claude_call_id:'c2'};
 const v2={...repair,citation_call_id:'v2',claude:{...repair.claude,verification:{supported:true}}};
 const maps=hybridReceiptResultsV1([call('j','jev','jr',null,{...result,claude:null}),call('c','claude','cr',null,result),call('v','citation','vr','cr',v),call('c2','claude','c2r','vr',repair),call('v2','citation','v2r','c2r',v2)] as never);
 assert.deepEqual(maps.claude.get('root:concept'),v2);assert.equal(maps.jev.size,1);assert.equal(maps.claude.size,1);
});
test('measurement rejects a second independent positive call or an unrelated verifier',()=>{
 assert.throws(()=>hybridReceiptResultsV1([call('c','claude','cr',null,result),call('c2','claude','c2r',null,result)] as never),/duplicate_result/);
 assert.throws(()=>hybridReceiptResultsV1([call('c','claude','cr',null,result),call('v','citation','vr','unrelated',result)] as never),/citation_chain_invalid/);
});
test('measurement accepts recovery of a technical JEV error and rejects duplicate positive JEV',()=>{
 assert.equal(hybridReceiptResultsV1([call('j0','jev','j0r',null,{...result,jev:{verdict:'error'}}),call('j','jev','jr',null,result)] as never).jev.get('root:concept')?.jev.verdict,'belongs');
 assert.throws(()=>hybridReceiptResultsV1([call('j','jev','jr',null,result),call('j2','jev','j2r',null,result)] as never),/duplicate_result/);
});
