import type { Job } from "bullmq";
import { createHash } from "node:crypto";
import { createSignalTopicEditorialGlobalStageRuntimeStoresV2,
  loadSignalTopicEditorialGlobalUnitsV2, loadSignalTopicEditorialGlobalStageProgressV2,
  markSignalTopicEditorialGlobalStageBlockedV2, materializeSignalTopicEditorialStagedGlobalCatalogV2,
  prepareSignalTopicEditorialGlobalStageGrammarRetryV2, prepareSignalTopicEditorialGlobalStageV2,
  type SignalTopicEditorialGlobalStageProgressV2 } from "@noisia/db";
import { signalTopicEditorialStagedScreeningReviewDigestV2,
  type SignalTopicEditorialGlobalMergeReviewV2, type SignalTopicEditorialGlobalRankingReviewV2,
  type SignalTopicEditorialGlobalShardV2 } from "@noisia/query-engine";
import { createAnthropicMessageBatchesClient } from "../providers/anthropic-message-batches";
import { planSignalTopicEditorialGlobalAdvanceV2,
  type SignalTopicEditorialGlobalStageObservationV2 } from "./signal-topic-editorial-global-advance-v2";
import { runSignalTopicEditorialGlobalStageTickV2,
  type SignalTopicEditorialGlobalStageStoresV2 } from "./signal-topic-editorial-global-stage-v2";

export const SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_JOB_V2 = "signal-topic-editorial-global-stage-v2";
export const SIGNAL_TOPIC_EDITORIAL_GLOBAL_ADVANCE_JOB_V2 = "signal-topic-editorial-global-advance-v2";
type Environment = Readonly<Record<string, string | undefined>>;
type Database = Parameters<typeof createSignalTopicEditorialGlobalStageRuntimeStoresV2>[0]["database"];
type Queue = {
  getJob(id: string): Promise<{ getState(): Promise<string>; retry(state: "completed" | "failed"): Promise<void> } | null | undefined>;
  add(name: string, data: { batch_id: string } | { execution_id: string }, options: Record<string, unknown>): Promise<unknown>;
};
type DrainOptions = { env?: Environment; database?: Database; queue?: Queue };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const jobIdFor = (batchId: string) => `topic-editorial-global-stage-v2-${batchId}`;
const advanceJobIdFor = (executionId: string) => `topic-editorial-global-advance-v2-${executionId}`;
let nextGrammarRetryAt = 0;

