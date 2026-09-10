import assert from "node:assert/strict";
import test from "node:test";

import { appendSignalTopicCandidateRefinementTerminalReceiptV1,
  claimSignalTopicCandidateRefinementFlightExecutionV1,
  createSignalTopicCandidateRefinementFlightV1,
  SIGNAL_TOPIC_REFINEMENT_FLIGHT_CONFIRMATION,
  SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY } from "./signal-topic-evaluation-v2-candidate-refinement-flight";

const ids = { workspace: "00000000-0000-4000-8000-000000000001", run: "00000000-0000-4000-8000-000000000002",
  snapshot: "00000000-0000-4000-8000-000000000003", candidate: "00000000-0000-4000-8000-000000000004",
  session: "00000000-0000-4000-8000-000000000005", actor: "00000000-0000-4000-8000-000000000006" };
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const provenance = { source_clone_receipt_digest: digest, source_container_identity_digest: digest,
  migration_0116_checksum: digest, migration_0117_checksum: digest, migration_0118_checksum: digest };
const session = { id: ids.session, workspace_id: ids.workspace, run_id: ids.run, snapshot_id: ids.snapshot,
  candidate_id: ids.candidate, candidate_key: "topic.echo-deals", candidate_revision: 1,
  candidate_state_token: digest, candidate_version_digest: digest, brand_os_authority_digest: digest,
  snapshot_digest: digest };

function scriptedPool(rows: Array<Array<Record<string, unknown>>>) {
  const sql: string[] = [];
  const client = { async query(query: string) { sql.push(query); const next = rows.shift();
    assert.ok(next, `unexpected query: ${query.slice(0, 100)}`); return { rows: next, rowCount: next.length }; },
  release() { /* test double */ } };
  return { pool: { async connect() { return client; } }, sql };
}

test("refinement flight reserves the sealed $1 ceiling without any Topic write", async () => {
  const scripted = scriptedPool([[], [], [session], [{ flight_authority_digest: digest }], []]);
  const flight = await createSignalTopicCandidateRefinementFlightV1({ pool: scripted.pool as never,
    workspace_id: ids.workspace, actor: { id: ids.actor, user_type: "noisia_internal" },
    session_key: "topic-refine-0123456789abcdef", idempotency_key: "refinement.flight.test.001",
    confirmation: SIGNAL_TOPIC_REFINEMENT_FLIGHT_CONFIRMATION, provenance });
  assert.equal(flight.reserved_micro_usd, 1_000_000);
  assert.equal(flight.max_model_turns, 12);
  assert.equal(flight.topic_adoption, false);
  assert.equal(flight.publication, false);
  assert.equal(flight.serving, false);
  const write = scripted.sql.find((query) => /INSERT INTO signal_topic_evaluation_v2_candidate_refinement_flights/u.test(query));
  assert.ok(write);
  assert.doesNotMatch(write!, /candidate_editorial|topic_contract|publication|serving/iu);
});

test("terminal receipts settle known provider usage and do not expose provider text", async () => {
  const scripted = scriptedPool([[], [{ id: ids.session }], [{ terminal_digest: digest }], []]);
  const result = await appendSignalTopicCandidateRefinementTerminalReceiptV1({ pool: scripted.pool as never,
    workspace_id: ids.workspace, flight_key: "topic-refinement-flight-0123456789abcdef",
    terminal_status: "completed", provider_call_count: 1, input_tokens: 10, output_tokens: 5,
    settled_micro_usd: 105, provider_request_digest: digest, error_code: null });
  assert.equal(result.terminal_digest, digest);
  assert.equal(result.topic_adoption, false);
  assert.match(scripted.sql.join("\n"), /flight_terminal_receipts/u);
  assert.doesNotMatch(scripted.sql.join("\n"), /credential|prompt|mention|editorial|topic_contract/iu);
});

test("dispatch is claimed from persisted authority before any provider-capable runner can continue", async () => {
  const scripted = scriptedPool([[], [{ flight_key: "topic-refinement-flight-0123456789abcdef",
    session_key: "topic-refine-0123456789abcdef", candidate_key: "topic.echo-deals" }], [{ id: ids.session }], []]);
  const claimed = await claimSignalTopicCandidateRefinementFlightExecutionV1({ pool: scripted.pool as never,
    workspace_id: ids.workspace, actor: { id: ids.actor, user_type: "noisia_internal" },
    flight_key: "topic-refinement-flight-0123456789abcdef" });
  assert.equal(claimed.candidate_key, "topic.echo-deals");
  assert.match(scripted.sql.join("\n"), /flight_dispatch_claims/u);
});

test("core refuses nullable known-response settlement before opening a database transaction", async () => {
  let connected = false;
  await assert.rejects(appendSignalTopicCandidateRefinementTerminalReceiptV1({ pool: {
    async connect() { connected = true; throw new Error("must_not_connect"); }
  } as never, workspace_id: ids.workspace, flight_key: "topic-refinement-flight-0123456789abcdef",
  terminal_status: "completed", provider_call_count: 1, input_tokens: null, output_tokens: 1,
  settled_micro_usd: 15, provider_request_digest: null, error_code: null }),
  /topic_refinement_terminal_input_invalid/u);
  assert.equal(connected, false);
});

test("flight policy worst case remains below the sealed hard cap", () => {
  const policy = SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY;
  const worst = policy.max_input_tokens * policy.input_micro_usd_per_token
    + policy.max_output_tokens * policy.output_micro_usd_per_token;
  assert.equal(worst, 900_000);
  assert.ok(worst <= policy.hard_cap_micro_usd);
  assert.equal(policy.hard_cap_micro_usd, 1_000_000);
});
