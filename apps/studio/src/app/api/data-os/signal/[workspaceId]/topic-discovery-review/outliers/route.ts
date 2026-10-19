import { loadSignalWorkspaceContext } from "../_lib";
import {
  handleTopicDiscoveryOutliers,
  topicDiscoveryReviewErrorResponse
} from "@/lib/data-os/signal-topic-discovery-review-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return await handleTopicDiscoveryOutliers(request, loaded);
  } catch (error) {
    return topicDiscoveryReviewErrorResponse(error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return handle(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return handle(request, context);
}
