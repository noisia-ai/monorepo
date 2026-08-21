import { loadSignalWorkspaceContext } from "../_lib";
import {
  handleTopicDiscoveryDraft,
  topicDiscoveryReviewErrorResponse
} from "@/lib/data-os/signal-topic-discovery-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return await handleTopicDiscoveryDraft(request, loaded);
  } catch (error) {
    return topicDiscoveryReviewErrorResponse(error);
  }
}
