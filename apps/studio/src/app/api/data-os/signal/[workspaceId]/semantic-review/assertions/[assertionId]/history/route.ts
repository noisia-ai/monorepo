import { loadSignalWorkspaceContextForStrategicReview } from "../../../../../../_lib/load";
import {
  handleSignalSemanticAssertionHistory,
  signalSemanticReviewApiDependencies
} from "@/lib/data-os/signal-semantic-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: {
  params: Promise<{ workspaceId: string; assertionId: string }>;
}) {
  const { workspaceId, assertionId } = await context.params;
  return handleSignalSemanticAssertionHistory(workspaceId, assertionId, {
    ...signalSemanticReviewApiDependencies,
    loadContext: loadSignalWorkspaceContextForStrategicReview
  });
}
