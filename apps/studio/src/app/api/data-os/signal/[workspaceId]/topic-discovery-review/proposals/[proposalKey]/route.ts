import { loadSignalWorkspaceContext } from "../../_lib";
import {
  handleTopicDiscoveryProposalDetail,
  topicDiscoveryReviewErrorResponse
} from "@/lib/data-os/signal-topic-discovery-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: {
  params: Promise<{ workspaceId: string; proposalKey: string }>;
}) {
  const { workspaceId, proposalKey } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return await handleTopicDiscoveryProposalDetail(request, loaded, proposalKey);
  } catch (error) {
    return topicDiscoveryReviewErrorResponse(error);
  }
}
