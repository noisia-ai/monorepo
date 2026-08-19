import { loadSignalWorkspaceContextForStrategicReview } from "../../../../_lib/load";
import {
  handleSignalSemanticCandidateGeneration,
  signalSemanticReviewApiDependencies
} from "@/lib/data-os/signal-semantic-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return handleSignalSemanticCandidateGeneration(request, workspaceId, {
    ...signalSemanticReviewApiDependencies,
    loadContext: loadSignalWorkspaceContextForStrategicReview
  });
}
