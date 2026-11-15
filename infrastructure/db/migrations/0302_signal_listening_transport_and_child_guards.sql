-- Preserve every provider prefix; only complete, valid UTF8 HTTP200 may settle.
-- No provider, policy grant, money reset or historical receipt is created here.
CREATE FUNCTION signal_listening_discovery_transport_v1(raw_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
SET search_path=public,extensions,pg_temp AS $$
DECLARE v jsonb:='{}';shape jsonb;tokens text[]:='{}';sanitized text:='';part text[];entry record;k text;raw_value text;body_json text;
 prefix bytea;proof bytea;without_nul bytea;actual_valid boolean;status integer;complete boolean;seen text[]:='{}';
BEGIN
 IF octet_length(raw_text)>8388608 THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
 -- PG JSON traversal decodes every string, including an unrelated body NUL.
 -- Validate the original JSON grammar, then replace whole string tokens with
 -- positional aliases before traversing the shape. The untouched body token is
 -- decoded directly to bytea below; aliases never become provider data.
 PERFORM raw_text::json;
 FOR part IN SELECT regexp_matches(raw_text,$token$("(?:[^"\\]+|\\.)*")|([^"]+)$token$,'g') LOOP
  IF part[1] IS NOT NULL THEN tokens:=array_append(tokens,part[1]);sanitized:=sanitized||'"_t'||cardinality(tokens)::text||'"';
  ELSE sanitized:=sanitized||part[2];END IF;
 END LOOP;
 shape:=sanitized::jsonb;
 IF jsonb_typeof(shape)<>'object' THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
 FOR entry IN SELECT key,value FROM jsonb_each(shape) LOOP
  k:=(tokens[substring(entry.key FROM 3)::integer]::jsonb)#>>'{}';
  IF k=ANY(seen) THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;seen:=array_append(seen,k);
  IF jsonb_typeof(entry.value)='string' THEN raw_value:=tokens[substring(entry.value#>>'{}' FROM 3)::integer];ELSE raw_value:=entry.value::text;END IF;
  IF k='body' THEN
   IF json_typeof(raw_value::json)<>'string' THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
   body_json:=raw_value;v:=v||jsonb_build_object(k,'');
  ELSE v:=v||jsonb_build_object(k,raw_value::jsonb);END IF;
 END LOOP;
 IF jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'body') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'http_status') IS DISTINCT FROM 'number'
 OR(v->>'http_status')::numeric<>floor((v->>'http_status')::numeric) OR(v->>'http_status')::numeric NOT BETWEEN 100 AND 599 THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
 status:=(v->>'http_status')::numeric::integer;
 IF status NOT BETWEEN 100 AND 599 OR jsonb_typeof(v->'provider_request_id') NOT IN('string','null')
 OR length(v->>'provider_request_id')>200 THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
 IF v->'contract_version' IS NULL THEN
  IF v->'complete' IS NOT NULL AND jsonb_typeof(v->'complete')<>'boolean' THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
  RETURN jsonb_build_object('complete',COALESCE((v->>'complete')::boolean,true),'utf8_valid',true,'http_status',status,'versioned',false);
 END IF;
 IF v->>'contract_version' IS DISTINCT FROM 'listening-discovery-transport-v1' OR(SELECT count(*) FROM jsonb_each(v))<>8
 OR(SELECT count(DISTINCT key) FROM jsonb_each(v))<>8
 OR EXISTS(SELECT 1 FROM jsonb_each(v) WHERE key<>ALL(ARRAY['contract_version','body','body_base64','body_bytes','utf8_valid','complete','http_status','provider_request_id']))
 OR jsonb_typeof(v->'body_base64') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'body_bytes') IS DISTINCT FROM 'number'
 OR(v->>'body_bytes')::numeric<>floor((v->>'body_bytes')::numeric) OR(v->>'body_bytes')::numeric NOT BETWEEN 0 AND 1047552
 OR jsonb_typeof(v->'utf8_valid') IS DISTINCT FROM 'boolean' OR jsonb_typeof(v->'complete') IS DISTINCT FROM 'boolean'
 THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
 prefix:=decode(v->>'body_base64','base64');
 IF octet_length(prefix)<>(v->>'body_bytes')::numeric::integer OR replace(encode(prefix,'base64'),E'\n','') IS DISTINCT FROM v->>'body_base64' THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
 IF(v->>'utf8_valid')::boolean THEN
  -- Decode JSON string tokens to bytes without casting its NUL escapes to PG
  -- text. This also handles equivalent escapes and UTF16 surrogate pairs.
  SELECT COALESCE(string_agg(CASE WHEN m[1]=$zero$\u0000$zero$ THEN decode('00','hex') ELSE convert_to(('"'||m[1]||'"')::json#>>'{}','UTF8') END,''::bytea ORDER BY n),'\x'::bytea)
  INTO proof FROM regexp_matches(substring(body_json FROM 2 FOR length(body_json)-2),$re$\\u[dD][89aAbB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\["\\/bfnrt]|[^\\]+$re$,'g') WITH ORDINALITY AS parts(m,n);
  IF proof IS DISTINCT FROM prefix THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
  actual_valid:=true;
 ELSE
  IF body_json<>'""' THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
  -- NUL is valid UTF8 but not a PG-text byte; strip only actual zero bytes for
  -- the validity check, retaining the untouched binary prefix and raw wrapper.
  IF position(decode('00','hex') IN prefix)>0 THEN
   SELECT COALESCE(string_agg(substring(prefix FROM i+1 FOR 1),''::bytea) FILTER(WHERE get_byte(prefix,i)<>0),'\x'::bytea)
    INTO without_nul FROM generate_series(0,octet_length(prefix)-1) i;
  ELSE without_nul:=prefix;END IF;
  actual_valid:=true;BEGIN PERFORM convert_from(without_nul,'UTF8');EXCEPTION WHEN character_not_in_repertoire THEN actual_valid:=false;END;
  IF actual_valid THEN RAISE EXCEPTION 'listening_discovery_transport_invalid';END IF;
 END IF;
 complete:=(v->>'complete')::boolean;
 RETURN jsonb_build_object('complete',complete,'utf8_valid',actual_valid,'http_status',status,'body_bytes',octet_length(prefix),'versioned',true);
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range OR character_not_in_repertoire THEN
 RAISE EXCEPTION 'listening_discovery_transport_invalid';
END $$;
CREATE FUNCTION signal_listening_discovery_raw_transport_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 PERFORM signal_listening_discovery_transport_v1(NEW.raw_text);RETURN NEW;
END $$;
CREATE TRIGGER aaa_listening_discovery_raw_transport BEFORE INSERT ON signal_listening_discovery_raw_receipts FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_raw_transport_guard_v1();
CREATE FUNCTION signal_listening_discovery_call_transport_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE receipt signal_listening_discovery_raw_receipts;transport jsonb;valid boolean;
BEGIN
 IF NEW.workspace_contract IS DISTINCT FROM 'listening-discovery-round-v1' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND OLD.response_storage_key IS NOT NULL AND COALESCE((NEW.metadata->>'response_complete')::boolean,true) IS DISTINCT FROM COALESCE((OLD.metadata->>'response_complete')::boolean,true) THEN RAISE EXCEPTION 'listening_discovery_transport_immutable';END IF;
 IF NEW.response_storage_key IS NOT NULL THEN
  SELECT * INTO receipt FROM signal_listening_discovery_raw_receipts WHERE call_id=NEW.id AND verification_status='verified';
  IF receipt.call_id IS NULL THEN RAISE EXCEPTION 'listening_discovery_raw_required';END IF;
  transport:=signal_listening_discovery_transport_v1(receipt.raw_text);valid:=(transport->>'complete')::boolean AND(transport->>'utf8_valid')::boolean;
  IF COALESCE((NEW.metadata->>'response_complete')::boolean,true) IS DISTINCT FROM valid OR NEW.response_http_status IS DISTINCT FROM(transport->>'http_status')::integer
   OR NEW.call_state IN('response_persisted','settled') AND(NOT valid OR NEW.response_http_status<>200) THEN RAISE EXCEPTION 'listening_discovery_transport_incomplete';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER aab_00_listening_discovery_transport BEFORE INSERT OR UPDATE ON engine_cost_events FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_call_transport_guard_v1();
REVOKE ALL ON FUNCTION signal_listening_discovery_transport_v1(text),signal_listening_discovery_raw_transport_guard_v1(),signal_listening_discovery_call_transport_guard_v1() FROM PUBLIC;

-- Retain all existing owner, lease, monetary and request predicates.
CREATE OR REPLACE FUNCTION signal_listening_discovery_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_listening_discovery_rounds;p signal_listening_discovery_executions;a signal_processing_admissions;receipt signal_listening_discovery_raw_receipts;body jsonb;usage jsonb;expected bigint;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.workspace_contract='listening-discovery-round-v1' THEN RAISE EXCEPTION 'listening_discovery_money_immutable';END IF;RETURN OLD;END IF;
 IF NEW.workspace_contract IS DISTINCT FROM 'listening-discovery-round-v1' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND NEW.workspace_contract IS DISTINCT FROM OLD.workspace_contract THEN RAISE EXCEPTION 'listening_discovery_money_immutable';END IF;
 SELECT * INTO r FROM signal_listening_discovery_rounds WHERE id=NEW.listening_round_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO p FROM signal_listening_discovery_executions WHERE id=r.execution_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=r.admission_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||p.organization_id::text,0));
 PERFORM signal_processing_lock_v1(p.organization_id,a.budget_date);
 IF p.id IS NULL OR ROW(NEW.workspace_id,NEW.actor_user_id,NEW.request_digest,NEW.request_seal,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone)
 IS DISTINCT FROM ROW(r.workspace_id,p.actor_user_id,r.request_digest,r.request_sha256,r.reservation_micro_usd,a.budget_date,a.budget_timezone)
 OR NEW.call_configuration IS DISTINCT FROM signal_listening_discovery_review_configuration_v1() OR NEW.idempotency_key IS DISTINCT FROM 'listening-round:'||r.id::text THEN RAISE EXCEPTION 'listening_discovery_call_binding_invalid';END IF;
 IF TG_OP='INSERT' OR OLD.call_state='reserved' AND NEW.call_state='in_flight' THEN
 IF r.status<>'reviewing' OR r.execution_token IS NULL OR r.execution_expires_at<=clock_timestamp() OR NEW.metadata->>'lease_token' IS DISTINCT FROM r.execution_token::text
 OR p.status<>'active' OR NOT COALESCE(signal_listening_discovery_current_v1(r.input_generation_id),false) THEN RAISE EXCEPTION 'listening_discovery_send_authority_invalid';END IF;
 PERFORM signal_processing_capacity_v1(p.workspace_id,p.actor_user_id,r.id,r.admission_id,ARRAY['listening_discovery_review'],'anthropic','claude-sonnet-4-6',NEW.call_configuration,r.reservation_micro_usd,'listening_discovery',NEW.id,NEW.reserved_micro_usd,NEW.created_at);
 IF signal_listening_discovery_exposure_v1(p.id,'listening_discovery',NEW.id)+NEW.reserved_micro_usd>p.cap_micro_usd THEN RAISE EXCEPTION 'listening_discovery_parent_cap_exhausted';END IF;
 END IF;
 IF TG_OP='INSERT' THEN IF NEW.call_state<>'reserved' OR NEW.sent_at IS NOT NULL OR NEW.response_storage_key IS NOT NULL OR NEW.settled_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'listening_discovery_call_must_reserve';END IF;RETURN NEW;END IF;
 IF (to_jsonb(NEW)-ARRAY['call_state','sent_at','response_storage_key','response_sha256','response_size_bytes','response_http_status','provider_request_id','response_received_at','settled_micro_usd','settled_at','input_tokens','output_tokens','total_tokens','metadata']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['call_state','sent_at','response_storage_key','response_sha256','response_size_bytes','response_http_status','provider_request_id','response_received_at','settled_micro_usd','settled_at','input_tokens','output_tokens','total_tokens','metadata'])
 OR(NEW.metadata-'usage'-'error_code'-'response_complete' IS DISTINCT FROM OLD.metadata-'usage'-'error_code'-'response_complete' AND NOT(OLD.call_state='reserved' AND NEW.call_state='reserved' AND OLD.sent_at IS NULL AND NEW.metadata-'lease_token'=OLD.metadata-'lease_token' AND NEW.metadata->>'lease_token'=r.execution_token::text AND r.execution_expires_at>clock_timestamp()))
 OR OLD.call_state IN('settled','definitely_not_sent') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
 OR NOT(NEW.call_state=OLD.call_state OR OLD.call_state='reserved' AND NEW.call_state IN('in_flight','definitely_not_sent') OR OLD.call_state='in_flight' AND NEW.call_state IN('response_persisted','outcome_unknown') OR OLD.call_state='outcome_unknown' AND NEW.call_state='response_persisted' OR OLD.call_state='response_persisted' AND NEW.call_state IN('settled','outcome_unknown')) THEN RAISE EXCEPTION 'listening_discovery_call_transition_invalid';END IF;
 IF(NEW.sent_at IS DISTINCT FROM OLD.sent_at AND NOT(OLD.call_state='reserved' AND NEW.call_state='in_flight' AND OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL)) OR NEW.call_state='in_flight' AND NEW.sent_at IS NULL OR NEW.call_state='definitely_not_sent' AND NEW.sent_at IS NOT NULL THEN RAISE EXCEPTION 'listening_discovery_sent_immutable';END IF;
 IF NEW.response_storage_key IS NOT NULL THEN
 SELECT * INTO receipt FROM signal_listening_discovery_raw_receipts WHERE call_id=NEW.id;
 IF receipt.call_id IS NULL OR receipt.verification_status<>'verified' OR ROW(receipt.workspace_id,receipt.round_id,receipt.attempt_token,receipt.request_digest,receipt.storage_key,receipt.raw_sha256,receipt.size_bytes)
 IS DISTINCT FROM ROW(NEW.workspace_id,NEW.listening_round_id,NEW.attempt_token,NEW.request_digest,NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes)
 OR OLD.response_storage_key IS NOT NULL AND ROW(NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes,NEW.response_http_status,NEW.provider_request_id) IS DISTINCT FROM ROW(OLD.response_storage_key,OLD.response_sha256,OLD.response_size_bytes,OLD.response_http_status,OLD.provider_request_id) THEN RAISE EXCEPTION 'listening_discovery_raw_required';END IF;
 IF (signal_listening_discovery_transport_v1(receipt.raw_text)->>'http_status')::integer IS DISTINCT FROM NEW.response_http_status THEN RAISE EXCEPTION 'listening_discovery_raw_http_mismatch';END IF;
 END IF;
 IF NEW.call_state='settled' THEN
 BEGIN body:=(receipt.raw_text::jsonb->>'body')::jsonb;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'listening_discovery_usage_invalid';END;
 usage:=body->'usage';
 IF NEW.response_http_status<>200 OR body->>'model' !~'^claude-sonnet-4-6(-[0-9]{8})?$' OR jsonb_typeof(usage)<>'object'
 OR COALESCE(usage->>'input_tokens','')!~'^[0-9]+$' OR COALESCE(usage->>'output_tokens','')!~'^[0-9]+$'
 OR COALESCE(usage#>>'{cache_creation,ephemeral_5m_input_tokens}','0')!~'^[0-9]+$' OR COALESCE(usage#>>'{cache_creation,ephemeral_1h_input_tokens}','0')!~'^[0-9]+$'
 OR COALESCE(usage->>'cache_read_input_tokens','0')!~'^[0-9]+$' OR COALESCE(usage->>'cache_creation_input_tokens','0')!~'^[0-9]+$'
 THEN RAISE EXCEPTION 'listening_discovery_usage_invalid';END IF;
 expected:=ceil((usage->>'input_tokens')::numeric*3+(usage->>'output_tokens')::numeric*15+COALESCE((usage->>'cache_read_input_tokens')::numeric,0)*0.3
 +COALESCE((usage#>>'{cache_creation,ephemeral_5m_input_tokens}')::numeric,0)*3.75+COALESCE((usage#>>'{cache_creation,ephemeral_1h_input_tokens}')::numeric,0)*6);
 IF COALESCE((usage->>'cache_creation_input_tokens')::bigint,0)<>COALESCE((usage#>>'{cache_creation,ephemeral_5m_input_tokens}')::bigint,0)+COALESCE((usage#>>'{cache_creation,ephemeral_1h_input_tokens}')::bigint,0)
 OR NEW.settled_micro_usd IS DISTINCT FROM expected OR NEW.input_tokens IS DISTINCT FROM(usage->>'input_tokens')::integer OR NEW.output_tokens IS DISTINCT FROM(usage->>'output_tokens')::integer OR NEW.metadata->'usage' IS DISTINCT FROM usage
 OR NEW.total_tokens IS DISTINCT FROM NEW.input_tokens+NEW.output_tokens+COALESCE((usage->>'cache_creation_input_tokens')::integer,0)+COALESCE((usage->>'cache_read_input_tokens')::integer,0) THEN RAISE EXCEPTION 'listening_discovery_usage_mismatch';END IF;
 END IF;
 RETURN NEW;
END $$;

-- Workflow truth comes from the existing child ledgers. Unknown money is never
-- converted to failure with zero cost; a known raw technical failure can resume.
CREATE FUNCTION signal_listening_discovery_child_state_v1(flow_id uuid,target_run uuid,parent_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path=public,extensions,pg_temp AS $$
DECLARE flow signal_listening_preparations;child signal_labeling_runs;proto signal_workspace_embedding_runs;parent signal_listening_discovery_executions;
 ambiguous boolean;unsettled boolean;recoverable boolean;code text;
BEGIN
 SELECT * INTO parent FROM signal_listening_discovery_executions WHERE id=parent_id;
 IF parent.id IS NULL THEN RAISE EXCEPTION 'listening_discovery_child_parent_invalid';END IF;
 IF signal_listening_discovery_exposure_v1(parent.id)>parent.cap_micro_usd THEN RETURN jsonb_build_object('status','failed','error_code','listening_discovery_observed_over_cap','recovery_pending',false);END IF;
 SELECT * INTO flow FROM signal_listening_preparations WHERE id=flow_id AND workspace_id=parent.workspace_id AND actor_user_id=parent.actor_user_id;
 IF flow.id IS NULL THEN RAISE EXCEPTION 'listening_discovery_child_preparation_invalid';END IF;
 IF target_run IS NOT NULL THEN
  SELECT * INTO child FROM signal_labeling_runs WHERE id=target_run AND workspace_id=parent.workspace_id AND actor_user_id=parent.actor_user_id;
  IF child.id IS NULL OR flow.listening_run_id IS DISTINCT FROM child.id THEN RAISE EXCEPTION 'listening_discovery_child_run_invalid';END IF;
  SELECT COALESCE(bool_or(status='unknown' OR terminal_exposure_micro_usd>0),false),COALESCE(bool_or(status IN('reserved','submitting','submitted','unknown') OR terminal_exposure_micro_usd>0),false),
   COALESCE(bool_or(raw_storage_key IS NOT NULL AND NOT results_applied),false) INTO ambiguous,unsettled,recoverable FROM signal_labeling_calls WHERE run_id=child.id;
  code:=COALESCE(child.error_code,flow.error_code,'listening_discovery_child_failed');
  IF child.status IN('failed','canceled') AND code~'(configuration_changed|context_changed|stale|source_changed)' THEN RETURN jsonb_build_object('status','stale','error_code',code,'recovery_pending',false);END IF;
  IF ambiguous OR child.status IN('failed','canceled') AND(unsettled OR recoverable) THEN RETURN jsonb_build_object('status','outcome_unknown','error_code',CASE WHEN recoverable THEN 'listening_discovery_child_recovery_pending' ELSE 'listening_discovery_child_outcome_unknown' END,'recovery_pending',recoverable);END IF;
  IF child.status IN('failed','canceled') THEN RETURN jsonb_build_object('status','failed','error_code',code,'recovery_pending',false);END IF;
 ELSE
  SELECT * INTO proto FROM signal_workspace_embedding_runs WHERE id=flow.prototype_run_id AND workspace_id=parent.workspace_id;
  code:=COALESCE(flow.error_code,proto.error_code,'listening_discovery_child_failed');
  IF flow.status='failed' OR proto.status IN('failed','stale','canceled','outcome_unknown') THEN
   IF code~'(configuration_changed|context_changed|stale|source_changed)' OR proto.status='stale' THEN RETURN jsonb_build_object('status','stale','error_code',code,'recovery_pending',false);END IF;
   SELECT COALESCE(bool_or(status='outcome_unknown' OR status IN('reserved','in_flight','response_persisted')),false),COALESCE(bool_or(response_body_private IS NOT NULL AND status IN('in_flight','response_persisted','outcome_unknown')),false)
    INTO unsettled,recoverable FROM signal_workspace_embedding_calls WHERE run_id=proto.id;
   IF proto.status='outcome_unknown' OR COALESCE(proto.unknown_reserved_micro_usd,0)>0 OR unsettled THEN RETURN jsonb_build_object('status','outcome_unknown','error_code','listening_discovery_child_outcome_unknown','recovery_pending',recoverable);END IF;
   IF proto.status IS DISTINCT FROM 'completed' THEN RETURN jsonb_build_object('status','failed','error_code',code,'recovery_pending',false);END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('status','classifying','error_code',NULL,'recovery_pending',false);
END $$;
CREATE FUNCTION signal_listening_discovery_child_lifecycle_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE state jsonb;
BEGIN
 IF NEW.classification_preparation_id IS NOT NULL AND NEW.status IN('classifying','failed','stale','outcome_unknown') THEN
  state:=signal_listening_discovery_child_state_v1(NEW.classification_preparation_id,NEW.classification_run_id,NEW.execution_id);
  IF NEW.status IS DISTINCT FROM state->>'status' THEN RAISE EXCEPTION 'listening_discovery_child_state_mismatch';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER z_listening_discovery_child_lifecycle BEFORE UPDATE ON signal_listening_discovery_rounds FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_child_lifecycle_guard_v1();
REVOKE ALL ON FUNCTION signal_listening_discovery_child_state_v1(uuid,uuid,uuid),signal_listening_discovery_child_lifecycle_guard_v1() FROM PUBLIC;
-- Read-only scheduling hint for the original bound child; never an admission.
-- The drainer separately gates new work on its provider flag and live authority.
CREATE FUNCTION signal_listening_discovery_child_recovery_eligible_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT
  EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.classification_run_id AND c.workspace_id=r.workspace_id AND c.raw_storage_key IS NOT NULL AND NOT c.results_applied)
  OR child.status='completed'
  OR r.classification_run_id IS NULL AND(proto.status='completed' OR EXISTS(SELECT 1 FROM signal_workspace_embedding_calls c WHERE c.run_id=flow.prototype_run_id AND c.workspace_id=r.workspace_id AND c.response_body_private IS NOT NULL AND c.status IN('in_flight','response_persisted','outcome_unknown')))
 FROM signal_listening_discovery_rounds r
 JOIN signal_listening_preparations flow ON flow.id=r.classification_preparation_id AND flow.workspace_id=r.workspace_id
 LEFT JOIN signal_labeling_runs child ON child.id=r.classification_run_id AND child.workspace_id=r.workspace_id
 LEFT JOIN signal_workspace_embedding_runs proto ON proto.id=flow.prototype_run_id AND proto.workspace_id=r.workspace_id
 WHERE r.id=target AND r.status IN('classifying','outcome_unknown')),false)
$$;
REVOKE ALL ON FUNCTION signal_listening_discovery_child_recovery_eligible_v1(uuid) FROM PUBLIC;

-- Bind the native preparation while it is still in its creating transaction.
-- Prototype and JEV workers cannot observe a child before its composite owner.
CREATE FUNCTION signal_listening_discovery_bind_child_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_listening_discovery_rounds;p signal_listening_discovery_executions;policy signal_processing_policy_versions;
BEGIN
 IF NEW.idempotency_key NOT LIKE 'listening-discovery-child:%' THEN RETURN NEW;END IF;
 SELECT * INTO r FROM signal_listening_discovery_rounds WHERE id=substr(NEW.idempotency_key,length('listening-discovery-child:')+1)::uuid AND workspace_id=NEW.workspace_id;
 SELECT * INTO p FROM signal_listening_discovery_executions WHERE id=r.execution_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO policy FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 IF r.id IS NULL OR p.id IS NULL OR r.status<>'classifying' OR p.status<>'active'
 OR p.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR p.policy_version_id IS DISTINCT FROM NEW.policy_version_id
 OR p.map_id IS DISTINCT FROM NEW.map_id OR r.output_configuration_id IS DISTINCT FROM NEW.configuration_id
 OR r.output_configuration_id IS DISTINCT FROM(SELECT id FROM signal_listening_configurations WHERE workspace_id=NEW.workspace_id AND state='published' ORDER BY revision DESC LIMIT 1)
 OR NOT COALESCE(signal_listening_discovery_source_current_v1(r.input_generation_id),false)
 OR NEW.cap_micro_usd>r.planned_child_cap_micro_usd
 OR policy.status IS DISTINCT FROM 'active' OR policy.organization_id IS DISTINCT FROM p.organization_id OR clock_timestamp()<policy.valid_from OR clock_timestamp()>=policy.valid_until
 OR signal_listening_discovery_exposure_v1(p.id)>p.cap_micro_usd
 OR r.classification_preparation_id IS NOT NULL AND r.classification_preparation_id IS DISTINCT FROM NEW.id
 OR r.classification_run_id IS NOT NULL AND r.classification_run_id IS DISTINCT FROM NEW.listening_run_id
 THEN RAISE EXCEPTION 'listening_discovery_child_authority_changed';END IF;
 UPDATE signal_listening_discovery_rounds SET classification_preparation_id=NEW.id,classification_run_id=NEW.listening_run_id WHERE id=r.id;
 IF NEW.listening_run_id IS NOT NULL THEN INSERT INTO signal_listening_discovery_children(execution_id,workspace_id,run_id,preparation_id,round_id)
  VALUES(p.id,NEW.workspace_id,NEW.listening_run_id,NEW.id,r.id) ON CONFLICT(run_id) DO NOTHING;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_listening_discovery_bind_child AFTER INSERT OR UPDATE OF listening_run_id ON signal_listening_preparations FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_bind_child_v1();
REVOKE ALL ON FUNCTION signal_listening_discovery_bind_child_v1() FROM PUBLIC;
-- Direct SQL follows the same policy/day -> actor -> parent order as the native
-- preparation API. Take these locks before its existing actor-scope trigger.
CREATE FUNCTION signal_listening_discovery_child_policy_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE organization uuid;timezone text;
BEGIN
 IF NEW.idempotency_key NOT LIKE 'listening-discovery-child:%' THEN RETURN NEW;END IF;
 SELECT organization_id INTO organization FROM signal_workspaces WHERE id=NEW.workspace_id;
 SELECT budget_timezone INTO timezone FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id;
 IF organization IS NULL OR timezone IS NULL THEN RAISE EXCEPTION 'listening_discovery_child_scope_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||organization::text,0));
 PERFORM signal_processing_lock_v1(organization,(clock_timestamp() AT TIME ZONE timezone)::date);RETURN NEW;
END $$;
CREATE TRIGGER aaa_listening_discovery_child_policy BEFORE INSERT OR UPDATE OF listening_run_id ON signal_listening_preparations FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_child_policy_lock_v1();
REVOKE ALL ON FUNCTION signal_listening_discovery_child_policy_lock_v1() FROM PUBLIC;
