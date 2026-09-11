import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { signalWorkspaceEmbeddingDigestV1, type SignalWorkspaceTopicPrototypePlanV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "../signal-workspace-capabilities";

/** PG assertion component, deliberately no connection/env/bootstrap entry point.
 * The composed 0156 gate must provide a REAL, published automatic generation and
 * its synthetic paid receipt, plus the existing deterministic plan builder's
 * output. This file never manufactures paid history or disables DB triggers.
 * It runs inside the caller's READ COMMITTED outer rollback transaction.
 */
export async function assertSignalBrandContextPrototypeAdmissionPostgresV1(args: {
  client: PoolClient; parent_receipt_id: string; workspace_id: string; actor_user_id: string;
  plan: SignalWorkspaceTopicPrototypePlanV1;
}): Promise<{ cases: number; run_id: string }> {
  const { client } = args;
  const key = `prototype-pg:${randomUUID()}`;
  const quote = async (plan: unknown = args.plan, actor = args.actor_user_id) => (await client.query<{ quote: {
    quote_digest: string; quote_snapshot: { pack_digest: string; requires_provider: boolean; requires_confirmation: boolean };
  } }>("SELECT quote_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3::jsonb) quote",
  [args.parent_receipt_id, actor, JSON.stringify(plan)])).rows[0]!.quote;
  const snapshot = async () => (await client.query<{ snapshot: unknown }>(`SELECT jsonb_build_object(
    'parent',encode(digest((to_jsonb(parent))::text,'sha256'),'hex'),
    'semantic_run',encode(digest((to_jsonb(run))::text,'sha256'),'hex'),
    'semantic_admission',encode(digest((to_jsonb(admission))::text,'sha256'),'hex'),
    'reservation',encode(digest((to_jsonb(reservation))::text,'sha256'),'hex'),
    'elements',(SELECT encode(digest(COALESCE(jsonb_agg(to_jsonb(element) ORDER BY element.id),'[]')::text,'sha256'),'hex')
      FROM signal_semantic_context_element_versions element WHERE element.generation_id=parent.generation_id)) snapshot
    FROM signal_brand_context_processing_receipts parent
    JOIN signal_semantic_context_proposal_runs run ON run.id=parent.semantic_run_id
    JOIN signal_processing_admissions admission ON admission.id=parent.semantic_admission_id
    JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id
    WHERE parent.id=$1::uuid`, [args.parent_receipt_id])).rows[0]!.snapshot;
  const reject = async (work: () => Promise<unknown>, expected: string) => {
    await client.query("SAVEPOINT prototype_negative");
    try {
      await assert.rejects(work, (error: unknown) => error instanceof Error && error.message === expected);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT prototype_negative");
      await client.query("RELEASE SAVEPOINT prototype_negative");
    }
  };
  const counts = async () => (await client.query<{ receipts: number; admissions: number; runs: number; calls: number }>(`SELECT
    (SELECT count(*)::int FROM signal_brand_context_prototype_receipts WHERE workspace_id=$1) receipts,
    (SELECT count(*)::int FROM signal_processing_admissions WHERE workspace_id=$1 AND action='topic_prototype_embeddings') admissions,
    (SELECT count(*)::int FROM signal_workspace_embedding_runs WHERE workspace_id=$1) runs,
    (SELECT count(*)::int FROM signal_workspace_embedding_calls WHERE workspace_id=$1) calls`, [args.workspace_id])).rows[0]!;
  await client.query("SAVEPOINT prototype_composition");
  let resultRunId = "";
  try {
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: args.workspace_id, actor_user_id: args.actor_user_id });
    assert.equal(caps.can_request_processing, true);
    assert.equal(caps.can_execute_topics, false);
    const before = await snapshot();
    const beforeCounts = await counts();
    const quoted = await quote();
    assert.equal(quoted.quote_snapshot.requires_confirmation, false, "initial fixture must have unexpired inherited authority and matching automatic policy");
    assert.equal(quoted.quote_snapshot.requires_provider, true, "paid branch needs at least one genuinely uncached input");
    const authorize = async (requestKey = key, pack = quoted.quote_snapshot.pack_digest, hash = quoted.quote_digest,
      confirmation: string | null = null) =>
      (await client.query<{ result: { replayed: boolean; run_id: string; receipt: { id: string; admission_id: string } } }>(`
        SELECT authorize_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7) result`,
      [args.parent_receipt_id, args.actor_user_id, requestKey, pack, JSON.stringify(args.plan), hash, confirmation])).rows[0]!.result;
    const changed = structuredClone(args.plan);
    const firstText = Object.keys(changed.texts)[0];
    assert.ok(firstText, "fixture must contain at least one real deterministic prototype input");
    changed.texts[firstText] += " changed";
    const { plan_digest: _digest, ...sealed } = changed;
    changed.plan_digest = signalWorkspaceEmbeddingDigestV1(sealed);
    await reject(() => quote(changed), "brand_context_prototype_plan_invalid");
    await reject(() => quote(args.plan, randomUUID()), "processing_forbidden");
    await reject(() => authorize(key, `sha256:${"f".repeat(64)}`), "brand_context_prototype_quote_changed");
    await reject(() => authorize(key, quoted.quote_snapshot.pack_digest, `sha256:${"e".repeat(64)}`), "brand_context_prototype_quote_changed");
    await reject(() => client.query(`INSERT INTO signal_processing_admissions(organization_id,workspace_id,brand_id,actor_user_id,
      policy_version_id,action,target_id,idempotency_key,request_digest,provider,model,configuration,configuration_digest,
      execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest,brand_context_processing_receipt_id)
      SELECT parent.organization_id,parent.workspace_id,parent.brand_id,parent.actor_user_id,parent.policy_version_id,
       'topic_prototype_embeddings',gen_random_uuid(),$2,$3,action.provider,action.model,action.configuration,action.configuration_digest,
       action.max_execution_micro_usd,parent.budget_date,parent.budget_timezone,parent.authorization_not_after,true,'pending',parent.id
      FROM signal_brand_context_processing_receipts parent JOIN signal_processing_policy_actions action
       ON action.policy_version_id=parent.policy_version_id AND action.action='topic_prototype_embeddings' WHERE parent.id=$1::uuid`,
    [args.parent_receipt_id, `${key}:unbound`, `sha256:${"a".repeat(64)}`]), "brand_context_prototype_receipt_required");

    // Exercise the deferred bundle fence directly with a valid quote/plan but no
    // admission or run. This row must never be independently committable.
    await reject(async () => {
      await client.query(`INSERT INTO signal_brand_context_prototype_receipts(id,parent_receipt_id,organization_id,workspace_id,brand_id,actor_user_id,
        generation_id,taxonomy_profile_id,policy_version_id,admission_id,run_id,idempotency_key,request_digest,pack_digest,plan_digest,
        configuration_digest,plan,quote_digest,quote_snapshot,execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,receipt_digest)
        SELECT gen_random_uuid(),parent.id,parent.organization_id,parent.workspace_id,parent.brand_id,parent.actor_user_id,parent.generation_id,
          ($2::jsonb->>'taxonomy_profile_id')::uuid,parent.policy_version_id,gen_random_uuid(),gen_random_uuid(),$3,
          signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','brand-context-prototypes-request-v1',
            'parent_receipt_id',parent.id,'actor_user_id',parent.actor_user_id,'pack_digest',$4::text,'plan',$2::jsonb,'quote_digest',$5::text,'confirmation',NULL)),
          $4,$2::jsonb->>'plan_digest',$6::jsonb->>'configuration_digest',$2::jsonb,$5,$6::jsonb,
          ($6::jsonb->>'execution_cap_micro_usd')::bigint,parent.budget_date,parent.budget_timezone,
          ($6::jsonb->>'admission_not_after')::timestamptz,'pending'
        FROM signal_brand_context_processing_receipts parent WHERE parent.id=$1::uuid`,
      [args.parent_receipt_id, JSON.stringify(args.plan), `${key}:partial`, quoted.quote_snapshot.pack_digest,
        quoted.quote_digest, JSON.stringify(quoted.quote_snapshot)]);
      await client.query("SET CONSTRAINTS bc_prototype_receipt_complete IMMEDIATE");
    }, "brand_context_prototype_atomic_bundle_required");
    assert.deepEqual(await counts(), beforeCounts);

    const accepted = await authorize();
    resultRunId = accepted.run_id;
    assert.equal(accepted.replayed, false);
    await client.query("SET CONSTRAINTS fk_bc_prototype_admission,fk_bc_prototype_run,bc_prototype_receipt_complete IMMEDIATE");
    await client.query("SET CONSTRAINTS fk_bc_prototype_admission,fk_bc_prototype_run,bc_prototype_receipt_complete DEFERRED");
    const bundle = (await client.query<{ pointer: string | null; admission: string; status: string; dispatch: string; plan: unknown }>(`
      SELECT brand_context_preparation_operation_id::text pointer,processing_admission_id::text admission,status,
        dispatch_status dispatch,topic_input_snapshot plan FROM signal_workspace_embedding_runs WHERE id=$1::uuid`, [accepted.run_id])).rows[0]!;
    assert.equal(bundle.pointer, null);
    assert.equal(bundle.admission, accepted.receipt.admission_id);
    assert.equal(bundle.status, "queued");
    assert.equal(bundle.dispatch, "pending");
    assert.deepEqual(bundle.plan, args.plan);
    const afterCounts = await counts();
    assert.deepEqual(afterCounts, { receipts: beforeCounts.receipts + 1, admissions: beforeCounts.admissions + 1,
      runs: beforeCounts.runs + 1, calls: beforeCounts.calls });
    const replay = await authorize();
    assert.equal(replay.replayed, true);
    assert.equal(replay.run_id, accepted.run_id);
    assert.equal(replay.receipt.id, accepted.receipt.id);
    assert.deepEqual(await counts(), afterCounts);
    await reject(() => authorize(`${key}:other`), "brand_context_prototype_prior_run_unresolved");
    await reject(() => authorize(key, `sha256:${"f".repeat(64)}`), "processing_idempotency_conflict");
    await reject(() => client.query("UPDATE signal_brand_context_prototype_receipts SET pack_digest=$2 WHERE id=$1::uuid",
      [accepted.receipt.id, `sha256:${"f".repeat(64)}`]), "brand_context_prototype_receipt_immutable");
    // The queue handoff failed before any call was reserved. This is an allowed
    // DB transition, with no forged provider response, usage or paid history.
    await client.query("UPDATE signal_workspace_embedding_runs SET status='failed',error_code='workspace_embedding_queue_unavailable' WHERE id=$1::uuid", [accepted.run_id]);
    const failedRunBefore = (await client.query<{ digest: string }>("SELECT encode(digest((to_jsonb(run))::text,'sha256'),'hex') digest FROM signal_workspace_embedding_runs run WHERE id=$1::uuid", [accepted.run_id])).rows[0]!.digest;
    const renewedQuote = await quote();
    assert.equal(renewedQuote.quote_snapshot.requires_confirmation, true);
    await reject(() => authorize(`${key}:renew`, renewedQuote.quote_snapshot.pack_digest, renewedQuote.quote_digest), "brand_context_prototype_awaiting_authorization");
    const renewed = await authorize(`${key}:renew`, renewedQuote.quote_snapshot.pack_digest, renewedQuote.quote_digest,
      "prepare_brand_context_prototypes_within_shown_cap");
    assert.notEqual(renewed.run_id, accepted.run_id);
    const predecessor = (await client.query<{ id: string }>("SELECT supersedes_receipt_id::text id FROM signal_brand_context_prototype_receipts WHERE id=$1::uuid", [renewed.receipt.id])).rows[0]!.id;
    assert.equal(predecessor, accepted.receipt.id);
    await client.query("SET CONSTRAINTS fk_bc_prototype_admission,fk_bc_prototype_run,bc_prototype_receipt_complete IMMEDIATE");
    await client.query("SET CONSTRAINTS fk_bc_prototype_admission,fk_bc_prototype_run,bc_prototype_receipt_complete DEFERRED");
    assert.equal((await client.query<{ digest: string }>("SELECT encode(digest((to_jsonb(run))::text,'sha256'),'hex') digest FROM signal_workspace_embedding_runs run WHERE id=$1::uuid", [accepted.run_id])).rows[0]!.digest, failedRunBefore);
    assert.equal((await authorize(`${key}:renew`, renewedQuote.quote_snapshot.pack_digest, renewedQuote.quote_digest,
      "prepare_brand_context_prototypes_within_shown_cap")).run_id, renewed.run_id);
    assert.deepEqual(await snapshot(), before, "the paid parent and its evidence remain byte-identical");
    return { cases: 16, run_id: resultRunId };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT prototype_composition");
    await client.query("RELEASE SAVEPOINT prototype_composition");
  }
}

