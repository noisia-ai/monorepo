import { loadSignalWorkspaceContext } from "../../_lib";
import {
  handleTopicDiscoveryExport,
  topicDiscoveryReviewErrorResponse
} from "@/lib/data-os/signal-topic-discovery-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: {
  params: Promise<{ workspaceId: string; kind: string }>;
}) {
  const { workspaceId, kind } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return await handleTopicDiscoveryExport(request, loaded, kind);
  } catch (error) {
    return topicDiscoveryReviewErrorResponse(error);
  }
}
