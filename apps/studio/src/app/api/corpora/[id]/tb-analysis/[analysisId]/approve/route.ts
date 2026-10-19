import { and, eq, like } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";

import { tbAnalyses, tbQualityGates } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canApproveAnalysis } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";
import { approveTbAnalysisWithArtifacts } from "@/lib/data-os/analysis-artifact-graph";
import {
  assessSignalServingReadiness,
  getSignalServingReadiness,
  type SignalServingReadinessAssessment
} from "@/lib/data-os/signal-serving";

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

  const body = await request.json().catch(() => ({})) as {
    approve_with_warnings?: unknown;
    reusable_assertions?: unknown;
  };
  const approveWithWarnings = body.approve_with_warnings === true;
  const reusableAssertions = reusableAssertionSchema.array().max(500).safeParse(body.reusable_assertions ?? []);
  if (!reusableAssertions.success) {
    return Response.json(
      { error: "invalid_reusable_assertions", message: "La selección de enrichment reusable es inválida." },
      { status: 400 }
    );
  }

  const [currentAnalysis] = await db
    .select({
      id: tbAnalyses.id,
      snapshotId: tbAnalyses.snapshotId,
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

  const dataOsReadiness = currentAnalysis.snapshotId
    ? await getSignalServingReadiness({
        analysisId,
        snapshotId: currentAnalysis.snapshotId
      })
    : null;
  const dataOsAssessment: SignalServingReadinessAssessment = dataOsReadiness
    ? assessSignalServingReadiness(dataOsReadiness)
    : {
        ready: false,
        hardBlocks: [{
          code: "snapshot_missing",
          message: "El analisis no esta vinculado a un snapshot inmutable del corpus."
        }],
        warnings: []
      };

  if (!dataOsAssessment.ready) {
    return Response.json(
      {
        error: "data_os_readiness_failed",
        message: "La sintesis no se puede aprobar porque su evidencia relacional esta incompleta.",
        readiness: dataOsReadiness,
        assessment: dataOsAssessment
      },
      { status: 409 }
    );
  }

  const dataOsWarnings = dataOsAssessment.warnings.map((warning) => ({
    gateName: `data_os_${warning.code}`,
    notes: warning.detail ? `${warning.message} ${warning.detail}` : warning.message
  }));
  const approvalWarnings = [...failedGates, ...dataOsWarnings];

  if (approvalWarnings.length > 0 && !approveWithWarnings) {
    return Response.json(
      {
        error: "quality_gates_failed",
        message: "Hay chequeos con advertencia. Confirma si quieres aprobar de todas formas.",
        gates: approvalWarnings,
        readiness: dataOsReadiness,
        assessment: dataOsAssessment
      },
      { status: 409 }
    );
  }

  const approvalLimitations = approvalWarnings.length > 0
    ? normalizeLimitations(currentAnalysis.limitations).concat({
        source: "im_approval_override",
        level: "warning",
        message: "El Insights Manager aprobó la síntesis con chequeos de calidad pendientes.",
        gates: approvalWarnings,
        approved_at: new Date().toISOString(),
        approved_by_user_id: session.appUser.id
      })
    : currentAnalysis.limitations;

  let updated: { id: string; status: string } | null;
  try {
    updated = await approveTbAnalysisWithArtifacts({
      corpusId: corpus.id,
      analysisId,
      reviewerUserId: session.appUser.id,
      limitations: approvalLimitations,
      reusableAssertions: reusableAssertions.data.map((assertion) => ({
        recordTagId: assertion.record_tag_id,
        decision: assertion.decision,
        notes: assertion.notes,
        correction: assertion.correction,
        idempotencyKey: `sha256:${createHash("sha256")
          .update([
            "signal-tb-reusable-assertion-review-v1",
            analysisId,
            assertion.record_tag_id,
            assertion.decision
          ].join("|"), "utf8")
          .digest("hex")}`
      }))
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "analysis_artifact_approval_failed";
    if (detail === "analysis_artifact_graph_missing" || detail === "analysis_artifact_review_state_conflict") {
      return Response.json(
        {
          error: detail,
          message: "La sintesis no se puede aprobar porque su capa de artefactos requiere materializacion o revision."
        },
        { status: 409 }
      );
    }
    throw error;
  }

  if (!updated) {
    return Response.json({ error: "not_found", message: "Analysis not found." }, { status: 404 });
  }

  return Response.json({
    ok: true,
    analysis: updated,
    dataOsReadiness,
    dataOsAssessment
  });
}

const reusableAssertionSchema = z.object({
  record_tag_id: z.string().uuid(),
  decision: z.enum(["approve", "correct", "reject"]),
  notes: z.string().trim().max(1000).optional(),
  correction: z.object({
    value: z.string().trim().max(500).optional(),
    score: z.number().finite().optional(),
    confidence: z.string().trim().max(80).optional()
  }).optional()
});

function normalizeLimitations(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}
