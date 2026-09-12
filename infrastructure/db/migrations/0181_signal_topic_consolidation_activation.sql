-- A pending consolidation is not a serving generation. Activation and rollback
-- change a separate, explicit binding; no historical classifier DTO is forged.
CREATE TABLE signal_topic_consolidation_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 revision_id uuid NOT NULL,consolidation_run_id uuid NOT NULL,revision_digest text NOT NULL,
 source_engine_execution_id uuid NOT NULL,preparation_run_id uuid NOT NULL,input_revision bigint NOT NULL,
 source_binding jsonb NOT NULL,source_digest text NOT NULL,catalog jsonb NOT NULL,
 denominator bigint NOT NULL CHECK(denominator>0),snapshot_digest text NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,revision_id),UNIQUE(id,workspace_id),
 FOREIGN KEY(revision_id,consolidation_run_id,workspace_id) REFERENCES signal_topic_consolidation_revisions(id,consolidation_run_id,workspace_id),
 CHECK(revision_digest~'^sha256:[a-f0-9]{64}$' AND source_digest~'^sha256:[a-f0-9]{64}$' AND snapshot_digest~'^sha256:[a-f0-9]{64}$'),
 CHECK(jsonb_typeof(catalog)='array' AND jsonb_array_length(catalog) BETWEEN 1 AND 120)
);
CREATE TABLE signal_topic_consolidation_bindings (
 workspace_id uuid PRIMARY KEY REFERENCES signal_workspaces(id),snapshot_id uuid,
 legacy_generation_id uuid REFERENCES signal_classification_generations(id),binding_revision bigint NOT NULL CHECK(binding_revision>0),
 selection_revision bigint NOT NULL CHECK(selection_revision>=0),selection jsonb NOT NULL CHECK(jsonb_typeof(selection)='object'),
 operation_id uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(snapshot_id,workspace_id) REFERENCES signal_topic_consolidation_snapshots(id,workspace_id),
 CHECK(snapshot_id IS NULL OR legacy_generation_id IS NULL)
);
CREATE TABLE signal_topic_consolidation_activation_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),idempotency_key text NOT NULL,request_digest text NOT NULL,
 action text NOT NULL CHECK(action IN('activate','rollback','select')),command jsonb NOT NULL,previous_binding jsonb NOT NULL,result_binding jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workspace_id,idempotency_key),
 CHECK(request_digest~'^sha256:[a-f0-9]{64}$'),
 CHECK(jsonb_typeof(command)='object' AND command->>'action'=action)
);

CREATE FUNCTION signal_topic_consolidation_activation_history_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'topic_consolidation_activation_history_retained' USING ERRCODE='55000';END;$$;
CREATE TRIGGER consolidation_snapshot_history BEFORE UPDATE OR DELETE ON signal_topic_consolidation_snapshots
 FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_activation_history_v1();
CREATE TRIGGER consolidation_activation_history BEFORE UPDATE OR DELETE ON signal_topic_consolidation_activation_operations
 FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_activation_history_v1();

CREATE FUNCTION signal_topic_consolidation_snapshot_current_v1(target_snapshot uuid) RETURNS boolean LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT s.source_binding=signal_topic_editorial_source_v1(s.consolidation_run_id)
  AND r.revision_digest=s.revision_digest AND r.status IN('validated','superseded')
  AND state.input_revision=s.input_revision
  FROM signal_topic_consolidation_snapshots s JOIN signal_topic_consolidation_revisions r ON r.id=s.revision_id
  JOIN signal_corpus_preparation_input_state state ON state.workspace_id=s.workspace_id WHERE s.id=target_snapshot),false)
$$;

