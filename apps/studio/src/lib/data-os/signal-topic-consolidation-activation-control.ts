import type { Pool } from "pg";
import {
  loadSignalTopicConsolidationActivationStatusV1,
  mutateSignalTopicConsolidationBindingV1,
  prepareSignalTopicConsolidationSnapshotV1
} from "@noisia/db";

type Scope = {
  database?: Pick<Pool, "connect">;
  workspaceId: string;
  actorUserId: string;
};

async function scoped(scope: Scope) {
  return {
    database: scope.database ?? (await import("@/lib/db")).pool,
    workspace_id: scope.workspaceId,
    actor_user_id: scope.actorUserId
  };
}

export async function loadWorkspaceTopicConsolidationActivationV1(scope: Scope) {
  return loadSignalTopicConsolidationActivationStatusV1(await scoped(scope));
}

export async function prepareWorkspaceTopicConsolidationActivationV1(
  scope: Scope & { revisionId: string; revisionDigest: string }
) {
  return prepareSignalTopicConsolidationSnapshotV1({
    ...(await scoped(scope)),
    revision_id: scope.revisionId,
    revision_digest: scope.revisionDigest
  });
}

export async function mutateWorkspaceTopicConsolidationActivationV1(
  scope: Scope & { idempotencyKey: string; command: unknown }
) {
  return mutateSignalTopicConsolidationBindingV1({
    ...(await scoped(scope)),
    idempotency_key: scope.idempotencyKey,
    command: scope.command
  });
}
