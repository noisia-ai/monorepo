import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  createManualSignalSemanticAssertionV1,
  generateSignalSemanticCandidatesV1,
  inspectSignalSemanticReviewInvariantsV1,
  listSignalSemanticAssertionHistoryV1,
  loadSignalSemanticReviewQueueV1,
  reviewSignalSemanticAssertionV1,
  SignalSemanticReviewContractError,
  supersedeSignalSemanticAssertionV1
} from "../signal-semantic-review";
import {
  mutateSignalCanonicalMentionGovernanceV1,
  SignalMentionGovernanceContractError
} from "../signal-mention-governance";
import {
  applySignalSemanticResolutionDecisionV1,
  prepareSignalSemanticResolutionRunV1,
  recordSignalSemanticResolutionBatchOutputV1
} from "../signal-semantic-resolution";

const DATABASE_URL = process.env.NOISIA_SIGNAL_SEMANTIC_REVIEW_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_SEMANTIC_REVIEW_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

const IDS = {
  organization: "72000000-0000-4000-8000-000000000001",
  otherOrganization: "72000000-0000-4000-8000-000000000002",
  user: "72000000-0000-4000-8000-000000000101",
  brand: "72000000-0000-4000-8000-000000000201",
  otherBrand: "72000000-0000-4000-8000-000000000202",
  competitorSeed: "72000000-0000-4000-8000-000000000301",
  competitor: "72000000-0000-4000-8000-000000000302",
  category: "72000000-0000-4000-8000-000000000303",
  categoryAlias: "72000000-0000-4000-8000-000000000304",
  sourcePrimary: "72000000-0000-4000-8000-000000000401",
  sourceCompetitor: "72000000-0000-4000-8000-000000000402",
  otherSource: "72000000-0000-4000-8000-000000000403",
  batchPrimary: "72000000-0000-4000-8000-000000000501",
  batchCompetitor: "72000000-0000-4000-8000-000000000502",
  batchAfter: "72000000-0000-4000-8000-000000000503",
  otherBatch: "72000000-0000-4000-8000-000000000504",
  primaryFromCompetitor: "72000000-0000-4000-8000-000000000601",
  competitorMention: "72000000-0000-4000-8000-000000000602",
  categoryMention: "72000000-0000-4000-8000-000000000603",
  multiMention: "72000000-0000-4000-8000-000000000604",
  unresolvedMention: "72000000-0000-4000-8000-000000000605",
  needsContextMention: "72000000-0000-4000-8000-000000000606",
  excludedMention: "72000000-0000-4000-8000-000000000607",
  aliasMention: "72000000-0000-4000-8000-000000000608",
  afterImportMention: "72000000-0000-4000-8000-000000000609",
  concurrentMention: "72000000-0000-4000-8000-000000000610",
  otherMention: "72000000-0000-4000-8000-000000000611"
} as const;