CREATE FUNCTION prepare_signal_topic_consolidation_snapshot_v1(target_workspace uuid,target_actor uuid,target_revision uuid,expected_digest text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_topic_consolidation_revisions%ROWTYPE;s signal_topic_consolidation_snapshots%ROWTYPE;
 engine signal_topic_catalog_executions%ROWTYPE;source jsonb;catalog jsonb;denominator bigint;seal text;stamp text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||target_workspace::text||':topic',0));
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 SELECT * INTO r FROM signal_topic_consolidation_revisions WHERE id=target_revision AND workspace_id=target_workspace FOR SHARE;
 IF r.id IS NULL OR r.revision_digest IS DISTINCT FROM expected_digest OR r.status<>'validated' THEN
  RAISE EXCEPTION 'topic_consolidation_activation_revision_conflict' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM signal_topic_consolidation_snapshots WHERE workspace_id=target_workspace AND revision_id=r.id;
 IF s.id IS NOT NULL THEN RETURN jsonb_build_object('snapshot_id',s.id,'snapshot_digest',s.snapshot_digest,'denominator',s.denominator,'replayed',true,'activation','pending');END IF;
 source:=signal_topic_editorial_source_v1(r.consolidation_run_id);
 IF source IS NULL OR NOT COALESCE((validate_signal_topic_consolidation_revision_v1(r.id)->>'complete')::boolean,false) THEN
  RAISE EXCEPTION 'topic_consolidation_activation_source_stale' USING ERRCODE='23514';END IF;
 SELECT * INTO engine FROM signal_topic_catalog_executions WHERE id=r.source_engine_execution_id AND workspace_id=target_workspace;
 IF engine.id IS NULL OR engine.preparation_run_id IS NULL THEN RAISE EXCEPTION 'topic_consolidation_activation_source_stale' USING ERRCODE='23514';END IF;
 SELECT count(*) INTO denominator FROM signal_corpus_preparation_items WHERE workspace_id=target_workspace AND run_id=engine.preparation_run_id AND disposition='eligible';
 IF denominator<1 OR EXISTS(SELECT 1 FROM signal_topic_atomic_group_roots root WHERE root.consolidation_run_id=r.consolidation_run_id
  AND NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_items p WHERE p.workspace_id=target_workspace AND p.run_id=engine.preparation_run_id
    AND p.disposition='eligible' AND p.root_id=root.canonical_root_id)) THEN
  RAISE EXCEPTION 'topic_consolidation_activation_roots_invalid' USING ERRCODE='23514';END IF;
 stamp:=to_char(r.validated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 WITH concepts AS (
  SELECT c.*,signal_topic_editorial_digest_json_v1(jsonb_build_object('contract_version','signal-topic-successor-semantic-identity-v1',
   'source_context_digest',source->>'context_digest','kind',c.kind,'definition',c.definition,'locale',c.locale,
   'groups',(SELECT jsonb_agg(jsonb_build_object('group_key',g.group_key,'group_digest',g.group_digest) ORDER BY g.group_key COLLATE "C")
     FROM signal_topic_consolidation_decisions d JOIN signal_topic_atomic_groups g ON g.id=d.atomic_group_id WHERE d.revision_id=r.id AND d.concept_id=c.id))) identity
  FROM signal_topic_editorial_concepts c WHERE c.revision_id=r.id AND c.kind IN('topic','narrative')
 ) SELECT jsonb_agg(jsonb_build_object('concept_key',concept_key,'concept_id',id,'kind',kind,'locale',locale,
  'semantic_identity_digest',identity,'term_key','consolidated_'||substr(identity,8),
  'label',label,'definition',definition,'definition_digest',identity,'definition_revision',1,
  'created_at',stamp,'updated_at',stamp) ORDER BY COALESCE((metadata->>'priority_rank')::integer,120),concept_key COLLATE "C") INTO catalog FROM concepts;
 IF catalog IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(catalog) c WHERE length(c->>'label') NOT BETWEEN 1 AND 160 OR length(c->>'definition') NOT BETWEEN 1 AND 1500)
  OR (SELECT count(DISTINCT value->>'term_key') FROM jsonb_array_elements(catalog))<>jsonb_array_length(catalog) THEN
  RAISE EXCEPTION 'topic_consolidation_activation_catalog_invalid' USING ERRCODE='23514';END IF;
 seal:=signal_topic_editorial_digest_json_v1(jsonb_build_object('revision_id',r.id,'revision_digest',r.revision_digest,
  'source_binding',source,'catalog',catalog,'denominator',denominator));
 INSERT INTO signal_topic_consolidation_snapshots(workspace_id,revision_id,consolidation_run_id,revision_digest,source_engine_execution_id,
  preparation_run_id,input_revision,source_binding,source_digest,catalog,denominator,snapshot_digest,created_by_user_id)
 VALUES(target_workspace,r.id,r.consolidation_run_id,r.revision_digest,r.source_engine_execution_id,engine.preparation_run_id,engine.input_revision,
  source,signal_topic_editorial_digest_json_v1(source),catalog,denominator,seal,target_actor) RETURNING * INTO s;
 RETURN jsonb_build_object('snapshot_id',s.id,'snapshot_digest',s.snapshot_digest,'denominator',s.denominator,'replayed',false,'activation','pending');
