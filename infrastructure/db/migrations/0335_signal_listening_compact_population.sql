-- compact_raw_begin
-- Compact native population: preserve0333 authority and fresh full input SHA.
-- Width is reduced before the root/question result boundary; historical APIs stay unchanged.
-- Base wildcards/platform reads retain the original invoker column ACL checks.
-- Full text stops after fresh hashing in items; question payloads stay once in qs.
CREATE FUNCTION signal_listening_compact_population_roots_v1(w uuid,cid uuid,mid uuid,ctx text,roots uuid[],purpose text)
RETURNS TABLE(root_id uuid,input_digest text,published_at timestamptz,question_key text,question_digest text,
 body_chars integer,wire_chars integer,has_topic_source boolean,domain text,candidate boolean,scope_state text,answer jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,extensions,pg_temp AS $function$
BEGIN
 IF pg_catalog.has_function_privilege(current_user,'public.signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure,'EXECUTE') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'permission denied for function signal_listening_population_roots_v1' USING ERRCODE='42501';
 END IF;
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
 qs AS MATERIALIZED(SELECT question.*,
  question.definition->>'scope' question_scope,question.definition->>'topic_source' topic_source,
  question.definition ? 'topic_source' has_topic_source,question.definition->>'domain' domain,length(question.wire::text) wire_chars
  FROM signal_listening_questions question JOIN config c ON c.id=question.configuration_id),
 selected_items AS MATERIALIZED(
  SELECT i.* FROM signal_mass_labeling_items i WHERE $5 IS NULL AND i.workspace_id=$1 AND i.map_id=$3
  UNION ALL
  SELECT item.* FROM (SELECT DISTINCT root FROM unnest($5) r(root) WHERE root IS NOT NULL AND cardinality($5)<=4096) selected
  CROSS JOIN LATERAL(SELECT i.* FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$3 AND i.root_id=selected.root OFFSET 0) item
  WHERE $5 IS NOT NULL),
 items AS MATERIALIZED(SELECT i.root_id,i.chunk_sha256,i.candidates,length(i.text) body_chars,/* flat_input_begin */('sha256:'||encode(sha256(convert_to('{"contract_version":"signal-listening-input-v1","root_id":'||COALESCE(to_jsonb(i.root_id)::text,'null')||',"source_fingerprint":'||COALESCE(to_jsonb(i.root_fingerprint)::text,'null')||',"text":'||COALESCE(to_jsonb(i.text)::text,'null')||'}','UTF8')),'hex'))/* flat_input_end */ listening_input_digest,m.published_at,m.platform,c.category_pattern
  FROM selected_items i JOIN allowed_roots allowed ON allowed.root_id=i.root_id JOIN config c ON c.workspace_id=i.workspace_id
  JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id
  WHERE i.workspace_id=$1 AND i.map_id=$3 AND m.canonical_mention_id=m.id AND m.inclusion_status='included'
   ),
 -- base_answer_slice_begin
 base_answer_slice AS MATERIALIZED(
  SELECT a.workspace_id,a.root_id,a.input_digest,a.entity_context_digest,a.question_digest,a.answer,a.call_id
  FROM signal_listening_answers a WHERE a.workspace_id=$1 AND a.entity_context_digest=$4
   AND a.root_id=ANY(ARRAY(SELECT i.root_id FROM items i))
   AND a.question_digest=ANY(ARRAY(SELECT q.question_digest FROM qs q))
 ),
 base_answer_matches AS MATERIALIZED(
  SELECT i.root_id selected_root_id,a.* FROM items i FULL JOIN base_answer_slice a
   ON a.workspace_id=$1 AND a.root_id=i.root_id AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=$4
 ),
 base_answers AS MATERIALIZED(
  SELECT workspace_id,root_id,input_digest,entity_context_digest,question_digest,answer,call_id
  FROM base_answer_matches WHERE selected_root_id IS NOT NULL AND call_id IS NOT NULL
 ),
 -- base_answer_slice_end
 prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,
   CASE WHEN EXISTS(SELECT 1 FROM qs WHERE qs.question_scope='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7
    THEN NOT signal_mass_labeling_r13_hashtags_v1(lexical.text_clean)
      AND signal_mass_labeling_category_pattern_matches_v1(lexical.text_clean,i.category_pattern)
    ELSE false END consumer_category_included,
   CASE WHEN (SELECT count(*) FROM qs WHERE qs.topic_source='defined')>8 THEN ARRAY(SELECT ranked.question_key FROM qs ranked
    JOIN signal_topic_definition_embeddings prototype ON prototype.id=COALESCE(ranked.prototype_embedding_id,(SELECT v.prototype_embedding_id FROM signal_listening_question_vectors v
      WHERE v.configuration_id=$2 AND v.question_key=ranked.question_key AND v.embedding_config_digest=(SELECT embedding_config_digest FROM signal_mass_labeling_maps WHERE id=$3))) AND prototype.workspace_id=$1
    JOIN signal_mass_labeling_maps map ON map.id=$3 AND map.workspace_id=$1
    JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=$1 AND e.config_digest=map.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
    WHERE ranked.topic_source='defined' AND prototype.embedding_config_digest=map.embedding_config_digest
    ORDER BY prototype.embedding <=> e.embedding,ranked.question_key LIMIT 4) ELSE NULL::text[] END defined_keys,CASE WHEN EXISTS(SELECT 1 FROM qs WHERE qs.topic_source='discovered') THEN signal_listening_discovery_candidates_v1($1,$2,$3,i.root_id) ELSE NULL::text[] END discovered_keys
  FROM items i LEFT JOIN qs vq ON vq.question_key='voice' LEFT JOIN qs pq ON pq.question_key='promotion'
  FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='voice')) v ON v.workspace_id=$1 AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=$4 AND v.question_digest=vq.question_digest
  FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='promotion')) p ON p.workspace_id=$1 AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=$4 AND p.question_digest=pq.question_digest
  LEFT JOIN LATERAL(SELECT m.text_clean FROM mentions m WHERE m.workspace_id=$1 AND m.id=i.root_id
    AND EXISTS(SELECT 1 FROM qs WHERE qs.question_scope='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7 OFFSET 0) lexical ON true)
 SELECT i.root_id,i.listening_input_digest,i.published_at,q.question_key,q.question_digest,i.body_chars,q.wire_chars,q.has_topic_source,q.domain,
  CASE q.topic_source WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE qs.topic_source='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN CASE WHEN i.discovered_keys IS NULL THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key) ELSE q.question_key=ANY(i.discovered_keys) END OR manual.id IS NOT NULL
   ELSE true END,
  CASE WHEN q.question_scope='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.consumer_category_included THEN 'included'
   ELSE 'excluded' END,
  COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer)
 FROM prepared i CROSS JOIN qs q FULL JOIN base_answers a ON a.workspace_id=$1 AND a.root_id=i.root_id
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
 qs AS MATERIALIZED(SELECT question.*,
  question.definition->>'scope' question_scope,question.definition->>'topic_source' topic_source,
  question.definition ? 'topic_source' has_topic_source,question.definition->>'domain' domain,length(question.wire::text) wire_chars
  FROM signal_listening_questions question JOIN config c ON c.id=question.configuration_id),
 selected_items AS MATERIALIZED(
  SELECT item.* FROM (SELECT DISTINCT root FROM unnest($5) r(root) WHERE root IS NOT NULL AND cardinality($5)<=4096) selected
  CROSS JOIN LATERAL(SELECT i.* FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$3 AND i.root_id=selected.root OFFSET 0) item
  WHERE $5 IS NOT NULL),
 items AS MATERIALIZED(SELECT i.root_id,i.chunk_sha256,i.candidates,length(i.text) body_chars,/* flat_input_begin */('sha256:'||encode(sha256(convert_to('{"contract_version":"signal-listening-input-v1","root_id":'||COALESCE(to_jsonb(i.root_id)::text,'null')||',"source_fingerprint":'||COALESCE(to_jsonb(i.root_fingerprint)::text,'null')||',"text":'||COALESCE(to_jsonb(i.text)::text,'null')||'}','UTF8')),'hex'))/* flat_input_end */ listening_input_digest,m.published_at,m.platform,c.category_pattern
  FROM selected_items i JOIN allowed_roots allowed ON allowed.root_id=i.root_id JOIN config c ON c.workspace_id=i.workspace_id
  JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id
  WHERE i.workspace_id=$1 AND i.map_id=$3 AND m.canonical_mention_id=m.id AND m.inclusion_status='included' AND m.id=ANY($5)
   ),
 -- base_answer_slice_begin
 base_answer_slice AS MATERIALIZED(
  SELECT a.workspace_id,a.root_id,a.input_digest,a.entity_context_digest,a.question_digest,a.answer,a.call_id
  FROM signal_listening_answers a WHERE a.workspace_id=$1 AND a.entity_context_digest=$4
   AND a.root_id=ANY(ARRAY(SELECT i.root_id FROM items i))
   AND a.question_digest=ANY(ARRAY(SELECT q.question_digest FROM qs q))
 ),
 base_answer_matches AS MATERIALIZED(
  SELECT i.root_id selected_root_id,a.* FROM items i FULL JOIN base_answer_slice a
   ON a.workspace_id=$1 AND a.root_id=i.root_id AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=$4
 ),
 base_answers AS MATERIALIZED(
  SELECT workspace_id,root_id,input_digest,entity_context_digest,question_digest,answer,call_id
  FROM base_answer_matches WHERE selected_root_id IS NOT NULL AND call_id IS NOT NULL
 ),
 -- base_answer_slice_end
 prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,
   CASE WHEN EXISTS(SELECT 1 FROM qs WHERE qs.question_scope='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7
    THEN NOT signal_mass_labeling_r13_hashtags_v1(lexical.text_clean)
      AND signal_mass_labeling_category_pattern_matches_v1(lexical.text_clean,i.category_pattern)
    ELSE false END consumer_category_included,
   CASE WHEN (SELECT count(*) FROM qs WHERE qs.topic_source='defined')>8 THEN ARRAY(SELECT ranked.question_key FROM qs ranked
    JOIN signal_topic_definition_embeddings prototype ON prototype.id=COALESCE(ranked.prototype_embedding_id,(SELECT v.prototype_embedding_id FROM signal_listening_question_vectors v
      WHERE v.configuration_id=$2 AND v.question_key=ranked.question_key AND v.embedding_config_digest=(SELECT embedding_config_digest FROM signal_mass_labeling_maps WHERE id=$3))) AND prototype.workspace_id=$1
    JOIN signal_mass_labeling_maps map ON map.id=$3 AND map.workspace_id=$1
    JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=$1 AND e.config_digest=map.embedding_config_digest AND e.chunk_sha256=i.chunk_sha256
    WHERE ranked.topic_source='defined' AND prototype.embedding_config_digest=map.embedding_config_digest
    ORDER BY prototype.embedding <=> e.embedding,ranked.question_key LIMIT 4) ELSE NULL::text[] END defined_keys,CASE WHEN EXISTS(SELECT 1 FROM qs WHERE qs.topic_source='discovered') THEN signal_listening_discovery_candidates_v1($1,$2,$3,i.root_id) ELSE NULL::text[] END discovered_keys
  FROM items i LEFT JOIN qs vq ON vq.question_key='voice' LEFT JOIN qs pq ON pq.question_key='promotion'
  FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='voice')) v ON v.workspace_id=$1 AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=$4 AND v.question_digest=vq.question_digest
  FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='promotion')) p ON p.workspace_id=$1 AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=$4 AND p.question_digest=pq.question_digest
  LEFT JOIN LATERAL(SELECT m.text_clean FROM mentions m WHERE m.workspace_id=$1 AND m.id=i.root_id
    AND EXISTS(SELECT 1 FROM qs WHERE qs.question_scope='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7 OFFSET 0) lexical ON true)
 SELECT i.root_id,i.listening_input_digest,i.published_at,q.question_key,q.question_digest,i.body_chars,q.wire_chars,q.has_topic_source,q.domain,
  CASE q.topic_source WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE qs.topic_source='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN CASE WHEN i.discovered_keys IS NULL THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key) ELSE q.question_key=ANY(i.discovered_keys) END OR manual.id IS NOT NULL
   ELSE true END,
  CASE WHEN q.question_scope='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.consumer_category_included THEN 'included'
   ELSE 'excluded' END,
  COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer)
 FROM prepared i CROSS JOIN qs q FULL JOIN base_answers a ON a.workspace_id=$1 AND a.root_id=i.root_id
  AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=$4 AND a.question_digest=q.question_digest
 LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=$1 AND d.root_id=i.root_id AND d.input_digest=i.listening_input_digest
  AND d.entity_context_digest=$4 AND d.question_digest=q.question_digest ORDER BY d.created_at DESC,d.id DESC LIMIT 1) manual ON true
  $bounded$ USING w,cid,mid,ctx,roots,purpose;
 END IF;
