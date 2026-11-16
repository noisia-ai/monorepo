import assert from 'node:assert/strict';
import test from 'node:test';

type Call={status:'reserved'|'submitting'|'submitted'|'unknown'|'settled'|'failed';reserved:bigint;settled:bigint|null;terminal:bigint};
test('Listening monetary buckets conserve canonical exposure including terminal uncertainty and exact large integers',()=>{
 const buckets=(calls:Call[])=>calls.reduce<[bigint,bigint,bigint]>(([confirmed,reserved,unknown],call)=>{
  if(call.status==='settled'||call.status==='failed')return [confirmed+(call.settled??0n),reserved,unknown+call.terminal];
  return call.status==='unknown'?[confirmed,reserved,unknown+call.reserved]:[confirmed,reserved+call.reserved,unknown];
 },[0n,0n,0n]);
 const exposure=(calls:Call[])=>calls.reduce((total,call)=>total+(['settled','failed'].includes(call.status)
  ?(call.settled??0n)+call.terminal:call.reserved),0n);
 const statuses:Call['status'][]=['reserved','submitting','submitted','unknown','settled','failed'];
 const calls:Call[]=[];
 for(const status of statuses)for(const reserved of [0n,1n,9007199254740993n])for(const settled of [null,0n,17n])for(const terminal of [0n,23n]){
  const call={status,reserved,settled,terminal};calls.push(call);
  assert.equal(buckets([call]).reduce((a,b)=>a+b,0n),exposure([call]));
 }
 assert.deepEqual(buckets([...calls].reverse()),buckets(calls),'partitioning is independent of ledger row order');
 assert.equal(buckets(calls).reduce((a,b)=>a+b,0n),exposure(calls));
 assert.deepEqual(buckets([{status:'failed',reserved:1000n,settled:7n,terminal:993n}]),[7n,0n,993n],
  'a booked settlement and unresolved terminal amount remain distinct portions, not two reservations');
 assert.deepEqual(buckets([{status:'unknown',reserved:9007199254740993n,settled:7n,terminal:993n}]).map(String),['0','0','9007199254740993'],
  'nonterminal exposure uses the reservation exactly once, even if other monetary columns are populated');
 assert.deepEqual(buckets([]),[0n,0n,0n]);
});
