import {
  loadSignalBrandContextProcessingQuoteV1,
  signalBrandContextPreparationRuntimeFromEnvV1,
  type SignalBrandContextPreparationRuntimeV1
} from "@noisia/db";

import { loadSemanticContextProposalRuntimeReadiness } from "@/lib/queue/data-os";
import { toClientBrandContextProcessingQuoteViewV1 } from "./client-brand-context-processing-quote";

type Database = Parameters<typeof loadSignalBrandContextProcessingQuoteV1>[0]["database"];

export function signalBrandContextProcessingActionAvailabilityV1(runtime: SignalBrandContextPreparationRuntimeV1) {
  const workerReady = runtime.queue_configured && runtime.worker_alive;
  return {
    brand_context_proposal: workerReady && runtime.recovery_alive && runtime.semantic.available,
    topic_prototype_embeddings: workerReady && runtime.prototype.available
  };
}

async function loadRuntime() {
  return signalBrandContextPreparationRuntimeFromEnvV1(
    process.env,
    await loadSemanticContextProposalRuntimeReadiness()
  );
}

export async function loadClientBrandContextProcessingQuoteForActorV1(args: {
  workspaceId: string;
  actorUserId: string;
  database?: Database;
  runtimeLoader?: () => Promise<SignalBrandContextPreparationRuntimeV1>;
}) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  let actionAvailability = {
    brand_context_proposal: false,
    topic_prototype_embeddings: false
  };
  try {
    actionAvailability = signalBrandContextProcessingActionAvailabilityV1(
      await (args.runtimeLoader ?? loadRuntime)()
    );
  } catch {
    // A missing or invalid server configuration is unavailable. It never becomes browser authority.
  }
  const quote = await loadSignalBrandContextProcessingQuoteV1({
    database,
    workspace_id: args.workspaceId,
    actor_user_id: args.actorUserId,
    action_availability: actionAvailability
  });
  return toClientBrandContextProcessingQuoteViewV1(quote);
}
