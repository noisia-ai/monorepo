-- Keep the transition row as the driving identity even when a fresh import has
-- stale empty-table statistics. OFFSET 0 deliberately preserves parameterized
-- unique-ID lookups instead of flattening them into broad workspace scans.
-- Eligibility, canonicalization, deduplication, dirty updates and outbox
-- scheduling are unchanged. No provenance or historical row is rewritten.
CREATE OR REPLACE FUNCTION invalidate_signal_semantic_review_from_attributions_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace_row record;
BEGIN
  INSERT INTO signal_semantic_review_projection_dirty_roots(
    workspace_id,mention_id,reason,dirty_at
  )
  SELECT DISTINCT changed.workspace_id,root.id,
    'semantic_assertion_or_provenance_changed',now()
  FROM new_rows changed
  CROSS JOIN LATERAL (
    SELECT observed.workspace_id,observed.canonical_mention_id
    FROM mentions observed
    WHERE observed.workspace_id=changed.workspace_id AND observed.id=changed.mention_id
    OFFSET 0
  ) observed
  CROSS JOIN LATERAL (
    SELECT canonical.id FROM mentions canonical
    WHERE canonical.workspace_id=observed.workspace_id AND canonical.id=observed.canonical_mention_id
    OFFSET 0
  ) root
  WHERE changed.attribution_basis='mention_semantic'
    OR EXISTS(
      SELECT 1 FROM import_batches batch
      WHERE batch.id=changed.import_batch_id
        AND batch.workspace_id=changed.workspace_id
        AND batch.status='completed'
    )
  ON CONFLICT(workspace_id,mention_id) DO UPDATE SET
    reason=EXCLUDED.reason,dirty_at=EXCLUDED.dirty_at;
  FOR workspace_row IN
    SELECT DISTINCT changed.workspace_id
    FROM new_rows changed
    WHERE changed.attribution_basis='mention_semantic'
      OR EXISTS(
        SELECT 1 FROM import_batches batch
        WHERE batch.id=changed.import_batch_id
          AND batch.workspace_id=changed.workspace_id
          AND batch.status='completed'
      )
  LOOP
    PERFORM queue_signal_semantic_review_projection_refresh_v1(
      workspace_row.workspace_id,NULL,'semantic_assertion_or_provenance_changed',false
    );
  END LOOP;
  RETURN NULL;
END;
$$;
