import assert from 'node:assert/strict';
import test from 'node:test';
import {cacheSignalTopicEditorialPlanV1 as put,readSignalTopicEditorialPlanCacheV1 as get,clearSignalTopicEditorialPlanCacheV1 as clear} from './signal-topic-editorial-plan-cache';
test('verified plan cache isolates database, lease and digest; deeply freezes a private copy',()=>{
 const database={},foreign={},value={plan:{batches:[{receipt:{group:'one'}}]}};
 const cached=put(database,'lease-a','digest-a',value);
 value.plan.batches[0]!.receipt.group='mutated';
 assert.equal(cached.plan.batches[0]!.receipt.group,'one');
 assert.ok(Object.isFrozen(cached)&&Object.isFrozen(cached.plan)&&Object.isFrozen(cached.plan.batches)&&Object.isFrozen(cached.plan.batches[0]!.receipt));
 assert.throws(()=>{cached.plan.batches[0]!.receipt.group='changed';},TypeError);
 assert.equal(get(database,'lease-a','digest-a'),cached);
 assert.equal(get(foreign,'lease-a','digest-a'),null);
 assert.equal(get(database,'lease-b','digest-a'),null);
 assert.equal(get(database,'lease-a','digest-b'),null);
 put(database,'lease-b','digest-a',value);assert.equal(get(database,'lease-a','digest-a'),cached);
 put(database,'lease-a','digest-b',value);assert.equal(get(database,'lease-a','digest-a'),null);
});
test('four-entry LRU evicts least recently used and release/revocation clear only the matching lease',()=>{
 const database={};for(let i=0;i<4;i++)put(database,`lease-${i}`,'digest',{i});
 get(database,'lease-0','digest');put(database,'lease-4','digest',{i:4});
 assert.equal(get(database,'lease-1','digest'),null);assert.deepEqual(get(database,'lease-0','digest'),{i:0});
 clear(database,'lease-0');assert.equal(get(database,'lease-0','digest'),null);assert.deepEqual(get(database,'lease-2','digest'),{i:2});
});
