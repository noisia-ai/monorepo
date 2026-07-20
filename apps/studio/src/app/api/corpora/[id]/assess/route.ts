import { Job } from "bullmq";
import { eq } from "drizzle-orm";

import { studyCorpora } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const [revisionState] = await db
    .select({ corpusRevision: studyCorpora.corpusRevision })
    .from(studyCorpora)
    .where(eq(studyCorpora.id, corpus.id))
    .limit(1);

  if (!revisionState) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const queue = getQueryEngineQueue();
  const stableJobId = `assess-${corpus.id}-r${revisionState.corpusRevision}`;
  const existing = await Job.fromId(queue, stableJobId);

  if (existing) {
    const state = await existing.getState();
    if (!["completed", "failed"].includes(state)) {
      return Response.json(
        {
          job_id: existing.id,
          status: state === "active" ? "running" : state,
          corpus_revision: revisionState.corpusRevision
        },
        { status: 202 }
      );
    }
    await existing.remove();
  }

  const job = await queue.add(
    "assess_corpus",
    {
      corpusId: corpus.id,
      corpusRevision: revisionState.corpusRevision,
      requestedByUserId: session.appUser.id
    },
    {
      jobId: stableJobId,
      attempts: 1,
      removeOnComplete: { age: 60 * 60 * 24, count: 500 },
      removeOnFail: { age: 60 * 60 * 24 * 7, count: 500 }
    }
  );

  return Response.json(
    {
      job_id: job.id,
      status: "queued",
      corpus_revision: revisionState.corpusRevision
    },
    { status: 202 }
  );
}
