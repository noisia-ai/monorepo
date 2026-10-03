-- LOCAL ONLY. V2 changes the Anthropic provider boundary. The source request,
-- paid call ledger and evidence table remain the V1 lineage. No admission or
-- provider work is created by installing this migration.

CREATE FUNCTION signal_interest_decision_configuration_v2() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT '{"contract_version":"signal-workspace-interest-decision-provider-config-v2","provider":"anthropic","transport":"message_batches","model":"claude-sonnet-4-6","max_output_tokens":32768,"thinking":"disabled","effort":"high","prompt_digest":"sha256:89651a1758e1dbd5b455ea555a0a5ef096114e7fb44df7ee99d7a87f283f6d73","pricing_version":"claude-sonnet-4-6-batch-usd-2026-09-26","input_micro_usd_per_million_tokens":1500000,"output_micro_usd_per_million_tokens":7500000}'::jsonb
$$;
CREATE FUNCTION signal_interest_decision_provider_config_v2() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT signal_interest_decision_configuration_v2()-ARRAY[
  'pricing_version','input_micro_usd_per_million_tokens','output_micro_usd_per_million_tokens']
$$;
CREATE FUNCTION signal_interest_decision_model_digest_v2() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_semantic_context_digest_json_v2(signal_interest_decision_provider_config_v2())
$$;

ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_interest_decision_action;
ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_interest_decision_action CHECK(
 action<>'interest_decision' OR (kind='provider' AND max_execution_micro_usd>0 AND
  configuration IN(signal_interest_decision_configuration_v1(),signal_interest_decision_configuration_v2())));
ALTER TABLE signal_interest_decision_owners_v1 ADD COLUMN provider_contract_version integer NOT NULL DEFAULT 1
 CHECK(provider_contract_version IN(1,2));
ALTER TABLE signal_interest_decision_requests_v1 DROP CONSTRAINT signal_interest_decision_requests_v1_custom_id_check;
ALTER TABLE signal_interest_decision_requests_v1 ADD CONSTRAINT signal_interest_decision_requests_v1_custom_id_check
 CHECK(custom_id~'^id[12]_[a-f0-9]{60}$');
ALTER TABLE signal_interest_decision_requests_v1 ADD COLUMN provider_contract_version integer NOT NULL DEFAULT 1
 CHECK(provider_contract_version IN(1,2));
ALTER TABLE signal_interest_decision_requests_v1 ADD COLUMN provider_core_body_v2 text
 CHECK(provider_core_body_v2 IS NULL OR octet_length(provider_core_body_v2) BETWEEN 1 AND 524288);
ALTER TABLE signal_interest_decision_requests_v1 ADD CONSTRAINT signal_interest_decision_request_core_version_v2
 CHECK((provider_contract_version=1 AND provider_core_body_v2 IS NULL)
  OR (provider_contract_version=2 AND provider_core_body_v2 IS NOT NULL));

