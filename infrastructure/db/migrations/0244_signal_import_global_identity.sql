-- Restore the prior workspace-wide provider identity for ordinary imports.
-- Explicit revise_existing roots carry a source marker in external_id and retain
-- source-local provider identity. Historical rows keep their identifiers.
DROP INDEX uq_mentions_workspace_provider_canonical;
CREATE UNIQUE INDEX uq_mentions_workspace_provider_canonical
 ON mentions(workspace_id,source_system,
   (CASE WHEN left(external_id,7)='revise:' THEN data_source_id::text ELSE '' END),
   provider_record_id)
 WHERE canonical_mention_id=id;
DROP INDEX uq_mentions_workspace_text_canonical;
CREATE UNIQUE INDEX uq_mentions_workspace_text_canonical
 ON mentions(workspace_id,text_hash,
   (CASE WHEN left(external_id,7)='revise:' THEN COALESCE(provider_record_id,'') ELSE '' END))
 WHERE canonical_mention_id=id;
