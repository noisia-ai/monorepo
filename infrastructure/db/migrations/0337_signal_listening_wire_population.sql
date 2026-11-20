-- Native wire population: full fresh input SHA and authority remain0333 exact.
-- Return only Money/prefix semantic fields and exact UTF8 byte counts.
CREATE FUNCTION signal_listening_wire_population_roots_v1(w uuid,cid uuid,mid uuid,ctx text,roots uuid[],purpose text)
RETURNS TABLE(root_id uuid,input_digest text,question_key text,question_digest text,wire jsonb,scope_basis text,
 candidate boolean,scope_state text,answer jsonb,body_octets integer,platform_octets integer)
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
 qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),
 selected_items AS MATERIALIZED(
  SELECT i.* FROM signal_mass_labeling_items i WHERE $5 IS NULL AND i.workspace_id=$1 AND i.map_id=$3
  UNION ALL
  SELECT item.* FROM (SELECT DISTINCT root FROM unnest($5) r(root) WHERE root IS NOT NULL AND cardinality($5)<=4096) selected
  CROSS JOIN LATERAL(SELECT i.* FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$3 AND i.root_id=selected.root OFFSET 0) item
  WHERE $5 IS NOT NULL),
 items AS MATERIALIZED(SELECT i.root_id,i.chunk_sha256,i.candidates,octet_length(i.text) body_octets,octet_length(COALESCE(m.platform,'')) platform_octets,/* flat_input_begin */('sha256:'||encode(sha256(convert_to('{"contract_version":"signal-listening-input-v1","root_id":'||COALESCE(to_jsonb(i.root_id)::text,'null')||',"source_fingerprint":'||COALESCE(to_jsonb(i.root_fingerprint)::text,'null')||',"text":'||COALESCE(to_jsonb(i.text)::text,'null')||'}','UTF8')),'hex'))/* flat_input_end */ listening_input_digest,m.published_at,m.platform,c.category_pattern
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
   /* flat_basis_begin */('sha256:'||encode(sha256(convert_to('{"promotion":'||COALESCE(to_jsonb(p.call_id)::text,'null')||',"voice":'||COALESCE(to_jsonb(v.call_id)::text,'null')||'}','UTF8')),'hex'))/* flat_basis_end */ basis,
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
  FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='voice')) v ON v.workspace_id=$1 AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=$4 AND v.question_digest=vq.question_digest
  FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='promotion')) p ON p.workspace_id=$1 AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=$4 AND p.question_digest=pq.question_digest
  LEFT JOIN LATERAL(SELECT m.text_clean FROM mentions m WHERE m.workspace_id=$1 AND m.id=i.root_id
    AND EXISTS(SELECT 1 FROM qs WHERE qs.definition->>'scope'='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7 OFFSET 0) lexical ON true)
 SELECT i.root_id,i.listening_input_digest,q.question_key,q.question_digest,q.wire,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END,
  CASE q.definition->>'topic_source' WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE qs.definition->>'topic_source'='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN CASE WHEN i.discovered_keys IS NULL THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key) ELSE q.question_key=ANY(i.discovered_keys) END OR manual.id IS NOT NULL
   ELSE true END,
  CASE WHEN q.definition->>'scope'='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.consumer_category_included THEN 'included'
   ELSE 'excluded' END,
  COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer),i.body_octets,i.platform_octets
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
 qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),
 selected_items AS MATERIALIZED(
  SELECT item.* FROM (SELECT DISTINCT root FROM unnest($5) r(root) WHERE root IS NOT NULL AND cardinality($5)<=4096) selected
  CROSS JOIN LATERAL(SELECT i.* FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$3 AND i.root_id=selected.root OFFSET 0) item
  WHERE $5 IS NOT NULL),
 items AS MATERIALIZED(SELECT i.root_id,i.chunk_sha256,i.candidates,octet_length(i.text) body_octets,octet_length(COALESCE(m.platform,'')) platform_octets,/* flat_input_begin */('sha256:'||encode(sha256(convert_to('{"contract_version":"signal-listening-input-v1","root_id":'||COALESCE(to_jsonb(i.root_id)::text,'null')||',"source_fingerprint":'||COALESCE(to_jsonb(i.root_fingerprint)::text,'null')||',"text":'||COALESCE(to_jsonb(i.text)::text,'null')||'}','UTF8')),'hex'))/* flat_input_end */ listening_input_digest,m.published_at,m.platform,c.category_pattern
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
   /* flat_basis_begin */('sha256:'||encode(sha256(convert_to('{"promotion":'||COALESCE(to_jsonb(p.call_id)::text,'null')||',"voice":'||COALESCE(to_jsonb(v.call_id)::text,'null')||'}','UTF8')),'hex'))/* flat_basis_end */ basis,
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
  FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='voice')) v ON v.workspace_id=$1 AND v.root_id=i.root_id AND v.input_digest=i.listening_input_digest
   AND v.entity_context_digest=$4 AND v.question_digest=vq.question_digest
  FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='promotion')) p ON p.workspace_id=$1 AND p.root_id=i.root_id AND p.input_digest=i.listening_input_digest
   AND p.entity_context_digest=$4 AND p.question_digest=pq.question_digest
  LEFT JOIN LATERAL(SELECT m.text_clean FROM mentions m WHERE m.workspace_id=$1 AND m.id=i.root_id
    AND EXISTS(SELECT 1 FROM qs WHERE qs.definition->>'scope'='consumer_category')
    AND v.answer IS NOT NULL AND p.answer IS NOT NULL
    AND v.answer->>'choice'='individual' AND (p.answer->>'noul')::double precision<=0.7 OFFSET 0) lexical ON true)
 SELECT i.root_id,i.listening_input_digest,q.question_key,q.question_digest,q.wire,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END,
  CASE q.definition->>'topic_source' WHEN 'defined' THEN (SELECT count(*)<=8 FROM qs WHERE qs.definition->>'topic_source'='defined') OR q.question_key=ANY(i.defined_keys)
   WHEN 'discovered' THEN CASE WHEN i.discovered_keys IS NULL THEN EXISTS(SELECT 1 FROM jsonb_array_elements(i.candidates) WITH ORDINALITY x(v,n) WHERE n<=4 AND v->>'topic_key'=q.question_key) ELSE q.question_key=ANY(i.discovered_keys) END OR manual.id IS NOT NULL
   ELSE true END,
  CASE WHEN q.definition->>'scope'='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'
   WHEN i.consumer_category_included THEN 'included'
   ELSE 'excluded' END,
  COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer),i.body_octets,i.platform_octets
 FROM prepared i CROSS JOIN qs q FULL JOIN base_answers a ON a.workspace_id=$1 AND a.root_id=i.root_id
  AND a.input_digest=i.listening_input_digest AND a.entity_context_digest=$4 AND a.question_digest=q.question_digest
 LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=$1 AND d.root_id=i.root_id AND d.input_digest=i.listening_input_digest
  AND d.entity_context_digest=$4 AND d.question_digest=q.question_digest ORDER BY d.created_at DESC,d.id DESC LIMIT 1) manual ON true
  $bounded$ USING w,cid,mid,ctx,roots,purpose;
 END IF;
