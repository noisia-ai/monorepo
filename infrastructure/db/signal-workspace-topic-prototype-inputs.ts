import { buildSignalWorkspaceTopicPrototypePlanV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceTopicInputSnapshotWithQueryableV1,
  type SignalWorkspaceTopicQueryableV1 } from "./signal-workspace-topic-computation";

/** Use inside the caller's UTC transaction: preparation is independent of imports. */
export async function loadSignalWorkspaceTopicPrototypePlanV1(args: {
  queryable: SignalWorkspaceTopicQueryableV1; workspace_id: string; actor_user_id: string;
}) {
  const snapshot = await loadSignalWorkspaceTopicInputSnapshotWithQueryableV1(args);
  return buildSignalWorkspaceTopicPrototypePlanV1({ taxonomy_profile_id: snapshot.profile_id,
    embedding_profile: snapshot.input.embedding_profile, context_digest: snapshot.input.context_digest,
    topics: snapshot.input.topics, texts: snapshot.input.texts });
}