function stableUuid(parts: unknown[]): string {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Retries and competing Worker replicas derive the same stage/call identity. */
export function signalTopicEditorialGlobalStageIdV2(executionId: string, screeningReviewDigest: string) {
  if (!uuid.test(executionId) || !/^sha256:[0-9a-f]{64}$/u.test(screeningReviewDigest))
    throw new Error("topic_editorial_global_stage_identity_invalid");
  // The v2 stage may retain provider-rejected, zero-cost manifests. A new
  // stage identity keeps those receipts immutable while using the supported
  // structured-output schema for every newly prepared request.
  return stableUuid(["signal-topic-editorial-global-stage-v3", executionId, screeningReviewDigest]);
}

type Review = SignalTopicEditorialGlobalShardV2 | SignalTopicEditorialGlobalMergeReviewV2
  | SignalTopicEditorialGlobalRankingReviewV2;
export function buildSignalTopicEditorialGlobalStageItemsV2(stageId: string, reviews: Review[]) {
  if (!uuid.test(stageId) || !reviews.length || reviews.length > 5000)
    throw new Error("topic_editorial_global_stage_manifest_invalid");
  const kind = reviews[0]!.contract_version === "signal-topic-editorial-global-shard-v2" ? "shard"
    : reviews[0]!.contract_version === "signal-topic-editorial-global-merge-review-v2" ? "merge" : "rank";
  if (kind === "rank" && reviews.length !== 1) throw new Error("topic_editorial_global_stage_manifest_invalid");
  const seen = new Set<number>();
  return reviews.map((review) => {
    const actualKind = review.contract_version === "signal-topic-editorial-global-shard-v2" ? "shard"
      : review.contract_version === "signal-topic-editorial-global-merge-review-v2" ? "merge" : "rank";
    if (actualKind !== kind || !review.request_body || !review.request_digest)
      throw new Error("topic_editorial_global_stage_manifest_invalid");
    const round = review.contract_version === "signal-topic-editorial-global-merge-review-v2" ? review.round : 0;
    const batchIndex = review.contract_version === "signal-topic-editorial-global-ranking-review-v2" ? 0 : review.batch_index;
    if (seen.has(batchIndex)) throw new Error("topic_editorial_global_stage_manifest_invalid");
    seen.add(batchIndex);
    const callId = stableUuid([stageId, actualKind, round, batchIndex, review.request_digest]);
    const providerRequest = { custom_id: `${actualKind}_${round}_${batchIndex}`,
      params: JSON.parse(review.request_body) as { model: string; max_tokens: number; [key: string]: unknown } };
    return actualKind === "shard" ? { stage_id: stageId, stage_kind: "shard" as const, call_id: callId,
      shard: review as SignalTopicEditorialGlobalShardV2, provider_request: providerRequest }
      : { stage_id: stageId, stage_kind: actualKind, call_id: callId,
        review: review as SignalTopicEditorialGlobalMergeReviewV2 | SignalTopicEditorialGlobalRankingReviewV2,
        provider_request: providerRequest };
  });
}

export function signalTopicEditorialGlobalStageConfigurationV2(env: Environment = process.env) {
  const enabled = env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED === "true"
    && env.NOISIA_SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_ENABLED === "true";
  return { enabled, provider_enabled: enabled && env.NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED === "true"
    && env.NOISIA_SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_PROVIDER_ENABLED === "true" };
}

/** Postgres selects due batches; Redis only wakes a bounded batch tick. */
export async function drainSignalTopicEditorialGlobalStagesV2(options: DrainOptions = {}) {
  const flags = signalTopicEditorialGlobalStageConfigurationV2(options.env);
  if (!flags.enabled) return { disabled: true, dispatched: 0 };
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const client = await database.connect();
  let ids: string[];
  try {
    const result = await client.query<{ id: string }>(`SELECT batch.id::text FROM signal_topic_editorial_global_stage_batches_v2 batch
      WHERE batch.state IN ('prepared','in_progress','canceling','ended')
        AND (batch.state <> 'prepared' OR ($1::boolean AND NOT EXISTS (
          SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 item
          JOIN signal_topic_editorial_global_stage_requests_v2 member ON member.id=item.request_id
          WHERE item.batch_id=batch.id AND (
            SELECT count(DISTINCT sibling.batch_index) FROM signal_topic_editorial_global_stage_requests_v2 sibling
            WHERE sibling.stage_id=batch.stage_id AND sibling.stage_kind=batch.stage_kind AND sibling.round=member.round
          ) <> member.batch_count)))
        AND (batch.next_poll_at IS NULL OR batch.next_poll_at <= clock_timestamp())
        AND (batch.lease_expires_at IS NULL OR batch.lease_expires_at <= clock_timestamp())
      ORDER BY batch.next_poll_at NULLS FIRST,batch.id LIMIT 10`, [flags.provider_enabled]);
    ids = result.rows.map((row: { id: string }) => row.id);
  } finally { client.release(); }
  let dispatched = 0;
  for (const batchId of ids) {
    if (!uuid.test(batchId)) throw new Error("topic_editorial_global_stage_batch_id_invalid");
    const jobId = jobIdFor(batchId);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") await existing.retry(state);
    } else {
      await queue.add(SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_JOB_V2, { batch_id: batchId }, { jobId,
        attempts: 3, backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true, removeOnFail: { age: 604800, count: 500 } });
    }
    dispatched++;
  }
  return { disabled: false, dispatched };
}

/** A V3 execution reaches review_pending only after every screening request
 * has one accepted settled decision (including paced grammar retries). */
