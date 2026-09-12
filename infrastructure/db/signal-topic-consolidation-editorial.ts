import type { Pool, PoolClient } from 'pg';
import {
  SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1, SIGNAL_TOPIC_EDITORIAL_GLOBAL_CONFIGURATION_V1,
  buildSignalTopicEditorialGlobalReviewV1, buildSignalTopicEditorialScreeningPlanV1, signalTopicEditorialDigestV1,
  validateSignalTopicEditorialScreeningCoverageV1, validateSignalTopicEditorialScreeningOutputV1,
  validateSignalTopicEditorialGlobalResultV1,
  validateSignalTopicEditorialRepairRequestV1, signalTopicEditorialSemanticRepairErrorV1,
  signalTopicEditorialScreeningOutputSchemaV1, signalTopicEditorialGlobalOutputSchemaV1,
  type SignalTopicEditorialRunnerProviderRequestV1,
  type SignalTopicEditorialScreeningPlanV1, type SignalTopicEditorialScreeningGroupV1,
  type SignalTopicEditorialRunnerStoreV1, type SignalTopicEditorialRunnerStateV1,
} from '@noisia/query-engine';
import { cacheSignalTopicEditorialPlanV1, readSignalTopicEditorialPlanCacheV1, clearSignalTopicEditorialPlanCacheV1 } from './signal-topic-editorial-plan-cache';
import { verifySignalTopicEditorialContextRevisionV1 } from './signal-topic-editorial-context-cache';
import { loadSignalTopicInheritedContextStoreV1 } from './signal-topic-catalog';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';
import { parseSignalTopicAtomicCensusV1, parseSignalTopicCommunityPlanV1,
  type SignalTopicAtomicCensusV1, type SignalTopicConsolidationCommunityPlanV1 } from './signal-topic-consolidation';

export type SignalTopicEditorialDatabaseV1 = Pick<Pool, 'connect'>;
export type SignalTopicEditorialLeaseV1 = { execution_id: string; execution_token: string; workspace_id: string;
  actor_user_id: string; numeric_run_id: string; source_execution_id: string; worker_job_id: string };
export type SignalTopicEditorialRequestResultV1 = { execution_id: string; worker_job_id: string; replayed: boolean };
export type SignalTopicEditorialQuoteV1 = { contract_version: 'signal-topic-editorial-quote-v1'; workspace_id: string;
  status: string; quote_reference: string | null; quote_expires_at: string | null; maximum_micro_usd: string | null;
  expected_group_count: number; screening_request_count: number; global_request_count: 1; provider_execution_enabled: false };
export type SignalTopicEditorialStatusV1 = { contract_version: 'signal-topic-editorial-status-v1'; workspace_id: string;
  execution_id: string | null; status: string; completed_screening_count: number; expected_screening_count: number;
  maximum_micro_usd: string | null; confirmed_micro_usd: string; reserved_micro_usd: string; ambiguous_micro_usd: string;
  provider_execution_enabled: false; error_code: string | null };
export class SignalTopicEditorialStoreError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'SignalTopicEditorialStoreError'; }
}
const fail = (code: string, status = 409): never => { throw new SignalTopicEditorialStoreError(code, status); };
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const scope = (workspace: string, actor: string) => { if (!uuid.test(workspace) || !uuid.test(actor)) fail('topic_editorial_scope_invalid', 422); };
export const SIGNAL_TOPIC_EDITORIAL_EXECUTION_CONFIGURATION_V1 = {
  contract_version: 'signal-topic-editorial-execution-config-v1', screening: SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1,
  global: SIGNAL_TOPIC_EDITORIAL_GLOBAL_CONFIGURATION_V1, screening_batch_size: 40, max_call_attempts: 3,
} as const;
async function tx<T>(database: SignalTopicEditorialDatabaseV1, work: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  const client = await database.connect();
  try {
    await client.query(`${readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'}; SET LOCAL search_path=public,extensions,pg_temp`);
    const result = await work(client); await client.query('COMMIT'); return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof Error && /^(?:topic_editorial|processing|brand_context)_[a-z_]{1,120}$/u.test(error.message))
      throw new SignalTopicEditorialStoreError(error.message, error.message.endsWith('forbidden') ? 403 : 409);
    throw error;
  } finally { client.release(); }
}
async function value<T>(client: PoolClient, sql: string, parameters: unknown[]): Promise<T> {
  const row = (await client.query<{ value: T }>(sql, parameters)).rows[0]; return row ? row.value : fail('topic_editorial_store_unavailable');
}
async function requireRead(client: PoolClient, workspace: string, actor: string) {
  scope(workspace, actor);
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: workspace, actor_user_id: actor });
  if (!capabilities.can_view) fail('processing_forbidden', 403);
}
async function currentContext(client: PoolClient, workspace: string, expected: string) {
  const current = await loadSignalTopicInheritedContextStoreV1({ queryable: client, workspace_id: workspace,
    complete_context: true, require_current_semantic_authority: true, semantic_authority_check: "database" });
  if (current.context_digest !== expected) fail('topic_editorial_source_stale');
}

