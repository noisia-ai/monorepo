import { z, ZodError } from "zod";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { pool } from "@/lib/db";

const compareSnapshotsSchema = z.object({
  base_snapshot_id: z.string().uuid(),
  compare_snapshot_id: z.string().uuid()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getAuthenticatedAppUser();
    if (!session) return unauthorized();
    if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

    const { id } = await context.params;
    const corpus = await getCorpusForUser(session.appUser, id);
    if (!corpus) {
      return Response.json({ error: "not_found", message: "Corpus not found." }, { status: 404 });
    }

    const body = compareSnapshotsSchema.parse(await request.json());
    if (body.base_snapshot_id === body.compare_snapshot_id) {
      return Response.json(
        { error: "validation_error", message: "Elige dos snapshots distintos." },
        { status: 422 }
      );
    }

    const snapshotResult = await pool.query<{
      id: string;
      label: string;
      kind: string;
      mention_count: number;
      created_at: string;
    }>(
      `
        SELECT id, label, kind, mention_count, created_at
        FROM corpus_snapshots
        WHERE study_corpus_id = $1::uuid
          AND id = ANY($2::uuid[])
      `,
      [corpus.id, [body.base_snapshot_id, body.compare_snapshot_id]]
    );

    if (snapshotResult.rowCount !== 2) {
      return Response.json(
        { error: "not_found", message: "Snapshots no encontrados para este corpus." },
        { status: 404 }
      );
    }

    const base = snapshotResult.rows.find((s) => s.id === body.base_snapshot_id);
    const compare = snapshotResult.rows.find((s) => s.id === body.compare_snapshot_id);
    if (!base || !compare) {
      return Response.json(
        { error: "not_found", message: "Snapshots no encontrados para este corpus." },
        { status: 404 }
      );
    }

    const [counts, added, removed] = await Promise.all([
      pool.query<{
        added_count: number;
        removed_count: number;
        unchanged_count: number;
      }>(
        `
          WITH base AS (
            SELECT mention_id FROM corpus_snapshot_mentions WHERE snapshot_id = $1::uuid
          ),
          compare AS (
            SELECT mention_id FROM corpus_snapshot_mentions WHERE snapshot_id = $2::uuid
          )
          SELECT
            (SELECT count(*)::int FROM compare c LEFT JOIN base b USING (mention_id) WHERE b.mention_id IS NULL) AS added_count,
            (SELECT count(*)::int FROM base b LEFT JOIN compare c USING (mention_id) WHERE c.mention_id IS NULL) AS removed_count,
            (SELECT count(*)::int FROM base b INNER JOIN compare c USING (mention_id)) AS unchanged_count
        `,
        [body.base_snapshot_id, body.compare_snapshot_id]
      ),
      pool.query<{
        id: string;
        text_snippet: string | null;
        text_clean: string;
        platform: string;
        published_at: string;
        sentiment_source: string | null;
      }>(
        `
          SELECT m.id, m.text_snippet, m.text_clean, m.platform, m.published_at, m.sentiment_source
          FROM corpus_snapshot_mentions c
          JOIN mentions m ON m.id = c.mention_id
          LEFT JOIN corpus_snapshot_mentions b
            ON b.snapshot_id = $1::uuid AND b.mention_id = c.mention_id
          WHERE c.snapshot_id = $2::uuid
            AND b.mention_id IS NULL
          ORDER BY m.published_at DESC
          LIMIT 8
        `,
        [body.base_snapshot_id, body.compare_snapshot_id]
      ),
      pool.query<{
        id: string;
        text_snippet: string | null;
        text_clean: string;
        platform: string;
        published_at: string;
        sentiment_source: string | null;
      }>(
        `
          SELECT m.id, m.text_snippet, m.text_clean, m.platform, m.published_at, m.sentiment_source
          FROM corpus_snapshot_mentions b
          JOIN mentions m ON m.id = b.mention_id
          LEFT JOIN corpus_snapshot_mentions c
            ON c.snapshot_id = $2::uuid AND c.mention_id = b.mention_id
          WHERE b.snapshot_id = $1::uuid
            AND c.mention_id IS NULL
          ORDER BY m.published_at DESC
          LIMIT 8
        `,
        [body.base_snapshot_id, body.compare_snapshot_id]
      )
    ]);

    // TODO mejora-futura: añadir export CSV/MD del diff y segmentación por
    // fuente/sentiment para entender qué cambió entre aprobaciones.
    return Response.json({
      base: snapshotPayload(base),
      compare: snapshotPayload(compare),
      counts: counts.rows[0],
      examples: {
        added: added.rows,
        removed: removed.rows
      }
    });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);

    console.error("[snapshots-compare] failed", error);
    return Response.json(
      { error: "compare_failed", message: "No se pudo comparar snapshots." },
      { status: 500 }
    );
  }
}

function snapshotPayload(snapshot: {
  id: string;
  label: string;
  kind: string;
  mention_count: number;
  created_at: string;
}) {
  return {
    id: snapshot.id,
    label: snapshot.label,
    kind: snapshot.kind,
    mentionCount: snapshot.mention_count,
    createdAt: snapshot.created_at
  };
}
