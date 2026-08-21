import { loadSignalWorkspaceContextForStrategicReview } from "@/app/api/data-os/_lib/load";
import type { SignalTopicDiscoveryReviewApiContext } from
  "@/lib/data-os/signal-topic-discovery-review-api";

export async function loadSignalWorkspaceContext(workspaceId: string): Promise<
  SignalTopicDiscoveryReviewApiContext | { response: Response }
> {
  const loaded = await loadSignalWorkspaceContextForStrategicReview(workspaceId);
  if ("response" in loaded && loaded.response) return { response: loaded.response };
  if (loaded.session.appUser.userType !== "noisia_internal") {
    return {
      response: Response.json({
        error: "forbidden",
        message: "Topic discovery review requires an internal analysis reviewer."
      }, { status: 403, headers: { "Cache-Control": "private, no-store" } })
    };
  }
  return { workspace: loaded.workspace, actor: loaded.session.appUser };
}
