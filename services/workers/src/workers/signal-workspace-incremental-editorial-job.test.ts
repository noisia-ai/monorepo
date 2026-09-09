import assert from 'node:assert/strict';
import test from 'node:test';
import {SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_JOB_NAME as name,signalWorkspaceIncrementalEditorialJobV1 as runJob} from './signal-workspace-incremental-editorial-job';
const execution_id='20000000-0000-4000-8000-000000000002';
const id=`signal-workspace-incremental-editorial-${execution_id}-1`;

test('editorial queue accepts only its admitted job identity and never trusts payload money or actor',async()=>{
  const database={} as never;let calls=0;
  const result=await runJob({name,id,data:{execution_id,actor_user_id:'foreign',api_key:'not-a-key',provider_enabled:true,cap:999}},
    {database,run:async args=>{calls++;assert.deepEqual(args,{database,execution_id,worker_job_id:id});return{execution_id,completed:true,replayed:true};}});
  assert.equal(calls,1);assert.deepEqual(result,{execution_id,completed:true,replayed:true});
});

test('wrong contract, malformed payload and changed job IDs never enter the editorial consumer',async()=>{
  for(const job of [{name:'signal_workspace_engine_v1',id,data:{execution_id}},
    {name,id:undefined,data:{execution_id}},{name,id:id.replace('-1','-2'),data:{execution_id}},
    {name,id,data:null},{name,id,data:{execution_id:'invalid'}},{name,id,data:{execution_id:'30000000-0000-4000-8000-000000000003'}}])
    await assert.rejects(runJob(job,{database:{} as never,run:async()=>assert.fail('consumer must not run')}),/editorial_job_invalid/u);
});

test('consumer failures remain failures without dispatch or retry in the wrapper',async()=>{
  let calls=0;const error=new Error('workspace_engine_interpretation_outcome_unknown');
  await assert.rejects(runJob({name,id,data:{execution_id}},{database:{} as never,run:async()=>{calls++;throw error;}}),{message:error.message});
  assert.equal(calls,1);
});

test('setup and claim failure details do not become a persisted BullMQ failedReason',async()=>{
  await assert.rejects(runJob({name,id,data:{execution_id}},{database:{} as never,
    run:async()=>{throw new Error('private database statement and storage details');}}),{message:'workspace_incremental_editorial_worker_failed'});
});