test("Semantic Review backend reconciles candidates, decisions, canonical roots and rollout invariants", {
  skip: !DATABASE_URL || !APPROVED,
  timeout: 180_000
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const setup = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await setup.connect();
  const observed: Record<string, unknown> = {};
  try {
    await setup.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(setup, 63);
    const fixture = await seedFixture(setup);
    await applyMigration(setup, "0064_signal_semantic_scope_hardening.sql");

    const before = await inspectSignalSemanticReviewInvariantsV1(setup, fixture.workspaceId);
    assert.equal(before.v2_definition_count, 1);
    assert.equal(before.v2_pointer_count, 0);
    assert.equal(before.v2_membership_count, 0);
    assert.equal(before.review_event_count, 0);
    assert.equal(before.approved_semantic_count, 0);

    const dryRun = await generateSignalSemanticCandidatesV1(setup, {
      workspace_id: fixture.workspaceId,
      mode: "dry-run"
    });
    assert.equal(dryRun.writes_performed, false);
    assert.ok(dryRun.included_root_count > 100);
    assert.ok(dryRun.candidate_counts_by_scope.primary_brand > 100);
    assert.equal(dryRun.candidate_counts_by_scope.competitor, 2);
    assert.equal(dryRun.candidate_counts_by_scope.category, 1);
    assert.equal(dryRun.unresolved_count, 1);
    assert.equal(dryRun.needs_context_count, 1);
    assert.equal((await inspectSignalSemanticReviewInvariantsV1(setup, fixture.workspaceId)).semantic_assertion_count, 0);

    const applied = await generateSignalSemanticCandidatesV1(setup, {
      workspace_id: fixture.workspaceId,
      mode: "apply"
    });
    assert.equal(applied.created_count, dryRun.candidate_assertion_count);
    assert.equal(applied.conflict_count, 0);
    const afterCandidates = await inspectSignalSemanticReviewInvariantsV1(setup, fixture.workspaceId);
    assertProtectedCandidateState(before, afterCandidates);
    assert.equal(afterCandidates.semantic_assertion_count, applied.created_count);

    const retried = await generateSignalSemanticCandidatesV1(setup, {
      workspace_id: fixture.workspaceId,
      mode: "apply"
    });
    assert.equal(retried.created_count, 0);
    assert.equal(retried.existing_count, applied.candidate_assertion_count);
    assert.equal(retried.candidate_digest, applied.candidate_digest);

    let firstPageQueryCount = 0;
    const firstPage = await loadSignalSemanticReviewQueueV1({
      query: async (text, values) => {
        firstPageQueryCount += 1;
        return setup.query(text, values);
      }
    }, {
      workspace_id: fixture.workspaceId,
      limit: 100
    });
    assert.equal(firstPageQueryCount, 2, "queue identity context and included roots stay bounded to two reads");
    assert.equal(firstPage.records.length, 100);
    assert.ok(firstPage.page.next_cursor);
    const secondPage = await loadSignalSemanticReviewQueueV1(setup, {
      workspace_id: fixture.workspaceId,
      limit: 100,
      cursor: firstPage.page.next_cursor
    });
    assert.equal(
      firstPage.records.length + secondPage.records.length,
      firstPage.reconciliation.included_root_count
    );
    assert.equal(new Set([
      ...firstPage.records.map((item) => item.mention_id),
      ...secondPage.records.map((item) => item.mention_id)
    ]).size, firstPage.reconciliation.included_root_count);
    observed.pagination = {
      included_roots: firstPage.reconciliation.included_root_count,
      first_page: firstPage.records.length,
      second_page: secondPage.records.length,
      overlap: 0
    };

    const primaryAssertion = await currentAssertion(setup, fixture.workspaceId, IDS.primaryFromCompetitor, "primary_brand");
    await reviewSignalSemanticAssertionV1(setup, {
      workspace_id: fixture.workspaceId,
      attribution_id: primaryAssertion,
      reviewer_user_id: IDS.user,
      decision: "approve",
      rationale: "Explicit governed brand identity is present.",
      idempotency_key: "approve-primary-001"
    });
    const approveRetry = await reviewSignalSemanticAssertionV1(setup, {
      workspace_id: fixture.workspaceId,
      attribution_id: primaryAssertion,
      reviewer_user_id: IDS.user,
      decision: "approve",
      rationale: "Explicit governed brand identity is present.",
      idempotency_key: "approve-primary-001"
    });
    assert.equal(approveRetry.assertion_id, primaryAssertion);
    assert.equal(await activeV2Memberships(setup, fixture.workspaceId, IDS.primaryFromCompetitor), 1);

    await reviewSignalSemanticAssertionV1(setup, {
      workspace_id: fixture.workspaceId,
      attribution_id: primaryAssertion,
      reviewer_user_id: IDS.user,
      decision: "reject",
      rationale: "Subsequent human context invalidated this assertion.",
      idempotency_key: "reject-primary-001"
    });
    assert.equal(await activeV2Memberships(setup, fixture.workspaceId, IDS.primaryFromCompetitor), 0);

    const superseded = await supersedeSignalSemanticAssertionV1(setup, {
      workspace_id: fixture.workspaceId,
      attribution_id: primaryAssertion,
      reviewer_user_id: IDS.user,
      scope: "primary_brand",
      entity_id: IDS.brand,
      confidence: 0.995,
      rationale: "Corrected assertion preserves the governed primary identity.",
      idempotency_key: "supersede-primary-001"
    });
    const history = await listSignalSemanticAssertionHistoryV1(setup, {
      workspace_id: fixture.workspaceId,
      attribution_id: primaryAssertion
    });
    assert.deepEqual(history.events.map((event) => event.action), ["approved", "rejected", "superseded"]);
    assert.equal(await activeV2Memberships(setup, fixture.workspaceId, IDS.primaryFromCompetitor), 0);
    await expectSqlState(setup, "55000", `
      UPDATE signal_mention_attribution_review_events
      SET review_policy_version = 'mutated'
      WHERE workspace_id = $1::uuid
    `, [fixture.workspaceId]);

    const unattributed = await createManualSignalSemanticAssertionV1(setup, {
      workspace_id: fixture.workspaceId,
      mention_id: IDS.unresolvedMention,
      reviewer_user_id: IDS.user,
      scope: "unattributed",
      entity_id: null,
      confidence: 0.5,
      rationale: "The governed identity cannot be resolved from current context.",
      idempotency_key: "manual-unattributed-001"
    });
    await assert.rejects(
      reviewSignalSemanticAssertionV1(setup, {
        workspace_id: fixture.workspaceId,
        attribution_id: unattributed.assertion_id,
        reviewer_user_id: IDS.user,
        decision: "approve",
        rationale: "This must remain ineligible.",
        idempotency_key: "approve-unattributed-001"
      }),
      (error: unknown) => error instanceof Error && "code" in error
        && String((error as Error & { code: string }).code) === "23514"
    );

    await assert.rejects(
      createManualSignalSemanticAssertionV1(setup, {
        workspace_id: fixture.workspaceId,
        mention_id: IDS.competitorMention,
        reviewer_user_id: IDS.user,
        scope: "competitor",
        entity_id: null,
        confidence: 0.9,
        rationale: "Missing governed competitor identity must fail closed.",
        idempotency_key: "manual-competitor-missing-001"
      }),
      (error: unknown) => error instanceof SignalSemanticReviewContractError
        && error.code === "invalid_input"
    );
    await assert.rejects(
      createManualSignalSemanticAssertionV1(setup, {
        workspace_id: fixture.workspaceId,
        mention_id: IDS.primaryFromCompetitor,
        reviewer_user_id: IDS.user,
        scope: "primary_brand",
        entity_id: IDS.otherBrand,
        confidence: 0.99,
        rationale: "A browser-supplied brand id cannot override the workspace identity.",
        idempotency_key: "manual-primary-wrong-brand-001"
      }),
      (error: unknown) => error instanceof SignalSemanticReviewContractError
        && error.code === "invalid_input"
    );
    await assert.rejects(
      createManualSignalSemanticAssertionV1(setup, {
        workspace_id: fixture.workspaceId,
        mention_id: IDS.excludedMention,
        reviewer_user_id: IDS.user,
        scope: "primary_brand",
        entity_id: IDS.brand,
        confidence: 0.99,
        rationale: "Excluded mentions cannot enter the operational Review queue.",
        idempotency_key: "manual-excluded-001"
      }),
      (error: unknown) => error instanceof SignalSemanticReviewContractError
        && error.code === "forbidden_state"
    );

    const aliasAssertion = await createManualSignalSemanticAssertionV1(setup, {
      workspace_id: fixture.workspaceId,
      mention_id: IDS.aliasMention,
      reviewer_user_id: IDS.user,
      scope: "reference",
      entity_id: null,
      confidence: 0.8,
      rationale: "Historical alias resolves to the canonical root exactly once.",
      idempotency_key: "manual-alias-001"
    });
    const aliasTarget = await scalar<string>(setup, `
      SELECT mention_id::text FROM signal_mention_attributions WHERE id = $1::uuid
    `, [aliasAssertion.assertion_id]);
    assert.equal(aliasTarget, IDS.primaryFromCompetitor);

    await assert.rejects(
      createManualSignalSemanticAssertionV1(setup, {
        workspace_id: fixture.otherWorkspaceId,
        mention_id: IDS.primaryFromCompetitor,
        reviewer_user_id: IDS.user,
        scope: "primary_brand",
        entity_id: IDS.otherBrand,
        confidence: 0.99,
        rationale: "Cross workspace must fail.",
        idempotency_key: "manual-cross-workspace-001"
      }),
      (error: unknown) => error instanceof SignalSemanticReviewContractError
        && error.code === "not_found"
    );

    await insertMention(setup, {
      id: IDS.afterImportMention,
      workspaceId: fixture.workspaceId,
      sourceId: IDS.sourceCompetitor,
      batchId: IDS.batchAfter,
      externalId: "post-0064-import-source-intent-only",
      text: "Contenido sin una identidad gobernada suficiente.",
      inclusionStatus: "included"
    });
    const postImport = await row(setup, `
      SELECT
        count(*) FILTER (WHERE attribution_basis = 'source_intent')::int AS source_intent,
        count(*) FILTER (WHERE attribution_basis = 'mention_semantic')::int AS semantic
      FROM signal_mention_attributions
      WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
    `, [fixture.workspaceId, IDS.afterImportMention]);
    assert.deepEqual(postImport, { source_intent: 1, semantic: 0 });

    await insertMention(setup, {
      id: IDS.concurrentMention,
      workspaceId: fixture.workspaceId,
      sourceId: IDS.sourceCompetitor,
      batchId: IDS.batchAfter,
      externalId: "concurrent-primary-candidate",
      text: "Laika Mascotas confirmó la información.",
      inclusionStatus: "included"
    });
    const concurrentA = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
    const concurrentB = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
    await Promise.all([concurrentA.connect(), concurrentB.connect()]);
    try {
      const [left, right] = await Promise.all([
        generateSignalSemanticCandidatesV1(concurrentA, { workspace_id: fixture.workspaceId, mode: "apply" }),
        generateSignalSemanticCandidatesV1(concurrentB, { workspace_id: fixture.workspaceId, mode: "apply" })
      ]);
      assert.equal(await scalar<number>(setup, `
        SELECT count(*)::int FROM signal_mention_attributions
        WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
          AND attribution_basis = 'mention_semantic'
          AND semantic_policy_key = 'signal-semantic-governed-identity'
      `, [fixture.workspaceId, IDS.concurrentMention]), 1);
      observed.concurrency = {
        effective_candidates: 1,
        generator_reports: [left.created_count, right.created_count]
      };
    } finally {
      await Promise.all([concurrentA.end(), concurrentB.end()]);
    }

    await applyMigration(setup, "0065_signal_semantic_resolution.sql");
    await applyMigration(setup, "0066_signal_semantic_resolution_message_batches.sql");
    await applyMigration(setup, "0067_signal_canonical_mention_governance.sql");
    await applyMigration(setup, "0067_signal_canonical_mention_governance.sql");

    const v1PointerBeforeGovernance = await row(setup, `
      SELECT pointer.population_id::text,
        definition.membership_digest,
        count(membership.id) FILTER (
          WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL
        )::int AS active_memberships
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions definition ON definition.id = pointer.population_id
      LEFT JOIN signal_population_memberships membership ON membership.population_id = definition.id
      WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
      GROUP BY pointer.population_id, definition.membership_digest
    `, [fixture.workspaceId]);
    await setup.query(`
      INSERT INTO signal_data_watermarks (
        workspace_id, study_corpus_id, population_id, data_source_id,
        source_key, corpus_revision, last_import_batch_id,
        accepted_at, materialized_at, source_freshness_state, data_freshness_state
      ) VALUES (
        $1::uuid, NULL, $2::uuid, $3::uuid,
        'semantic-review-governance-fixture', 1, $4::uuid,
        now(), now(), 'fresh', 'fresh'
      )
    `, [fixture.workspaceId, v1PointerBeforeGovernance.population_id, IDS.sourcePrimary, IDS.batchPrimary]);
    assert.equal(await activePopulationMembership(setup, fixture.workspaceId, IDS.categoryMention), 1);
    const invalidationsBefore = await invalidationCount(setup, fixture.workspaceId);
    const excluded = await mutateSignalCanonicalMentionGovernanceV1(setup, {
      workspace_id: fixture.workspaceId,
      mention_id: IDS.categoryMention,
      actor_user_id: IDS.user,
      action: "exclude",
      reason: "Operator confirmed the mention is outside operational quality policy.",
      idempotency_key: "governance-exclude-category-001"
    });
    assert.equal(excluded.changed, true);
    assert.equal(excluded.was_replayed, false);
    assert.equal(await activePopulationMembership(setup, fixture.workspaceId, IDS.categoryMention), 0);
    assert.equal(await invalidationCount(setup, fixture.workspaceId), invalidationsBefore + 1);
    const excludeRetry = await mutateSignalCanonicalMentionGovernanceV1(setup, {
      workspace_id: fixture.workspaceId,
      mention_id: IDS.categoryMention,
      actor_user_id: IDS.user,
      action: "exclude",
      reason: "Operator confirmed the mention is outside operational quality policy.",
      idempotency_key: "governance-exclude-category-001"
    });
    assert.equal(excludeRetry.event_id, excluded.event_id);
    assert.equal(excludeRetry.was_replayed, true);
    assert.equal(await invalidationCount(setup, fixture.workspaceId), invalidationsBefore + 1);
    const reverted = await mutateSignalCanonicalMentionGovernanceV1(setup, {
      workspace_id: fixture.workspaceId,
      mention_id: IDS.categoryMention,
      actor_user_id: IDS.user,
      action: "revert",
      reason: "Operator restored the previous governed inclusion decision.",
      idempotency_key: "governance-revert-category-001"
    });
    assert.equal(reverted.inclusion_status, "included");
    assert.equal(await activePopulationMembership(setup, fixture.workspaceId, IDS.categoryMention), 1);
    assert.equal(await invalidationCount(setup, fixture.workspaceId), invalidationsBefore + 2);
    const included = await mutateSignalCanonicalMentionGovernanceV1(setup, {
      workspace_id: fixture.workspaceId,
      mention_id: IDS.categoryMention,
      actor_user_id: IDS.user,
      action: "include",
      reason: "Operator reconfirmed the mention is eligible for operational review.",
      idempotency_key: "governance-include-category-001"
    });
    assert.equal(included.changed, false);
    const reviewRequest = await mutateSignalCanonicalMentionGovernanceV1(setup, {
      workspace_id: fixture.workspaceId,
      mention_id: IDS.aliasMention,
      actor_user_id: IDS.user,
      action: "send_to_review",
      reason: "Operator requested an explicit semantic classification review.",
      idempotency_key: "governance-review-alias-001"
    });
    assert.equal(reviewRequest.canonical_mention_id, IDS.primaryFromCompetitor);
    assert.equal(reviewRequest.changed, false);
    const requestedReviewQueue = await loadSignalSemanticReviewQueueV1(setup, {
      workspace_id: fixture.workspaceId,
      filters: { state: "needs_context" },
      limit: 100
    });
    assert.ok(requestedReviewQueue.records.some(
      (record) => record.mention_id === IDS.primaryFromCompetitor
    ));
    await assert.rejects(
      mutateSignalCanonicalMentionGovernanceV1(setup, {
        workspace_id: fixture.otherWorkspaceId,
        mention_id: IDS.categoryMention,
        actor_user_id: IDS.user,
        action: "exclude",
        reason: "Cross-workspace mutation must fail closed.",
        idempotency_key: "governance-cross-workspace-001"
      }),
      (error: unknown) => error instanceof SignalMentionGovernanceContractError
        && error.code === "invalid_input"
    );
    const v1PointerAfterGovernance = await row(setup, `
      SELECT pointer.population_id::text,
        count(membership.id) FILTER (
          WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL
        )::int AS active_memberships
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions definition ON definition.id = pointer.population_id
      LEFT JOIN signal_population_memberships membership ON membership.population_id = definition.id
      WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
      GROUP BY pointer.population_id
    `, [fixture.workspaceId]);
    assert.equal(v1PointerAfterGovernance.population_id, v1PointerBeforeGovernance.population_id);
    assert.equal(v1PointerAfterGovernance.active_memberships, v1PointerBeforeGovernance.active_memberships);

    await reviewSignalSemanticAssertionV1(setup, {
      workspace_id: fixture.workspaceId,
      attribution_id: unattributed.assertion_id,
      reviewer_user_id: IDS.user,
      decision: "approve",
      rationale: "The final reviewed result remains explicitly outside operational serving.",
      idempotency_key: "approve-unattributed-0065"
    });
    assert.deepEqual(await row(setup, `
      SELECT review_status, eligibility_status
      FROM signal_mention_attributions
      WHERE id = $1::uuid
    `, [unattributed.assertion_id]), {
      review_status: "approved",
      eligibility_status: "not_eligible"
    });
    assert.equal(await activeV2Memberships(setup, fixture.workspaceId, IDS.unresolvedMention), 0);

    await setup.query(`
      UPDATE intelligence_entities
      SET status = 'archived'
      WHERE id = $1::uuid
    `, [IDS.category]);
    await setup.query("BEGIN");
    const preparedResolution = await prepareSignalSemanticResolutionRunV1(setup, {
      workspace_id: fixture.workspaceId,
      requested_by_user_id: IDS.user,
      confirm_over_budget: false
    });
    await setup.query("COMMIT");
    assert.equal(preparedResolution.state, "queued");
    assert.ok(preparedResolution.run);
    assert.equal(preparedResolution.estimate.confirmation_required, false);
    assert.deepEqual(await row(setup, `
      SELECT entity.canonical_name,
        entity.external_id,
        array_agg(alias.alias ORDER BY alias.alias) AS aliases
      FROM intelligence_entities entity
      JOIN entity_aliases alias ON alias.entity_id = entity.id
      WHERE entity.brand_id = $1::uuid
        AND entity.entity_type = 'category'
        AND entity.status = 'active'
      GROUP BY entity.id, entity.canonical_name, entity.external_id
    `, [IDS.brand]), {
      canonical_name: "Retail para mascotas",
      external_id: `signal-brand-os-category:${IDS.brand}`,
      aliases: ["Pet care", "Retail para mascotas"]
    });

    const decisions = [
      {
        mention_id: IDS.concurrentMention,
        classifications: [{
          scope: "primary_brand" as const,
          entity_id: IDS.brand,
          confidence: 0.98,
          rationale: "Laika Mascotas is explicitly the substantive subject."
        }]
      },
      {
        mention_id: IDS.afterImportMention,
        classifications: [{
          scope: "unattributed" as const,
          entity_id: null,
          confidence: 0.44,
          rationale: "The available context does not responsibly establish a governed identity."
        }]
      }
    ];
    const firstBatchRecord = await recordSignalSemanticResolutionBatchOutputV1(setup, {
      run_id: preparedResolution.run.run_id,
      decisions,
      input_tokens: 1_200,
      output_tokens: 280,
      cost_usd: 0.01
    });
    const retriedBatchRecord = await recordSignalSemanticResolutionBatchOutputV1(setup, {
      run_id: preparedResolution.run.run_id,
      decisions,
      input_tokens: 1_200,
      output_tokens: 280,
      cost_usd: 0.01
    });
    assert.deepEqual(firstBatchRecord, { reconciled: false });
    assert.deepEqual(retriedBatchRecord, { reconciled: true });
    assert.deepEqual(await row(setup, `
      SELECT input_tokens, output_tokens, actual_cost_usd::text
      FROM signal_semantic_resolution_runs
      WHERE id = $1::uuid
    `, [preparedResolution.run.run_id]), {
      input_tokens: 1_200,
      output_tokens: 280,
      actual_cost_usd: "0.010000"
    });

    await setup.query("BEGIN");
    const primaryResolution = await applySignalSemanticResolutionDecisionV1(setup, {
      run_id: preparedResolution.run.run_id,
      mention_id: IDS.concurrentMention,
      reviewer_user_id: IDS.user,
      model_version: preparedResolution.run.model_version,
      decision: decisions[0]!
    });
    await setup.query("COMMIT");
    assert.deepEqual(primaryResolution, { reconciled: false });
    assert.equal(await activeV2Memberships(setup, fixture.workspaceId, IDS.concurrentMention), 0);
    const modelApprovedQueue = await loadSignalSemanticReviewQueueV1(setup, {
      workspace_id: fixture.workspaceId,
      filters: { state: "candidate_pending" },
      limit: 100
    });
    const modelApprovedItem = modelApprovedQueue.records.find((item) => item.mention_id === IDS.concurrentMention);
    const modelApprovedAssertion = modelApprovedItem?.current_assertions.find(
      (assertion) => assertion.semantic_policy_key === "signal-semantic-claude-resolution"
    );
    assert.ok(modelApprovedAssertion);
    assert.equal(modelApprovedAssertion.resolution_state, "pending");
    assert.equal(modelApprovedAssertion.approval_source, null);
    assert.equal(modelApprovedAssertion.approved_by_user_id, null);
    assert.equal(modelApprovedAssertion.model_version, preparedResolution.run.model_version);
    assert.equal(modelApprovedAssertion.approved_at, null);
    assert.equal(modelApprovedAssertion.is_current, true);

    await setup.query("BEGIN");
    const unattributedResolution = await applySignalSemanticResolutionDecisionV1(setup, {
      run_id: preparedResolution.run.run_id,
      mention_id: IDS.afterImportMention,
      reviewer_user_id: IDS.user,
      model_version: preparedResolution.run.model_version,
      decision: decisions[1]!
    });
    await setup.query("COMMIT");
    assert.deepEqual(unattributedResolution, { reconciled: false });
    assert.equal(await activeV2Memberships(setup, fixture.workspaceId, IDS.afterImportMention), 0);
    assert.deepEqual(await row(setup, `
      SELECT review_status, eligibility_status, evidence_kind, approval_source
      FROM signal_mention_attributions
      WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
        AND attribution_basis = 'mention_semantic'
        AND semantic_policy_key = 'signal-semantic-claude-resolution'
        AND is_current = true
    `, [fixture.workspaceId, IDS.afterImportMention]), {
      review_status: "pending",
      eligibility_status: "not_eligible",
      evidence_kind: "model_reviewed_context",
      approval_source: null
    });

    const primaryResolutionRetry = await applySignalSemanticResolutionDecisionV1(setup, {
      run_id: preparedResolution.run.run_id,
      mention_id: IDS.concurrentMention,
      reviewer_user_id: IDS.user,
      model_version: preparedResolution.run.model_version,
      decision: decisions[0]!
    });
    assert.deepEqual(primaryResolutionRetry, { reconciled: true });

    const modelAssertionId = await scalar<string>(setup, `
      SELECT id::text
      FROM signal_mention_attributions
      WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
        AND attribution_basis = 'mention_semantic'
        AND semantic_policy_key = 'signal-semantic-claude-resolution'
        AND scope = 'primary_brand' AND is_current = true
    `, [fixture.workspaceId, IDS.concurrentMention]);
    const correctedModelAssertion = await supersedeSignalSemanticAssertionV1(setup, {
      workspace_id: fixture.workspaceId,
      attribution_id: modelAssertionId,
      reviewer_user_id: IDS.user,
      scope: "primary_brand",
      entity_id: IDS.brand,
      confidence: 0.99,
      rationale: "The Insights Manager corrected the autonomous classification with fuller context.",
      idempotency_key: "correct-model-resolution-001"
    });
    const modelHistory = await listSignalSemanticAssertionHistoryV1(setup, {
      workspace_id: fixture.workspaceId,
      attribution_id: modelAssertionId
    });
    assert.deepEqual(modelHistory.events.map((event) => event.action), ["superseded"]);
    assert.equal(correctedModelAssertion.review_status, "pending");
    assert.equal(await activeV2Memberships(setup, fixture.workspaceId, IDS.concurrentMention), 0);
    const correctedQueue = await loadSignalSemanticReviewQueueV1(setup, {
      workspace_id: fixture.workspaceId,
      filters: { state: "candidate_pending" },
      limit: 100
    });
    const correctedQueueItem = correctedQueue.records.find((item) => item.mention_id === IDS.concurrentMention);
    assert.ok(correctedQueueItem);
    assert.deepEqual(correctedQueueItem.current_assertions.map((assertion) => ({
      id: assertion.id,
      is_current: assertion.is_current,
      review_status: assertion.review_status
    })), [{
      id: correctedModelAssertion.assertion_id,
      is_current: true,
      review_status: "pending"
    }]);
    observed.autonomous_resolution = {
      queued_items: preparedResolution.run.total_items,
      batch_output_durable_and_reconciled: true,
      final_primary_entered_candidate_population: false,
      final_unattributed_remained_excluded: true,
      pending_proposal_correctable_with_history: true
    };

    observed.candidates = {
      dry_run: dryRun,
      apply_created: applied.created_count,
      retry_created: retried.created_count,
      v1_definition_unchanged: before.v1_definition_digest === afterCandidates.v1_definition_digest,
      v1_pointer_unchanged: before.v1_pointer_digest === afterCandidates.v1_pointer_digest,
      v1_memberships_unchanged: before.v1_membership_digest === afterCandidates.v1_membership_digest,
      source_intent_unchanged: before.source_intent_digest === afterCandidates.source_intent_digest,
      v2_pointer_count: afterCandidates.v2_pointer_count,
      v2_membership_count: afterCandidates.v2_membership_count,
      review_event_count: afterCandidates.review_event_count,
      approved_semantic_count: afterCandidates.approved_semantic_count
    };
    observed.review = {
      superseding_assertion_id_present: Boolean(superseded.assertion_id),
      append_only_events: history.events.length,
      alias_resolved_to_root: aliasTarget === IDS.primaryFromCompetitor
    };
    process.stdout.write(`${JSON.stringify({ ok: true, observed }, null, 2)}\n`);
  } finally {
    await setup.end();
  }
});

