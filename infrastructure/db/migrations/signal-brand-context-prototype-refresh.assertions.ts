import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { SignalWorkspaceTopicPrototypePlanV1 } from "@noisia/query-engine";
import { loadSignalTopicCatalogStoreV1, setSignalTopicLifecycleStoreV1 } from "../signal-topic-catalog";
import { loadSignalWorkspaceTopicPrototypePlanV1 } from "../signal-workspace-topic-prototype-inputs";

type Scope = { client: PoolClient; parent_receipt_id: string; workspace_id: string; actor_user_id: string };
type Quote = { quote_digest: string; quote_snapshot: { pack_digest: string; execution_cap_micro_usd: number;
  refreshes_completed_plan: boolean; requires_provider: boolean; requires_confirmation: boolean } };
const quotePlan = async (args: Scope, plan: SignalWorkspaceTopicPrototypePlanV1) =>
  (await args.client.query<{ value: Quote }>("SELECT quote_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3::jsonb) value",
    [args.parent_receipt_id, args.actor_user_id, JSON.stringify(plan)])).rows[0]!.value;

/** Composable PG assertion; no connection, environment, bootstrap or commit.
 * Caller installs 0161 in an outer rollback and supplies a savepoint-backed Pool
 * facade over client (the existing composed harness contract).
 * Precondition: real published Stage1 + completed Stage2, with at least one
 * manual interest added through createSignalTopicStoreV1 BEFORE that Stage2.
 * Its cache must come from the fake-provider Worker, never inserted here.
 */