/** Private server input. The browser never supplies this plan or evidence text. */
export function validateSignalTopicEditorialPlanV1(plan: SignalTopicEditorialScreeningPlanV1): SignalTopicEditorialScreeningGroupV1[] {
  if (plan.batch_size !== 40 || plan.batches.length !== Math.ceil(plan.expected_group_count / 40)) fail('topic_editorial_plan_invalid');
  const payloads = plan.batches.map(batch => JSON.parse(JSON.parse(batch.request_body).messages[0].content) as {
    context: Parameters<typeof buildSignalTopicEditorialScreeningPlanV1>[0]['context']; groups: Array<[string,...unknown[]]>;
  });
  const groups = plan.batches.flatMap((batch,index) => {
    const sourceGroups = JSON.parse(batch.source_groups_body) as SignalTopicEditorialScreeningGroupV1[];
    if (payloads[index]?.groups.length !== sourceGroups.length
      || payloads[index]?.groups.some((row,groupIndex) => row[0] !== sourceGroups[groupIndex]?.group_key))
      fail('topic_editorial_plan_invalid');
    return sourceGroups;
  });
  const rebuilt = buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: plan.expected_group_count,
    source_context_digest: plan.source_context_digest, editorial_context_digest: plan.editorial_context_digest,
    context: payloads[0]!.context, groups, batch_size: 40 });
  if (canonical(rebuilt) !== canonical(plan)) fail('topic_editorial_plan_invalid');
  return groups;
}
export async function quoteSignalTopicConsolidationEditorialV1(args: {
  database: SignalTopicEditorialDatabaseV1; workspace_id: string; actor_user_id: string; numeric_run_id: string; plan: SignalTopicEditorialScreeningPlanV1;
  /** Original quote deadline, in Unix seconds. SQL revalidates its remaining validity. */
  deadline?: number;
}): Promise<SignalTopicEditorialQuoteV1> {
  if (args.deadline !== undefined && (!Number.isSafeInteger(args.deadline) || args.deadline <= 0 || args.deadline > 9_999_999_999))
    fail('topic_editorial_quote_expired');
  scope(args.workspace_id, args.actor_user_id); validateSignalTopicEditorialPlanV1(args.plan);
  return tx(args.database, async client => {
    await requireRead(client, args.workspace_id, args.actor_user_id);
    await currentContext(client, args.workspace_id, args.plan.source_context_digest);
    const row = await value<Record<string, unknown>>(client, 'SELECT signal_topic_editorial_quote_v1($1,$2,$3,$4::jsonb,$5::bigint) value',
      [args.workspace_id, args.actor_user_id, args.numeric_run_id, JSON.stringify(args.plan), args.deadline ?? null]);
    return { contract_version: 'signal-topic-editorial-quote-v1', workspace_id: args.workspace_id, status: String(row.status),
      quote_reference: typeof row.quote_reference === 'string' ? row.quote_reference : null,
      quote_expires_at: typeof row.quote_expires_at === 'string' ? row.quote_expires_at : null,
      maximum_micro_usd: typeof row.hard_cap_micro_usd === 'string' ? row.hard_cap_micro_usd : null,
      expected_group_count: args.plan.expected_group_count, screening_request_count: args.plan.batches.length,
      global_request_count: 1, provider_execution_enabled: false };
  }, true);
}
export async function requestSignalTopicConsolidationEditorialV1(args: {
  database: SignalTopicEditorialDatabaseV1; workspace_id: string; actor_user_id: string; numeric_run_id: string;
  plan: SignalTopicEditorialScreeningPlanV1; idempotency_key: string; quote_reference: string;
}): Promise<SignalTopicEditorialRequestResultV1> {
  scope(args.workspace_id, args.actor_user_id); validateSignalTopicEditorialPlanV1(args.plan);
  return tx(args.database, async client => {
    // SQL does exact replay before expiry/source validation. A post-commit retry
    // can recover its receipt after drift, without creating another admission.
    const replay = (await client.query(`SELECT 1 FROM signal_topic_editorial_request_keys
      WHERE workspace_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`, [args.workspace_id, args.actor_user_id, args.idempotency_key])).rowCount;
    if (!replay) await currentContext(client, args.workspace_id, args.plan.source_context_digest);
    return value(client, 'SELECT request_signal_topic_editorial_v1($1,$2,$3,$4::jsonb,$5,$6) value',
      [args.workspace_id, args.actor_user_id, args.numeric_run_id, JSON.stringify(args.plan), args.idempotency_key, args.quote_reference]);
  });
}

