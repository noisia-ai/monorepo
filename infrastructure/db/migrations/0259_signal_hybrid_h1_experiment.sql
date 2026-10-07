-- H1 is opt-in per workspace. Installation creates no route, run, provider call or spend.
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_name;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_name CHECK(action IN(
 'brand_context_proposal','topic_prototype_embeddings','corpus_preparation','corpus_embeddings','topic_fit',
 'topic_interpretation','topic_fit_incremental','topic_interpretation_incremental','topic_consolidation',
 'topic_consolidation_numeric','interest_decision','mention_facets','concept_membership',
 'concept_membership_jev','concept_membership_claude'));
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_provider;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_provider CHECK(
 (kind='free' AND action IN('corpus_preparation','topic_fit','topic_fit_incremental','topic_consolidation_numeric')
  AND provider IS NULL AND model IS NULL AND max_execution_micro_usd=0)
 OR (kind='provider' AND provider IS NOT NULL AND model IS NOT NULL AND (
  action IN('brand_context_proposal','topic_interpretation','topic_interpretation_incremental','topic_consolidation','interest_decision')
    AND provider='anthropic' AND model='claude-sonnet-4-6'
  OR action IN('topic_prototype_embeddings','corpus_embeddings') AND provider='voyage' AND model='voyage-4-large'
  OR action IN('mention_facets','concept_membership') AND
    (provider='anthropic' AND model='claude-sonnet-5-5' OR provider='typesafe' AND model IN('jev-latest','jev-1.13.0'))
  OR action='concept_membership_jev' AND provider='typesafe' AND model='jev-1.13.0'
  OR action='concept_membership_claude' AND provider='anthropic' AND model='claude-sonnet-5-5')));
ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT processing_nullable_action_cap;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT processing_nullable_action_cap CHECK(
 max_execution_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','concept_membership_jev',
 'concept_membership_claude','corpus_embeddings','topic_interpretation','topic_consolidation'));
ALTER TABLE signal_processing_admissions DROP CONSTRAINT processing_nullable_admission_cap;
ALTER TABLE signal_processing_admissions ADD CONSTRAINT processing_nullable_admission_cap CHECK(
 execution_cap_micro_usd IS NOT NULL OR action IN('mention_facets','concept_membership','concept_membership_jev',
 'concept_membership_claude','corpus_embeddings','topic_interpretation','topic_consolidation'));
CREATE TABLE signal_hybrid_membership_routes (
  workspace_id uuid PRIMARY KEY REFERENCES signal_workspaces(id),
  route text NOT NULL CHECK (route='hybrid_h1'),
  route_digest text NOT NULL CHECK (route_digest ~ '^sha256:[a-f0-9]{64}$'),
  jev_labeler_digest text NOT NULL,
  claude_labeler_digest text NOT NULL,
  jev_facets_labeler_version_id uuid NOT NULL REFERENCES signal_labeler_versions(id),
  prior_facets_labeler_version_id uuid REFERENCES signal_labeler_versions(id),
  configured_by_user_id uuid NOT NULL REFERENCES users(id),
  configured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE signal_hybrid_membership_decisions (
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
  root_id uuid NOT NULL REFERENCES mentions(id),
  root_fingerprint text NOT NULL,
  concept_key text NOT NULL,
  definition_digest text NOT NULL,
  entity_context_digest text NOT NULL,
  effective_entities_digest text NOT NULL,
  route_digest text NOT NULL,
  result_digest text NOT NULL CHECK (result_digest ~ '^sha256:[a-f0-9]{64}$'),
  verdict text NOT NULL CHECK (verdict IN ('belongs','not_belongs','review_required','error','refused')),
  jev jsonb NOT NULL CHECK (jsonb_typeof(jev)='object'),
  claude jsonb CHECK (claude IS NULL OR jsonb_typeof(claude)='object'),
  citation jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(citation)='array'),
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,root_fingerprint,concept_key,definition_digest,entity_context_digest,effective_entities_digest,route_digest),
  CHECK (verdict<>'belongs' OR claude IS NOT NULL AND jsonb_array_length(citation)>0),
  CHECK (verdict<>'review_required' OR claude IS NOT NULL AND jev ? 'citation' AND claude ? 'citation')
);
CREATE INDEX signal_hybrid_membership_reviews ON signal_hybrid_membership_decisions(workspace_id,verdict,root_id,concept_key)
  WHERE verdict='review_required';
