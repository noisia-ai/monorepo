import { and, eq } from "drizzle-orm";

import { corpusSnapshots } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { advanceCorpusRevision } from "@/lib/corpus/revision";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db, pool } from "@/lib/db";

/**
 * Restore a snapshot: rewrite inclusion_status for every mention in the
 * corpus to match what was in the snapshot at save time. Mentions in
 * the snapshot → 'included'; everything else → 'excluded' with reason
 * 'restored-from-snapshot'.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; snapshotId: string }> }
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id, snapshotId } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
  }

  const [snap] = await db
    .select({ id: corpusSnapshots.id, label: corpusSnapshots.label })
    .from(corpusSnapshots)
    .where(and(eq(corpusSnapshots.id, snapshotId), eq(corpusSnapshots.studyCorpusId, corpus.id)))
    .limit(1);

  if (!snap) {
    return Response.json({ error: "not_found", message: "Snapshot no encontrado." }, { status: 404 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const restored = await client.query(
      `
        WITH target AS (
          SELECT m.id,
                 EXISTS (
                   SELECT 1 FROM corpus_snapshot_mentions csm
                   WHERE csm.snapshot_id = $2::uuid AND csm.mention_id = m.id
                 ) AS should_include
          FROM mentions m
          WHERE m.study_corpus_id = $1::uuid
        )
        UPDATE mentions m
        SET inclusion_status = CASE WHEN target.should_include THEN 'included' ELSE 'excluded' END,
            exclusion_reason = CASE WHEN target.should_include THEN NULL ELSE $3 END,
            cleanup_action_id = NULL,
            updated_at = now()
        FROM target
        WHERE m.id = target.id
          AND (
            m.inclusion_status IS DISTINCT FROM CASE WHEN target.should_include THEN 'included' ELSE 'excluded' END
            OR m.cleanup_action_id IS NOT NULL
            OR (NOT target.should_include AND m.exclusion_reason IS DISTINCT FROM $3)
          )
        RETURNING m.id
      `,
      [corpus.id, snapshotId, `restored-from-snapshot: ${snap.label}`]
    );
    const changedCount = restored.rowCount ?? 0;
    const corpusRevision = changedCount > 0
      ? await advanceCorpusRevision(corpus.id, client)
      : null;
    await client.query("COMMIT");

    return Response.json({
      ok: true,
      snapshot_id: snapshotId,
      changed_count: changedCount,
      corpus_revision: corpusRevision
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[snapshot-restore] failed", error);
    return Response.json(
      { error: "restore_failed", message: "No se pudo restaurar el snapshot." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