export async function loadSignalTopicConsolidationEditorialStatusV1(args: {
  database: SignalTopicEditorialDatabaseV1; workspace_id: string; actor_user_id: string; numeric_run_id: string;
}): Promise<SignalTopicEditorialStatusV1> {
  return tx(args.database, async client => {
    await requireRead(client, args.workspace_id, args.actor_user_id);
    const row = (await client.query<{ id: string; status: string; hard_cap_micro_usd: string; completed: number; expected: number;
      confirmed: string; reserved: string; ambiguous: string; error_code: string | null }>(`SELECT e.id,e.status,e.hard_cap_micro_usd::text,
      COALESCE(jsonb_array_length(e.state_body::jsonb->'screening_outputs'),0) completed,jsonb_array_length(e.plan->'batches') expected,e.error_code,
      COALESCE(sum(c.settled_micro_usd) FILTER(WHERE c.status='settled'),0)::text confirmed,
      COALESCE(sum(greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0))) FILTER(WHERE c.status IN('reserved','in_flight','response_persisted')),0)::text reserved,
      COALESCE(sum(greatest(c.reserved_micro_usd,COALESCE(c.observed_micro_usd,0))) FILTER(WHERE c.status='outcome_unknown'),0)::text ambiguous
      FROM signal_topic_editorial_executions e LEFT JOIN signal_topic_editorial_calls c ON c.execution_id=e.id
      WHERE e.workspace_id=$1 AND e.numeric_run_id=$2 GROUP BY e.id`, [args.workspace_id, args.numeric_run_id])).rows[0];
    return { contract_version: 'signal-topic-editorial-status-v1', workspace_id: args.workspace_id,
      execution_id: row?.id ?? null, status: row?.status ?? 'not_requested', completed_screening_count: row?.completed ?? 0,
      expected_screening_count: row?.expected ?? 0, maximum_micro_usd: row?.hard_cap_micro_usd ?? null,
      confirmed_micro_usd: row?.confirmed ?? '0', reserved_micro_usd: row?.reserved ?? '0', ambiguous_micro_usd: row?.ambiguous ?? '0',
      provider_execution_enabled: false, error_code: row?.error_code ?? null };
  }, true);
}

/** Full reference-only census; raw mention text is intentionally absent. */
export async function loadSignalTopicConsolidationEditorialSourceV1(args: {
  database: SignalTopicEditorialDatabaseV1; workspace_id: string; actor_user_id: string; numeric_run_id: string;
}): Promise<{ numeric_run_id: string; source_binding: Record<string, unknown>; census: SignalTopicAtomicCensusV1;
  census_snapshot_digest: string; community_plan: SignalTopicConsolidationCommunityPlanV1 }> {
  return tx(args.database, client => readSignalTopicConsolidationEditorialSourceWithQueryableV1({ ...args, queryable: client }), true);
}

/** The caller owns the repeatable-read transaction; reuse for source plus evidence snapshots. */
export async function readSignalTopicConsolidationEditorialSourceWithQueryableV1(args: {
  queryable: PoolClient; workspace_id: string; actor_user_id: string; numeric_run_id: string;
}): Promise<{ numeric_run_id: string; source_binding: Record<string, unknown>; census: SignalTopicAtomicCensusV1;
  census_snapshot_digest: string; community_plan: SignalTopicConsolidationCommunityPlanV1 }> {
    const client = args.queryable;
    await requireRead(client, args.workspace_id, args.actor_user_id);
    const binding = await value<Record<string, unknown> | null>(client, 'SELECT signal_topic_editorial_source_v1($1) value', [args.numeric_run_id]);
    if (!binding || binding.workspace_id !== args.workspace_id) return fail('topic_editorial_source_stale');
    await currentContext(client, args.workspace_id, String(binding.context_digest));
    const run = (await client.query<Record<string, unknown>>(`SELECT workspace_id,source_engine_execution_id AS source_execution_id,source_checkpoint_digest,
      output_artifact_id,output_artifact_sha256,model_artifact_id,model_artifact_sha256,centroid_artifact_id,centroid_artifact_sha256,
      context_digest,configuration,configuration_digest,expected_group_count FROM signal_topic_consolidation_runs WHERE id=$1 AND workspace_id=$2`,
    [args.numeric_run_id, args.workspace_id])).rows[0]!;
    const groups = (await client.query<Record<string, unknown>>(`SELECT g.group_key,g.lane,g.stable_cluster_id,g.local_label,g.group_digest,
      g.root_count,g.chunk_count,g.terms,g.dossier,g.dossier_digest,
      CASE WHEN g.centroid_artifact_id IS NULL THEN NULL ELSE jsonb_build_object('artifact_id',g.centroid_artifact_id,
       'artifact_sha256',r.centroid_artifact_sha256,'centroid_key',g.centroid_key,'centroid_digest',g.centroid_digest) END centroid,
      (SELECT jsonb_agg(jsonb_build_object('root_id',x.canonical_root_id,'chunk_count',x.chunk_count,'strength',x.strength,
        'assignment_digest',x.assignment_digest) ORDER BY x.canonical_root_id) FROM signal_topic_atomic_group_roots x WHERE x.atomic_group_id=g.id) roots
      FROM signal_topic_atomic_groups g JOIN signal_topic_consolidation_runs r ON r.id=g.consolidation_run_id
      WHERE g.consolidation_run_id=$1 AND g.workspace_id=$2 ORDER BY g.group_key COLLATE "C"`, [args.numeric_run_id, args.workspace_id])).rows;
    const census = parseSignalTopicAtomicCensusV1({ contract_version: 'signal-topic-consolidation-v1', ...run, groups });
    // The original census digest seals pre-JSONB JS number serialization. The
    // immutable relational projection can round-trip float text differently,
    // so the editorial snapshot receives its own digest while retaining the
    // original digest in source_binding for end-to-end numeric lineage.
    const communities = (await client.query<Record<string, unknown>>(`SELECT c.community_key,c.community_digest,
      jsonb_agg(jsonb_build_object('group_key',g.group_key,'rank',m.rank,'similarity',m.similarity) ORDER BY m.rank,g.group_key COLLATE "C") members
      FROM signal_topic_consolidation_communities c JOIN signal_topic_consolidation_community_members m ON m.community_id=c.id
      JOIN signal_topic_atomic_groups g ON g.id=m.atomic_group_id WHERE c.consolidation_run_id=$1 AND c.workspace_id=$2
      GROUP BY c.id ORDER BY c.community_key COLLATE "C"`, [args.numeric_run_id, args.workspace_id])).rows;
    const community_plan = parseSignalTopicCommunityPlanV1({ contract_version: 'signal-topic-centroid-community-plan-v1',
      configuration_digest: census.configuration_digest, communities }, census.groups.map(group => group.group_key));
    if (signalTopicEditorialDigestV1(community_plan) !== binding.community_plan_digest) fail('topic_editorial_community_changed');
    return { numeric_run_id: args.numeric_run_id, source_binding: binding, census,
      census_snapshot_digest: signalTopicEditorialDigestV1(census), community_plan };
}

