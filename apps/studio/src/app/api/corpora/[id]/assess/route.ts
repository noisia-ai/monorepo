import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
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

  const queue = getQueryEngineQueue();
  const job = await queue.add(
    "assess_corpus",
    { corpusId: corpus.id, requestedByUserId: session.appUser.id },
    { attempts: 1, removeOnComplete: { age: 60 * 60 * 24 } }
  );

  return Response.json({ job_id: job.id, status: "queued" }, { status: 202 });
}
