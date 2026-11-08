import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildSignalTopicEditorialBatchPlanFromPreparedInputV2, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 } from "@noisia/query-engine";
import { loadSignalTopicConsolidationEditorialInputV1 } from "../signal-topic-consolidation-editorial-input";
import { quoteSignalTopicEditorialChunkedAdmissionV3, requestSignalTopicEditorialChunkedAdmissionV3 } from "../signal-topic-editorial-admission-v3";
import type { SyntheticTransactionV1 } from "./signal-client-workspace-entry.synthetic.fixture";
import { seedSignalTopicEditorialRenewalSourceV1 } from "./signal-topic-editorial-renewal.synthetic.fixture";

type Identity = { organization_id: string; actor_user_id: string };
export type MassLabelingSiblingEditorialFixtureV1 = Identity & {
  policy_id: string; workspace_id: string; execution_id: string; processing_admission_id: string;
};

/** Synthetic setup only, before the queued owner exists. Copy the current
 * action roster exactly, adding context/numeric/editorial actions needed to
 * exercise the real admission path. Nothing here changes a live owner's policy.
 * The caller owns an isolated invented-data transaction and physical rollback. */
async function prepareSharedSyntheticPolicy(args: SyntheticTransactionV1 & { identity: Identity }) {
  const { query, identity } = args;
  const actor = (await query(`SELECT o.slug,o.legal_name,u.email FROM organizations o JOIN users u ON u.organization_id=o.id
    WHERE o.id=$1 AND u.id=$2 AND u.status='active' AND u.user_type='noisia_internal' AND u.primary_role='noisia_admin'`,
  [identity.organization_id, identity.actor_user_id])).rows[0];
  assert.ok(actor && /^interest-review-[0-9a-f-]+$/u.test(actor.slug)
    && actor.legal_name === "Synthetic editorial renewal organization" && actor.email.endsWith("@example.test"),
  "sibling setup requires the existing invented-data organization and actor");
  const prior = (await query(`SELECT id FROM signal_processing_policy_versions
    WHERE organization_id=$1 AND status='active' AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp()`,
  [identity.organization_id])).rows[0];
  assert.ok(prior, "sibling setup must extend an existing active synthetic base");
  const policy_id = randomUUID();
  await query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,
    budget_timezone,daily_cap_micro_usd,created_by_user_id)
    SELECT $1,organization_id,(SELECT max(version)+1 FROM signal_processing_policy_versions WHERE organization_id=$2),
      'draft',valid_from,valid_until,budget_timezone,
      CASE WHEN daily_cap_micro_usd IS NULL THEN NULL ELSE greatest(daily_cap_micro_usd,100000000) END,$3
    FROM signal_processing_policy_versions WHERE id=$4`,
  [policy_id, identity.organization_id, identity.actor_user_id, prior.id]);
  await query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
    configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
    FROM signal_processing_policy_actions WHERE policy_version_id=$2`, [policy_id, prior.id]);
  // Context authority comes only from this same synthetic organization's history.
  await query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
    configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $1,history.action,history.kind,history.provider,history.model,history.configuration,history.configuration_digest,
      history.max_execution_micro_usd,history.automatic_allowed FROM (
      SELECT DISTINCT ON(a.action) a.* FROM signal_processing_policy_actions a
      JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id
      WHERE p.organization_id=$2 AND a.action IN('brand_context_proposal','topic_prototype_embeddings')
      ORDER BY a.action,p.version DESC
    ) history WHERE NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions current
      WHERE current.policy_version_id=$1 AND current.action=history.action)`, [policy_id, identity.organization_id]);
  // The source fixture uses a finite 30M editorial admission. This is setup
  // capacity, before any queued sibling, not a change to an owned admission.
  for (const [action, provider, model, configuration, cap] of [
    ["corpus_embeddings", "voyage", "voyage-4-large", SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, 1_000_000],
    ["topic_interpretation", "anthropic", SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1.model,
      SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1, 30_000_000],
  ] as const) {
    await query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
      configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,$2,'provider',$3,$4,$5::jsonb,signal_semantic_context_digest_json_v2($5::jsonb),$6,false
      WHERE NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action=$2)`,
    [policy_id, action, provider, model, JSON.stringify(configuration), cap]);
  }
  for (const [action, configuration, kind, provider, model, cap] of [
    ["topic_consolidation_numeric", "signal_topic_consolidation_numeric_configuration_v1()", "free", null, null, 0],
    ["topic_consolidation", "signal_topic_editorial_configuration_v2()", "provider", "anthropic", "claude-sonnet-4-6", 1_000_000],
  ] as const) {
    // Function names are the two static synthetic configuration literals above.
    await query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
      configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,$2,$3,$4,$5,configuration,signal_semantic_context_digest_json_v2(configuration),$6,false
      FROM (SELECT ${configuration} configuration) config
      WHERE NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action=$2)`,
    [policy_id, action, kind, provider, model, cap]);
  }
  const preserved = (await query(`SELECT NOT EXISTS(
    SELECT to_jsonb(a)-'policy_version_id' FROM signal_processing_policy_actions a WHERE policy_version_id=$1
    EXCEPT SELECT to_jsonb(a)-'policy_version_id' FROM signal_processing_policy_actions a WHERE policy_version_id=$2
  ) ok`, [prior.id, policy_id])).rows[0];
  assert.equal(preserved?.ok, true, "shared synthetic policy retains every previous action and limit exactly");
  await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [prior.id]);
  await query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policy_id]);
  return policy_id;
}

/** Queue a genuine editorial owner in a different workspace of the same
 * synthetic organization. Real source, quote, admission, request and deferred
 * guards run; no provider transport or monetary call is created. Capture the
 * baseline AFTER this setup, before testing any scoped JEV authorization. */
export async function seedMassLabelingSiblingEditorialV1(
  args: SyntheticTransactionV1 & { identity: Identity },
): Promise<MassLabelingSiblingEditorialFixtureV1> {
  const { query, identity } = args;
  assert.equal((await query("SHOW transaction_isolation")).rows[0]?.transaction_isolation, "read committed");
  const policy_id = await prepareSharedSyntheticPolicy(args);
  // Nested COMMIT is a savepoint release in this rollback-only harness. The
  // first completed fixture therefore retains ON COMMIT DROP scratch tables.
  // Drop only these consumed pg_temp objects, never persistent source/history.
  await query(`DROP TABLE IF EXISTS pg_temp.corpus_preparation_snapshot_sources,
    pg_temp.corpus_preparation_snapshot_roots,pg_temp.signal_topic_centroid_memberships_tmp,
    pg_temp.signal_topic_centroids_tmp`);
  const seed = await seedSignalTopicEditorialRenewalSourceV1({ ...args,
    identity, defer_numeric_policy_activation: true });
  const input = await loadSignalTopicConsolidationEditorialInputV1(seed.scope);
  const plan = buildSignalTopicEditorialBatchPlanFromPreparedInputV2({ input, run_id: seed.scope.numeric_run_id });
  const access = { database: args.database, workspace_id: seed.identity.workspace_id, actor_user_id: identity.actor_user_id };
  const quote = await quoteSignalTopicEditorialChunkedAdmissionV3({ ...access, plan,
    deadline: Math.floor(Date.now() / 1000) + 1800 });
  assert.equal(quote.status, "ready_to_authorize");
  assert.ok(quote.quote_reference);
  const admitted = await requestSignalTopicEditorialChunkedAdmissionV3({ ...access, plan,
    idempotency_key: `synthetic-mass-sibling-${randomUUID()}`, quote_reference: quote.quote_reference });
  await query("SET CONSTRAINTS ALL IMMEDIATE");
  await query("SET CONSTRAINTS ALL DEFERRED");
  const owner = (await query(`SELECT e.processing_admission_id,e.status,a.policy_version_id,
    a.admission_not_after>clock_timestamp() admission_valid,e.execution_token,e.attempt_count
    FROM signal_topic_editorial_executions e JOIN signal_processing_admissions a ON a.workspace_id=e.workspace_id
      AND a.id=e.processing_admission_id WHERE e.id=$1 AND e.workspace_id=$2`,
  [admitted.execution_id, access.workspace_id])).rows[0];
  assert.ok(owner);
  assert.deepEqual({ status: owner.status, policy_id: owner.policy_version_id, admission_valid: owner.admission_valid,
    execution_token: owner.execution_token, attempt_count: owner.attempt_count },
  { status: "queued", policy_id, admission_valid: true, execution_token: null, attempt_count: 0 });
  assert.equal((await query("SELECT count(*)::int n FROM signal_topic_editorial_calls WHERE execution_id=$1",
    [admitted.execution_id])).rows[0]?.n, 0, "the sibling is authorized but no provider work is reserved or sent");
  return { ...identity, policy_id, workspace_id: access.workspace_id, execution_id: admitted.execution_id,
    processing_admission_id: owner.processing_admission_id };
}

/** Complete JSON rows, scoped to the base authority and sibling owner. Comparing
 * these snapshots detects any field update, insertion or deletion, including
 * empty historical transport/queue sets. No observation timestamp is added. */
export async function snapshotMassLabelingSiblingAuthorityV1(
  args: Pick<SyntheticTransactionV1, "query"> & MassLabelingSiblingEditorialFixtureV1,
) {
  const { query } = args;
  const rows = async (table: string, predicate: string, params: unknown[]) => (await query(
    `SELECT to_jsonb(item) body FROM ${table} item WHERE ${predicate} ORDER BY to_jsonb(item)::text`, params,
  )).rows.map(row => row.body);
  // Identifiers and predicates are exclusively the static literals below.
  return {
    policy: await rows("signal_processing_policy_versions", "id=$1 AND organization_id=$2", [args.policy_id, args.organization_id]),
    actions: await rows("signal_processing_policy_actions", "policy_version_id=$1", [args.policy_id]),
    admission: await rows("signal_processing_admissions", "id=$1 AND workspace_id=$2", [args.processing_admission_id, args.workspace_id]),
    execution: await rows("signal_topic_editorial_executions", "id=$1 AND workspace_id=$2", [args.execution_id, args.workspace_id]),
    batch_owner: await rows("signal_topic_editorial_batch_owners_v2", "execution_id=$1 AND workspace_id=$2", [args.execution_id, args.workspace_id]),
    outbox: await rows("signal_topic_editorial_outbox", "execution_id=$1 AND workspace_id=$2", [args.execution_id, args.workspace_id]),
    requests: await rows("signal_topic_editorial_requests", "execution_id=$1 AND workspace_id=$2", [args.execution_id, args.workspace_id]),
    calls: await rows("signal_topic_editorial_calls", "execution_id=$1 AND workspace_id=$2", [args.execution_id, args.workspace_id]),
    provider_batches: await rows("signal_topic_editorial_provider_batches_v2",
      "execution_id=$1 AND EXISTS(SELECT 1 FROM signal_topic_editorial_executions e WHERE e.id=item.execution_id AND e.workspace_id=$2)", [args.execution_id, args.workspace_id]),
    start_intents: await rows("signal_topic_editorial_start_intents_v2", "execution_id=$1 AND workspace_id=$2", [args.execution_id, args.workspace_id]),
  };
}