async function ownerSnapshot(client: PoolClient, lease: SignalTopicEditorialLeaseV1, lock = false) {
  const row = (await client.query<{ plan: SignalTopicEditorialScreeningPlanV1; state_body: string | null; state_digest: string | null }>(
    `SELECT plan,state_body,state_digest FROM signal_topic_editorial_executions WHERE id=$1 AND workspace_id=$2
      AND actor_user_id=$3 AND numeric_run_id=$4 AND source_engine_execution_id=$5 ${lock ? 'FOR UPDATE' : ''}`,
    [lease.execution_id, lease.workspace_id, lease.actor_user_id, lease.numeric_run_id, lease.source_execution_id])).rows[0];
  if (!row) return fail('topic_editorial_lease_conflict');
  await client.query('SELECT signal_topic_editorial_assert_lease_v1($1,$2,false)', [lease.execution_id, lease.execution_token]); return row;
}
type VerifiedPlan = { plan: SignalTopicEditorialScreeningPlanV1; groups: SignalTopicEditorialScreeningGroupV1[] };
const leaseIdentity = (lease: SignalTopicEditorialLeaseV1) => canonical([lease.execution_id, lease.execution_token,
  lease.workspace_id, lease.actor_user_id, lease.numeric_run_id, lease.source_execution_id]);
async function reusableOwner(client: PoolClient, database: SignalTopicEditorialDatabaseV1, lease: SignalTopicEditorialLeaseV1, lock = false) {
  try {
    const row = (await client.query<{ plan_digest: string; state_body: string | null; state_digest: string | null }>(
      `SELECT plan_digest,state_body,state_digest,signal_topic_editorial_assert_lease_v1(id,$6,false) AS lease_check
        FROM signal_topic_editorial_executions WHERE id=$1 AND workspace_id=$2 AND actor_user_id=$3
        AND numeric_run_id=$4 AND source_engine_execution_id=$5 ${lock ? 'FOR UPDATE' : ''}`,
      [lease.execution_id, lease.workspace_id, lease.actor_user_id, lease.numeric_run_id, lease.source_execution_id, lease.execution_token])).rows[0];
    if (!row) return fail('topic_editorial_lease_conflict');
    const cached = readSignalTopicEditorialPlanCacheV1<VerifiedPlan>(database, leaseIdentity(lease), row.plan_digest);
    if (cached) return { ...row, ...cached };
    const snapshot = await ownerSnapshot(client, lease, lock);
    if (row.plan_digest !== snapshot.plan.plan_digest) fail('topic_editorial_owner_snapshot_invalid');
    return { ...snapshot, groups: validateSignalTopicEditorialPlanV1(snapshot.plan) };
  } catch (error) { clearSignalTopicEditorialPlanCacheV1(database, leaseIdentity(lease)); throw error; }
}
/** Hot-path ownership is scoped and live, but never transfers the sealed dossier. */
async function compactOwner(client: PoolClient, lease: SignalTopicEditorialLeaseV1, source = false) {
  const row = (await client.query<{ context_digest: string; revision: string | null }>(
    `SELECT source_binding->>'context_digest' AS context_digest,
      ${source ? 'signal_topic_editorial_context_revision_v1(workspace_id)' : 'NULL::text'} AS revision,
      signal_topic_editorial_assert_lease_v1(id,$6,false) AS lease_check
      FROM signal_topic_editorial_executions WHERE id=$1 AND workspace_id=$2 AND actor_user_id=$3
      AND numeric_run_id=$4 AND source_engine_execution_id=$5`,
    [lease.execution_id, lease.workspace_id, lease.actor_user_id, lease.numeric_run_id, lease.source_execution_id, lease.execution_token])).rows[0];
  return row ?? fail('topic_editorial_lease_conflict');
}
async function currentOwnedContext(database: SignalTopicEditorialDatabaseV1, client: PoolClient, lease: SignalTopicEditorialLeaseV1) {
  try {
    const row = await compactOwner(client, lease, true);
    await verifySignalTopicEditorialContextRevisionV1({ database,
      key: canonical([lease.execution_id, lease.execution_token, lease.workspace_id, lease.actor_user_id,
        lease.numeric_run_id, lease.source_execution_id, row.context_digest]), revision: row.revision,
      validate: () => currentContext(client, lease.workspace_id, row.context_digest),
      reread: () => value<string>(client, 'SELECT signal_topic_editorial_context_revision_v1($1) value', [lease.workspace_id]) });
  } catch (error) { clearSignalTopicEditorialPlanCacheV1(database, leaseIdentity(lease)); throw error; }
}
/** Recover the admitted snapshot, even when current Brand OS or policy changed.
 * Only the live owner lease is required; no new provider authority is granted. */
