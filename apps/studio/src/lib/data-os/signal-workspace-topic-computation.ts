import type { Pool } from "pg";
import {
  loadSignalWorkspaceTopicComputationStatusV1,
  loadSignalWorkspaceTopicComputationResultsV1,
  requestSignalWorkspaceTopicComputationV1,
  retrySignalWorkspaceTopicComputationV1,
  SignalWorkspaceTopicComputationError
} from "@noisia/db";

type Access = { database?: Pick<Pool, "query" | "connect">; workspaceId: string; actorUserId: string };
export type WorkspaceTopicComputationRequestV1 = { embedding_run_id: string };
export function validateWorkspaceTopicComputationRequestV1(value: unknown): value is WorkspaceTopicComputationRequestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).join(",") === "embedding_run_id" && typeof body.embedding_run_id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(body.embedding_run_id);
}
async function options(args: Access) {
  return { database: args.database ?? (await import("@/lib/db")).pool,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId };
}
export async function loadWorkspaceTopicComputationForActorV1(args: Access & { idempotencyKey?: string }) {
  return loadSignalWorkspaceTopicComputationStatusV1({ ...await options(args), idempotency_key: args.idempotencyKey });
}
export async function requestWorkspaceTopicComputationForActorV1(args: Access & { idempotencyKey: string; body: unknown }) {
  if (!validateWorkspaceTopicComputationRequestV1(args.body)) throw new SignalWorkspaceTopicComputationError("workspace_topic_request_invalid", 422);
  const opts = await options(args);
  const request = await requestSignalWorkspaceTopicComputationV1({ ...opts, idempotency_key: args.idempotencyKey, embedding_run_id: args.body.embedding_run_id });
  if (request.replayed) {
    const failed = (await opts.database.query<{ failed: boolean }>(`SELECT status='failed' failed FROM signal_topic_catalog_executions
      WHERE id=$1::uuid AND workspace_id=$2::uuid AND actor_user_id=$3::uuid AND idempotency_key=$4`,
      [request.execution_id, args.workspaceId, args.actorUserId, args.idempotencyKey])).rows[0]?.failed;
    // Only an explicit repeated POST resumes a failed run. GET never enqueues work.
    if (failed) await retrySignalWorkspaceTopicComputationV1({ ...opts, execution_id: request.execution_id });
  }
  return loadSignalWorkspaceTopicComputationStatusV1({ ...opts, idempotency_key: args.idempotencyKey });
}
export async function loadWorkspaceTopicComputationResultsForActorV1(args: Access & { executionId: string; termKey: string; cursor?: string }) {
  return loadSignalWorkspaceTopicComputationResultsV1({ ...await options(args), execution_id: args.executionId, term_key: args.termKey, cursor: args.cursor });
}