async function seedFixture(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id, slug, legal_name, display_name, status) VALUES
      ($1::uuid, 'semantic-review-org', 'Semantic Review org', 'Semantic Review org', 'active'),
      ($2::uuid, 'semantic-review-other', 'Semantic Review other', 'Semantic Review other', 'active')
  `, [IDS.organization, IDS.otherOrganization]);
  await client.query(`
    INSERT INTO users (id, email, full_name, user_type, primary_role, organization_id, status)
    VALUES ($1::uuid, 'semantic-review-admin@example.test', 'Semantic Review admin',
      'noisia_internal', 'noisia_admin', $2::uuid, 'active')
  `, [IDS.user, IDS.organization]);
  await client.query(`
    INSERT INTO brands (
      id, organization_id, slug, name, display_name, countries,
      brand_seed_handles, industry, industry_sub, status
    ) VALUES
      ($1::uuid, $3::uuid, 'semantic-laika', 'Laika Mascotas', 'Laika Mascotas',
       ARRAY['MX']::char(2)[], ARRAY['@laikamascotas']::text[],
       'Pet care', 'Retail para mascotas', 'active'),
      ($2::uuid, $4::uuid, 'semantic-other', 'Other Brand', 'Other Brand',
       ARRAY['MX']::char(2)[], ARRAY[]::text[],
       'Other category', NULL, 'active')
  `, [IDS.brand, IDS.otherBrand, IDS.organization, IDS.otherOrganization]);
  const workspaceId = await scalar<string>(client, `SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid`, [IDS.brand]);
  const otherWorkspaceId = await scalar<string>(client, `SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid`, [IDS.otherBrand]);
  await client.query(`
    INSERT INTO brand_seeds (
      id, canonical_name, aliases, detection_patterns, country, active
    ) VALUES (
      $1::uuid, 'Pet House', ARRAY['@pethouse']::text[],
      ARRAY['Pet House']::text[], 'MX', true
    )
  `, [IDS.competitorSeed]);
  await client.query(`
    INSERT INTO competitors (id, brand_id, competitor_brand_seed_id, priority)
    VALUES ($1::uuid, $2::uuid, $3::uuid, 1)
  `, [IDS.competitor, IDS.brand, IDS.competitorSeed]);
  await client.query(`
    INSERT INTO intelligence_entities (
      id, organization_id, brand_id, entity_type, canonical_name, status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'category', 'Bienestar de mascotas', 'active'
    )
  `, [IDS.category, IDS.organization, IDS.brand]);
  await client.query(`
    INSERT INTO entity_aliases (id, entity_id, alias, alias_type, source, confidence)
    VALUES ($1::uuid, $2::uuid, 'cuidado animal', 'phrase', 'fixture', 1.0)
  `, [IDS.categoryAlias, IDS.category]);
  await client.query(`
    INSERT INTO data_sources (
      id, workspace_id, organization_id, brand_id, source_type, provider,
      connection_method, name, governed_scope, governed_entity_type,
      governed_entity_id, scope_policy_version, scope_review_status,
      scope_approved_by_user_id, scope_approval_source, scope_approved_at,
      role, status
    ) VALUES
      ($2::uuid, $1::uuid, $4::uuid, $5::uuid, 'social-listening', 'fixture',
       'csv', 'Primary acquisition intent', 'primary_brand', 'brand', $5::uuid,
       'workspace-source-scope-v1', 'approved', $6::uuid, 'fixture', now(), '{}'::jsonb, 'active'),
      ($3::uuid, $1::uuid, $4::uuid, $5::uuid, 'social-listening', 'fixture',
       'csv', 'Competitor acquisition intent', 'competitor', 'competitor', $7::uuid,
       'workspace-source-scope-v1', 'approved', $6::uuid, 'fixture', now(), '{}'::jsonb, 'active'),
      ($9::uuid, $8::uuid, $10::uuid, $11::uuid, 'social-listening', 'fixture',
       'csv', 'Other workspace source', 'primary_brand', 'brand', $11::uuid,
       'workspace-source-scope-v1', 'approved', $6::uuid, 'fixture', now(), '{}'::jsonb, 'active')
  `, [
    workspaceId, IDS.sourcePrimary, IDS.sourceCompetitor, IDS.organization,
    IDS.brand, IDS.user, IDS.competitor, otherWorkspaceId,
    IDS.otherSource, IDS.otherOrganization, IDS.otherBrand
  ]);
  await client.query(`
    INSERT INTO import_batches (
      id, workspace_id, data_source_id, mention_type, competitor_id,
      entity_kind, entity_label, source_system, imported_by_user_id,
      status, source_file_name
    ) VALUES
      ($2::uuid, $1::uuid, $3::uuid, 'brand', NULL,
       'primary_brand', 'Laika Mascotas', 'fixture', $4::uuid, 'completed', 'primary.csv'),
      ($5::uuid, $1::uuid, $6::uuid, 'competitor', $7::uuid,
       'competitor', 'Pet House', 'fixture', $4::uuid, 'completed', 'competitor.csv'),
      ($8::uuid, $1::uuid, $6::uuid, 'competitor', $7::uuid,
       'competitor', 'Pet House', 'fixture', $4::uuid, 'completed', 'after.csv'),
      ($10::uuid, $9::uuid, $11::uuid, 'brand', NULL,
       'primary_brand', 'Other Brand', 'fixture', $4::uuid, 'completed', 'other.csv')
  `, [
    workspaceId, IDS.batchPrimary, IDS.sourcePrimary, IDS.user,
    IDS.batchCompetitor, IDS.sourceCompetitor, IDS.competitor, IDS.batchAfter,
    otherWorkspaceId, IDS.otherBatch, IDS.otherSource
  ]);
  await insertMention(client, {
    id: IDS.primaryFromCompetitor,
    workspaceId,
    sourceId: IDS.sourceCompetitor,
    batchId: IDS.batchCompetitor,
    externalId: "primary-from-competitor-intent",
    text: "Laika Mascotas resolvió el pedido hoy.",
    inclusionStatus: "included"
  });
  await insertMention(client, {
    id: IDS.competitorMention,
    workspaceId,
    sourceId: IDS.sourceCompetitor,
    batchId: IDS.batchCompetitor,
    externalId: "competitor-semantic",
    text: "Pet House anunció una promoción.",
    inclusionStatus: "included"
  });
  await insertMention(client, {
    id: IDS.categoryMention,
    workspaceId,
    sourceId: IDS.sourcePrimary,
    batchId: IDS.batchPrimary,
    externalId: "category-semantic",
    text: "El bienestar de mascotas necesita mejor información.",
    inclusionStatus: "included"
  });
  await insertMention(client, {
    id: IDS.multiMention,
    workspaceId,
    sourceId: IDS.sourceCompetitor,
    batchId: IDS.batchCompetitor,
    externalId: "multi-semantic",
    text: "Laika Mascotas y Pet House compararon servicios.",
    inclusionStatus: "included"
  });
  await insertMention(client, {
    id: IDS.unresolvedMention,
    workspaceId,
    sourceId: IDS.sourcePrimary,
    batchId: IDS.batchPrimary,
    externalId: "unresolved-semantic",
    text: "Una experiencia sin identidad suficiente.",
    inclusionStatus: "included"
  });
  await insertMention(client, {
    id: IDS.needsContextMention,
    workspaceId,
    sourceId: IDS.sourcePrimary,
    batchId: IDS.batchPrimary,
    externalId: "needs-context-semantic",
    text: "",
    inclusionStatus: "included"
  });
  await insertMention(client, {
    id: IDS.excludedMention,
    workspaceId,
    sourceId: IDS.sourcePrimary,
    batchId: IDS.batchPrimary,
    externalId: "excluded-semantic",
    text: "Laika Mascotas no debe entrar porque fue excluida.",
    inclusionStatus: "excluded"
  });
  await insertMention(client, {
    id: IDS.aliasMention,
    workspaceId,
    sourceId: IDS.sourceCompetitor,
    batchId: IDS.batchCompetitor,
    externalId: "historical-alias",
    text: "Alias histórico de la misma publicación.",
    inclusionStatus: "included",
    canonicalMentionId: IDS.primaryFromCompetitor
  });
  await insertMention(client, {
    id: IDS.otherMention,
    workspaceId: otherWorkspaceId,
    sourceId: IDS.otherSource,
    batchId: IDS.otherBatch,
    externalId: "other-workspace-mention",
    text: "Other Brand publicó hoy.",
    inclusionStatus: "included"
  });
  for (let index = 0; index < 105; index += 1) {
    await insertMention(client, {
      id: deterministicMentionId(index),
      workspaceId,
      sourceId: IDS.sourcePrimary,
      batchId: IDS.batchPrimary,
      externalId: `bulk-primary-${index}`,
      text: `Laika Mascotas publicó la actualización ${index}.`,
      inclusionStatus: "included",
      publishedAt: new Date(Date.UTC(2026, 5, 1 + (index % 20), 12, index % 60)).toISOString()
    });
  }
  return { workspaceId, otherWorkspaceId };
}

async function insertMention(client: pg.Client, args: {
  id: string;
  workspaceId: string;
  sourceId: string;
  batchId: string;
  externalId: string;
  text: string;
  inclusionStatus: "included" | "excluded";
  canonicalMentionId?: string;
  publishedAt?: string;
}) {
  const textHash = Buffer.from(args.externalId).toString("hex").padEnd(64, "0").slice(0, 64);
  await client.query(`
    INSERT INTO mentions (
      id, workspace_id, data_source_id, canonical_mention_id,
      provider_record_id, external_id, source_system, source_file_id,
      text_hash, text_clean, text_snippet, text_length, language,
      published_at, platform, resolved_platform, quality_score,
      inclusion_status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      $5, $6, 'fixture-semantic-review', $7::uuid,
      $8, $9, $9, $10, 'es', $11::timestamptz,
      'instagram', 'instagram', 9, $12
    )
  `, [
    args.id,
    args.workspaceId,
    args.sourceId,
    args.canonicalMentionId ?? args.id,
    args.externalId,
    `${args.workspaceId}:${args.externalId}`,
    args.batchId,
    textHash,
    args.text,
    args.text.length,
    args.publishedAt ?? "2026-06-15T12:00:00.000Z",
    args.inclusionStatus
  ]);
}

function deterministicMentionId(index: number) {
  return `72100000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

