import { getQueryEngineQueue } from "@/lib/queue/query-engine";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";
import { queryIterations } from "@noisia/db";
import { eq, and } from "drizzle-orm";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; iterationId: string }> }
) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canManageCorpus(session.appUser.primaryRole)) {
    return forbidden();
  }

  const { id, iterationId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const [iteration] = await db
    .select({
      id: queryIterations.id,
      queryText: queryIterations.queryText,
      queryComponents: queryIterations.queryComponents,
      aiEvaluationNotes: queryIterations.aiEvaluationNotes,
      qualityScore: queryIterations.qualityScore,
      densityScore: queryIterations.densityScore,
      noiseScore: queryIterations.noiseScore
    })
    .from(queryIterations)
    .where(
      and(
        eq(queryIterations.id, iterationId),
        eq(queryIterations.studyCorpusId, corpus.id)
      )
    )
    .limit(1);

  if (!iteration) {
    return Response.json({ error: "not_found", message: "Iteration not found." }, { status: 404 });
  }

  const notesRaw = typeof iteration.aiEvaluationNotes === "string"
    ? JSON.parse(iteration.aiEvaluationNotes)
    : iteration.aiEvaluationNotes;

  const proposedAdjustments: string[] = notesRaw?.proposed_adjustments ?? [];

  // Optional user comments — extend the prompt with analyst-supplied instructions
  let userComments: string | undefined;
  try {
    const body = (await _request.clone().json()) as { user_comments?: string } | null;
    if (body && typeof body.user_comments === "string" && body.user_comments.trim().length > 0) {
      userComments = body.user_comments.trim().slice(0, 2000);
    }
  } catch {
    // body missing or not JSON — ignore
  }

  // We require either real proposed adjustments OR user comments before kicking off the job
  if (proposedAdjustments.length === 0 && !userComments) {
    return Response.json(
      { error: "no_adjustments", message: "Esta iteracion no tiene ajustes propuestos ni comentarios." },
      { status: 422 }
    );
  }

  const queue = getQueryEngineQueue();
  const job = await queue.add(
    "apply_query_adjustments",
    {
      corpusId: corpus.id,
      sourceIterationId: iterationId,
      proposedAdjustments,
      evaluation: {
        quality_score: iteration.qualityScore ? Number(iteration.qualityScore) : 5,
        density_score: iteration.densityScore ? Number(iteration.densityScore) : 5,
        noise_score: iteration.noiseScore ? Number(iteration.noiseScore) : 5,
        notes: notesRaw?.notes ?? ""
      },
      requestedByUserId: session.appUser.id,
      userComments
    },
    {
      attempts: 2,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { age: 60 * 60 * 24 }
    }
  );

  return Response.json(
    { job_id: job.id, status: "queued", source_iteration_id: iterationId },
    { status: 202 }
  );
}
