import type { Pool } from "pg";
import {
  loadSignalWorkspaceCapabilitiesStoreV1,
  loadSignalWorkspaceCorpusPreparationStoreV1,
  requestSignalWorkspaceCorpusPreparationStoreV1
} from "@noisia/db";

export { SignalWorkspaceCorpusPreparationError } from "@noisia/db";

export class WorkspaceCorpusPreparationError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "WorkspaceCorpusPreparationError";
  }
}

type Database = Pick<Pool, "query" | "connect">;
type AccessArgs = { database?: Database; workspaceId: string; actorUserId: string };

async function authorize(args: AccessArgs, mutation: boolean) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({
    queryable: database, workspace_id: args.workspaceId, actor_user_id: args.actorUserId
  });
  // Preparing stored text is a provider-free data operation. It does not grant
  // permission to execute Topics models, approve attribution, or publish Signal.
  if (!capabilities.can_view || (mutation && !capabilities.can_import_mentions)) {
    throw new WorkspaceCorpusPreparationError("corpus_preparation_forbidden", 403);
  }
  return { database, can_prepare: capabilities.can_import_mentions };
}

export async function loadWorkspaceCorpusPreparationForActorV1(args: AccessArgs) {
  const access = await authorize(args, false);
  const result = await loadSignalWorkspaceCorpusPreparationStoreV1({
    queryable: access.database, workspace_id: args.workspaceId
  });
  return { ...result, can_prepare: access.can_prepare };
}

export async function requestWorkspaceCorpusPreparationForActorV1(args: AccessArgs & {
  idempotencyKey: string;
}) {
  const access = await authorize(args, true);
  if (args.idempotencyKey.length < 8 || args.idempotencyKey.length > 200) {
    throw new WorkspaceCorpusPreparationError("idempotency_key_required", 400);
  }
  await requestSignalWorkspaceCorpusPreparationStoreV1({
    database: access.database, workspace_id: args.workspaceId,
    actor_user_id: args.actorUserId, idempotency_key: args.idempotencyKey
  });
  return loadWorkspaceCorpusPreparationForActorV1({ ...args, database: access.database });
}

export function validateCorpusPreparationRequestV1(value: unknown): value is Record<string, never> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 0;
}
