import { and, eq } from "drizzle-orm";

import { queryIterations, studyCorpora } from "@noisia/db";
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

  await db
    .update(queryIterations)
    .set({ insightsManagerDecision: "approved" })
    .where(and(eq(queryIterations.id, iterationId), eq(queryIterations.studyCorpusId, corpus.id)));

  await db
    .update(studyCorpora)
    .set({ status: "corpus_approved" })
    .where(eq(studyCorpora.id, corpus.id));

  return Response.json({ ok: true, iteration_id: iterationId, status: "corpus_approved" });
}
