import { z } from "zod";

import { loadDataOsCorpusContext } from "../../../../../_lib/load";
import { validationError } from "@/lib/api/responses";
import {
  loadAnalysisArtifactReviewHistory,
  reviewAnalysisArtifact
} from "@/lib/data-os/analysis-artifact-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  action: z.enum(["accept", "correct", "limit", "reject"]),
  notes: z.string().trim().min(1).max(2000).optional(),
  patch: z.object({
    title: z.string().trim().max(500).nullable().optional(),
    summary: z.string().trim().max(4000).nullable().optional(),
    content: z.unknown().optional(),
    confidence: z.string().trim().max(100).nullable().optional(),
    metadata: z.record(z.unknown()).optional()
  }).strict().optional()
}).superRefine((value, context) => {
  if (value.action === "correct" && !value.patch) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A correction requires an explicit patch.",
      path: ["patch"]
    });
  }
  if ((value.action === "correct" || value.action === "limit" || value.action === "reject") && !value.notes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.action} requires review notes.`,
      path: ["notes"]
    });
  }
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { id, artifactId } = await context.params;
  const loaded = await loadDataOsCorpusContext(id);
  if ("response" in loaded) return loaded.response;

  return Response.json({
    contract_version: "analysis-artifacts-v1",
    artifact_id: artifactId,
    events: await loadAnalysisArtifactReviewHistory({
      corpusId: loaded.corpus.id,
      artifactId
    })
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { id, artifactId } = await context.params;
  const loaded = await loadDataOsCorpusContext(id);
  if ("response" in loaded) return loaded.response;

  const parsed = reviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  try {
    const reviewed = await reviewAnalysisArtifact({
      corpusId: loaded.corpus.id,
      artifactId,
      reviewerUserId: loaded.session.appUser.id,
      action: parsed.data.action,
      notes: parsed.data.notes,
      patch: parsed.data.patch
    });
    if (!reviewed) {
      return Response.json(
        { error: "not_found", message: "Artifact not found in this corpus." },
        { status: 404 }
      );
    }
    return Response.json({
      contract_version: "analysis-artifacts-v1",
      ...reviewed
    });
  } catch (error) {
    if (error instanceof Error && error.message === "analysis_artifact_revision_superseded") {
      return Response.json(
        {
          error: "conflict",
          message: "This artifact revision was already superseded. Review the latest revision."
        },
        { status: 409 }
      );
    }
    throw error;
  }
}
