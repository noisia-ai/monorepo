import { and, desc, eq } from "drizzle-orm";

import { queryIterations, studyCorpora } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { createCorpusSnapshot } from "@/lib/corpus/snapshots";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";

/**
 * Corpus-level approve. Marks the latest iteration as approved and flips
 * the corpus status. Separate from the per-iteration approve endpoint —
 * this one is wired from the corpus assessment panel, not from a specific
 * iteration's decide step.
 */
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

  // Mark the latest iteration as the one the Insights Manager signed off on
  const [latest] = await db
    .select({ id: queryIterations.id })
    .from(queryIterations)
    .where(eq(queryIterations.studyCorpusId, corpus.id))
    .orderBy(desc(queryIterations.iterationNumber))
    .limit(1);

  if (latest) {
    await db
      .update(queryIterations)
      .set({ insightsManagerDecision: "approved" })
      .where(and(eq(queryIterations.id, latest.id), eq(queryIterations.studyCorpusId, corpus.id)));
  }

  await db
    .update(studyCorpora)
    .set({ status: "corpus_approved", corpusFirstApprovedAt: new Date() })
    .where(eq(studyCorpora.id, corpus.id));

  // Auto-snapshot so the IM can roll back to "approved state" after future iterations
  const approvedLabel = `Aprobación ${new Date().toISOString().slice(0, 10)} ${new Date().toTimeString().slice(0, 5)}`;
  await createCorpusSnapshot({
    corpusId: corpus.id,
    label: approvedLabel,
    kind: "approval",
    userId: session.appUser.id
  });

  return Response.json({ ok: true, iteration_id: latest?.id ?? null, status: "corpus_approved" });
}
