-- Stage 3/3. Validation scans run before the brief metadata-only NOT NULL lock.
ALTER TABLE mentions VALIDATE CONSTRAINT mentions_text_clean_sha256_exact;
ALTER TABLE mentions VALIDATE CONSTRAINT mentions_text_clean_sha256_present;
ALTER TABLE mentions ALTER COLUMN text_clean_sha256 SET NOT NULL;
ALTER TABLE mentions DROP CONSTRAINT mentions_text_clean_sha256_present;
DROP FUNCTION backfill_signal_mention_text_clean_sha256_v1(integer);
DROP TABLE signal_mention_text_digest_backfill_state;
