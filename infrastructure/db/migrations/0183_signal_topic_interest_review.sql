-- LOCAL ONLY: immutable interest-review preparation, not paid admission.
-- No existing owner, phase, configuration, request, ledger or dispatcher changes.
-- Paid admission/checkpoints require a later reviewed extension and real PG gate.

CREATE FUNCTION signal_topic_interest_review_configuration_v1() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT '{"contract_version":"signal-topic-editorial-provider-config-v1","phase":"interest_review","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:cd9174042eb813b8d545b77f5a1ad7945fd0071c99ea0143ff918a8b7450b844","schema_digest":"sha256:6aea0835d03079f6a902051f2203ed4413ce74924cc2bf72a95eef2d58fe6a15","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"thinking":"disabled","effort":"high","stream":false,"max_output_tokens":8192}'::jsonb
$$;

-- Match JavaScript String.trim(), including non-ASCII ECMAScript whitespace.
CREATE FUNCTION signal_topic_interest_review_trim_v1(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
 SELECT btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

CREATE FUNCTION signal_topic_interest_review_utf16_length_v1(value text) RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
 SELECT COALESCE(sum(CASE WHEN ascii(item)>65535 THEN 2 ELSE 1 END),0)
 FROM regexp_split_to_table(value,'') chars(item) WHERE item<>''
$$;

CREATE FUNCTION signal_topic_interest_review_lines_v1(body jsonb,deduplicate boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(line) ORDER BY ordinal),'[]'::jsonb)
 FROM (SELECT signal_topic_interest_review_trim_v1(value) line,min(ordinality) ordinal
  FROM jsonb_array_elements_text(body) WITH ORDINALITY
  GROUP BY signal_topic_interest_review_trim_v1(value),CASE WHEN deduplicate THEN 0 ELSE ordinality END) lines
 WHERE NOT deduplicate OR line<>''
$$;

