import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2,
  signalSemanticContextProposalDigestV1
} from "@noisia/query-engine";
import {
  SignalSemanticContextProviderCallError,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_REVALIDATION_CONFIRMATION,
  loadLatestSignalSemanticContextProposalRunForGenerationV1,
  loadSignalSemanticContextProposalPreflightRuntimeV1,
  loadSignalSemanticContextProposalRunV1,
  prepareSignalSemanticContextProposalInputV1,
  processSignalSemanticContextProposalRunV1,
  revalidateSignalSemanticContextPaidResponseV1,
  retrySignalSemanticContextProposalRunV1,
  startSignalSemanticContextProposalRunV1,
  type SignalSemanticContextProposalRuntimeConfigurationV1
} from "./signal-semantic-context-proposal";

const DB_URL = process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INTEGRATION_APPROVED === "true";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const runtime = { queue_configured: true, worker_alive: true, recovery_alive: true };
const configuration: SignalSemanticContextProposalRuntimeConfigurationV1 = {
  available: true, provider: "anthropic", model: "fixture-model", model_version: "immutable-fixture-v1",
  pricing_version: "fixture-pricing-v1", max_input_tokens: 20_000, max_output_tokens: 64_000,
  model_max_output_tokens: 64_000,
  input_usd_per_million_tokens: "3", output_usd_per_million_tokens: "15",
  platform_hard_cap_micro_usd: 1_000_000n
};

