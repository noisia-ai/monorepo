-- New multi-concept engine. No backfill and no mutation of V2 decisions.
ALTER TABLE signal_labeling_runs ADD COLUMN membership_snapshot jsonb;
CREATE TABLE signal_concept_memberships (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),root_id uuid NOT NULL REFERENCES mentions(id),
 root_fingerprint text NOT NULL,concept_key text NOT NULL,definition_digest text NOT NULL,labeler_digest text NOT NULL,
 entity_context_digest text NOT NULL,effective_entities_digest text NOT NULL,
 run_id uuid NOT NULL,call_id uuid NOT NULL REFERENCES signal_labeling_calls(id),
 verdict text NOT NULL CHECK(verdict IN('belongs','not_belongs','insufficient','refused','error')),
 citations jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(citations)='array'),rationale text,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,root_fingerprint,concept_key,definition_digest,labeler_digest,entity_context_digest,effective_entities_digest),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id),
 CHECK(verdict NOT IN('belongs','insufficient') OR jsonb_array_length(citations)>0)
);
CREATE INDEX signal_concept_memberships_root ON signal_concept_memberships(workspace_id,root_id,concept_key);
CREATE TABLE signal_concept_membership_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 root_id uuid NOT NULL REFERENCES mentions(id),concept_key text NOT NULL,
 verdict text NOT NULL CHECK(verdict IN('belongs','not_belongs')),
 actor_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),superseded_at timestamptz
);
CREATE UNIQUE INDEX signal_concept_membership_override_current ON signal_concept_membership_overrides(workspace_id,root_id,concept_key) WHERE superseded_at IS NULL;
-- Mirror loadLatestProfile's working head and materialized-child traversal.
CREATE VIEW signal_membership_concepts_v1 AS
 WITH RECURSIVE profiles AS (
 SELECT p.*,p.metadata->>'catalog_role' role,p.metadata->>'source_catalog_profile_id' parent
 FROM signal_taxonomy_profiles p WHERE kind='topic' AND status IN('draft','activating','active','retired')
 AND metadata->>'contract_version'='signal-topic-catalog-v1'
 ), heads AS (
 SELECT DISTINCT ON(workspace_id) * FROM profiles WHERE role='working' OR role IS NULL
 ORDER BY workspace_id,(role='working') DESC NULLS LAST,version DESC,id DESC
 ), chain AS (
 SELECT h.workspace_id,h.id,h.taxonomy_id,h.version,0 depth FROM heads h
 UNION ALL
 SELECT child.workspace_id,child.id,child.taxonomy_id,child.version,chain.depth+1 FROM chain
 JOIN LATERAL (SELECT p.* FROM profiles p WHERE p.workspace_id=chain.workspace_id AND p.parent=chain.id::text
 AND p.role IN('analysis_materialized','incremental') AND p.version>chain.version ORDER BY p.version DESC,p.id DESC LIMIT 1) child ON true
 ), current_profile AS (SELECT DISTINCT ON(workspace_id) * FROM chain ORDER BY workspace_id,depth DESC)
 SELECT p.workspace_id,t.id taxonomy_term_id,t.term_key concept_key,t.metadata->'topic' topic,
 t.metadata#>>'{topic,definition_digest}' definition_digest,t.metadata#>>'{topic,scope}' scope
 FROM current_profile p JOIN taxonomy_terms t ON t.taxonomy_id=p.taxonomy_id
 WHERE t.metadata#>>'{topic,lifecycle}'<>'archived' AND (t.metadata#>>'{topic,origin}'='manual' OR t.metadata#>>'{topic,origin}'='workspace_discovery' AND t.metadata#>>'{topic,source,run_key}' LIKE 'workspace-discovery:%');
CREATE VIEW signal_concept_memberships_current_v1 AS
 WITH pairs AS (
 SELECT f.workspace_id,f.root_id,f.input_digest root_fingerprint,f.input_digest,
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
 CASE WHEN o.verdict='not_belongs' THEN '[]'::jsonb ELSE COALESCE(m.citations,technical.result->'citations','[]'::jsonb) END citations,
 CASE WHEN o.id IS NOT NULL THEN NULL ELSE COALESCE(m.rationale,technical.result->>'rationale') END rationale,
 CASE WHEN o.id IS NOT NULL THEN 'human' WHEN m.call_id IS NOT NULL OR technical.result IS NOT NULL THEN 'model' ELSE 'pending' END source,
 m.call_id,m.run_id,COALESCE(o.created_at,m.created_at) updated_at,
 technical.result->>'error_code' error_code,technical.result->>'refusal_category' refusal_category
 FROM pairs p LEFT JOIN signal_concept_memberships m ON m.workspace_id=p.workspace_id AND m.root_id=p.root_id
 AND m.root_fingerprint=p.root_fingerprint AND m.concept_key=p.concept_key AND m.definition_digest=p.definition_digest
 AND m.labeler_digest=p.labeler_digest AND m.entity_context_digest=p.entity_context_digest AND m.effective_entities_digest=p.effective_entities_digest
 LEFT JOIN signal_concept_membership_overrides o ON o.workspace_id=p.workspace_id AND o.root_id=p.root_id AND o.concept_key=p.concept_key AND o.superseded_at IS NULL
 LEFT JOIN LATERAL (
 SELECT result FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
 JOIN signal_labeler_versions l ON l.id=run.labeler_version_id CROSS JOIN LATERAL jsonb_array_elements(call.results) result
 WHERE call.workspace_id=p.workspace_id AND run.kind='membership' AND NOT COALESCE((run.membership_snapshot->>'preview')::boolean,false)
 AND call.results_applied AND l.labeler_digest=p.labeler_digest AND result->>'root_id'=p.root_id::text
 AND result->>'root_fingerprint'=p.root_fingerprint AND result->>'concept_key'=p.concept_key
 AND result->>'definition_digest'=p.definition_digest AND result->>'entity_context_digest'=p.entity_context_digest
 AND result->>'effective_entities_digest'=p.effective_entities_digest AND result->>'verdict' IN('error','refused')
 ORDER BY call.created_at DESC LIMIT 1
 ) technical ON m.call_id IS NULL;
ALTER TABLE signal_concept_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_concept_membership_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_concept_memberships,signal_concept_membership_overrides,signal_membership_concepts_v1,signal_concept_memberships_current_v1 FROM PUBLIC;
CREATE FUNCTION signal_concept_membership_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'concept_membership_history_retained' USING ERRCODE='55000'; END $$;
CREATE TRIGGER signal_concept_membership_immutable BEFORE UPDATE OR DELETE ON signal_concept_memberships FOR EACH ROW EXECUTE FUNCTION signal_concept_membership_immutable_v1();
REVOKE ALL ON FUNCTION signal_concept_membership_immutable_v1() FROM PUBLIC;
