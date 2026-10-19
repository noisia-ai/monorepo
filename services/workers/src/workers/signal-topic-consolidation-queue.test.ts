import assert from "node:assert/strict";
import test from "node:test";

import {
  drainSignalTopicConsolidationOutboxV1,
  SIGNAL_TOPIC_CONSOLIDATION_NUMERIC_JOB_V1,
  signalTopicConsolidationNumericJobV1,
  startSignalTopicConsolidationOutboxDrainerV1,
  type SignalTopicConsolidationQueueStoresV1,
} from "./signal-topic-consolidation-queue";

const id = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const dispatch = { dispatch_id: id(1), execution_id: id(2), workspace_id: id(3),
  worker_job_id: `topic-consolidation-${id(2)}-1`, lease_token: id(4), attempt: 1 };
const lease = { execution_id: id(2), workspace_id: id(3), actor_user_id: id(5), source_execution_id: id(6),
  worker_job_id: dispatch.worker_job_id, execution_token: id(7) };

function stores(overrides: Partial<SignalTopicConsolidationQueueStoresV1> = {}): SignalTopicConsolidationQueueStoresV1 {
  return {
    recoverExecutions: async () => 0,
    claimDispatch: async () => [dispatch],
    acknowledgeDispatch: async () => true,
    failDispatch: async () => true,
    claimExecution: async () => lease,
    heartbeatExecution: async () => true,
    completeExecution: async () => true,
    failExecution: async () => true,
    ...overrides,
  };
}

test("drainer dispatches one durable numeric job after recovery and acknowledges its lease", async () => {
  const calls: string[] = [];
  const queue = { async getJob() { return null; }, async add(name: string, data: unknown, options: Record<string,unknown>) {
    calls.push("add"); assert.equal(name,SIGNAL_TOPIC_CONSOLIDATION_NUMERIC_JOB_V1);
    assert.deepEqual(data,{ execution_id: dispatch.execution_id }); assert.equal(options.jobId,dispatch.worker_job_id);
  } };
  const store = stores({ recoverExecutions: async () => { calls.push("recover"); return 0; },
    claimDispatch: async args => { calls.push("claim"); assert.equal(args.worker_id,"worker-a"); return [dispatch]; },
    acknowledgeDispatch: async args => { calls.push("ack"); assert.equal(args.dispatch_id,dispatch.dispatch_id); return true; } });
  const result = await drainSignalTopicConsolidationOutboxV1({ database: {} as never,queue,stores: store,worker_id: "worker-a" });
  assert.deepEqual(calls,["recover","claim","add","ack"]);
  assert.deepEqual(result,{ claimed:1,dispatched:1,recovered:0,failed:0 });
});

test("long numeric work uses its own pool and never overlaps heartbeats blocked behind its owner lock", async () => {
  const controlDatabase = {} as never, numericDatabase = {} as never;
  let heartbeats = 0, activeHeartbeats = 0, highestHeartbeats = 0, completed = 0;
  let releaseHeartbeat: (() => void) | undefined;
  const blocked = new Promise<void>(resolve => { releaseHeartbeat = resolve; });
  const store = stores({ claimExecution: async args => { assert.equal(args.database,controlDatabase); return lease; },
    heartbeatExecution: async args => {
      assert.equal(args.database,controlDatabase); heartbeats++; activeHeartbeats++;
      highestHeartbeats = Math.max(highestHeartbeats,activeHeartbeats);
      await blocked; activeHeartbeats--; return true;
    }, completeExecution: async args => {
      assert.equal(args.database,controlDatabase); assert.equal(activeHeartbeats,0); completed++; return true;
    } });
  await signalTopicConsolidationNumericJobV1({ id:dispatch.worker_job_id,data:{ execution_id:dispatch.execution_id },updateProgress:async()=>{} },
    { database:controlDatabase,numeric_database:numericDatabase,stores:store,heartbeat_ms:5,
      run:(async (_job:unknown,options:{database:unknown}) => {
        assert.equal(options.database,numericDatabase);
        await new Promise(resolve=>setTimeout(resolve,35));
        assert.equal(heartbeats,1,'a row-lock wait must not accumulate pool clients on every timer tick');
        releaseHeartbeat!(); return {consolidation_run_id:id(8)};
      }) as never });
  assert.equal(highestHeartbeats,1); assert.equal(completed,1);
});

