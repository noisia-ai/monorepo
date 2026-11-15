import assert from 'node:assert/strict';
import test from 'node:test';
import {selectLabelingInputPrefixV1 as prefix,validateLabelingInputBoundsV1 as validate} from '../signal-labeling-input-bounds';
test('bounded input prefixes never skip a huge first root or overrun remaining memory',()=>{
 const rows=[{root_id:'huge',working_bytes:48*100*1024*1024},{root_id:'small',working_bytes:8192}];
 assert.deepEqual(prefix(rows,{max_rows:4096,max_working_bytes:512*1024*1024}),[]);
 assert.throws(()=>prefix(rows,{max_rows:4096,max_working_bytes:512*1024*1024,on_oversize:'error'}),/memory_bound/);
 assert.deepEqual(prefix([{root_id:'a',working_bytes:'8192'},{root_id:'b',working_bytes:'16384'},{root_id:'c',working_bytes:'8192'}],{max_rows:3,max_working_bytes:24575}),['a']);
 assert.deepEqual(prefix(rows,{max_rows:4096,max_working_bytes:0}),[]);
});
test('bounded reader validates server-owned windows and preserves the legacy page maximum',()=>{
 assert.equal(validate({max_rows:4096,max_working_bytes:512*1024*1024},200).max_rows,200);
 for(const value of [{max_rows:4097,max_working_bytes:1},{max_rows:0,max_working_bytes:1},{max_rows:1,max_working_bytes:512*1024*1024+1},{max_rows:1,max_working_bytes:-1},{max_rows:1,max_working_bytes:1.1}])assert.throws(()=>validate(value,4096),/bounds_invalid/);
});
