import assert from 'node:assert/strict';
import test from 'node:test';
import {rawAttachAtMostOnceV1} from './signal-labeling-raw-attach.oracle';

test('RAW attach evidence accepts an unexecuted InitPlan and one execution, but rejects rescans and unknown loop counts',()=>{
 for(const loops of [0,1])assert.equal(rawAttachAtMostOnceV1(loops),true);
 for(const loops of [2,8,4096,Number.MAX_SAFE_INTEGER,NaN,Infinity,-Infinity,-1,.5,null,undefined,'0','1',{},[]])
  assert.equal(rawAttachAtMostOnceV1(loops),false,'only known integral zero/one loop counts establish no rescan');
});
test('adding one rescan or unknown to an otherwise valid observed plan cannot retain its no-rescan verdict',()=>{
 for(const observed of [[0],[1],[0,1],[1,0,1,0]]){
  assert.ok(observed.every(rawAttachAtMostOnceV1));
  for(const invalid of [2,720,4128,NaN,null,undefined])
   assert.equal([...observed,invalid].every(rawAttachAtMostOnceV1),false);
 }
});