test("0092 runs one bounded call, appends pending proposals atomically, and recovers fail-closed", {
  skip: !DB_URL || !APPROVED, timeout: 240_000
}, async () => {
  assert.ok(DB_URL); requireLocal(DB_URL);
  const admin = new pg.Client({ connectionString: DB_URL, ssl: false }); await admin.connect();
  try {
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const directory = resolve(process.cwd(), "migrations");
    for (const file of (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
      await admin.query(await readFile(join(directory, file), "utf8"));
    }
  } finally { await admin.end(); }
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: false, max: 12 });
  try {
    const missingLineage = await seedFixture(pool, "missing-lineage", { providerLineage: false });
    const missingLineagePreflight = await loadSignalSemanticContextProposalPreflightRuntimeV1({
      queryable: pool, workspace: missingLineage.workspace, actor: missingLineage.actor,
      generation_key: missingLineage.generation_key, configuration, runtime
    });
    assert.ok(missingLineagePreflight.blockers.includes("provider_lineage_required"));
    assert.ok(!missingLineagePreflight.blockers.includes("provider_lineage_drift"));
    const fixture = await seedFixture(pool, "happy");
    const before = await protectedCounts(pool, fixture.workspace.id);
    const preflight = await loadSignalSemanticContextProposalPreflightRuntimeV1({ queryable: pool,
      workspace: fixture.workspace, actor: fixture.actor, generation_key: fixture.generation_key,
      configuration, runtime });
    assert.equal(preflight.readiness, "ready"); assert.deepEqual(preflight.blockers, []);
    assert.equal(preflight.provider_calls, 0); assert.equal(preflight.writes_performed, false);
    const starts = await Promise.all([1, 2].map(() => startSignalSemanticContextProposalRunV1({ pool,
      workspace: fixture.workspace, actor: fixture.actor, idempotency_key: "happy-start-idempotency",
      generation_key: fixture.generation_key, preflight_digest: preflight.preflight_digest,
      confirmation: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION, hard_cap_micro_usd: 1_000_000n,
      configuration, runtime })));
    assert.deepEqual(starts[0], starts[1], "concurrent same-key replay returns one run");
    const started = starts[0]!;
    const prepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: fixture.workspace, generation_key: fixture.generation_key });
    const sourceAlias = prepared.input.knowledge_blocks[0]!.source_alias;
    let calls = 0;
    const result = await processSignalSemanticContextProposalRunV1({ pool, run_id: await runId(pool, started.run_key),
      provider: { async generate() { calls += 1; return { text: validResponse(sourceAlias,
        prepared.input.identity.primary.entity_ref), provider_request_id: "fixture-request",
        usage: { input_tokens: 1_000, output_tokens: 500 } }; } } });
    assert.equal(result.status, "completed"); assert.equal(calls, 1);
    const state = await loadSignalSemanticContextProposalRunV1({ queryable: pool,
      workspace: fixture.workspace, actor: fixture.actor, run_key: started.run_key });
    assert.equal(state.status, "completed"); assert.equal(state.provider_call_count, 1);
    assert.equal(state.proposal_count, 1); assert.equal(state.budget.settled_micro_usd, "10500");
    assert.equal((await row(pool, `SELECT status FROM signal_semantic_context_proposal_outbox
      WHERE run_id=$1::uuid`, [await runId(pool, started.run_key)])).status, "completed");
    assert.deepEqual(await elementCounts(pool, fixture.workspace.id), { pending: 1, approved: 0, rejected: 0 });
    assert.deepEqual(await protectedCounts(pool, fixture.workspace.id), before);
    assert.equal((await processSignalSemanticContextProposalRunV1({ pool,
      run_id: await runId(pool, started.run_key), provider: { async generate() {
        calls += 1; throw new Error("must not run"); } } })).status, "already_claimed_or_terminal");
    assert.equal(calls, 1);
    const runEvents = await scalar(pool, `SELECT count(*)::int count FROM signal_semantic_context_proposal_run_events
      WHERE run_id=$1::uuid`, [await runId(pool, started.run_key)]);
    assert.ok(runEvents >= 6);

    const capacityFixture = await seedFixture(pool, "capacity");
    const capacityPreflight = await preflightFor(pool, capacityFixture);
    assert.ok(capacityPreflight.capacity);
    assert.ok(capacityPreflight.capacity.target_proposals >= 40);
    assert.ok(capacityPreflight.capacity.maximum_proposals >= 50);
    assert.equal(capacityPreflight.max_output_tokens,
      capacityPreflight.capacity.output_token_budget);
    const capacityRun = await startFor(pool, capacityFixture, "capacity-start");
    const capacityPrepared = await prepareSignalSemanticContextProposalInputV1({
      queryable: pool, workspace: capacityFixture.workspace,
      generation_key: capacityFixture.generation_key
    });
    await processSignalSemanticContextProposalRunV1({ pool, run_id: capacityRun.id,
      provider: { async generate() { return {
        text: validResponseCount(capacityPrepared.input.knowledge_blocks[0]!.source_alias,
          capacityPrepared.input.identity.primary.entity_ref, 50),
        provider_request_id: "fixture-capacity-request",
        usage: { input_tokens: 1_000, output_tokens: 8_000 }
      }; } } });
    assert.deepEqual(await elementCounts(pool, capacityFixture.workspace.id),
      { pending: 50, approved: 0, rejected: 0 });

    const invalid = await seedFixture(pool, "invalid");
    const invalidRun = await startFor(pool, invalid, "invalid-start");
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: invalidRun.id,
      provider: { async generate() { return { text: JSON.stringify({ contract_version:
        SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2, proposals: [{ bad: true }] }),
        provider_request_id: null, usage: { input_tokens: 10, output_tokens: 10 } }; } } }));
    assert.deepEqual(await elementCounts(pool, invalid.workspace.id), { pending: 0, approved: 0, rejected: 0 });
    assert.deepEqual(await row(pool, `SELECT status,actual_micro_usd::text FROM
      signal_semantic_context_budget_reservations WHERE run_id=$1::uuid`, [invalidRun.id]),
    { status: "settled", actual_micro_usd: "180" });
    assert.equal((await row(pool, `SELECT status FROM signal_semantic_context_proposal_outbox
      WHERE run_id=$1::uuid`, [invalidRun.id])).status, "dead_letter");
    const invalidState = await loadSignalSemanticContextProposalRunV1({ queryable: pool,
      workspace: invalid.workspace, actor: invalid.actor, run_key: invalidRun.run_key });
    assert.equal(invalidState.error?.code, "semantic_context_provider_required_field_invalid");
    assert.doesNotMatch(invalidState.error?.message ?? "", /logical_path|provider_response_private|bad/u);
    const invalidPrivate = JSON.parse(String((await row(pool, `SELECT error_summary FROM
      signal_semantic_context_proposal_runs WHERE id=$1::uuid`, [invalidRun.id])).error_summary));
    assert.equal(invalidPrivate.code, "semantic_context_provider_required_field_invalid");
    assert.ok(invalidPrivate.issue_count > 0);
    assert.equal(await scalar(pool, `SELECT count(*)::int count FROM signal_semantic_context_proposal_run_events
      WHERE run_id=$1::uuid AND event_kind='failed'`, [invalidRun.id]), 1);

    const paid = await seedFixture(pool, "paid-response");
    const paidRun = await startFor(pool, paid, "paid-response-start");
    const paidPrepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: paid.workspace, generation_key: paid.generation_key });
    let paidCalls = 0;
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: paidRun.id,
      provider: { async generate() { paidCalls += 1; return {
        text: legacyV1Response(paidPrepared.input.knowledge_blocks[0]!.source_alias,
          paidPrepared.input.identity.primary.entity_ref), provider_request_id: "paid-fixture",
        usage: { input_tokens: 100, output_tokens: 200 }
      }; } } }), /semantic_context_provider_/u);
    const paidFingerprint = await scalarText(pool, `SELECT encode(digest(row_to_json(run)::text,'sha256'),'hex') value
      FROM signal_semantic_context_proposal_runs run WHERE id=$1::uuid`, [paidRun.id]);
    const paidBudget = await row(pool, `SELECT status,actual_micro_usd::text,reservation_micro_usd::text
      FROM signal_semantic_context_budget_reservations WHERE run_id=$1::uuid`, [paidRun.id]);
    const countsBeforeRevalidation = await row(pool, `SELECT
      (SELECT count(*)::int FROM signal_semantic_context_budget_reservations) reservations,
      (SELECT count(*)::int FROM signal_semantic_context_proposal_outbox) outboxes,
      (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_semantic_context_proposal_runs) calls`, []);
    const recoveries = await Promise.all(["paid-revalidate-a", "paid-revalidate-b"].map((key) =>
      revalidateInTransaction(pool, paid, paidRun.run_key, key)));
    const recovered = recoveries[0]!;
    assert.equal(recovered.status, "completed");
    assert.deepEqual(recovered, recoveries[1]);
    assert.equal(recovered.proposals_appended, 1);
    assert.equal(recovered.proposals_approved, 0);
    assert.equal(recovered.provider_calls_added, 0);
    assert.equal((await revalidateInTransaction(pool, paid, paidRun.run_key,
      "paid-revalidate-a")).revalidation_ref, recovered.revalidation_ref);
    assert.equal(await scalar(pool, `SELECT count(*)::int count FROM
      signal_semantic_context_proposal_revalidations WHERE original_run_id=$1::uuid`, [paidRun.id]), 1);
    assert.equal(await scalarText(pool, `SELECT encode(digest(row_to_json(run)::text,'sha256'),'hex') value
      FROM signal_semantic_context_proposal_runs run WHERE id=$1::uuid`, [paidRun.id]), paidFingerprint);
    assert.deepEqual(await row(pool, `SELECT status,actual_micro_usd::text,reservation_micro_usd::text
      FROM signal_semantic_context_budget_reservations WHERE run_id=$1::uuid`, [paidRun.id]), paidBudget);
    assert.deepEqual(await row(pool, `SELECT
      (SELECT count(*)::int FROM signal_semantic_context_budget_reservations) reservations,
      (SELECT count(*)::int FROM signal_semantic_context_proposal_outbox) outboxes,
      (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_semantic_context_proposal_runs) calls`, []),
    countsBeforeRevalidation);
    assert.equal(paidCalls, 1);
    assert.deepEqual(await row(pool, `SELECT disposition,origin_kind,entity_type,
      (confidence=1)::boolean confidence_one FROM signal_semantic_context_element_versions
      WHERE workspace_id=$1::uuid`, [paid.workspace.id]),
    { disposition: "pending", origin_kind: "provider_proposal", entity_type: "brand", confidence_one: true });
    await assert.rejects(pool.query(`UPDATE signal_semantic_context_proposal_runs SET error_code='rewrite'
      WHERE id=$1::uuid`, [paidRun.id]), /immutable/u);

    const conflict = await seedFixture(pool, "paid-conflict");
    const conflictRun = await startFor(pool, conflict, "paid-conflict-start");
    const conflictPrepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: conflict.workspace, generation_key: conflict.generation_key });
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: conflictRun.id,
      provider: { async generate() { return {
        text: legacyV1ConflictResponse(conflictPrepared.input.knowledge_blocks[0]!.source_alias),
        provider_request_id: "conflict-fixture", usage: { input_tokens: 100, output_tokens: 200 }
      }; } } }));
    const rejected = await revalidateInTransaction(pool, conflict, conflictRun.run_key,
      "paid-conflict-revalidate");
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.error?.code, "semantic_context_provider_duplicate_semantic_key_conflict");
    assert.equal(rejected.proposals_appended, 0);
    assert.deepEqual(await elementCounts(pool, conflict.workspace.id),
      { pending: 0, approved: 0, rejected: 0 });
    const discoveryProtectedBefore = await proposalExecutionCounts(pool, conflict.workspace.id);
    const discoveryServingBefore = await protectedCounts(pool, conflict.workspace.id);
    const [freshTerminalDiscovery, reloadedTerminalDiscovery] = await Promise.all([1, 2].map(() =>
      loadLatestSignalSemanticContextProposalRunForGenerationV1({ queryable: pool,
        workspace: conflict.workspace, actor: conflict.actor,
        generation_key: conflict.generation_key })));
    assert.deepEqual(freshTerminalDiscovery, reloadedTerminalDiscovery,
      "fresh and reloaded clients receive the same deterministic terminal run");
    assert.equal(freshTerminalDiscovery?.run_key, conflictRun.run_key);
    assert.equal(freshTerminalDiscovery?.status, "failed");
    assert.equal(freshTerminalDiscovery?.paid_response_revalidation?.status, "rejected");
    assert.equal(freshTerminalDiscovery?.paid_response_revalidation?.proposals_appended, 0);
    assert.equal(freshTerminalDiscovery?.paid_response_revalidation?.provider_calls_added, 0);
    const publicTerminal = JSON.stringify(freshTerminalDiscovery);
    for (const privateField of ["provider_response_private", "provider_response_digest",
      "provider_request_id", "provider_request_identity", "error_summary", "preflight_digest",
      "context_input_digest", "prompt_digest", "duplicate_decisions"]) {
      assert.doesNotMatch(publicTerminal, new RegExp(privateField, "u"));
    }
    assert.deepEqual(await proposalExecutionCounts(pool, conflict.workspace.id), discoveryProtectedBefore,
      "server-owned terminal discovery is read-only");
    assert.deepEqual(await protectedCounts(pool, conflict.workspace.id), discoveryServingBefore,
      "terminal discovery has no assignment, tag, pointer or binding side effect");

    const driftPaid = await seedFixture(pool, "paid-drift");
    const driftPaidRun = await startFor(pool, driftPaid, "paid-drift-start");
    const driftPaidPrepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: driftPaid.workspace, generation_key: driftPaid.generation_key });
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: driftPaidRun.id,
      provider: { async generate() { return { text: legacyV1Response(
        driftPaidPrepared.input.knowledge_blocks[0]!.source_alias,
        driftPaidPrepared.input.identity.primary.entity_ref), provider_request_id: null,
        usage: { input_tokens: 100, output_tokens: 200 } }; } } }));
    await pool.query(`UPDATE brand_os_profiles SET metadata=jsonb_set(metadata,'{snapshot_hash}',to_jsonb($2::text))
      WHERE id=$1::uuid`, [driftPaid.profile_id, digest("paid-drift-changed")]);
    await assert.rejects(revalidateInTransaction(pool, driftPaid, driftPaidRun.run_key,
      "paid-drift-revalidate"), /brand_os_drift|authority_drift/u);
    assert.equal(await scalar(pool, `SELECT count(*)::int count FROM
      signal_semantic_context_proposal_revalidations WHERE original_run_id=$1::uuid`, [driftPaidRun.id]), 0);

    const otherWorkspace = await seedFixture(pool, "paid-other-workspace");
    await assert.rejects(revalidateInTransaction(pool, otherWorkspace, paidRun.run_key,
      "paid-cross-workspace"), /not_found/u);
    assert.equal(await loadLatestSignalSemanticContextProposalRunForGenerationV1({ queryable: pool,
      workspace: otherWorkspace.workspace, actor: otherWorkspace.actor,
      generation_key: conflict.generation_key }), null,
    "a current generation key from another workspace is never discovered");

    const activeDiscovery = await seedFixture(pool, "active-discovery");
    const activeDiscoveryRun = await startFor(pool, activeDiscovery, "active-discovery-start");
    const activeState = await loadLatestSignalSemanticContextProposalRunForGenerationV1({ queryable: pool,
      workspace: activeDiscovery.workspace, actor: activeDiscovery.actor,
      generation_key: activeDiscovery.generation_key });
    assert.equal(activeState?.run_key, activeDiscoveryRun.run_key);
    assert.equal(activeState?.status, "queued", "the current nonterminal run wins discovery");
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: activeDiscoveryRun.id,
      provider: { async generate() {
        throw new SignalSemanticContextProviderCallError("not sent", true);
      } } }));

    const supersededDiscovery = await seedFixture(pool, "superseded-discovery");
    const supersededRun = await startFor(pool, supersededDiscovery, "superseded-discovery-start");
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: supersededRun.id,
      provider: { async generate() {
        throw new SignalSemanticContextProviderCallError("not sent", true);
      } } }));
    const successorKey = await supersedeGeneration(pool, supersededDiscovery);
    assert.equal(await loadLatestSignalSemanticContextProposalRunForGenerationV1({ queryable: pool,
      workspace: supersededDiscovery.workspace, actor: supersededDiscovery.actor,
      generation_key: supersededDiscovery.generation_key }), null,
    "a superseded generation run cannot masquerade as current");
    assert.equal(await loadLatestSignalSemanticContextProposalRunForGenerationV1({ queryable: pool,
      workspace: supersededDiscovery.workspace, actor: supersededDiscovery.actor,
      generation_key: successorKey }), null,
    "a current successor without a run does not inherit historical state");

    const truncated = await seedFixture(pool, "truncated");
    const truncatedRun = await startFor(pool, truncated, "truncated-start");
    const truncatedPrepared = await prepareSignalSemanticContextProposalInputV1({
      queryable: pool, workspace: truncated.workspace,
      generation_key: truncated.generation_key
    });
    let truncatedCalls = 0;
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: truncatedRun.id,
      provider: { async generate() { truncatedCalls += 1; return {
        text: "```json\n{\"contract_version\":\"signal-semantic-context-proposal-output-v1\",",
        provider_request_id: null,
        usage: { input_tokens: 10, output_tokens: truncatedPrepared.capacity.output_token_budget }
      }; } } }), /semantic_context_provider_response_truncated/u);
    const truncatedState = await loadSignalSemanticContextProposalRunV1({ queryable: pool,
      workspace: truncated.workspace, actor: truncated.actor, run_key: truncatedRun.run_key });
    assert.equal(truncatedState.error?.code, "semantic_context_provider_response_truncated");
    assert.equal(truncatedState.provider_call_count, 1);
    assert.equal((await elementCounts(pool, truncated.workspace.id)).pending, 0);
    await assert.rejects(retrySignalSemanticContextProposalRunV1({ pool,
      workspace: truncated.workspace, actor: truncated.actor,
      idempotency_key: "truncated-retry-blocked", run_key: truncatedRun.run_key
    }), /not_retryable/u);
    assert.equal(truncatedCalls, 1);

    const alias = await seedFixture(pool, "alias"); const aliasRun = await startFor(pool, alias, "alias-start");
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: aliasRun.id,
      provider: { async generate() { return { text: validResponse("src.9999", "entity.primary"),
        provider_request_id: null, usage: { input_tokens: 10, output_tokens: 10 } }; } } }),
    /evidence_alias_unknown/u);
    assert.equal((await elementCounts(pool, alias.workspace.id)).pending, 0);

    const retry = await seedFixture(pool, "retry"); const retryRun = await startFor(pool, retry, "retry-start");
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: retryRun.id,
      provider: { async generate() { throw new SignalSemanticContextProviderCallError("not sent", true); } } }));
    const retryState = await row(pool, `SELECT status,provider_call_state,provider_call_count
      FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid`, [retryRun.id]);
    assert.deepEqual(retryState, { status: "failed", provider_call_state: "not_started", provider_call_count: 0 });
    await retrySignalSemanticContextProposalRunV1({ pool, workspace: retry.workspace, actor: retry.actor,
      idempotency_key: "retry-operation-idempotency", run_key: retryRun.run_key });
    const retryPrepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: retry.workspace, generation_key: retry.generation_key });
    await processSignalSemanticContextProposalRunV1({ pool, run_id: retryRun.id,
      provider: { async generate() { return { text: validResponse(
        retryPrepared.input.knowledge_blocks[0]!.source_alias, retryPrepared.input.identity.primary.entity_ref),
        provider_request_id: null, usage: { input_tokens: 10, output_tokens: 10 } }; } } });
    assert.equal((await elementCounts(pool, retry.workspace.id)).pending, 1);

    const crash = await seedFixture(pool, "crash"); const crashRun = await startFor(pool, crash, "crash-start");
    let crashCalls = 0;
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: crashRun.id,
      crash_after_provider_response_for_test: true, provider: { async generate() { crashCalls += 1;
        return { text: validResponse("src.0001", "entity.primary"), provider_request_id: null,
          usage: { input_tokens: 10, output_tokens: 10 } }; } } }));
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET lease_expires_at=now()-interval '1 second'
      WHERE id=$1::uuid`, [crashRun.id]);
    assert.equal((await processSignalSemanticContextProposalRunV1({ pool, run_id: crashRun.id,
      provider: { async generate() { crashCalls += 1; throw new Error("duplicate"); } } })).status,
    "already_claimed_or_terminal");
    assert.equal(crashCalls, 1); assert.equal((await row(pool,
      `SELECT status FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid`, [crashRun.id])).status,
    "dead_letter");
    const crashBudget = await row(pool, `SELECT status,actual_micro_usd::text,
      reservation_micro_usd::text FROM
      signal_semantic_context_budget_reservations WHERE run_id=$1::uuid`, [crashRun.id]);
    assert.equal(crashBudget.status, "settled");
    assert.equal(crashBudget.actual_micro_usd, crashBudget.reservation_micro_usd);
    assert.equal((await row(pool, `SELECT status FROM signal_semantic_context_proposal_outbox
      WHERE run_id=$1::uuid`, [crashRun.id])).status, "dead_letter");

    const driftBefore = await seedFixture(pool, "drift-before");
    const beforeRun = await startFor(pool, driftBefore, "drift-before-start");
    await pool.query(`UPDATE brand_os_profiles SET metadata=jsonb_set(metadata,'{snapshot_hash}',to_jsonb($2::text))
      WHERE id=$1::uuid`, [driftBefore.profile_id, digest("changed")]);
    let beforeCalls = 0;
    assert.equal((await processSignalSemanticContextProposalRunV1({ pool, run_id: beforeRun.id,
      provider: { async generate() { beforeCalls += 1; throw new Error("blocked"); } } })).status, "stale");
    assert.equal(beforeCalls, 0);
    assert.equal((await row(pool, `SELECT status FROM signal_semantic_context_proposal_outbox
      WHERE run_id=$1::uuid`, [beforeRun.id])).status, "completed");

    const driftDuring = await seedFixture(pool, "drift-during");
    const duringRun = await startFor(pool, driftDuring, "drift-during-start");
    const duringPrepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: driftDuring.workspace, generation_key: driftDuring.generation_key });
    assert.equal((await processSignalSemanticContextProposalRunV1({ pool, run_id: duringRun.id,
      provider: { async generate() { await pool.query(`UPDATE brand_os_profiles SET metadata=metadata||
          '{"features":["changed during execution"]}'::jsonb WHERE id=$1::uuid`, [driftDuring.profile_id]);
        return { text: validResponse(duringPrepared.input.knowledge_blocks[0]!.source_alias,
          duringPrepared.input.identity.primary.entity_ref), provider_request_id: null,
          usage: { input_tokens: 10, output_tokens: 10 } }; } } })).status, "stale");
    assert.equal((await elementCounts(pool, driftDuring.workspace.id)).pending, 0);
    assert.deepEqual(await row(pool, `SELECT status,actual_micro_usd::text FROM
      signal_semantic_context_budget_reservations WHERE run_id=$1::uuid`, [duringRun.id]),
    { status: "settled", actual_micro_usd: "180" });

    await assert.rejects(loadSignalSemanticContextProposalRunV1({ queryable: pool,
      workspace: invalid.workspace, actor: invalid.actor, run_key: started.run_key }), /not_found/u);
    const future = await seedFixture(pool, "cap");
    const configuredCapacity = await loadSignalSemanticContextProposalPreflightRuntimeV1({
      queryable: pool, workspace: future.workspace, actor: future.actor,
      generation_key: future.generation_key,
      configuration: { ...configuration, max_output_tokens: 5_000 }, runtime
    });
    assert.ok(configuredCapacity.blockers.includes(
      "semantic_context_configured_output_capacity_insufficient"
    ));
    const unsupportedModelCapacity = await loadSignalSemanticContextProposalPreflightRuntimeV1({
      queryable: pool, workspace: future.workspace, actor: future.actor,
      generation_key: future.generation_key,
      configuration: { ...configuration, model_max_output_tokens: 5_000 }, runtime
    });
    assert.ok(unsupportedModelCapacity.blockers.includes(
      "semantic_context_model_output_capacity_unsupported"
    ));
    const capPreflight = await preflightFor(pool, future);
    const operationsBefore = await scalar(pool, `SELECT count(*)::int count FROM signal_governance_control_operations
      WHERE workspace_id=$1::uuid`, [future.workspace.id]);
    await assert.rejects(startSignalSemanticContextProposalRunV1({ pool, workspace: future.workspace,
      actor: future.actor, idempotency_key: "cap-start-idempotency", generation_key: future.generation_key,
      preflight_digest: capPreflight.preflight_digest, confirmation: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION,
      hard_cap_micro_usd: 1n, configuration, runtime }), /hard_cap_insufficient/u);
    assert.equal(await scalar(pool, `SELECT count(*)::int count FROM signal_governance_control_operations
      WHERE workspace_id=$1::uuid`, [future.workspace.id]), operationsBefore);
    assert.equal(await scalar(pool, `SELECT count(*)::int count FROM signal_semantic_context_proposal_outbox
      WHERE workspace_id=$1::uuid`, [future.workspace.id]), 0);
  } finally { await pool.end(); }
});

async function seedFixture(pool: pg.Pool, label: string,
  options: { providerLineage?: boolean } = {}) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`; const org = randomUUID();
  const brand = randomUUID(); const user = randomUUID(); const profile = randomUUID();
  await pool.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status)
    VALUES($1::uuid,$2,$2,$2,'active')`, [org, suffix]);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
    VALUES($1::uuid,$2,$3,'noisia_internal','noisia_admin','active')`, [user, `${suffix}@example.test`, suffix]);
  await pool.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,industry,industry_sub,countries,status)
    VALUES($1::uuid,$2::uuid,$3,$3,$3,'Technology','Assistants',ARRAY['MX']::char(2)[],'active')`,
  [brand, org, suffix]);
  const workspace = (await pool.query<{ id: string }>(`SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid`, [brand])).rows[0]!;
  await pool.query(`UPDATE signal_workspaces SET timezone='America/Mexico_City' WHERE id=$1::uuid`, [workspace.id]);
  const brandDigest = digest(`${suffix}-brand`);
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,'Profile','active',1,jsonb_build_object(
      'snapshot_hash',$4::text,'aliases',jsonb_build_array('Fixture alias'),'features',jsonb_build_array('Voice')))`,
  [profile, org, brand, brandDigest]);
  await pool.query(`INSERT INTO brand_os_products(brand_os_profile_id,name,product_type,description,status)
    VALUES($1::uuid,'Fixture product','device','Fixture governed product','active')`, [profile]);
  await pool.query(`INSERT INTO brand_os_competitors(brand_os_profile_id,competitor_name,role,priority)
    VALUES($1::uuid,'Fixture competitor','direct',1)`, [profile]);
  const source = randomUUID();
  await pool.query(`INSERT INTO brand_knowledge_sources(id,organization_id,brand_id,source_kind,title,
    raw_text,extracted_payload,status) VALUES($1::uuid,$2::uuid,$3::uuid,'operator-note','Strategy',
      'Governed private strategy', '{}'::jsonb,'active')`, [source, org, brand]);
  await pool.query(`INSERT INTO knowledge_chunks(knowledge_source_id,chunk_index,chunk_text)
    VALUES($1::uuid,0,'Governed benefit and limitation')`, [source]);
  await pool.query(`INSERT INTO knowledge_assertions(knowledge_source_id,assertion_text,assertion_type,status)
    VALUES($1::uuid,'A governed assertion','positioning','approved')`, [source]);
  const knowledgeDigest = await currentKnowledgeDigest(pool, org, brand);
  const localeDigest = signalSemanticContextProposalDigestV1({ primary_locale: "es-MX",
    locale_variants: ["es-MX", "en-US"], markets: ["MX", "US"], timezone: "America/Mexico_City" });
  const operation = randomUUID();
  await pool.query(`INSERT INTO signal_governance_control_operations(id,workspace_id,actor_user_id,
    action,request_digest,idempotency_key,status) VALUES($1::uuid,$2::uuid,$3::uuid,
      'create-semantic-context-draft',$4,$5,'in_progress')`, [operation, workspace.id, user,
    digest(`${suffix}-request`), digest(`${suffix}-key`)]);
  const authorityDigest = signalSemanticContextProposalDigestV1({ brand_os_digest: brandDigest,
    knowledge_digest: knowledgeDigest, locale_context_digest: localeDigest });
  const artifact = (await pool.query<{ id: string }>(`INSERT INTO analysis_artifacts(
    workspace_id,workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,
    content,review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,
      'semantic_context_pack_generation','{}'::jsonb,'needs_review',1,'{}'::jsonb) RETURNING id::text`,
  [workspace.id, authorityDigest, `context-${suffix}`])).rows[0]!;
  const generationKey = `context-${suffix}`;
  await pool.query(`INSERT INTO signal_semantic_context_generations(workspace_id,artifact_id,generation_key,
    generation_version,status,brand_os_profile_id,brand_os_profile_version,brand_os_digest,
    knowledge_generation_key,knowledge_digest,locale_context_digest,primary_locale,locale_variants,
    markets,timezone,proposal_model,proposal_model_version,proposal_prompt_digest,proposal_pricing_version,
    draft_digest,created_operation_id,created_by_user_id) VALUES($1::uuid,$2::uuid,$3,1,'draft',
      $4::uuid,1,$5,$6,$7,$8,'es-MX',ARRAY['es-MX','en-US']::text[],ARRAY['MX','US']::text[],
      'America/Mexico_City',$9,$10,$11,$12,$13,$14::uuid,$15::uuid)`, [workspace.id, artifact.id,
    generationKey, profile, brandDigest, `knowledge-${knowledgeDigest.slice(7, 23)}`, knowledgeDigest,
    localeDigest, options.providerLineage === false ? null : configuration.model,
    options.providerLineage === false ? null : configuration.model_version,
    options.providerLineage === false ? null : SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2,
    options.providerLineage === false ? null : configuration.pricing_version,
    digest(`${suffix}-draft`), operation, user]);
  return { workspace: { id: workspace.id, organization_id: org, brand_id: brand },
    actor: { id: user, user_type: "noisia_internal" as const }, generation_key: generationKey,
    profile_id: profile };
}