END
$function$;

-- wire_acl_begin
-- Only the new wire producer receives the historical raw EXECUTE ACL.
-- Revoke every default grant first; never alter an existing function or owner.
DO $wire_acl$
DECLARE pair record;source pg_catalog.pg_proc;destination pg_catalog.pg_proc;permission record;role_sql text;source_acl aclitem[];destination_acl aclitem[];expected jsonb;actual jsonb;
BEGIN
 FOR pair IN SELECT * FROM(VALUES
  ('signal_listening_population_roots_v1','signal_listening_wire_population_roots_v1','uuid,uuid,uuid,text,uuid[],text')
 ) closed(source_name,destination_name,argument_types) LOOP
  IF NOT(pair.source_name='signal_listening_population_roots_v1' AND pair.destination_name='signal_listening_wire_population_roots_v1' AND pair.argument_types='uuid,uuid,uuid,text,uuid[],text')
  THEN RAISE EXCEPTION 'listening_wire_destination_unexpected';END IF;
  SELECT p.* INTO source FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.'||pair.source_name||'('||pair.argument_types||')');
  SELECT p.* INTO destination FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.'||pair.destination_name||'('||pair.argument_types||')');
  IF source.oid IS NULL OR destination.oid IS NULL OR source.oid=destination.oid
   OR source.pronamespace<>'public'::regnamespace OR destination.pronamespace<>'public'::regnamespace
   OR source.prokind<>'f' OR destination.prokind<>'f' OR source.proargtypes<>destination.proargtypes
   OR source.prosecdef OR destination.prosecdef OR source.provolatile<>'s' OR destination.provolatile<>'s'
  THEN RAISE EXCEPTION 'listening_wire_destination_unexpected';END IF;
  IF destination.proowner<>source.proowner THEN RAISE EXCEPTION 'listening_wire_owner_mismatch';END IF;
  source_acl:=COALESCE(source.proacl,pg_catalog.acldefault('f',source.proowner));
  destination_acl:=COALESCE(destination.proacl,pg_catalog.acldefault('f',destination.proowner));
  -- Validate both sets before changing the new ACL. Non-owner grantors cannot
  -- be reproduced silently by the migration owner and are rejected.
  FOR permission IN SELECT a.* FROM pg_catalog.aclexplode(source_acl) a UNION ALL SELECT a.* FROM pg_catalog.aclexplode(destination_acl) a LOOP
   IF permission.privilege_type<>'EXECUTE' OR permission.grantor<>source.proowner
    OR permission.grantee<>0 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=permission.grantee)
   THEN RAISE EXCEPTION 'listening_wire_acl_unexpected';END IF;
  END LOOP;
  FOR permission IN SELECT a.* FROM pg_catalog.aclexplode(destination_acl) a LOOP
   role_sql:=CASE WHEN permission.grantee=0 THEN 'PUBLIC' ELSE(SELECT pg_catalog.quote_ident(r.rolname) FROM pg_catalog.pg_roles r WHERE r.oid=permission.grantee) END;
   IF role_sql IS NULL THEN RAISE EXCEPTION 'listening_wire_acl_unexpected';END IF;
   EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.%I(%s) FROM %s',pair.destination_name,pair.argument_types,role_sql);
  END LOOP;
  FOR permission IN SELECT a.* FROM pg_catalog.aclexplode(source_acl) a LOOP
   role_sql:=CASE WHEN permission.grantee=0 THEN 'PUBLIC' ELSE(SELECT pg_catalog.quote_ident(r.rolname) FROM pg_catalog.pg_roles r WHERE r.oid=permission.grantee) END;
   IF role_sql IS NULL THEN RAISE EXCEPTION 'listening_wire_acl_unexpected';END IF;
   EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO %s%s',pair.destination_name,pair.argument_types,role_sql,CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable) INTO expected FROM pg_catalog.aclexplode(source_acl) a;
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable) INTO actual FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=destination.oid;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'listening_wire_acl_mismatch';END IF;
 END LOOP;
