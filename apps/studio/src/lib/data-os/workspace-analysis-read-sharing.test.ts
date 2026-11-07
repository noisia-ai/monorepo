import assert from 'node:assert/strict';
import test from 'node:test';
import {createMfpPopulationReader} from './mfp-population-read';
import {createWorkspaceAnalysisReadSharing} from './workspace-analysis-read-sharing';

test('overlapping reads share work only for the same database and authorized scope, never completed results', async () => {
  const share=createWorkspaceAnalysisReadSharing(), db={}, otherDb={}; let reads=0,checks=0;
  let release!:()=>void; const gate=new Promise<void>(resolve=>{release=resolve;});
  const read=async()=>{reads++;await gate;return {revision:reads};};
  const check=async()=>{checks++;};
  const a=share(db,'actor-a/workspace-a/key-a',read,check);
  const b=share(db,'actor-a/workspace-a/key-a',read,check);
  const distinct=[share(db,'actor-b/workspace-a/key-a',read,check),share(db,'actor-a/workspace-b/key-a',read,check),
    share(db,'actor-a/workspace-a/key-b',read,check),share(otherDb,'actor-a/workspace-a/key-a',read,check)];
  await Promise.resolve();assert.equal(reads,5);release();
  const [first,second]=await Promise.all([a,b,...distinct]);assert.equal(checks,6);
  first.revision=99;assert.notEqual(second.revision,99,'caller mutation must not leak');
  await share(db,'actor-a/workspace-a/key-a',async()=>{reads++;return {revision:6};},check);
  assert.equal(reads,6,'a later request must see a newly read revision');
});
test('each waiting actor is revalidated and a revoked caller receives no shared result', async()=>{
  const share=createWorkspaceAnalysisReadSharing(), db={};let reads=0;let revoked=false;
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const read=async()=>{reads++;await gate;return {secret:'scoped'};};
  const allowed=share(db,'scope',read,async()=>{});
  const rejected=share(db,'scope',read,async()=>{if(revoked)throw new Error('forbidden');});
  revoked=true;release();await allowed;await assert.rejects(rejected,/forbidden/);assert.equal(reads,1);
});
test('a failed read is removed rather than retained as a stale result', async()=>{
  const share=createWorkspaceAnalysisReadSharing(), db={};let reads=0;
  await assert.rejects(share(db,'scope',async()=>{reads++;throw new Error('read_failed');},async()=>{}),/read_failed/);
  assert.deepEqual(await share(db,'scope',async()=>{reads++;return {revision:2};},async()=>{}),{revision:2});
  assert.equal(reads,2);
});


test('Overview and Topics overlap no longer overflow the bounded nine-reader analysis queue', async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const bounded=createMfpPopulationReader(8,1000,2);
  const load=()=>Promise.all(Array.from({length:9},()=>bounded(async()=>{await gate;return 1;})));
  const first=load(), second=load();
  const failed=assert.rejects(second,/population_read_busy/);
  release();await Promise.all([first,failed]);

  const shared=createWorkspaceAnalysisReadSharing(), database={};let executions=0;
  const safe=createMfpPopulationReader(8,1000,2);
  const guardedLoad=async()=>{executions++;return Promise.all(Array.from({length:9},()=>safe(async()=>1)));};
  const results=await Promise.all([shared(database,'same-authorized-scope',guardedLoad,async()=>{}),
    shared(database,'same-authorized-scope',guardedLoad,async()=>{})]);
  assert.equal(executions,1);assert.deepEqual(results,[Array(9).fill(1),Array(9).fill(1)]);
});
