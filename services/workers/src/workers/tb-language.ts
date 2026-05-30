import { pool } from "../db/client";

export async function detectTbOutputLanguage(tbAnalysisId: string): Promise<string> {
  const r = await pool.query<{ language: string; count: number }>(
    `WITH scope AS (
       SELECT study_corpus_id, snapshot_id
       FROM tb_analyses
       WHERE id = $1
     )
     SELECT COALESCE(NULLIF(LOWER(m.language), ''), 'unknown') AS language, COUNT(*)::int AS count
     FROM scope s
     JOIN corpus_snapshot_mentions csm ON csm.snapshot_id = s.snapshot_id
     JOIN mentions m ON m.id = csm.mention_id
     GROUP BY 1
     UNION ALL
     SELECT COALESCE(NULLIF(LOWER(m.language), ''), 'unknown') AS language, COUNT(*)::int AS count
     FROM scope s
     JOIN mentions m ON m.study_corpus_id = s.study_corpus_id
     WHERE s.snapshot_id IS NULL
     GROUP BY 1
     ORDER BY count DESC
     LIMIT 3`,
    [tbAnalysisId]
  );
  const top = r.rows[0]?.language;
  if (top === "en" || top === "eng" || top === "english") return "English";
  if (top === "es" || top === "spa" || top === "spanish") return "Spanish (Mexico)";
  return "Spanish (Mexico)";
}
