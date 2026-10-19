import type { PoolClient } from "pg";

import { pool } from "@/lib/db";

type Queryable = Pick<PoolClient, "query">;

/**
 * Invalidates corpus-level certification after membership changes while
 * preserving historical approval timestamps and snapshots.
 */
export async function advanceCorpusRevision(corpusId: string, client?: Queryable) {
  const executor = client ?? pool;
  const result = await executor.query<{ corpus_revision: number }>(
    `
      UPDATE study_corpora
      SET corpus_revision = corpus_revision + 1,
          latest_assessment = NULL,
          latest_assessed_at = NULL,
          latest_assessed_revision = NULL,
          status = CASE WHEN status = 'corpus_approved' THEN 'draft' ELSE status END,
          updated_at = now()
      WHERE id = $1::uuid
      RETURNING corpus_revision
    `,
    [corpusId]
  );

  return result.rows[0]?.corpus_revision ?? null;
}