/** Separate branch for a fixture with genuinely elapsed parent authority and a
 * current automatic policy. The caller must arrange real clock expiry; this
 * assertion never edits a sealed deadline, policy, receipt or provider history.
 */
export async function assertSignalBrandContextPrototypeExpiredAuthorityPostgresV1(args: {
  client: PoolClient; parent_receipt_id: string; actor_user_id: string; plan: SignalWorkspaceTopicPrototypePlanV1;
}) {
  const { client } = args;
  await client.query("SAVEPOINT prototype_expired_authority");
  try {
    const prior = (await client.query<{ expired: boolean; run_digest: string; reservation_digest: string }>(`SELECT
      parent.authorization_not_after<=clock_timestamp() expired,
      encode(digest((to_jsonb(run))::text,'sha256'),'hex') run_digest,
      encode(digest((to_jsonb(reservation))::text,'sha256'),'hex') reservation_digest
      FROM signal_brand_context_processing_receipts parent JOIN signal_semantic_context_proposal_runs run ON run.id=parent.semantic_run_id
      JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id WHERE parent.id=$1::uuid`, [args.parent_receipt_id])).rows[0]!;
    assert.equal(prior.expired, true, "parent authority must have genuinely expired before this branch");
    const quoted = (await client.query<{ quote: { quote_digest: string; quote_snapshot: {
      pack_digest: string; requires_confirmation: boolean; authorization_state: string;
    } } }>("SELECT quote_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3::jsonb) quote",
    [args.parent_receipt_id, args.actor_user_id, JSON.stringify(args.plan)])).rows[0]!.quote;
    assert.equal(quoted.quote_snapshot.requires_confirmation, true);
    assert.equal(quoted.quote_snapshot.authorization_state, "awaiting_authorization");
    const key = `prototype-expiry:${randomUUID()}`;
    const call = async (confirmation: string | null) => (await client.query<{ result: { run_id: string; replayed: boolean } }>(`
      SELECT authorize_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7) result`,
    [args.parent_receipt_id, args.actor_user_id, key, quoted.quote_snapshot.pack_digest, JSON.stringify(args.plan), quoted.quote_digest, confirmation])).rows[0]!.result;
    await client.query("SAVEPOINT prototype_expiry_denial");
    try { await assert.rejects(() => call(null), (error: unknown) => error instanceof Error && error.message === "brand_context_prototype_awaiting_authorization"); }
    finally { await client.query("ROLLBACK TO SAVEPOINT prototype_expiry_denial"); await client.query("RELEASE SAVEPOINT prototype_expiry_denial"); }
    const accepted = await call("prepare_brand_context_prototypes_within_shown_cap");
    assert.equal(accepted.replayed, false);
    await client.query("SET CONSTRAINTS fk_bc_prototype_admission,fk_bc_prototype_run,bc_prototype_receipt_complete IMMEDIATE");
    await client.query("SET CONSTRAINTS fk_bc_prototype_admission,fk_bc_prototype_run,bc_prototype_receipt_complete DEFERRED");
    assert.deepEqual(await call("prepare_brand_context_prototypes_within_shown_cap"), { ...accepted, replayed: true });
    const after = (await client.query<{ run_digest: string; reservation_digest: string }>(`SELECT
      encode(digest((to_jsonb(run))::text,'sha256'),'hex') run_digest,
      encode(digest((to_jsonb(reservation))::text,'sha256'),'hex') reservation_digest
      FROM signal_brand_context_processing_receipts parent JOIN signal_semantic_context_proposal_runs run ON run.id=parent.semantic_run_id
      JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id WHERE parent.id=$1::uuid`, [args.parent_receipt_id])).rows[0]!;
    assert.deepEqual(after, { run_digest: prior.run_digest, reservation_digest: prior.reservation_digest });
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT prototype_expired_authority");
    await client.query("RELEASE SAVEPOINT prototype_expired_authority");
  }
}

