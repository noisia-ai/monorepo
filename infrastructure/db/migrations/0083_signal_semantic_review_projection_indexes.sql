-- Semantic Review projection rebuild indexes for 100K+ canonical roots.
--
-- 0082 keeps HTTP reads on the versioned projection, but its initial rebuild
-- also needs to walk accepted canonical roots in stable keyset order. The
-- generic provider-canonical index has no published_at ordering, so Postgres
-- otherwise scans and sorts the whole workspace once per projection page.
-- This forward-only migration changes no authority, membership, pointer,
-- assertion, run, job, or provider state.

CREATE INDEX IF NOT EXISTS idx_mentions_semantic_review_accepted_roots
  ON mentions (workspace_id, published_at DESC, id DESC)
  WHERE inclusion_status = 'included' AND canonical_mention_id = id;

CREATE INDEX IF NOT EXISTS idx_signal_mention_source_intent_workspace_root
  ON signal_mention_attributions (workspace_id, mention_id, import_batch_id)
  WHERE attribution_basis = 'source_intent';

ANALYZE mentions;
ANALYZE signal_mention_attributions;
ANALYZE import_batches;
