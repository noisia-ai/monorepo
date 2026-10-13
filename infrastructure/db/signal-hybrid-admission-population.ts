/** Deterministic parser failures are final; at most three governed attempts per unchanged pair and stage. */
import {hybridCompatibleJevRunSqlV1,hybridJevPositiveSqlV1} from './signal-hybrid-semantic-cache-sql';
export const hybridPairRetrySqlV1 = (stage:"jev"|"claude"|"citation") => `current.error_code IS DISTINCT FROM 'hybrid_attempts_exhausted'
 ${stage==='citation'?'':"AND COALESCE(current.error_code,'') !~ '^(membership_|incomplete_single_root)'"}
 AND signal_hybrid_pair_attempts_v1(current.workspace_id,current.labeler_digest,'${stage}',
 current.root_id::text,current.root_fingerprint,current.concept_key,current.definition_digest,
 current.entity_context_digest,current.effective_entities_digest)<3`;
/** A paid confirmation survives a technical verifier failure on the same provenance. */
export const hybridUnconfirmedPairSqlV1 = `NOT EXISTS (
 SELECT 1 FROM signal_labeling_calls confirmation
 JOIN signal_labeling_runs source ON source.id=confirmation.run_id
 CROSS JOIN LATERAL jsonb_array_elements(confirmation.results) result
 WHERE confirmation.workspace_id=current.workspace_id AND source.membership_snapshot->>'route_digest'=current.labeler_digest
 AND source.membership_snapshot->>'hybrid_stage'='claude' AND confirmation.status='settled' AND confirmation.results_applied
 AND (NOT result ? 'citation_window' OR (SELECT count(DISTINCT item#>>'{citation_window,index}')
  FROM signal_labeling_calls covered CROSS JOIN LATERAL jsonb_array_elements(covered.results) item
  WHERE covered.run_id=confirmation.run_id AND covered.status='settled' AND covered.results_applied
   AND item->>'root_id'=result->>'root_id' AND item->>'concept_key'=result->>'concept_key'
   AND item#>>'{claude,verdict}' IN('belongs','not_belongs','insufficient','error','refused'))=(result#>>'{citation_window,count}')::int)
 AND result#>>'{claude,verdict}'='belongs' AND result->>'root_id'=current.root_id::text
 AND result->>'root_fingerprint'=current.root_fingerprint AND result->>'concept_key'=current.concept_key
 AND result->>'definition_digest'=current.definition_digest AND result->>'entity_context_digest'=current.entity_context_digest
 AND result->>'effective_entities_digest'=current.effective_entities_digest
)`;
/** Unattributed cost or submission uncertainty cannot authorize another send of the same pair. */
export const hybridUncertainPairSqlV1 = `NOT EXISTS (
  SELECT 1 FROM signal_labeling_calls uncertain
  JOIN signal_labeling_runs prior ON prior.id=uncertain.run_id
  CROSS JOIN LATERAL jsonb_array_elements(uncertain.inputs) input
  CROSS JOIN LATERAL jsonb_array_elements(input->'evaluated_concepts') concept
  WHERE uncertain.workspace_id=current.workspace_id AND prior.kind='membership'
    AND (uncertain.status IN('submitting','unknown') OR uncertain.terminal_exposure_micro_usd>0)
    AND input->>'root_id'=current.root_id::text
    AND input->>'root_fingerprint'=current.root_fingerprint
    AND concept->>'concept_key'=current.concept_key
    AND concept->>'definition_digest'=current.definition_digest
    AND input->>'entity_context_digest'=current.entity_context_digest
    AND input->>'effective_entities_digest'=current.effective_entities_digest
)`;

/** Bound the H1 stage estimate to one materialization of each governed surface. */
export const hybridH1JevAdmissionPopulationSqlV1 = `WITH current_memberships AS MATERIALIZED (
  SELECT root_id,root_fingerprint,concept_key,definition_digest,entity_context_digest,effective_entities_digest
  FROM signal_concept_memberships_current_v1 current
  WHERE workspace_id=$1 AND labeler_digest=$2 AND verdict IN('pending','error')
    AND ${hybridPairRetrySqlV1("jev")}
), current_facets AS MATERIALIZED (
  SELECT root_id,full_text FROM signal_mention_facets_current_v1 WHERE workspace_id=$1
    AND status IN('labeled','abstained') AND relevance='relevant' AND NOT requires_context_review
    AND facets#>>'{spam_or_bot,value}'='false'
    AND jsonb_array_length(COALESCE(facets#>'{entities,value}','[]'::jsonb))>0
), authorized_roots AS MATERIALIZED (
  SELECT root_id FROM signal_membership_evidence_rights_v1
  WHERE workspace_id=$1 AND metrics AND evidence
), applied_results AS MATERIALIZED (
  SELECT DISTINCT ON(result->>'root_id',result->>'concept_key',result->>'definition_digest',result->>'root_fingerprint',result->>'entity_context_digest',result->>'effective_entities_digest')
    result->>'root_id' root_id,result->>'root_fingerprint' root_fingerprint,
    result->>'concept_key' concept_key,result->>'definition_digest' definition_digest,
    result->>'entity_context_digest' entity_context_digest,
    result->>'effective_entities_digest' effective_entities_digest
  FROM signal_labeling_calls applied JOIN signal_labeling_runs prior ON prior.id=applied.run_id
  CROSS JOIN LATERAL jsonb_array_elements(applied.results) result
  WHERE prior.workspace_id=$1 AND prior.kind='membership'
    AND prior.membership_snapshot->>'hybrid_stage'='jev'
    AND prior.membership_snapshot->>'route_digest'=$2
    AND applied.status='settled' AND applied.results_applied
    AND result#>>'{jev,verdict}' IN('belongs','not_belongs','refused')
), uncertain_pairs AS MATERIALIZED (
  SELECT input->>'root_id' root_id,input->>'root_fingerprint' root_fingerprint,
    concept->>'concept_key' concept_key,concept->>'definition_digest' definition_digest,
    input->>'entity_context_digest' entity_context_digest,
    input->>'effective_entities_digest' effective_entities_digest
  FROM signal_labeling_calls unknown_call JOIN signal_labeling_runs prior ON prior.id=unknown_call.run_id
  CROSS JOIN LATERAL jsonb_array_elements(unknown_call.inputs) input
  CROSS JOIN LATERAL jsonb_array_elements(input->'evaluated_concepts') concept
  WHERE prior.workspace_id=$1 AND prior.kind='membership' AND (unknown_call.status='unknown' OR unknown_call.terminal_exposure_micro_usd>0)
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
    AND (run.membership_snapshot->>'route_digest'=$2 OR ${hybridCompatibleJevRunSqlV1('run')})
    AND call.status='settled' AND call.results_applied AND result#>>'{jev,verdict}' IN('belongs','not_belongs') AND ${hybridJevPositiveSqlV1}
), current_memberships AS MATERIALIZED (
  SELECT root_id,root_fingerprint,concept_key,definition_digest,entity_context_digest,
    effective_entities_digest FROM signal_concept_memberships_current_v1 current
  WHERE workspace_id=$1 AND labeler_digest=$2 AND verdict IN('pending','error')
    AND ${hybridUncertainPairSqlV1} AND ${hybridPairRetrySqlV1("claude")} AND ${hybridUnconfirmedPairSqlV1}
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