END
$function$;
-- compact_raw_end

-- compact_effective_begin
-- Effective compact projection preserves0316 human revision and precedence.
CREATE FUNCTION signal_listening_effective_compact_population_roots_v1(w uuid,cid uuid,mid uuid,ctx text,roots uuid[],purpose text)
RETURNS TABLE(root_id uuid,published_at timestamptz,question_key text,has_topic_source boolean,domain text,
 candidate boolean,scope_state text,answer jsonb,human_belongs boolean,effective_belongs boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,extensions,pg_temp AS $$
 WITH execute_gate AS MATERIALIZED(
  SELECT CASE WHEN pg_catalog.has_function_privilege(current_user,'public.signal_listening_effective_population_roots_v2(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure,'EXECUTE') THEN true
   ELSE(SELECT false FROM public.signal_listening_effective_population_roots_v2(NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::uuid[],purpose) denied LIMIT 1) END allowed),
 revision AS MATERIALIZED(SELECT signal_listening_human_revision_v1(CASE WHEN(SELECT allowed FROM execute_gate) THEN cid END) n),
 population AS MATERIALIZED(SELECT * FROM signal_listening_compact_population_roots_v1(CASE WHEN(SELECT allowed FROM execute_gate) THEN w END,cid,mid,ctx,roots,purpose))
 SELECT p.root_id,p.published_at,p.question_key,p.has_topic_source,p.domain,
  p.candidate OR decision.id IS NOT NULL OR legacy.id IS NOT NULL,p.scope_state,
  CASE WHEN revision.n>0 THEN raw.answer ELSE p.answer END,
  COALESCE(decision.belongs,legacy.belongs),
  CASE WHEN p.has_topic_source THEN COALESCE(decision.belongs,legacy.belongs,(raw.answer->>'noul')::double precision>=0.7) END
 FROM population p CROSS JOIN revision
 LEFT JOIN signal_listening_answers raw ON raw.workspace_id=w AND raw.root_id=p.root_id AND raw.input_digest=p.input_digest AND raw.entity_context_digest=ctx AND raw.question_digest=p.question_digest
 LEFT JOIN LATERAL(SELECT d.*,e.revision FROM signal_listening_human_memberships d JOIN signal_listening_human_edits e ON e.id=d.edit_id AND e.workspace_id=d.workspace_id
  WHERE d.workspace_id=w AND d.map_id=mid AND d.root_id=p.root_id AND d.input_digest=p.input_digest AND d.entity_context_digest=ctx AND d.question_digest=p.question_digest
   AND e.revision<=revision.n ORDER BY e.revision DESC,d.id DESC LIMIT 1)decision ON true
 LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=w AND d.map_id=mid AND d.root_id=p.root_id AND d.input_digest=p.input_digest AND d.entity_context_digest=ctx AND d.question_digest=p.question_digest
  ORDER BY d.created_at DESC,d.id DESC LIMIT 1)legacy ON true
$$;
-- compact_effective_end

-- compact_wrapper_begin
-- Preserve the original five-argument wrapper gate, including later revocation.
-- The denied branch invokes the historical function only to obtain its native
-- EXECUTE failure; authorized reads never evaluate the historical wide body.
CREATE FUNCTION signal_listening_compact_population_v1(w uuid,cid uuid,mid uuid,ctx text,purpose text DEFAULT 'llm-processing')
RETURNS TABLE(root_id uuid,input_digest text,published_at timestamptz,question_key text,question_digest text,
 body_chars integer,wire_chars integer,has_topic_source boolean,domain text,candidate boolean,scope_state text,answer jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,extensions,pg_temp AS $compact_wrapper$
 SELECT * FROM signal_listening_compact_population_roots_v1(
  CASE WHEN pg_catalog.has_function_privilege(current_user,'public.signal_listening_population_v1(uuid,uuid,uuid,text,text)'::pg_catalog.regprocedure,'EXECUTE') THEN w
   ELSE(SELECT denied.root_id FROM public.signal_listening_population_v1(NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,purpose) denied LIMIT 1) END,
  cid,mid,ctx,NULL::uuid[],purpose)
$compact_wrapper$;
-- compact_wrapper_end

-- compact_acl_begin
-- Only these three new functions receive their corresponding native EXECUTE ACL.
-- Revoke every default grant first; never alter an existing function or owner.
DO $compact_acl$
DECLARE pair record;source pg_catalog.pg_proc;destination pg_catalog.pg_proc;permission record;role_sql text;source_acl aclitem[];destination_acl aclitem[];expected jsonb;actual jsonb;
BEGIN
 FOR pair IN SELECT * FROM(VALUES
  ('signal_listening_population_roots_v1','signal_listening_compact_population_roots_v1','uuid,uuid,uuid,text,uuid[],text'),
  ('signal_listening_effective_population_roots_v2','signal_listening_effective_compact_population_roots_v1','uuid,uuid,uuid,text,uuid[],text'),
  ('signal_listening_population_v1','signal_listening_compact_population_v1','uuid,uuid,uuid,text,text')
 ) closed(source_name,destination_name,argument_types) LOOP
  IF NOT(pair.source_name='signal_listening_population_roots_v1' AND pair.destination_name='signal_listening_compact_population_roots_v1' AND pair.argument_types='uuid,uuid,uuid,text,uuid[],text'
   OR pair.source_name='signal_listening_effective_population_roots_v2' AND pair.destination_name='signal_listening_effective_compact_population_roots_v1' AND pair.argument_types='uuid,uuid,uuid,text,uuid[],text'
   OR pair.source_name='signal_listening_population_v1' AND pair.destination_name='signal_listening_compact_population_v1' AND pair.argument_types='uuid,uuid,uuid,text,text')
  THEN RAISE EXCEPTION 'listening_compact_destination_unexpected';END IF;
  SELECT p.* INTO source FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.'||pair.source_name||'('||pair.argument_types||')');
  SELECT p.* INTO destination FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.'||pair.destination_name||'('||pair.argument_types||')');
  IF source.oid IS NULL OR destination.oid IS NULL OR source.oid=destination.oid
   OR source.pronamespace<>'public'::regnamespace OR destination.pronamespace<>'public'::regnamespace
   OR source.prokind<>'f' OR destination.prokind<>'f' OR source.proargtypes<>destination.proargtypes
   OR source.prosecdef OR destination.prosecdef OR source.provolatile<>'s' OR destination.provolatile<>'s'
  THEN RAISE EXCEPTION 'listening_compact_destination_unexpected';END IF;
  IF destination.proowner<>source.proowner THEN RAISE EXCEPTION 'listening_compact_owner_mismatch';END IF;
  source_acl:=COALESCE(source.proacl,pg_catalog.acldefault('f',source.proowner));
  destination_acl:=COALESCE(destination.proacl,pg_catalog.acldefault('f',destination.proowner));
  -- Validate both sets before changing the new ACL. Non-owner grantors cannot
  -- be reproduced silently by the migration owner and are rejected.
  FOR permission IN SELECT a.* FROM pg_catalog.aclexplode(source_acl) a UNION ALL SELECT a.* FROM pg_catalog.aclexplode(destination_acl) a LOOP
   IF permission.privilege_type<>'EXECUTE' OR permission.grantor<>source.proowner
    OR permission.grantee<>0 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=permission.grantee)
   THEN RAISE EXCEPTION 'listening_compact_acl_unexpected';END IF;
  END LOOP;
  FOR permission IN SELECT a.* FROM pg_catalog.aclexplode(destination_acl) a LOOP
   role_sql:=CASE WHEN permission.grantee=0 THEN 'PUBLIC' ELSE(SELECT pg_catalog.quote_ident(r.rolname) FROM pg_catalog.pg_roles r WHERE r.oid=permission.grantee) END;
   IF role_sql IS NULL THEN RAISE EXCEPTION 'listening_compact_acl_unexpected';END IF;
   EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.%I(%s) FROM %s',pair.destination_name,pair.argument_types,role_sql);
  END LOOP;
  FOR permission IN SELECT a.* FROM pg_catalog.aclexplode(source_acl) a LOOP
   role_sql:=CASE WHEN permission.grantee=0 THEN 'PUBLIC' ELSE(SELECT pg_catalog.quote_ident(r.rolname) FROM pg_catalog.pg_roles r WHERE r.oid=permission.grantee) END;
   IF role_sql IS NULL THEN RAISE EXCEPTION 'listening_compact_acl_unexpected';END IF;
   EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO %s%s',pair.destination_name,pair.argument_types,role_sql,CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable) INTO expected FROM pg_catalog.aclexplode(source_acl) a;
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable) INTO actual FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=destination.oid;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'listening_compact_acl_mismatch';END IF;
 END LOOP;
END
$compact_acl$;
-- compact_acl_end
