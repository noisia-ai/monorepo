import { sql } from "drizzle-orm";

import { corpusSnapshots } from "@noisia/db";
import { db } from "@/lib/db";

/**
 * Create a snapshot row + bulk-insert mention ids in a single SQL statement.
 * Shared by the manual snapshot endpoint and the approve endpoint.
 *
 * Returns { id, mention_count } or null if the snapshot row couldn't be created.
 */
export async function createCorpusSnapshot(args: {
  corpusId: string;
  label: string;
  kind: "manual" | "approval";
  userId: string | null;
  scores?: unknown;
}): Promise<{ id: string; mention_count: number } | null> {
  const [snap] = await db
    .insert(corpusSnapshots)
    .values({
      studyCorpusId: args.corpusId,
      label: args.label,
      kind: args.kind,
      mentionCount: 0,
      scoresAtSnapshot: args.scores ?? null,
      createdByUserId: args.userId
    })
    .returning({ id: corpusSnapshots.id });

  if (!snap) return null;

  const inserted = await db.execute(sql`
    INSERT INTO corpus_snapshot_mentions (snapshot_id, mention_id)
    SELECT ${snap.id}::uuid, id FROM mentions
    WHERE study_corpus_id = ${args.corpusId}::uuid AND inclusion_status = 'included'
    RETURNING mention_id
  `);

  const count =
    (inserted as unknown as { rows?: unknown[] }).rows?.length ??
    (inserted as unknown as { length?: number }).length ??
    0;

  await db.execute(sql`UPDATE corpus_snapshots SET mention_count = ${count} WHERE id = ${snap.id}::uuid`);

  return { id: snap.id, mention_count: count };
}
