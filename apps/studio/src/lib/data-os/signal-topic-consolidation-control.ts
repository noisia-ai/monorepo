import type { Pool } from "pg";
import {
  loadSignalTopicConsolidationStatusV1,
  requestSignalTopicConsolidationV1,
  retrySignalTopicConsolidationV1,
  SignalTopicConsolidationControlError,
} from "@noisia/db";
import type { WorkspaceTopicConsolidationReceiptV1 } from "./workspace-topic-consolidation-request";

type Access = { database?: Pick<Pool, "connect">; workspaceId: string; actorUserId: string };
export type WorkspaceTopicConsolidationCommandV1 =
  | { action: "prepare_numeric"; source_execution_id: string; quote_reference: string }
  | { action: "retry_numeric"; execution_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const QUOTE = /^v1\.[0-9]{10}\.[0-9a-f]{64}$/u;
const KEY = /^[A-Za-z0-9._:-]{8,200}$/u;

export function parseWorkspaceTopicConsolidationCommandV1(value: unknown): WorkspaceTopicConsolidationCommandV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.action === "prepare_numeric"
    && Object.keys(row).sort().join("\0") === ["action", "quote_reference", "source_execution_id"].join("\0")
    && typeof row.source_execution_id === "string" && UUID.test(row.source_execution_id)
    && typeof row.quote_reference === "string" && QUOTE.test(row.quote_reference)) {
    return { action: row.action, source_execution_id: row.source_execution_id, quote_reference: row.quote_reference };
  }
  if (row.action === "retry_numeric"
    && Object.keys(row).sort().join("\0") === ["action", "execution_id"].join("\0")
    && typeof row.execution_id === "string" && UUID.test(row.execution_id)) {
    return { action: row.action, execution_id: row.execution_id };
  }
  return null;
}

async function options(args: Access) {
  return { database: args.database ?? (await import("@/lib/db")).pool,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId };
}

export async function loadWorkspaceTopicConsolidationForActorV1(args: Access & { sourceExecutionId?: string }) {
  return loadSignalTopicConsolidationStatusV1({ ...await options(args), source_execution_id: args.sourceExecutionId });
}

export async function requestWorkspaceTopicConsolidationForActorV1(args: Access & {
  idempotencyKey: string; body: unknown;
}): Promise<WorkspaceTopicConsolidationReceiptV1> {
  if (!KEY.test(args.idempotencyKey)) throw new SignalTopicConsolidationControlError("topic_consolidation_request_invalid", 422);
  const command = parseWorkspaceTopicConsolidationCommandV1(args.body);
  if (!command) throw new SignalTopicConsolidationControlError("topic_consolidation_request_invalid", 422);
  const access = await options(args);
  const receipt = command.action === "prepare_numeric"
    ? await requestSignalTopicConsolidationV1({ ...access, source_execution_id: command.source_execution_id,
      idempotency_key: args.idempotencyKey, quote_reference: command.quote_reference })
    : await retrySignalTopicConsolidationV1({ ...access, execution_id: command.execution_id,
      idempotency_key: args.idempotencyKey });
  // The transaction is committed. A separate status read must not turn this
  // durable acceptance into an apparent mutation failure.
  return { contract_version: "signal-topic-consolidation-request-receipt-v1", workspace_id: args.workspaceId,
    action: command.action, execution_id: receipt.execution_id, idempotency_key: args.idempotencyKey,
    replayed: receipt.replayed };
}
