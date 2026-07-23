import { z } from "zod";

import { forbidden, validationError } from "@/lib/api/responses";
import { loadSignalWorkspaceContext } from "../../../_lib/load";
import {
  canManageSignalStrategicReleases,
  createSignalStrategicReleaseDraft,
  loadSignalStrategicReleasesV1,
  promoteSignalStrategicRelease
} from "@/lib/data-os/signal-strategic-releases";
import {
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const releaseActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_draft"),
    tb_analysis_id: z.string().uuid(),
    title: z.string().trim().min(1).max(300).optional()
  }),
  z.object({
    action: z.literal("promote"),
    release_id: z.string().uuid()
  })
]);

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const payload = await loadSignalStrategicReleasesV1(
      loaded.workspace,
      loaded.isInternalUser
    );
    return signalJsonResponse(request, payload, {
      etagSeed: JSON.stringify(payload.history.map((release) => [
        release.release_id,
        release.status,
        release.published_at,
        release.is_current
      ])),
      state: payload.current ? "fresh" : "not_available"
    });
  } catch (error) {
    return signalBackendErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (
    !canManageSignalStrategicReleases(
      loaded.isInternalUser,
      loaded.session.appUser.primaryRole
    )
  ) {
    return forbidden();
  }

  const parsed = releaseActionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const result = parsed.data.action === "create_draft"
      ? await createSignalStrategicReleaseDraft({
          workspaceId: loaded.workspace.id,
          tbAnalysisId: parsed.data.tb_analysis_id,
          title: parsed.data.title,
          createdByUserId: loaded.session.appUser.id
        })
      : await promoteSignalStrategicRelease({
          workspaceId: loaded.workspace.id,
          releaseId: parsed.data.release_id,
          reviewerUserId: loaded.session.appUser.id
        });
    if (!result) {
      return Response.json(
        { error: "not_available", message: "Strategic release was not found." },
        { status: 404, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return Response.json(
      result,
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("signal_release_")) {
      return Response.json(
        { error: "not_available", message: error.message },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return signalBackendErrorResponse(error);
  }
}
