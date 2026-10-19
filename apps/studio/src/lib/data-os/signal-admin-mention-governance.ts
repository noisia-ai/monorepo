import {
  mutateSignalCanonicalMentionGovernanceV1,
  SignalMentionGovernanceContractError,
  type SignalMentionGovernanceActionV1
} from "@noisia/db";
import type { PoolClient } from "pg";

import { pool } from "@/lib/db";

export { SignalMentionGovernanceContractError };

export async function mutateWorkspaceCanonicalMentionGovernance(args: {
  workspaceId: string;
  mentionId: string;
  actorUserId: string;
  action: SignalMentionGovernanceActionV1;
  reason: string;
  idempotencyKey: string;
}) {
  return withTransaction((client) => mutateSignalCanonicalMentionGovernanceV1(client, {
    workspace_id: args.workspaceId,
    mention_id: args.mentionId,
    actor_user_id: args.actorUserId,
    action: args.action,
    reason: args.reason,
    idempotency_key: args.idempotencyKey
  }));
}

async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
