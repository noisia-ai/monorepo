import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { signalTopicEditorialDigestV1 as digest, type SignalTopicInterestReviewV1 } from "@noisia/query-engine";
import { prepareSignalTopicInterestReviewV1, loadSignalTopicInterestReviewPreparationV1 } from "../signal-topic-interest-review-preparation";
import { loadSignalTopicInterestReviewInputV1 } from "../signal-topic-consolidation-editorial-input";
import { updateSignalTopicStoreV1 } from "../signal-topic-catalog";
import { createProcessingPolicyIdentitiesV1 } from "./signal-processing-policy.fixture";
import { seedSignalTopicInterestReviewPreparationV1, snapshotSignalTopicInterestReviewSyntheticHistoryV1,
  type SignalTopicInterestReviewSyntheticSeedArgsV1 } from "./signal-topic-interest-review.synthetic.fixture";

export const INTEREST_PREPARATION_POSITIVE_ASSERTION_NAMES = Object.freeze([
  "0183 positive: real published context and guarded numeric source prepare and load a complete review",
  "0183 positive: lost acknowledgement replays the same preparation without another row",
  "0183 positive: resealed missing duplicate reordered and foreign pairs fail the SQL matrix guard",
  "0183 positive: preparation history rejects update and delete",
  "0183 positive: catalog edits stale the old snapshot and require a new identity",
  "0183 positive: foreign workspace and revoked actor cannot load or replay",
  "0183 positive: changed knowledge invalidates preparation and load without rewriting history",
  "0183 positive: preparation leaves existing paid history and assignments unchanged",
] as const);

/** Reseal outer hashes deliberately: a rejection must come from the semantic
 * matrix contract, not merely from an obsolete checksum on malformed data. */
function reseal(review: SignalTopicInterestReviewV1) {
  for (const batch of review.batches) {
    const wire = JSON.parse(batch.request_body);
    const payload = JSON.parse(wire.messages[0].content);
    payload.pairs = batch.pairs;
    wire.messages[0].content = JSON.stringify(payload);
    batch.request_body = JSON.stringify(wire);
    const { request_digest: _old, ...body } = batch;
    batch.request_digest = digest(body);
  }
  const { review_digest: _old, ...body } = review;
  review.review_digest = digest(body);
  return review;
}

/** Written acceptance scenarios, NOT a passed PG receipt. Uses actual stores and
 * SQL guards, synthetic provider responses and numerical artifacts only. Caller
 * owns physical rollback. Savepoints cannot certify concurrent transactions or
 * crash durability, nor does the intake seed certify Studio's creation routes. */
