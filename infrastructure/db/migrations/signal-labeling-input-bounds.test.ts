import assert from 'node:assert/strict';
import test from 'node:test';
import {selectLabelingInputPrefixV1 as prefix,validateLabelingInputBoundsV1 as validate} from '../signal-labeling-input-bounds';
test('bounded input prefixes never skip a huge first root or overrun remaining memory',()=>{
 const rows=[{root_id:'huge',working_bytes:48*100*1024*1024},{root_id:'small',working_bytes:8192}];
 assert.deepEqual(prefix(rows,{max_rows:4096,max_working_bytes:512*1024*1024}),[]);
 assert.throws(()=>prefix(rows,{max_rows:4096,max_working_bytes:512*1024*1024,on_oversize:'error'}),/memory_bound/);
 assert.deepEqual(prefix([{root_id:'a',working_bytes:'8192'},{root_id:'b',working_bytes:'16384'},{root_id:'c',working_bytes:'8192'}],{max_rows:3,max_working_bytes:24575}),['a']);
 assert.deepEqual(prefix(rows,{max_rows:4096,max_working_bytes:0}),[]);
 let byteLimits=0;const on_byte_limit=(...args:unknown[])=>{assert.deepEqual(args,[]);byteLimits++;};
 const small=[{root_id:'a',working_bytes:8192},{root_id:'b',working_bytes:16384}];
 assert.deepEqual(prefix(small,{max_rows:2,max_working_bytes:24575,on_byte_limit}),['a']);assert.equal(byteLimits,1);
 for(const on_oversize of [undefined,'empty','error'] as const){
  byteLimits=0;const bounds={max_rows:2,max_working_bytes:1,on_oversize,on_byte_limit};
  if(on_oversize==='error')assert.throws(()=>prefix(small,bounds),/labeling_input_memory_bound/);
  else assert.deepEqual(prefix(small,bounds),[]);
  assert.equal(byteLimits,1,'every genuine first-oversize byte branch notifies once');
 }
 byteLimits=0;
 assert.deepEqual(prefix(small,{max_rows:1,max_working_bytes:8192,on_byte_limit}),['a']);
 assert.deepEqual(prefix(small.slice(0,1),{max_rows:2,max_working_bytes:8192,on_byte_limit}),['a']);
 assert.deepEqual(prefix([],{max_rows:2,max_working_bytes:0,on_oversize:'error',on_byte_limit}),[]);
 assert.equal(byteLimits,0,'count, exact end and empty populations never signal an unseen non-fitting root');
 const callbackError=new Error('synthetic byte notification failure');
 for(const on_oversize of ['empty','error'] as const)assert.throws(()=>prefix(small,{max_rows:2,max_working_bytes:1,on_oversize,
  on_byte_limit:()=>{throw callbackError;}}),error=>error===callbackError,'synchronous callback failure is never swallowed');
 let invalidSignals=0;
 assert.throws(()=>prefix([{root_id:'invalid',working_bytes:'not-bytes'}],{max_rows:2,max_working_bytes:0,on_byte_limit:()=>{invalidSignals++;}}),/metadata_invalid/);
 assert.equal(invalidSignals,0,'invalid metadata is not a byte limit');
});
test('bounded reader validates server-owned windows and preserves the legacy page maximum',()=>{
 assert.equal(validate({max_rows:4096,max_working_bytes:512*1024*1024},200).max_rows,200);
 const legacy={max_rows:3,max_working_bytes:8192};assert.deepEqual(validate(legacy,200),legacy);
 assert.deepEqual(Object.keys(validate(legacy,200)),Object.keys(legacy),'absence does not add a callback key');
 const callback=()=>{};assert.equal(validate({...legacy,on_byte_limit:callback},200).on_byte_limit,callback);
 for(const on_byte_limit of [null,true,'callback',{}])assert.throws(()=>validate({...legacy,on_byte_limit} as never,200),/bounds_invalid/);
 for(const value of [{max_rows:4097,max_working_bytes:1},{max_rows:0,max_working_bytes:1},{max_rows:1,max_working_bytes:512*1024*1024+1},{max_rows:1,max_working_bytes:-1},{max_rows:1,max_working_bytes:1.1}])assert.throws(()=>validate(value,4096),/bounds_invalid/);
});
