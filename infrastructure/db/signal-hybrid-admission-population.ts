/** Bound the H1 stage estimate to one materialization of each governed surface. */
export const hybridH1JevAdmissionPopulationSqlV1 = `WITH current_memberships AS MATERIALIZED (
  SELECT root_id,root_fingerprint,concept_key,definition_digest,entity_context_digest,effective_entities_digest
  FROM signal_concept_memberships_current_v1
  WHERE workspace_id=$1 AND labeler_digest=$2 AND verdict='pending'
), current_facets AS MATERIALIZED (
  SELECT root_id,full_text FROM signal_mention_facets_current_v1 WHERE workspace_id=$1
    AND status='labeled' AND relevance='relevant' AND NOT requires_context_review
    AND facets#>>'{spam_or_bot,value}'='false'
    AND jsonb_array_length(COALESCE(facets#>'{entities,value}','[]'::jsonb))>0
), authorized_roots AS MATERIALIZED (
  SELECT root_id FROM signal_membership_evidence_rights_v1
  WHERE workspace_id=$1 AND metrics AND evidence
), applied_results AS MATERIALIZED (
  SELECT result->>'root_id' root_id,result->>'root_fingerprint' root_fingerprint,
    result->>'concept_key' concept_key,result->>'definition_digest' definition_digest,
    result->>'entity_context_digest' entity_context_digest,
    result->>'effective_entities_digest' effective_entities_digest
  FROM signal_labeling_calls applied JOIN signal_labeling_runs prior ON prior.id=applied.run_id
  CROSS JOIN LATERAL jsonb_array_elements(applied.results) result
  WHERE prior.workspace_id=$1 AND prior.kind='membership'
    AND prior.membership_snapshot->>'hybrid_stage'='jev'
    AND prior.membership_snapshot->>'route_digest'=$2
    AND applied.status='settled' AND applied.results_applied
), uncertain_pairs AS MATERIALIZED (
  SELECT input->>'root_id' root_id,input->>'root_fingerprint' root_fingerprint,
    concept->>'concept_key' concept_key,concept->>'definition_digest' definition_digest,
    input->>'entity_context_digest' entity_context_digest,
    input->>'effective_entities_digest' effective_entities_digest
  FROM signal_labeling_calls unknown_call JOIN signal_labeling_runs prior ON prior.id=unknown_call.run_id
  CROSS JOIN LATERAL jsonb_array_elements(unknown_call.inputs) input
  CROSS JOIN LATERAL jsonb_array_elements(input->'evaluated_concepts') concept
  WHERE prior.workspace_id=$1 AND prior.kind='membership' AND unknown_call.status='unknown'
)
SELECT count(DISTINCT current.root_id)::int roots,count(*)::int pairs,
  COALESCE(sum(length(f.full_text)),0)::text characters
FROM current_memberships current JOIN current_facets f ON f.root_id=current.root_id
JOIN authorized_roots rights ON rights.root_id=current.root_id
LEFT JOIN applied_results applied ON applied.root_id=current.root_id::text
  AND applied.root_fingerprint=current.root_fingerprint
  AND applied.concept_key=current.concept_key
  AND applied.definition_digest=current.definition_digest
  AND applied.entity_context_digest=current.entity_context_digest
  AND applied.effective_entities_digest=current.effective_entities_digest
LEFT JOIN uncertain_pairs quarantined ON quarantined.root_id=current.root_id::text
  AND quarantined.root_fingerprint=current.root_fingerprint
  AND quarantined.concept_key=current.concept_key
  AND quarantined.definition_digest=current.definition_digest
  AND quarantined.entity_context_digest=current.entity_context_digest
  AND quarantined.effective_entities_digest=current.effective_entities_digest
WHERE applied.root_id IS NULL AND quarantined.root_id IS NULL`;

export const hybridH1ClaudeAdmissionPopulationSqlV1 = `WITH jev_positive AS MATERIALIZED (
  SELECT result->>'root_id' root_id,result->>'root_fingerprint' root_fingerprint,
    result->>'concept_key' concept_key,result->>'definition_digest' definition_digest,
    result->>'entity_context_digest' entity_context_digest,
    result->>'effective_entities_digest' effective_entities_digest
  FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
  CROSS JOIN LATERAL jsonb_array_elements(call.results) result
  WHERE run.workspace_id=$1 AND run.kind='membership' AND run.status IN('completed','failed')
    AND run.membership_snapshot->>'hybrid_stage'='jev'
    AND run.membership_snapshot->>'route_digest'=$2
    AND call.status='settled' AND call.results_applied AND result#>>'{jev,verdict}'='belongs'
), current_memberships AS MATERIALIZED (
  SELECT root_id,root_fingerprint,concept_key,definition_digest,entity_context_digest,
    effective_entities_digest FROM signal_concept_memberships_current_v1
  WHERE workspace_id=$1 AND labeler_digest=$2 AND verdict='pending'
), current_facets AS MATERIALIZED (
  SELECT root_id,full_text FROM signal_mention_facets_current_v1 WHERE workspace_id=$1
), authorized_roots AS MATERIALIZED (
  SELECT root_id FROM signal_membership_evidence_rights_v1
  WHERE workspace_id=$1 AND metrics AND evidence
)
SELECT count(DISTINCT positive.root_id)::int roots,count(*)::int pairs,
  COALESCE(sum(length(f.full_text)),0)::text characters
FROM jev_positive positive JOIN current_memberships current ON current.root_id=positive.root_id::uuid
  AND current.root_fingerprint=positive.root_fingerprint
  AND current.concept_key=positive.concept_key
  AND current.definition_digest=positive.definition_digest
  AND current.entity_context_digest=positive.entity_context_digest
  AND current.effective_entities_digest=positive.effective_entities_digest
JOIN current_facets f ON f.root_id=positive.root_id::uuid
JOIN authorized_roots rights ON rights.root_id=f.root_id`;
