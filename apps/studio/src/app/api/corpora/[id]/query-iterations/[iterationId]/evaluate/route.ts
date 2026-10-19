import { Job } from "bullmq";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { pool } from "@/lib/db";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";

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

  const evidence = await pool.query<{ pack_count: number; packs_with_evidence: number }>(
    `
      SELECT
        COUNT(DISTINCT qp.id)::int AS pack_count,
        COUNT(DISTINCT qp.id) FILTER (WHERE m.id IS NOT NULL)::int AS packs_with_evidence
      FROM query_packs qp
      LEFT JOIN mention_query_sources mqs ON mqs.query_pack_id = qp.id
      LEFT JOIN mentions m ON m.id = mqs.mention_id AND m.inclusion_status = 'included'
      WHERE qp.study_corpus_id = $1 AND qp.query_iteration_id = $2
    `,
    [corpus.id, iterationId]
  );
  const coverage = evidence.rows[0];
  if (
    !coverage
    || coverage.pack_count === 0
    || coverage.packs_with_evidence < coverage.pack_count
  ) {
    return Response.json(
      {
        error: "query_evidence_required",
        message: "Importa una primera extracción ligada a cada query pack antes de evaluar su calidad.",
        evidence: coverage ?? { pack_count: 0, packs_with_evidence: 0 }
      },
      { status: 409 }
    );
  }

  const queue = getQueryEngineQueue();
  const stableJobId = `evaluate-${iterationId}`;
  const existing = await Job.fromId(queue, stableJobId);

  if (existing) {
    const state = await existing.getState();
    if (!["completed", "failed"].includes(state)) {
      return Response.json(
        { job_id: existing.id, status: normalizeJobState(state), query_iteration_id: iterationId },
        { status: 202 }
      );
    }
    await existing.remove();
  }

  const job = await queue.add(
    "evaluate_sample",
    {
      corpusId: corpus.id,
      queryIterationId: iterationId,
      requestedByUserId: session.appUser.id
    },
    {
      jobId: stableJobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 7, count: 1000 }
    }
  );

  return Response.json(
    { job_id: job.id, status: "queued", query_iteration_id: iterationId },
    { status: 202 }
  );
}

function normalizeJobState(state: string) {
  return state === "active" ? "running" : state;
}