test("transient control timeout is contained and a subsequent drainer tick can claim again", async () => {
  let ticks = 0, added = 0;
  const store = stores({ recoverExecutions:async()=>{
    if (++ticks===1) throw new Error('timeout exceeded when trying to connect'); return 0;
  } });
  const drainer = startSignalTopicConsolidationOutboxDrainerV1({ database:{} as never,stores:store,
    queue:{getJob:async()=>null,add:async()=>{added++;}},run_immediately:false,interval_ms:60_000 });
  try { await drainer.drainNow(); await drainer.drainNow(); assert.equal(ticks,2); assert.equal(added,1); }
  finally { await drainer.close(); }
});

test("lost dispatch ACK redelivers the retained job ID instead of adding a second job", async () => {
  let pass = 0, adds = 0, retries = 0;
  const store = stores({ claimDispatch: async () => [dispatch], acknowledgeDispatch: async () => {
    if (pass++ === 0) throw new Error("transport_lost_after_commit"); return true;
  } });
  const queue = { async getJob() { return pass === 0 ? null : { async getState() { return "completed"; },
    async retry(state: string) { assert.equal(state,"completed"); retries++; } }; },
  async add() { adds++; } };
  const first = await drainSignalTopicConsolidationOutboxV1({ database:{} as never,queue,stores:store,worker_id:"worker-a" });
  const second = await drainSignalTopicConsolidationOutboxV1({ database:{} as never,queue,stores:store,worker_id:"worker-a" });
  assert.equal(first.failed,1); assert.equal(second.dispatched,1); assert.equal(second.recovered,1);
  assert.equal(adds,1); assert.equal(retries,1);
});

test("completed PostgreSQL execution skips the numeric census on BullMQ redelivery", async () => {
  let runs = 0;
  const result = await signalTopicConsolidationNumericJobV1({ id:dispatch.worker_job_id,
    data:{ execution_id:dispatch.execution_id },updateProgress:async()=>undefined }, { database:{} as never,
    stores:stores({ claimExecution:async()=>({ completed:true,execution_id:dispatch.execution_id }) }),
    run:async()=>{runs++; throw new Error("must_not_run");} });
  assert.equal(runs,0); assert.equal(result.replayed,true);
});

test("completion response loss reclaims the completed execution without recalculating", async () => {
  let claims = 0, runs = 0, completions = 0;
  const store = stores({ claimExecution:async()=>claims++ === 0 ? lease :
    ({ completed:true,execution_id:dispatch.execution_id }),
  completeExecution:async()=>{completions++; throw new Error("transport_lost_after_commit");} });
  const job = { id:dispatch.worker_job_id,data:{ execution_id:dispatch.execution_id },updateProgress:async()=>undefined };
  const options = { database:{} as never,stores:store,
    run:(async()=>{runs++; return { consolidation_run_id:id(8) };}) as never };
  await assert.rejects(signalTopicConsolidationNumericJobV1(job,options),/signal_topic_consolidation_worker_failed/);
  const replay = await signalTopicConsolidationNumericJobV1(job,options);
  assert.equal(replay.replayed,true); assert.equal(runs,1); assert.equal(completions,1);
});

test("consumer passes the complete control lease and refuses completion after heartbeat loss", async () => {
  let completed = 0, failed = 0;
  const store = stores({ heartbeatExecution:async args=>{
    assert.deepEqual(args.lease,lease); return false;
  },completeExecution:async()=>{completed++; return true;},failExecution:async()=>{failed++; return true;} });
  await assert.rejects(signalTopicConsolidationNumericJobV1({ id:dispatch.worker_job_id,
    data:{ execution_id:dispatch.execution_id },updateProgress:async()=>undefined }, { database:{} as never,
    stores:store,heartbeat_ms:5,run:(async (_job:unknown,options:{control_execution?:unknown})=>{
      assert.deepEqual(options.control_execution,{ execution_id:lease.execution_id,execution_token:lease.execution_token,
        workspace_id:lease.workspace_id,actor_user_id:lease.actor_user_id });
      await new Promise(resolve=>setTimeout(resolve,15)); return { consolidation_run_id:id(8) };
    }) as never }),/signal_topic_consolidation_lease_lost/);
  assert.equal(completed,0); assert.equal(failed,1);
});
