import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1, loadSignalWorkspaceTopicPrototypesV1,
  quoteSignalWorkspaceTopicPrototypesV1, initializeSignalWorkspaceTopicPrototypeCatalogV1 } from "@noisia/db";
import { WorkspaceCorpusEmbeddingsError, workspaceEmbeddingRuntimeSettingsV1 } from "./workspace-corpus-embeddings";

type Access = { database?: Pick<Pool, "query" | "connect">; workspaceId: string; actorUserId: string };
export type WorkspaceTopicPrototypeRequestV1 = { plan_digest: string; quote_digest: string; hard_cap_micro_usd: number };
async function authorize(args: Access, execute: boolean) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: database, workspace_id: args.workspaceId, actor_user_id: args.actorUserId });
  if (!caps.can_view || execute && !caps.can_execute_topics) throw new WorkspaceCorpusEmbeddingsError("workspace_embedding_forbidden", 403);
  return { database, flags: { ...workspaceEmbeddingRuntimeSettingsV1(), can_execute: caps.can_execute_topics,
    request_scope: `sha256:${createHash("sha256").update(JSON.stringify(["workspace-topic-prototypes-v1", args.workspaceId, args.actorUserId])).digest("hex")}` } };
}
export async function loadWorkspaceTopicPrototypesForActorV1(args: Access & { idempotencyKey?: string }) {
  const access = await authorize(args, false);
  return { ...await loadSignalWorkspaceTopicPrototypesV1({ database: access.database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId, idempotency_key: args.idempotencyKey }), ...access.flags };
}
export async function quoteWorkspaceTopicPrototypesForActorV1(args: Access) {
  const access = await authorize(args, false);
  return { ...await quoteSignalWorkspaceTopicPrototypesV1({ database: access.database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId }), ...access.flags };
}
export async function requestWorkspaceTopicPrototypesForActorV1(args: Access & { idempotencyKey: string; body: WorkspaceTopicPrototypeRequestV1 }) {
  await authorize(args, true);
  if (!validateWorkspaceTopicPrototypeRequestV1(args.body)) throw new WorkspaceCorpusEmbeddingsError("workspace_embedding_request_invalid", 422);
  // Topic-prototype provider work is authorized only by the composed Brand OS
  // processing receipt. The former direct request produced runs that the Worker
  // correctly could not claim because they had neither that receipt nor a
  // processing admission. Keep the read/quote contract for old receipts, but
  // reject new direct writes before creating another unreachable run.
  throw new WorkspaceCorpusEmbeddingsError("processing_admission_required", 409);
}
export function validateWorkspaceTopicPrototypeRequestV1(value: unknown): value is WorkspaceTopicPrototypeRequestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).sort().join(",") === "hard_cap_micro_usd,plan_digest,quote_digest"
    && typeof body.plan_digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(body.plan_digest)
    && typeof body.quote_digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(body.quote_digest)
    && typeof body.hard_cap_micro_usd === "number" && Number.isSafeInteger(body.hard_cap_micro_usd) && body.hard_cap_micro_usd >= 0;
}

export async function initializeWorkspaceTopicPrototypeContextForActorV1(args: Access) {
  const access = await authorize(args, true);
  await initializeSignalWorkspaceTopicPrototypeCatalogV1({ database: access.database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId });
  return loadWorkspaceTopicPrototypesForActorV1({ ...args, database: access.database });
}
export function isWorkspaceTopicPrototypeContextInitializationV1(value: unknown): value is { action: "initialize_context" } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 1 && (value as { action?: unknown }).action === "initialize_context");
}