END;$$;

-- Canonical binding read, including an explicit pin after rollback to the prior
-- legacy generation. An absent row retains historical latest-ready behavior.
CREATE FUNCTION signal_topic_consolidation_binding_v1(target_workspace uuid) RETURNS jsonb LANGUAGE sql STABLE
 SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT jsonb_build_object('snapshot_id',b.snapshot_id,'legacy_generation_id',b.legacy_generation_id,
  'binding_revision',b.binding_revision,'selection_revision',CASE WHEN b.snapshot_id IS NULL THEN (w.topic_signal_selection->>'revision')::bigint ELSE b.selection_revision END,
  'selection',CASE WHEN b.snapshot_id IS NULL THEN w.topic_signal_selection->'items' ELSE b.selection END,'operation_id',b.operation_id)
  FROM signal_topic_consolidation_bindings b JOIN signal_workspaces w ON w.id=b.workspace_id WHERE b.workspace_id=target_workspace),
  (SELECT jsonb_build_object('snapshot_id',NULL,'legacy_generation_id',signal_workspace_selection_serving_generation_v1(w.id),
    'binding_revision',0,'selection_revision',(w.topic_signal_selection->>'revision')::bigint,'selection',w.topic_signal_selection->'items','operation_id',NULL)
   FROM signal_workspaces w WHERE w.id=target_workspace))
$$;

