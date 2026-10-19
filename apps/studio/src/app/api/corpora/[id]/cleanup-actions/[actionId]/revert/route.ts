import { and, eq, isNull } from "drizzle-orm";

import { cleanupActions } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { advanceCorpusRevision } from "@/lib/corpus/revision";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db, pool } from "@/lib/db";

/**
 * Revert a cleanup_action: re-include every mention linked to it, null
 * out the link, and stamp reverted_at on the action so the UI hides
 * the "Revertir" button afterwards.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; actionId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id, actionId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  // Confirm the action belongs to this corpus and isn't already reverted
  const [action] = await db
    .select({
      id: cleanupActions.id,
      studyCorpusId: cleanupActions.studyCorpusId,
      revertedAt: cleanupActions.revertedAt
    })
    .from(cleanupActions)
    .where(and(eq(cleanupActions.id, actionId), eq(cleanupActions.studyCorpusId, corpus.id), isNull(cleanupActions.revertedAt)))
    .limit(1);

  if (!action) {
    return Response.json(
      { error: "not_found", message: "Acción no encontrada o ya revertida." },
      { status: 404 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const restored = await client.query<{ id: string }>(
      `
        UPDATE mentions
        SET inclusion_status = 'included',
            exclusion_reason = NULL,
            cleanup_action_id = NULL,
            updated_at = now()
        WHERE study_corpus_id = $1::uuid
          AND cleanup_action_id = $2::uuid
        RETURNING id
      `,
      [corpus.id, actionId]
    );
    const count = restored.rowCount ?? 0;

    await client.query(
      `
        UPDATE cleanup_actions
        SET reverted_at = now(), reverted_by_user_id = $2::uuid
        WHERE id = $1::uuid
      `,
      [actionId, session.appUser.id]
    );
    const corpusRevision = count > 0
      ? await advanceCorpusRevision(corpus.id, client)
      : null;
    await client.query("COMMIT");

    return Response.json({ ok: true, restored_count: count, corpus_revision: corpusRevision });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[cleanup-revert] failed", error);
    return Response.json(
      { error: "revert_failed", message: "No se pudo revertir la limpieza." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