-- The existing source census is unchanged except for the model artifact bound
-- in the generation identity. Keep V1's function available to old owners.
CREATE FUNCTION signal_interest_decision_source_current_v2(target_generation uuid,target_source uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_classification_generations g
  JOIN signal_topic_catalog_executions s ON s.id=target_source AND s.workspace_id=g.workspace_id
  JOIN signal_corpus_preparation_input_state current_input ON current_input.workspace_id=g.workspace_id
  JOIN signal_corpus_preparation_runs p ON p.id=g.preparation_run_id AND p.workspace_id=g.workspace_id
  JOIN signal_workspace_embedding_runs e ON e.id=g.embedding_run_id AND e.workspace_id=g.workspace_id
  WHERE g.id=target_generation AND g.input_contract='workspace-topic-classification-v1' AND g.status='open'
   AND g.input_snapshot->>'interest_term_key' IS NOT NULL
   AND jsonb_array_length(g.input_snapshot->'topics')=1
   AND g.input_snapshot->'source_projection' IS NULL
   AND g.input_snapshot->'identity'->>'engine_version'='2'
   AND g.input_snapshot->'identity'->>'engine_artifact_digest'=signal_interest_decision_model_digest_v2()
   AND s.input_contract='workspace-topic-computation-v1' AND s.status='ready'
   AND s.processed_roots=s.denominator AND s.processed_chunks=s.expected_chunks
   AND s.input_revision=current_input.input_revision AND g.input_revision=current_input.input_revision
   AND s.preparation_run_id=g.preparation_run_id AND s.embedding_run_id=g.embedding_run_id
   AND s.taxonomy_profile_id=g.taxonomy_profile_id
   AND s.input_snapshot->>'context_digest'=g.input_snapshot->>'context_digest'
   AND (SELECT count(*) FROM jsonb_array_elements(s.input_snapshot->'topics') topic
    WHERE topic->'definition'->>'term_key'=g.input_snapshot->>'interest_term_key'
     AND topic->'definition'->>'definition_digest'=g.input_snapshot->'topics'->0->'definition'->>'definition_digest'
     AND topic->>'taxonomy_term_id'=g.input_snapshot->'topics'->0->>'taxonomy_term_id')=1
   AND p.status='completed' AND e.status='completed'
   AND (s.policy_valid_until IS NULL OR s.policy_valid_until>clock_timestamp())
   AND (g.policy_valid_until IS NULL OR g.policy_valid_until>clock_timestamp())
   AND (p.policy_valid_until IS NULL OR p.policy_valid_until>clock_timestamp())
   AND (e.policy_valid_until IS NULL OR e.policy_valid_until>clock_timestamp())),false)
$$;

CREATE FUNCTION signal_interest_decision_utf16_length_v2(value text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
 SELECT char_length(value)+regexp_count(value,U&'[\+010000-\+10FFFF]')
$$;

-- Validate the exact user payload saved in the provider request. Every span
-- is a nonempty contiguous UTF-16 fragment of the sealed source chunk.
CREATE FUNCTION signal_interest_decision_provider_input_valid_v2(source_request jsonb,provider_input jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE root jsonb;provided_root jsonb;chunk jsonb;provided_chunk jsonb;
 span jsonb;expected_text text;position integer;span_index integer;root_index integer;chunk_index integer;
BEGIN
 IF jsonb_typeof(provider_input)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(provider_input))<>3
  OR NOT (provider_input ?& ARRAY['contract_version','interest','roots'])
  OR provider_input->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-provider-input-v2'
  OR provider_input->'interest' IS DISTINCT FROM jsonb_build_object(
   'definition',source_request->'interest'->>'definition',
   'inclusion',source_request->'interest'->'inclusion','exclusion',source_request->'interest'->'exclusion')
  OR jsonb_typeof(provider_input->'roots')<>'array'
  OR jsonb_array_length(provider_input->'roots')<>jsonb_array_length(source_request->'roots') THEN RETURN false;END IF;
 FOR root_index IN 0..jsonb_array_length(source_request->'roots')-1 LOOP
  root:=source_request->'roots'->root_index;provided_root:=provider_input->'roots'->root_index;
  IF jsonb_typeof(provided_root)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(provided_root))<>2
   OR provided_root->>'root_ordinal' IS DISTINCT FROM root_index::text
   OR jsonb_typeof(provided_root->'chunks')<>'array'
   OR jsonb_array_length(provided_root->'chunks')<>jsonb_array_length(root->'chunks') THEN RETURN false;END IF;
  FOR chunk_index IN 0..jsonb_array_length(root->'chunks')-1 LOOP
   chunk:=root->'chunks'->chunk_index;provided_chunk:=provided_root->'chunks'->chunk_index;
   IF jsonb_typeof(provided_chunk)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(provided_chunk))<>2
    OR provided_chunk->>'chunk_index' IS DISTINCT FROM chunk_index::text
    OR jsonb_typeof(provided_chunk->'spans')<>'array' THEN RETURN false;END IF;
   position:=0;
   FOR span_index IN 0..jsonb_array_length(provided_chunk->'spans')-1 LOOP
    span:=provided_chunk->'spans'->span_index;expected_text:=span->>'text';
    IF jsonb_typeof(span)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(span))<>2
     OR span->>'span_id' IS DISTINCT FROM 'r'||root_index||'c'||chunk_index||'s'||span_index
     OR expected_text IS NULL OR signal_interest_decision_utf16_length_v2(expected_text) NOT BETWEEN 1 AND 320
     OR expected_text IS DISTINCT FROM signal_topic_utf16_fragment_v1(chunk->>'text',position,
       position+signal_interest_decision_utf16_length_v2(expected_text)) THEN RETURN false;END IF;
    position:=position+signal_interest_decision_utf16_length_v2(expected_text);
   END LOOP;
   IF position<>signal_interest_decision_utf16_length_v2(chunk->>'text') THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range THEN RETURN false;