export async function drainSignalTopicEditorialGlobalAdvancementsV2(options: DrainOptions = {}) {
  const flags = signalTopicEditorialGlobalStageConfigurationV2(options.env);
  if (!flags.enabled) return { disabled: true, dispatched: 0 };
  const database = options.database ?? (await import("../db/client")).pool;
  const queue = options.queue ?? (await import("../queues/data-os")).dataOsProducer;
  const client = await database.connect();
  let ids: string[];
  try {
    const result = await client.query<{ id: string }>(`SELECT e.id::text id
      FROM signal_topic_editorial_executions e
      JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
      LEFT JOIN signal_topic_editorial_global_stages_v2 stage ON stage.execution_id=e.id
      WHERE e.plan->>'contract_version'='signal-topic-editorial-admission-header-v3'
        AND e.status IN('queued','running') AND o.stage='review_pending'
        AND EXISTS (SELECT 1 FROM signal_topic_editorial_requests request WHERE request.execution_id=e.id)
        AND (stage.stage_id IS NULL OR (stage.state='blocked'
          AND NOT EXISTS (SELECT 1 FROM signal_topic_editorial_global_stages_v2 successor
            WHERE successor.execution_id=e.id AND successor.state IN('open','complete','materialized'))
          AND (SELECT count(*) FROM signal_topic_editorial_global_stage_requests_v2 request
            WHERE request.stage_id=stage.stage_id)>0
          AND (SELECT count(*) FROM signal_topic_editorial_global_stage_requests_v2 request
            WHERE request.stage_id=stage.stage_id AND EXISTS (
              SELECT 1 FROM signal_topic_editorial_global_stage_batch_items_v2 item
              JOIN signal_topic_editorial_global_stage_batches_v2 batch ON batch.id=item.batch_id
              JOIN signal_topic_editorial_global_stage_calls_v2 call ON call.id=item.call_id
              WHERE item.request_id=request.id AND batch.state='imported' AND item.outcome='errored'
                AND item.validation->>'status'='provider_error' AND call.status='settled'
                AND call.settled_micro_usd=0 AND call.observed_micro_usd=0
                AND call.response_body_private::jsonb->'result'->'error'->'error'->>'message'
                  LIKE 'output_config.format.schema: For ''array'' type, property ''maxItems'' is not supported%'
            ))=(SELECT count(*) FROM signal_topic_editorial_global_stage_requests_v2 request
              WHERE request.stage_id=stage.stage_id)) OR (stage.state='open' AND (
          EXISTS (SELECT 1 FROM signal_topic_editorial_global_stage_requests_v2 partial
            WHERE partial.stage_id=stage.stage_id AND (
              SELECT count(DISTINCT sibling.batch_index) FROM signal_topic_editorial_global_stage_requests_v2 sibling
              WHERE sibling.stage_id=stage.stage_id AND sibling.stage_kind=partial.stage_kind AND sibling.round=partial.round
            ) < partial.batch_count)
          OR (EXISTS (SELECT 1 FROM signal_topic_editorial_global_stage_batches_v2 done
              WHERE done.stage_id=stage.stage_id AND done.state IN('imported','rejected'))
            AND NOT EXISTS (SELECT 1 FROM signal_topic_editorial_global_stage_batches_v2 pending
              WHERE pending.stage_id=stage.stage_id AND pending.state NOT IN('imported','rejected'))
            AND NOT EXISTS (SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 unsettled
              WHERE unsettled.stage_id=stage.stage_id AND unsettled.status NOT IN('settled','definitely_not_sent'))
            AND NOT EXISTS (
              SELECT 1 FROM signal_topic_editorial_global_stage_requests_v2 request
              JOIN LATERAL (SELECT item.outcome,item.validation,call.status,call.settled_micro_usd,
                  call.observed_micro_usd,call.response_body_private,batch.state batch_state
                FROM signal_topic_editorial_global_stage_batch_items_v2 item
                JOIN signal_topic_editorial_global_stage_calls_v2 call ON call.id=item.call_id
                JOIN signal_topic_editorial_global_stage_batches_v2 batch ON batch.id=item.batch_id
                WHERE item.request_id=request.id ORDER BY batch.created_at DESC LIMIT 1) latest ON true
              JOIN signal_topic_editorial_batch_owners_v2 owner ON owner.execution_id=stage.execution_id
              JOIN signal_processing_admissions admission ON admission.id=stage.processing_admission_id
              JOIN signal_processing_policy_versions policy ON policy.id=admission.policy_version_id
              LEFT JOIN signal_topic_editorial_global_continuations_v2 grant_row ON grant_row.execution_id=stage.execution_id
              WHERE request.stage_id=stage.stage_id AND latest.batch_state='imported'
                AND latest.status='settled'
                AND (((latest.settled_micro_usd=0 AND latest.observed_micro_usd=0)
                  AND latest.outcome='errored' AND latest.validation->>'status'='provider_error'
                  AND latest.response_body_private::jsonb->'result'->'error'->'error'->>'message'
                    LIKE 'Grammar compilation rate limit exceeded%')
                  OR (latest.outcome='succeeded' AND latest.validation->>'status'='invalid_output'
                    AND latest.validation->>'code'='topic_editorial_global_shard_citation_invalid'))
                AND (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts
                  WHERE attempts.request_id=request.id)<5
                AND clock_timestamp()<CASE WHEN grant_row.execution_id IS NULL
                  THEN least(owner.send_not_after,admission.admission_not_after,policy.valid_until)
                  ELSE policy.valid_until END
                AND policy.status='active')))))
        AND NOT EXISTS (
          SELECT 1 FROM signal_topic_editorial_requests request
          WHERE request.execution_id=e.id
            AND NOT EXISTS (SELECT 1 FROM signal_topic_editorial_reused_decisions_v2 reused
              WHERE reused.request_id=request.id)
            AND NOT EXISTS (SELECT 1 FROM signal_topic_editorial_batch_items_v2 item
              JOIN signal_topic_editorial_calls call ON call.id=item.call_id
              WHERE item.request_id=request.id AND item.validation->>'status'='accepted' AND call.status='settled')
        )
      ORDER BY e.created_at,e.id LIMIT 10`);
    ids = result.rows.map((row: { id: string }) => row.id);
  } finally { client.release(); }
  let dispatched = 0;
  for (const executionId of ids) {
    if (!uuid.test(executionId)) throw new Error("topic_editorial_global_advance_execution_invalid");
    const jobId = advanceJobIdFor(executionId);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") await existing.retry(state);
    } else {
      await queue.add(SIGNAL_TOPIC_EDITORIAL_GLOBAL_ADVANCE_JOB_V2, { execution_id: executionId }, { jobId,
        attempts: 3, backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true, removeOnFail: { age: 604800, count: 500 } });
    }
    dispatched++;
  }
  return { disabled: false, dispatched };
}

