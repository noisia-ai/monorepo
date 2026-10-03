import { and, eq, inArray } from "drizzle-orm";

import {
  queryIterations,
  queryPacks,
  queryValidationAttempts,
  queryValidationMentions,
  queryValidationRuns
} from "@noisia/db";
import {
  QUERY_PACK_EVALUATOR_PIPELINE_VERSION,
  QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE,
  isQueryPackReady,
  type QueryPackMetrics
} from "@noisia/query-engine";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; iterationId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

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
      latestValidationRunId: queryIterations.latestQueryValidationRunId
    })
    .from(queryIterations)
    .where(and(eq(queryIterations.id, iterationId), eq(queryIterations.studyCorpusId, corpus.id)))
    .limit(1);

  if (!iteration) {
    return Response.json(
      { error: "not_found", message: "Query iteration not found for this corpus." },
      { status: 404 }
    );
  }

  if (!iteration.latestValidationRunId) {
    return Response.json(
      {
        error: "query_validation_incomplete",
        message: "La iteración todavía no tiene una evaluación trazable sobre evidencia importada."
      },
      { status: 409 }
    );
  }

  const [validationRun] = await db
    .select({
      id: queryValidationRuns.id,
      status: queryValidationRuns.status,
      sourceSystem: queryValidationRuns.sourceSystem,
      pipelineVersion: queryValidationRuns.pipelineVersion
    })
    .from(queryValidationRuns)
    .where(and(
      eq(queryValidationRuns.id, iteration.latestValidationRunId),
      eq(queryValidationRuns.studyCorpusId, corpus.id),
      eq(queryValidationRuns.queryIterationId, iterationId)
    ))
    .limit(1);

  if (
    !validationRun
    || validationRun.status !== "ready"
    || validationRun.sourceSystem !== "imported_corpus"
    || validationRun.pipelineVersion !== QUERY_PACK_EVALUATOR_PIPELINE_VERSION
  ) {
    return Response.json(
      {
        error: "query_validation_incomplete",
        message: "La última evaluación de evidencia importada no está lista para aprobación."
      },
      { status: 409 }
    );
  }

  const packs = await db
    .select({ id: queryPacks.id, queryText: queryPacks.queryText })
    .from(queryPacks)
    .where(and(
      eq(queryPacks.studyCorpusId, corpus.id),
      eq(queryPacks.queryIterationId, iterationId)
    ));
  const validationAttempts = await db
    .select({
      id: queryValidationAttempts.id,
      packId: queryValidationAttempts.queryPackId,
      queryText: queryValidationAttempts.queryText,
      status: queryValidationAttempts.status,
      kind: queryValidationAttempts.attemptKind,
      sampleSize: queryValidationAttempts.sampleSize,
      uniqueSampleSize: queryValidationAttempts.uniqueSampleSize,
      metrics: queryValidationAttempts.metrics
    })
    .from(queryValidationAttempts)
    .where(eq(queryValidationAttempts.queryValidationRunId, validationRun.id));
  const validationMentions = validationAttempts.length > 0
    ? await db
      .select({
        attemptId: queryValidationMentions.queryValidationAttemptId,
        externalMentionId: queryValidationMentions.externalMentionId
      })
      .from(queryValidationMentions)
      .where(inArray(
        queryValidationMentions.queryValidationAttemptId,
        validationAttempts.map((attempt) => attempt.id)
      ))
    : [];
  const packsReady = packs.length > 0 && packs.every((pack) => {
    const packAttempts = validationAttempts.filter((attempt) => attempt.packId === pack.id);
    const attempt = packAttempts.at(-1);
    if (!attempt || attempt.status !== "ready") return false;
    if (
      attempt.queryText.trim() !== (pack.queryText ?? "").trim()
      || attempt.sampleSize < QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE
      || attempt.uniqueSampleSize !== attempt.sampleSize
    ) return false;
    const mentionIds = validationMentions
      .filter((mention) => mention.attemptId === attempt.id)
      .map((mention) => mention.externalMentionId);
    if (mentionIds.length !== attempt.sampleSize || new Set(mentionIds).size !== mentionIds.length) return false;
    const metrics = asQueryPackMetrics(attempt.metrics);
    return Boolean(metrics && metrics.sample_size === attempt.sampleSize && isQueryPackReady(metrics));
  });

  if (!packsReady) {
    return Response.json(
      {
        error: "query_validation_incomplete",
        message: `Cada pack debe tener al menos ${QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE} menciones importadas, clasificadas y ligadas a la query exacta que se aprobará.`
      },
      { status: 409 }
    );
  }

  const [approved] = await db
    .update(queryIterations)
    .set({
      insightsManagerDecision: "query_approved",
      insightsManagerUserId: session.appUser.id,
      decisionAt: new Date(),
      approvedQueryValidationRunId: validationRun.id
    })
    .where(and(eq(queryIterations.id, iterationId), eq(queryIterations.studyCorpusId, corpus.id)))
    .returning({ id: queryIterations.id });

  if (!approved) {
    return Response.json(
      { error: "not_found", message: "Query iteration not found for this corpus." },
      { status: 404 }
    );
  }

  return Response.json({
    ok: true,
    iteration_id: iterationId,
    query_validation_run_id: validationRun.id,
    status: "query_approved"
  });
}

function asQueryPackMetrics(value: unknown): QueryPackMetrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metrics = value as Record<string, unknown>;
  const requiredNumbers = [
    "quality_score",
    "density_score",
    "noise_score",
    "relevant_count",
    "partial_count",
    "noise_count",
    "sample_size",
    "language_known_count",
    "geo_known_count"
  ];
  if (requiredNumbers.some((key) => !Number.isFinite(Number(metrics[key])))) return null;
  return value as QueryPackMetrics;
}
