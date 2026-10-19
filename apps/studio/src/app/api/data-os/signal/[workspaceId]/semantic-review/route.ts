import { loadSignalWorkspaceContextForStrategicReview } from "../../../_lib/load";
import {
  handleSignalSemanticReviewList,
  signalSemanticReviewApiDependencies
} from "@/lib/data-os/signal-semantic-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return handleSignalSemanticReviewList(request, workspaceId, {
    ...signalSemanticReviewApiDependencies,
    loadContext: loadSignalWorkspaceContextForStrategicReview
  });
}
