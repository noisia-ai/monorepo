import { pool } from "../db/client";

/**
 * Any change to the corpus membership invalidates its last certification.
 * First approval is historical and remains untouched; the live status returns
 * to draft until the new revision is assessed and approved.
 */
export async function advanceCorpusRevision(corpusId: string) {
  const result = await pool.query<{ corpus_revision: number }>(
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