export async function loadSignalTopicEditorialOwnerInputV1(args: {
  database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1;
}): Promise<{ plan: SignalTopicEditorialScreeningPlanV1; groups: SignalTopicEditorialScreeningGroupV1[] }> {
  try { return await tx(args.database, async client => {
    const row = await ownerSnapshot(client, args.lease);
    const seal = (await client.query<{ plan_digest: string; source_digest: string; source_binding: Record<string, unknown> }>(
      'SELECT plan_digest,source_digest,source_binding FROM signal_topic_editorial_executions WHERE id=$1 AND workspace_id=$2',
      [args.lease.execution_id, args.lease.workspace_id])).rows[0];
    if (!seal || seal.plan_digest !== row.plan.plan_digest || seal.source_digest !== signalTopicEditorialDigestV1(seal.source_binding)
      || seal.source_binding.workspace_id !== args.lease.workspace_id || seal.source_binding.numeric_run_id !== args.lease.numeric_run_id
      || seal.source_binding.source_engine_execution_id !== args.lease.source_execution_id
      || seal.source_binding.context_digest !== row.plan.source_context_digest) fail('topic_editorial_owner_snapshot_invalid');
    return cacheSignalTopicEditorialPlanV1(args.database, leaseIdentity(args.lease), row.plan.plan_digest,
      { plan: row.plan, groups: validateSignalTopicEditorialPlanV1(row.plan) });
  }, true);
  } catch (error) { clearSignalTopicEditorialPlanCacheV1(args.database, leaseIdentity(args.lease)); throw error; }
}
/** Every save is a short CAS transaction. The runner/provider never retains its connection.
 * The admitted plan is immutable in SQL. Validate it once per store, then check its
 * durable digest on every scoped lease read without retransmitting the dossier. */
export function createSignalTopicEditorialRunnerStoreV1(args: {
  database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1;
}): SignalTopicEditorialRunnerStoreV1 {
  let admitted: { plan: SignalTopicEditorialScreeningPlanV1; groups: SignalTopicEditorialScreeningGroupV1[] } | null = null;
  async function checkpoint(client: PoolClient, lock = false) {
    try {
      if (!admitted) {
        const initial = await reusableOwner(client, args.database, args.lease, lock);
        admitted = { plan: initial.plan, groups: initial.groups };
        return { ...initial, ...admitted };
      }
      const row = (await client.query<{ plan_digest: string; state_body: string | null; state_digest: string | null }>(
        `SELECT plan_digest,state_body,state_digest,signal_topic_editorial_assert_lease_v1(id,$6,false) AS lease_check
         FROM signal_topic_editorial_executions WHERE id=$1 AND workspace_id=$2 AND actor_user_id=$3
         AND numeric_run_id=$4 AND source_engine_execution_id=$5 ${lock ? 'FOR UPDATE' : ''}`,
        [args.lease.execution_id, args.lease.workspace_id, args.lease.actor_user_id, args.lease.numeric_run_id,
          args.lease.source_execution_id, args.lease.execution_token])).rows[0] ?? fail('topic_editorial_lease_conflict');
      if (row.plan_digest !== admitted.plan.plan_digest) fail('topic_editorial_owner_snapshot_invalid');
      return { ...row, ...admitted };
    } catch (error) { admitted = null; clearSignalTopicEditorialPlanCacheV1(args.database, leaseIdentity(args.lease)); throw error; }
  }
  return {
    load: async executionKey => tx(args.database, async client => {
      if (executionKey !== args.lease.execution_id) fail('topic_editorial_execution_key_invalid');
      const row = await checkpoint(client); return row.state_body === null ? null : { ...JSON.parse(row.state_body), state_digest: row.state_digest };
    }, true),
    save: async input => tx(args.database, async client => {
      if (input.execution_key !== args.lease.execution_id || input.state.execution_key !== input.execution_key) fail('topic_editorial_execution_key_invalid');
      const row = await checkpoint(client, true);
      const { state_digest, ...body } = input.state;
      if (body.contract_version !== 'signal-topic-editorial-runner-v1' || body.plan_digest !== row.plan.plan_digest
        || signalTopicEditorialDigestV1(body) !== state_digest || row.state_digest !== input.expected_state_digest
        || !Array.isArray(body.screening_outputs) || !['screening', 'global', 'completed'].includes(body.phase)) fail('topic_editorial_state_conflict');
      const prior = row.state_body === null ? null : JSON.parse(row.state_body) as Omit<SignalTopicEditorialRunnerStateV1, 'state_digest'>;
      const previous = new Map(prior?.screening_outputs.map(output => [output.batch_index, output]));
      const seen = new Set<number>();
      for (const output of body.screening_outputs) {
        const batch = row.plan.batches[output.batch_index] ?? fail('topic_editorial_state_conflict');
        if (seen.has(output.batch_index)) fail('topic_editorial_state_conflict');
        seen.add(output.batch_index);
        const retained = previous.get(output.batch_index);
        if (!retained || canonical(retained) !== canonical(output)) validateSignalTopicEditorialScreeningOutputV1(batch, output);
      }
      // SQL independently proves append-only paid history on every update. Only
      // phase transitions need whole-census coverage and the global reconstruction.
      if (body.phase !== 'screening' && (prior?.phase !== body.phase || canonical(prior.global) !== canonical(body.global))) {
        const screening = validateSignalTopicEditorialScreeningCoverageV1(row.plan, body.screening_outputs);
        if (body.global) {
          const review = buildSignalTopicEditorialGlobalReviewV1({ plan: row.plan, screening, groups: row.groups });
          if (body.global.request_digest !== review.request_digest || body.phase !== 'completed') fail('topic_editorial_global_invalid');
          validateSignalTopicEditorialGlobalResultV1({ review, screening, value: body.global.result });
        }
      }
      await client.query('UPDATE signal_topic_editorial_executions SET state_body=$2,state_digest=$3 WHERE id=$1',
        [args.lease.execution_id, canonical(body), state_digest]);
    }),
  };
}
/** Builds/seals the one global request from paid screening checkpoints, never browser input. */
export async function bindSignalTopicEditorialGlobalRequestV1(args: { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1 }) {
  return tx(args.database, async client => {
    const row = await reusableOwner(client, args.database, args.lease, true), groups = row.groups;
    if (!row.state_body) return fail('topic_editorial_screening_incomplete');
    const state = JSON.parse(row.state_body) as SignalTopicEditorialRunnerStateV1;
    const screening = validateSignalTopicEditorialScreeningCoverageV1(row.plan, state.screening_outputs);
    const review = buildSignalTopicEditorialGlobalReviewV1({ plan: row.plan, screening, groups });
    const prior = (await client.query<{ request_digest: string; request_body: string }>(`SELECT request_digest,request_body
      FROM signal_topic_editorial_requests WHERE execution_id=$1 AND phase='global' AND parent_request_id IS NULL`, [args.lease.execution_id])).rows[0];
    if (prior && (prior.request_digest !== review.request_digest || prior.request_body !== review.request_body)) fail('topic_editorial_global_replay_conflict');
    if (!prior) await client.query(`INSERT INTO signal_topic_editorial_requests(workspace_id,execution_id,phase,batch_index,request_digest,request_body,
      configuration,receipts,reserved_micro_usd) VALUES($1,$2,'global',0,$3,$4,$5::jsonb,$6::jsonb,$7::bigint)`,
    [args.lease.workspace_id, args.lease.execution_id, review.request_digest, review.request_body, JSON.stringify(review.configuration),
      JSON.stringify(review.eligible_group_receipts), String(Buffer.byteLength(review.request_body, 'utf8') * 3 + review.configuration.max_output_tokens * 15)]);
    return review;
  });
}

