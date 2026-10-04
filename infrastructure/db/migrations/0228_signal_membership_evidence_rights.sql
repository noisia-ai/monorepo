-- Current display rights; membership evidence does not inherit LLM-processing rights.
CREATE VIEW signal_membership_evidence_rights_v1 AS
WITH received_imports AS MATERIALIZED (
  SELECT batch.id,batch.data_source_id,batch.workspace_id FROM import_batches batch
  JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=batch.workspace_id AND source.status='active'
  WHERE batch.status='completed'
), authorized_imports AS MATERIALIZED (
  SELECT batch.id,batch.data_source_id,batch.workspace_id,
    EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=batch.workspace_id
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-derived-metrics' AND usage.decision='allowed') metrics,
    (EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=batch.workspace_id
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-mention-list' AND usage.decision='allowed')
     AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=batch.workspace_id
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-text-or-excerpt' AND usage.decision='allowed')) evidence
  FROM received_imports batch
  JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
    WHERE candidate.workspace_id=batch.workspace_id AND candidate.data_source_id=batch.data_source_id
      AND candidate.status='active' AND candidate.effective_from<=now() AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
      AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
    ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
  JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=batch.workspace_id
    AND license.status='active' AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
  JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=batch.workspace_id
    AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
    AND (retention.effective_to IS NULL OR retention.effective_to>now())
    AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
), root_rights AS MATERIALIZED (
  SELECT rights.workspace_id,origin.canonical_mention_id root_id,bool_or(rights.metrics) metrics,bool_or(rights.metrics AND rights.evidence) evidence
  FROM authorized_imports rights JOIN signal_mention_import_memberships path ON path.import_batch_id=rights.id
    AND path.data_source_id=rights.data_source_id AND path.workspace_id=rights.workspace_id
  JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=rights.workspace_id
  GROUP BY rights.workspace_id,origin.canonical_mention_id
)
SELECT * FROM root_rights;
REVOKE ALL ON signal_membership_evidence_rights_v1 FROM PUBLIC;
