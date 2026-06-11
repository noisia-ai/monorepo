-- Backfill query-pack provenance for existing CSV imports.
-- This keeps the live corpus explorer useful for corpora created before 0026.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_query_packs_iteration_lens_intent_scope"
  ON "query_packs" (
    "study_corpus_id",
    COALESCE("query_iteration_id"::text, ''),
    "lens_slug",
    "signal_intent",
    "scope"
  );

WITH batch_scope AS (
  SELECT
    ib.id AS import_batch_id,
    ib.study_corpus_id,
    ib.query_iteration_id,
    ib.mention_type,
    ib.competitor_id,
    ib.corpus_entity_id,
    ib.entity_kind,
    ib.entity_label,
    ib.imported_by_user_id,
    COALESCE(m.slug, 'triggers-barriers') AS lens_slug,
    CASE
      WHEN ib.mention_type = 'brand' THEN 'brand'
      WHEN ib.mention_type = 'competitor' THEN 'competitors'
      WHEN ib.mention_type = 'industry' THEN 'category'
      WHEN ib.entity_kind = 'competitor' THEN 'competitors'
      WHEN ib.entity_kind = 'category' THEN 'category'
      WHEN ib.entity_kind = 'primary_brand' THEN 'brand'
      ELSE 'source'
    END AS scope,
    CASE
      WHEN ib.mention_type = 'brand' THEN 'decision_signal'
      WHEN ib.mention_type = 'competitor' THEN 'competitive_signal'
      WHEN ib.mention_type = 'industry' THEN 'category_signal'
      WHEN ib.entity_kind = 'competitor' THEN 'competitive_signal'
      WHEN ib.entity_kind = 'category' THEN 'category_signal'
      WHEN ib.entity_kind = 'primary_brand' THEN 'decision_signal'
      ELSE 'source_upload'
    END AS signal_intent,
    CASE
      WHEN ib.mention_type = 'competitor' THEN COALESCE(qi.competitor_query_text, qi.query_text)
      WHEN ib.mention_type = 'industry' THEN COALESCE(qi.industry_query_text, qi.query_text)
      ELSE qi.query_text
    END AS query_text,
    COALESCE(qi.query_components, '{}'::jsonb) AS query_components,
    qi.mentions_returned,
    qi.quality_score,
    qi.density_score,
    qi.noise_score,
    qi.ai_evaluation_notes,
    qi.insights_manager_decision,
    qi.decision_at
  FROM "import_batches" ib
  JOIN "study_corpora" sc ON sc.id = ib.study_corpus_id
  LEFT JOIN "methodologies" m ON m.id = sc.methodology_id
  LEFT JOIN "query_iterations" qi ON qi.id = ib.query_iteration_id
)
INSERT INTO "query_packs" (
  "study_corpus_id",
  "query_iteration_id",
  "lens_slug",
  "signal_intent",
  "scope",
  "objective",
  "query_text",
  "query_components",
  "seeds",
  "evaluation",
  "status",
  "mentions_returned",
  "quality_score",
  "density_score",
  "noise_score",
  "created_by_user_id",
  "evaluated_at",
  "approved_at"
)
SELECT
  bs.study_corpus_id,
  bs.query_iteration_id,
  bs.lens_slug,
  bs.signal_intent,
  bs.scope,
  'Imported CSV provenance for ' || bs.scope || ' / ' || bs.signal_intent,
  bs.query_text,
  bs.query_components,
  jsonb_build_object(
    'source', 'import_batch_backfill',
    'mention_type', bs.mention_type,
    'entity_kind', bs.entity_kind,
    'entity_label', bs.entity_label,
    'query_iteration_id', bs.query_iteration_id
  ),
  jsonb_build_object(
    'source', 'import_batch_backfill',
    'query_iteration_mentions_returned', bs.mentions_returned,
    'ai_evaluation_notes', bs.ai_evaluation_notes,
    'insights_manager_decision', bs.insights_manager_decision
  ),
  'imported',
  0,
  bs.quality_score,
  bs.density_score,
  bs.noise_score,
  bs.imported_by_user_id,
  bs.decision_at,
  bs.decision_at
