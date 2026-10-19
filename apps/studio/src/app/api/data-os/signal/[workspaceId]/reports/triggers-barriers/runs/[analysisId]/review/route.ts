import { z } from "zod";

import { validationError } from "@/lib/api/responses";
import { reviewAndPrepareSignalStrategicReleaseV2 } from "@/lib/data-os/signal-strategic-releases";
import {
  loadSignalTbStrategicReviewScope,
  SIGNAL_TB_REPORT_KEY
} from "@/lib/data-os/signal-strategic-consumption";
import { signalBackendErrorResponse } from "@/lib/data-os/signal-workspace-serving";
import { loadSignalWorkspaceContextForStrategicReview } from "../../../../../../../_lib/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reusable_assertions: z.array(z.object({
    record_tag_id: z.string().uuid(),
    decision: z.enum(["approve", "correct", "reject"]),
    notes: z.string().trim().max(1000).optional(),
    correction: z.object({
      value: z.string().trim().max(500).optional(),
      score: z.number().finite().optional(),
      confidence: z.string().trim().max(80).optional()
    }).optional()
  })).max(500).default([]),
  limitations: z.unknown().optional(),
  release_title: z.string().trim().min(1).max(300).optional()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; analysisId: string }> }
) {
  const { workspaceId, analysisId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForStrategicReview(workspaceId);
  if ("response" in loaded) return loaded.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  const requestKey = request.headers.get("Idempotency-Key")?.trim();
  if (!requestKey) {
    return Response.json(
      { error: "idempotency_key_required", message: "Idempotency-Key is required." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const analysis = await loadSignalTbStrategicReviewScope({
    workspaceId: loaded.workspace.id,
    analysisId
  });
  if (!analysis) {
    return Response.json(
      { error: "not_found", message: "Strategic analysis was not found in this workspace report." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  if (analysis.failed_gates > 0) {
    return Response.json(
      { error: "quality_gates_failed", message: "All strategic release quality gates must pass before Review." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    const result = await reviewAndPrepareSignalStrategicReleaseV2({
      workspaceId: loaded.workspace.id,
      tbAnalysisId: analysisId,
      reviewerUserId: loaded.session.appUser.id,
      idempotencyKey: requestKey,
      limitations: parsed.data.limitations,
      releaseTitle: parsed.data.release_title,
      reusableAssertions: parsed.data.reusable_assertions.map((assertion) => ({
        recordTagId: assertion.record_tag_id,
        decision: assertion.decision,
        notes: assertion.notes,
        correction: assertion.correction
      }))
    });
    return Response.json({
      workspace_id: loaded.workspace.id,
      report_key: SIGNAL_TB_REPORT_KEY,
      ...result
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "strategic_review_failed";
    if (
      message.startsWith("signal_review_")
      || message.startsWith("signal_release_")
      || message.includes("snapshot containment")
      || (error && typeof error === "object" && "code" in error
        && ["23505", "23514"].includes(String((error as { code?: unknown }).code)))
    ) {
      return Response.json(
        { error: "strategic_review_conflict", message: message.slice(0, 300) },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return signalBackendErrorResponse(error);
  }
}
