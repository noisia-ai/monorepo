import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
  parseSignalSemanticContextProposalResponseV3,
  type SignalSemanticContextProposalProviderV1
} from "@noisia/query-engine";
import {
  prepareSignalSemanticContextProposalInputV1,
  processSignalSemanticContextProposalRunV1,
  SignalSemanticContextProviderCallError
} from "../signal-semantic-context-proposal";
import { retrySignalBrandContextComposedSemanticRunV1 } from "../signal-brand-context-prototype-processing";
import {
  seedComposedFixture, quoteComposedFixture, startComposedFixture, composedBundleCounts,
  semanticConfiguration, composedRuntime, type ComposedFixture
} from "./signal-brand-context-composed-admission.postgres.test";

type Scope = { database: Pool; parent_receipt_id: string; actor_user_id: string;
  configuration: typeof semanticConfiguration; runtime: typeof composedRuntime };
type Quote = { quote_digest: string; quote_expires_at: string; admission_not_after: string;
  maximum_micro_usd: string; reservation_micro_usd: string; run_id: string };
type Renewal = { renewal_id: string; run_id: string; status: string; replayed: boolean };
export type SignalBrandContextSemanticRenewalTestSeamsV1 = {
  quote: (args: Scope) => Promise<Quote>;
  renew: (args: Scope & { idempotency_key: string; expected_quote_digest: string;
    confirmation: "renew_brand_context_semantic_within_shown_cap" }) => Promise<Renewal>;
};

// This helper has no connection, environment, migration, COMMIT or network setup.
// The approved runner supplies one physical transaction plus its existing
// BEGIN/COMMIT-to-savepoint Pool adapter. All test material comes from the
// synthetic composed fixture; provider responses use server-prepared aliases.
async function branch(client: PoolClient, name: string, body: () => Promise<void>) {
  assert.match(name, /^[a-z_]+$/u);
  await client.query(`SAVEPOINT ${name}`);
  try { await body(); }
  finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
  }
}

function closedDenial(error: unknown) {
  // Never serialize SQL text, parameters, UUIDs, private responses or error.detail.
  return error instanceof Error && /^(?:brand_context|processing|semantic_context)_[a-z_]+$/u.test(error.message);
}

async function replacePolicy(database: Pool, fixture: ComposedFixture, changedCap = false) {
  const previous = (await database.query<{ id: string }>(`SELECT id::text
    FROM signal_processing_policy_versions WHERE organization_id=$1::uuid AND status='active'`,
  [fixture.organizationId])).rows[0];
  assert.ok(previous);
  await database.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1::uuid", [previous.id]);
  const id = randomUUID();
  await database.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,
    valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
    SELECT $2::uuid,organization_id,version+1,clock_timestamp()-interval '1 second',
      clock_timestamp()+interval '1 hour',budget_timezone,daily_cap_micro_usd,created_by_user_id
    FROM signal_processing_policy_versions WHERE id=$1::uuid`, [previous.id, id]);
  await database.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,
    provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $2::uuid,action,kind,provider,model,configuration,configuration_digest,
      max_execution_micro_usd-CASE WHEN $3::boolean AND action='brand_context_proposal' THEN 1 ELSE 0 END,
      automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1::uuid`,
  [previous.id, id, changedCap]);
  await database.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1::uuid", [id]);
}

async function recorded(database: Pool, receiptId: string) {
  const row = (await database.query<{ receipt: Record<string, unknown>; admission: Record<string, unknown>;
    reservation: Record<string, unknown>; run: Record<string, unknown>; outbox: Record<string, unknown> }>(`
    SELECT to_jsonb(receipt) receipt,to_jsonb(admission) admission,to_jsonb(reservation) reservation,
      to_jsonb(run) run,to_jsonb(outbox) outbox
    FROM signal_brand_context_processing_receipts receipt
    JOIN signal_processing_admissions admission ON admission.id=receipt.semantic_admission_id
    JOIN signal_semantic_context_proposal_runs run ON run.id=receipt.semantic_run_id
    JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id
    JOIN signal_semantic_context_proposal_outbox outbox ON outbox.run_id=run.id
    WHERE receipt.id=$1::uuid`, [receiptId])).rows[0];
  assert.ok(row);
  return row;
}