END
$wire_acl$;
-- wire_acl_end

-- wire_money_begin
-- Project only the nine consumed native population columns.
-- Relational statement-local fragments retain binary UTF8 identity and legacy fallback.
-- Reuse only canonical wire subtrees built from this statement/target's native
-- selected questions. Exact UTF8 representation distinguishes numeric scale and
-- Unicode bytes; ambiguous keys or shapes fall back to the original serializer.
-- No fragment parameter/API, persistent cache, grant or authority shortcut.
-- Full request SHA is still evaluated for every INSERT and reserved->submitting
-- transition; expected JSONB, all predicates and both authority fences are exact.
CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE targets uuid[];target uuid;r signal_labeling_runs;admission signal_processing_admissions;action_cap bigint;
 policy record;spent bigint;parent record;owner signal_listening_runs;c signal_listening_configurations;
 batch_sql text;root_ids uuid[];invalid boolean;checked record;policy_zone text;
BEGIN
 IF TG_OP='INSERT' THEN
  batch_sql:='SELECT n.* FROM listening_new_calls n WHERE n.run_id=$1';
  SELECT array_agg(DISTINCT n.run_id ORDER BY n.run_id) INTO targets FROM listening_new_calls n
   JOIN signal_listening_runs call_owner ON call_owner.run_id=n.run_id AND call_owner.workspace_id=n.workspace_id;
 ELSE
  batch_sql:=$transition_batch$WITH transition_matches AS MATERIALIZED(
   SELECT n::signal_labeling_calls new_call,n.id new_id,o.id old_id,o.status old_status
   FROM listening_new_calls n FULL JOIN listening_old_calls o ON o.id=n.id
  )
  SELECT (matched.new_call).* FROM transition_matches matched
  WHERE matched.new_id IS NOT NULL AND matched.old_id IS NOT NULL
   AND (matched.new_call).run_id=$1 AND matched.old_status='reserved' AND (matched.new_call).status='submitting'$transition_batch$;
  WITH target_matches AS MATERIALIZED(
   SELECT n.run_id,n.workspace_id,n.status new_status,n.id new_id,o.id old_id,o.status old_status
   FROM listening_new_calls n FULL JOIN listening_old_calls o ON o.id=n.id
  )
  SELECT array_agg(DISTINCT matched.run_id ORDER BY matched.run_id) INTO targets FROM target_matches matched
   JOIN signal_listening_runs call_owner ON call_owner.run_id=matched.run_id AND call_owner.workspace_id=matched.workspace_id
   WHERE matched.new_id IS NOT NULL AND matched.old_id IS NOT NULL
    AND matched.old_status='reserved' AND matched.new_status='submitting';
 END IF;
 IF targets IS NULL THEN RETURN NULL; END IF;
 FOR target IN SELECT unnest(targets) LOOP
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  PERFORM signal_listening_call_authority_v1(target,admission.budget_date,admission.budget_timezone,NULL);
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO owner FROM signal_listening_runs WHERE run_id=target AND workspace_id=r.workspace_id;
  SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
  IF c.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=r.workspace_id AND state='published')
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=r.workspace_id AND feature='mass_labeling')
   OR r.entity_context_digest IS DISTINCT FROM(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=r.workspace_id ORDER BY version_no DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps m JOIN signal_corpus_preparation_input_state s
    ON s.workspace_id=m.workspace_id AND s.input_revision=m.input_revision WHERE m.id=owner.map_id AND m.workspace_id=r.workspace_id)
  THEN RAISE EXCEPTION 'listening_run_stale'; END IF;
  -- One typed allowlist built ONLY from this statement's actual transition
  -- rows. NULL/empty can never reach the native selector as a full-corpus read.
  EXECUTE format('SELECT signal_listening_statement_roots_v1(array_agg((n.inputs->0->>''root_id'')::uuid)) FROM (%s) n',batch_sql)
   INTO root_ids USING target;
  EXECUTE format('SELECT COALESCE(bool_or(n.budget_date IS DISTINCT FROM $2 OR n.budget_timezone IS DISTINCT FROM $3),false) FROM (%s) n',batch_sql)
   INTO invalid USING target,admission.budget_date,admission.budget_timezone;
  IF invalid THEN RAISE EXCEPTION 'listening_budget_invalid' USING ERRCODE='23514'; END IF;
  SELECT budget_timezone INTO policy_zone FROM signal_processing_policy_versions WHERE id=admission.policy_version_id;
  EXECUTE format('SELECT COALESCE(bool_or((n.created_at AT TIME ZONE $3)::date IS DISTINCT FROM $2),false) FROM (%s) n',batch_sql)
   INTO invalid USING target,admission.budget_date,policy_zone;
  IF invalid THEN RAISE EXCEPTION 'processing_budget_date_expired' USING ERRCODE='23514'; END IF;
  EXECUTE format($validation$
   WITH batch AS MATERIALIZED(%s),
   population AS MATERIALIZED(
    SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.wire,p.scope_basis,p.candidate,p.scope_state,p.answer FROM signal_listening_wire_population_roots_v1($2,$3,$4,$5,$6,'llm-processing') p
   ),
   requested AS MATERIALIZED(
    SELECT DISTINCT n.id,(n.inputs->0->>'root_id')::uuid root_id,n.inputs->0->>'input_digest' input_digest,k.question_key
    FROM batch n CROSS JOIN LATERAL jsonb_array_elements_text(n.inputs->0->'question_keys') k(question_key)
   ),
   selected AS MATERIALIZED(
    SELECT k.id,count(*)::int selected_count,jsonb_object_agg(p.question_key,p.wire) questions,
     jsonb_object_agg(p.question_key,to_jsonb(p.question_digest)) digests,
     COALESCE(jsonb_object_agg(p.question_key,to_jsonb(p.scope_basis)) FILTER(WHERE p.scope_basis IS NOT NULL),'{}'::jsonb) basis
    FROM requested k JOIN population p ON p.root_id=k.root_id AND p.input_digest=k.input_digest AND p.question_key=k.question_key
    WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL GROUP BY k.id
   ),
   expected AS(
    SELECT n.id,n.request,n.request_digest,n.inputs->0 i,s.selected_count,s.digests,s.basis,
     CASE WHEN item.root_id IS NULL THEN NULL ELSE jsonb_build_object('model','jev-1.13.0','state',item.text,'questions',s.questions) END expected_request
    FROM batch n FULL JOIN selected s ON s.id=n.id
    LEFT JOIN signal_mass_labeling_items item ON item.workspace_id=$2 AND item.map_id=$4 AND item.root_id=(n.inputs->0->>'root_id')::uuid
   )
   /* statement_shared_wire_fragments_begin */,
   statement_wire_values AS MATERIALIZED(
    SELECT DISTINCT ON(q.key COLLATE "C",convert_to(q.value::text,'UTF8'))
     q.key,q.value wire,convert_to(q.value::text,'UTF8') wire_utf8
    FROM selected s CROSS JOIN LATERAL jsonb_each(s.questions) q
    ORDER BY q.key COLLATE "C",convert_to(q.value::text,'UTF8')
   ),
   statement_native_fragments AS MATERIALIZED(
    SELECT w.key,w.wire_utf8,public.signal_labeling_json_v1(w.wire) canonical
    FROM statement_wire_values w WHERE w.key COLLATE "C" IN(
     SELECT key COLLATE "C" FROM statement_wire_values GROUP BY key COLLATE "C" HAVING count(*)=1)
   )/* statement_shared_wire_fragments_end */
   SELECT COALESCE((SELECT bool_or(COALESCE(selected_count,0) NOT BETWEEN 1 AND 256
     OR selected_count IS DISTINCT FROM jsonb_array_length(i->'question_keys')
     OR i->>'configuration_digest' IS DISTINCT FROM $7 OR i->>'map_id' IS DISTINCT FROM $4::text
     OR i->'question_digests' IS DISTINCT FROM digests OR i->'scope_basis' IS DISTINCT FROM basis) FROM expected),false) invalid_questions,
    COALESCE((SELECT bool_or(request IS DISTINCT FROM expected_request OR i->>'text' IS DISTINCT FROM expected_request->>'state'
     OR request_digest IS DISTINCT FROM /* statement_shared_wire_hash_begin */('sha256:'||encode(sha256(convert_to(
     /* statement_shared_wire_canonical_begin */(WITH native AS MATERIALIZED(SELECT jsonb_build_object('request_version','listening-jev-v1','run_id',$1,
      'root_id',i->'root_id','input_digest',i->'input_digest','entity_context_digest',$5,
      'question_digests',digests,'scope_basis',basis,'request',expected_request) payload),
      native_question_fragments AS MATERIALIZED(
       SELECT q.key,fragment.canonical,
        fragment.wire_utf8 IS NOT DISTINCT FROM convert_to(q.value::text,'UTF8') wire_match
       FROM native CROSS JOIN LATERAL jsonb_each(CASE
        WHEN jsonb_typeof(native.payload#>'{request,questions}')='object' THEN native.payload#>'{request,questions}'
        ELSE '{}'::jsonb END) q
       LEFT JOIN statement_native_fragments fragment ON fragment.key COLLATE "C"=q.key COLLATE "C"
      ) SELECT CASE
      WHEN jsonb_typeof(native.payload) IS DISTINCT FROM 'object' THEN public.signal_labeling_json_v1(native.payload)
      WHEN EXISTS(SELECT 1 FROM unnest(ARRAY['entity_context_digest','input_digest','request_version','root_id','run_id']) k
       WHERE jsonb_typeof(native.payload->k) IS DISTINCT FROM 'string') THEN public.signal_labeling_json_v1(native.payload)
      WHEN jsonb_typeof(native.payload->'request') IS DISTINCT FROM 'object' THEN public.signal_labeling_json_v1(native.payload)
      WHEN ARRAY(SELECT key FROM jsonb_object_keys(native.payload->'request') key ORDER BY key COLLATE "C")
        IS DISTINCT FROM ARRAY['model','questions','state']::text[] THEN public.signal_labeling_json_v1(native.payload)
      WHEN native.payload#>'{request,model}' IS DISTINCT FROM to_jsonb('jev-1.13.0'::text)
       OR jsonb_typeof(native.payload#>'{request,state}') IS DISTINCT FROM 'string'
       OR jsonb_typeof(native.payload#>'{request,questions}') IS DISTINCT FROM 'object' THEN public.signal_labeling_json_v1(native.payload)
      WHEN EXISTS(SELECT 1 FROM native_question_fragments q
       WHERE q.wire_match IS DISTINCT FROM true OR q.canonical IS NULL) THEN public.signal_labeling_json_v1(native.payload)
      ELSE '{"entity_context_digest":'||(native.payload->'entity_context_digest')::text
       ||',"input_digest":'||(native.payload->'input_digest')::text
       ||',"question_digests":'||public.signal_labeling_json_v1(native.payload->'question_digests')
       ||',"request":{"model":'||(native.payload#>'{request,model}')::text||',"questions":'
       ||(SELECT '{'||COALESCE(string_agg(to_jsonb(q.key)::text||':'||q.canonical,',' ORDER BY q.key COLLATE "C"),'')||'}'
          FROM native_question_fragments q)
       ||',"state":'||(native.payload#>'{request,state}')::text||'}'
       ||',"request_version":'||(native.payload->'request_version')::text
       ||',"root_id":'||(native.payload->'root_id')::text||',"run_id":'||(native.payload->'run_id')::text
       ||',"scope_basis":'||public.signal_labeling_json_v1(native.payload->'scope_basis')||'}'
      END FROM native)/* statement_shared_wire_canonical_end */,'UTF8')),'hex'))/* statement_shared_wire_hash_end */) FROM expected),false) invalid_request,
    EXISTS(SELECT 1 FROM population pending
     JOIN signal_listening_call_questions link ON link.workspace_id=$2 AND link.root_id=pending.root_id AND link.question_digest=pending.question_digest
     JOIN signal_labeling_calls call ON call.workspace_id=$2 AND call.id=link.call_id
     JOIN signal_labeling_runs other_run ON other_run.id=call.run_id AND other_run.workspace_id=$2 AND other_run.entity_context_digest=$5
     WHERE pending.answer IS NULL AND pending.candidate AND pending.scope_state<>'excluded' AND call.run_id IS DISTINCT FROM $1
      AND call.inputs->0->>'input_digest'=pending.input_digest
      AND(call.status IN('submitting','submitted','unknown') OR call.terminal_exposure_micro_usd>0
       OR call.status='failed' AND COALESCE(call.settled_micro_usd,0)>0 OR call.raw_storage_key IS NOT NULL AND NOT call.results_applied)) invalid_prior
  $validation$,batch_sql) INTO checked USING target,r.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest,root_ids,c.configuration_digest;
  IF checked.invalid_questions THEN RAISE EXCEPTION 'listening_call_questions_invalid'; END IF;
  IF checked.invalid_request THEN RAISE EXCEPTION 'listening_request_invalid'; END IF;
  IF checked.invalid_prior THEN RAISE EXCEPTION 'listening_prior_outcome_unresolved'; END IF;

  SELECT max_execution_micro_usd INTO action_cap FROM signal_processing_policy_actions
   WHERE policy_version_id=admission.policy_version_id AND action=admission.action;
  IF NOT FOUND THEN RAISE EXCEPTION 'processing_admission_invalid' USING ERRCODE='23514'; END IF;
  -- Identical to readSignalLabelingRunExposureV1: ambiguous work keeps its
  -- reservation and terminal exposure never disappears behind a failed row.
  SELECT COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd
   ELSE reserved_micro_usd END),0) INTO spent FROM signal_labeling_calls WHERE run_id=target;
  IF spent>r.cap_micro_usd OR spent>admission.execution_cap_micro_usd OR spent>action_cap THEN
   RAISE EXCEPTION 'labeling_cap_exhausted' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR policy IN SELECT DISTINCT p.id,p.organization_id,p.budget_timezone,p.daily_cap_micro_usd,ad.budget_date
  FROM signal_labeling_runs run JOIN signal_processing_admissions ad ON ad.id=run.processing_admission_id
  JOIN signal_processing_policy_versions p ON p.id=ad.policy_version_id WHERE run.id=ANY(targets)
  ORDER BY p.organization_id,ad.budget_date,p.id LOOP
  SELECT total_micro_usd INTO spent FROM signal_processing_org_exposure_v1(policy.organization_id,policy.budget_date,policy.budget_timezone);
  IF spent>policy.daily_cap_micro_usd THEN RAISE EXCEPTION 'processing_daily_cap_exhausted' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR parent IN SELECT DISTINCT execution.id,execution.cap_micro_usd FROM signal_listening_discovery_children child
  JOIN signal_listening_discovery_executions execution ON execution.id=child.execution_id AND execution.workspace_id=child.workspace_id
  WHERE child.run_id=ANY(targets) ORDER BY execution.id LOOP
  PERFORM 1 FROM signal_listening_discovery_executions WHERE id=parent.id FOR UPDATE;
  IF signal_listening_discovery_exposure_v1(parent.id)>parent.cap_micro_usd THEN
   RAISE EXCEPTION 'listening_discovery_parent_cap_exhausted'; END IF;
 END LOOP;
 -- A large final aggregate may cross the physical lease or admission expiry.
 -- Recheck after that work, while all original authority locks remain held.
 FOR target IN SELECT unnest(targets) LOOP
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO admission FROM signal_processing_admissions WHERE id=r.processing_admission_id;
  PERFORM signal_listening_call_authority_v1(target,admission.budget_date,admission.budget_timezone,NULL);
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO owner FROM signal_listening_runs WHERE run_id=target AND workspace_id=r.workspace_id;
  SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
  IF c.revision<>(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=r.workspace_id AND state='published')
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=r.workspace_id AND feature='mass_labeling')
   OR r.entity_context_digest IS DISTINCT FROM(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=r.workspace_id ORDER BY version_no DESC LIMIT 1)
   OR NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps m JOIN signal_corpus_preparation_input_state s
    ON s.workspace_id=m.workspace_id AND s.input_revision=m.input_revision WHERE m.id=owner.map_id AND m.workspace_id=r.workspace_id)
  THEN RAISE EXCEPTION 'listening_run_stale'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
