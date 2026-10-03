import { loadSignalWorkspaceContextForStrategicReview } from "../../../../../../_lib/load";
import {
  handleSignalSemanticAssertionSupersession,
  signalSemanticReviewApiDependencies
} from "@/lib/data-os/signal-semantic-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: {
  params: Promise<{ workspaceId: string; assertionId: string }>;
}) {
  const { workspaceId, assertionId } = await context.params;
  return handleSignalSemanticAssertionSupersession(request, workspaceId, assertionId, {
    ...signalSemanticReviewApiDependencies,
    loadContext: loadSignalWorkspaceContextForStrategicReview
  });
}