/** Bind exactly one semantic repair to a paid parent. No provider/send authority is granted here. */
export async function bindSignalTopicEditorialRepairRequestV1(args: {
  database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1; request: SignalTopicEditorialRunnerProviderRequestV1;
}): Promise<SignalTopicEditorialRunnerProviderRequestV1> {
  const validated = validateSignalTopicEditorialRepairRequestV1(args.request), request = validated.request;
  return tx(args.database, async client => {
    const execution = await reusableOwner(client, args.database, args.lease, true), groups = execution.groups;
    const parents = (await client.query<{ id: string; phase: 'screening' | 'global'; batch_index: number; request_digest: string;
      request_body: string; configuration: unknown; receipts: unknown; parent_request_id: string | null; response_output: unknown;
      response_http_status: number; response_complete: boolean }>(`SELECT p.id,p.phase,p.batch_index,p.request_digest,p.request_body,
      p.configuration,p.receipts,p.parent_request_id,c.response_output,c.response_http_status,c.response_complete
      FROM signal_topic_editorial_requests p JOIN signal_topic_editorial_calls c ON c.request_id=p.id AND c.execution_id=p.execution_id
      WHERE p.execution_id=$1 AND p.workspace_id=$2 AND p.request_digest=$3 AND c.status='settled'`,
    [args.lease.execution_id, args.lease.workspace_id, request.repair.parent_request_digest])).rows;
    if (parents.length !== 1) fail('topic_editorial_repair_parent_invalid');
    const parent = parents[0] ?? fail('topic_editorial_repair_parent_invalid');
    if (parent.parent_request_id !== null || parent.phase !== request.phase
      || parent.response_http_status !== 200 || parent.response_complete !== true || parent.request_body !== validated.original.request_body
      || parent.request_digest !== validated.original.request_digest) fail('topic_editorial_repair_parent_invalid');
    const configuration = parent.phase === 'screening' ? SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1 : SIGNAL_TOPIC_EDITORIAL_GLOBAL_CONFIGURATION_V1;
    if (canonical(parent.configuration) !== canonical(configuration)) fail('topic_editorial_repair_parent_invalid');
    const schema = parent.phase === 'screening' ? signalTopicEditorialScreeningOutputSchemaV1 : signalTopicEditorialGlobalOutputSchemaV1;
    const parsed = schema.safeParse(parent.response_output);
    if (!parsed.success || signalTopicEditorialDigestV1(parsed.data) !== request.repair.parent_response_digest
      || signalTopicEditorialDigestV1(parsed.data) !== signalTopicEditorialDigestV1(validated.response)) fail('topic_editorial_repair_response_invalid');
    let validate: () => unknown;
    if (parent.phase === 'screening') {
      const batch = execution.plan.batches[parent.batch_index];
      if (!batch || batch.request_digest !== parent.request_digest || batch.request_body !== parent.request_body
        || batch.batch_key !== request.repair.parent_idempotency_key || canonical(parent.receipts) !== canonical(batch.group_receipts))
        fail('topic_editorial_repair_parent_invalid');
      validate = () => validateSignalTopicEditorialScreeningOutputV1(batch!, parsed.data);
    } else {
      if (!execution.state_body) fail('topic_editorial_screening_incomplete');
      const state = JSON.parse(execution.state_body!) as SignalTopicEditorialRunnerStateV1;
      const screening = validateSignalTopicEditorialScreeningCoverageV1(execution.plan, state.screening_outputs);
      const review = buildSignalTopicEditorialGlobalReviewV1({ plan: execution.plan, screening, groups });
      if (parent.batch_index !== 0 || review.request_digest !== parent.request_digest || review.request_body !== parent.request_body
        || request.repair.parent_idempotency_key !== `topic-consolidation-global-v1:${review.request_digest.slice(7, 23)}`
        || canonical(parent.receipts) !== canonical(review.eligible_group_receipts)) fail('topic_editorial_repair_parent_invalid');
      validate = () => validateSignalTopicEditorialGlobalResultV1({ review, screening, value: parsed.data });
    }
    let errorCode: string | null = null;
    try { validate(); } catch (error) { errorCode = signalTopicEditorialSemanticRepairErrorV1(parent.phase, parsed.data, error); }
    if (errorCode === null || errorCode !== request.repair.error_code) fail('topic_editorial_repair_error_unproven');
    const parentOutputBody = canonical(parsed.data);
    const prior = (await client.query<{ request_digest: string; request_body: string; repair_binding: unknown; repair_parent_output_body: string }>(
      `SELECT request_digest,request_body,repair_binding,repair_parent_output_body FROM signal_topic_editorial_requests
       WHERE execution_id=$1 AND parent_request_id=$2`, [args.lease.execution_id, parent.id])).rows;
    if (prior.length > 1 || prior[0] && (prior[0].request_digest !== request.request_digest || prior[0].request_body !== request.request_body
      || canonical(prior[0].repair_binding) !== canonical(request.repair) || prior[0].repair_parent_output_body !== parentOutputBody))
      fail('topic_editorial_repair_replay_conflict');
    if (!prior.length) await client.query(`INSERT INTO signal_topic_editorial_requests(workspace_id,execution_id,phase,batch_index,
      request_digest,request_body,configuration,receipts,reserved_micro_usd,parent_request_id,repair_binding,repair_parent_output_body)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::bigint,$10,$11::jsonb,$12)`,
    [args.lease.workspace_id, args.lease.execution_id, parent.phase, parent.batch_index, request.request_digest, request.request_body,
      JSON.stringify(configuration), JSON.stringify(parent.receipts), String(Buffer.byteLength(request.request_body, 'utf8') * 3 + configuration.max_output_tokens * 15),
      parent.id, JSON.stringify(request.repair), parentOutputBody]);
    return request;
  });
}