-- Normalize the existing definition schema, then recompute its meaning digest.
-- This does not update taxonomy_terms or invent a new definition contract.
CREATE FUNCTION signal_topic_interest_review_definition_v1(body jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE normalized jsonb;meaning jsonb;field text;source jsonb;line jsonb;
BEGIN
 IF jsonb_typeof(body) IS DISTINCT FROM 'object'
  OR body-ARRAY['term_key','label','definition','scope','inclusion','exclusion','positive_examples','negative_examples',
    'lifecycle','origin','discovery_guidance','source','definition_revision','definition_digest','created_at','updated_at']<>'{}'::jsonb
  OR NOT COALESCE(body->>'term_key'~'^[a-z][a-z0-9]*(_[a-z0-9]+)*$',false)
  OR jsonb_typeof(body->'label') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'definition') IS DISTINCT FROM 'string'
  OR NOT COALESCE(body->>'scope' IN('primary_brand','competitor','category','all_conversations'),false)
  OR NOT COALESCE(body->>'lifecycle' IN('draft','archived'),false)
  OR NOT COALESCE(body->>'origin' IN('manual','historical_taxonomy','corpus_discovery','evidence_candidate','discovered','workspace_discovery'),false)
  OR (body ? 'discovery_guidance' AND jsonb_typeof(body->'discovery_guidance') IS DISTINCT FROM 'boolean')
  OR jsonb_typeof(body->'definition_revision') IS DISTINCT FROM 'number'
  OR NOT COALESCE(body->>'definition_revision'~'^[1-9][0-9]*$',false)
  OR (body->>'definition_revision')::numeric>9007199254740991
  OR NOT COALESCE(body->>'definition_digest'~'^sha256:[a-f0-9]{64}$',false)
  OR NOT COALESCE(body->>'created_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$',false)
  OR NOT COALESCE(body->>'updated_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$',false)
 THEN RETURN NULL;END IF;
 PERFORM (body->>'created_at')::timestamptz,(body->>'updated_at')::timestamptz;
 normalized:=body||jsonb_build_object('label',signal_topic_interest_review_trim_v1(body->>'label'),
  'definition',signal_topic_interest_review_trim_v1(body->>'definition'));
 IF signal_topic_interest_review_utf16_length_v1(normalized->>'label') NOT BETWEEN 1 AND 160
  OR signal_topic_interest_review_utf16_length_v1(normalized->>'definition') NOT BETWEEN 1 AND 1500 THEN RETURN NULL;END IF;
 FOREACH field IN ARRAY ARRAY['inclusion','exclusion','positive_examples','negative_examples'] LOOP
  IF body ? field AND jsonb_typeof(body->field) IS DISTINCT FROM 'array' THEN RETURN NULL;END IF;
  IF jsonb_array_length(COALESCE(body->field,'[]'::jsonb))>16 THEN RETURN NULL;END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(COALESCE(body->field,'[]'::jsonb)) LOOP
   IF jsonb_typeof(line)<>'string' OR signal_topic_interest_review_utf16_length_v1(signal_topic_interest_review_trim_v1(line#>>'{}')) NOT BETWEEN 1 AND 240 THEN RETURN NULL;END IF;
  END LOOP;
  normalized:=normalized||jsonb_build_object(field,signal_topic_interest_review_lines_v1(COALESCE(body->field,'[]'::jsonb)));
 END LOOP;
 source:=COALESCE(body->'source','null'::jsonb);
 IF source<>'null'::jsonb THEN
  IF jsonb_typeof(source)<>'object' OR source-ARRAY['run_key','candidate_key','candidate_digest']<>'{}'::jsonb
   OR jsonb_typeof(source->'run_key') IS DISTINCT FROM 'string' OR signal_topic_interest_review_utf16_length_v1(source->>'run_key') NOT BETWEEN 1 AND 200
   OR jsonb_typeof(source->'candidate_key') IS DISTINCT FROM 'string' OR signal_topic_interest_review_utf16_length_v1(source->>'candidate_key') NOT BETWEEN 1 AND 200
   OR (COALESCE(source->'candidate_digest','null'::jsonb)<>'null'::jsonb
     AND NOT COALESCE(source->>'candidate_digest'~'^sha256:[a-f0-9]{64}$',false)) THEN RETURN NULL;END IF;
  source:=source||jsonb_build_object('candidate_digest',COALESCE(source->'candidate_digest','null'::jsonb));
 END IF;
 normalized:=normalized||jsonb_build_object('source',source);
 meaning:=jsonb_build_object('contract_version','signal-topic-catalog-v1','term_key',normalized->'term_key',
  'definition',normalized->'definition','scope',normalized->'scope','lifecycle',normalized->'lifecycle','origin',normalized->'origin','source',source);
 FOREACH field IN ARRAY ARRAY['inclusion','exclusion','positive_examples','negative_examples'] LOOP
  meaning:=meaning||jsonb_build_object(field,signal_topic_interest_review_lines_v1(normalized->field,true));
 END LOOP;
 IF NOT COALESCE((normalized->>'discovery_guidance')::boolean,normalized->>'origin'<>'workspace_discovery') THEN
  meaning:=meaning||'{"discovery_guidance":false}'::jsonb;
 END IF;
 IF signal_topic_editorial_digest_json_v1(meaning) IS DISTINCT FROM normalized->>'definition_digest' THEN RETURN NULL;END IF;
 RETURN normalized;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value OR datetime_field_overflow THEN RETURN NULL;
END;$$;

-- Same working-head/descendant selection as loadSignalTopicWorkingProfileWithQueryableV1.
CREATE FUNCTION signal_topic_interest_review_working_profile_v1(target_workspace uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE head signal_taxonomy_profiles%ROWTYPE;child signal_taxonomy_profiles%ROWTYPE;
BEGIN
 SELECT * INTO head FROM signal_taxonomy_profiles
 WHERE workspace_id=target_workspace AND kind='topic' AND status IN('draft','activating','active','retired')
  AND metadata->>'contract_version'='signal-topic-catalog-v1' AND (metadata->>'catalog_role'='working' OR metadata->>'catalog_role' IS NULL OR metadata->>'catalog_role'='')
 ORDER BY CASE WHEN metadata->>'catalog_role'='working' THEN 0 ELSE 1 END,version DESC,id DESC LIMIT 1;
 IF head.id IS NULL THEN RETURN NULL;END IF;
 LOOP
  SELECT * INTO child FROM signal_taxonomy_profiles WHERE workspace_id=target_workspace AND kind='topic'
   AND status IN('draft','activating','active','retired') AND metadata->>'contract_version'='signal-topic-catalog-v1'
   AND metadata->>'catalog_role' IN('analysis_materialized','incremental')
   AND metadata->>'source_catalog_profile_id'=head.id::text AND version>head.version
   ORDER BY version DESC,id DESC LIMIT 1;
  IF child.id IS NULL THEN RETURN head.id;END IF;head:=child;
 END LOOP;
END;$$;

CREATE FUNCTION signal_topic_interest_review_catalog_v1(target_workspace uuid,target_profile uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE catalog jsonb;invalid boolean;
BEGIN
 IF target_profile IS NULL OR signal_topic_interest_review_working_profile_v1(target_workspace) IS DISTINCT FROM target_profile THEN RETURN NULL;END IF;
 WITH definitions AS MATERIALIZED(SELECT term.term_key,signal_topic_interest_review_definition_v1(term.metadata->'topic') definition FROM taxonomy_terms term
  JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id
  WHERE profile.id=target_profile AND profile.workspace_id=target_workspace AND profile.kind='topic')
 SELECT COALESCE(jsonb_agg(definition ORDER BY term_key COLLATE "C") FILTER(WHERE definition->>'lifecycle'<>'archived'
   AND (definition->>'origin'<>'workspace_discovery' OR definition->'discovery_guidance'='true'::jsonb)),'[]'::jsonb),
  COALESCE(bool_or(definition IS NULL OR definition->>'term_key' IS DISTINCT FROM term_key),false) OR count(*)<>count(DISTINCT term_key)
 INTO catalog,invalid FROM definitions;
 IF invalid THEN RETURN NULL;END IF;
 RETURN catalog;
END;$$;

CREATE FUNCTION signal_topic_interest_review_plan_valid_v1(target_workspace uuid,target_run uuid,review jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp SET jit=off AS $$
DECLARE plan jsonb;manifest jsonb;expected_manifest jsonb;catalog jsonb;receipts jsonb;groups jsonb;context jsonb;
 batch jsonb;wire jsonb;payload jsonb;expected_payload jsonb;expected_pairs jsonb;batch_groups jsonb;batch_interests jsonb;
 configuration jsonb:=signal_topic_interest_review_configuration_v1();pair_count bigint;batch_index integer:=0;
BEGIN
 IF jsonb_typeof(review) IS DISTINCT FROM 'object' OR octet_length(signal_topic_editorial_canonical_json_v1(review))>32000000
  OR review-ARRAY['screening_plan','manifest','input_digest','batches','review_digest']<>'{}'::jsonb
  OR review->>'review_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(review-'review_digest')
  OR jsonb_typeof(review->'batches') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 plan:=review->'screening_plan';manifest:=review->'manifest';
 IF NOT signal_topic_editorial_plan_valid_v1(target_run,plan)
  OR manifest->>'workspace_id' IS DISTINCT FROM target_workspace::text
  OR NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_runs WHERE id=target_run AND workspace_id=target_workspace) THEN RETURN false;END IF;
 catalog:=signal_topic_interest_review_catalog_v1(target_workspace,(manifest->>'taxonomy_profile_id')::uuid);
 IF catalog IS NULL OR jsonb_array_length(catalog)=0 THEN RETURN false;END IF;
 SELECT jsonb_agg(receipt ORDER BY receipt->>'group_key' COLLATE "C") INTO receipts
  FROM jsonb_array_elements(plan->'batches') b CROSS JOIN LATERAL jsonb_array_elements(b->'group_receipts') receipt;
 SELECT jsonb_agg(g ORDER BY g->>'group_key' COLLATE "C") INTO groups
  FROM jsonb_array_elements(plan->'batches') b CROSS JOIN LATERAL jsonb_array_elements((b->>'source_groups_body')::jsonb) g;
 pair_count:=jsonb_array_length(receipts)::bigint*jsonb_array_length(catalog)::bigint;
 IF pair_count NOT BETWEEN 1 AND 100000 OR jsonb_array_length(review->'batches')<>(pair_count+19)/20 THEN RETURN false;END IF;
 expected_manifest:=jsonb_build_object('contract_version','signal-topic-interest-review-manifest-v1','workspace_id',target_workspace,
  'taxonomy_profile_id',manifest->'taxonomy_profile_id','screening_plan_digest',plan->'plan_digest',
  'source_context_digest',plan->'source_context_digest','editorial_context_digest',plan->'editorial_context_digest',
  'interests',catalog,'groups',receipts,'expected_pair_count',pair_count,'coverage','complete_group_interest_matrix',
  'approval_policy','none','membership_effect','none','evidence_scope','representative_group_evidence');
 IF manifest IS DISTINCT FROM expected_manifest OR review->>'input_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(manifest) THEN RETURN false;END IF;
 context:=((plan->'batches'->0->>'request_body')::jsonb->'messages'->0->>'content')::jsonb->'context';
 IF context IS NULL OR signal_topic_editorial_digest_json_v1(context) IS DISTINCT FROM plan->>'editorial_context_digest' THEN RETURN false;END IF;
 FOR batch IN SELECT value FROM jsonb_array_elements(review->'batches') LOOP
  IF batch-ARRAY['batch_index','input_digest','pairs','request_body','request_digest']<>'{}'::jsonb
   OR batch->>'batch_index' IS DISTINCT FROM batch_index::text OR batch->>'input_digest' IS DISTINCT FROM review->>'input_digest'
   OR jsonb_typeof(batch->'request_body') IS DISTINCT FROM 'string' OR octet_length(batch->>'request_body') NOT BETWEEN 1 AND 1500000
   OR batch->>'request_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1(batch-'request_digest') THEN RETURN false;END IF;
  -- Complete group-major matrix, sliced by ordinal; no top-k or missing=unrelated.
  SELECT jsonb_agg(jsonb_build_object('group_key',g->'group_key','group_digest',g->'group_digest',
    'dossier_digest',g->'dossier_digest','term_key',i->'term_key',
    'definition_revision',i->'definition_revision','definition_digest',i->'definition_digest') ORDER BY pair_position)
   INTO expected_pairs FROM generate_series(batch_index::bigint*20,least(pair_count-1,batch_index::bigint*20+19)) positions(pair_position)
   CROSS JOIN LATERAL(SELECT receipts->(pair_position/jsonb_array_length(catalog))::integer g,
    catalog->(pair_position%jsonb_array_length(catalog))::integer i) members;
  IF batch->'pairs' IS DISTINCT FROM expected_pairs THEN RETURN false;END IF;
  SELECT jsonb_agg(groups->((batch_index::bigint*20+keys.first_position-1)/jsonb_array_length(catalog))::integer ORDER BY keys.first_position) INTO batch_groups FROM
   (SELECT value->>'group_key' key,min(ordinality) first_position FROM jsonb_array_elements(expected_pairs) WITH ORDINALITY GROUP BY value->>'group_key') keys;
  SELECT jsonb_agg(catalog->((batch_index::bigint*20+keys.first_position-1)%jsonb_array_length(catalog))::integer ORDER BY keys.first_position) INTO batch_interests FROM
   (SELECT value->>'term_key' key,min(ordinality) first_position FROM jsonb_array_elements(expected_pairs) WITH ORDINALITY GROUP BY value->>'term_key') keys;
  expected_payload:=jsonb_build_object('contract_version','signal-topic-interest-review-request-v1','workspace_id',target_workspace,
   'taxonomy_profile_id',manifest->'taxonomy_profile_id','input_digest',review->'input_digest','batch_index',batch_index,
   'screening_plan_digest',manifest->'screening_plan_digest','coverage','complete_group_interest_matrix','approval_policy','none',
   'membership_effect','none','evidence_scope','representative_group_evidence','context',context,'interests',batch_interests,'groups',batch_groups,'pairs',expected_pairs);
  wire:=(batch->>'request_body')::jsonb;payload:=(wire->'messages'->0->>'content')::jsonb;
  IF payload IS DISTINCT FROM expected_payload OR jsonb_typeof(wire->'system') IS DISTINCT FROM 'string'
   OR signal_topic_editorial_digest_json_v1(wire->'system') IS DISTINCT FROM configuration->>'prompt_digest'
   OR signal_topic_editorial_digest_json_v1(wire->'output_config'->'format'->'schema') IS DISTINCT FROM configuration->>'schema_digest'
   OR wire IS DISTINCT FROM jsonb_build_object('model','claude-sonnet-4-6','max_tokens',8192,'stream',false,
    'thinking',jsonb_build_object('type','disabled'),'system',wire->'system',
    'output_config',jsonb_build_object('effort','high','format',jsonb_build_object('type','json_schema','schema',wire->'output_config'->'format'->'schema')),
    'messages',jsonb_build_array(jsonb_build_object('role','user','content',wire->'messages'->0->>'content'))) THEN RETURN false;END IF;
  batch_index:=batch_index+1;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END;$$;

-- Read authority mirrors resolveSignalWorkspaceCapabilitiesV1.can_view, not paid admission.
CREATE FUNCTION signal_topic_interest_review_can_read_v1(target_workspace uuid,target_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_workspaces w JOIN brands b ON b.id=w.brand_id JOIN users u ON u.id=target_actor
  WHERE w.id=target_workspace AND w.status='active' AND b.status='active' AND u.status='active'
   AND ((u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','analyst','founder','admin','kam','insights_manager','ux_data_specialist'))
    OR (u.user_type='client' AND u.organization_id=w.organization_id
     AND u.primary_role IN('client_admin','brand_manager','client_owner','client_viewer','agency_insights')
     AND EXISTS(SELECT 1 FROM user_brand_access a WHERE a.user_id=u.id AND a.brand_id=b.id
      AND a.revoked_at IS NULL AND a.access_level IN('read','comment','admin'))))),false)
$$;

CREATE TABLE signal_topic_interest_review_preparations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 numeric_run_id uuid NOT NULL REFERENCES signal_topic_consolidation_runs(id) ON DELETE RESTRICT,
 taxonomy_profile_id uuid NOT NULL REFERENCES signal_taxonomy_profiles(id) ON DELETE RESTRICT,
 source_binding jsonb NOT NULL CHECK(jsonb_typeof(source_binding)='object'),
 review jsonb NOT NULL CHECK(jsonb_typeof(review)='object' AND octet_length(signal_topic_editorial_canonical_json_v1(review))<=32000000),
 input_digest text NOT NULL CHECK(input_digest~'^sha256:[a-f0-9]{64}$'),
 review_digest text NOT NULL CHECK(review_digest~'^sha256:[a-f0-9]{64}$'),
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,actor_user_id,idempotency_key)
);
ALTER TABLE signal_topic_interest_review_preparations ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION signal_topic_interest_review_preparation_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'topic_interest_review_history_retained' USING ERRCODE='55000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||NEW.workspace_id::text||':topic',0));
 PERFORM u.id FROM users u JOIN signal_workspaces w ON w.id=NEW.workspace_id JOIN brands b ON b.id=w.brand_id
  WHERE u.id=NEW.actor_user_id FOR SHARE OF u,w,b;
 PERFORM a.id FROM user_brand_access a JOIN signal_workspaces w ON w.brand_id=a.brand_id
  WHERE w.id=NEW.workspace_id AND a.user_id=NEW.actor_user_id AND a.revoked_at IS NULL ORDER BY a.id FOR SHARE OF a;
 IF NOT signal_topic_interest_review_can_read_v1(NEW.workspace_id,NEW.actor_user_id) THEN RAISE EXCEPTION 'topic_interest_review_forbidden' USING ERRCODE='42501';END IF;
 source:=signal_topic_editorial_source_v1(NEW.numeric_run_id);
 IF source IS NULL OR source->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text OR source IS DISTINCT FROM NEW.source_binding
  THEN RAISE EXCEPTION 'topic_interest_review_source_stale' USING ERRCODE='23514';END IF;
 IF NOT signal_topic_interest_review_plan_valid_v1(NEW.workspace_id,NEW.numeric_run_id,NEW.review)
  OR NEW.review_digest IS DISTINCT FROM NEW.review->>'review_digest' OR NEW.input_digest IS DISTINCT FROM NEW.review->>'input_digest'
  OR NEW.taxonomy_profile_id::text IS DISTINCT FROM NEW.review->'manifest'->>'taxonomy_profile_id'
  OR NEW.request_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1(jsonb_build_object('workspace_id',NEW.workspace_id,
   'actor_user_id',NEW.actor_user_id,'numeric_run_id',NEW.numeric_run_id,'review_digest',NEW.review_digest))
  THEN RAISE EXCEPTION 'topic_interest_review_plan_invalid' USING ERRCODE='23514';END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END;$$;
CREATE TRIGGER topic_interest_review_preparation_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_interest_review_preparations
 FOR EACH ROW EXECUTE FUNCTION signal_topic_interest_review_preparation_guard_v1();

CREATE FUNCTION prepare_signal_topic_interest_review_v1(target_workspace uuid,target_actor uuid,target_run uuid,review jsonb,request_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE saved signal_topic_interest_review_preparations%ROWTYPE;source jsonb;hash text;replayed boolean;
BEGIN
 IF NOT COALESCE(request_key~'^[A-Za-z0-9._:-]{8,200}$',false) THEN RAISE EXCEPTION 'topic_interest_review_request_invalid' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||target_workspace::text||':topic',0));
 IF NOT signal_topic_interest_review_can_read_v1(target_workspace,target_actor) THEN RAISE EXCEPTION 'topic_interest_review_forbidden' USING ERRCODE='42501';END IF;
 hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('workspace_id',target_workspace,'actor_user_id',target_actor,
  'numeric_run_id',target_run,'review_digest',review->>'review_digest'));
 SELECT * INTO saved FROM signal_topic_interest_review_preparations WHERE workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key;
 replayed:=saved.id IS NOT NULL;
 IF replayed AND (saved.request_digest IS DISTINCT FROM hash OR saved.review IS DISTINCT FROM review) THEN
  RAISE EXCEPTION 'processing_idempotency_conflict' USING ERRCODE='23514';END IF;
 source:=signal_topic_editorial_source_v1(target_run);
 IF source IS NULL OR source->>'workspace_id' IS DISTINCT FROM target_workspace::text
  OR replayed AND source IS DISTINCT FROM saved.source_binding THEN RAISE EXCEPTION 'topic_interest_review_source_stale' USING ERRCODE='23514';END IF;
 IF replayed THEN
  IF NOT signal_topic_interest_review_plan_valid_v1(target_workspace,target_run,review) THEN RAISE EXCEPTION 'topic_interest_review_catalog_stale' USING ERRCODE='23514';END IF;
 ELSE
  INSERT INTO signal_topic_interest_review_preparations(workspace_id,actor_user_id,numeric_run_id,taxonomy_profile_id,source_binding,review,input_digest,review_digest,idempotency_key,request_digest)
   VALUES(target_workspace,target_actor,target_run,(review->'manifest'->>'taxonomy_profile_id')::uuid,source,review,review->>'input_digest',review->>'review_digest',request_key,hash) RETURNING * INTO saved;
 END IF;
 RETURN jsonb_build_object('preparation_id',saved.id,'workspace_id',saved.workspace_id,'numeric_run_id',saved.numeric_run_id,
  'review_digest',saved.review_digest,'input_digest',saved.input_digest,'replayed',replayed,'provider_execution_enabled',false);
