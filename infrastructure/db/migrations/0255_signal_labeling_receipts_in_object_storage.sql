-- Keep provider receipts in private object storage; Postgres stores immutable identity only.
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM signal_labeling_calls
   WHERE raw_body IS NOT NULL AND (raw_sha256 IS NULL OR raw_storage_key IS NULL)
 ) THEN
   RAISE EXCEPTION 'signal_labeling_receipt_storage_incomplete';
 END IF;
END $$;

ALTER TABLE signal_labeling_calls ADD COLUMN raw_size_bytes bigint;
UPDATE signal_labeling_calls SET raw_size_bytes=octet_length(raw_body) WHERE raw_body IS NOT NULL;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM signal_labeling_calls WHERE raw_sha256 IS NOT NULL
   AND (raw_storage_key IS NULL OR raw_size_bytes IS NULL OR raw_size_bytes<>octet_length(raw_body))) THEN
   RAISE EXCEPTION 'signal_labeling_receipt_reference_incomplete';
 END IF;
END $$;
ALTER TABLE signal_labeling_calls DROP COLUMN raw_body;
ALTER TABLE signal_labeling_runs DROP COLUMN selection_complete;
ALTER TABLE signal_labeling_calls ADD CONSTRAINT signal_labeling_receipt_reference_valid CHECK (
 (raw_sha256 IS NULL) = (raw_storage_key IS NULL)
 AND (raw_sha256 IS NULL) = (raw_size_bytes IS NULL)
 AND (raw_size_bytes IS NULL OR raw_size_bytes BETWEEN 0 AND 8388608)
);
