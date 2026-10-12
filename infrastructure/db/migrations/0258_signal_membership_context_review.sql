-- Apply after 0257; forward-only correction for membership-triggered CE review.
-- Keep served facet labels visible during explicit full-CE confirmation.
-- The new version becomes the validity fence only after confirmation.
CREATE OR REPLACE VIEW signal_mention_facets_current_v1 AS
 WITH population AS (
 SELECT i.workspace_id,i.root_id,i.run_id preparation_run_id,i.asset_sha256,a.full_text,m.title,m.platform,m.content_type,
 (CASE WHEN m.source_author_label_recorded THEN m.source_author_label ELSE COALESCE(author.handle,author.display_name) END) author,m.published_at,m.language,
 signal_labeling_digest_v1(jsonb_build_object('text_sha256',i.asset_sha256,'title',m.title,'platform',m.platform,'content_type',m.content_type,'author',(CASE WHEN m.source_author_label_recorded THEN m.source_author_label ELSE COALESCE(author.handle,author.display_name) END))) input_digest
 FROM signal_corpus_preparation_input_state s JOIN LATERAL (
 SELECT r.* FROM signal_corpus_preparation_runs r WHERE r.workspace_id=s.workspace_id AND r.status='completed'
 AND r.input_revision=s.input_revision AND (r.policy_valid_until IS NULL OR r.policy_valid_until>now()) ORDER BY r.completed_at DESC,r.id DESC LIMIT 1
 ) r ON true JOIN signal_corpus_preparation_items i ON i.run_id=r.id AND i.disposition='eligible'
 JOIN signal_corpus_text_assets a ON a.workspace_id=i.workspace_id AND a.text_sha256=i.asset_sha256 AND a.chunk_policy_version=i.chunk_policy_version
 JOIN mentions m ON m.id=i.root_id AND m.text_clean=a.full_text LEFT JOIN authors author ON author.id=m.author_id
 ), effective AS (
 SELECT p.*,l.labeler_digest,l.entity_context_digest,CASE WHEN validation.requires_context_review THEN 'error' ELSE COALESCE(l.status,technical.result->>'status','pending') END status,l.refusal_category,
 CASE WHEN validation.requires_context_review THEN 'override_entity_context_changed' ELSE technical.result->>'error_code' END error_code,validation.requires_context_review,
 CASE WHEN validation.requires_context_review THEN NULL
      WHEN l.facets IS NOT NULL THEN l.facets||COALESCE(o.patch,'{}'::jsonb)
      WHEN o.patch IS NOT NULL THEN jsonb_build_object(
        'entities',jsonb_build_object('value','[]'::jsonb,'confidence','low','abstained',true),
        'unrelated_reason',NULL,
        'voice',jsonb_build_object('value','unknown','confidence','low','abstained',true),
        'act',jsonb_build_object('value','other','confidence','low','abstained',true),
        'spam_or_bot',jsonb_build_object('value',false,'confidence','low','abstained',true),
        'language',jsonb_build_object('value',NULL,'confidence','low','abstained',true),
        'asunto',jsonb_build_object('value',NULL,'confidence','low','abstained',true)
      )||o.patch
      ELSE NULL END facets
 FROM population p LEFT JOIN LATERAL (
 SELECT v.labeler_digest FROM signal_labeler_versions v LEFT JOIN signal_workspace_labelers chosen
 ON chosen.workspace_id=p.workspace_id AND chosen.kind='facets' AND chosen.labeler_version_id=v.id
 WHERE v.kind='facets' AND v.status<>'retired' AND (chosen.workspace_id IS NOT NULL OR v.status='approved')
 ORDER BY (chosen.workspace_id IS NOT NULL) DESC,v.approved_at DESC NULLS LAST,v.created_at DESC LIMIT 1
 ) labeler ON true LEFT JOIN LATERAL (
 SELECT max(v.version_no) min_version FROM signal_entity_context_versions v WHERE v.workspace_id=p.workspace_id
 AND (v.affected_mode='full' OR EXISTS(SELECT 1 FROM signal_entity_context_affected_roots ar WHERE ar.workspace_id=v.workspace_id AND ar.version_no=v.version_no AND ar.root_id=p.root_id))
 AND NOT EXISTS(SELECT 1 FROM signal_labeling_runs waiting WHERE waiting.workspace_id=v.workspace_id AND waiting.kind IN ('facets','membership')
   AND waiting.entity_context_version_no=v.version_no AND waiting.waiting_full_confirmation AND NOT waiting.full_recalculation_confirmed)
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
,
 EXISTS(SELECT 1 FROM signal_labeling_runs waiting WHERE waiting.workspace_id=effective.workspace_id AND waiting.kind IN ('facets','membership')
   AND waiting.waiting_full_confirmation AND NOT waiting.full_recalculation_confirmed
   AND waiting.entity_context_version_no=(SELECT max(version_no) FROM signal_entity_context_versions WHERE workspace_id=effective.workspace_id)) pending_context_review
 FROM effective;
