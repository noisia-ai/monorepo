import { loadSignalWorkspaceContextForStrategicReview } from "../../../../../_lib/load";
import {
  handleSignalAdminMentionGovernanceMutation,
  type SignalAdminMentionGovernanceApiDependencies
} from "@/lib/data-os/signal-admin-mention-governance-api";
import { mutateWorkspaceCanonicalMentionGovernance } from "@/lib/data-os/signal-admin-mention-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dependencies = {
  loadContext: loadSignalWorkspaceContextForStrategicReview,
  mutate: mutateWorkspaceCanonicalMentionGovernance
} satisfies SignalAdminMentionGovernanceApiDependencies;

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; mentionId: string }> }
) {
  const { workspaceId, mentionId } = await context.params;
  return handleSignalAdminMentionGovernanceMutation(request, workspaceId, mentionId, dependencies);
}
