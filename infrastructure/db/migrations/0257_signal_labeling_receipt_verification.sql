-- Forward-only verification marker. Existing 0255 histories remain immutable.
ALTER TABLE signal_labeling_calls ADD COLUMN IF NOT EXISTS raw_storage_verified_at timestamptz;
ALTER TABLE signal_labeling_calls ADD COLUMN IF NOT EXISTS raw_storage_verified_key text;
