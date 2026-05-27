import { and, eq, like } from "drizzle-orm";

import { tbAnalyses, tbQualityGates } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canApproveAnalysis } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; analysisId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canApproveAnalysis(session.appUser.primaryRole)) return forbidden();

  const { id, analysisId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({})) as { approve_with_warnings?: unknown };
  const approveWithWarnings = body.approve_with_warnings === true;

  const [currentAnalysis] = await db
    .select({
      id: tbAnalyses.id,
      limitations: tbAnalyses.limitations
    })
    .from(tbAnalyses)
    .where(and(eq(tbAnalyses.id, analysisId), eq(tbAnalyses.studyCorpusId, corpus.id)))
    .limit(1);

  if (!currentAnalysis) {
    return Response.json({ error: "not_found", message: "Analysis not found." }, { status: 404 });
  }

  const failedGates = await db
    .select({
      gateName: tbQualityGates.gateName,
      notes: tbQualityGates.notes
    })
    .from(tbQualityGates)
    .where(and(
      eq(tbQualityGates.tbAnalysisId, analysisId),
      like(tbQualityGates.gateName, "post_%"),
      eq(tbQualityGates.passed, false)
    ));

  if (failedGates.length > 0 && !approveWithWarnings) {
    return Response.json(
      {
        error: "quality_gates_failed",
        message: "Hay chequeos con advertencia. Confirma si quieres aprobar de todas formas.",
        gates: failedGates
      },
      { status: 409 }
    );
  }

  const approvalLimitations = failedGates.length > 0
    ? normalizeLimitations(currentAnalysis.limitations).concat({
        source: "im_approval_override",
        level: "warning",
        message: "El Insights Manager aprobó la síntesis con chequeos de calidad pendientes.",
        gates: failedGates,
        approved_at: new Date().toISOString(),
        approved_by_user_id: session.appUser.id
      })
    : currentAnalysis.limitations;

  const [updated] = await db
    .update(tbAnalyses)
    .set({
      status: "approved_by_im",
      currentStep: "done",
      limitations: approvalLimitations,
      approvedByImUserId: session.appUser.id,
      imApprovedAt: new Date(),
      updatedAt: new Date()
    })
    .where(and(eq(tbAnalyses.id, analysisId), eq(tbAnalyses.studyCorpusId, corpus.id)))
    .returning({ id: tbAnalyses.id, status: tbAnalyses.status });

  if (!updated) {
    return Response.json({ error: "not_found", message: "Analysis not found." }, { status: 404 });
  }

  return Response.json({ ok: true, analysis: updated });
}

function normalizeLimitations(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}
