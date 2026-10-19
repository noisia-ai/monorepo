import { loadSignalWorkspaceContextForStrategicReview } from "../../../../_lib/load";
import {
  handleSignalSemanticAssertionCreation,
  signalSemanticReviewApiDependencies
} from "@/lib/data-os/signal-semantic-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return handleSignalSemanticAssertionCreation(request, workspaceId, {
    ...signalSemanticReviewApiDependencies,
    loadContext: loadSignalWorkspaceContextForStrategicReview
  });
}
