-- The paced Message Batches retry reads the latest call and attempt count
-- for each request. The live-call index excludes settled receipts, forcing a
-- repeated full scan precisely when many grammar-limit results are settled.
-- This partial index covers those immutable V2 receipts without changing data.
CREATE INDEX IF NOT EXISTS idx_topic_editorial_v2_retry_lookup
  ON signal_topic_editorial_calls(request_id, reserved_at DESC, id DESC)
  WHERE transport_version = 2;
