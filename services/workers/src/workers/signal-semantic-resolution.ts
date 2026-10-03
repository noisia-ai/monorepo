import type { Job } from "bullmq";
import { z } from "zod";

import {
  applySignalSemanticResolutionDecisionV1,
  attachSignalSemanticResolutionMessageBatchV1,
  completeSignalSemanticResolutionRunV1,
  failSignalSemanticResolutionItemV1,
  failSignalSemanticResolutionRunV1,
  loadLatestSignalSemanticResolutionRunV1,
  loadSignalSemanticResolutionBatchV1,
  loadSignalSemanticResolutionGovernedContextV1,
  markSignalSemanticResolutionProviderResultsImportedV1,
  markSignalSemanticResolutionRunRunningV1,
  recordSignalSemanticResolutionProviderResultV1,
  refreshSignalSemanticResolutionRunCountsV1,
  reserveSignalSemanticResolutionMessageBatchV1,
  updateSignalSemanticResolutionMessageBatchV1
} from "@noisia/db";
import {
  SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION,
  type SignalSemanticResolutionDecisionV1,
  type SignalSemanticResolutionJobDataV1
} from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  mapSignalSemanticResolutionSingleOutputV1,
  signalSemanticResolutionMentionIdFromCustomIdV1,
  signalSemanticResolutionSingleOutputSchemaV1
} from "./signal-semantic-resolution-contract";
import {
  createSignalSemanticResolutionMessageBatchV1,
  getSignalSemanticResolutionMessageBatchV1,
  loadSignalSemanticResolutionMessageBatchResultsV1,
  parseSignalSemanticResolutionBatchMessageTextV1,
  signalSemanticResolutionBatchErrorCodeV1,
  signalSemanticResolutionBatchUsageV1,
  type AnthropicMessageBatchV1
} from "./signal-semantic-resolution-message-batch";

const PROVIDER_POLL_INTERVAL_MS = 15_000;
const PROVIDER_BATCH_ITEM_LIMIT = 100_000;

