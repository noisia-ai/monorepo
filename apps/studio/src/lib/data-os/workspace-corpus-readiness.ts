import {
  loadSignalWorkspaceCapabilitiesStoreV1,
  loadSignalWorkspaceCorpusReadinessStoreV1
} from "@noisia/db";

export class WorkspaceCorpusReadinessError extends Error {
  readonly code = "corpus_readiness_forbidden";
  readonly status = 403;

  constructor() {
    super("Corpus access is unavailable for this actor.");
    this.name = "WorkspaceCorpusReadinessError";
  }
}

/** This is aggregate input coverage, not an analysis or preparation execution. */
export async function loadWorkspaceCorpusReadinessForActorV1(args: {
  queryable?: Parameters<typeof loadSignalWorkspaceCapabilitiesStoreV1>[0]["queryable"];
  workspaceId: string;
  actorUserId: string;
}) {
  const queryable = args.queryable ?? (await import("@/lib/db")).pool;
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({
    queryable,
    workspace_id: args.workspaceId,
    actor_user_id: args.actorUserId
  });
  if (!capabilities.can_view) throw new WorkspaceCorpusReadinessError();
  return loadSignalWorkspaceCorpusReadinessStoreV1({
    queryable,
    workspace_id: args.workspaceId
  });
}