async function currentAssertion(
  client: pg.Client,
  workspaceId: string,
  mentionId: string,
  scope: string
) {
  return scalar<string>(client, `
    SELECT id::text FROM signal_mention_attributions
    WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
      AND attribution_basis = 'mention_semantic'
      AND semantic_policy_key = 'signal-semantic-governed-identity'
      AND scope = $3 AND is_current = true
  `, [workspaceId, mentionId, scope]);
}

async function activeV2Memberships(client: pg.Client, workspaceId: string, mentionId: string) {
  return scalar<number>(client, `
    SELECT count(*)::int
    FROM signal_population_memberships membership
    JOIN signal_population_definitions definition ON definition.id = membership.population_id
    WHERE definition.workspace_id = $1::uuid
      AND definition.definition->>'contract_version'
        = 'signal-operational-primary-brand-semantic-v2'
      AND membership.mention_id = $2::uuid
      AND membership.membership_status = 'included'
      AND membership.removed_at IS NULL
  `, [workspaceId, mentionId]);
}

async function activePopulationMembership(client: pg.Client, workspaceId: string, mentionId: string) {
  return scalar<number>(client, `
    SELECT count(*)::int
    FROM signal_workspace_population_pointers pointer
    JOIN signal_population_memberships membership
      ON membership.population_id = pointer.population_id
     AND membership.workspace_id = pointer.workspace_id
    WHERE pointer.workspace_id = $1::uuid
      AND pointer.purpose = 'operational'
      AND membership.mention_id = $2::uuid
      AND membership.membership_status = 'included'
      AND membership.removed_at IS NULL
  `, [workspaceId, mentionId]);
}

