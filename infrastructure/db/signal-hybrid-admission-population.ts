/** Bound the H1 stage estimate to one materialization of each governed surface. */
export const hybridH1JevAdmissionPopulationSqlV1 = `WITH current_memberships AS MATERIALIZED (
  SELECT root_id,root_fingerprint,concept_key,definition_digest,entity_context_digest,effective_entities_digest
  FROM signal_concept_memberships_current_v1
  WHERE workspace_id=$1 AND labeler_digest=$2 AND verdict='pending'
), current_facets AS MATERIALIZED (
  SELECT root_id,full_text FROM signal_mention_facets_current_v1 WHERE workspace_id=$1
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
WHERE applied.root_id IS NULL`;

export const hybridH1ClaudeAdmissionPopulationSqlV1 = `WITH jev_positive AS MATERIALIZED (
  SELECT result->>'root_id' root_id
  FROM signal_labeling_calls call CROSS JOIN LATERAL jsonb_array_elements(call.results) result
  WHERE call.run_id=$1 AND call.status='settled' AND call.results_applied
    AND result#>>'{jev,verdict}'='belongs'
), current_facets AS MATERIALIZED (
  SELECT root_id,full_text FROM signal_mention_facets_current_v1 WHERE workspace_id=$2
), authorized_roots AS MATERIALIZED (
  SELECT root_id FROM signal_membership_evidence_rights_v1
  WHERE workspace_id=$2 AND metrics AND evidence
)
SELECT count(DISTINCT positive.root_id)::int roots,count(*)::int pairs,
  COALESCE(sum(length(f.full_text)),0)::text characters
FROM jev_positive positive JOIN current_facets f ON f.root_id=positive.root_id::uuid
JOIN authorized_roots rights ON rights.root_id=f.root_id`;
