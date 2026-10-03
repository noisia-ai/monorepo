import {
  beginSignalWorkspaceClassificationWithClientV1,
  bootstrapSignalInterestDecisionModelAuthorityV2,
  loadSignalWorkspaceClassificationInputV1,
} from "@noisia/db";
import { signalWorkspaceClassificationIdentitySchemaV1,
  type SignalWorkspaceClassificationIdentityV1 } from "@noisia/query-engine";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { startDefinedInterestDecisionSelfServiceV1 } from "./signal-defined-interest-decision";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const term = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const key = /^[A-Za-z0-9._:-]{8,200}$/u;
const digest = /^sha256:[0-9a-f]{64}$/u;
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const fail = (code: string, status = 409): never => {
  throw Object.assign(new Error(code), { code, status });
};

type Scope = { workspace_id: string; actor_user_id: string; term_key: string };
type Source = { id: string; embedding_run_id: string };
type Authority = { identity: unknown; definition_hash: string };
type Receipt = { owner_id: string; generation_id: string; expected_roots: number; replayed: boolean };
type Environment = Readonly<Record<string, string | undefined>>;

export function definedInterestDecisionV2Enabled(env: Environment = process.env) {
  return env.NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED === "true";
}

function assertScope(scope: Scope, idempotencyKey?: string) {
  if (!uuid.test(scope.workspace_id) || !uuid.test(scope.actor_user_id) || !term.test(scope.term_key)
    || idempotencyKey !== undefined && !key.test(idempotencyKey)) fail("interest_decision_request_invalid", 422);
}

/** Server-only identity. A client never supplies model authority, a source
 * execution, an estimate, a corpus slice, or a provider request. */
async function currentSourceAndAuthority(client: PoolClient, scope: Scope): Promise<{
  source: Source; identity: SignalWorkspaceClassificationIdentityV1;
}> {
  const input = await loadSignalWorkspaceClassificationInputV1({ queryable: client,
    workspace_id: scope.workspace_id, actor_user_id: scope.actor_user_id,
    interest_term_key: scope.term_key });
  if (input.topics.length !== 1 || !uuid.test(input.taxonomy_profile_id))
    fail("interest_decision_definition_unavailable");
  const sources = (await client.query<Source>(`SELECT source.id::text,source.embedding_run_id::text
    FROM signal_topic_catalog_executions source
    JOIN signal_corpus_preparation_input_state state ON state.workspace_id=source.workspace_id
    WHERE source.workspace_id=$1::uuid AND source.taxonomy_profile_id=$2::uuid
      AND source.input_contract='workspace-topic-computation-v1' AND source.status='ready'
      AND source.processed_roots=source.denominator AND source.processed_chunks=source.expected_chunks
      AND source.input_revision=state.input_revision AND source.input_snapshot->>'context_digest'=$3
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(source.input_snapshot->'topics') topic
        WHERE topic->'definition'->>'term_key'=$4
          AND topic->'definition'->>'definition_digest'=$5)
    ORDER BY source.created_at DESC,source.id DESC LIMIT 1`, [scope.workspace_id,
    input.taxonomy_profile_id,input.context_digest,scope.term_key,input.topics[0]!.definition.definition_digest])).rows;
  const source = sources[0];
  if (!source || !uuid.test(source.id) || !uuid.test(source.embedding_run_id))
    return fail("interest_decision_analysis_required");
  const authorities = (await client.query<Authority>(`SELECT model.configuration->'workspace_classification_identity' identity,
      policy.definition_hash
    FROM tagging_model_versions model
    JOIN signal_classification_approval_policies policy ON policy.model_version_id=model.id
      AND policy.workspace_id=$1::uuid AND policy.taxonomy_profile_id=$2::uuid
      AND policy.authority_kind='model' AND policy.status='approved'
      AND policy.effective_from<=clock_timestamp()
      AND (policy.effective_to IS NULL OR policy.effective_to>clock_timestamp())
    JOIN signal_interest_decision_platform_benchmarks_v1 benchmark
      ON benchmark.id::text=model.configuration->>'platform_benchmark_id'
    WHERE model.provider='anthropic' AND model.taxonomy_profile_id=$2::uuid
      AND model.configuration->'provider_config'->>'contract_version'='signal-workspace-interest-decision-provider-config-v2'
      AND model.configuration->'provider_config'->>'model'='claude-sonnet-4-6'
      AND model.configuration->'provider_config'->>'transport'='message_batches'
      AND model.configuration->'provider_config'=signal_interest_decision_provider_config_v2()
      AND model.artifact_digest=signal_interest_decision_model_digest_v2()
      AND model.configuration->'workspace_classification_identity'->>'workspace_id'=$1::text
      AND model.configuration->'workspace_classification_identity'->>'catalog_digest'=$3
      AND model.configuration->'workspace_classification_identity'->>'compiler_digest'=$4
      AND model.configuration->'workspace_classification_identity'->>'embedding_config_digest'=$5
      AND model.configuration->'workspace_classification_identity'->>'context_digest'=$6
      AND model.configuration->'workspace_classification_identity'->>'decision_policy_digest'=policy.definition_hash
      AND model.artifact_digest=model.configuration->'workspace_classification_identity'->>'engine_artifact_digest'
      AND model.dataset_digest=benchmark.dataset_digest AND model.gold_set_digest=benchmark.labels_digest
      AND benchmark.model_artifact_digest=model.artifact_digest
      AND benchmark.prompt_digest=model.configuration->'provider_config'->>'prompt_digest'
      AND (SELECT event.status FROM signal_tagging_model_version_events event
        WHERE event.workspace_id=$1::uuid AND event.model_version_id=model.id
          AND event.effective_at<=clock_timestamp()
        ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1)='approved'
    ORDER BY policy.effective_from DESC,policy.id DESC LIMIT 1`, [scope.workspace_id,input.taxonomy_profile_id,
    input.catalog_digest,input.compiler_digest,input.embedding_config_digest,input.context_digest])).rows;
  if (!authorities.length) return fail("interest_decision_model_authority_required");
  const identity = signalWorkspaceClassificationIdentitySchemaV1.safeParse(authorities[0]!.identity);
  if (!identity.success || identity.data.workspace_id !== scope.workspace_id
    || identity.data.engine_key !== "interest_decision" || identity.data.engine_version !== 2
    || identity.data.catalog_digest !== input.catalog_digest
    || identity.data.compiler_digest !== input.compiler_digest
    || identity.data.embedding_config_digest !== input.embedding_config_digest
    || identity.data.context_digest !== input.context_digest
    || identity.data.decision_policy_digest !== authorities[0]!.definition_hash
    || !digest.test(identity.data.engine_artifact_digest)) return fail("interest_decision_model_authority_stale");
  return { source, identity: identity.data };
}

