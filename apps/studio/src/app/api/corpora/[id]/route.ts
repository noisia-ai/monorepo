import { eq } from "drizzle-orm";

import { studyCorpora } from "@noisia/db";

import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus no encontrado o sin acceso." },
      { status: 404 }
    );
  }

  const [updated] = await db
    .update(studyCorpora)
    .set({
      status: "archived",
      lockedByAnalysisId: null,
      updatedAt: new Date()
    })
    .where(eq(studyCorpora.id, corpus.id))
    .returning({
      id: studyCorpora.id,
      status: studyCorpora.status
    });

  return Response.json({ data: updated ?? { id: corpus.id, status: "archived" } });
}
