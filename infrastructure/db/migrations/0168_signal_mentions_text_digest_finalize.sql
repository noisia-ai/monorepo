-- Stage 2/3. Apply only after repeated, separately committed calls to
-- backfill_signal_mention_text_clean_sha256_v1(limit) return zero.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM mentions WHERE text_clean_sha256 IS NULL) THEN
    RAISE EXCEPTION 'signal_mentions_text_digest_backfill_incomplete' USING ERRCODE='55000';
  END IF;
END; $$;

ALTER TABLE mentions ADD CONSTRAINT mentions_text_clean_sha256_present
  CHECK(text_clean_sha256 IS NOT NULL) NOT VALID;
