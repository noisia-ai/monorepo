import { z } from "zod";

import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import { forbidden, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { reviewSignalTaxonomyTagV1 } from "@/lib/data-os/signal-topics-narratives-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "needs_review"]),
  notes: z.string().trim().min(1).max(2000).optional()
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
      profileId: string;
      tagId: string;
    }>;
  }
) {
  const { workspaceId, profileId, tagId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (
    !loaded.isInternalUser
    || !canManageCorpus(loaded.session.appUser.primaryRole)
  ) return forbidden();
  const parsed = reviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  const reviewed = await reviewSignalTaxonomyTagV1({
    workspace: loaded.workspace,
    profile_id: profileId,
    tag_id: tagId,
    reviewer_user_id: loaded.session.appUser.id,
    action: parsed.data.action,
    notes: parsed.data.notes
  });
  if (!reviewed) {
    return Response.json({
      error: "not_available",
      message: "Taxonomy tag was not found in this profile."
    }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json(reviewed, {
    headers: { "Cache-Control": "private, no-store" }
  });
}