END;$$;

CREATE FUNCTION load_signal_topic_interest_review_preparation_v1(target_workspace uuid,target_actor uuid,target_preparation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE saved signal_topic_interest_review_preparations%ROWTYPE;source jsonb;
BEGIN
 IF NOT signal_topic_interest_review_can_read_v1(target_workspace,target_actor) THEN RAISE EXCEPTION 'topic_interest_review_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM signal_topic_interest_review_preparations WHERE id=target_preparation AND workspace_id=target_workspace;
 IF saved.id IS NULL THEN RAISE EXCEPTION 'topic_interest_review_preparation_missing' USING ERRCODE='P0002';END IF;
 source:=signal_topic_editorial_source_v1(saved.numeric_run_id);
 IF source IS NULL OR source IS DISTINCT FROM saved.source_binding THEN RAISE EXCEPTION 'topic_interest_review_source_stale' USING ERRCODE='23514';END IF;
 IF NOT signal_topic_interest_review_plan_valid_v1(target_workspace,saved.numeric_run_id,saved.review) THEN RAISE EXCEPTION 'topic_interest_review_catalog_stale' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('preparation_id',saved.id,'workspace_id',saved.workspace_id,'numeric_run_id',saved.numeric_run_id,
  'review_digest',saved.review_digest,'input_digest',saved.input_digest,'review',saved.review,'provider_execution_enabled',false);
END;$$;

-- No grants, policies, paid admissions, requests, calls, outbox or provider dispatch.
REVOKE ALL ON TABLE signal_topic_interest_review_preparations FROM PUBLIC;
DO $$
DECLARE member record;role_name text;
BEGIN
 FOR member IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'signal_topic_interest_review_%'
   OR p.proname IN('prepare_signal_topic_interest_review_v1','load_signal_topic_interest_review_preparation_v1')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',member.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',member.signature,role_name);END IF;
  END LOOP;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE signal_topic_interest_review_preparations FROM %I',role_name);END IF;
 END LOOP;
END;$$;
