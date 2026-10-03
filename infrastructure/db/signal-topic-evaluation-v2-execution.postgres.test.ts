import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildSignalTopicEvaluationExecutionFlightCardV2,
  SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION } from "@noisia/query-engine";
import pg from "pg";

import { claimSignalTopicEvaluationV2ExecutionAuthority,
  createSignalTopicEvaluationV2ExecutionAuthority,
  recordSignalTopicEvaluationV2ProviderTurnAttempt,
  settleSignalTopicEvaluationV2ExecutionFailure } from "./signal-topic-evaluation-v2";
import { processSignalTopicEvaluationV2ProviderRun } from "../../services/workers/src/workers/signal-topic-evaluation-v2";
import { SignalTopicEvaluationProviderResponseInvalidErrorV2 }
  from "../../services/workers/src/providers/anthropic-full-evidence-topic-evaluation";

const DATABASE_URL=process.env.NOISIA_TOPIC_EVALUATION_V2_EXECUTION_URL;
const APPROVED=process.env.NOISIA_TOPIC_EVALUATION_V2_EXECUTION_APPROVED==="true";

test("0113 creates one local-only execution authority and terminalizes a proven pre-transport failure",{
  skip:!DATABASE_URL||!APPROVED,timeout:60_000
},async()=>{
  assert.ok(DATABASE_URL);assert.match(DATABASE_URL,/^(?:postgres(?:ql)?:\/\/)?(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//u,
    "execution authority integration is local-only");
  const pool=new pg.Pool({connectionString:DATABASE_URL,ssl:false,max:3});
  try{
    const authority=(await pool.query<{workspace_id:string;actor_id:string;snapshot_digest:string}>(`SELECT
      snapshot.workspace_id::text workspace_id,run.requested_by_user_id::text actor_id,snapshot.snapshot_digest
      FROM signal_topic_evaluation_v2_snapshots snapshot
      JOIN signal_topic_evaluation_runs run ON run.workspace_id=snapshot.workspace_id
      WHERE snapshot.state='frozen' ORDER BY snapshot.created_at DESC LIMIT 1`)).rows[0];
    assert.ok(authority,"local fixture contains frozen snapshot and internal actor");
    const configuration={enabled:true,runtime_profile:"uat" as const,credential_configured:true,
      provider:"anthropic" as const,model:"claude-sonnet-5",pricing_version:"local-r29-test",
      input_micro_usd_per_token:1,output_micro_usd_per_token:1,
      flight_card:buildSignalTopicEvaluationExecutionFlightCardV2({provider_calls_allowed:1,
        max_model_turns:1,max_tool_calls:1,max_tool_result_bytes:1024,max_total_tool_result_bytes:1024,
        max_total_input_tokens:100,max_total_output_tokens:100,hard_cap_micro_usd:1000})};
    const created=await createSignalTopicEvaluationV2ExecutionAuthority({pool,workspace_id:authority.workspace_id,
      actor:{id:authority.actor_id,user_type:"noisia_internal"},idempotency_key:`r29-db-${randomUUID()}`,
      expected_snapshot_digest:authority.snapshot_digest,confirmation:SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION,
      configuration});
    assert.equal(created.reserved_micro_usd,200);

    await assertDirectSqlRejected(pool,async(client)=>{
      await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations SET status='failed',
        error_code='forged_authorized_failure',settled_micro_usd=0,completed_at=clock_timestamp()
        WHERE id=$1::uuid`,[created.execution_authorization_id]);
    },/transition is invalid/u);
    await assertDirectSqlRejected(pool,async(client)=>{
      await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations
        SET settled_micro_usd=0 WHERE id=$1::uuid`,[created.execution_authorization_id]);
    },/transition is invalid/u);
    await assertDirectSqlRejected(pool,async(client)=>{
      await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations
        SET error_code='forged_premature_error' WHERE id=$1::uuid`,[created.execution_authorization_id]);
    },/transition is invalid/u);
    await assertDirectSqlRejected(pool,async(client)=>{
      await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations
        SET completed_at=clock_timestamp() WHERE id=$1::uuid`,[created.execution_authorization_id]);
    },/transition is invalid/u);
    await assertDirectSqlRejected(pool,async(client)=>{
      await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations SET status='failed',
        error_code='forged_desync',settled_micro_usd=0,completed_at=clock_timestamp()
        WHERE id=$1::uuid`,[created.execution_authorization_id]);
      await client.query(`INSERT INTO signal_topic_evaluation_v2_execution_authorizations(
        workspace_id,snapshot_id,requested_by_user_id,idempotency_key,authorization_key,confirmation,
        runtime_profile,provider,model,pricing_version,input_micro_usd_per_token,
        output_micro_usd_per_token,flight_card,flight_card_digest,reserved_micro_usd)
        SELECT workspace_id,snapshot_id,requested_by_user_id,idempotency_key||'-second',
          authorization_key||'-second',confirmation,runtime_profile,provider,model,pricing_version,
          input_micro_usd_per_token,output_micro_usd_per_token,flight_card,flight_card_digest,
          reserved_micro_usd FROM signal_topic_evaluation_v2_execution_authorizations
        WHERE id=$1::uuid`,[created.execution_authorization_id]);
    },/transition is invalid/u);

    const claimed=await claimSignalTopicEvaluationV2ExecutionAuthority({pool,run_id:created.run_id});
    assert.equal(claimed.snapshot_digest,authority.snapshot_digest);
    assert.deepEqual(await recordSignalTopicEvaluationV2ProviderTurnAttempt({pool,run_id:created.run_id}),
      {provider_call_count:1,max_provider_calls:1});
    await assertDirectSqlRejected(pool,async(client)=>{
      await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations
        SET provider_call_count=0 WHERE id=$1::uuid`,[created.execution_authorization_id]);
    },/transition is invalid/u);
    await assertDirectSqlRejected(pool,async(client)=>{
      await client.query(`UPDATE signal_topic_evaluation_v2_runs SET status='failed',
        error_code='forged_run_only_failure',settled_micro_usd=0,completed_at=clock_timestamp()
        WHERE id=$1::uuid`,[created.run_id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    },/pair is invalid/u);
    await assertDirectSqlRejected(pool,async(client)=>{
      await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations SET status='failed',
        error_code='forged_authority_only_failure',settled_micro_usd=0,completed_at=clock_timestamp()
        WHERE id=$1::uuid`,[created.execution_authorization_id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    },/pair is invalid/u);
    const settled=await settleSignalTopicEvaluationV2ExecutionFailure({pool,run_id:created.run_id,
      outcome:"definitely_not_sent",error_code:"topic_evaluation_provider_definitely_not_sent",
      provider_call_count:1,observed_input_tokens:0,observed_output_tokens:0,observed_cost_micro_usd:0});
    assert.deepEqual(settled,{status:"failed",settled_micro_usd:0,provider_call_count:1});
    const recorded=await pool.query<{run_status:string;authority_status:string;retrievals:number;candidates:number}>(`SELECT
      run.status run_status,authority.status authority_status,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals WHERE run_id=run.id) retrievals,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=run.id) candidates
      FROM signal_topic_evaluation_v2_runs run
      JOIN signal_topic_evaluation_v2_execution_authorizations authority ON authority.id=run.execution_authorization_id
      WHERE run.id=$1::uuid`,[created.run_id]);
    assert.deepEqual(recorded.rows[0],{run_status:"failed",authority_status:"failed",retrievals:0,candidates:0});
    await assert.rejects(pool.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations
      SET model='other-model' WHERE id=$1::uuid`,[created.execution_authorization_id]),
    /invalid/u);
    await assert.rejects(pool.query(`UPDATE signal_topic_evaluation_v2_runs
      SET execution_authorization_id=NULL WHERE id=$1::uuid`,[created.run_id]),
    /append-only/u);

    const factoryFailure=await createSignalTopicEvaluationV2ExecutionAuthority({pool,workspace_id:authority.workspace_id,
      actor:{id:authority.actor_id,user_type:"noisia_internal"},idempotency_key:`r29-factory-${randomUUID()}`,
      expected_snapshot_digest:authority.snapshot_digest,confirmation:SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION,
      configuration});
    const terminal=await processSignalTopicEvaluationV2ProviderRun({pool,run_id:factoryFailure.run_id,
      create_model:()=>{throw new Error("local model factory failure");}});
    assert.deepEqual(terminal,{status:"failed",run_id:factoryFailure.run_id,provider_call_count:0,
      settled_micro_usd:0,error_code:"topic_evaluation_v2_provider_pretransport_failed"});

    const invalidResponse=await createSignalTopicEvaluationV2ExecutionAuthority({pool,workspace_id:authority.workspace_id,
      actor:{id:authority.actor_id,user_type:"noisia_internal"},idempotency_key:`r29-response-${randomUUID()}`,
      expected_snapshot_digest:authority.snapshot_digest,confirmation:SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION,
      configuration});
    const knownTerminal=await processSignalTopicEvaluationV2ProviderRun({pool,run_id:invalidResponse.run_id,
      create_model:()=>({next:async()=>{throw new SignalTopicEvaluationProviderResponseInvalidErrorV2({
        input_tokens:12,output_tokens:8,cost_micro_usd:20});}})});
    assert.deepEqual(knownTerminal,{status:"failed",run_id:invalidResponse.run_id,provider_call_count:1,
      settled_micro_usd:20,error_code:"topic_evaluation_v2_provider_response_or_control_invalid"});

    const ambiguous=await createSignalTopicEvaluationV2ExecutionAuthority({pool,
      workspace_id:authority.workspace_id,actor:{id:authority.actor_id,user_type:"noisia_internal"},
      idempotency_key:`r29-valid-outcome-${randomUUID()}`,
      expected_snapshot_digest:authority.snapshot_digest,
      confirmation:SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION,configuration});
    await claimSignalTopicEvaluationV2ExecutionAuthority({pool,run_id:ambiguous.run_id});
    await recordSignalTopicEvaluationV2ProviderTurnAttempt({pool,run_id:ambiguous.run_id});
    assert.deepEqual(await settleSignalTopicEvaluationV2ExecutionFailure({pool,run_id:ambiguous.run_id,
      outcome:"ambiguous_after_send",error_code:"topic_evaluation_v2_test_outcome_unknown",
      provider_call_count:1,observed_input_tokens:0,observed_output_tokens:0,observed_cost_micro_usd:0}),
    {status:"outcome_unknown",settled_micro_usd:null,provider_call_count:1});

  }finally{await pool.end();}
});

async function assertDirectSqlRejected(pool:pg.Pool,operation:(client:pg.PoolClient)=>Promise<void>,
  expected:RegExp){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await assert.rejects(operation(client),expected);
  }finally{
    await client.query("ROLLBACK").catch(()=>undefined);
    client.release();
  }
}
