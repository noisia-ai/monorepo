import { and, eq, sql } from "drizzle-orm";

import { corpusSnapshots } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";

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

  // Two updates in sequence — could be wrapped in a transaction but for an MVP
  // the brief inconsistency window is acceptable on a single-tenant workspace.
  await db.execute(sql`
    UPDATE mentions
    SET inclusion_status = 'included',
        exclusion_reason = NULL,
        cleanup_action_id = NULL
    WHERE study_corpus_id = ${corpus.id}::uuid
      AND id IN (SELECT mention_id FROM corpus_snapshot_mentions WHERE snapshot_id = ${snapshotId}::uuid)
  `);

  await db.execute(sql`
    UPDATE mentions
    SET inclusion_status = 'excluded',
        exclusion_reason = ${`restored-from-snapshot: ${snap.label}`},
        cleanup_action_id = NULL
    WHERE study_corpus_id = ${corpus.id}::uuid
      AND id NOT IN (SELECT mention_id FROM corpus_snapshot_mentions WHERE snapshot_id = ${snapshotId}::uuid)
  `);

  return Response.json({ ok: true, snapshot_id: snapshotId });
}