export async function signalSemanticResolutionJob(
  job: Job<SignalSemanticResolutionJobDataV1>
) {
  const data = validateJobData(job.data);
  const initial = await loadLatestSignalSemanticResolutionRunV1(pool, data.workspace_id);
  if (!initial || initial.run_id !== data.run_id) throw new Error("semantic_resolution_run_not_found");
  if (initial.status === "completed" || initial.status === "partial") {
    return { run_id: initial.run_id, reconciliation_only: true };
  }
  if (initial.model_version !== data.model_version) throw new Error("semantic_resolution_model_mismatch");
  if (initial.budget_cap_usd !== data.budget_cap_usd) throw new Error("semantic_resolution_budget_mismatch");

  try {
    await markSignalSemanticResolutionRunRunningV1(pool, initial.run_id);
    const governedContext = await loadSignalSemanticResolutionGovernedContextV1(
      pool,
      data.workspace_id
    );

    await applyPreparedDecisions({ job, data, governedContext });
    let run = requiredCurrentRun(await loadLatestSignalSemanticResolutionRunV1(pool, data.workspace_id), initial.run_id);
    const pending = await loadSignalSemanticResolutionBatchV1(pool, {
      run_id: initial.run_id,
      limit: PROVIDER_BATCH_ITEM_LIMIT
    });
    if (pending.length === 0) {
      await completeSignalSemanticResolutionRunV1(pool, initial.run_id);
      return { run_id: initial.run_id, status: "completed", provider_batch_id: null };
    }

    let batch: AnthropicMessageBatchV1;
    if (run.provider_batch_id) {
      batch = await getSignalSemanticResolutionMessageBatchV1(run.provider_batch_id);
    } else {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await reserveSignalSemanticResolutionMessageBatchV1(client, initial.run_id);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      batch = await createSignalSemanticResolutionMessageBatchV1({
        model: data.model_version,
        governedContext,
        mentions: pending
      });
      await attachSignalSemanticResolutionMessageBatchV1(pool, {
        run_id: initial.run_id,
        provider_batch_id: batch.id,
        provider_batch_status: batch.processing_status,
        counts: batch.request_counts,
        ended_at: batch.ended_at
      });
    }

    while (batch.processing_status !== "ended") {
      await updateSignalSemanticResolutionMessageBatchV1(pool, {
        run_id: initial.run_id,
        provider_batch_id: batch.id,
        provider_batch_status: batch.processing_status,
        counts: batch.request_counts,
        ended_at: batch.ended_at
      });
      await job.updateProgress({
        phase: "provider",
        processed: providerProcessed(batch),
        total: initial.total_items
      });
      await delay(PROVIDER_POLL_INTERVAL_MS);
      batch = await getSignalSemanticResolutionMessageBatchV1(batch.id);
    }
    await updateSignalSemanticResolutionMessageBatchV1(pool, {
      run_id: initial.run_id,
      provider_batch_id: batch.id,
      provider_batch_status: "ended",
      counts: batch.request_counts,
      ended_at: batch.ended_at
    });

    const results = await loadSignalSemanticResolutionMessageBatchResultsV1(batch);
    let imported = 0;
    for (const result of results) {
      const mentionId = signalSemanticResolutionMentionIdFromCustomIdV1(result.custom_id);
      if (result.result.type === "succeeded") {
        const usage = signalSemanticResolutionBatchUsageV1(result.result);
        try {
          const output = signalSemanticResolutionSingleOutputSchemaV1.parse(
            parseSignalSemanticResolutionBatchMessageTextV1(result.result)
          );
          const decision = mapSignalSemanticResolutionSingleOutputV1({
            mentionId,
            output,
            governedContext
          });
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await recordSignalSemanticResolutionProviderResultV1(client, {
              run_id: initial.run_id,
              provider_custom_id: result.custom_id,
              result_status: "succeeded",
              decision,
              ...usage
            });
            await applySignalSemanticResolutionDecisionV1(client, {
              run_id: initial.run_id,
              mention_id: mentionId,
              reviewer_user_id: data.requested_by_user_id,
              model_version: data.model_version,
              decision
            });
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            await recordSucceededButInvalidResult({
              runId: initial.run_id,
              customId: result.custom_id,
              mentionId,
              usage,
              error
            });
          } finally {
            client.release();
          }
        } catch (error) {
          await recordSucceededButInvalidResult({
            runId: initial.run_id,
            customId: result.custom_id,
            mentionId,
            usage,
            error
          });
        }
      } else {
        const errorCode = signalSemanticResolutionBatchErrorCodeV1(result.result);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await recordSignalSemanticResolutionProviderResultV1(client, {
            run_id: initial.run_id,
            provider_custom_id: result.custom_id,
            result_status: result.result.type,
            error_code: errorCode
          });
          await failSignalSemanticResolutionItemV1(client, {
            run_id: initial.run_id,
            mention_id: mentionId,
            error_code: errorCode
          });
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }
      imported += 1;
      if (imported % 25 === 0 || imported === results.length) {
        await refreshSignalSemanticResolutionRunCountsV1(pool, initial.run_id);
        run = requiredCurrentRun(
          await loadLatestSignalSemanticResolutionRunV1(pool, data.workspace_id),
          initial.run_id
        );
        await job.updateProgress({
          phase: "applying",
          processed: run.completed_items + run.failed_items,
          total: initial.total_items
        });
      }
    }

    await markSignalSemanticResolutionProviderResultsImportedV1(pool, initial.run_id);
    await completeSignalSemanticResolutionRunV1(pool, initial.run_id);
    const completed = requiredCurrentRun(
      await loadLatestSignalSemanticResolutionRunV1(pool, data.workspace_id),
      initial.run_id
    );
    return {
      run_id: initial.run_id,
      status: completed.status,
      provider_batch_id: batch.id,
      completed_items: completed.completed_items,
      failed_items: completed.failed_items,
      actual_cost_usd: completed.actual_cost_usd
    };
  } catch (error) {
    if (isFinalAttempt(job)) {
      await failSignalSemanticResolutionRunV1(pool, initial.run_id, safeError(error)).catch(() => undefined);
    }
    throw error;
  }
}

