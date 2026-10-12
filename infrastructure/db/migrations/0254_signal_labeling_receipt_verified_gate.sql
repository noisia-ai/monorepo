-- Ordered before 0255 so every existing recoverable body is verified in SQL
-- before that migration removes it. An empty receipt table passes.
ALTER TABLE signal_labeling_calls ADD COLUMN IF NOT EXISTS raw_storage_verified_at timestamptz;
ALTER TABLE signal_labeling_calls ADD COLUMN IF NOT EXISTS raw_storage_verified_key text;
DO $$
BEGIN
  -- Existing dedicated environments installed 0255 before this forward-only
  -- migration was authored; their raw_body column is already gone.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid='signal_labeling_calls'::regclass AND attname='raw_body' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM signal_labeling_calls
    WHERE raw_body IS NOT NULL AND (
      raw_storage_verified_at IS NULL OR raw_storage_key IS NULL
      OR raw_storage_verified_key IS DISTINCT FROM raw_storage_key
    )
  ) THEN
    RAISE EXCEPTION 'signal_labeling_receipt_unverified';
  END IF;
END $$;