async function invalidationCount(client: pg.Client, workspaceId: string) {
  return scalar<number>(client, `
    SELECT count(*)::int
    FROM signal_data_invalidations
    WHERE workspace_id = $1::uuid
      AND reason = 'operational_population_membership_changed'
  `, [workspaceId]);
}

function assertProtectedCandidateState(
  before: Awaited<ReturnType<typeof inspectSignalSemanticReviewInvariantsV1>>,
  after: Awaited<ReturnType<typeof inspectSignalSemanticReviewInvariantsV1>>
) {
  assert.equal(after.v1_definition_digest, before.v1_definition_digest);
  assert.equal(after.v1_pointer_digest, before.v1_pointer_digest);
  assert.equal(after.v1_membership_digest, before.v1_membership_digest);
  assert.equal(after.v1_active_membership_count, before.v1_active_membership_count);
  assert.equal(after.v1_active_membership_digest, before.v1_active_membership_digest);
  assert.equal(after.source_intent_digest, before.source_intent_digest);
  assert.equal(after.v2_pointer_count, 0);
  assert.equal(after.v2_membership_count, 0);
  assert.equal(after.review_event_count, 0);
  assert.equal(after.approved_semantic_count, 0);
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}

async function applyMigrationsThrough(client: pg.Client, maximum: number) {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= maximum)
    .sort();
  for (const file of files) await applyMigration(client, file);
}

async function applyMigration(client: pg.Client, file: string) {
  await client.query("BEGIN");
  try {
    await client.query(await readFile(join(migrationDir, file), "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function expectSqlState(client: pg.Client, expected: string, query: string, params: unknown[] = []) {
  await assert.rejects(
    client.query(query, params),
    (error: unknown) => error instanceof Error && "code" in error
      && String((error as Error & { code: string }).code) === expected
  );
}

async function row(client: pg.Client, query: string, params: unknown[] = []) {
  const result = await client.query<Record<string, any>>(query, params);
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}

async function scalar<T>(client: pg.Client, query: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(query, params);
  assert.equal(result.rowCount, 1);
  const values = Object.values(result.rows[0] ?? {});
  assert.equal(values.length, 1);
  return values[0] as T;
}