// These server-only seams commit and release their connection before returning.
// There is intentionally no transport, provider client or queue wiring here.
export async function reserveSignalTopicEditorialCallV1(args: { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1;
  request_digest: string; provider_available?: boolean }): Promise<{ call_id: string; attempt_token: string; status: string; reserved_micro_usd: string }> {
  if (args.provider_available !== true) return fail('topic_editorial_provider_disabled');
  try { return await tx(args.database, async client => {
    await currentOwnedContext(args.database, client, args.lease);
    return value(client, 'SELECT reserve_signal_topic_editorial_call_v1($1,$2,$3,$4) value',
      [args.lease.execution_id, args.lease.execution_token, args.request_digest, true]);
  });
  } catch (error) { clearSignalTopicEditorialPlanCacheV1(args.database, leaseIdentity(args.lease)); throw error; }
}
export async function markSentSignalTopicEditorialCallV1(args: { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1;
  call_id: string; attempt_token: string; provider_available?: boolean }): Promise<boolean> {
  if (args.provider_available !== true) return fail('topic_editorial_provider_disabled');
  try { return await tx(args.database, async client => {
    await currentOwnedContext(args.database, client, args.lease);
    const bound = (await client.query('SELECT 1 FROM signal_topic_editorial_calls WHERE id=$1 AND execution_id=$2', [args.call_id,args.lease.execution_id])).rowCount;
    if (!bound) fail('topic_editorial_call_scope_invalid');
    return value(client, 'SELECT mark_sent_signal_topic_editorial_call_v1($1,$2,$3,$4) value',
      [args.call_id,args.attempt_token,args.lease.execution_token,true]);
  });
  } catch (error) { clearSignalTopicEditorialPlanCacheV1(args.database, leaseIdentity(args.lease)); throw error; }
}
export async function persistSignalTopicEditorialResponseV1(args: { database: SignalTopicEditorialDatabaseV1; call_id: string; attempt_token: string;
  response_body_private: string; response_storage_key: string }): Promise<{ status: string; replayed: boolean }> {
  return tx(args.database, client => value(client, 'SELECT persist_signal_topic_editorial_response_v1($1,$2,$3,$4) value',
    [args.call_id,args.attempt_token,args.response_body_private,args.response_storage_key]));
}
export async function settleSignalTopicEditorialCallV1(args: { database: SignalTopicEditorialDatabaseV1; call_id: string; attempt_token: string }) {
  return tx(args.database, client => value<{ status: string; settled_micro_usd?: string; replayed: boolean }>(client,
    'SELECT settle_signal_topic_editorial_call_v1($1,$2) value',[args.call_id,args.attempt_token]));
}
export async function failSignalTopicEditorialCallV1(args: { database: SignalTopicEditorialDatabaseV1; call_id: string; attempt_token: string; definitely_not_sent?: boolean }) {
  return tx(args.database, client => value<string>(client, 'SELECT fail_signal_topic_editorial_call_v1($1,$2,$3) value',
    [args.call_id,args.attempt_token,args.definitely_not_sent === true]));
}
export async function loadSignalTopicEditorialPaidResponseV1(args: { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1; request_digest: string }): Promise<unknown | null> {
  return tx(args.database, async client => {
    await compactOwner(client,args.lease);
    const row = (await client.query<{ response_output: unknown }>(`SELECT c.response_output FROM signal_topic_editorial_calls c
      JOIN signal_topic_editorial_requests r ON r.id=c.request_id WHERE c.execution_id=$1 AND r.request_digest=$2 AND c.status='settled'`,
    [args.lease.execution_id,args.request_digest])).rows[0];return row?.response_output ?? null;
  },true);
}
export async function claimSignalTopicEditorialExecutionV1(args: { database: SignalTopicEditorialDatabaseV1; execution_id: string; worker_job_id: string; lease_seconds?: number }) {
  return tx(args.database, client => value<SignalTopicEditorialLeaseV1 | { completed: true; execution_id: string } | null>(client,
    'SELECT claim_signal_topic_editorial_execution_v1($1,$2,$3) value',[args.execution_id,args.worker_job_id,args.lease_seconds ?? 180]));
}
export async function heartbeatSignalTopicEditorialExecutionV1(args: { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1 }) {
  return tx(args.database, client => value<boolean>(client,'SELECT heartbeat_signal_topic_editorial_execution_v1($1,$2) value',[args.lease.execution_id,args.lease.execution_token]));
}
export async function finishSignalTopicEditorialExecutionV1(args: { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1 }) {
  try { return await tx(args.database, client => value<boolean>(client,'SELECT finish_signal_topic_editorial_execution_v1($1,$2) value',[args.lease.execution_id,args.lease.execution_token]));
  } finally { clearSignalTopicEditorialPlanCacheV1(args.database, leaseIdentity(args.lease)); }
}
export async function failSignalTopicEditorialExecutionV1(args: { database: SignalTopicEditorialDatabaseV1; lease: SignalTopicEditorialLeaseV1; error_code: string }) {
  try { return await tx(args.database, client => value<boolean>(client,'SELECT fail_signal_topic_editorial_execution_v1($1,$2,$3) value',[args.lease.execution_id,args.lease.execution_token,args.error_code]));
  } finally { clearSignalTopicEditorialPlanCacheV1(args.database, leaseIdentity(args.lease)); }
}
export async function recoverSignalTopicEditorialExecutionsV1(args: { database: SignalTopicEditorialDatabaseV1; limit?: number }) {
  return tx(args.database, client => value<number>(client,'SELECT recover_signal_topic_editorial_executions_v1($1) value',[args.limit ?? 10]));
}
export async function retrySignalTopicEditorialExecutionV1(args: { database: SignalTopicEditorialDatabaseV1; workspace_id: string; actor_user_id: string; execution_id: string; idempotency_key: string }) {
  scope(args.workspace_id,args.actor_user_id);
  return tx(args.database, client => value<SignalTopicEditorialRequestResultV1>(client,'SELECT retry_signal_topic_editorial_execution_v1($1,$2,$3,$4) value',
    [args.workspace_id,args.actor_user_id,args.execution_id,args.idempotency_key]));
}
export async function claimSignalTopicEditorialDispatchV1(args: { database: SignalTopicEditorialDatabaseV1; limit?: number }) {
  return tx(args.database, client => value<Array<{ dispatch_id: string; execution_id: string; workspace_id: string; worker_job_id: string; lease_token: string; attempt: number }>>(
    client,'SELECT claim_signal_topic_editorial_dispatch_v1($1) value',[args.limit ?? 10]));
}
export async function acknowledgeSignalTopicEditorialDispatchV1(args: { database: SignalTopicEditorialDatabaseV1; dispatch_id: string; lease_token: string }) {
  return tx(args.database, client => value<boolean>(client,'SELECT acknowledge_signal_topic_editorial_dispatch_v1($1,$2) value',[args.dispatch_id,args.lease_token]));
}
export async function failSignalTopicEditorialDispatchV1(args: { database: SignalTopicEditorialDatabaseV1; dispatch_id: string; lease_token: string }) {
  return tx(args.database, client => value<boolean>(client,'SELECT fail_signal_topic_editorial_dispatch_v1($1,$2) value',[args.dispatch_id,args.lease_token]));
}
