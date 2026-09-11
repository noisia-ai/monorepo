import assert from "node:assert/strict";
import test from "node:test";

import { SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RUN_CONTRACT_VERSION } from "@noisia/query-engine";
import { drainSignalSemanticContextProposalOutboxV1 } from "./signal-semantic-context-proposal-outbox";

test("semantic context outbox dispatches the closed job once and completes its lease", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const database = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql.includes("claim_signal_semantic_context")) return { rows: [{ outbox_id: crypto.randomUUID(),
      run_id: "11111111-1111-4111-8111-111111111111", workspace_id: crypto.randomUUID(),
      lease_token: crypto.randomUUID(), worker_job_id: "semantic-context-proposal-run-1",
      dispatch_attempt: 1 }] };
    if (sql.includes("complete_signal_semantic_context")) return { rows: [{ completed: true }] };
    return { rows: [] };
  } };
  const queued: unknown[] = [];
  const result = await drainSignalSemanticContextProposalOutboxV1({ database: database as never,
    queue: { async add(name, data, options) { queued.push({ name, data, options }); return {}; } } });
  assert.deepEqual(result, { claimed: 1, dispatched: 1, failed: 0, dead_lettered: 0 });
  assert.deepEqual(queued[0], { name: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME,
    data: { contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RUN_CONTRACT_VERSION,
      run_id: "11111111-1111-4111-8111-111111111111" },
    options: { jobId: "semantic-context-proposal-run-1", attempts: 1,
      removeOnComplete: { age: 1_209_600, count: 2_000 },
      removeOnFail: { age: 2_592_000, count: 2_000 } } });
  assert.ok(calls.some((call) => call.sql.includes("complete_signal_semantic_context")));
});

test("semantic context outbox records a failed dispatch without logging payloads", async () => {
  const calls: string[] = [];
  const database = { async query(sql: string) {
    calls.push(sql);
    if (sql.includes("claim_signal_semantic_context")) return { rows: [{ outbox_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), lease_token: crypto.randomUUID(),
      worker_job_id: "job", dispatch_attempt: 2 }] };
    if (sql.includes("fail_signal_semantic_context")) return { rows: [{ status: "failed" }] };
    return { rows: [] };
  } };
  const result = await drainSignalSemanticContextProposalOutboxV1({ database: database as never,
    queue: { async add() { throw new Error("fixture queue unavailable"); } } });
  assert.deepEqual(result, { claimed: 1, dispatched: 0, failed: 1, dead_lettered: 0 });
  assert.ok(calls.some((sql) => sql.includes("fail_signal_semantic_context")));
});

test("the durable recovery drainer advances preparation even with no proposal outbox rows", async () => {
  const calls: string[]=[];
  const database={async query(sql:string){calls.push(sql);return{rows:[],rowCount:0};},async connect(){throw new Error('no candidate should lease');}};
  const { signalBrandContextPreparationRuntimeFromEnvV1 }=await import('@noisia/db');
  const result=await drainSignalSemanticContextProposalOutboxV1({database:database as never,queue:{async add(){throw new Error('no dispatch');}},
    preparation:{database:database as never,runtime:signalBrandContextPreparationRuntimeFromEnvV1({},
      {queue_configured:false,worker_alive:false,recovery_alive:false})}});
  assert.equal(result.claimed,0);
  assert.ok(calls[0]?.includes("op.action='prepare-brand-context'"));
  assert.ok(calls[1]?.includes('claim_signal_semantic_context_proposal_dispatch'));
});

test("a coordinator failure is recorded and retried instead of being hidden by an empty proposal queue", async () => {
  const calls:Array<{sql:string;values?:unknown[]}>=[];
  const client={async query(sql:string,values?:unknown[]){calls.push({sql,values});return{rows:[],rowCount:0};},release(){}};
  const database={async query(sql:string,values?:unknown[]){calls.push({sql,values});
    if(sql.includes("op.action='prepare-brand-context'"))return{rows:[{id:'11111111-1111-4111-8111-111111111111',
      workspace_id:'22222222-2222-4222-8222-222222222222',actor_user_id:'33333333-3333-4333-8333-333333333333'}],rowCount:1};
    return{rows:[],rowCount:0};},async connect(){return client;}};
  const { signalBrandContextPreparationRuntimeFromEnvV1 }=await import('@noisia/db');
  await assert.rejects(drainSignalSemanticContextProposalOutboxV1({database:database as never,queue:{async add(){throw new Error('no dispatch');}},
    preparation:{database:database as never,runtime:signalBrandContextPreparationRuntimeFromEnvV1({},
      {queue_configured:false,worker_alive:false,recovery_alive:false})}}),/brand_context_forbidden/);
  assert.ok(calls.some(call=>call.sql==='ROLLBACK'));
  assert.ok(calls.some(call=>call.sql.includes('SET brand_context_progress=')&&call.values?.[1]==='brand_context_forbidden'));
  assert.ok(calls.some(call=>call.sql.includes('claim_signal_semantic_context_proposal_dispatch')));
});
