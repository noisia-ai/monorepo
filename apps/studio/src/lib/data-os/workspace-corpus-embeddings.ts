import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1, loadSignalWorkspaceEmbeddingsStoreV1,
  readSignalProcessingPolicyWithQueryableV1, quoteSignalWorkspaceEmbeddingsStoreV1, requestSignalWorkspaceEmbeddingsStoreV1 } from "@noisia/db";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1 } from "@noisia/query-engine";
export { SignalWorkspaceEmbeddingsError } from "@noisia/db";
export class WorkspaceCorpusEmbeddingsError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = "WorkspaceCorpusEmbeddingsError"; }
}
type Database = Pick<Pool, "query" | "connect">;
type AccessArgs = { database?: Database; workspaceId: string; actorUserId: string };
export type WorkspaceCorpusEmbeddingRequestV1 = { preparation_run_id: string; quote_digest: string; hard_cap_micro_usd: number | null };

export function workspaceEmbeddingRuntimeSettingsV1(env: Record<string, string | undefined> = process.env) {
  const raw = env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD;
  const cap = raw === undefined ? (env.NOISIA_MENTION_FACETS_ENABLED === "true" ? null : SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1)
    : /^\d+$/u.test(raw) ? Number(raw) : NaN;
  if (cap !== null && (!Number.isSafeInteger(cap) || cap < 0)) throw new WorkspaceCorpusEmbeddingsError("workspace_embedding_budget_configuration_invalid", 503);
  return { provider_available: env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED === "true" && Boolean(env.VOYAGE_API_KEY?.trim()),
    max_run_cost_micro_usd: cap };
}
async function authorize(args: AccessArgs, execute: boolean) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId });
  const mfp = process.env.NOISIA_MENTION_FACETS_ENABLED === "true";
  const allowed = mfp ? caps.can_request_processing : caps.can_execute_topics;
  if (!caps.can_view || execute && !allowed) throw new WorkspaceCorpusEmbeddingsError("workspace_embedding_forbidden", 403);
  const runtime = workspaceEmbeddingRuntimeSettingsV1();
  let maximum = runtime.max_run_cost_micro_usd;
  let policyAllows = true;
  if (mfp) {
    const policy = await readSignalProcessingPolicyWithQueryableV1({ queryable: database, workspace_id: args.workspaceId,
      actor_user_id: args.actorUserId, action_availability: { corpus_embeddings: runtime.provider_available } });
    const action = policy.actions.find(item => item.action === "corpus_embeddings");
    policyAllows = Boolean(action && !["missing", "expired", "revoked"].includes(policy.status));
    if (action?.max_execution_micro_usd !== undefined && action.max_execution_micro_usd !== null) {
      const policyCap = Number(action.max_execution_micro_usd);
      if (!Number.isSafeInteger(policyCap) || policyCap < 0) throw new WorkspaceCorpusEmbeddingsError("workspace_embedding_budget_configuration_invalid", 503);
      maximum = maximum === null ? policyCap : Math.min(maximum, policyCap);
    }
  }
  return { database, flags: { ...runtime, max_run_cost_micro_usd: maximum, optional_strict_cap: mfp, can_execute: allowed && policyAllows,
    request_scope: `sha256:${createHash("sha256").update(JSON.stringify(["workspace-embeddings-v1", args.workspaceId, args.actorUserId])).digest("hex")}` } };
}
export async function loadWorkspaceCorpusEmbeddingsForActorV1(args: AccessArgs & { idempotencyKey?: string }) {
  const access = await authorize(args, false);
  const result = await loadSignalWorkspaceEmbeddingsStoreV1({ queryable: access.database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId, idempotency_key: args.idempotencyKey });
  return { ...result, ...access.flags };
}
export async function quoteWorkspaceCorpusEmbeddingsForActorV1(args: AccessArgs) {
  const access = await authorize(args, false);
  return { ...await quoteSignalWorkspaceEmbeddingsStoreV1({ database: access.database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 }), ...access.flags };
}
export async function requestWorkspaceCorpusEmbeddingsForActorV1(args: AccessArgs & {
  idempotencyKey: string; body: WorkspaceCorpusEmbeddingRequestV1;
}) {
  const access = await authorize(args, true);
  if (!validateWorkspaceCorpusEmbeddingRequestV1(args.body)) throw new WorkspaceCorpusEmbeddingsError("workspace_embedding_request_invalid", 422);
  if (args.body.hard_cap_micro_usd === null && !access.flags.optional_strict_cap
    || access.flags.max_run_cost_micro_usd !== null && (args.body.hard_cap_micro_usd === null || args.body.hard_cap_micro_usd > access.flags.max_run_cost_micro_usd)) throw new WorkspaceCorpusEmbeddingsError("workspace_embedding_budget_exceeds_limit", 422);
  // The store checks the current complete cache plan inside admission. A zero
  // cap supplied by the caller cannot authorize a missing input or provider call.
  await requestSignalWorkspaceEmbeddingsStoreV1({ database: access.database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId, idempotency_key: args.idempotencyKey,
    ...args.body, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, provider_available: access.flags.provider_available });
  return loadWorkspaceCorpusEmbeddingsForActorV1({ ...args, database: access.database });
}
export function validateWorkspaceCorpusEmbeddingRequestV1(value: unknown): value is WorkspaceCorpusEmbeddingRequestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).sort().join(",") === "hard_cap_micro_usd,preparation_run_id,quote_digest"
    && typeof body.preparation_run_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(body.preparation_run_id)
    && typeof body.quote_digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(body.quote_digest)
    && (body.hard_cap_micro_usd === null || typeof body.hard_cap_micro_usd === "number" && Number.isSafeInteger(body.hard_cap_micro_usd) && body.hard_cap_micro_usd >= 0);
}