FROM batch_scope bs
ON CONFLICT DO NOTHING;

WITH batch_scope AS (
  SELECT
    ib.id AS import_batch_id,
    ib.study_corpus_id,
    ib.query_iteration_id,
    ib.mention_type,
    ib.competitor_id,
    ib.corpus_entity_id,
    ib.entity_kind,
    ib.entity_label,
    ib.source_system,
    ib.source_file_name,
    COALESCE(m.slug, 'triggers-barriers') AS lens_slug,
    CASE
      WHEN ib.mention_type = 'brand' THEN 'brand'
      WHEN ib.mention_type = 'competitor' THEN 'competitors'
      WHEN ib.mention_type = 'industry' THEN 'category'
      WHEN ib.entity_kind = 'competitor' THEN 'competitors'
      WHEN ib.entity_kind = 'category' THEN 'category'
      WHEN ib.entity_kind = 'primary_brand' THEN 'brand'
      ELSE 'source'
    END AS scope,
    CASE
      WHEN ib.mention_type = 'brand' THEN 'decision_signal'
      WHEN ib.mention_type = 'competitor' THEN 'competitive_signal'
      WHEN ib.mention_type = 'industry' THEN 'category_signal'
      WHEN ib.entity_kind = 'competitor' THEN 'competitive_signal'
      WHEN ib.entity_kind = 'category' THEN 'category_signal'
      WHEN ib.entity_kind = 'primary_brand' THEN 'decision_signal'
      ELSE 'source_upload'
    END AS signal_intent
  FROM "import_batches" ib
  JOIN "study_corpora" sc ON sc.id = ib.study_corpus_id
  LEFT JOIN "methodologies" m ON m.id = sc.methodology_id
),
matched_pack AS (
  SELECT
    bs.*,
    qp.id AS query_pack_id
  FROM batch_scope bs
  JOIN "query_packs" qp
    ON qp.study_corpus_id = bs.study_corpus_id
   AND qp.lens_slug = bs.lens_slug
   AND qp.signal_intent = bs.signal_intent
   AND qp.scope = bs.scope
   AND (
      (qp.query_iteration_id IS NULL AND bs.query_iteration_id IS NULL)
      OR qp.query_iteration_id = bs.query_iteration_id
   )
)
INSERT INTO "mention_query_sources" (
  "mention_id",
  "study_corpus_id",
  "query_pack_id",
  "query_iteration_id",
  "import_batch_id",
  "lens_slug",
  "signal_intent",
  "scope",
  "corpus_entity_id",
  "entity_id",
  "match_quality",
  "match_reason",
  "metadata"
)
SELECT
  mn.id,
  mp.study_corpus_id,
  mp.query_pack_id,
  mp.query_iteration_id,
  mp.import_batch_id,
  mp.lens_slug,
  mp.signal_intent,
  mp.scope,
  mp.corpus_entity_id,
  COALESCE(
    'corpus_entity:' || mp.corpus_entity_id::text,
    'competitor:' || mp.competitor_id::text,
    NULLIF(mp.entity_kind || ':' || regexp_replace(lower(COALESCE(mp.entity_label, '')), '[^a-z0-9]+', '-', 'g'), ':')
  ),
  1.000,
  'import_batch_backfill',
  jsonb_build_object(
    'source', 'import_batch_backfill',
    'source_system', mp.source_system,
    'source_file_name', mp.source_file_name,
    'entity_label', mp.entity_label,
    'mention_type', mp.mention_type,
    'entity_kind', mp.entity_kind
  )
FROM "mentions" mn
JOIN matched_pack mp ON mp.import_batch_id = mn.source_file_id
ON CONFLICT DO NOTHING;

UPDATE "query_packs" qp
SET
  "mentions_returned" = counts.mention_count,
  "status" = 'imported',
  "updated_at" = now()
FROM (
  SELECT query_pack_id, count(*)::int AS mention_count
  FROM "mention_query_sources"
  WHERE query_pack_id IS NOT NULL
  GROUP BY query_pack_id
) counts
WHERE qp.id = counts.query_pack_id;