ALTER TABLE signal_hybrid_membership_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_hybrid_membership_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_hybrid_membership_routes,signal_hybrid_membership_decisions FROM PUBLIC;
-- The current view is redefined below with the same columns. Missing H1 decisions stay pending.

CREATE OR REPLACE VIEW signal_concept_memberships_current_v1 AS
 WITH pairs AS (
 SELECT f.workspace_id,f.root_id,signal_labeling_digest_v1(jsonb_build_object('root_id',f.root_id,'input_digest',f.input_digest)) root_fingerprint,f.input_digest,
 COALESCE(f.entity_context_digest,(SELECT digest FROM signal_entity_context_versions ce WHERE ce.workspace_id=f.workspace_id ORDER BY version_no DESC LIMIT 1)) entity_context_digest,
 f.effective_entities_digest,c.concept_key,c.definition_digest,
 COALESCE(route.route_digest,chosen.labeler_digest) labeler_digest
 FROM signal_mention_facets_current_v1 f JOIN signal_membership_concepts_v1 c ON c.workspace_id=f.workspace_id
 LEFT JOIN signal_hybrid_membership_routes route ON route.workspace_id=f.workspace_id
 LEFT JOIN LATERAL (
 SELECT l.labeler_digest FROM signal_labeler_versions l LEFT JOIN signal_workspace_labelers s
 ON s.workspace_id=f.workspace_id AND s.kind='membership' AND s.labeler_version_id=l.id
 WHERE l.kind='membership' AND l.status<>'retired' AND (s.workspace_id IS NOT NULL OR l.status='approved')
 ORDER BY (s.workspace_id IS NOT NULL) DESC,l.approved_at DESC NULLS LAST,l.created_at DESC LIMIT 1
 ) chosen ON true
 WHERE f.relevance='relevant' AND NOT f.requires_context_review
 AND (c.scope='all_conversations' OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.facets#>'{entities,value}') e WHERE e->>'kind'=c.scope))
 ) SELECT p.*,COALESCE(o.verdict,h.verdict,m.verdict,technical.result->>'verdict','pending') verdict,
 CASE WHEN o.id IS NOT NULL THEN '[]'::jsonb ELSE COALESCE(h.citation,m.citations,technical.result->'citations','[]'::jsonb) END citations,
 CASE WHEN o.id IS NOT NULL THEN NULL ELSE COALESCE(h.rationale,m.rationale,technical.result->>'rationale') END rationale,
 CASE WHEN o.id IS NOT NULL THEN 'human' WHEN h.verdict IS NOT NULL OR m.call_id IS NOT NULL OR technical.result IS NOT NULL THEN 'model' ELSE 'pending' END source,
 m.call_id,m.run_id,COALESCE(o.created_at,h.created_at,m.created_at) updated_at,
 technical.result->>'error_code' error_code,technical.result->>'refusal_category' refusal_category,
 (stale_override.id IS NOT NULL) requires_override_review
 FROM pairs p LEFT JOIN signal_concept_memberships m ON m.workspace_id=p.workspace_id AND m.root_id=p.root_id
 AND m.root_fingerprint=p.root_fingerprint AND m.concept_key=p.concept_key AND m.definition_digest=p.definition_digest
 AND m.labeler_digest=p.labeler_digest AND m.entity_context_digest=p.entity_context_digest AND m.effective_entities_digest=p.effective_entities_digest
 LEFT JOIN signal_hybrid_membership_decisions h ON h.workspace_id=p.workspace_id AND h.root_id=p.root_id
 AND h.root_fingerprint=p.root_fingerprint AND h.concept_key=p.concept_key AND h.definition_digest=p.definition_digest
 AND h.entity_context_digest=p.entity_context_digest AND h.effective_entities_digest=p.effective_entities_digest
 AND h.route_digest=p.labeler_digest
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