END $$;

-- A V1 apply invocation cannot turn a settled V2 output into an irreversible
-- V1 invalid_output result. Only the V2 apply routine can set its validation.
CREATE FUNCTION signal_interest_decision_output_schema_v2() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT '{"type":"object","additionalProperties":false,"required":["contract_version","decisions"],"properties":{"contract_version":{"type":"string","enum":["signal-workspace-interest-decision-provider-output-v2"]},"decisions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["root_ordinal","verdict","rationale","citations"],"properties":{"root_ordinal":{"type":"integer"},"verdict":{"type":"string","enum":["belongs","not_belongs","insufficient"]},"rationale":{"type":"string"},"citations":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["span_id","role"],"properties":{"span_id":{"type":"string"},"role":{"type":"string","enum":["supports","contradicts","context"]}}}}}}}}}'::jsonb
$$;

CREATE FUNCTION signal_interest_decision_request_valid_v2(target_owner uuid,item jsonb,
 canonical_request_body text,canonical_interest_body text,provider_core_body text,exact_provider_body text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE o signal_interest_decision_owners_v1%ROWTYPE;g signal_classification_generations%ROWTYPE;
 request jsonb;provider jsonb;params jsonb;provider_input jsonb;root jsonb;chunk jsonb;ref jsonb;
 prepared signal_corpus_preparation_items%ROWTYPE;asset signal_corpus_text_assets%ROWTYPE;
 mention mentions%ROWTYPE;source_item signal_topic_classification_items%ROWTYPE;
 i integer;last_end integer;
BEGIN
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=target_owner;
 SELECT * INTO g FROM signal_classification_generations WHERE id=o.generation_id;
 request:=item->'request';provider:=item->'provider_request';params:=provider->'params';
 provider_input:=(params->'messages'->0->>'content')::jsonb;
 IF o.id IS NULL OR o.provider_contract_version<>2
  OR item->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-batch-request-v2'
  OR request->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-v1'
  OR request->>'workspace_id' IS DISTINCT FROM o.workspace_id::text
  OR request->>'context_digest' IS DISTINCT FROM o.source_context_digest
  OR request->>'decision_policy_digest' IS DISTINCT FROM g.input_snapshot->'identity'->>'decision_policy_digest'
  OR request->'interest' IS DISTINCT FROM jsonb_build_object(
   'taxonomy_term_id',o.taxonomy_term_id,'term_key',o.term_key,
   'definition_revision',(g.input_snapshot->'topics'->0->'definition'->>'definition_revision')::integer,
   'definition_digest',o.definition_digest,
   'definition',g.input_snapshot->'topics'->0->'definition'->>'definition',
   'inclusion',g.input_snapshot->'topics'->0->'definition'->'inclusion',
   'exclusion',g.input_snapshot->'topics'->0->'definition'->'exclusion')
  OR request-'request_digest' IS DISTINCT FROM canonical_request_body::jsonb
  OR request->>'request_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(canonical_request_body)
  OR request->'interest' IS DISTINCT FROM canonical_interest_body::jsonb
  OR provider_core_body::jsonb IS DISTINCT FROM jsonb_build_object('request_digest',request->>'request_digest',
    'configuration',signal_interest_decision_provider_config_v2(),'params',params)
  OR item->>'provider_request_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(provider_core_body)
  OR provider IS DISTINCT FROM exact_provider_body::jsonb
  OR item->>'provider_request_bytes' IS DISTINCT FROM octet_length(exact_provider_body)::text
  OR octet_length(exact_provider_body)>524288
  OR provider->>'custom_id' IS DISTINCT FROM 'id2_'||substr(item->>'provider_request_digest',8,60)
  OR (SELECT count(*) FROM jsonb_object_keys(params))<>6
  OR NOT (params ?& ARRAY['model','max_tokens','thinking','system','output_config','messages'])
  OR params->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
  OR params->>'max_tokens' IS DISTINCT FROM '32768'
  OR params->'thinking' IS DISTINCT FROM '{"type":"disabled"}'::jsonb
  OR params->'output_config' IS DISTINCT FROM jsonb_build_object('effort','high','format',
   jsonb_build_object('type','json_schema','schema',signal_interest_decision_output_schema_v2()))
  OR signal_semantic_context_digest_v1(params->>'system') IS DISTINCT FROM
     signal_interest_decision_provider_config_v2()->>'prompt_digest'
  OR jsonb_typeof(params->'messages')<>'array' OR jsonb_array_length(params->'messages')<>1
  OR params->'messages'->0->>'role' IS DISTINCT FROM 'user'
  OR (SELECT count(*) FROM jsonb_object_keys(params->'messages'->0))<>2
  OR NOT signal_interest_decision_provider_input_valid_v2(request,provider_input)
  OR jsonb_array_length(request->'roots') NOT BETWEEN 1 AND 64
  OR item->'root_ids' IS DISTINCT FROM
     (SELECT jsonb_agg(root->>'root_id' ORDER BY n) FROM jsonb_array_elements(request->'roots') WITH ORDINALITY r(root,n))
  OR (SELECT count(DISTINCT root->>'root_id') FROM jsonb_array_elements(request->'roots') root)
     <>jsonb_array_length(request->'roots')
 THEN RETURN false;END IF;
 FOR root IN SELECT value FROM jsonb_array_elements(request->'roots') LOOP
  SELECT * INTO prepared FROM signal_corpus_preparation_items
   WHERE run_id=g.preparation_run_id AND workspace_id=o.workspace_id AND root_id=(root->>'root_id')::uuid;
  SELECT * INTO asset FROM signal_corpus_text_assets WHERE workspace_id=o.workspace_id
   AND text_sha256=prepared.asset_sha256 AND chunk_policy_version=prepared.chunk_policy_version;
  SELECT * INTO mention FROM mentions WHERE id=prepared.root_id AND workspace_id=o.workspace_id;
  SELECT * INTO source_item FROM signal_topic_classification_items WHERE execution_id=o.source_execution_id
   AND workspace_id=o.workspace_id AND canonical_root_id=prepared.root_id;
  IF prepared.disposition IS DISTINCT FROM 'eligible' OR asset.text_sha256 IS NULL
   OR mention.inclusion_status IS DISTINCT FROM 'included' OR mention.canonical_mention_id IS DISTINCT FROM mention.id
   OR mention.text_clean_sha256 IS DISTINCT FROM prepared.asset_sha256
   OR source_item.resolution_state NOT IN('doubt','not_relevant')
   OR source_item.computation_evidence->>'root_fingerprint' IS DISTINCT FROM prepared.fingerprint
   OR source_item.computation_evidence->>'asset_sha256' IS DISTINCT FROM prepared.asset_sha256
   OR root->>'fingerprint' IS DISTINCT FROM prepared.fingerprint
   OR root->>'asset_sha256' IS DISTINCT FROM prepared.asset_sha256
   OR root->>'correction_digest' IS DISTINCT FROM signal_interest_decision_correction_digest_v1(
      o.workspace_id,prepared.root_id,prepared.fingerprint,o.source_context_digest,o.source_execution_id)
   OR signal_semantic_context_digest_v1(asset.full_text) IS DISTINCT FROM asset.text_sha256
   OR jsonb_array_length(root->'chunks') IS DISTINCT FROM jsonb_array_length(asset.chunks->'chunks')
   OR NOT signal_interest_decision_root_rights_v1(o.workspace_id,prepared.root_id)
  THEN RETURN false;END IF;
  last_end:=0;
  FOR i IN 0..jsonb_array_length(root->'chunks')-1 LOOP
   chunk:=root->'chunks'->i;ref:=asset.chunks->'chunks'->i;
   IF chunk->>'chunk_index' IS DISTINCT FROM i::text
    OR chunk->>'start' IS DISTINCT FROM ref->>'start'
    OR chunk->>'end' IS DISTINCT FROM ref->>'end'
    OR (chunk->>'start')::integer IS DISTINCT FROM last_end
    OR chunk->>'chunk_sha256' IS DISTINCT FROM ref->>'sha256'
    OR chunk->>'text' IS DISTINCT FROM signal_topic_utf16_fragment_v1(asset.full_text,
      (ref->>'start')::integer,(ref->>'end')::integer)
    OR signal_semantic_context_digest_v1(chunk->>'text') IS DISTINCT FROM ref->>'sha256'
   THEN RETURN false;END IF;
   last_end:=(ref->>'end')::integer;
  END LOOP;
  IF last_end IS DISTINCT FROM signal_interest_decision_utf16_length_v2(asset.full_text)
   OR source_item.computation_evidence->>'processed_chunks' IS DISTINCT FROM jsonb_array_length(root->'chunks')::text
  THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR check_violation OR numeric_value_out_of_range
 OR invalid_parameter_value THEN RETURN false;
END $$;
CREATE FUNCTION signal_interest_decision_derive_decisions_v2(
 source_request jsonb,provider_request jsonb,provider_output jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE input jsonb;decisions jsonb;decision jsonb;citation jsonb;root jsonb;chunk jsonb;
 provided_chunk jsonb;span jsonb;normalized jsonb:='[]'::jsonb;normalized_citations jsonb;
 root_index integer;chunk_index integer;span_index integer;position integer;start_at integer;end_at integer;
 seen_roots integer[]:='{}';seen_spans text[];found boolean;role text;verdict text;support boolean;exclude_evidence boolean;
BEGIN
 IF provider_request->'params'->'messages'->0->>'role' IS DISTINCT FROM 'user' THEN
  RAISE EXCEPTION 'interest_decision_v2_input_invalid' USING ERRCODE='23514';END IF;
 input:=(provider_request->'params'->'messages'->0->>'content')::jsonb;
 IF NOT signal_interest_decision_provider_input_valid_v2(source_request,input)
  OR jsonb_typeof(provider_output)<>'object'
  OR (SELECT count(*) FROM jsonb_object_keys(provider_output))<>2
  OR NOT (provider_output ?& ARRAY['contract_version','decisions'])
  OR provider_output->>'contract_version' IS DISTINCT FROM 'signal-workspace-interest-decision-provider-output-v2'
  OR jsonb_typeof(provider_output->'decisions')<>'array'
  OR jsonb_array_length(provider_output->'decisions')<>jsonb_array_length(source_request->'roots')
 THEN RAISE EXCEPTION 'interest_decision_v2_output_invalid' USING ERRCODE='23514';END IF;
 decisions:=provider_output->'decisions';
 FOR decision IN SELECT value FROM jsonb_array_elements(decisions) LOOP
  IF jsonb_typeof(decision)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(decision))<>4
   OR NOT (decision ?& ARRAY['root_ordinal','verdict','rationale','citations'])
   OR jsonb_typeof(decision->'root_ordinal')<>'number'
   OR NOT COALESCE(decision->>'root_ordinal'~'^(0|[1-9][0-9]*)$',false)
   OR jsonb_typeof(decision->'rationale')<>'string'
   OR NULLIF(btrim(decision->>'rationale'),'') IS NULL
   OR jsonb_typeof(decision->'citations')<>'array'
   OR jsonb_array_length(decision->'citations')>128
  THEN RAISE EXCEPTION 'interest_decision_v2_output_invalid' USING ERRCODE='23514';END IF;
  root_index:=(decision->>'root_ordinal')::integer;verdict:=decision->>'verdict';
  IF root_index<0 OR root_index>=jsonb_array_length(source_request->'roots')
   OR root_index=ANY(seen_roots) OR NOT COALESCE(verdict IN('belongs','not_belongs','insufficient'),false)
  THEN RAISE EXCEPTION 'interest_decision_v2_root_invalid' USING ERRCODE='23514';END IF;
  seen_roots:=array_append(seen_roots,root_index);root:=source_request->'roots'->root_index;
  normalized_citations:='[]'::jsonb;seen_spans:='{}';support:=false;exclude_evidence:=false;
  FOR citation IN SELECT value FROM jsonb_array_elements(decision->'citations') LOOP
   IF jsonb_typeof(citation)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(citation))<>2
    OR NOT (citation ?& ARRAY['span_id','role'])
    OR NOT COALESCE(citation->>'span_id'~'^r[0-9]+c[0-9]+s[0-9]+$',false)
    OR citation->>'span_id'=ANY(seen_spans)
    OR NOT COALESCE(citation->>'role' IN('supports','contradicts','context'),false)
   THEN RAISE EXCEPTION 'interest_decision_v2_citation_invalid' USING ERRCODE='23514';END IF;
   seen_spans:=array_append(seen_spans,citation->>'span_id');role:=citation->>'role';found:=false;
   FOR chunk_index IN 0..jsonb_array_length(root->'chunks')-1 LOOP
    chunk:=root->'chunks'->chunk_index;
    provided_chunk:=input->'roots'->root_index->'chunks'->chunk_index;position:=0;
    FOR span_index IN 0..jsonb_array_length(provided_chunk->'spans')-1 LOOP
     span:=provided_chunk->'spans'->span_index;
     start_at:=position;end_at:=position+signal_interest_decision_utf16_length_v2(span->>'text');
     IF span->>'span_id'=citation->>'span_id' THEN
      IF found OR NULLIF(btrim(span->>'text'),'') IS NULL THEN
       RAISE EXCEPTION 'interest_decision_v2_citation_invalid' USING ERRCODE='23514';END IF;
      normalized_citations:=normalized_citations||jsonb_build_array(jsonb_build_object(
       'chunk_index',chunk_index,'chunk_sha256',chunk->>'chunk_sha256',
       'quote_start',start_at,'quote_end',end_at,'quote',span->>'text','role',role));
      found:=true;
     END IF;
     position:=end_at;
    END LOOP;
   END LOOP;
   IF NOT found THEN RAISE EXCEPTION 'interest_decision_v2_citation_invalid' USING ERRCODE='23514';END IF;
   support:=support OR role='supports';exclude_evidence:=exclude_evidence OR role IN('contradicts','context');
  END LOOP;
  IF verdict='belongs' AND NOT support OR verdict='not_belongs' AND NOT exclude_evidence THEN
   RAISE EXCEPTION 'interest_decision_v2_evidence_role_invalid' USING ERRCODE='23514';END IF;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('root_id',root->>'root_id',
   'root_fingerprint',root->>'fingerprint','asset_sha256',root->>'asset_sha256',
   'verdict',verdict,'rationale',decision->>'rationale','citations',normalized_citations));
 END LOOP;
 IF cardinality(seen_roots)<>jsonb_array_length(source_request->'roots') THEN
  RAISE EXCEPTION 'interest_decision_v2_root_coverage_invalid' USING ERRCODE='23514';END IF;
 RETURN normalized;
