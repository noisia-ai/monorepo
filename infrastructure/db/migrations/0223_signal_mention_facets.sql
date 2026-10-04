-- Compact JSON matching the existing embedding digest (no Unicode normalization of values).
CREATE FUNCTION signal_labeling_json_v1(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN RETURN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||signal_labeling_json_v1(item),',' ORDER BY key COLLATE "C") FROM jsonb_each(value) e(key,item)),'')||'}';
 WHEN 'array' THEN RETURN '['||COALESCE((SELECT string_agg(signal_labeling_json_v1(item),',' ORDER BY pos) FROM jsonb_array_elements(value) WITH ORDINALITY e(item,pos)),'')||']';
 ELSE RETURN value::text; END CASE;
END; $$;
CREATE FUNCTION signal_labeling_digest_v1(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT 'sha256:'||encode(sha256(convert_to(signal_labeling_json_v1(value),'UTF8')),'hex') $$;
CREATE TABLE signal_mention_facet_labels (
 workspace_id uuid NOT NULL,root_id uuid NOT NULL REFERENCES mentions(id),input_digest text NOT NULL,labeler_digest text NOT NULL REFERENCES signal_labeler_versions(labeler_digest),
 entity_context_digest text NOT NULL,facet_schema_version text NOT NULL CHECK(facet_schema_version='mention-facets-v1'),
 status text NOT NULL CHECK(status IN('labeled','abstained','refused')),facets jsonb,
 relevance text NOT NULL CHECK(relevance IN('relevant','unrelated','spam','unknown')),effective_entities_digest text NOT NULL,
 call_id uuid NOT NULL REFERENCES signal_labeling_calls(id),refusal_category text,error_code text,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,input_digest,labeler_digest,entity_context_digest)
);
CREATE TABLE signal_mention_facet_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),root_id uuid NOT NULL REFERENCES mentions(id),
 dimension text NOT NULL CHECK(dimension IN('entities','unrelated_reason','voice','act','spam_or_bot','language','asunto')),value jsonb NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),superseded_at timestamptz
);
CREATE UNIQUE INDEX signal_facet_override_active ON signal_mention_facet_overrides(workspace_id,root_id,dimension) WHERE superseded_at IS NULL;
CREATE FUNCTION signal_facet_label_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'facet_labels_immutable'; END; $$;
CREATE TRIGGER signal_facet_label_immutable BEFORE UPDATE OR DELETE ON signal_mention_facet_labels FOR EACH ROW EXECUTE FUNCTION signal_facet_label_immutable_v1();
CREATE VIEW signal_mention_facets_current_v1 AS
 WITH population AS (
 SELECT i.workspace_id,i.root_id,i.run_id preparation_run_id,i.asset_sha256,a.full_text,m.title,m.platform,m.content_type,
 COALESCE(author.handle,author.display_name) author,m.published_at,m.language,
 signal_labeling_digest_v1(jsonb_build_object('text_sha256',i.asset_sha256,'title',m.title,'platform',m.platform,'content_type',m.content_type,'author',COALESCE(author.handle,author.display_name))) input_digest
 FROM signal_corpus_preparation_input_state s JOIN LATERAL (
 SELECT r.* FROM signal_corpus_preparation_runs r WHERE r.workspace_id=s.workspace_id AND r.status='completed'
 AND r.input_revision=s.input_revision AND (r.policy_valid_until IS NULL OR r.policy_valid_until>now()) ORDER BY r.completed_at DESC,r.id DESC LIMIT 1
 ) r ON true JOIN signal_corpus_preparation_items i ON i.run_id=r.id AND i.disposition='eligible'
 JOIN signal_corpus_text_assets a ON a.workspace_id=i.workspace_id AND a.text_sha256=i.asset_sha256 AND a.chunk_policy_version=i.chunk_policy_version
 JOIN mentions m ON m.id=i.root_id AND m.text_clean=a.full_text LEFT JOIN authors author ON author.id=m.author_id
 ), effective AS (
 SELECT p.*,l.labeler_digest,l.entity_context_digest,CASE WHEN validation.requires_context_review THEN 'error' ELSE COALESCE(l.status,technical.result->>'status','pending') END status,l.refusal_category,
 CASE WHEN validation.requires_context_review THEN 'override_entity_context_changed' ELSE technical.result->>'error_code' END error_code,validation.requires_context_review,
 CASE WHEN NOT validation.requires_context_review AND l.facets IS NOT NULL THEN l.facets||COALESCE(o.patch,'{}'::jsonb) ELSE NULL END facets
 FROM population p LEFT JOIN LATERAL (
 SELECT v.labeler_digest FROM signal_labeler_versions v LEFT JOIN signal_workspace_labelers chosen
 ON chosen.workspace_id=p.workspace_id AND chosen.kind='facets' AND chosen.labeler_version_id=v.id
 WHERE v.kind='facets' AND v.status<>'retired' AND (chosen.workspace_id IS NOT NULL OR v.status='approved')
 ORDER BY (chosen.workspace_id IS NOT NULL) DESC,v.approved_at DESC NULLS LAST,v.created_at DESC LIMIT 1
 ) labeler ON true LEFT JOIN LATERAL (
 SELECT max(v.version_no) min_version FROM signal_entity_context_versions v WHERE v.workspace_id=p.workspace_id
 AND (v.affected_mode='full' OR EXISTS(SELECT 1 FROM signal_entity_context_affected_roots ar WHERE ar.workspace_id=v.workspace_id AND ar.version_no=v.version_no AND ar.root_id=p.root_id))
 ) fence ON true LEFT JOIN LATERAL (
 SELECT labels.* FROM signal_mention_facet_labels labels JOIN signal_entity_context_versions ce ON ce.workspace_id=labels.workspace_id AND ce.digest=labels.entity_context_digest
 WHERE labels.workspace_id=p.workspace_id AND labels.input_digest=p.input_digest AND labels.labeler_digest=labeler.labeler_digest
 AND ce.version_no>=COALESCE(fence.min_version,1) ORDER BY ce.version_no DESC,labels.created_at DESC LIMIT 1
 ) l ON true LEFT JOIN LATERAL (
 SELECT result FROM signal_labeling_calls call
 JOIN signal_labeling_runs run ON run.id=call.run_id
 JOIN signal_labeler_versions version ON version.id=run.labeler_version_id
 JOIN signal_entity_context_versions ce ON ce.workspace_id=run.workspace_id AND ce.digest=run.entity_context_digest
 CROSS JOIN LATERAL jsonb_array_elements(call.results) result
 WHERE call.workspace_id=p.workspace_id AND call.results_applied AND version.labeler_digest=labeler.labeler_digest
 AND result->>'root_id'=p.root_id::text AND result->>'input_digest'=p.input_digest
 AND result->>'entity_context_digest'=run.entity_context_digest
 AND ce.version_no>=COALESCE(fence.min_version,1) AND result->>'status'='error'
 ORDER BY ce.version_no DESC,call.created_at DESC LIMIT 1
 ) technical ON l.status IS NULL LEFT JOIN LATERAL (
 SELECT jsonb_object_agg(dimension,value) patch FROM signal_mention_facet_overrides o WHERE o.workspace_id=p.workspace_id AND o.root_id=p.root_id AND o.superseded_at IS NULL
 ) o ON true CROSS JOIN LATERAL (
 SELECT EXISTS(
  SELECT 1 FROM jsonb_array_elements(COALESCE(o.patch#>'{entities,value}','[]'::jsonb)) entity
  WHERE NOT EXISTS(
   SELECT 1 FROM signal_entity_context_versions latest,
   LATERAL jsonb_array_elements(latest.context->'entities') known
   WHERE latest.workspace_id=p.workspace_id
   AND latest.version_no=(SELECT max(version_no) FROM signal_entity_context_versions WHERE workspace_id=p.workspace_id)
   AND known->>'entity_id'=entity->>'entity_id' AND known->>'kind'=entity->>'kind'
  )
 ) requires_context_review
 ) validation
 ) SELECT effective.*,
 CASE WHEN facets IS NULL THEN 'unknown' WHEN facets#>>'{spam_or_bot,abstained}'='false' AND facets#>>'{spam_or_bot,value}'='true' THEN 'spam'
 WHEN facets#>>'{entities,abstained}'='true' THEN 'unknown' WHEN jsonb_array_length(facets#>'{entities,value}')>0 THEN 'relevant'
 WHEN facets->>'unrelated_reason' IN('homonym','off_topic') THEN 'unrelated' ELSE 'unknown' END relevance,
 signal_labeling_digest_v1(COALESCE((SELECT jsonb_agg(e ORDER BY e->>'entity_id') FROM jsonb_array_elements(facets#>'{entities,value}') e),'[]'::jsonb)) effective_entities_digest
 FROM effective;
ALTER TABLE signal_mention_facet_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_mention_facet_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mention_facet_labels,signal_mention_facet_overrides,signal_mention_facets_current_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_labeling_json_v1(jsonb),signal_labeling_digest_v1(jsonb),signal_facet_label_immutable_v1() FROM PUBLIC;