export function startSignalTopicEditorialGlobalStageDrainerV2(options: DrainOptions & {
  interval_ms?: number; run_immediately?: boolean;
} = {}) {
  const enabled = signalTopicEditorialGlobalStageConfigurationV2(options.env).enabled;
  let closed = false, pending: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed || !enabled) return Promise.resolve();
    return pending ??= (async () => {
      await drainSignalTopicEditorialGlobalStagesV2(options);
      await drainSignalTopicEditorialGlobalAdvancementsV2(options);
      if (signalTopicEditorialGlobalStageConfigurationV2(options.env).provider_enabled
        && Date.now() >= nextGrammarRetryAt) {
        nextGrammarRetryAt = Date.now() + 30_000;
        const database = options.database ?? (await import("../db/client")).pool;
        await prepareSignalTopicEditorialGlobalStageGrammarRetryV2({ database });
      }
    })().catch(error => {
      console.warn("[signal-topic-editorial-global-stage-v2]", {
        outcome: "dispatch_failed", error: error instanceof Error ? error.name : "unknown_error",
      });
    }).finally(() => { pending = null; });
  };
  const timer = enabled ? setInterval(() => { void drainNow(); }, options.interval_ms ?? 5000) : null;
  timer?.unref?.();
  if (enabled && options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; if (timer) clearInterval(timer); await pending; } };
}

/** Deterministic advancement from a fully accepted screening census. Every
 * next provider manifest is rebuilt from the source plus validated receipts;
 * a queue retry cannot invent or skip a paid request. */
