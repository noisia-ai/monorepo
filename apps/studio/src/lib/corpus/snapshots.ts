import { sql } from "drizzle-orm";

import { corpusSnapshots } from "@noisia/db";
import { db, pool } from "@/lib/db";

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
  const governed = await createGovernedPopulationSnapshot(args);
  if (governed) {
    try {
      await refreshCorpusSnapshotAggregates({ snapshotId: governed.id, corpusId: args.corpusId });
    } catch (error) {
      console.warn("[snapshots] governed aggregate refresh failed", {
        snapshotId: governed.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return governed;
  }

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

  try {
    await refreshCorpusSnapshotAggregates({ snapshotId: snap.id, corpusId: args.corpusId });
  } catch (error) {
    console.warn("[snapshots] aggregate refresh failed", {
      snapshotId: snap.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return { id: snap.id, mention_count: count };
}

export async function refreshCorpusSnapshotAggregates(args: {
  snapshotId: string;
  corpusId: string;
}) {
  await db.execute(sql`
    WITH scoped AS (
      SELECT
        m.id,
        m.published_at,
        COALESCE(NULLIF(m.resolved_platform, ''), 'unknown') AS resolved_platform,
        COALESCE(NULLIF(m.content_type, ''), 'unknown') AS content_type
      FROM mentions m
      JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
      WHERE csm.snapshot_id = ${args.snapshotId}::uuid
    ),
    platform_rows AS (
      SELECT resolved_platform AS platform, COUNT(*)::int AS mention_count
      FROM scoped
      GROUP BY 1
      ORDER BY mention_count DESC
      LIMIT 10
    ),
    content_rows AS (
      SELECT content_type, COUNT(*)::int AS mention_count
      FROM scoped
      GROUP BY 1
      ORDER BY mention_count DESC
      LIMIT 10
    ),
    timeline_rows AS (
      SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, COUNT(*)::int AS mention_count
      FROM scoped
      GROUP BY 1
      ORDER BY 1 ASC
    ),
    rollup AS (
      SELECT
        COUNT(*)::int AS total_mentions,
        MIN(published_at) AS window_start,
        MAX(published_at) AS window_end
      FROM scoped
    )
    INSERT INTO corpus_snapshot_aggregates (
      snapshot_id,
      study_corpus_id,
      total_mentions,
      window_start,
      window_end,
      platform_distribution,
      content_type_distribution,
      volume_timeline,
      refreshed_at
    )
    SELECT
      ${args.snapshotId}::uuid,
      ${args.corpusId}::uuid,
      rollup.total_mentions,
      rollup.window_start,
      rollup.window_end,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('platform', platform, 'count', mention_count) ORDER BY mention_count DESC)
        FROM platform_rows
      ), '[]'::jsonb),
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('content_type', content_type, 'count', mention_count) ORDER BY mention_count DESC)
        FROM content_rows
      ), '[]'::jsonb),
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', month, 'count', mention_count) ORDER BY month ASC)
        FROM timeline_rows
      ), '[]'::jsonb),
      now()
    FROM rollup
    ON CONFLICT (snapshot_id) DO UPDATE SET
      study_corpus_id = EXCLUDED.study_corpus_id,
      total_mentions = EXCLUDED.total_mentions,
      window_start = EXCLUDED.window_start,
      window_end = EXCLUDED.window_end,
      platform_distribution = EXCLUDED.platform_distribution,
      content_type_distribution = EXCLUDED.content_type_distribution,
      volume_timeline = EXCLUDED.volume_timeline,
      refreshed_at = now()
  `);
}

async function createGovernedPopulationSnapshot(args: {
  corpusId: string;
  label: string;
  kind: "manual" | "approval";
  userId: string | null;
  scores?: unknown;
}) {
  const capability = await pool.query<{ available: boolean }>(`
    SELECT to_regprocedure(
      'create_signal_workspace_population_snapshot(uuid,uuid,uuid,text,text,uuid,jsonb)'
    ) IS NOT NULL AS available
  `);
  if (!capability.rows[0]?.available) return null;

  const scope = await pool.query<{ workspace_id: string; population_id: string }>(`
    SELECT membership.workspace_id::text, pointer.population_id::text
    FROM signal_workspace_corpora membership
    JOIN signal_workspace_population_pointers pointer
      ON pointer.workspace_id = membership.workspace_id
     AND pointer.purpose = 'operational'
    JOIN signal_population_definitions definition
      ON definition.id = pointer.population_id
     AND definition.workspace_id = pointer.workspace_id
     AND definition.status = 'active'
    WHERE membership.study_corpus_id = $1::uuid
      AND membership.valid_to IS NULL
    LIMIT 1
  `, [args.corpusId]);
  const resolved = scope.rows[0];
  if (!resolved) return null;

  const created = await pool.query<{ snapshot_id: string; mention_count: number }>(`
    SELECT snapshot_id::text, mention_count
    FROM create_signal_workspace_population_snapshot(
      $1::uuid,
      $2::uuid,
      $3::uuid,
      $4::text,
      $5::text,
      $6::uuid,
      $7::jsonb
    )
  `, [
    resolved.workspace_id,
    resolved.population_id,
    args.corpusId,
    args.label,
    args.kind,
    args.userId,
    JSON.stringify(args.scores ?? null)
  ]);
  const snapshot = created.rows[0];
  return snapshot ? { id: snapshot.snapshot_id, mention_count: snapshot.mention_count } : null;
}
