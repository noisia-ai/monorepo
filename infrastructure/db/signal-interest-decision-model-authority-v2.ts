import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { signalWorkspaceClassificationIdentitySchemaV1 } from "@noisia/query-engine";
import {
  loadSignalWorkspaceClassificationInputV1,
  type SignalWorkspaceClassificationDatabaseV1,
} from "./signal-workspace-classification";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const termKey = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const requestKey = /^[A-Za-z0-9._:-]{8,200}$/u;
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

type Scope = { workspace_id: string; actor_user_id: string; interest_term_key: string;
  idempotency_key: string; database: SignalWorkspaceClassificationDatabaseV1 };
type Bootstrap = { model_version_id: string; prepublication_receipt_id: string;
  registry_key: string; replayed: boolean };
type Receipt = { model_version_id: string; prepublication_receipt_id: string;
  registry_key: string; taxonomy_profile_id: string; interest_term_key: string;
  identity: unknown; receipt_digest: string; replayed: boolean };

function fail(code: string): never { throw Object.assign(new Error(code), { code, status: 409 }); }

/** Every lifecycle stage commits separately. SQL0087 uses transaction-start
 * timestamps for event order and for policy approval, so combining stages in
 * one transaction would make their authority order ambiguous. */
async function stage<T>(scope: Scope, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await scope.database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    await client.query("SELECT signal_processing_lock_actor_v1($1::uuid,$2::uuid,false)",
      [scope.workspace_id, scope.actor_user_id]);
    const allowed = (await client.query<{ allowed: boolean }>(`SELECT
      (signal_workspace_classification_actor_v1($1::uuid,$2::uuid)
       OR signal_processing_actor_v1($1::uuid,$2::uuid)) allowed`,
      [scope.workspace_id, scope.actor_user_id])).rows[0]?.allowed;
    if (!allowed) fail("interest_decision_model_authority_forbidden");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** Register one current explicit interest against an already approved platform
 * benchmark. The client supplies only scope and a replay key. This function
 * never creates a benchmark, paid admission, provider call, or generation. */
export async function bootstrapSignalInterestDecisionModelAuthorityV2(scope: Scope) {
  if (!uuid.test(scope.workspace_id) || !uuid.test(scope.actor_user_id)
    || !termKey.test(scope.interest_term_key) || !requestKey.test(scope.idempotency_key))
    fail("interest_decision_model_authority_request_invalid");
  const key = sha(scope.idempotency_key);
  const receipt = await stage(scope, async client => {
    // An ambiguous response must recover the original identity, even if the
    // brand context or interest definition changed after registration.
    const prior = (await client.query<Receipt>(`SELECT receipt.model_version_id::text,
      receipt.id::text prepublication_receipt_id,receipt.taxonomy_profile_id::text,
      receipt.interest_term_key,receipt.receipt_digest,
      model.model_key registry_key,
      model.configuration->'workspace_classification_identity' identity
      FROM signal_interest_decision_model_bootstrap_keys_v1 bootstrap
      JOIN signal_interest_decision_prepublication_evaluations_v1 receipt
       ON receipt.id=bootstrap.prepublication_receipt_id
      JOIN tagging_model_versions model ON model.id=receipt.model_version_id
      WHERE bootstrap.workspace_id=$1::uuid AND bootstrap.actor_user_id=$2::uuid
       AND bootstrap.idempotency_key=$3`,
      [scope.workspace_id, scope.actor_user_id, key])).rows[0];
    if (prior) {
      if (prior.interest_term_key !== scope.interest_term_key)
        fail("processing_idempotency_conflict");
      const priorIdentity = signalWorkspaceClassificationIdentitySchemaV1.safeParse(prior.identity);
      if (!priorIdentity.success || priorIdentity.data.engine_key !== "interest_decision")
        fail("interest_decision_model_authority_receipt_invalid");
      if (priorIdentity.data.engine_version === 1)
        fail("interest_decision_v1_bootstrap_replay_required");
      if (priorIdentity.data.engine_version !== 2)
        fail("interest_decision_model_authority_receipt_invalid");
      return { ...prior, replayed: true };
    }
    const input = await loadSignalWorkspaceClassificationInputV1({ queryable: client,
      workspace_id: scope.workspace_id, actor_user_id: scope.actor_user_id,
      interest_term_key: scope.interest_term_key });
    if (input.topics.length !== 1 || !uuid.test(input.taxonomy_profile_id))
      fail("interest_decision_model_authority_interest_unavailable");
    const benchmark = (await client.query<{ id: string; thresholds_digest: string;
      model_digest: string }>(`SELECT benchmark.id::text,benchmark.thresholds_digest,
       signal_interest_decision_model_digest_v2() model_digest
      FROM signal_interest_decision_platform_benchmarks_v1 benchmark
      WHERE benchmark.model_artifact_digest=signal_interest_decision_model_digest_v2()
       AND benchmark.provider_config_digest=signal_semantic_context_digest_json_v2(
        signal_interest_decision_provider_config_v2())
       AND benchmark.prompt_digest=signal_interest_decision_provider_config_v2()->>'prompt_digest'
       AND benchmark.approved_at<=clock_timestamp()
      ORDER BY benchmark.version DESC,benchmark.approved_at DESC,benchmark.id DESC LIMIT 1`)).rows[0];
    if (!benchmark) fail("interest_decision_platform_benchmark_required");
    const identity = signalWorkspaceClassificationIdentitySchemaV1.parse({
      contract_version: "signal-workspace-classification-v1",
      workspace_id: scope.workspace_id, engine_key: "interest_decision", engine_version: 2,
      engine_artifact_digest: benchmark.model_digest,
      embedding_config_digest: input.embedding_config_digest,
      catalog_digest: input.catalog_digest, compiler_digest: input.compiler_digest,
      context_digest: input.context_digest,
      decision_policy_digest: benchmark.thresholds_digest,
    });
    const result = (await client.query<{ result: Bootstrap }>(`SELECT
      register_signal_interest_decision_model_v2($1::uuid,$2::uuid,$3::text,$4::jsonb,
       $5::uuid,$6::uuid,$7::text) result`,
      [scope.workspace_id, input.taxonomy_profile_id, scope.interest_term_key,
        JSON.stringify(identity), benchmark.id, scope.actor_user_id, key])).rows[0]?.result;
    if (!result || !uuid.test(result.model_version_id)
      || !uuid.test(result.prepublication_receipt_id))
      fail("interest_decision_model_authority_receipt_invalid");
    const detail = (await client.query<Receipt>(`SELECT receipt.model_version_id::text,
      receipt.id::text prepublication_receipt_id,receipt.taxonomy_profile_id::text,
      receipt.interest_term_key,receipt.receipt_digest,
      model.model_key registry_key,
      model.configuration->'workspace_classification_identity' identity
      FROM signal_interest_decision_prepublication_evaluations_v1 receipt
      JOIN tagging_model_versions model ON model.id=receipt.model_version_id
      WHERE receipt.id=$1::uuid`, [result.prepublication_receipt_id])).rows[0];
    if (!detail || detail.model_version_id !== result.model_version_id)
      fail("interest_decision_model_authority_receipt_invalid");
    return { ...detail, replayed: result.replayed };
  });
  const identity = signalWorkspaceClassificationIdentitySchemaV1.parse(receipt.identity);
  if (identity.workspace_id !== scope.workspace_id || identity.engine_key !== "interest_decision"
    || identity.engine_version !== 2 || !uuid.test(receipt.taxonomy_profile_id))
    fail("interest_decision_model_authority_receipt_invalid");

  const evaluated = await stage(scope, async client => (await client.query<{ created: boolean }>(
    `SELECT created FROM transition_signal_interest_decision_model_evaluated_v2(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text)`,
    [scope.workspace_id, receipt.model_version_id, receipt.prepublication_receipt_id,
      scope.actor_user_id, sha(`${key}:evaluated`)])).rows[0]);
  if (!evaluated) fail("interest_decision_model_authority_transition_invalid");

  const approved = await stage(scope, async client => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended(
      $1::text||':tagging-model-transition:'||$2::text,0))`,
    [scope.workspace_id, receipt.model_version_id]);
    const state = (await client.query<{ status: string; evidence_digest: string;
      evaluated_receipt_id: string | null }>(`SELECT event.status,event.evidence_digest,
      (SELECT prior.prepublication_receipt_id::text FROM signal_tagging_model_version_events prior
       WHERE prior.workspace_id=event.workspace_id AND prior.model_version_id=event.model_version_id
        AND prior.status='evaluated' ORDER BY prior.created_at DESC,prior.id DESC LIMIT 1)
       evaluated_receipt_id
      FROM signal_tagging_model_version_events event
      WHERE event.workspace_id=$1::uuid AND event.model_version_id=$2::uuid
      ORDER BY event.created_at DESC,event.id DESC LIMIT 1`,
    [scope.workspace_id, receipt.model_version_id])).rows[0];
    if (!state || state.evaluated_receipt_id !== receipt.prepublication_receipt_id)
      fail("interest_decision_model_authority_transition_invalid");
    if (state.status === "approved") {
      if (state.evidence_digest !== receipt.receipt_digest)
        fail("interest_decision_model_authority_transition_invalid");
      return { created: false };
    }
    if (state.status !== "evaluated")
      fail("interest_decision_model_authority_transition_invalid");
    return (await client.query<{ created: boolean }>(
      `SELECT created FROM transition_signal_tagging_model_v1($1::uuid,$2::uuid,
        'approved',NULL,clock_timestamp(),$3::text,$4::uuid,$5::text,$6::text)`,
      [scope.workspace_id, receipt.model_version_id, receipt.receipt_digest,
        scope.actor_user_id, sha(`${key}:approved`),
        sha(`interest-decision-approved:${receipt.model_version_id}:${receipt.prepublication_receipt_id}:${scope.actor_user_id}`)])).rows[0];
  });
  if (!approved) fail("interest_decision_model_authority_transition_invalid");

  const policy = await stage(scope, async client => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended(
      $1::text||':classification-policy:'||$2::text,0))`,
    [scope.workspace_id, receipt.registry_key]);
    const prior = (await client.query<{ approval_policy_id: string;
      taxonomy_profile_id: string; authority_kind: string; model_version_id: string;
      definition_hash: string; status: string; effective_to: string | null }>(`SELECT
      id::text approval_policy_id,taxonomy_profile_id::text,authority_kind,
      model_version_id::text,definition_hash,status,effective_to::text
      FROM signal_classification_approval_policies
      WHERE workspace_id=$1::uuid AND policy_key=$2::text AND version=1 FOR UPDATE`,
    [scope.workspace_id, receipt.registry_key])).rows[0];
    if (prior) {
      if (prior.taxonomy_profile_id !== receipt.taxonomy_profile_id
        || prior.authority_kind !== "model"
        || prior.model_version_id !== receipt.model_version_id
        || prior.definition_hash !== identity.decision_policy_digest
        || prior.status !== "approved" || prior.effective_to !== null)
        fail("interest_decision_model_authority_policy_invalid");
      return { approval_policy_id: prior.approval_policy_id, created: false };
    }
    return (await client.query<{ approval_policy_id: string; created: boolean }>(
      `SELECT approval_policy_id::text,created
      FROM register_signal_classification_approval_policy_v1($1::uuid,$2::uuid,$3::text,
       1,'model',NULL,$4::uuid,NULL,$5::text,'approved',clock_timestamp(),NULL,NULL,
       $6::uuid,$7::text,$8::text)`,
      [scope.workspace_id, receipt.taxonomy_profile_id, receipt.registry_key,
        receipt.model_version_id, identity.decision_policy_digest, scope.actor_user_id,
        sha(`${key}:policy`),
        sha(`interest-decision-policy:${receipt.model_version_id}:${identity.decision_policy_digest}:${scope.actor_user_id}`)])).rows[0];
  });
  if (!policy || !uuid.test(policy.approval_policy_id))
    fail("interest_decision_model_authority_policy_invalid");
  return { model_version_id: receipt.model_version_id,
    prepublication_receipt_id: receipt.prepublication_receipt_id,
    approval_policy_id: policy.approval_policy_id,
    replayed: receipt.replayed && !evaluated.created && !approved.created && !policy.created };
}