CREATE FUNCTION mutate_signal_topic_consolidation_binding_v1(target_workspace uuid,target_actor uuid,request_key text,payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE previous jsonb;next jsonb;prior signal_topic_consolidation_activation_operations%ROWTYPE;
 s signal_topic_consolidation_snapshots%ROWTYPE;restore signal_topic_consolidation_activation_operations%ROWTYPE;
 hash text;operation uuid:=gen_random_uuid();selected jsonb;requested_action text:=payload->>'action';chosen_concept jsonb;
BEGIN
 IF request_key IS NULL OR request_key!~'^[A-Za-z0-9._:-]{8,200}$' OR NOT COALESCE(requested_action IN('activate','rollback','select'),false) THEN
  RAISE EXCEPTION 'topic_consolidation_activation_request_invalid' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||target_workspace::text||':topic',0));
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 PERFORM 1 FROM signal_workspaces WHERE id=target_workspace FOR UPDATE;
 hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('actor',target_actor,'command',payload));
 SELECT * INTO prior FROM signal_topic_consolidation_activation_operations WHERE workspace_id=target_workspace AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  IF prior.actor_user_id IS DISTINCT FROM target_actor OR prior.request_digest IS DISTINCT FROM hash THEN RAISE EXCEPTION 'topic_consolidation_activation_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('operation_id',prior.id,'binding',prior.result_binding,'replayed',true);END IF;
 previous:=signal_topic_consolidation_binding_v1(target_workspace);
 IF previous IS NULL OR payload->'expected_binding_revision' IS DISTINCT FROM previous->'binding_revision'
  OR payload->'expected_selection_revision' IS DISTINCT FROM previous->'selection_revision'
  OR payload->'expected_snapshot_id' IS DISTINCT FROM previous->'snapshot_id'
  OR payload->'expected_legacy_generation_id' IS DISTINCT FROM previous->'legacy_generation_id' THEN
  RAISE EXCEPTION 'topic_consolidation_activation_conflict' USING ERRCODE='23514';END IF;
 IF requested_action='activate' THEN
  SELECT * INTO s FROM signal_topic_consolidation_snapshots WHERE id=(payload->>'snapshot_id')::uuid AND workspace_id=target_workspace;
  IF s.id IS NULL OR s.snapshot_digest IS DISTINCT FROM payload->>'snapshot_digest'
   OR s.revision_digest IS DISTINCT FROM payload->>'revision_digest'
   OR NOT signal_topic_consolidation_snapshot_current_v1(s.id)
   OR NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_revisions WHERE id=s.revision_id AND status='validated') THEN
   RAISE EXCEPTION 'topic_consolidation_activation_source_stale' USING ERRCODE='23514';END IF;
  IF jsonb_typeof(payload->'selected_concept_keys') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(payload->'selected_concept_keys') key WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.catalog) c WHERE c->>'concept_key'=key))
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(payload->'selected_concept_keys'))<>jsonb_array_length(payload->'selected_concept_keys') THEN
   RAISE EXCEPTION 'topic_consolidation_activation_selection_invalid' USING ERRCODE='23514';END IF;
  SELECT COALESCE(jsonb_object_agg(c->>'term_key',jsonb_build_object('selected',
    payload->'selected_concept_keys' ? (c->>'concept_key'),
    'definition_digest',c->>'definition_digest','definition_revision',1,'generation_id',s.id,
    'semantic_identity_digest',c->>'semantic_identity_digest','source_engine_execution_id',s.source_engine_execution_id,
    'mapping_digest',s.snapshot_digest,'selected_by_user_id',target_actor,'selected_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'{}') INTO selected FROM jsonb_array_elements(s.catalog) c;
  next:=jsonb_build_object('snapshot_id',s.id,'legacy_generation_id',NULL,'selection',selected);
 ELSIF requested_action='rollback' THEN
  SELECT * INTO restore FROM signal_topic_consolidation_activation_operations WHERE id=(payload->>'activation_operation_id')::uuid AND workspace_id=target_workspace AND action='activate';
  IF restore.id IS NULL OR previous->>'snapshot_id' IS DISTINCT FROM restore.result_binding->>'snapshot_id' THEN
   RAISE EXCEPTION 'topic_consolidation_activation_rollback_conflict' USING ERRCODE='23514';END IF;
  IF restore.previous_binding->>'snapshot_id' IS NOT NULL AND NOT signal_topic_consolidation_snapshot_current_v1((restore.previous_binding->>'snapshot_id')::uuid) THEN
   RAISE EXCEPTION 'topic_consolidation_activation_source_stale' USING ERRCODE='23514';END IF;
  IF restore.previous_binding->>'legacy_generation_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_classification_generations g
   WHERE g.id=(restore.previous_binding->>'legacy_generation_id')::uuid AND g.workspace_id=target_workspace AND g.status='ready'
    AND signal_workspace_projection_source_current_v1(g)) THEN RAISE EXCEPTION 'topic_consolidation_activation_source_stale' USING ERRCODE='23514';END IF;
  next:=restore.previous_binding;
 ELSE
  SELECT * INTO s FROM signal_topic_consolidation_snapshots WHERE id=(previous->>'snapshot_id')::uuid AND workspace_id=target_workspace;
  IF s.id IS NULL OR NOT signal_topic_consolidation_snapshot_current_v1(s.id) THEN RAISE EXCEPTION 'topic_consolidation_activation_source_stale' USING ERRCODE='23514';END IF;
  SELECT value INTO chosen_concept FROM jsonb_array_elements(s.catalog) WHERE value->>'term_key'=payload->>'term_key';
  IF chosen_concept IS NULL OR chosen_concept->>'definition_digest' IS DISTINCT FROM payload->>'definition_digest' OR jsonb_typeof(payload->'selected') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'topic_consolidation_activation_selection_invalid' USING ERRCODE='23514';END IF;
  next:=previous||jsonb_build_object('selection',jsonb_set(previous->'selection',ARRAY[chosen_concept->>'term_key'],
   (previous->'selection'->(chosen_concept->>'term_key'))||jsonb_build_object('selected',payload->'selected','selected_by_user_id',target_actor,
    'selected_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
 END IF;
 next:=next||jsonb_build_object('binding_revision',(previous->>'binding_revision')::bigint+1,
  'selection_revision',(previous->>'selection_revision')::bigint+1,'operation_id',operation);
 INSERT INTO signal_topic_consolidation_activation_operations(id,workspace_id,actor_user_id,idempotency_key,request_digest,action,command,previous_binding,result_binding)
 VALUES(operation,target_workspace,target_actor,request_key,hash,requested_action,payload,previous,next);
 INSERT INTO signal_topic_consolidation_bindings(workspace_id,snapshot_id,legacy_generation_id,binding_revision,selection_revision,selection,operation_id)
 VALUES(target_workspace,(next->>'snapshot_id')::uuid,(next->>'legacy_generation_id')::uuid,(next->>'binding_revision')::bigint,(next->>'selection_revision')::bigint,next->'selection',operation)
 ON CONFLICT(workspace_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,legacy_generation_id=excluded.legacy_generation_id,
  binding_revision=excluded.binding_revision,selection_revision=excluded.selection_revision,selection=excluded.selection,operation_id=excluded.operation_id,updated_at=clock_timestamp();
 RETURN jsonb_build_object('operation_id',operation,'binding',next,'replayed',false);
END;$$;

CREATE FUNCTION signal_topic_consolidation_binding_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE receipt signal_topic_consolidation_activation_operations%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_consolidation_activation_history_retained' USING ERRCODE='55000';END IF;
 SELECT * INTO receipt FROM signal_topic_consolidation_activation_operations WHERE id=NEW.operation_id AND workspace_id=NEW.workspace_id;
 IF receipt.id IS NULL OR ROW(NEW.snapshot_id,NEW.legacy_generation_id,NEW.binding_revision,NEW.selection_revision,NEW.selection)
   IS DISTINCT FROM ROW((receipt.result_binding->>'snapshot_id')::uuid,(receipt.result_binding->>'legacy_generation_id')::uuid,
    (receipt.result_binding->>'binding_revision')::bigint,(receipt.result_binding->>'selection_revision')::bigint,receipt.result_binding->'selection')
  OR TG_OP='UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.binding_revision<>OLD.binding_revision+1
    OR receipt.previous_binding->>'operation_id' IS DISTINCT FROM OLD.operation_id::text) THEN
  RAISE EXCEPTION 'topic_consolidation_activation_binding_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER consolidation_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_consolidation_bindings
 FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_binding_guard_v1();
CREATE FUNCTION signal_topic_consolidation_legacy_selection_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.topic_signal_selection IS DISTINCT FROM OLD.topic_signal_selection AND EXISTS(
  SELECT 1 FROM signal_topic_consolidation_bindings WHERE workspace_id=NEW.id AND snapshot_id IS NOT NULL) THEN
  RAISE EXCEPTION 'topic_consolidation_activation_selection_required' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER consolidation_legacy_selection_guard BEFORE UPDATE OF topic_signal_selection ON signal_workspaces
 FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_legacy_selection_guard_v1();

-- Views retain all eligible roots, including roots in no discovered group. A
-- root in both Noise and a relevant group is assigned, never globally excluded.
CREATE VIEW signal_topic_consolidation_snapshot_roots_v1 WITH(security_invoker=true) AS
 SELECT s.id snapshot_id,s.workspace_id,p.root_id,
  CASE WHEN bool_or(d.disposition IN('topic','narrative')) THEN 'resolved'
    WHEN bool_or(d.disposition='unresolved') THEN 'unresolved'
    WHEN bool_or(d.disposition='noise') THEN 'noise' ELSE 'abstained' END resolution_state,
  COALESCE(bool_or(d.disposition='unresolved'),false) has_unresolved_topics
 FROM signal_topic_consolidation_snapshots s JOIN signal_corpus_preparation_items p ON p.workspace_id=s.workspace_id AND p.run_id=s.preparation_run_id AND p.disposition='eligible'
 LEFT JOIN signal_topic_atomic_group_roots root ON root.consolidation_run_id=s.consolidation_run_id AND root.canonical_root_id=p.root_id
 LEFT JOIN signal_topic_consolidation_decisions d ON d.revision_id=s.revision_id AND d.atomic_group_id=root.atomic_group_id
 GROUP BY s.id,s.workspace_id,p.root_id;
CREATE VIEW signal_topic_consolidation_snapshot_memberships_v1 WITH(security_invoker=true) AS
 SELECT DISTINCT s.id snapshot_id,s.workspace_id,root.canonical_root_id root_id,c->>'term_key' term_key,c->>'definition_digest' definition_digest
 FROM signal_topic_consolidation_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.catalog) c
 JOIN signal_topic_consolidation_decisions d ON d.revision_id=s.revision_id AND d.concept_id=(c->>'concept_id')::uuid
 JOIN signal_topic_atomic_group_roots root ON root.atomic_group_id=d.atomic_group_id;

DO $$ DECLARE item record;role_name text; BEGIN
 FOR item IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'signal_topic_consolidation_%activation%' OR p.proname IN(
  'signal_topic_consolidation_binding_guard_v1','signal_topic_consolidation_legacy_selection_guard_v1','signal_topic_consolidation_snapshot_current_v1','prepare_signal_topic_consolidation_snapshot_v1','signal_topic_consolidation_binding_v1','mutate_signal_topic_consolidation_binding_v1')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',item.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',item.signature,role_name);END IF;END LOOP;
 END LOOP;
 FOR item IN SELECT unnest(ARRAY['signal_topic_consolidation_snapshots','signal_topic_consolidation_bindings','signal_topic_consolidation_activation_operations','signal_topic_consolidation_snapshot_roots_v1','signal_topic_consolidation_snapshot_memberships_v1']) name LOOP
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item.name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',item.name,role_name);END IF;END LOOP;
 END LOOP;
END $$;

-- A complete provider-side 4xx is a durable, non-billable rejection. Keep its
-- exact receipt and settle it at zero so an unsupported schema cannot consume
-- the editorial cap or become an ambiguous paid outcome.
CREATE FUNCTION signal_topic_editorial_known_rejection_v1(body text,http_status integer,complete boolean)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT COALESCE(complete AND http_status BETWEEN 400 AND 499
  AND signal_topic_editorial_parse_json_v1(body)->>'type'='error'
  AND signal_topic_editorial_parse_json_v1(body)#>>'{error,type}' IS NOT NULL,false) $$;
CREATE FUNCTION signal_topic_editorial_known_rejection_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR NOT signal_topic_editorial_known_rejection_v1(NEW.response_body_private,NEW.response_http_status,NEW.response_complete)
  OR (to_jsonb(NEW)-ARRAY['status','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key',
    'response_output','response_http_status','response_complete','response_provider_request_id','error_code','response_at','settled_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','settled_micro_usd','observed_micro_usd','response_body_private','response_sha256','response_storage_key',
    'response_output','response_http_status','response_complete','response_provider_request_id','error_code','response_at','settled_at'])
  OR OLD.response_body_private IS NOT NULL AND ROW(NEW.response_body_private,NEW.response_sha256,NEW.response_storage_key,NEW.response_output,
    NEW.response_http_status,NEW.response_complete,NEW.response_provider_request_id)
    IS DISTINCT FROM ROW(OLD.response_body_private,OLD.response_sha256,OLD.response_storage_key,OLD.response_output,
    OLD.response_http_status,OLD.response_complete,OLD.response_provider_request_id)
  OR NEW.response_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.response_body_private)
  OR length(NEW.response_storage_key) NOT BETWEEN 1 AND 1024 OR NEW.observed_micro_usd IS DISTINCT FROM 0
  OR NOT(OLD.status IN('in_flight','outcome_unknown') AND NEW.status='response_persisted' AND NEW.settled_micro_usd IS NULL
    OR OLD.status IN('response_persisted','outcome_unknown') AND NEW.status='settled' AND NEW.settled_micro_usd=0 AND NEW.settled_at IS NOT NULL)
 THEN RAISE EXCEPTION 'topic_editorial_known_rejection_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER topic_editorial_call_guard ON signal_topic_editorial_calls;
CREATE TRIGGER topic_editorial_call_guard BEFORE INSERT OR UPDATE ON signal_topic_editorial_calls FOR EACH ROW
 WHEN(NOT signal_topic_editorial_known_rejection_v1(NEW.response_body_private,NEW.response_http_status,NEW.response_complete))
 EXECUTE FUNCTION signal_topic_editorial_call_guard_v1();
CREATE TRIGGER topic_editorial_known_rejection_guard BEFORE UPDATE ON signal_topic_editorial_calls FOR EACH ROW
 WHEN(signal_topic_editorial_known_rejection_v1(NEW.response_body_private,NEW.response_http_status,NEW.response_complete))
 EXECUTE FUNCTION signal_topic_editorial_known_rejection_guard_v1();

CREATE OR REPLACE FUNCTION persist_signal_topic_editorial_receipt_v1(target_call uuid,target_attempt uuid,target_request_digest text,
 body text,storage_key text,http_status integer,complete boolean,provider_request_id text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_topic_editorial_calls%ROWTYPE;request signal_topic_editorial_requests%ROWTYPE;parsed jsonb;output_text text;cost bigint;
BEGIN
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call;
 PERFORM signal_processing_lock_v1(c.organization_id,c.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=c.execution_id FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call FOR UPDATE;
 SELECT * INTO request FROM signal_topic_editorial_requests WHERE id=c.request_id;
 IF c.id IS NULL OR request.request_digest IS DISTINCT FROM target_request_digest OR http_status IS NULL OR http_status NOT BETWEEN 100 AND 599
  OR complete IS NULL OR provider_request_id IS NOT NULL AND provider_request_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
  OR body IS NULL OR octet_length(body)>8388608 OR storage_key IS NULL OR length(storage_key) NOT BETWEEN 1 AND 1024 THEN
  RAISE EXCEPTION 'topic_editorial_receipt_invalid' USING ERRCODE='23514';END IF;
 IF c.attempt_token IS DISTINCT FROM target_attempt OR c.status NOT IN('in_flight','outcome_unknown','response_persisted','settled') THEN
  RAISE EXCEPTION 'topic_editorial_response_attempt_invalid' USING ERRCODE='23514';END IF;
 IF c.response_body_private IS NOT NULL THEN
  IF c.response_body_private IS DISTINCT FROM body OR c.response_storage_key IS DISTINCT FROM storage_key
   OR c.response_http_status IS DISTINCT FROM http_status OR c.response_complete IS DISTINCT FROM complete
   OR c.response_provider_request_id IS DISTINCT FROM provider_request_id THEN
   RAISE EXCEPTION 'topic_editorial_response_immutable' USING ERRCODE='23514';END IF;
  IF c.status='outcome_unknown' AND signal_topic_editorial_known_rejection_v1(body,http_status,complete) THEN
   UPDATE signal_topic_editorial_calls SET status='response_persisted',observed_micro_usd=0,error_code=NULL WHERE id=c.id;
   RETURN jsonb_build_object('status','response_persisted','replayed',true);END IF;
  RETURN jsonb_build_object('status',c.status,'replayed',true);END IF;
 parsed:=signal_topic_editorial_parse_json_v1(body);
 IF jsonb_typeof(parsed->'content')='array' THEN
  SELECT string_agg(value->>'text','' ORDER BY ordinal) INTO output_text FROM jsonb_array_elements(parsed->'content') WITH ORDINALITY x(value,ordinal)
   WHERE value->>'type'='text';END IF;
 IF signal_topic_editorial_known_rejection_v1(body,http_status,complete) THEN cost:=0;
 ELSIF http_status=200 AND complete AND parsed->>'model'='claude-sonnet-4-6' AND parsed->'usage'->>'input_tokens'~'^[0-9]+$'
  AND parsed->'usage'->>'output_tokens'~'^[0-9]+$' AND COALESCE(parsed->'usage'->>'cache_creation_input_tokens','0')='0'
  AND COALESCE(parsed->'usage'->>'cache_read_input_tokens','0')='0' THEN
  cost:=(parsed->'usage'->>'input_tokens')::bigint*3+(parsed->'usage'->>'output_tokens')::bigint*15;END IF;
 UPDATE signal_topic_editorial_calls SET status='response_persisted',response_body_private=body,response_sha256=signal_semantic_context_digest_v1(body),
  response_storage_key=storage_key,response_http_status=http_status,response_complete=complete,response_provider_request_id=provider_request_id,
  response_output=signal_topic_editorial_parse_json_v1(output_text),observed_micro_usd=cost,response_at=clock_timestamp() WHERE id=c.id;
 RETURN jsonb_build_object('status','response_persisted','replayed',false);
END;$$;

CREATE OR REPLACE FUNCTION settle_signal_topic_editorial_call_v1(target_call uuid,target_attempt uuid) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_topic_editorial_calls%ROWTYPE;
BEGIN
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call;
 PERFORM signal_processing_lock_v1(c.organization_id,c.budget_date);
 PERFORM 1 FROM signal_topic_editorial_executions WHERE id=c.execution_id FOR UPDATE;
 SELECT * INTO c FROM signal_topic_editorial_calls WHERE id=target_call FOR UPDATE;
 IF c.attempt_token IS DISTINCT FROM target_attempt OR c.status NOT IN('response_persisted','outcome_unknown','settled') THEN
  RAISE EXCEPTION 'topic_editorial_settlement_attempt_invalid' USING ERRCODE='23514';END IF;
 IF c.status='settled' THEN RETURN jsonb_build_object('status',c.status,'settled_micro_usd',c.settled_micro_usd::text,'replayed',true);END IF;
 IF c.observed_micro_usd IS NULL AND signal_topic_editorial_known_rejection_v1(c.response_body_private,c.response_http_status,c.response_complete) THEN
  c.observed_micro_usd:=0;END IF;
 IF c.observed_micro_usd IS NULL OR c.observed_micro_usd>c.reserved_micro_usd THEN
  UPDATE signal_topic_editorial_calls SET status='outcome_unknown',error_code='topic_editorial_usage_unresolved' WHERE id=c.id;
  RETURN jsonb_build_object('status','outcome_unknown','replayed',false);END IF;
 UPDATE signal_topic_editorial_calls SET status='settled',observed_micro_usd=c.observed_micro_usd,settled_micro_usd=c.observed_micro_usd,
  settled_at=clock_timestamp(),error_code=CASE WHEN c.observed_micro_usd=0 THEN 'topic_editorial_provider_rejected' ELSE NULL END WHERE id=c.id;
 RETURN jsonb_build_object('status','settled','settled_micro_usd',c.observed_micro_usd::text,'replayed',false);
END;$$;

REVOKE ALL ON FUNCTION signal_topic_editorial_known_rejection_v1(text,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_editorial_known_rejection_guard_v1() FROM PUBLIC;
DO $$ DECLARE role_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_known_rejection_v1(text,integer,boolean) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_editorial_known_rejection_guard_v1() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