async function applyPreparedDecisions(args: {
  job: Job<SignalSemanticResolutionJobDataV1>;
  data: SignalSemanticResolutionJobDataV1;
  governedContext: Awaited<ReturnType<typeof loadSignalSemanticResolutionGovernedContextV1>>;
}) {
  const rows = await loadSignalSemanticResolutionBatchV1(pool, {
    run_id: args.data.run_id,
    limit: PROVIDER_BATCH_ITEM_LIMIT
  });
  for (const mention of rows.filter((row) => row.prepared_decision !== null)) {
    const decision = mention.prepared_decision!;
    if (decision.mention_id !== mention.mention_id) {
      await failSignalSemanticResolutionItemV1(pool, {
        run_id: args.data.run_id,
        mention_id: mention.mention_id,
        error_code: "semantic_resolution_prepared_mention_mismatch"
      });
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applySignalSemanticResolutionDecisionV1(client, {
        run_id: args.data.run_id,
        mention_id: mention.mention_id,
        reviewer_user_id: args.data.requested_by_user_id,
        model_version: args.data.model_version,
        decision
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await failSignalSemanticResolutionItemV1(pool, {
        run_id: args.data.run_id,
        mention_id: mention.mention_id,
        error_code: safeError(error)
      });
    } finally {
      client.release();
    }
  }
  await refreshSignalSemanticResolutionRunCountsV1(pool, args.data.run_id);
  await args.job.updateProgress({ phase: "prepared", processed: 0, total: rows.length });
}

async function recordSucceededButInvalidResult(args: {
  runId: string;
  customId: string;
  mentionId: string;
  usage: ReturnType<typeof signalSemanticResolutionBatchUsageV1>;
  error: unknown;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await recordSignalSemanticResolutionProviderResultV1(client, {
      run_id: args.runId,
      provider_custom_id: args.customId,
      result_status: "succeeded",
      ...args.usage,
      error_code: safeError(args.error)
    });
    await failSignalSemanticResolutionItemV1(client, {
      run_id: args.runId,
      mention_id: args.mentionId,
      error_code: safeError(args.error)
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function providerProcessed(batch: AnthropicMessageBatchV1) {
  return batch.request_counts.succeeded
    + batch.request_counts.errored
    + batch.request_counts.canceled
    + batch.request_counts.expired;
}

function requiredCurrentRun<T extends { run_id: string } | null>(run: T, runId: string) {
  if (!run || run.run_id !== runId) throw new Error("semantic_resolution_run_changed");
  return run;
}

function validateJobData(value: SignalSemanticResolutionJobDataV1) {
  if (!z.string().uuid().safeParse(value.run_id).success) throw new Error("invalid_semantic_resolution_run_id");
  if (!z.string().uuid().safeParse(value.workspace_id).success) throw new Error("invalid_semantic_resolution_workspace_id");
  if (!z.string().uuid().safeParse(value.requested_by_user_id).success) throw new Error("invalid_semantic_resolution_user_id");
  if (value.policy_version !== SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION) throw new Error("invalid_semantic_resolution_policy");
  if (!value.model_version?.trim()) throw new Error("invalid_semantic_resolution_model");
  if (!Number.isFinite(value.budget_cap_usd) || value.budget_cap_usd < 0) throw new Error("invalid_semantic_resolution_budget");
  return value;
}

function isFinalAttempt(job: Job) {
  const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= attempts;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "semantic_resolution_failed").slice(0, 120);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
