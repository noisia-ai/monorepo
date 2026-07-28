import { z } from "zod";

import { loadSignalWorkspaceContext } from "@/app/api/data-os/_lib/load";
import { forbidden, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { reviewSignalTaxonomyProfileV1 } from "@/lib/data-os/signal-topics-narratives-admin";
import {
  loadSignalTaxonomyCoverageV1,
  reconcileSignalTaxonomyProfileV1
} from "@/lib/data-os/signal-topics-narratives-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  notes: z.string().trim().min(1).max(2000).optional()
}).superRefine((value, context) => {
  if (value.action === "reject" && !value.notes) {
    context.addIssue({
      code: "custom",
      path: ["notes"],
      message: "Rejecting a taxonomy profile requires notes."
    });
  }
});

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; profileId: string }> }
) {
  const { workspaceId, profileId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (
    !loaded.isInternalUser
    || !canManageCorpus(loaded.session.appUser.primaryRole)
  ) return forbidden();
  const [reconciliation, coverage] = await Promise.all([
    reconcileSignalTaxonomyProfileV1({
      workspace: loaded.workspace,
      profile_id: profileId
    }),
    loadSignalTaxonomyCoverageV1({
      workspace: loaded.workspace,
      profile_id: profileId,
      include_emerging_candidates:
        new URL(request.url).searchParams.get("include_emerging_candidates") === "true"
    })
  ]);
  if (!reconciliation) {
    return Response.json({
      error: "not_available",
      message: "Taxonomy profile was not found in this workspace."
    }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json({
    contract_version: "signal-topics-narratives-v1",
    reconciliation,
    coverage
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; profileId: string }> }
) {
  const { workspaceId, profileId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (
    !loaded.isInternalUser
    || !canManageCorpus(loaded.session.appUser.primaryRole)
  ) return forbidden();
  const parsed = reviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const reviewed = await reviewSignalTaxonomyProfileV1({
      workspace: loaded.workspace,
      profile_id: profileId,
      reviewer_user_id: loaded.session.appUser.id,
      action: parsed.data.action,
      notes: parsed.data.notes
    });
    if (!reviewed) {
      return Response.json({
        error: "not_available",
        message: "Taxonomy profile was not found in this workspace."
      }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json({
      contract_version: "signal-topics-narratives-v1",
      profile: reviewed
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({
      error: "invalid_filter",
      message: error instanceof Error ? error.message : "Taxonomy review failed."
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
}
