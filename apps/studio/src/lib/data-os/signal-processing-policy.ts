import {
  loadSignalProcessingPolicyV1,
  SignalProcessingPolicyError,
  type SignalProcessingActionV1
} from "@noisia/db";

export { SignalProcessingPolicyError };

type ProcessingPolicyDatabase = Parameters<typeof loadSignalProcessingPolicyV1>[0]["database"];

/**
 * Policy presence and provider runtime availability are separate. This read path
 * deliberately defaults every provider action to unavailable until its exact
 * product runtime supplies an action-specific health signal.
 */
export async function loadSignalProcessingPolicyForActorV1(args: {
  database?: ProcessingPolicyDatabase;
  workspaceId: string;
  actorUserId: string;
  actionAvailability?: Partial<Record<SignalProcessingActionV1, boolean>>;
}) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  return loadSignalProcessingPolicyV1({
    database,
    workspace_id: args.workspaceId,
    actor_user_id: args.actorUserId,
    action_availability: args.actionAvailability
  });
}
