import { Job } from "bullmq";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
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