EXCEPTION WHEN data_exception OR check_violation THEN
 RAISE EXCEPTION 'interest_decision_v2_output_invalid' USING ERRCODE='23514';
END $$;

CREATE FUNCTION signal_interest_decision_call_v2_validation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.validation_status IS DISTINCT FROM OLD.validation_status
  AND EXISTS(SELECT 1 FROM signal_interest_decision_requests_v1 r
   WHERE r.id=NEW.request_id AND r.provider_contract_version=2)
  AND current_setting('signal.interest_decision.v2_apply_call',true) IS DISTINCT FROM NEW.id::text
 THEN RAISE EXCEPTION 'interest_decision_v2_apply_required' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_interest_decision_call_v2_validation_guard BEFORE UPDATE
 ON signal_interest_decision_calls_v1 FOR EACH ROW
 EXECUTE FUNCTION signal_interest_decision_call_v2_validation_guard();

CREATE FUNCTION apply_signal_interest_decision_item_v2(target_call uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_interest_decision_calls_v1%ROWTYPE;r signal_interest_decision_requests_v1%ROWTYPE;
 o signal_interest_decision_owners_v1%ROWTYPE;b signal_interest_decision_batches_v1%ROWTYPE;
 envelope jsonb;output jsonb;decision jsonb;normalized jsonb;message jsonb;
 v_status text;provider_core jsonb;
BEGIN
 SELECT * INTO c FROM signal_interest_decision_calls_v1 WHERE id=target_call FOR UPDATE;
 SELECT * INTO r FROM signal_interest_decision_requests_v1 WHERE id=c.request_id;
 SELECT * INTO o FROM signal_interest_decision_owners_v1 WHERE id=c.owner_id;
 SELECT * INTO b FROM signal_interest_decision_batches_v1 WHERE id=c.batch_id;
 provider_core:=jsonb_build_object('request_digest',r.request_digest,
  'configuration',signal_interest_decision_provider_config_v2(),
  'params',r.provider_request->'params');
 IF c.id IS NULL OR c.status<>'settled' OR b.state NOT IN('ended','applied')
  OR c.raw_body IS NULL OR c.raw_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(c.raw_body)
  OR r.owner_id IS DISTINCT FROM o.id OR r.page_id IS DISTINCT FROM b.page_id
  OR r.provider_contract_version<>2 OR o.provider_contract_version<>2
  OR r.custom_id!~'^id2_[a-f0-9]{60}$'
  OR r.request-'request_digest' IS DISTINCT FROM r.request_body::jsonb
  OR r.request_digest IS DISTINCT FROM signal_semantic_context_digest_v1(r.request_body)
  OR r.provider_request IS DISTINCT FROM r.provider_body::jsonb
  OR r.provider_core_body_v2::jsonb IS DISTINCT FROM provider_core
  OR r.provider_request_digest IS DISTINCT FROM signal_semantic_context_digest_v1(r.provider_core_body_v2)
  OR r.custom_id IS DISTINCT FROM 'id2_'||substr(r.provider_request_digest,8,60)
  OR r.provider_request->'params'->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
  OR r.provider_request->'params'->>'max_tokens' IS DISTINCT FROM '32768'
  OR r.provider_request->'params'->'thinking' IS DISTINCT FROM '{"type":"disabled"}'::jsonb
  OR r.provider_request->'params'->'output_config' IS DISTINCT FROM jsonb_build_object(
   'effort','high','format',jsonb_build_object('type','json_schema',
    'schema',signal_interest_decision_output_schema_v2()))
  OR signal_semantic_context_digest_v1(r.provider_request->'params'->>'system') IS DISTINCT FROM
   signal_interest_decision_provider_config_v2()->>'prompt_digest'
  OR NOT signal_interest_decision_provider_input_valid_v2(r.request,
   (r.provider_request->'params'->'messages'->0->>'content')::jsonb)
 THEN RAISE EXCEPTION 'interest_decision_v2_call_unsealed' USING ERRCODE='23514';END IF;
 IF c.validation_status IS NOT NULL THEN
  RETURN jsonb_build_object('call_id',c.id,'validation_status',c.validation_status,'replayed',true);
 END IF;
 envelope:=c.raw_body::jsonb;message:=envelope->'result'->'message';
 IF envelope->>'custom_id' IS DISTINCT FROM r.custom_id
  OR envelope->'result'->>'type' IS DISTINCT FROM c.outcome
 THEN RAISE EXCEPTION 'interest_decision_v2_raw_provenance_invalid' USING ERRCODE='23514';END IF;
 IF c.outcome<>'succeeded' THEN
  RETURN jsonb_build_object('call_id',c.id,'validation_status',c.outcome,'replayed',false);
 END IF;
 IF message->>'stop_reason'='refusal' THEN v_status:='refusal';
 ELSIF message->>'stop_reason'='max_tokens' THEN v_status:='max_tokens';
 ELSIF message->>'type' IS DISTINCT FROM 'message' OR message->>'role' IS DISTINCT FROM 'assistant'
  OR message->>'model' IS DISTINCT FROM 'claude-sonnet-4-6'
  OR NULLIF(message->>'id','') IS NULL OR message->>'stop_reason' IS DISTINCT FROM 'end_turn'
  OR (CASE WHEN jsonb_typeof(message->'content')='array'
   THEN jsonb_array_length(message->'content')<>1 ELSE true END)
  OR message->'content'->0->>'type' IS DISTINCT FROM 'text'
  OR jsonb_typeof(message->'content'->0->'text') IS DISTINCT FROM 'string'
  OR c.output_text IS DISTINCT FROM message->'content'->0->>'text'
  OR c.output_digest IS DISTINCT FROM signal_semantic_context_digest_v1(c.output_text)
 THEN v_status:='invalid_message';
 ELSE
  BEGIN
   output:=c.output_text::jsonb;
   normalized:=signal_interest_decision_derive_decisions_v2(r.request,r.provider_request,output);
  EXCEPTION WHEN data_exception OR check_violation THEN
   v_status:='invalid_output';
  END;
 END IF;
 PERFORM set_config('signal.interest_decision.v2_apply_call',c.id::text,true);
 IF v_status IS NOT NULL THEN
  UPDATE signal_interest_decision_calls_v1 SET validation_status=v_status WHERE id=c.id;
  RETURN jsonb_build_object('call_id',c.id,'validation_status',v_status,'replayed',false);
 END IF;
 FOR decision IN SELECT value FROM jsonb_array_elements(normalized) LOOP
  INSERT INTO signal_interest_decision_root_evidence_v1(owner_id,request_id,call_id,root_id,
   term_key,taxonomy_term_id,root_fingerprint,asset_sha256,verdict,rationale,citations,
   output_digest,decision_digest)
  VALUES(o.id,r.id,c.id,(decision->>'root_id')::uuid,o.term_key,o.taxonomy_term_id,
   decision->>'root_fingerprint',decision->>'asset_sha256',decision->>'verdict',
   decision->>'rationale',decision->'citations',c.output_digest,
   signal_semantic_context_digest_json_v2(decision));
 END LOOP;
 UPDATE signal_interest_decision_calls_v1 SET validation_status='accepted' WHERE id=c.id;
 RETURN jsonb_build_object('call_id',c.id,'validation_status','accepted',
  'root_count',jsonb_array_length(normalized),'output_digest',c.output_digest,'replayed',false);
END $$;

REVOKE ALL ON FUNCTION signal_interest_decision_configuration_v2(),
 signal_interest_decision_provider_config_v2(),signal_interest_decision_model_digest_v2(),
 signal_interest_decision_source_current_v2(uuid,uuid),signal_interest_decision_utf16_length_v2(text),
 signal_interest_decision_provider_input_valid_v2(jsonb,jsonb),signal_interest_decision_output_schema_v2(),
 signal_interest_decision_request_valid_v2(uuid,jsonb,text,text,text,text),
 signal_interest_decision_derive_decisions_v2(jsonb,jsonb,jsonb),
 signal_interest_decision_call_v2_validation_guard(),apply_signal_interest_decision_item_v2(uuid)
 FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION apply_signal_interest_decision_item_v2(uuid) TO service_role;
 END IF;
END $$;

-- Returns only trusted V1-shaped decisions. The model supplies ordinal, verdict,
-- rationale and span choice; root identity, literal quote, offsets and digests
-- come exclusively from the sealed request and provider input.