export async function signalTopicEditorialGlobalAdvanceJobV2(
  job: Pick<Job<{ execution_id: string }>, "id" | "data">,
  options: { env?: Environment; database?: Database } = {},
) {
  const flags = signalTopicEditorialGlobalStageConfigurationV2(options.env);
  if (!flags.enabled) return { disabled: true };
  const executionId = job.data?.execution_id;
  if (typeof executionId !== "string" || !uuid.test(executionId) || job.id !== advanceJobIdFor(executionId))
    throw new Error("topic_editorial_global_advance_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const client = await database.connect();
  let owner: { workspace_id: string; actor_user_id: string } | undefined;
  try {
    owner = (await client.query<{ workspace_id: string; actor_user_id: string }>(`SELECT e.workspace_id::text,e.actor_user_id::text
      FROM signal_topic_editorial_executions e JOIN signal_topic_editorial_batch_owners_v2 o
        ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
      WHERE e.id=$1::uuid AND e.plan->>'contract_version'='signal-topic-editorial-admission-header-v3'
        AND e.status IN('queued','running') AND o.stage='review_pending'`, [executionId])).rows[0];
  } finally { client.release(); }
  if (!owner) return { disabled: false, stale: true };
  const source = await loadSignalTopicEditorialGlobalUnitsV2({ database,
    workspace_id: owner.workspace_id, actor_user_id: owner.actor_user_id, execution_id: executionId });
  const snapshotDigest = source.units[0]?.request.identity.snapshot_digest;
  if (!snapshotDigest || source.units.length === 0) throw new Error("topic_editorial_global_stage_source_invalid");
  const screeningDigest = signalTopicEditorialStagedScreeningReviewDigestV2({ units: source.units,
    expected_group_count: source.units.length });
  const stageId = signalTopicEditorialGlobalStageIdV2(executionId, screeningDigest);
  let progress: SignalTopicEditorialGlobalStageProgressV2 | null;
  try { progress = await loadSignalTopicEditorialGlobalStageProgressV2({ database, stage_id: stageId }); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== "topic_editorial_global_stage_missing") throw error;
    progress = null;
  }
  if (progress && (progress.execution_id !== executionId || progress.workspace_id !== owner.workspace_id
    || progress.actor_user_id !== owner.actor_user_id || progress.snapshot_digest !== snapshotDigest
    || progress.screening_review_digest !== screeningDigest || progress.expected_group_count !== source.units.length))
    throw new Error("topic_editorial_global_stage_source_drift");
  let plan: ReturnType<typeof planSignalTopicEditorialGlobalAdvanceV2>;
  try {
    plan = planSignalTopicEditorialGlobalAdvanceV2({ units: source.units, snapshot_digest: snapshotDigest,
      requests: (progress?.requests ?? []).map((request: SignalTopicEditorialGlobalStageProgressV2["requests"][number]) => ({ stage_kind: request.stage_kind,
        round: request.round, batch_index: request.batch_index,
        descriptor: request.descriptor, validation: request.validation,
        call_status: request.call_status, batch_state: request.batch_state,
        retryable_receipt_error: request.retryable_receipt_error }) as SignalTopicEditorialGlobalStageObservationV2) });
  } catch (error) {
    const code = error instanceof Error && /^topic_editorial_[a-z0-9_]{1,100}$/u.test(error.message)
      ? error.message : "topic_editorial_global_stage_plan_invalid";
    if (progress) await markSignalTopicEditorialGlobalStageBlockedV2({ database, stage_id: stageId, error_code: code });
    return { disabled: false, stage_id: stageId, blocked: true, reason: code };
  }
  if (plan.action === "waiting") return { disabled: false, stage_id: stageId, waiting: true };
  if (plan.action === "blocked") {
    if (progress) await markSignalTopicEditorialGlobalStageBlockedV2({ database, stage_id: stageId,
      error_code: plan.reason });
    return { disabled: false, stage_id: stageId, blocked: true, reason: plan.reason };
  }
  if (plan.action === "prepare") {
    const items = buildSignalTopicEditorialGlobalStageItemsV2(stageId, plan.reviews);
    const prepared: string[] = [];
    for (let offset = 0; offset < items.length; offset += 100) {
      const chunk = items.slice(offset, offset + 100);
      const result = await prepareSignalTopicEditorialGlobalStageV2({ database,
        workspace_id: owner.workspace_id, actor_user_id: owner.actor_user_id, execution_id: executionId,
        stage_id: stageId, snapshot_digest: snapshotDigest, screening_review_digest: screeningDigest,
        stage_kind: plan.stage_kind, round: plan.round,
        items: chunk as Parameters<typeof prepareSignalTopicEditorialGlobalStageV2>[0]["items"] });
      prepared.push(result.batch_id);
    }
    return { disabled: false, stage_id: stageId, prepared_batches: prepared };
  }
  const stored = await materializeSignalTopicEditorialStagedGlobalCatalogV2({
    database: database as Parameters<typeof materializeSignalTopicEditorialStagedGlobalCatalogV2>[0]["database"],
    workspace_id: owner.workspace_id, actor_user_id: owner.actor_user_id, execution_id: executionId,
    stage_id: stageId, catalog: plan.catalog,
  });
  return { disabled: false, stage_id: stageId, materialized: true, revision_id: stored.revision_id };
}

/** Only the explicit global provider flag permits the prepared→submitting
 * transition. Polling and import remain recoverable after sends are disabled. */
export async function signalTopicEditorialGlobalStageJobV2(
  job: Pick<Job<{ batch_id: string }>, "id" | "data">,
  options: { env?: Environment; database?: Database; fetch?: typeof globalThis.fetch;
    stores?: SignalTopicEditorialGlobalStageStoresV2 } = {},
) {
  const flags = signalTopicEditorialGlobalStageConfigurationV2(options.env);
  if (!flags.enabled) return { disabled: true };
  const batchId = job.data?.batch_id;
  if (typeof batchId !== "string" || !uuid.test(batchId) || job.id !== jobIdFor(batchId))
    throw new Error("topic_editorial_global_stage_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const stores = options.stores ?? createSignalTopicEditorialGlobalStageRuntimeStoresV2({ database, batch_id: batchId });
  const provider = createAnthropicMessageBatchesClient({
    apiKey: (options.env ?? process.env).ANTHROPIC_API_KEY ?? "", fetch: options.fetch,
  });
  const result = await runSignalTopicEditorialGlobalStageTickV2({ provider, stores: {
    ...stores,
    async markSubmitting(lease) {
      if (!flags.provider_enabled) throw new Error("topic_editorial_global_stage_sends_disabled");
      await stores.markSubmitting(lease);
    },
  } });
  return { disabled: false, result };
}
