import assert from "node:assert/strict";
import test from "node:test";
import { beginSignalWorkspaceEngineV1, type SignalWorkspaceEngineDatabaseV1 } from "./signal-workspace-engine";

const input={database:{connect(){throw new Error("unexpected database work");}} as unknown as SignalWorkspaceEngineDatabaseV1,
  workspace_id:"10000000-0000-4000-8000-000000000001",actor_user_id:"10000000-0000-4000-8000-000000000002",
  embedding_run_id:"10000000-0000-4000-8000-000000000003",idempotency_key:"discovery-guard-test",
  expected_context_digest:`sha256:${"a".repeat(64)}`,expected_catalog_digest:`sha256:${"b".repeat(64)}`,
  claude_cap_micro_usd:0,engine_config:{}};

test("MFP full discovery requires the explicit numeric path and does not enable legacy sampling",async()=>{
 const previous=process.env.NOISIA_MENTION_FACETS_ENABLED;
 try {
  process.env.NOISIA_MENTION_FACETS_ENABLED="true";
  await assert.rejects(beginSignalWorkspaceEngineV1({...input,incremental_options:{close_requested:false}}),/unexpected database work/u);
  await assert.rejects(beginSignalWorkspaceEngineV1({...input,parent_execution_id:input.embedding_run_id}),/workspace_engine_discovery_incremental_required/u);
  process.env.NOISIA_MENTION_FACETS_ENABLED="false";
  await assert.rejects(beginSignalWorkspaceEngineV1({...input,discovery_sample_cap:100}),/workspace_engine_discovery_disabled/u);
 } finally {if(previous===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=previous;}
});