/** One transaction: if admission/policy fails, no orphan queued generation
 * remains. The Worker later resumes manifest preparation by durable owner ID. */
export async function startDefinedInterestDecisionProductV2(scope: Scope, idempotencyKey: string,
  database?: Pick<Pool, "connect">, env?: Environment) {
  if (!definedInterestDecisionV2Enabled(env)) fail("interest_decision_v2_unavailable", 503);
  assertScope(scope, idempotencyKey);
  const pool = database ?? (await import("@/lib/db")).pool;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    // The original transaction creates the generation and admission atomically.
    // On an ambiguous HTTP response, recover that exact receipt before inspecting
    // today's corpus/model. Those inputs may have changed since the paid request.
    const prior = (await client.query<{ generation_id: string; source_execution_id: string;
      execution_id: string; term_key: string; provider_contract_version: number }>(`SELECT owner.generation_id::text,owner.source_execution_id::text,
        execution.id::text execution_id,owner.term_key,owner.provider_contract_version
      FROM signal_interest_decision_request_keys_v1 request
      JOIN signal_interest_decision_owners_v1 owner ON owner.id=request.owner_id
        AND owner.workspace_id=request.workspace_id
      JOIN signal_topic_catalog_executions execution ON execution.generation_id=owner.generation_id
        AND execution.workspace_id=owner.workspace_id
        AND execution.input_contract='workspace-topic-classification-v1'
      WHERE request.workspace_id=$1::uuid AND request.actor_user_id=$2::uuid
        AND request.idempotency_key=$3`, [scope.workspace_id,scope.actor_user_id,idempotencyKey])).rows[0];
    if (prior) {
      if (prior.term_key !== scope.term_key) return fail("processing_idempotency_conflict");
      if (prior.provider_contract_version !== 1 && prior.provider_contract_version !== 2)
        return fail("interest_decision_admission_receipt_invalid");
      const rows = (await client.query<{ result: Receipt }>(
        `SELECT ${prior.provider_contract_version === 1
          ? "request_signal_interest_decision_v1" : "request_signal_interest_decision_v2"}
          ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text) result`,
        [scope.workspace_id,scope.actor_user_id,prior.generation_id,prior.source_execution_id,idempotencyKey])).rows;
      const receipt = rows[0]?.result;
      if (!receipt || !uuid.test(receipt.owner_id) || receipt.generation_id !== prior.generation_id)
        return fail("interest_decision_admission_receipt_invalid");
      await client.query("COMMIT");
      return { ...receipt, execution_id: prior.execution_id, replayed: true };
    }
    // A historical V1 bootstrap key may exist without a paid owner. Preserve
    // that exact path before a new V2 generation can consume the client key.
    const bootstrap = (await client.query<{ interest_term_key: string; identity: unknown }>(`SELECT
      receipt.interest_term_key,model.configuration->'workspace_classification_identity' identity
      FROM signal_interest_decision_model_bootstrap_keys_v1 key
      JOIN signal_interest_decision_prepublication_evaluations_v1 receipt
        ON receipt.id=key.prepublication_receipt_id
      JOIN tagging_model_versions model ON model.id=receipt.model_version_id
      WHERE key.workspace_id=$1::uuid AND key.actor_user_id=$2::uuid
        AND key.idempotency_key=$3::text`,
    [scope.workspace_id,scope.actor_user_id,sha(idempotencyKey)])).rows[0];
    if (bootstrap) {
      if (bootstrap.interest_term_key !== scope.term_key) return fail("processing_idempotency_conflict");
      const identity = signalWorkspaceClassificationIdentitySchemaV1.safeParse(bootstrap.identity);
      if (!identity.success || identity.data.engine_key !== "interest_decision")
        return fail("interest_decision_model_authority_stale");
      if (identity.data.engine_version === 1) return fail("interest_decision_v1_bootstrap_replay_required");
      if (identity.data.engine_version !== 2) return fail("interest_decision_model_authority_stale");
    }
    const { source, identity } = await currentSourceAndAuthority(client, scope);
    const generation = await beginSignalWorkspaceClassificationWithClientV1(client, {
      workspace_id: scope.workspace_id, actor_user_id: scope.actor_user_id,
      idempotency_key: idempotencyKey, embedding_run_id: source.embedding_run_id,
      identity, interest_term_key: scope.term_key });
    const rows = (await client.query<{ result: Receipt }>(
      "SELECT request_signal_interest_decision_v2($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text) result",
      [scope.workspace_id,scope.actor_user_id,generation.generation_id,source.id,idempotencyKey])).rows;
    const receipt = rows[0]?.result;
    if (!receipt || !uuid.test(receipt.owner_id) || receipt.generation_id !== generation.generation_id
      || !Number.isSafeInteger(receipt.expected_roots) || receipt.expected_roots < 1)
      return fail("interest_decision_admission_receipt_invalid");
    await client.query("COMMIT");
    return { ...receipt, execution_id: generation.execution_id,
      replayed: generation.replayed && receipt.replayed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Error && ["interest_decision_policy_required",
      "interest_decision_model_authority_required", "interest_decision_source_stale",
      "interest_decision_request_key_invalid", "processing_idempotency_conflict"].includes(error.message))
      return fail(error.message);
    throw error;
  } finally { client.release(); }
}

