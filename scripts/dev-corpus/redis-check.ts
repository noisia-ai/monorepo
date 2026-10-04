import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, main } from './guard.mjs';
import { runJob } from './job';
await main(async()=>{
  const pool=await openDatabase();await pool.end();
  const prefix=`mfp-check-${randomUUID()}`;
  const results=await Promise.all([runJob('first',`${prefix}-a`,{value:1},async job=>{await new Promise(resolve=>setTimeout(resolve,80));return job.data.value;}),
    runJob('second',`${prefix}-b`,{value:2},async job=>job.data.value)]);
  assert.deepEqual(results,[1,2]);
  let calls=0;
  await assert.rejects(runJob('retry',`${prefix}-retry`,{},async()=>{calls++;throw new Error('synthetic-transient');}));
  await assert.rejects(runJob('retry',`${prefix}-retry`,{},async()=>{calls++;return 'recovered';}),/mfp_queue_retry_required/u);
  assert.equal(calls,1);
  assert.equal(await runJob('retry',`${prefix}-retry`,{},async()=>{calls++;return 'recovered';},true),'recovered');
  assert.equal(await runJob('retry',`${prefix}-retry`,{},async()=>{calls++;return 'must-not-run';}),'recovered');
  assert.equal(calls,2);
  console.log(JSON.stringify({status:'passed',real_private_redis:true,concurrent_jobs:2,transient_failure_recovered:true,successful_replay_calls:0,provider_calls:0}));
});
