-- Human decisions are bound to the definition and root content observed at correction time.
ALTER TABLE signal_concept_membership_overrides ADD COLUMN definition_digest text, ADD COLUMN root_fingerprint text;
CREATE OR REPLACE VIEW signal_concept_memberships_current_v1 AS
 WITH pairs AS (
 SELECT f.workspace_id,f.root_id,signal_labeling_digest_v1(jsonb_build_object('root_id',f.root_id,'input_digest',f.input_digest)) root_fingerprint,f.input_digest,
 COALESCE(f.entity_context_digest,(SELECT digest FROM signal_entity_context_versions ce WHERE ce.workspace_id=f.workspace_id ORDER BY version_no DESC LIMIT 1)) entity_context_digest,
 f.effective_entities_digest,c.concept_key,c.definition_digest,
 chosen.labeler_digest
 FROM signal_mention_facets_current_v1 f JOIN signal_membership_concepts_v1 c ON c.workspace_id=f.workspace_id
 LEFT JOIN LATERAL (
 SELECT l.labeler_digest FROM signal_labeler_versions l LEFT JOIN signal_workspace_labelers s
 ON s.workspace_id=f.workspace_id AND s.kind='membership' AND s.labeler_version_id=l.id
 WHERE l.kind='membership' AND l.status<>'retired' AND (s.workspace_id IS NOT NULL OR l.status='approved')
 ORDER BY (s.workspace_id IS NOT NULL) DESC,l.approved_at DESC NULLS LAST,l.created_at DESC LIMIT 1
 ) chosen ON true
 WHERE f.relevance='relevant' AND NOT f.requires_context_review
 AND (c.scope='all_conversations' OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.facets#>'{entities,value}') e WHERE e->>'kind'=c.scope))
 ) SELECT p.*,COALESCE(o.verdict,m.verdict,technical.result->>'verdict','pending') verdict,
 CASE WHEN o.id IS NOT NULL THEN '[]'::jsonb ELSE COALESCE(m.citations,technical.result->'citations','[]'::jsonb) END citations,
 CASE WHEN o.id IS NOT NULL THEN NULL ELSE COALESCE(m.rationale,technical.result->>'rationale') END rationale,
 CASE WHEN o.id IS NOT NULL THEN 'human' WHEN m.call_id IS NOT NULL OR technical.result IS NOT NULL THEN 'model' ELSE 'pending' END source,
 m.call_id,m.run_id,COALESCE(o.created_at,m.created_at) updated_at,
 technical.result->>'error_code' error_code,technical.result->>'refusal_category' refusal_category,
 (stale_override.id IS NOT NULL) requires_override_review
 FROM pairs p LEFT JOIN signal_concept_memberships m ON m.workspace_id=p.workspace_id AND m.root_id=p.root_id
 AND m.root_fingerprint=p.root_fingerprint AND m.concept_key=p.concept_key AND m.definition_digest=p.definition_digest
 AND m.labeler_digest=p.labeler_digest AND m.entity_context_digest=p.entity_context_digest AND m.effective_entities_digest=p.effective_entities_digest
 LEFT JOIN signal_concept_membership_overrides o ON o.workspace_id=p.workspace_id AND o.root_id=p.root_id AND o.concept_key=p.concept_key AND o.superseded_at IS NULL
 AND o.definition_digest=p.definition_digest AND o.root_fingerprint=p.root_fingerprint
 LEFT JOIN signal_concept_membership_overrides stale_override ON stale_override.workspace_id=p.workspace_id
 AND stale_override.root_id=p.root_id AND stale_override.concept_key=p.concept_key
 AND stale_override.superseded_at IS NULL AND (stale_override.definition_digest IS DISTINCT FROM p.definition_digest
 OR stale_override.root_fingerprint IS DISTINCT FROM p.root_fingerprint)
 LEFT JOIN LATERAL (
 SELECT result FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
 JOIN signal_labeler_versions l ON l.id=run.labeler_version_id CROSS JOIN LATERAL jsonb_array_elements(call.results) result
 WHERE o.id IS NULL AND (m.call_id IS NULL OR m.verdict='refused')
 AND call.workspace_id=p.workspace_id AND (m.call_id IS NULL OR call.id=m.call_id) AND run.kind='membership' AND NOT COALESCE((run.membership_snapshot->>'preview')::boolean,false)
 AND call.results_applied AND l.labeler_digest=p.labeler_digest AND result->>'root_id'=p.root_id::text
 AND result->>'root_fingerprint'=p.root_fingerprint AND result->>'concept_key'=p.concept_key
 AND result->>'definition_digest'=p.definition_digest AND result->>'entity_context_digest'=p.entity_context_digest
 AND result->>'effective_entities_digest'=p.effective_entities_digest AND result->>'verdict' IN('error','refused')
 ORDER BY call.created_at DESC LIMIT 1
 ) technical ON o.id IS NULL AND (m.call_id IS NULL OR m.verdict='refused');