function immutableRun(run: Record<string, unknown>) {
  const fields = ["id", "workspace_id", "generation_id", "operation_id", "run_key", "processing_admission_id",
    "preflight_digest", "brand_os_digest", "knowledge_digest", "locale_context_digest", "prompt_digest",
    "context_input_digest", "provider", "model", "model_version", "pricing_version", "max_input_tokens",
    "max_output_tokens", "input_usd_per_million_tokens", "output_usd_per_million_tokens",
    "hard_cap_micro_usd", "reservation_micro_usd", "provider_request_identity", "created_by_user_id", "created_at"];
  return Object.fromEntries(fields.map(field => {
    assert.ok(Object.hasOwn(run, field), `run identity field ${field} must be retained`);
    return [field, run[field]];
  }));
}

/** New SQL0160 acceptance only. No historical gates are rerun. The caller must
 * install the reviewed migration in its disposable rollback transaction first.
 * Real deadline passage is mandatory: no clock, grant or call-history rewriting. */
export async function assertSignalBrandContextSemanticRenewalPostgresV1(args: {
  client: PoolClient; database: Pool; seams: SignalBrandContextSemanticRenewalTestSeamsV1;
  progress?: (stage: string) => void;
  /** Follow-up gate: prove only deferred atomicity after the existing DNC/expiry fixture. */
  addendum_only?: boolean;
}) {
  const { client, database, seams } = args;
  const stages: string[] = [];
  const progress = (stage: string) => { stages.push(stage); args.progress?.(stage); };
  const counters = { dnc_transport_simulations: 0, paid_response_simulations: 0, uncertain_simulations: 0,
    assertion_groups: 0 };
  const scopeFor = (fixture: ComposedFixture, receipt: string): Scope => ({ database,
    parent_receipt_id: receipt, actor_user_id: fixture.clientActorId,
    configuration: semanticConfiguration, runtime: composedRuntime });
  const request = (scope: Scope, quote: Quote, idempotencyKey = randomUUID()) => ({ ...scope,
    idempotency_key: idempotencyKey, expected_quote_digest: quote.quote_digest,
    confirmation: "renew_brand_context_semantic_within_shown_cap" as const });
  const flushRenewal = async () => {
    await client.query("SET CONSTRAINTS bc_semantic_renewal_complete IMMEDIATE");
    await client.query("SET CONSTRAINTS bc_semantic_renewal_complete DEFERRED");
  };
  progress("synthetic_stage_one_admission");
  const fixture = await seedComposedFixture(database, "semantic-renewal", { policyValidForSeconds: 10 });
  const firstQuote = await quoteComposedFixture(database, fixture); assert.ok(firstQuote.quote_digest);
  const accepted = await startComposedFixture(database, fixture, firstQuote.quote_digest, randomUUID());
  await client.query("SET CONSTRAINTS brand_context_processing_complete IMMEDIATE");
  await client.query("SET CONSTRAINTS brand_context_processing_complete DEFERRED");
  const scope = scopeFor(fixture, accepted.receipt_id);
  const unavailableScope = { ...scope, configuration: { ...semanticConfiguration, available: false },
    runtime: { ...composedRuntime, queue_configured: false, worker_alive: false, recovery_alive: false } };
  const exposure = async () => (await database.query(`SELECT to_jsonb(exposure) value
    FROM signal_processing_org_exposure_v1($1::uuid,
      (clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date,'America/Mexico_City') exposure`,
  [fixture.organizationId])).rows[0]!.value;
  const prepared = await prepareSignalSemanticContextProposalInputV1({ queryable: database,
    workspace: { id: fixture.workspaceId, organization_id: fixture.organizationId, brand_id: fixture.brandId },
    generation_key: fixture.generationKey });
  const primary = prepared.input.identity.primary.source_aliases.find(alias =>
    prepared.input.knowledge_blocks.some(block => block.source_alias === alias));
  assert.ok(primary);
  const response = JSON.stringify({ contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
    proposals: [{ scope: "primary_brand", entity_ref: prepared.input.identity.primary.entity_ref,
      locale: null, relation_kind: null, relation_target_key: null, confidence: 1,
      element_key: "identity.synthetic-renewal", element_kind: "identity_term", canonical_key: "synthetic-renewal",
      display_text: "Synthetic bicycle workshop", evidence: [{ source_alias: primary, relation_type: "supports" }] }] });
  parseSignalSemanticContextProposalResponseV3(response, prepared.input.limits.maximum_proposals);
  const seenRequestIdentities: string[] = [];
  const checkRequest = (input: Parameters<SignalSemanticContextProposalProviderV1["generate"]>[0]) => {
    assert.equal(input.prompt, prepared.prompt); assert.equal(input.model, semanticConfiguration.model);
    assert.equal(input.maximum_proposals, prepared.input.limits.maximum_proposals);
    assert.equal(input.max_output_tokens, prepared.input.limits.output_token_budget);
    seenRequestIdentities.push(input.request_identity);
    assert.equal(new Set(seenRequestIdentities).size, 1, "DNC retries keep the exact original provider identity");
  };
  const dnc: SignalSemanticContextProposalProviderV1 = { async generate(input) {
    checkRequest(input); counters.dnc_transport_simulations++;
    throw new SignalSemanticContextProviderCallError("synthetic_definitely_not_sent", true);
  } };
  const paid: SignalSemanticContextProposalProviderV1 = { async generate(input) {
    checkRequest(input); counters.paid_response_simulations++;
    return { text: response, provider_request_id: "synthetic-renewal-response", usage: { input_tokens: 1000, output_tokens: 500 } };
  } };
  const consume = (provider: SignalSemanticContextProposalProviderV1) =>
    processSignalSemanticContextProposalRunV1({ pool: database, run_id: accepted.run_id, provider });
  progress("worker_definitely_not_sent");
  await assert.rejects(() => consume(dnc), { message: "synthetic_definitely_not_sent" });
  const original = await recorded(database, accepted.receipt_id);
  assert.equal(original.run.status, "failed"); assert.equal(original.run.provider_call_state, "not_started");
  assert.equal(original.run.provider_call_count, 0); assert.equal(original.run.provider_response_private, null);
  assert.equal(original.run.lease_token, null); assert.equal(original.reservation.status, "reserved");
  const bundle = await composedBundleCounts(database, fixture.workspaceId);
  assert.deepEqual(bundle, { admissions: 1, receipts: 1, runs: 1, reservations: 1, outboxes: 1, operations: 1 });
  progress("real_authorization_expiry");
  const timing = (await database.query<{ remaining_ms: number; expired: boolean }>(`SELECT
    greatest(0,ceil(extract(epoch FROM (admission_not_after-clock_timestamp()))*1000))::int remaining_ms,
    admission_not_after<=clock_timestamp() expired FROM signal_processing_admissions WHERE id=$1::uuid`,
  [original.admission.id])).rows[0]!;
  assert.ok(timing.remaining_ms <= 10_000, "only the deliberately short synthetic grant may be awaited");
  if (!timing.expired) await new Promise(resolve => setTimeout(resolve, timing.remaining_ms + 25));
  assert.equal((await database.query<{ expired: boolean }>(`SELECT admission_not_after<=clock_timestamp() expired
    FROM signal_processing_admissions WHERE id=$1::uuid`, [original.admission.id])).rows[0]?.expired, true);
  await assert.rejects(() => retrySignalBrandContextComposedSemanticRunV1({ ...scope, idempotency_key: randomUUID() }),
    { message: "brand_context_semantic_authorization_expired" });
  assert.deepEqual(await recorded(database, accepted.receipt_id), original);
  await assert.rejects(() => seams.quote(scope), closedDenial);
  await replacePolicy(database, fixture);
  const quote = await seams.quote(scope);
  assert.equal(quote.run_id, accepted.run_id); assert.match(quote.quote_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(BigInt(quote.maximum_micro_usd), BigInt(String(original.reservation.reservation_micro_usd)));
  assert.equal(BigInt(quote.reservation_micro_usd), BigInt(String(original.reservation.reservation_micro_usd)));
  counters.assertion_groups++;

  progress("direct_grant_without_requeue_rejected");
  await branch(client, "incomplete_renewal", async () => {
    const inserted = await database.query(`WITH quoted AS MATERIALIZED (
      SELECT quote_signal_brand_context_semantic_renewal_v1($1::uuid,$2::uuid) value
    ), input AS (SELECT value->'quote_snapshot' s,value->>'quote_digest' q FROM quoted)
    INSERT INTO signal_brand_context_semantic_renewals(parent_receipt_id,admission_id,run_id,reservation_id,
      workspace_id,organization_id,actor_user_id,generation_id,supersedes_renewal_id,policy_version_id,
      budget_date,budget_timezone,admission_not_after,idempotency_key,request_digest,quote_digest,quote_snapshot,confirmation)
    SELECT (s->>'parent_receipt_id')::uuid,(s->>'admission_id')::uuid,(s->>'run_id')::uuid,
      (s->>'reservation_id')::uuid,(s->>'workspace_id')::uuid,(s->>'organization_id')::uuid,
      (s->>'actor_user_id')::uuid,(s->>'generation_id')::uuid,(s->>'supersedes_renewal_id')::uuid,
      (s->>'policy_version_id')::uuid,(s->>'budget_date')::date,s->>'budget_timezone',
      (s->>'admission_not_after')::timestamptz,$3,
      signal_semantic_context_digest_json_v2(jsonb_build_object('parent_receipt_id',$1::uuid,
        'actor_user_id',$2::uuid,'quote_digest',q,'confirmation','renew_brand_context_semantic_within_shown_cap')),
      q,s,'renew_brand_context_semantic_within_shown_cap' FROM input`,
    [accepted.receipt_id, fixture.clientActorId, randomUUID()]);
    assert.equal(inserted.rowCount, 1, "the grant itself must pass every immediate quote/identity constraint");
    assert.equal((await recorded(database, accepted.receipt_id)).run.status, "failed");
    await assert.rejects(() => client.query("SET CONSTRAINTS bc_semantic_renewal_complete IMMEDIATE"),
      { message: "brand_context_semantic_renewal_incomplete", code: "23514" });
  });
  assert.deepEqual(await recorded(database, accepted.receipt_id), original);
  assert.equal((await database.query<{ n: number }>(`SELECT count(*)::int n
    FROM signal_brand_context_semantic_renewals WHERE parent_receipt_id=$1::uuid`, [accepted.receipt_id])).rows[0]?.n, 0);
  counters.assertion_groups++;
  if (args.addendum_only) return { contract_version: "brand-context-semantic-renewal-postgres-addendum-v1" as const,
    ...counters, stages, expiry_used_real_clock: true, incomplete_bundle_rejected: true,
    original_owner_and_reservation_unchanged: true, single_writer_savepoints: true,
    transport_evidence_owned_by_runner: true };

  progress("negative_source_policy_actor_and_quote");
  for (const [name, mutate] of [
    ["source_changed", async () => { await database.query("UPDATE brands SET description='Changed synthetic authority' WHERE id=$1::uuid", [fixture.brandId]); }],
    ["policy_changed", async () => { await replacePolicy(database, fixture, true); }],
    ["actor_revoked", async () => { await database.query("UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1::uuid AND brand_id=$2::uuid", [fixture.clientActorId, fixture.brandId]); }]
  ] as const) await branch(client, name, async () => {
    await mutate(); const before = await recorded(database, accepted.receipt_id);
    await assert.rejects(() => seams.quote(scope), closedDenial);
    await assert.rejects(() => seams.renew(request(scope, quote)), closedDenial);
    assert.deepEqual(await recorded(database, accepted.receipt_id), before);
    assert.deepEqual(await composedBundleCounts(database, fixture.workspaceId), bundle);
    counters.assertion_groups++;
  });
  const denied = { ...request(scope, quote), expected_quote_digest: `sha256:${"0".repeat(64)}` };
  await assert.rejects(() => seams.renew(denied), closedDenial);
  await assert.rejects(() => seams.renew(request(unavailableScope, quote)), closedDenial);
  assert.deepEqual(await recorded(database, accepted.receipt_id), original); counters.assertion_groups++;

  progress("renewed_fast_failure_ack_replay");
  await branch(client, "renewal_fast_failure", async () => {
    const command = request(scope, quote); const renewal = await seams.renew(command);
    await flushRenewal();
    assert.equal(renewal.run_id, accepted.run_id); assert.equal(renewal.replayed, false);
    await assert.rejects(() => consume(dnc), { message: "synthetic_definitely_not_sent" });
    const failed = await recorded(database, accepted.receipt_id);
    assert.equal(failed.run.status, "failed");
    const replay = await seams.renew({ ...command, ...unavailableScope });
    assert.equal(replay.renewal_id, renewal.renewal_id); assert.equal(replay.replayed, true);
    assert.equal(replay.status, "failed");
    await assert.rejects(() => seams.renew({ ...command, expected_quote_digest: `sha256:${"0".repeat(64)}` }),
      { message: "processing_idempotency_conflict" });
    assert.deepEqual(await recorded(database, accepted.receipt_id), failed, "ACK replay must not requeue a fast failed run");
    assert.deepEqual(await composedBundleCounts(database, fixture.workspaceId), bundle);
    counters.assertion_groups++;
  });

  progress("renewed_in_flight_and_unknown_denied");
  await branch(client, "renewal_uncertain", async () => {
    await seams.renew(request(scope, quote));
    await flushRenewal();
    await assert.rejects(() => consume({ async generate(input) {
      checkRequest(input); counters.uncertain_simulations++;
      assert.equal((await recorded(database, accepted.receipt_id)).run.provider_call_state, "in_flight");
      await assert.rejects(() => seams.quote(scope), { message: "brand_context_semantic_run_not_renewable" });
      await assert.rejects(() => seams.renew(request(scope, quote)), { message: "brand_context_semantic_run_not_renewable" });
      throw new SignalSemanticContextProviderCallError("synthetic_outcome_unknown", false);
    } }), { message: "synthetic_outcome_unknown" });
    const unknown = await recorded(database, accepted.receipt_id);
    assert.equal(unknown.run.provider_call_state, "outcome_unknown");
    await assert.rejects(() => seams.quote(scope), { message: "brand_context_semantic_run_not_renewable" });
    await assert.rejects(() => seams.renew(request(scope, quote)), { message: "brand_context_semantic_run_not_renewable" });
    assert.deepEqual(await recorded(database, accepted.receipt_id), unknown); counters.assertion_groups++;
  });

  progress("combined_renewal_and_legacy_retry_limit");
  await branch(client, "renewal_combined_limit", async () => {
    const renewalCommand = request(scope, quote);
    await seams.renew(renewalCommand); await flushRenewal();
    await assert.rejects(() => consume(dnc), { message: "synthetic_definitely_not_sent" });
    for (let index = 0; index < 7; index++) {
      const retried = await retrySignalBrandContextComposedSemanticRunV1({ ...scope, idempotency_key: randomUUID() });
      assert.equal(retried.run_id, accepted.run_id); assert.equal(retried.replayed, false);
      await assert.rejects(() => consume(dnc), { message: "synthetic_definitely_not_sent" });
    }
    const counts = async () => (await database.query<{ renewals: number; retries: number }>(`SELECT
      (SELECT count(*)::int FROM signal_brand_context_semantic_renewals WHERE run_id=$1::uuid) renewals,
      (SELECT count(*)::int FROM signal_governance_control_operations WHERE workspace_id=$2::uuid
        AND action='retry-semantic-context-proposal-run' AND status='completed'
        AND result->>'run_id'=$1::text) retries`, [accepted.run_id, fixture.workspaceId])).rows[0]!;
    assert.deepEqual(await counts(), { renewals: 1, retries: 7 });
    const before = await recorded(database, accepted.receipt_id);
    await assert.rejects(() => retrySignalBrandContextComposedSemanticRunV1({ ...scope, idempotency_key: randomUUID() }),
      { message: "semantic_context_proposal_run_not_retryable" });
    assert.deepEqual(await counts(), { renewals: 1, retries: 7 });
    assert.deepEqual(await recorded(database, accepted.receipt_id), before);
    assert.deepEqual(await composedBundleCounts(database, fixture.workspaceId), bundle);
    assert.deepEqual(before.reservation, original.reservation);
    counters.assertion_groups++;
  });

  progress("renewal_preserves_existing_owner_and_reservation");
  const command = request(scope, quote); const renewed = await seams.renew(command);
  await flushRenewal();
  assert.equal(renewed.run_id, accepted.run_id); assert.equal(renewed.status, "queued"); assert.equal(renewed.replayed, false);
  const queued = await recorded(database, accepted.receipt_id);
  assert.deepEqual(queued.receipt, original.receipt); assert.deepEqual(queued.admission, original.admission);
  assert.deepEqual(queued.reservation, original.reservation);
  assert.deepEqual(immutableRun(queued.run), immutableRun(original.run));
  assert.deepEqual(await composedBundleCounts(database, fixture.workspaceId), bundle);
  const renewedExposure = await exposure();
  assert.equal(BigInt(String(renewedExposure.reserved_micro_usd)), BigInt(String(original.reservation.reservation_micro_usd)),
    "the original reservation is counted exactly once on the effective renewal day");
  assert.equal(BigInt(String(renewedExposure.total_micro_usd)), BigInt(String(original.reservation.reservation_micro_usd)));
  assert.equal(BigInt(String(renewedExposure.confirmed_micro_usd)), 0n);
  const replay = await seams.renew(command); assert.equal(replay.renewal_id, renewed.renewal_id); assert.equal(replay.replayed, true);
  assert.deepEqual(await recorded(database, accepted.receipt_id), queued); counters.assertion_groups++;

  progress("one_exact_simulated_send_then_paid_replay");
  const paidBefore = counters.paid_response_simulations;
  const completed = await consume(paid); assert.equal(completed.status, "completed");
  const settled = await recorded(database, accepted.receipt_id);
  assert.equal(settled.run.provider_call_state, "settled"); assert.equal(settled.run.provider_call_count, 1);
  assert.equal(settled.reservation.status, "settled");
  assert.equal(settled.reservation.actual_micro_usd, settled.run.settled_micro_usd);
  assert.equal(counters.paid_response_simulations - paidBefore, 1);
  const completedReplay = await seams.renew(command);
  assert.equal(completedReplay.renewal_id, renewed.renewal_id); assert.equal(completedReplay.replayed, true);
  await consume({ async generate() { assert.fail("completed run must not resend"); } });
  await assert.rejects(() => seams.quote(scope), { message: "brand_context_semantic_run_not_renewable" });
  await assert.rejects(() => seams.renew(request(scope, quote)), { message: "brand_context_semantic_run_not_renewable" });
  assert.deepEqual(await recorded(database, accepted.receipt_id), settled);
  assert.deepEqual(await composedBundleCounts(database, fixture.workspaceId), bundle); counters.assertion_groups++;
  return { contract_version: "brand-context-semantic-renewal-postgres-assertions-v1" as const,
    ...counters, stages, expiry_used_real_clock: true, owner_identity_retained: true,
    original_reservation_retained: true, single_writer_savepoints: true,
    transport_evidence_owned_by_runner: true };
}
