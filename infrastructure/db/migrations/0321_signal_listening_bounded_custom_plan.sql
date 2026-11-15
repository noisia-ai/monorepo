-- Replan each bounded statement for its actual root-array cardinality.
-- The cached static branch could repeatedly rescan a 4096-row materialization
-- after 32-root warmups. Query text, fourteen fields, rights, H5 dependencies,
-- and the NULL/full dispatch remain identical to 0317. No cross-statement cache.
CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(w uuid,cid uuid,mid uuid,ctx text,roots uuid[],purpose text)
RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,
 question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,
 answer jsonb,cache_call_id uuid,scope_basis text)
LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $function$
BEGIN
 IF roots IS NULL THEN
  RETURN QUERY EXECUTE $population$
WITH eligible_batches AS MATERIALIZED(
 SELECT batch.id,batch.data_source_id FROM import_batches batch
 JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1 AND source.status='active'
 JOIN LATERAL(SELECT b.* FROM signal_provenance_policy_bindings b WHERE b.workspace_id=$1 AND b.data_source_id=batch.data_source_id
   AND b.status='active' AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
   AND (b.import_batch_id=batch.id OR b.import_batch_id IS NULL)
   ORDER BY (b.import_batch_id IS NOT NULL) DESC,b.binding_version DESC,b.id LIMIT 1) binding ON true
 JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=$1 AND license.status='active'
   AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
 JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=$1
   AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
   AND (retention.effective_to IS NULL OR retention.effective_to>now())
   AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
 WHERE batch.workspace_id=$1 AND batch.status='completed' AND $6 IN('llm-processing','client-derived-metrics')
 AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages u WHERE u.workspace_id=$1 AND u.licensing_policy_id=license.id AND u.usage_purpose=$6 AND u.decision='allowed')),
 allowed_roots AS MATERIALIZED(
 SELECT DISTINCT origin.canonical_mention_id root_id FROM eligible_batches batch
 JOIN signal_mention_import_memberships path ON path.workspace_id=$1 AND path.import_batch_id=batch.id AND path.data_source_id=batch.data_source_id
 JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=$1
 WHERE $5 IS NULL OR origin.canonical_mention_id=ANY($5)), config AS MATERIALIZED(SELECT c.*,signal_mass_labeling_category_pattern_v1(ARRAY(SELECT jsonb_array_elements_text(c.configuration->'lexicon_terms'))) category_pattern FROM signal_listening_configurations c WHERE c.workspace_id=$1 AND c.id=$2 AND c.state='published'),
 qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),
 selected_items AS MATERIALIZED(
  SELECT i.* FROM signal_mass_labeling_items i WHERE $5 IS NULL AND i.workspace_id=$1 AND i.map_id=$3
  UNION ALL
  SELECT item.* FROM (SELECT DISTINCT root FROM unnest($5) r(root) WHERE root IS NOT NULL AND cardinality($5)<=4096) selected
  CROSS JOIN LATERAL(SELECT i.* FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$3 AND i.root_id=selected.root OFFSET 0) item
  WHERE $5 IS NOT NULL),
 items AS MATERIALIZED(SELECT i.*,signal_listening_input_digest_v1(i) listening_input_digest,m.published_at,m.platform,c.category_pattern
  FROM selected_items i JOIN allowed_roots allowed ON allowed.root_id=i.root_id JOIN config c ON c.workspace_id=i.workspace_id
  JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id
  WHERE i.workspace_id=$1 AND i.map_id=$3 AND m.canonical_mention_id=m.id AND m.inclusion_status='included'
   ),
 prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,
   signal_labeling_digest_v1(jsonb_build_object('voice',v.call_id,'promotion',p.call_id)) basis,
   CASE WHEN EXISTS(SELECT 1 FROM qs WHERE qs.definition->>'scope'='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7
    THEN NOT signal_mass_labeling_r13_hashtags_v1(lexical.text_clean)
      AND signal_mass_labeling_category_pattern_matches_v1(lexical.text_clean,i.category_pattern)
    ELSE false END consumer_category_included,
   CASE WHEN (SELECT count(*) FROM qs WHERE qs.definition->>'topic_source'='defined')>8 THEN ARRAY(SELECT ranked.question_key FROM qs ranked
    JOIN signal_topic_definition_embeddings prototype ON prototype.id=COALESCE(ranked.prototype_embedding_id,(SELECT v.prototype_embedding_id FROM signal_listening_question_vectors v
      WHERE v.configuration_id=$2 AND v.question_key=ranked.question_key AND v.embedding_config_digest=(SELECT embedding_config_digest FROM signal_mass_labeling_maps WHERE id=$3))) AND prototype.workspace_id=$1
    JOIN signal_mass_labeling_maps map ON map.id=$3 AND map.workspace_id=$1
    JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=$1 AND e.config_digest=map.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
    WHERE ranked.definition->>'topic_source'='defined' AND prototype.embedding_config_digest=map.embedding_config_digest
    ORDER BY prototype.embedding <=> e.embedding,ranked.question_key LIMIT 4) ELSE NULL::text[] END defined_keys,CASE WHEN EXISTS(SELECT 1 FROM qs WHERE qs.definition->>'topic_source'='discovered') THEN signal_listening_discovery_candidates_v1($1,$2,$3,i.root_id) ELSE NULL::text[] END discovered_keys
  FROM items i LEFT JOIN qs vq ON vq.question_key='voice' LEFT JOIN qs pq ON pq.question_key='promotion'
  LEFT JOIN signal_listening_answers v ON v.workspace_id=$1 AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=$4 AND v.question_digest=vq.question_digest
  LEFT JOIN signal_listening_answers p ON p.workspace_id=$1 AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=$4 AND p.question_digest=pq.question_digest
  LEFT JOIN LATERAL(SELECT m.text_clean FROM mentions m WHERE m.workspace_id=$1 AND m.id=i.root_id
    AND EXISTS(SELECT 1 FROM qs WHERE qs.definition->>'scope'='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7 OFFSET 0) lexical ON true)
 SELECT i.root_id,i.listening_input_digest,i.text,i.published_at,i.platform,q.question_key,q.question_digest,q.definition,q.wire,
  CASE q.definition->>'topic_source' WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE qs.definition->>'topic_source'='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN CASE WHEN i.discovered_keys IS NULL THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key) ELSE q.question_key=ANY(i.discovered_keys) END OR manual.id IS NOT NULL
   ELSE true END,
  CASE WHEN q.definition->>'scope'='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.consumer_category_included THEN 'included'
   ELSE 'excluded' END,
  COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer),CASE WHEN manual.id IS NULL THEN a.call_id END,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END
 FROM prepared i CROSS JOIN qs q LEFT JOIN signal_listening_answers a ON a.workspace_id=$1 AND a.root_id=i.root_id
  AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=$4 AND a.question_digest=q.question_digest
 LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=$1 AND d.root_id=i.root_id AND d.input_digest=i.listening_input_digest
  AND d.entity_context_digest=$4 AND d.question_digest=q.question_digest ORDER BY d.created_at DESC,d.id DESC LIMIT 1) manual ON true
  $population$ USING w,cid,mid,ctx,roots,purpose;
 ELSE
  RETURN QUERY EXECUTE $bounded$
WITH eligible_batches AS MATERIALIZED(
 SELECT batch.id,batch.data_source_id FROM import_batches batch
 JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1 AND source.status='active'
 JOIN LATERAL(SELECT b.* FROM signal_provenance_policy_bindings b WHERE b.workspace_id=$1 AND b.data_source_id=batch.data_source_id
   AND b.status='active' AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
   AND (b.import_batch_id=batch.id OR b.import_batch_id IS NULL)
   ORDER BY (b.import_batch_id IS NOT NULL) DESC,b.binding_version DESC,b.id LIMIT 1) binding ON true
 JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=$1 AND license.status='active'
   AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
 JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=$1
   AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
   AND (retention.effective_to IS NULL OR retention.effective_to>now())
   AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
 WHERE batch.workspace_id=$1 AND batch.status='completed' AND $6 IN('llm-processing','client-derived-metrics')
 AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages u WHERE u.workspace_id=$1 AND u.licensing_policy_id=license.id AND u.usage_purpose=$6 AND u.decision='allowed')),
 allowed_roots AS MATERIALIZED(
 SELECT DISTINCT origin.canonical_mention_id root_id FROM eligible_batches batch
 JOIN signal_mention_import_memberships path ON path.workspace_id=$1 AND path.import_batch_id=batch.id AND path.data_source_id=batch.data_source_id
 JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=$1
 WHERE origin.canonical_mention_id=ANY($5)), config AS MATERIALIZED(SELECT c.*,signal_mass_labeling_category_pattern_v1(ARRAY(SELECT jsonb_array_elements_text(c.configuration->'lexicon_terms'))) category_pattern FROM signal_listening_configurations c WHERE c.workspace_id=$1 AND c.id=$2 AND c.state='published'),
 qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),
 selected_items AS MATERIALIZED(
  SELECT item.* FROM (SELECT DISTINCT root FROM unnest($5) r(root) WHERE root IS NOT NULL AND cardinality($5)<=4096) selected
  CROSS JOIN LATERAL(SELECT i.* FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$3 AND i.root_id=selected.root OFFSET 0) item
  WHERE $5 IS NOT NULL),
 items AS MATERIALIZED(SELECT i.*,signal_listening_input_digest_v1(i) listening_input_digest,m.published_at,m.platform,c.category_pattern
  FROM selected_items i JOIN allowed_roots allowed ON allowed.root_id=i.root_id JOIN config c ON c.workspace_id=i.workspace_id
  JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id
  WHERE i.workspace_id=$1 AND i.map_id=$3 AND m.canonical_mention_id=m.id AND m.inclusion_status='included'
   ),
 prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,
   signal_labeling_digest_v1(jsonb_build_object('voice',v.call_id,'promotion',p.call_id)) basis,
   CASE WHEN EXISTS(SELECT 1 FROM qs WHERE qs.definition->>'scope'='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7
    THEN NOT signal_mass_labeling_r13_hashtags_v1(lexical.text_clean)
      AND signal_mass_labeling_category_pattern_matches_v1(lexical.text_clean,i.category_pattern)
    ELSE false END consumer_category_included,
   CASE WHEN (SELECT count(*) FROM qs WHERE qs.definition->>'topic_source'='defined')>8 THEN ARRAY(SELECT ranked.question_key FROM qs ranked
    JOIN signal_topic_definition_embeddings prototype ON prototype.id=COALESCE(ranked.prototype_embedding_id,(SELECT v.prototype_embedding_id FROM signal_listening_question_vectors v
      WHERE v.configuration_id=$2 AND v.question_key=ranked.question_key AND v.embedding_config_digest=(SELECT embedding_config_digest FROM signal_mass_labeling_maps WHERE id=$3))) AND prototype.workspace_id=$1
    JOIN signal_mass_labeling_maps map ON map.id=$3 AND map.workspace_id=$1
    JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=$1 AND e.config_digest=map.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
    WHERE ranked.definition->>'topic_source'='defined' AND prototype.embedding_config_digest=map.embedding_config_digest
    ORDER BY prototype.embedding <=> e.embedding,ranked.question_key LIMIT 4) ELSE NULL::text[] END defined_keys,CASE WHEN EXISTS(SELECT 1 FROM qs WHERE qs.definition->>'topic_source'='discovered') THEN signal_listening_discovery_candidates_v1($1,$2,$3,i.root_id) ELSE NULL::text[] END discovered_keys
  FROM items i LEFT JOIN qs vq ON vq.question_key='voice' LEFT JOIN qs pq ON pq.question_key='promotion'
  LEFT JOIN signal_listening_answers v ON v.workspace_id=$1 AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=$4 AND v.question_digest=vq.question_digest
  LEFT JOIN signal_listening_answers p ON p.workspace_id=$1 AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=$4 AND p.question_digest=pq.question_digest
  LEFT JOIN LATERAL(SELECT m.text_clean FROM mentions m WHERE m.workspace_id=$1 AND m.id=i.root_id
    AND EXISTS(SELECT 1 FROM qs WHERE qs.definition->>'scope'='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7 OFFSET 0) lexical ON true)
 SELECT i.root_id,i.listening_input_digest,i.text,i.published_at,i.platform,q.question_key,q.question_digest,q.definition,q.wire,
  CASE q.definition->>'topic_source' WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE qs.definition->>'topic_source'='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN CASE WHEN i.discovered_keys IS NULL THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key) ELSE q.question_key=ANY(i.discovered_keys) END OR manual.id IS NOT NULL
   ELSE true END,
  CASE WHEN q.definition->>'scope'='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.consumer_category_included THEN 'included'
   ELSE 'excluded' END,
  COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer),CASE WHEN manual.id IS NULL THEN a.call_id END,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END
 FROM prepared i CROSS JOIN qs q LEFT JOIN signal_listening_answers a ON a.workspace_id=$1 AND a.root_id=i.root_id
  AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=$4 AND a.question_digest=q.question_digest
 LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=$1 AND d.root_id=i.root_id AND d.input_digest=i.listening_input_digest
  AND d.entity_context_digest=$4 AND d.question_digest=q.question_digest ORDER BY d.created_at DESC,d.id DESC LIMIT 1) manual ON true
  $bounded$ USING w,cid,mid,ctx,roots,purpose;
 END IF;
END
$function$;
