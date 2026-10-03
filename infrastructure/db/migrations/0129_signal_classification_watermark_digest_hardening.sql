-- Keep the classification watermark callable from SECURITY DEFINER functions
-- whose search_path intentionally excludes the Supabase extensions schema.
-- This only replaces the function body; it does not rewrite stored data.

CREATE OR REPLACE FUNCTION public.signal_classification_watermark_digest_v1(
  target_workspace_id uuid,
  target_study_corpus_id uuid
)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*)=0 THEN NULL ELSE
    'sha256:'||encode(extensions.digest(convert_to(string_agg(
      concat_ws(':',watermark.id::text,watermark.source_key,
        watermark.corpus_revision::text,
        COALESCE(watermark.last_source_sync_run_id::text,''),
        COALESCE(watermark.last_import_batch_id::text,''),
        COALESCE(watermark.max_observed_at::text,''),
        watermark.accepted_at::text,watermark.materialized_at::text,
        watermark.source_freshness_state,watermark.data_freshness_state,
        COALESCE(watermark.stale_after::text,'')),
      '|' ORDER BY watermark.source_key,watermark.id),'UTF8'),'sha256'::text),'hex') END
  FROM public.signal_data_watermarks watermark
  WHERE watermark.workspace_id=target_workspace_id
    AND watermark.study_corpus_id=target_study_corpus_id;
$$;

COMMENT ON FUNCTION public.signal_classification_watermark_digest_v1(uuid,uuid) IS
  'Stable workspace/corpus watermark digest. The pgcrypto call is schema-qualified so restricted publication functions can verify freshness.';