export async function assertSignalBrandContextPrototypeRefreshPostgresV1(args: Scope & {
  database: Pool; source_id: string;
}) {
  const { client } = args;
  const scope = { workspace_id: args.workspace_id, actor_user_id: args.actor_user_id };
  const reject = async (work: () => Promise<unknown>, message: string) => {
    await client.query("SAVEPOINT refresh_negative");
    try { await assert.rejects(work, (error: unknown) => error instanceof Error && error.message === message); }
    finally { await client.query("ROLLBACK TO SAVEPOINT refresh_negative"); await client.query("RELEASE SAVEPOINT refresh_negative"); }
  };
  await client.query("SAVEPOINT prototype_refresh_component");
  try {
    const old = (await client.query<{ id: string; run_id: string; plan: SignalWorkspaceTopicPrototypePlanV1;
      quote_digest: string; pack_digest: string; idempotency_key: string; confirmation: string | null }>(`
      SELECT receipt.* FROM signal_brand_context_prototype_receipts receipt
      JOIN signal_workspace_embedding_runs run ON run.id=receipt.run_id
      WHERE receipt.parent_receipt_id=$1::uuid AND run.status='completed'
       AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor WHERE successor.supersedes_receipt_id=receipt.id)`,
    [args.parent_receipt_id])).rows[0];
    assert.ok(old, "fixture requires a real completed Stage2 leaf");
    const beforePlan = await loadSignalWorkspaceTopicPrototypePlanV1({ queryable: client, ...scope });
    assert.equal(beforePlan.plan_digest, old.plan.plan_digest);
    const catalog = await loadSignalTopicCatalogStoreV1({ queryable: client, ...scope });
    const topic = catalog.topics.find(item => item.origin === "manual" && item.lifecycle !== "archived"
      && beforePlan.topics.some(input => input.taxonomy_term_id === item.taxonomy_term_id));
    assert.ok(topic, "create a manual interest before the fixture's first Stage2, then warm its real cache");
    const history = async () => (await client.query<{ value: unknown }>(`SELECT jsonb_build_object(
      'receipt',to_jsonb(receipt),'run',to_jsonb(run),'admission',to_jsonb(admission),
      'calls',(SELECT COALESCE(jsonb_agg(to_jsonb(call) ORDER BY call.id),'[]') FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id),
      'semantic',(SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM signal_semantic_context_proposal_runs s WHERE s.workspace_id=receipt.workspace_id),
      'reservations',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM signal_semantic_context_budget_reservations r WHERE r.workspace_id=receipt.workspace_id)) value
      FROM signal_brand_context_prototype_receipts receipt JOIN signal_workspace_embedding_runs run ON run.id=receipt.run_id
      JOIN signal_processing_admissions admission ON admission.id=receipt.admission_id WHERE receipt.id=$1::uuid`, [old.id])).rows[0]!.value;
    const before = await history();
    const counts = async () => (await client.query<{ receipts: number; admissions: number; runs: number; calls: number }>(`SELECT
      (SELECT count(*)::int FROM signal_brand_context_prototype_receipts WHERE workspace_id=$1::uuid) receipts,
      (SELECT count(*)::int FROM signal_processing_admissions WHERE workspace_id=$1::uuid AND action='topic_prototype_embeddings') admissions,
      (SELECT count(*)::int FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid) runs,
      (SELECT count(*)::int FROM signal_workspace_embedding_calls WHERE workspace_id=$1::uuid) calls`, [args.workspace_id])).rows[0]!;
    const beforeCounts = await counts();
    await reject(() => quotePlan(args, beforePlan), "brand_context_prototype_prior_run_unresolved");
    await setSignalTopicLifecycleStoreV1({ pool: args.database, ...scope, term_key: topic.term_key, lifecycle: "archived",
      expected_definition_revision: topic.definition_revision, expected_definition_digest: topic.definition_digest,
      idempotency_key: `refresh-archive:${randomUUID()}` });
    const plan = await loadSignalWorkspaceTopicPrototypePlanV1({ queryable: client, ...scope });
    assert.notEqual(plan.plan_digest, beforePlan.plan_digest);
    assert.equal(plan.context_digest, beforePlan.context_digest);
    for (const [hash, text] of Object.entries(plan.texts)) assert.equal(beforePlan.texts[hash], text);
    const quoted = await quotePlan(args, plan);
    assert.equal(quoted.quote_snapshot.refreshes_completed_plan, true);
    assert.equal(quoted.quote_snapshot.requires_confirmation, true);
    assert.equal(quoted.quote_snapshot.requires_provider, false);
    assert.equal(Number(quoted.quote_snapshot.execution_cap_micro_usd), 0);
    const key = `refresh-accepted:${randomUUID()}`;
    const authorize = async (confirmation: string | null, requestKey = key, input = plan, q = quoted) =>
      (await client.query<{ value: { run_id: string; replayed: boolean; receipt: { id: string; supersedes_receipt_id: string } } }>(`
        SELECT authorize_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7) value`,
      [args.parent_receipt_id, args.actor_user_id, requestKey, q.quote_snapshot.pack_digest, JSON.stringify(input), q.quote_digest, confirmation])).rows[0]!.value;
    await reject(() => authorize(null), "brand_context_prototype_awaiting_authorization");
    await reject(async () => {
      const changed = await client.query(`UPDATE signal_processing_policy_versions SET status='revoked'
        WHERE id=(SELECT policy.id FROM signal_processing_policy_versions policy JOIN signal_workspaces workspace
          ON workspace.organization_id=policy.organization_id WHERE workspace.id=$1::uuid AND policy.status='active')`, [args.workspace_id]);
      assert.equal(changed.rowCount, 1); return quotePlan(args, plan);
    }, "brand_context_prototype_authorization_expired");
    await reject(async () => {
      const changed = await client.query(`UPDATE brand_knowledge_sources SET raw_text=raw_text||' Synthetic refresh source drift.'
        WHERE id=$1::uuid AND study_corpus_id IS NULL AND brand_id=(SELECT brand_id FROM signal_workspaces WHERE id=$2::uuid)`,
      [args.source_id, args.workspace_id]);
      assert.equal(changed.rowCount, 1); return quotePlan(args, plan);
    }, "brand_context_prototype_publication_required");
    const accepted = await authorize("prepare_brand_context_prototypes_within_shown_cap");
    assert.equal(accepted.replayed, false); assert.equal(accepted.receipt.supersedes_receipt_id, old.id);
    await client.query("SET CONSTRAINTS bc_prototype_receipt_complete IMMEDIATE");
    await client.query("SET CONSTRAINTS bc_prototype_receipt_complete DEFERRED");
    const { executeBrandContextSyntheticPrototypeRunV1 } = await import("./signal-brand-context.synthetic.fixture");
    let sends = 0;
    await executeBrandContextSyntheticPrototypeRunV1({ database: args.database, run_id: accepted.run_id,
      provider: { async embedBatch(): Promise<never> { sends++; throw new Error("complete_cache_must_not_send"); } } });
    assert.equal(sends, 0);
    assert.equal((await client.query("SELECT status FROM signal_workspace_embedding_runs WHERE id=$1::uuid", [accepted.run_id])).rows[0]!.status, "completed");
    const replay = await authorize("prepare_brand_context_prototypes_within_shown_cap");
    assert.equal(replay.replayed, true); assert.equal(replay.run_id, accepted.run_id);
    const historical = await authorize(old.confirmation, old.idempotency_key, old.plan,
      { ...quoted, quote_digest: old.quote_digest, quote_snapshot: { ...quoted.quote_snapshot, pack_digest: old.pack_digest } });
    assert.equal(historical.replayed, true); assert.equal(historical.run_id, old.run_id);
    assert.deepEqual(await history(), before, "previous Voyage and all Claude history remain byte-equivalent");
    assert.deepEqual(await counts(), { receipts: beforeCounts.receipts + 1, admissions: beforeCounts.admissions + 1,
      runs: beforeCounts.runs + 1, calls: beforeCounts.calls });
    return { cases: 9, simulated_provider_calls: sends, prior_bundle_unchanged: true,
      prior_bundle_sha256: createHash("sha256").update(JSON.stringify(before)).digest("hex") };
  } finally { await client.query("ROLLBACK TO SAVEPOINT prototype_refresh_component"); await client.query("RELEASE SAVEPOINT prototype_refresh_component"); }
}

/** Companion negative after the central fake Worker has actually recorded an
 * outcome_unknown child. No transition or paid history is fabricated here. */
export async function assertSignalBrandContextPrototypeRefreshUncertainPostgresV1(args: Scope & {
  run_id: string; plan: SignalWorkspaceTopicPrototypePlanV1;
}) {
  const row = (await args.client.query<{ status: string; unknown: number }>(`SELECT run.status,
    (SELECT count(*)::int FROM signal_workspace_embedding_calls call WHERE call.run_id=run.id AND call.status='outcome_unknown') unknown
    FROM signal_workspace_embedding_runs run JOIN signal_brand_context_prototype_receipts receipt ON receipt.run_id=run.id
    WHERE run.id=$1::uuid AND receipt.parent_receipt_id=$2::uuid AND run.workspace_id=$3::uuid`,
  [args.run_id, args.parent_receipt_id, args.workspace_id])).rows[0];
  assert.equal(row?.status, "outcome_unknown"); assert.ok(row!.unknown > 0);
  await args.client.query("SAVEPOINT refresh_unknown_negative");
  try { await assert.rejects(() => quotePlan(args, args.plan), (error: unknown) =>
    error instanceof Error && error.message === "brand_context_prototype_prior_run_unresolved"); }
  finally { await args.client.query("ROLLBACK TO SAVEPOINT refresh_unknown_negative"); await args.client.query("RELEASE SAVEPOINT refresh_unknown_negative"); }
  return { cases: 1 };
}