/** Replay the paid receipt first. Only a genuinely new request may bootstrap
 * model authority, and that bootstrap never creates provider work or money.
 * This order matters when the HTTP response was lost and Brand OS changed. */
export async function startDefinedInterestDecisionSelfServiceV2(scope: Scope, idempotencyKey: string,
  options: { database?: Pool;
    bootstrap?: typeof bootstrapSignalInterestDecisionModelAuthorityV2;
    attempt?: typeof startDefinedInterestDecisionProductV2;
    legacy?: typeof startDefinedInterestDecisionSelfServiceV1; env?: Environment } = {}) {
  if (!definedInterestDecisionV2Enabled(options.env)) fail("interest_decision_v2_unavailable", 503);
  const attempt = options.attempt ?? startDefinedInterestDecisionProductV2;
  try { return await attempt(scope, idempotencyKey, options.database, options.env); }
  catch (error) {
    if (error instanceof Error && error.message === "interest_decision_v1_bootstrap_replay_required")
      return (options.legacy ?? startDefinedInterestDecisionSelfServiceV1)(scope, idempotencyKey,
        { database: options.database });
    if (!(error instanceof Error && error.message === "interest_decision_model_authority_required")) throw error;
  }
  const database = options.database ?? (await import("@/lib/db")).pool;
  try {
    await (options.bootstrap ?? bootstrapSignalInterestDecisionModelAuthorityV2)({
      workspace_id: scope.workspace_id, actor_user_id: scope.actor_user_id,
      interest_term_key: scope.term_key, idempotency_key: idempotencyKey, database
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === "interest_decision_v1_bootstrap_replay_required")) throw error;
    return (options.legacy ?? startDefinedInterestDecisionSelfServiceV1)(scope, idempotencyKey,
      { database });
  }
  return attempt(scope, idempotencyKey, database, options.env);
}

/** Read progress without exposing request bodies or provider receipts. */
export async function loadDefinedInterestDecisionProductV2(scope: Scope) {
  assertScope(scope);
  const { pool } = await import("@/lib/db");
  const result = await pool.query<{ result: Record<string, unknown> }>(`SELECT
    signal_interest_decision_status_v1(owner.id,$2::uuid)||jsonb_build_object(
      'classification_status',execution.status,
      'classification_processed_roots',execution.processed_roots,
      'classification_total_roots',execution.denominator,
      'classification_error_code',execution.error_code,
      'generation_status',generation.status) result
    FROM signal_interest_decision_owners_v1 owner
    JOIN signal_classification_generations generation ON generation.id=owner.generation_id
    JOIN signal_topic_catalog_executions execution ON execution.generation_id=generation.id
      AND execution.workspace_id=owner.workspace_id
    WHERE owner.workspace_id=$1::uuid AND owner.actor_user_id=$2::uuid AND owner.term_key=$3
      AND owner.provider_contract_version=2
    ORDER BY owner.created_at DESC,owner.id DESC LIMIT 1`, [scope.workspace_id,scope.actor_user_id,scope.term_key]);
  return result.rows[0]?.result ?? { status: "not_started", expected_roots: 0,
    manifest_roots: 0, accepted_roots: 0, unknown_batches: 0, unsettled_calls: 0,
    classification_status: null, classification_processed_roots: 0,
    classification_total_roots: 0, classification_error_code: null, generation_status: null };
}
