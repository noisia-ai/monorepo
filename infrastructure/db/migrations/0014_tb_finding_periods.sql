ALTER TABLE "tb_findings"
  ADD COLUMN IF NOT EXISTS "period_start" date,
  ADD COLUMN IF NOT EXISTS "period_end" date;

CREATE INDEX IF NOT EXISTS "idx_tb_findings_period"
  ON "tb_findings" ("tb_analysis_id", "period_start", "period_end");

UPDATE "tb_findings" f
SET
  period_start = stats.period_start,
  period_end = stats.period_end
FROM (
  SELECT
    c.tb_analysis_id,
    c.finding_id,
    MIN(m.published_at)::date AS period_start,
    MAX(m.published_at)::date AS period_end
  FROM "tb_mention_codings" c
  JOIN "mentions" m ON m.id = c.mention_id
  WHERE c.finding_id IS NOT NULL
  GROUP BY c.tb_analysis_id, c.finding_id
) stats
WHERE f.tb_analysis_id = stats.tb_analysis_id
  AND f.id = stats.finding_id
  AND (f.period_start IS NULL OR f.period_end IS NULL);