/** Input cache must have been produced by real fake-provider receipts upstream;
 * this assertion neither seeds nor edits vectors/calls. It may run with zero
 * remaining daily capacity, proving that cache continuation needs no new money.
 */
export async function assertSignalBrandContextPrototypeCachedPlanPostgresV1(args: {
  client: PoolClient; parent_receipt_id: string; actor_user_id: string; plan: SignalWorkspaceTopicPrototypePlanV1;
}) {
  const { client } = args;
  await client.query("SAVEPOINT prototype_cached_plan");
  try {
    const quote = (await client.query<{ value: { quote_digest: string; quote_snapshot: {
      workspace_id: string; organization_id: string; pack_digest: string; budget_date: string; budget_timezone: string;
      execution_cap_micro_usd: number; estimated_upper_micro_usd: number; requires_provider: boolean; requires_confirmation: boolean;
    } } }>("SELECT quote_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3::jsonb) value",
    [args.parent_receipt_id, args.actor_user_id, JSON.stringify(args.plan)])).rows[0]!.value;
    assert.equal(quote.quote_snapshot.requires_provider, false);
    assert.equal(quote.quote_snapshot.requires_confirmation, false);
    assert.equal(quote.quote_snapshot.execution_cap_micro_usd, 0);
    assert.equal(quote.quote_snapshot.estimated_upper_micro_usd, 0);
    const money = async () => (await client.query<{ exposure: string; calls: number }>(`SELECT total_micro_usd::text exposure,
      (SELECT count(*)::int FROM signal_workspace_embedding_calls WHERE workspace_id=$4::uuid) calls
      FROM signal_processing_org_exposure_v1($1::uuid,$2::date,$3)`, [quote.quote_snapshot.organization_id,
      quote.quote_snapshot.budget_date, quote.quote_snapshot.budget_timezone, quote.quote_snapshot.workspace_id])).rows[0]!;
    const before = await money();
    const result = (await client.query<{ value: { run_id: string; receipt: { admission_id: string } } }>(`
      SELECT authorize_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6) value`,
    [args.parent_receipt_id, args.actor_user_id, `prototype-cache:${randomUUID()}`, quote.quote_snapshot.pack_digest,
      JSON.stringify(args.plan), quote.quote_digest])).rows[0]!.value;
    await client.query("SET CONSTRAINTS fk_bc_prototype_admission,fk_bc_prototype_run,bc_prototype_receipt_complete IMMEDIATE");
    await client.query("SET CONSTRAINTS fk_bc_prototype_admission,fk_bc_prototype_run,bc_prototype_receipt_complete DEFERRED");
    const caps = (await client.query<{ run_cap: string; admission_cap: string; automatic: boolean }>(`SELECT
      run.hard_cap_micro_usd::text run_cap,admission.execution_cap_micro_usd::text admission_cap,admission.automatic
      FROM signal_workspace_embedding_runs run JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id
      WHERE run.id=$1::uuid`, [result.run_id])).rows[0]!;
    assert.deepEqual(caps, { run_cap: "0", admission_cap: "0", automatic: true });
    await client.query("SAVEPOINT prototype_cached_send");
    try {
      await assert.rejects(() => client.query(`SELECT signal_processing_capacity_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,
        ARRAY['topic_prototype_embeddings'],'voyage','voyage-4-large',$5::jsonb,0,'voyage',gen_random_uuid(),1,clock_timestamp())`,
      [quote.quote_snapshot.workspace_id, args.actor_user_id, result.run_id, result.receipt.admission_id, JSON.stringify(args.plan.embedding_profile)]),
      (error: unknown) => error instanceof Error && error.message === "processing_execution_cap_exhausted");
    } finally { await client.query("ROLLBACK TO SAVEPOINT prototype_cached_send"); await client.query("RELEASE SAVEPOINT prototype_cached_send"); }
    assert.deepEqual(await money(), before);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT prototype_cached_plan");
    await client.query("RELEASE SAVEPOINT prototype_cached_plan");
  }
}