async function currentKnowledgeDigest(pool: pg.Pool, org: string, brand: string) {
  const sources = await pool.query<{ id: string; kind: string; digest: string }>(`SELECT id::text,
    source_kind kind,'sha256:'||encode(digest(COALESCE(raw_text,'')||extracted_payload::text,'sha256'),'hex') digest
    FROM brand_knowledge_sources WHERE organization_id=$1::uuid AND brand_id=$2::uuid ORDER BY id`, [org, brand]);
  const chunks = await pool.query<{ id: string; source_id: string; content_digest: string }>(`SELECT chunk.id::text,
    chunk.knowledge_source_id::text source_id,'sha256:'||encode(digest(chunk.chunk_text,'sha256'),'hex') content_digest
    FROM knowledge_chunks chunk JOIN brand_knowledge_sources source ON source.id=chunk.knowledge_source_id
    WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid ORDER BY chunk.id`, [org, brand]);
  return signalSemanticContextProposalDigestV1({ sources: sources.rows, chunks: chunks.rows });
}

async function preflightFor(pool: pg.Pool, fixture: Awaited<ReturnType<typeof seedFixture>>) {
  return loadSignalSemanticContextProposalPreflightRuntimeV1({ queryable: pool, workspace: fixture.workspace,
    actor: fixture.actor, generation_key: fixture.generation_key, configuration, runtime });
}
async function startFor(pool: pg.Pool, fixture: Awaited<ReturnType<typeof seedFixture>>, key: string) {
  const preflight = await preflightFor(pool, fixture); assert.equal(preflight.readiness, "ready");
  const run = await startSignalSemanticContextProposalRunV1({ pool, workspace: fixture.workspace,
    actor: fixture.actor, idempotency_key: `${key}-idempotency`, generation_key: fixture.generation_key,
    preflight_digest: preflight.preflight_digest, confirmation: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION,
    hard_cap_micro_usd: 1_000_000n, configuration, runtime });
  return { ...run, id: await runId(pool, run.run_key) };
}
function validResponse(sourceAlias: string, entityRef: string) { return JSON.stringify({
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
  proposals: [{ element_key: "identity.fixture", element_kind: "identity_term",
    canonical_key: "fixture", display_text: "Fixture identity", scope: "primary_brand",
    entity_ref: entityRef, locale: "es-MX", relation_kind: null,
    relation_target_key: null, confidence: 1,
    evidence: [{ source_alias: sourceAlias, relation_type: "supports" }] }]
}); }
function validResponseCount(sourceAlias: string, entityRef: string, count: number) {
  return JSON.stringify({
    contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
    proposals: Array.from({ length: count }, (_, index) => ({
      element_key: `feature.fixture-${index + 1}`,
      element_kind: "feature",
      canonical_key: `fixture-${index + 1}`,
      display_text: `Fixture feature ${index + 1}`,
      scope: "primary_brand",
      entity_ref: entityRef,
      locale: "es-MX",
      relation_kind: null,
      relation_target_key: null,
      confidence: 1,
      evidence: [{ source_alias: sourceAlias, relation_type: "supports" }]
    }))
  });
}
function legacyV1Response(sourceAlias: string, entityRef: string) { return JSON.stringify({
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  proposals: [{ element_key: "product.fixture", element_kind: "product",
    canonical_key: "fixture-product", display_text: "Fixture product", scope: "primary_brand",
    entity_type: "product", entity_ref: entityRef, locale: "es-MX", relation_kind: null,
    relation_target_key: null, confidence: 1,
    evidence: [{ source_alias: sourceAlias, relation_type: "supports" }] }]
}); }
function legacyV1ConflictResponse(sourceAlias: string) { return JSON.stringify({
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  proposals: ["One", "Two", "Three"].map((display, index) => ({
    element_key: `category.fixture-${index + 1}`, element_kind: "category",
    canonical_key: "fixture-category", display_text: display, scope: "category",
    entity_type: "category", entity_ref: null, locale: "es-MX", relation_kind: null,
    relation_target_key: null, confidence: 0.5,
    evidence: [{ source_alias: sourceAlias, relation_type: "supports" }]
  }))
}); }
async function revalidateInTransaction(pool: pg.Pool,
  fixture: Awaited<ReturnType<typeof seedFixture>>, runKey: string, key: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await revalidateSignalSemanticContextPaidResponseV1({ queryable: client,
      workspace: fixture.workspace, actor: fixture.actor, idempotency_key: key,
      run_key: runKey, confirmation: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_REVALIDATION_CONFIRMATION });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
async function runId(pool: pg.Pool, runKey: string) { return (await pool.query<{ id: string }>(
  `SELECT id::text FROM signal_semantic_context_proposal_runs WHERE run_key=$1`, [runKey])).rows[0]!.id; }
async function elementCounts(pool: pg.Pool, workspaceId: string) { return row(pool, `SELECT
  count(*) FILTER(WHERE disposition='pending')::int pending,
  count(*) FILTER(WHERE disposition='approved')::int approved,
  count(*) FILTER(WHERE disposition='rejected')::int rejected
  FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid`, [workspaceId]); }
async function protectedCounts(pool: pg.Pool, workspaceId: string) { return {
  assignments: await scalar(pool, `SELECT count(*)::int count FROM signal_classification_assignments WHERE workspace_id=$1::uuid`, [workspaceId]),
  tags: await scalar(pool, `SELECT count(*)::int count FROM record_tags`, []),
  pointers: await scalar(pool, `SELECT count(*)::int count FROM signal_workspace_population_pointers WHERE workspace_id=$1::uuid`, [workspaceId]),
  bindings: await scalar(pool, `SELECT count(*)::int count FROM signal_governed_view_bindings WHERE workspace_id=$1::uuid`, [workspaceId])
}; }
async function proposalExecutionCounts(pool: pg.Pool, workspaceId: string) { return row(pool, `SELECT
  (SELECT count(*)::int FROM signal_semantic_context_proposal_runs WHERE workspace_id=$1::uuid) runs,
  (SELECT count(*)::int FROM signal_semantic_context_proposal_revalidations WHERE workspace_id=$1::uuid) revalidations,
  (SELECT count(*)::int FROM signal_semantic_context_budget_reservations WHERE workspace_id=$1::uuid) reservations,
  (SELECT count(*)::int FROM signal_semantic_context_proposal_outbox WHERE workspace_id=$1::uuid) outboxes,
  (SELECT count(*)::int FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid) elements,
  (SELECT COALESCE(sum(reservation_micro_usd),0)::text FROM signal_semantic_context_budget_reservations
    WHERE workspace_id=$1::uuid) reserved_micro_usd,
  (SELECT COALESCE(sum(actual_micro_usd),0)::text FROM signal_semantic_context_budget_reservations
    WHERE workspace_id=$1::uuid) settled_micro_usd,
  (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_semantic_context_proposal_runs
    WHERE workspace_id=$1::uuid) provider_calls`, [workspaceId]); }
async function supersedeGeneration(pool: pg.Pool,
  fixture: Awaited<ReturnType<typeof seedFixture>>) {
  const operation = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await pool.query(`INSERT INTO signal_governance_control_operations(id,workspace_id,actor_user_id,
    action,request_digest,idempotency_key,status) VALUES($1::uuid,$2::uuid,$3::uuid,
    'reconcile-semantic-context-generation',$4,$5,'in_progress')`, [operation, fixture.workspace.id,
    fixture.actor.id, digest(`supersede-request-${suffix}`), digest(`supersede-key-${suffix}`)]);
  const predecessor = await row(pool, `SELECT generation.id::text,generation.artifact_id::text,
    generation.generation_version,artifact.workspace_authority_digest
    FROM signal_semantic_context_generations generation
    JOIN analysis_artifacts artifact ON artifact.id=generation.artifact_id
    WHERE generation.workspace_id=$1::uuid AND generation.generation_key=$2`,
  [fixture.workspace.id, fixture.generation_key]);
  const artifact = (await pool.query<{ id: string }>(`INSERT INTO analysis_artifacts(
    workspace_id,workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,
    content,review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,
      'semantic_context_pack_generation','{}'::jsonb,'needs_review',$4,'{}'::jsonb)
    RETURNING id::text`, [fixture.workspace.id, predecessor.workspace_authority_digest,
    `context-successor-${suffix}`, Number(predecessor.generation_version) + 1])).rows[0]!;
  const successorKey = `${fixture.generation_key}-successor`;
  await pool.query(`INSERT INTO signal_semantic_context_generations(workspace_id,artifact_id,
    generation_key,generation_version,status,supersedes_generation_id,supersession_reason,
    brand_os_profile_id,brand_os_profile_version,brand_os_digest,knowledge_generation_key,
    knowledge_digest,locale_context_digest,primary_locale,locale_variants,markets,timezone,
    proposal_model,proposal_model_version,proposal_prompt_digest,proposal_pricing_version,
    draft_digest,created_operation_id,created_by_user_id)
    SELECT generation.workspace_id,$1::uuid,$2,generation.generation_version+1,'draft',generation.id,
      'operator_requested_reconciliation',generation.brand_os_profile_id,generation.brand_os_profile_version,
      generation.brand_os_digest,generation.knowledge_generation_key,generation.knowledge_digest,
      generation.locale_context_digest,generation.primary_locale,generation.locale_variants,
      generation.markets,generation.timezone,generation.proposal_model,generation.proposal_model_version,
      generation.proposal_prompt_digest,generation.proposal_pricing_version,$3,$4::uuid,$5::uuid
    FROM signal_semantic_context_generations generation
    WHERE generation.id=$6::uuid`, [artifact.id, successorKey, digest(`successor-${suffix}`),
    operation, fixture.actor.id, predecessor.id]);
  await pool.query(`UPDATE signal_governance_control_operations SET status='completed',result='{}'::jsonb,
    completed_at=clock_timestamp() WHERE id=$1::uuid`, [operation]);
  return successorKey;
}
async function scalar(pool: pg.Pool, sql: string, values: unknown[]) { return (await pool.query<{ count: number }>(sql, values)).rows[0]!.count; }
async function scalarText(pool: pg.Pool, sql: string, values: unknown[]) { return (await pool.query<{ value: string }>(sql, values)).rows[0]!.value; }
async function row(pool: pg.Pool, sql: string, values: unknown[]) { return (await pool.query(sql, values)).rows[0] as Record<string, unknown>; }
function requireLocal(url: string) { if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname))
  throw new Error("Refusing non-local PostgreSQL target."); }
