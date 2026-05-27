import { z } from "zod";

import { QUERY_ENGINE_PIPELINE_VERSION } from "@noisia/query-engine";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";

const runEngineSchema = z.object({
  iteration_strategy: z.enum(["auto", "manual"]).default("auto"),
  max_iterations: z.number().int().min(1).max(5).default(5)
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canManageCorpus(session.appUser.primaryRole)) {
    return forbidden();
  }

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const parsed = runEngineSchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const queue = getQueryEngineQueue();
  const job = await queue.add(
    "compose_initial_query",
    {
      corpusId: corpus.id,
      requestedByUserId: session.appUser.id,
      iterationStrategy: parsed.data.iteration_strategy,
      maxIterations: parsed.data.max_iterations,
      pipelineVersion: QUERY_ENGINE_PIPELINE_VERSION
    },
    {
      jobId: `compose-initial-${corpus.id}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 500 },
      removeOnFail: { age: 60 * 60 * 24 * 7, count: 1000 }
    }
  );

  return Response.json({
    job_id: job.id,
    status: "queued",
    polling_url: `/api/jobs/${job.id}`
  });
}
