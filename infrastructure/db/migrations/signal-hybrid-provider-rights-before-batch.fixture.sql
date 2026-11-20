-- Frozen prior native rights query for bounded equivalence controls.

    SELECT count(DISTINCT call.id)::int found,count(*) FILTER(WHERE provider.allowed IS NOT NULL)::int allowed,
      count(input)::int input_count
    FROM signal_labeling_calls call
    LEFT JOIN LATERAL jsonb_array_elements(call.inputs) input ON true
    LEFT JOIN LATERAL (
      SELECT 1 allowed FROM signal_mention_import_memberships path
      JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=path.workspace_id
        AND batch.data_source_id=path.data_source_id AND batch.status='completed'
      JOIN data_sources source ON source.id=path.data_source_id AND source.workspace_id=path.workspace_id
        AND source.status='active'
      JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=path.workspace_id
      JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=path.workspace_id AND candidate.data_source_id=path.data_source_id
          AND candidate.status='active' AND candidate.effective_from<=now()
          AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
          AND (candidate.import_batch_id=path.import_batch_id OR candidate.import_batch_id IS NULL)
        ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
      JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id
        AND license.workspace_id=path.workspace_id AND license.status='active'
        AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
      JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.workspace_id=path.workspace_id AND retention.status='active'
        AND retention.retention_state='allowed' AND retention.effective_from<=now()
        AND (retention.effective_to IS NULL OR retention.effective_to>now())
        AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
      WHERE path.workspace_id=call.workspace_id AND origin.canonical_mention_id::text=input->>'root_id'
        AND NOT EXISTS (SELECT 1 FROM (VALUES ('llm-processing'),('client-derived-metrics'),
          ('client-mention-list'),('client-text-or-excerpt')) required(purpose) WHERE NOT EXISTS (
          SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=path.workspace_id
            AND usage.licensing_policy_id=license.id AND usage.usage_purpose=required.purpose
            AND usage.decision='allowed'))
      LIMIT 1
    ) provider ON true
    WHERE call.run_id=$1 AND call.workspace_id=$2 AND call.id=ANY($3::uuid[])
