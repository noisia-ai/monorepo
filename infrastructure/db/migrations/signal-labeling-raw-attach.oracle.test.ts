import assert from 'node:assert/strict';
import test from 'node:test';
import {rawAttachAtMostOnceV1,rawAttachLockSelectEvidenceV1} from './signal-labeling-raw-attach.oracle';

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
test('standalone lock SELECT evidence retains actual failed counts and rescans without exporting private plan expressions',()=>{
 const secret='PRIVATE_SQL_BIND_UUID_BODY';
 const safe=rawAttachLockSelectEvidenceV1({Plan:{'Node Type':'LockRows','Actual Rows':719,'Actual Loops':1,
  Filter:secret,Output:[secret],Plans:[{'Node Type':'Index Scan','Relation Name':'signal_labeling_raw_page_members',
   'Actual Rows':657,'Actual Loops':4128,'Index Cond':secret,Filter:secret}]},'Execution Time':12.5,'Planning Time':.5,Query:secret},720);
 assert.equal(safe.members,720);assert.equal(safe.actual_rows,719,'a failed row-count assertion must not rewrite observed data');
 assert.equal(safe.selected_nodes[1]!['Actual Loops'],4128,'a rescan remains visible in captured evidence');
 assert.equal(safe.sql_sha256,'b8180180dfc8340b89511bb2ecf806c6f7bc811c7c257d2a7409915751ec5670');
 assert.ok(safe.prior_call_locks.includes('KEY SHARE'));assert.ok(safe.latency_scope.includes('not production virgin'));
 const encoded=JSON.stringify(safe);assert.ok(!encoded.includes(secret));
 for(const key of ['Index Cond','Filter','Output','Query'])assert.ok(!encoded.includes('"'+key+'"'));
});