export async function assertSignalTopicInterestReviewPositiveV1(
  t: Pick<TestContext, "test">, args: SignalTopicInterestReviewSyntheticSeedArgsV1,
) {
  const fixture = await seedSignalTopicInterestReviewPreparationV1(args);
  const { scope, review, baseline } = fixture, { query } = args;
  const key = randomUUID();
  let preparationId = "";
  const isolated = async (work: () => Promise<void>) => {
    await query("BEGIN");
    try { await work(); } finally { await query("ROLLBACK"); }
  };
  const preparationRows = async () => (await query(`SELECT id::text,review_digest,input_digest
    FROM signal_topic_interest_review_preparations ORDER BY id`)).rows;
  const assignments = async () => (await query(`SELECT count(*)::int count,
    md5(COALESCE(string_agg(to_jsonb(a)::text,E'\\n' ORDER BY to_jsonb(a)::text),'')) digest
    FROM signal_classification_assignments a`)).rows[0];
  const assignmentsBefore = await assignments();
  const unchanged = async () => {
    assert.deepEqual(await snapshotSignalTopicInterestReviewSyntheticHistoryV1(args), baseline,
      "preparation must not mutate synthetic historical policies, admissions, owners, requests or costs");
    assert.deepEqual(await assignments(), assignmentsBefore, "a prepared review never assigns mentions");
  };
  const run = async (index: number, work: () => Promise<void>) => t.test(INTEREST_PREPARATION_POSITIVE_ASSERTION_NAMES[index]!,
    async () => { await work(); await unchanged(); });

  await run(0, async () => {
    const result = await prepareSignalTopicInterestReviewV1({ ...scope, review, idempotency_key: key });
    assert.equal(result.replayed, false); assert.equal(result.provider_execution_enabled, false);
    assert.equal(result.review_digest, review.review_digest); assert.equal(result.input_digest, review.input_digest);
    preparationId = result.preparation_id;
    const loaded = await loadSignalTopicInterestReviewPreparationV1({ ...scope, preparation_id: preparationId });
    assert.deepEqual(loaded.review, review, "loader returns all source groups, versioned interests, request bytes and citations");
    assert.equal(loaded.provider_execution_enabled, false);
    assert.equal(loaded.review.manifest.expected_pair_count, 2);
    assert.equal(loaded.review.manifest.membership_effect, "none");
    assert.equal((await preparationRows()).length, 1);
  });
  await run(1, async () => {
    const before = await preparationRows();
    const retried = await prepareSignalTopicInterestReviewV1({ ...scope, review, idempotency_key: key });
    assert.equal(retried.replayed, true); assert.equal(retried.preparation_id, preparationId);
    assert.deepEqual(await preparationRows(), before, "discarding the first receipt cannot create another request");
  });
  await run(2, async () => {
    const variants = Array.from({ length: 4 }, () => structuredClone(review));
    variants[0]!.batches[0]!.pairs.pop();
    variants[1]!.batches[0]!.pairs[1] = structuredClone(variants[1]!.batches[0]!.pairs[0]!);
    variants[2]!.batches[0]!.pairs.reverse();
    variants[3]!.batches[0]!.pairs[0]!.term_key = "foreign_interest";
    for (const body of variants.map(reseal)) {
      assert.equal((await query("SELECT signal_topic_interest_review_plan_valid_v1($1,$2,$3::jsonb) value",
        [scope.workspace_id, scope.numeric_run_id, JSON.stringify(body)])).rows[0]?.value, false);
      await isolated(async () => assert.rejects(query("SELECT prepare_signal_topic_interest_review_v1($1,$2,$3,$4::jsonb,$5)",
        [scope.workspace_id, scope.actor_user_id, scope.numeric_run_id, JSON.stringify(body), randomUUID()]),
      { code: "23514", message: "topic_interest_review_plan_invalid" }));
    }
    assert.equal((await preparationRows()).length, 1);
  });
  await run(3, async () => {
    const before = await preparationRows();
    for (const sql of ["UPDATE signal_topic_interest_review_preparations SET review_digest=review_digest WHERE id=$1",
      "DELETE FROM signal_topic_interest_review_preparations WHERE id=$1"]) {
      await isolated(async () => assert.rejects(query(sql, [preparationId]),
        { code: "55000", message: "topic_interest_review_history_retained" }));
    }
    assert.deepEqual(await preparationRows(), before);
  });
  await run(4, async () => isolated(async () => {
    const before = await preparationRows(), definition = fixture.definition;
    await updateSignalTopicStoreV1({ pool: args.database, ...scope, term_key: definition.term_key,
      idempotency_key: randomUUID(), input: { expected_definition_revision: definition.definition_revision,
        expected_definition_digest: definition.definition_digest,
        definition: "Only appointment delays for invented bicycle repairs; exclude general upkeep." } });
    await assert.rejects(loadSignalTopicInterestReviewPreparationV1({ ...scope, preparation_id: preparationId }),
      /topic_interest_review_catalog_stale/);
    await assert.rejects(prepareSignalTopicInterestReviewV1({ ...scope, review, idempotency_key: key }),
      /topic_interest_review_catalog_stale/);
    const updated = await loadSignalTopicInterestReviewInputV1(scope);
    assert.notEqual(updated.review_digest, review.review_digest);
    await assert.rejects(prepareSignalTopicInterestReviewV1({ ...scope, review: updated, idempotency_key: key }),
      /processing_idempotency_conflict/);
    const next = await prepareSignalTopicInterestReviewV1({ ...scope, review: updated, idempotency_key: randomUUID() });
    assert.notEqual(next.preparation_id, preparationId); assert.equal(next.replayed, false);
    assert.deepEqual((await preparationRows()).filter(row => row.id === preparationId), before);
  }));
  await run(5, async () => {
    await assert.rejects(loadSignalTopicInterestReviewPreparationV1({ ...scope, workspace_id: randomUUID(), preparation_id: preparationId }),
      /topic_interest_review_forbidden/);
    await isolated(async () => {
      const foreign = await createProcessingPolicyIdentitiesV1(args);
      assert.equal((await query("SELECT signal_topic_interest_review_can_read_v1($1,$2) value",
        [foreign.foreign.workspace_id, foreign.actors.foreignAdmin])).rows[0]?.value, true);
      await assert.rejects(loadSignalTopicInterestReviewPreparationV1({ ...scope,
        actor_user_id: foreign.actors.foreignAdmin, preparation_id: preparationId }), /topic_interest_review_forbidden/);
      await assert.rejects(loadSignalTopicInterestReviewPreparationV1({ ...scope, workspace_id: foreign.foreign.workspace_id,
        actor_user_id: foreign.actors.foreignAdmin, preparation_id: preparationId }), /topic_interest_review_preparation_missing/);
      const reader = randomUUID();
      await query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
        VALUES($1,$2,'Synthetic interest reader','client','client_viewer',$3,'active')`,
      [reader, `${reader}@example.test`, fixture.identity.organization_id]);
      await query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,'read')", [reader, fixture.identity.brand_id]);
      assert.equal((await loadSignalTopicInterestReviewPreparationV1({ ...scope, actor_user_id: reader,
        preparation_id: preparationId })).review_digest, review.review_digest);
      await query("UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2", [reader, fixture.identity.brand_id]);
      await assert.rejects(loadSignalTopicInterestReviewPreparationV1({ ...scope, actor_user_id: reader,
        preparation_id: preparationId }), /topic_interest_review_forbidden/);
      await query("UPDATE users SET status='suspended' WHERE id=$1", [scope.actor_user_id]);
      await assert.rejects(loadSignalTopicInterestReviewPreparationV1({ ...scope, preparation_id: preparationId }), /topic_interest_review_forbidden/);
      await assert.rejects(prepareSignalTopicInterestReviewV1({ ...scope, review, idempotency_key: key }), /topic_interest_review_forbidden/);
    });
    assert.equal((await loadSignalTopicInterestReviewPreparationV1({ ...scope, preparation_id: preparationId })).review_digest, review.review_digest);
  });
  await run(6, async () => isolated(async () => {
    const before = await preparationRows();
    await fixture.saves.saveKnowledge({ database: args.database, scoped: args.scoped, ...fixture.identity,
      source_id: fixture.knowledge_source_id, title: "Changed synthetic knowledge",
      raw_text: "Invented workshop no longer offers repairs; test-only context drift.", idempotency_key: randomUUID() });
    await assert.rejects(loadSignalTopicInterestReviewPreparationV1({ ...scope, preparation_id: preparationId }),
      /(?:topic_interest_review|brand_context)_source_stale/);
    await assert.rejects(prepareSignalTopicInterestReviewV1({ ...scope, review, idempotency_key: key }),
      /(?:topic_interest_review|brand_context)_source_stale/);
    assert.deepEqual(await preparationRows(), before);
  }));
  await run(7, async () => {
    assert.equal((await preparationRows()).length, 1);
    const loaded = await loadSignalTopicInterestReviewPreparationV1({ ...scope, preparation_id: preparationId });
    assert.equal(loaded.review.manifest.approval_policy, "none");
    assert.equal(loaded.provider_execution_enabled, false);
  });
}
