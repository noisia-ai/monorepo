-- R16 Study: a versioned methodology on a frozen Listening cut. This migration
-- grants no provider permission, imports no corpus and creates no paid request.
CREATE TABLE signal_study_corpora(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL UNIQUE REFERENCES signal_workspaces(id),
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workspace_id,id));
CREATE TABLE signal_studies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,corpus_id uuid NOT NULL,
 definition jsonb NOT NULL,definition_digest text NOT NULL,created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,corpus_id) REFERENCES signal_study_corpora(workspace_id,id),
 CHECK(definition_digest=signal_labeling_digest_v1(definition)));
CREATE TABLE signal_study_configurations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,study_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 envelope jsonb NOT NULL,configuration_digest text NOT NULL,human_revision_digest text NOT NULL,provenance text NOT NULL CHECK(provenance IN('human','agent')),
 listening_snapshot_id uuid NOT NULL,listening_configuration_id uuid NOT NULL,listening_configuration_digest text NOT NULL,
 idempotency_key text,request_digest text,
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workspace_id,id),UNIQUE(study_id,revision),
 UNIQUE(workspace_id,created_by_user_id,idempotency_key),CHECK((idempotency_key IS NULL AND request_digest IS NULL) OR(idempotency_key IS NOT NULL AND request_digest IS NOT NULL AND length(idempotency_key) BETWEEN 8 AND 200 AND request_digest~'^sha256:[0-9a-f]{64}$')),
 FOREIGN KEY(workspace_id,study_id) REFERENCES signal_studies(workspace_id,id),
 FOREIGN KEY(workspace_id,listening_configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(listening_snapshot_id) REFERENCES signal_listening_serving_snapshots(id),
 CHECK(configuration_digest=signal_labeling_digest_v1(envelope)),CHECK(human_revision_digest~'^sha256:[0-9a-f]{64}$'),CHECK(octet_length(envelope::text)<=1048576));
CREATE TABLE signal_study_executions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,organization_id uuid NOT NULL REFERENCES organizations(id),
 study_id uuid NOT NULL,configuration_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES users(id),policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 configuration_digest text NOT NULL,human_revision_digest text NOT NULL,entity_context_digest text NOT NULL,map_id uuid NOT NULL,
 cap_micro_usd bigint NOT NULL CHECK(cap_micro_usd>0),idempotency_key text NOT NULL,request_digest text NOT NULL,
 source_header jsonb NOT NULL,source_digest text,source_census_digest text,source_roots integer NOT NULL CHECK(source_roots>=0),source_bytes bigint NOT NULL CHECK(source_bytes>=0),
 status text NOT NULL DEFAULT 'building' CHECK(status IN('building','queued','running','outcome_unknown','stale','budget_exhausted','completed','failed')),
 execution_token uuid,execution_expires_at timestamptz,error_code text,output jsonb,output_digest text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,actor_user_id,idempotency_key),FOREIGN KEY(workspace_id,study_id) REFERENCES signal_studies(workspace_id,id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_study_configurations(workspace_id,id),FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 CHECK((execution_token IS NULL)=(execution_expires_at IS NULL)),CHECK((output IS NULL)=(output_digest IS NULL)),
 CHECK(source_digest IS NULL OR source_digest~'^sha256:[0-9a-f]{64}$'),CHECK(status='building' OR source_digest IS NOT NULL AND source_census_digest IS NOT NULL),
 CHECK(status<>'completed' OR output IS NOT NULL AND output_digest=signal_labeling_digest_v1(output)));
CREATE UNIQUE INDEX signal_study_one_active ON signal_study_executions(study_id) WHERE status IN('building','queued','running','outcome_unknown');
CREATE INDEX signal_study_executions_pending ON signal_study_executions(created_at,id) WHERE status IN('queued','running','outcome_unknown');
CREATE TABLE signal_study_source_roots(execution_id uuid NOT NULL,workspace_id uuid NOT NULL,root_id uuid NOT NULL,map_id uuid NOT NULL,
 input_digest text NOT NULL,asset_sha256 text NOT NULL,chunk_policy_version text NOT NULL,chunk_sha256 text NOT NULL,chunk_index integer NOT NULL,
 start_offset integer NOT NULL,end_offset integer NOT NULL,embedding_config_digest text NOT NULL,embedding_call_id uuid NOT NULL,embedding_run_id uuid NOT NULL,
 native_vector_sha256 text NOT NULL,base_cache jsonb NOT NULL,attributes jsonb NOT NULL,listening_topic_keys text[] NOT NULL,question_cache_ids uuid[] NOT NULL DEFAULT '{}',
 occurred_at timestamptz NOT NULL,channel text NOT NULL,source_url text NOT NULL,private_person_names text[] NOT NULL DEFAULT '{}',proof_json text NOT NULL,proof_digest text NOT NULL,
 PRIMARY KEY(execution_id,root_id),UNIQUE(workspace_id,execution_id,root_id),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id),
 FOREIGN KEY(map_id,root_id) REFERENCES signal_mass_labeling_items(map_id,root_id),FOREIGN KEY(workspace_id,embedding_call_id) REFERENCES signal_workspace_embedding_calls(workspace_id,id),
 FOREIGN KEY(workspace_id,embedding_run_id) REFERENCES signal_workspace_embedding_runs(workspace_id,id),
 CHECK(start_offset>=0 AND end_offset>start_offset AND end_offset-start_offset<=1400),CHECK(proof_digest='sha256:'||encode(sha256(convert_to(proof_json,'UTF8')),'hex')));
CREATE TABLE signal_study_steps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,step_key text NOT NULL,
 request_body text NOT NULL,request_sha256 text NOT NULL,source_digest text NOT NULL,mode text NOT NULL CHECK(mode IN('motives','layers','contrast')),
 maximum_output_tokens integer NOT NULL CHECK(maximum_output_tokens BETWEEN 1 AND 32768),reservation_micro_usd bigint NOT NULL CHECK(reservation_micro_usd>0),
 admission_id uuid UNIQUE REFERENCES signal_processing_admissions(id) DEFERRABLE INITIALLY DEFERRED,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN('planned','sent','raw','committed','unknown')),sent_token uuid,
 value jsonb,value_digest text,error_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(execution_id,step_key),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id),
 CHECK(request_sha256='sha256:'||encode(sha256(convert_to(request_body,'UTF8')),'hex')),CHECK(octet_length(request_body) BETWEEN 1 AND 2097152),
 CHECK((value IS NULL)=(value_digest IS NULL)),CHECK(value IS NULL OR value_digest=signal_labeling_digest_v1(value)),CHECK(status<>'committed' OR value IS NOT NULL));
CREATE TABLE signal_study_receipts(step_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,execution_id uuid NOT NULL,attempt_token uuid NOT NULL,
 raw_json text NOT NULL,raw_sha256 text NOT NULL,raw_size_bytes bigint NOT NULL,storage_key text NOT NULL,body_sha256 text NOT NULL,
 verification_status text NOT NULL DEFAULT 'planned' CHECK(verification_status IN('planned','verified')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),verified_at timestamptz,
 FOREIGN KEY(workspace_id,step_id) REFERENCES signal_study_steps(workspace_id,id),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id),
 CHECK(raw_sha256='sha256:'||encode(sha256(convert_to(raw_json,'UTF8')),'hex') AND raw_size_bytes=octet_length(raw_json) AND raw_size_bytes BETWEEN 1 AND 12582912),
 CHECK((verification_status='verified')=(verified_at IS NOT NULL)));
CREATE TABLE signal_study_jev_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,run_id uuid UNIQUE,
 stage text NOT NULL CHECK(stage IN('axes','membership','dominance_membership')),plan_header jsonb NOT NULL,plan_digest text NOT NULL,
 stage_configuration jsonb NOT NULL,stage_configuration_digest text NOT NULL,stage_lineage jsonb NOT NULL,
 target_digest text NOT NULL,run_cap_micro_usd bigint NOT NULL CHECK(run_cap_micro_usd>0),checkpoint jsonb,request_count integer NOT NULL CHECK(request_count>0),request_census_digest text NOT NULL,parent_execution_token uuid NOT NULL,
 status text NOT NULL DEFAULT 'building' CHECK(status IN('building','planned','running','completed','outcome_unknown','stale','budget_exhausted')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(execution_id,stage,plan_digest),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES signal_labeling_runs(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(stage_configuration_digest=signal_labeling_digest_v1(stage_configuration)));
CREATE TABLE signal_study_jev_members(batch_id uuid NOT NULL,workspace_id uuid NOT NULL,execution_id uuid NOT NULL,root_id uuid NOT NULL,
 request_body text NOT NULL,request_sha256 text NOT NULL,state_sha256 text NOT NULL,input_digest text NOT NULL,
 question_digests jsonb NOT NULL,question_keys text[] NOT NULL,target_digest text NOT NULL,
 PRIMARY KEY(batch_id,root_id),FOREIGN KEY(workspace_id,batch_id) REFERENCES signal_study_jev_batches(workspace_id,id),
 FOREIGN KEY(workspace_id,execution_id,root_id) REFERENCES signal_study_source_roots(workspace_id,execution_id,root_id),
 CHECK(request_sha256='sha256:'||encode(sha256(convert_to(request_body,'UTF8')),'hex')),CHECK(octet_length(request_body) BETWEEN 1 AND 1048576),
 CHECK(cardinality(question_keys) BETWEEN 1 AND 4 AND array_position(question_keys,NULL) IS NULL));
CREATE TABLE signal_study_jev_calls(call_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,batch_id uuid NOT NULL,root_id uuid NOT NULL,request_sha256 text NOT NULL,UNIQUE(batch_id,root_id),
 FOREIGN KEY(workspace_id,call_id) REFERENCES signal_labeling_calls(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(batch_id,root_id) REFERENCES signal_study_jev_members(batch_id,root_id));
CREATE TABLE signal_study_answers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,root_id uuid NOT NULL,state_sha256 text NOT NULL,
 target_digest text NOT NULL,model text NOT NULL CHECK(model='jev-1.13.0'),question_key text NOT NULL,question_identity_digest text NOT NULL,question_digest text NOT NULL,
 answer jsonb NOT NULL,call_id uuid NOT NULL,batch_id uuid NOT NULL,request_sha256 text NOT NULL,raw_page_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,root_id,state_sha256,target_digest,model,question_identity_digest),FOREIGN KEY(call_id) REFERENCES signal_study_jev_calls(call_id),
 FOREIGN KEY(batch_id,root_id) REFERENCES signal_study_jev_members(batch_id,root_id),FOREIGN KEY(raw_page_id) REFERENCES signal_labeling_raw_pages(id));
CREATE INDEX signal_study_answers_root ON signal_study_answers(workspace_id,root_id,target_digest,state_sha256);
CREATE TABLE signal_study_calibrations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,source_run_id uuid NOT NULL,
 scope_digest text NOT NULL,source_digest text NOT NULL,profile jsonb NOT NULL,created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(scope_digest,source_digest),FOREIGN KEY(workspace_id,source_run_id) REFERENCES signal_labeling_runs(workspace_id,id));
CREATE TABLE signal_study_numeric_checkpoints(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,execution_id uuid NOT NULL,numeric_key text NOT NULL,
 request_body text NOT NULL,request_sha256 text NOT NULL,source_digest text NOT NULL,fit_plan_digest text NOT NULL,
 manifest_json text NOT NULL,manifest_sha256 text NOT NULL,artifact_manifest jsonb NOT NULL,artifacts_digest text NOT NULL,
 value jsonb NOT NULL,value_digest text NOT NULL,planned_by_token uuid NOT NULL,verification_token uuid,verified_at timestamptz,
 verification_status text NOT NULL DEFAULT 'planned' CHECK(verification_status IN('planned','verified')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(execution_id,numeric_key),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id),
 CHECK(request_sha256='sha256:'||encode(sha256(convert_to(request_body,'UTF8')),'hex')),CHECK(manifest_sha256='sha256:'||encode(sha256(convert_to(manifest_json,'UTF8')),'hex')),
 CHECK(octet_length(manifest_json) BETWEEN 1 AND 33554432 AND value_digest=signal_labeling_digest_v1(value)),
 CHECK(artifacts_digest=signal_labeling_digest_v1(artifact_manifest)),CHECK((verification_status='verified')=(verified_at IS NOT NULL AND verification_token IS NOT NULL)));
CREATE TABLE signal_study_numeric_artifacts(checkpoint_id uuid NOT NULL,workspace_id uuid NOT NULL,name text NOT NULL,storage_key text NOT NULL,sha256 text NOT NULL,size_bytes bigint NOT NULL,
 PRIMARY KEY(checkpoint_id,name),FOREIGN KEY(workspace_id,checkpoint_id) REFERENCES signal_study_numeric_checkpoints(workspace_id,id),
 CHECK(name~'^(numeric-manifest\.json|source-proofs\.jsonl|(input|output)/[a-z0-9][a-z0-9_.-]{0,100})$' AND position('..' IN name)=0),
 CHECK(sha256~'^sha256:[0-9a-f]{64}$' AND size_bytes>=0 AND size_bytes<=9007199254740991));
CREATE TABLE signal_study_outputs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL UNIQUE,
 study_id uuid NOT NULL,configuration_id uuid NOT NULL,source_digest text NOT NULL,output jsonb NOT NULL,output_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,study_id) REFERENCES signal_studies(workspace_id,id),CHECK(output_digest=signal_labeling_digest_v1(output)));

CREATE TABLE signal_study_promotions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id),idempotency_key text NOT NULL,request_digest text NOT NULL,motive_keys text[] NOT NULL,
 expected_listening_revision integer NOT NULL,output_configuration_id uuid NOT NULL,output_configuration_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workspace_id,actor_user_id,idempotency_key),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id),FOREIGN KEY(workspace_id,output_configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 CHECK(length(idempotency_key) BETWEEN 8 AND 200 AND request_digest~'^sha256:[0-9a-f]{64}$' AND cardinality(motive_keys) BETWEEN 1 AND 256));
CREATE FUNCTION signal_study_call_page_v1(target uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$ SELECT page_id FROM signal_labeling_raw_page_members WHERE call_id=target $$;
CREATE FUNCTION signal_study_analysis_configuration_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('contract_version','signal-study-analysis-v1','provider','anthropic','model','claude-sonnet-4-6',
  'credential_scope','NOISIA_STUDY_ANTHROPIC_API_KEY','pricing_version','claude-sonnet-4-6-global-2026-11-14',
  'input_rate',3000000,'output_rate',15000000,'cache_read_rate',300000,'cache_5m_rate',3750000,'cache_1h_rate',6000000,
  'reservation_input_rate',6000000,'maximum_output_tokens',32768,'context_tokens',1000000,'maximum_request_bytes',524288)
$$;
CREATE FUNCTION signal_study_history_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='signal_study_corpora' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW;END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_history_immutable';END IF;RETURN NEW;
END $$;
CREATE FUNCTION signal_study_configuration_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e jsonb;q jsonb;previous signal_study_configurations;s signal_studies;listening signal_listening_configurations;snapshot signal_listening_serving_snapshots;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_configuration_immutable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-study-config:'||NEW.study_id::text,0));
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 SELECT * INTO s FROM signal_studies WHERE id=NEW.study_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO listening FROM signal_listening_configurations WHERE id=NEW.listening_configuration_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO snapshot FROM signal_listening_serving_snapshots WHERE id=NEW.listening_snapshot_id AND workspace_id=NEW.workspace_id;
 e:=NEW.envelope;q:=e->'question_configuration';
 IF s.id IS NULL OR listening.id IS NULL OR snapshot.id IS NULL OR snapshot.configuration_id<>listening.id
 OR NOT COALESCE(signal_listening_discovery_source_current_v1(snapshot.generation_id),false)
 OR e->>'contract_version' IS DISTINCT FROM 'signal-study-execution-configuration-v1' OR e->>'executor_contract' IS DISTINCT FROM 'triggers-barriers-r16-v1'
 OR e#>>'{study,workspace_id}' IS DISTINCT FROM NEW.workspace_id::text OR e#>>'{study,corpus_id}' IS DISTINCT FROM s.corpus_id::text
 OR (e->'study')-ARRAY['revision','provenance'] IS DISTINCT FROM s.definition OR(e#>>'{study,revision}')::int IS DISTINCT FROM NEW.revision
 OR e->>'study_digest' IS DISTINCT FROM signal_labeling_digest_v1(e->'study')
 OR e#>>'{source_listening,configuration_id}' IS DISTINCT FROM listening.id::text OR e#>'{source_listening,configuration}' IS DISTINCT FROM listening.configuration
 OR e#>>'{source_listening,configuration_digest}' IS DISTINCT FROM listening.configuration_digest OR NEW.listening_configuration_digest<>listening.configuration_digest
 OR e#>>'{study,listening_configuration_id}' IS DISTINCT FROM listening.id::text OR e#>>'{study,listening_configuration_digest}' IS DISTINCT FROM listening.configuration_digest
 OR e#>>'{template_snapshot,template_digest}' IS DISTINCT FROM signal_labeling_digest_v1(e#>'{template_snapshot,template}')
 OR e#>>'{template_snapshot,roles_digest}' IS DISTINCT FROM signal_labeling_digest_v1(e#>'{template_snapshot,roles}')
 OR e#>>'{study,methodology,template_digest}' IS DISTINCT FROM e#>>'{template_snapshot,template_digest}'
 OR q->>'contract_version' IS DISTINCT FROM 'signal-study-scoped-questions-v1' OR q->>'scope' IS DISTINCT FROM 'study' OR q->>'stage' IS DISTINCT FROM 'axes'
 OR q->>'model' IS DISTINCT FROM 'jev-1.13.0' OR(q->>'revision')::int IS DISTINCT FROM NEW.revision OR q->>'provenance' IS DISTINCT FROM NEW.provenance
 OR q->>'study_digest' IS DISTINCT FROM e->>'study_digest' OR q->>'template_digest' IS DISTINCT FROM e#>>'{template_snapshot,template_digest}'
 OR q->'roles' IS DISTINCT FROM e#>'{template_snapshot,roles}' OR q->>'roles_digest' IS DISTINCT FROM signal_labeling_digest_v1(q->'roles')
 OR e->>'question_configuration_digest' IS DISTINCT FROM signal_labeling_digest_v1(q) OR jsonb_array_length(q->'questions')<>3
 OR(SELECT count(DISTINCT question->>'key') FROM jsonb_array_elements(q->'questions') question)<>3
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(q->'questions') question WHERE question->>'key' IN('voice','promotion') OR question->>'type'<>'choice' OR jsonb_typeof(question->'human_locked')<>'boolean')
 OR NOT signal_processing_actor_v1(NEW.workspace_id,NEW.created_by_user_id) THEN RAISE EXCEPTION 'study_configuration_invalid';END IF;
 SELECT * INTO previous FROM signal_study_configurations WHERE study_id=s.id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(previous.revision,0)+1 THEN RAISE EXCEPTION 'study_configuration_revision_conflict';END IF;
 IF previous.id IS NOT NULL THEN
  IF NEW.listening_snapshot_id<>previous.listening_snapshot_id OR e->'source_listening' IS DISTINCT FROM previous.envelope->'source_listening'
   OR e->'template_snapshot' IS DISTINCT FROM previous.envelope->'template_snapshot' THEN RAISE EXCEPTION 'study_configuration_source_immutable';END IF;
  IF NEW.provenance='agent' AND((previous.envelope#>>'{question_configuration,human_locked}')::boolean
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(previous.envelope#>'{question_configuration,questions}') prior_question WHERE prior_question->'human_locked'='true'::jsonb
    AND(previous.envelope#>>'{question_configuration,instructions}' IS DISTINCT FROM q->>'instructions'
     OR prior_question IS DISTINCT FROM(SELECT value FROM jsonb_array_elements(q->'questions') WHERE value->>'key'=prior_question->>'key')))) THEN RAISE EXCEPTION 'study_human_precedence';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_configuration_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_configurations FOR EACH ROW EXECUTE FUNCTION signal_study_configuration_guard_v1();
CREATE FUNCTION signal_study_source_root_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;item signal_mass_labeling_items;cached signal_workspace_chunk_embeddings;receipt signal_workspace_embedding_calls;run signal_workspace_embedding_runs;asset signal_corpus_text_assets;prepared signal_corpus_preparation_items;proof jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_source_immutable';END IF;
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO item FROM signal_mass_labeling_items WHERE map_id=NEW.map_id AND workspace_id=NEW.workspace_id AND root_id=NEW.root_id;
 SELECT * INTO cached FROM signal_workspace_chunk_embeddings WHERE workspace_id=NEW.workspace_id AND config_digest=NEW.embedding_config_digest AND chunk_sha256=NEW.chunk_sha256;
 SELECT * INTO receipt FROM signal_workspace_embedding_calls WHERE id=cached.call_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO run FROM signal_workspace_embedding_runs WHERE id=receipt.run_id AND workspace_id=NEW.workspace_id;
 SELECT x.* INTO prepared FROM signal_corpus_preparation_items x JOIN signal_mass_labeling_maps m ON m.preparation_run_id=x.run_id AND m.workspace_id=x.workspace_id
  WHERE m.id=NEW.map_id AND x.workspace_id=NEW.workspace_id AND x.root_id=NEW.root_id AND x.disposition='eligible';
 SELECT * INTO asset FROM signal_corpus_text_assets WHERE workspace_id=NEW.workspace_id AND text_sha256=prepared.asset_sha256 AND chunk_policy_version=prepared.chunk_policy_version;
 proof:=NEW.proof_json::jsonb;
 IF p.id IS NULL OR p.status<>'building' OR p.map_id<>NEW.map_id OR item.root_id IS NULL OR asset.text_sha256 IS NULL
 OR receipt.status IS DISTINCT FROM 'settled' OR receipt.response_digest IS NULL OR receipt.http_status<>200 OR receipt.response_body_private IS NULL
 OR receipt.response_digest IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(receipt.response_body_private,'UTF8')),'hex')
 OR run.profile->>'model' IS DISTINCT FROM 'voyage-4-large' OR vector_dims(cached.embedding)<>1024 OR abs(vector_norm(cached.embedding)-1)>.0001
 OR receipt.id IS DISTINCT FROM NEW.embedding_call_id OR receipt.run_id IS DISTINCT FROM NEW.embedding_run_id OR receipt.config_digest<>NEW.embedding_config_digest
 OR cached.response_index IS DISTINCT FROM array_position(receipt.input_keys,NEW.chunk_sha256)-1
 OR NEW.asset_sha256<>prepared.asset_sha256 OR NEW.chunk_policy_version<>prepared.chunk_policy_version OR NEW.chunk_sha256<>item.chunk_sha256 OR NEW.chunk_index<>item.chunk_index
 OR asset.chunks->'chunks'->NEW.chunk_index->>'sha256' IS DISTINCT FROM NEW.chunk_sha256
 OR NEW.start_offset IS DISTINCT FROM(asset.chunks->'chunks'->NEW.chunk_index->>'start')::integer OR NEW.end_offset IS DISTINCT FROM(asset.chunks->'chunks'->NEW.chunk_index->>'end')::integer
 OR signal_topic_utf16_fragment_v1(asset.full_text,NEW.start_offset,NEW.end_offset) IS DISTINCT FROM item.text
 OR NEW.chunk_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(item.text,'UTF8')),'hex')
 OR NEW.native_vector_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(cached.embedding::text,'UTF8')),'hex')
 OR proof->>'contract_version' IS DISTINCT FROM 'signal-study-cached-vector-source-proof-v1' OR proof->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
 OR proof->>'execution_id' IS DISTINCT FROM p.id::text OR proof->>'root_id' IS DISTINCT FROM NEW.root_id::text
 OR proof->>'source_text_sha256' IS DISTINCT FROM NEW.chunk_sha256 OR proof->>'original_source_text_sha256' IS DISTINCT FROM NEW.asset_sha256
 OR proof->>'embedding_call_id' IS DISTINCT FROM receipt.id::text OR proof->>'embedding_run_id' IS DISTINCT FROM run.id::text
 OR proof->>'embedding_preparation_run_id' IS DISTINCT FROM run.preparation_run_id::text OR proof->>'embedding_input_contract' IS DISTINCT FROM run.input_contract
 OR proof->>'embedding_raw_sha256' IS DISTINCT FROM receipt.response_digest OR proof->>'embedding_request_digest' IS DISTINCT FROM receipt.request_digest
 OR proof->>'embedding_batch_digest' IS DISTINCT FROM receipt.batch_digest OR proof->>'embedding_sha256' IS DISTINCT FROM NEW.native_vector_sha256
 OR proof->'embedding_profile' IS DISTINCT FROM run.profile OR proof->>'embedding_model' IS DISTINCT FROM run.profile->>'model' OR proof->>'embedding_config_digest' IS DISTINCT FROM cached.config_digest
 OR proof->>'input_digest' IS DISTINCT FROM NEW.input_digest OR proof->>'embedding_chunk_sha256' IS DISTINCT FROM NEW.chunk_sha256 OR proof->>'chunk_sha256' IS DISTINCT FROM NEW.chunk_sha256
 OR proof->>'embedding_response_index' IS DISTINCT FROM cached.response_index::text OR proof->'selected_fragment' IS DISTINCT FROM jsonb_build_object('start',NEW.start_offset,'end',NEW.end_offset,'text_sha256',NEW.chunk_sha256)
 OR proof->'base_cache' IS DISTINCT FROM NEW.base_cache OR proof->>'context_digest' IS DISTINCT FROM p.entity_context_digest
 OR proof->>'corpus_preparation_run_id' IS DISTINCT FROM prepared.run_id::text
 OR NOT signal_listening_root_right_v1(NEW.workspace_id,NEW.root_id,'llm-processing')
 OR EXISTS(SELECT 1 FROM unnest(NEW.question_cache_ids) id WHERE NOT EXISTS(SELECT 1 FROM signal_study_answers answer WHERE answer.id=id AND answer.workspace_id=NEW.workspace_id AND answer.root_id=NEW.root_id
  AND answer.state_sha256 IN(NEW.asset_sha256,NEW.chunk_sha256))) THEN RAISE EXCEPTION 'study_source_provenance_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_study_source_root_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_source_roots FOR EACH ROW EXECUTE FUNCTION signal_study_source_root_guard_v1();

CREATE FUNCTION signal_study_census_v1(target uuid) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(COALESCE(jsonb_agg(jsonb_build_array(root_id,proof_digest) ORDER BY root_id),'[]'::jsonb)) FROM signal_study_source_roots WHERE execution_id=target
$$;
CREATE FUNCTION signal_study_source_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(cfg.id=(SELECT id FROM signal_study_configurations WHERE study_id=p.study_id AND workspace_id=p.workspace_id ORDER BY revision DESC LIMIT 1)
 AND cfg.configuration_digest=p.configuration_digest AND cfg.human_revision_digest=p.human_revision_digest
 AND signal_processing_actor_v1(p.workspace_id,p.actor_user_id)
 AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=p.workspace_id AND feature='mass_labeling')
 AND policy.status='active' AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp() AND policy.organization_id=p.organization_id
 AND EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='study_analysis' AND provider='anthropic' AND model='claude-sonnet-4-6' AND configuration=signal_study_analysis_configuration_v1())
 AND EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='mass_labeling_jev' AND provider='typesafe' AND model='jev-1.13.0')
 AND signal_listening_discovery_source_current_v1(snapshot.generation_id)
 AND p.source_census_digest=signal_study_census_v1(p.id)
 AND NOT EXISTS(SELECT 1 FROM signal_study_source_roots r JOIN signal_corpus_text_assets a ON a.workspace_id=r.workspace_id AND a.text_sha256=r.asset_sha256 AND a.chunk_policy_version=r.chunk_policy_version
  WHERE r.execution_id=p.id AND(NOT signal_listening_root_right_v1(r.workspace_id,r.root_id,'llm-processing') OR r.asset_sha256<>'sha256:'||encode(sha256(convert_to(a.full_text,'UTF8')),'hex'))),false)
 FROM signal_study_executions p JOIN signal_study_configurations cfg ON cfg.id=p.configuration_id AND cfg.workspace_id=p.workspace_id
 JOIN signal_processing_policy_versions policy ON policy.id=p.policy_version_id JOIN signal_listening_serving_snapshots snapshot ON snapshot.id=cfg.listening_snapshot_id AND snapshot.workspace_id=p.workspace_id WHERE p.id=target
$$;
CREATE FUNCTION signal_study_execution_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE cfg signal_study_configurations;marker jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'study_execution_immutable';END IF;
 SELECT * INTO cfg FROM signal_study_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id;
 IF TG_OP='INSERT' THEN
  PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
  IF cfg.id IS NULL OR cfg.study_id<>NEW.study_id OR NEW.configuration_digest<>cfg.configuration_digest OR NEW.human_revision_digest<>cfg.human_revision_digest
   OR NEW.status<>'building' OR NEW.execution_token IS NOT NULL OR NEW.source_digest IS NOT NULL OR NEW.output IS NOT NULL
   OR NEW.organization_id IS DISTINCT FROM(SELECT organization_id FROM signal_workspaces WHERE id=NEW.workspace_id)
   OR NOT signal_processing_actor_v1(NEW.workspace_id,NEW.actor_user_id) THEN RAISE EXCEPTION 'study_execution_invalid';END IF;
 ELSE
  IF(to_jsonb(NEW)-ARRAY['source_digest','source_census_digest','status','execution_token','execution_expires_at','error_code','output','output_digest','updated_at'])
   IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['source_digest','source_census_digest','status','execution_token','execution_expires_at','error_code','output','output_digest','updated_at'])
   OR OLD.source_digest IS NOT NULL AND ROW(NEW.source_digest,NEW.source_census_digest) IS DISTINCT FROM ROW(OLD.source_digest,OLD.source_census_digest)
   OR OLD.output IS NOT NULL AND ROW(NEW.output,NEW.output_digest) IS DISTINCT FROM ROW(OLD.output,OLD.output_digest) THEN RAISE EXCEPTION 'study_execution_immutable';END IF;
  IF OLD.status='building' THEN
   marker:=NULLIF(current_setting('noisia.study_source_verified_v1',true),'')::jsonb;
   IF NEW.status<>'queued' OR NEW.source_roots<>(SELECT count(*) FROM signal_study_source_roots WHERE execution_id=NEW.id)
    OR NEW.source_census_digest IS DISTINCT FROM signal_study_census_v1(NEW.id)
    OR marker IS DISTINCT FROM jsonb_build_object('execution_id',NEW.id,'source_digest',NEW.source_digest,'source_census_digest',NEW.source_census_digest)
    THEN RAISE EXCEPTION 'study_source_unverified';END IF;
  END IF;
  IF OLD.execution_token IS NOT NULL AND OLD.execution_expires_at>clock_timestamp() AND NEW.execution_token IS NOT NULL AND NEW.execution_token<>OLD.execution_token THEN RAISE EXCEPTION 'study_lease_held';END IF;
 END IF;
 IF NEW.execution_token IS NOT NULL AND(NEW.execution_expires_at<=clock_timestamp() OR NEW.execution_expires_at>clock_timestamp()+interval '300 seconds') THEN RAISE EXCEPTION 'study_lease_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_study_execution_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_study_execution_guard_v1();
DO $$DECLARE name text;role_name text;BEGIN
 FOREACH name IN ARRAY ARRAY['signal_study_corpora','signal_studies','signal_study_configurations','signal_study_executions','signal_study_source_roots','signal_study_steps','signal_study_receipts','signal_study_jev_batches','signal_study_jev_members','signal_study_jev_calls','signal_study_answers','signal_study_calibrations','signal_study_numeric_checkpoints','signal_study_numeric_artifacts','signal_study_outputs','signal_study_promotions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',name,role_name);END IF;END LOOP;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['signal_study_corpora','signal_studies','signal_study_jev_members','signal_study_jev_calls','signal_study_outputs','signal_study_promotions'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION signal_study_history_v1()',name||'_history',name);
 END LOOP;
END $$;

CREATE FUNCTION signal_study_target_digest_v1(configuration jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT signal_labeling_digest_v1(jsonb_build_object('scope','study','subject',configuration#>'{study,subject}'))
$$;
CREATE FUNCTION signal_study_listening_cache_v1(w uuid,cid uuid,root uuid,input text,ctx text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(jsonb_object_agg(q.question_key,jsonb_build_object('answer',a.answer,'call_id',a.call_id,'question_digest',q.question_digest)),'{}'::jsonb)
 FROM signal_listening_answers a JOIN signal_listening_questions q ON q.configuration_id=cid AND q.question_digest=a.question_digest AND q.workspace_id=a.workspace_id
 JOIN signal_labeling_calls call ON call.id=a.call_id AND call.workspace_id=a.workspace_id AND call.status='settled' AND call.raw_storage_verified_at IS NOT NULL
  AND call.raw_storage_verified_key=call.raw_storage_key AND call.results_applied
 WHERE a.workspace_id=w AND a.root_id=root AND a.input_digest=input AND a.entity_context_digest=ctx
$$;
CREATE FUNCTION signal_study_attributes_v1(cache jsonb,proof jsonb,platform text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT jsonb_object_agg(key,CASE WHEN value#>>'{answer,type}'='choice' THEN jsonb_build_array(value#>>'{answer,choice}')
  WHEN(value#>>'{answer,noul}')::numeric>=.7 THEN '["positive"]'::jsonb WHEN(value#>>'{answer,noul}')::numeric<=.3 THEN '["negative"]'::jsonb ELSE '["uncertain"]'::jsonb END) FROM jsonb_each(cache)),'{}'::jsonb)
 ||COALESCE((SELECT jsonb_object_agg(e->>'question_key',CASE WHEN e->>'human_belongs'='true' THEN '["positive"]'::jsonb WHEN e->>'human_belongs'='false' THEN '["negative"]'::jsonb
  WHEN(e->>'probability')::numeric>=.7 THEN '["positive"]'::jsonb WHEN(e->>'probability')::numeric<=.3 THEN '["negative"]'::jsonb WHEN e->>'probability' IS NOT NULL THEN '["uncertain"]'::jsonb ELSE '[]'::jsonb END)
  FROM jsonb_array_elements(proof->'evaluations') e),'{}'::jsonb)
 ||jsonb_build_object('platform',jsonb_build_array(COALESCE(platform,'unknown')),'channel',jsonb_build_array(COALESCE(platform,'unknown')),
 'topic',COALESCE((SELECT jsonb_agg(e->>'question_key' ORDER BY e->>'question_key') FROM jsonb_array_elements(proof->'evaluations') e WHERE COALESCE((e->>'human_belongs')::boolean,(e->>'probability')::numeric>=.7)),'[]'::jsonb))
$$;
CREATE FUNCTION signal_study_source_cut_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;cfg signal_study_configurations;snapshot signal_listening_serving_snapshots;source signal_listening_discovery_roots;m mentions;actual_cache jsonb;
BEGIN
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO cfg FROM signal_study_configurations WHERE id=p.configuration_id AND workspace_id=p.workspace_id;
 SELECT * INTO snapshot FROM signal_listening_serving_snapshots WHERE id=cfg.listening_snapshot_id AND workspace_id=p.workspace_id;
 SELECT * INTO source FROM signal_listening_discovery_roots WHERE generation_id=snapshot.generation_id AND workspace_id=p.workspace_id AND root_id=NEW.root_id;
 SELECT * INTO m FROM mentions WHERE id=NEW.root_id AND workspace_id=p.workspace_id;
 actual_cache:=signal_study_listening_cache_v1(p.workspace_id,cfg.listening_configuration_id,NEW.root_id,source.proof->>'input_digest',p.entity_context_digest);
 IF source.root_id IS NULL OR source.proof->'in_category' IS DISTINCT FROM 'true'::jsonb OR NEW.input_digest IS DISTINCT FROM source.proof->>'input_digest'
 OR NOT(actual_cache ?& ARRAY['voice','promotion']) OR NEW.base_cache IS DISTINCT FROM actual_cache
 OR NEW.proof_json::jsonb->>'listening_proof_digest' IS DISTINCT FROM source.proof_digest OR NEW.proof_json::jsonb->'listening_evaluations' IS DISTINCT FROM source.proof->'evaluations'
 OR NEW.attributes IS DISTINCT FROM signal_study_attributes_v1(actual_cache,source.proof,m.platform)
 OR NEW.listening_topic_keys IS DISTINCT FROM ARRAY(SELECT e->>'question_key' FROM jsonb_array_elements(source.proof->'evaluations') e WHERE COALESCE((e->>'human_belongs')::boolean,(e->>'probability')::numeric>=.7) ORDER BY e->>'question_key')
 OR m.canonical_mention_id IS DISTINCT FROM m.id OR m.inclusion_status<>'included' OR NEW.occurred_at IS DISTINCT FROM m.published_at
 OR NEW.channel IS DISTINCT FROM COALESCE(m.platform,'unknown') OR NEW.source_url IS DISTINCT FROM COALESCE(m.url,'')
 OR m.published_at<(cfg.envelope#>>'{study,cut,start_at}')::timestamptz OR m.published_at>=(cfg.envelope#>>'{study,cut,end_at}')::timestamptz
 OR EXISTS(SELECT 1 FROM jsonb_each(cfg.envelope#>'{study,cut,filters}') f WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.value) allowed(value) WHERE NEW.attributes->f.key ? allowed.value))
 OR EXISTS(SELECT 1 FROM unnest(NEW.question_cache_ids) id WHERE NOT EXISTS(SELECT 1 FROM signal_study_answers a WHERE a.id=id AND a.workspace_id=NEW.workspace_id AND a.root_id=NEW.root_id AND a.target_digest=signal_study_target_digest_v1(cfg.envelope)))
 THEN RAISE EXCEPTION 'study_native_cut_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_source_cut_guard BEFORE INSERT ON signal_study_source_roots FOR EACH ROW EXECUTE FUNCTION signal_study_source_cut_guard_v1();

CREATE FUNCTION signal_study_expected_cut_roots_v1(target uuid) RETURNS TABLE(root_id uuid) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT r.root_id FROM signal_study_executions p JOIN signal_study_configurations cfg ON cfg.id=p.configuration_id AND cfg.workspace_id=p.workspace_id
 JOIN signal_listening_serving_snapshots s ON s.id=cfg.listening_snapshot_id AND s.workspace_id=p.workspace_id
 JOIN signal_listening_discovery_roots r ON r.generation_id=s.generation_id AND r.workspace_id=s.workspace_id
 JOIN signal_mass_labeling_maps map ON map.id=s.map_id AND map.workspace_id=s.workspace_id
 JOIN mentions m ON m.id=r.root_id AND m.workspace_id=r.workspace_id AND m.canonical_mention_id=m.id AND m.inclusion_status='included'
 CROSS JOIN LATERAL(SELECT signal_study_attributes_v1(signal_study_listening_cache_v1(p.workspace_id,cfg.listening_configuration_id,r.root_id,r.proof->>'input_digest',map.entity_context_digest),r.proof,m.platform) value) attributes
 WHERE p.id=target AND r.proof->'in_category'='true'::jsonb AND signal_listening_root_right_v1(p.workspace_id,r.root_id,'llm-processing')
 AND m.published_at>=(cfg.envelope#>>'{study,cut,start_at}')::timestamptz AND m.published_at<(cfg.envelope#>>'{study,cut,end_at}')::timestamptz
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(cfg.envelope#>'{study,cut,filters}') f WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.value) allowed(value) WHERE attributes.value->f.key ? allowed.value))
$$;
CREATE FUNCTION signal_study_source_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE cfg signal_study_configurations;map signal_mass_labeling_maps;total integer;in_period integer;
BEGIN
 SELECT * INTO cfg FROM signal_study_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id;
 SELECT m.* INTO map FROM signal_listening_serving_snapshots s JOIN signal_mass_labeling_maps m ON m.id=s.map_id AND m.workspace_id=s.workspace_id WHERE s.id=cfg.listening_snapshot_id;
 IF NEW.map_id IS DISTINCT FROM map.id OR NEW.entity_context_digest IS DISTINCT FROM map.entity_context_digest OR NEW.source_header->'configuration' IS DISTINCT FROM cfg.envelope
 OR NEW.source_header->>'human_revision_digest' IS DISTINCT FROM cfg.human_revision_digest
 OR NEW.source_header#>>'{selection,scope}' IS DISTINCT FROM 'listening_consumer_cut'
 OR NEW.source_header#>>'{selection,source_listening_digest}' IS DISTINCT FROM cfg.listening_configuration_digest
 OR NEW.source_header#>>'{selection,cut_digest}' IS DISTINCT FROM signal_labeling_digest_v1(cfg.envelope#>'{study,cut}')
 OR(NEW.source_header#>>'{selection,eligible_roots}')::integer IS DISTINCT FROM NEW.source_roots
 OR(NEW.source_header#>>'{selection,pending_base_roots}')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'study_source_header_invalid';END IF;
 IF TG_OP='UPDATE' AND OLD.status='building' THEN
  IF NEW.source_roots<>(SELECT count(*) FROM signal_study_expected_cut_roots_v1(NEW.id))
   OR EXISTS(SELECT 1 FROM signal_study_expected_cut_roots_v1(NEW.id) expected WHERE NOT EXISTS(SELECT 1 FROM signal_study_source_roots actual WHERE actual.execution_id=NEW.id AND actual.root_id=expected.root_id))
   OR NEW.source_header#>>'{selection,eligible_root_ids_digest}' IS DISTINCT FROM(SELECT signal_labeling_digest_v1(COALESCE(jsonb_agg(root_id ORDER BY root_id),'[]'::jsonb)) FROM signal_study_source_roots WHERE execution_id=NEW.id)
   THEN RAISE EXCEPTION 'study_source_cut_incomplete';END IF;
  SELECT count(*)::integer,count(*) FILTER(WHERE m.published_at>=(cfg.envelope#>>'{study,cut,start_at}')::timestamptz AND m.published_at<(cfg.envelope#>>'{study,cut,end_at}')::timestamptz)::integer INTO total,in_period
  FROM signal_listening_serving_snapshots s JOIN signal_listening_discovery_roots r ON r.generation_id=s.generation_id AND r.workspace_id=s.workspace_id
  JOIN mentions m ON m.id=r.root_id AND m.workspace_id=r.workspace_id WHERE s.id=cfg.listening_snapshot_id AND signal_listening_root_right_v1(r.workspace_id,r.root_id,'client-derived-metrics');
  IF(NEW.source_header#>>'{selection,corpus_roots}')::integer IS DISTINCT FROM total OR(NEW.source_header->>'brand_baseline_roots')::integer IS DISTINCT FROM in_period THEN RAISE EXCEPTION 'study_source_baseline_invalid';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_source_complete BEFORE INSERT OR UPDATE ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_study_source_complete_v1();
CREATE FUNCTION signal_study_human_configuration_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE previous signal_study_configurations;q jsonb;
BEGIN
 q:=NEW.envelope->'question_configuration';
 IF NEW.human_revision_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_object('study_id',NEW.study_id,'revision',NEW.revision,'configuration_digest',NEW.configuration_digest,'questions',q)) THEN RAISE EXCEPTION 'study_human_revision_invalid';END IF;
 SELECT * INTO previous FROM signal_study_configurations WHERE study_id=NEW.study_id AND workspace_id=NEW.workspace_id ORDER BY revision DESC LIMIT 1;
 IF previous.id IS NOT NULL AND NEW.provenance='human' AND(
  previous.envelope#>>'{question_configuration,instructions}' IS DISTINCT FROM q->>'instructions' AND q->'human_locked' IS DISTINCT FROM 'true'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(q->'questions') updated WHERE updated-'human_locked' IS DISTINCT FROM(SELECT value-'human_locked' FROM jsonb_array_elements(previous.envelope#>'{question_configuration,questions}') WHERE value->>'key'=updated->>'key') AND updated->'human_locked' IS DISTINCT FROM 'true'::jsonb)) THEN RAISE EXCEPTION 'study_human_revision_must_lock';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_study_human_configuration_guard BEFORE INSERT ON signal_study_configurations FOR EACH ROW EXECUTE FUNCTION signal_study_human_configuration_guard_v1();

-- Add the exact owner as a third XOR branch, retaining previous expressions.
ALTER TABLE engine_cost_events ADD COLUMN study_step_id uuid,
 ADD CONSTRAINT signal_study_step_money FOREIGN KEY(workspace_id,study_step_id) REFERENCES signal_study_steps(workspace_id,id);
DO $ddl$DECLARE old_expression text;BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT old_expression FROM pg_constraint WHERE conrelid='engine_cost_events'::regclass AND conname='workspace_interpretation_shape';
 ALTER TABLE engine_cost_events DROP CONSTRAINT workspace_interpretation_shape;
 EXECUTE 'ALTER TABLE engine_cost_events ADD CONSTRAINT workspace_interpretation_shape CHECK(('||old_expression||') AND study_step_id IS NULL OR COALESCE(workspace_contract=''signal-study-step-v1'' AND engine_analysis_id IS NULL AND pipeline_step_id IS NULL AND catalog_execution_id IS NULL AND listening_round_id IS NULL AND study_step_id IS NOT NULL AND workspace_id IS NOT NULL AND actor_user_id IS NOT NULL AND provider=''anthropic'' AND model=''claude-sonnet-4-6'' AND operation=''signal-study-analysis'' AND call_configuration=signal_study_analysis_configuration_v1() AND call_state IN(''reserved'',''in_flight'',''response_persisted'',''settled'',''outcome_unknown'',''definitely_not_sent'') AND attempt_token IS NOT NULL AND retry_of_call_id IS NULL AND reserved_micro_usd>0 AND budget_date IS NOT NULL AND budget_timezone IS NOT NULL AND (settled_micro_usd IS NULL OR settled_micro_usd>=0) AND (call_state<>''settled'' OR settled_micro_usd IS NOT NULL AND settled_at IS NOT NULL AND response_storage_key IS NOT NULL),false))';
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT old_expression FROM pg_constraint WHERE conrelid='signal_processing_policy_actions'::regclass AND conname='signal_processing_action_name';
 ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_name;
 EXECUTE 'ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_name CHECK(('||old_expression||') OR action=''study_analysis'')';
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT old_expression FROM pg_constraint WHERE conrelid='signal_processing_policy_actions'::regclass AND conname='signal_processing_action_provider';
 ALTER TABLE signal_processing_policy_actions DROP CONSTRAINT signal_processing_action_provider;
 EXECUTE 'ALTER TABLE signal_processing_policy_actions ADD CONSTRAINT signal_processing_action_provider CHECK(('||old_expression||') OR(kind=''provider'' AND action=''study_analysis'' AND provider=''anthropic'' AND model=''claude-sonnet-4-6'' AND configuration=signal_study_analysis_configuration_v1()))';
END $ddl$;
CREATE UNIQUE INDEX signal_study_one_physical_step ON engine_cost_events(study_step_id) WHERE workspace_contract='signal-study-step-v1';
CREATE INDEX signal_study_money_day ON engine_cost_events(processing_organization_id,budget_date,id) INCLUDE(call_state,reserved_micro_usd,settled_micro_usd) WHERE workspace_contract='signal-study-step-v1';
-- All old producers call this same OID; the added sums participate in their locks.
DO $ddl$DECLARE prior text;BEGIN
 SELECT pg_get_functiondef('signal_processing_org_exposure_v1(uuid,date,text,text,uuid)'::regprocedure) INTO prior;
 EXECUTE replace(prior,'FUNCTION public.signal_processing_org_exposure_v1(', 'FUNCTION public.signal_processing_org_exposure_history0306_v1(');
END $ddl$;
CREATE OR REPLACE FUNCTION signal_processing_org_exposure_v1(target_org uuid,target_day date,target_timezone text,excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL)
 RETURNS TABLE(confirmed_micro_usd bigint,reserved_micro_usd bigint,ambiguous_micro_usd bigint,total_micro_usd bigint) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH prior AS(SELECT * FROM signal_processing_org_exposure_history0306_v1(target_org,target_day,target_timezone,excluded_ledger,excluded_id)),study AS(
 SELECT COALESCE(sum(settled_micro_usd) FILTER(WHERE call_state='settled'),0)::bigint confirmed,
 COALESCE(sum(reserved_micro_usd) FILTER(WHERE call_state IN('reserved','in_flight','response_persisted')),0)::bigint reserved,
 COALESCE(sum(reserved_micro_usd) FILTER(WHERE call_state='outcome_unknown'),0)::bigint ambiguous
 FROM engine_cost_events WHERE workspace_contract='signal-study-step-v1' AND processing_organization_id=target_org AND budget_date=target_day
 AND NOT COALESCE(excluded_ledger='study' AND id=excluded_id,false))
 SELECT prior.confirmed_micro_usd+study.confirmed,prior.reserved_micro_usd+study.reserved,prior.ambiguous_micro_usd+study.ambiguous,
 prior.total_micro_usd+study.confirmed+study.reserved+study.ambiguous FROM prior,study
$$;
CREATE FUNCTION signal_study_exposure_v1(target uuid,excluded_ledger text DEFAULT NULL,excluded_id uuid DEFAULT NULL) RETURNS bigint LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT sum(CASE WHEN call_state='settled' THEN settled_micro_usd ELSE reserved_micro_usd END) FROM signal_study_steps s JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=target
  AND c.workspace_contract='signal-study-step-v1' AND c.call_state<>'definitely_not_sent' AND NOT COALESCE(excluded_ledger='study' AND c.id=excluded_id,false)),0)
 +COALESCE((SELECT sum(CASE WHEN c.status='settled' OR c.status='failed' AND c.settled_micro_usd IS NOT NULL THEN c.settled_micro_usd WHEN c.status IN('reserved','submitting','submitted','unknown') THEN c.reserved_micro_usd ELSE 0 END+COALESCE(c.terminal_exposure_micro_usd,0))
  FROM signal_study_jev_batches b JOIN signal_labeling_calls c ON c.run_id=b.run_id AND c.workspace_id=b.workspace_id WHERE b.execution_id=target AND NOT COALESCE(excluded_ledger='labeling' AND c.id=excluded_id,false)),0)
$$;
CREATE FUNCTION signal_study_receipt_v1(raw_json text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE r jsonb;b bytea;validation_bytes bytea;valid boolean:=true;body text;
BEGIN
 IF octet_length(raw_json)>12582912 THEN RAISE EXCEPTION 'study_receipt_invalid';END IF;
 r:=raw_json::jsonb;
 IF jsonb_typeof(r)<>'object' OR(SELECT count(*) FROM json_each(raw_json::json))<>7 OR(SELECT count(*) FROM jsonb_each(r))<>7
 OR NOT(r ?& ARRAY['contract_version','body_base64','body_bytes','sha256','complete','http_status','provider_request_id'])
 OR r->>'contract_version' IS DISTINCT FROM 'signal-study-receipt-v1'
 OR jsonb_typeof(r->'body_base64') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'complete') IS DISTINCT FROM 'boolean'
 OR COALESCE(r->>'body_bytes','')!~'^(0|[1-9][0-9]*)$' OR(r->>'body_bytes')::bigint>8388608
 OR r->>'sha256'!~'^sha256:[0-9a-f]{64}$' OR jsonb_typeof(r->'http_status') NOT IN('number','null')
 OR r->'http_status'<>'null'::jsonb AND(COALESCE(r->>'http_status','')!~'^[1-5][0-9]{2}$')
 OR jsonb_typeof(r->'provider_request_id') NOT IN('string','null') OR length(r->>'provider_request_id')>200 THEN RAISE EXCEPTION 'study_receipt_invalid';END IF;
 b:=decode(r->>'body_base64','base64');IF replace(encode(b,'base64'),E'\n','') IS DISTINCT FROM r->>'body_base64' OR octet_length(b)<>(r->>'body_bytes')::bigint
 OR r->>'sha256' IS DISTINCT FROM 'sha256:'||encode(sha256(b),'hex') THEN RAISE EXCEPTION 'study_receipt_invalid';END IF;
 validation_bytes:=b;IF position(decode('00','hex') IN b)>0 THEN SELECT COALESCE(string_agg(substring(b FROM i+1 FOR 1),''::bytea) FILTER(WHERE get_byte(b,i)<>0),'\x'::bytea) INTO validation_bytes FROM generate_series(0,octet_length(b)-1) i;END IF;
 BEGIN body:=convert_from(validation_bytes,'UTF8');EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN valid:=false;END;
 RETURN r||jsonb_build_object('utf8_valid',valid);
END $$;
CREATE FUNCTION signal_study_raw_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE s signal_study_steps;c engine_cost_events;r jsonb;
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND(OLD.verification_status<>'planned' OR NEW.verification_status<>'verified' OR NEW.verified_at IS NULL
  OR(to_jsonb(NEW)-ARRAY['verification_status','verified_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['verification_status','verified_at'])) THEN RAISE EXCEPTION 'study_receipt_immutable';END IF;
 SELECT * INTO s FROM signal_study_steps WHERE id=NEW.step_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO c FROM engine_cost_events WHERE study_step_id=s.id AND workspace_id=s.workspace_id AND workspace_contract='signal-study-step-v1';
 r:=signal_study_receipt_v1(NEW.raw_json);
 IF s.id IS NULL OR s.execution_id<>NEW.execution_id OR c.id IS NULL OR c.attempt_token<>NEW.attempt_token OR c.call_state NOT IN('in_flight','outcome_unknown')
 OR NEW.storage_key NOT LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||NEW.execution_id::text||'/%' OR NEW.body_sha256 IS DISTINCT FROM r->>'sha256'
 OR TG_OP='INSERT' AND(NEW.verification_status<>'planned' OR NEW.verified_at IS NOT NULL) THEN RAISE EXCEPTION 'study_receipt_binding_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_raw_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_receipts FOR EACH ROW EXECUTE FUNCTION signal_study_raw_guard_v1();
CREATE FUNCTION signal_study_admission_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.action='study_analysis' AND NOT EXISTS(SELECT 1 FROM signal_study_steps s JOIN signal_study_executions p ON p.id=s.execution_id AND p.workspace_id=s.workspace_id
 WHERE s.id=NEW.target_id AND s.workspace_id=NEW.workspace_id AND p.organization_id=NEW.organization_id AND p.actor_user_id=NEW.actor_user_id AND p.policy_version_id=NEW.policy_version_id
 AND(s.admission_id IS NULL OR s.admission_id=NEW.id) AND s.request_sha256=NEW.request_digest AND s.reservation_micro_usd=NEW.execution_cap_micro_usd
 AND NEW.configuration=signal_study_analysis_configuration_v1() AND NEW.provider='anthropic' AND NEW.model='claude-sonnet-4-6' AND NOT NEW.automatic
 AND NEW.brand_context_processing_receipt_id IS NULL AND NEW.brand_context_prototype_receipt_id IS NULL) THEN RAISE EXCEPTION 'study_admission_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER z_study_admission_guard BEFORE INSERT ON signal_processing_admissions FOR EACH ROW EXECUTE FUNCTION signal_study_admission_guard_v1();
CREATE FUNCTION signal_study_money_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE s signal_study_steps;p signal_study_executions;a signal_processing_admissions;receipt signal_study_receipts;transport jsonb;body jsonb;usage jsonb;expected bigint;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.workspace_contract='signal-study-step-v1' THEN RAISE EXCEPTION 'study_money_immutable';END IF;RETURN OLD;END IF;
 IF TG_OP='UPDATE' AND(OLD.workspace_contract='signal-study-step-v1' OR NEW.workspace_contract='signal-study-step-v1') AND NEW.workspace_contract IS DISTINCT FROM OLD.workspace_contract THEN RAISE EXCEPTION 'study_money_immutable';END IF;
 IF NEW.workspace_contract IS DISTINCT FROM 'signal-study-step-v1' THEN RETURN NEW;END IF;
 SELECT * INTO s FROM signal_study_steps WHERE id=NEW.study_step_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO p FROM signal_study_executions WHERE id=s.execution_id AND workspace_id=s.workspace_id;
 SELECT * INTO a FROM signal_processing_admissions WHERE id=s.admission_id AND workspace_id=s.workspace_id;
 IF p.id IS NULL OR a.id IS NULL THEN RAISE EXCEPTION 'study_money_owner_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||p.organization_id::text,0));PERFORM signal_processing_lock_v1(p.organization_id,a.budget_date);
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-study-config:'||p.study_id::text,0));
 IF ROW(NEW.workspace_id,NEW.actor_user_id,NEW.request_digest,NEW.request_seal,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone)
  IS DISTINCT FROM ROW(s.workspace_id,p.actor_user_id,s.request_sha256,s.request_sha256,s.reservation_micro_usd,a.budget_date,a.budget_timezone)
 OR NEW.idempotency_key IS DISTINCT FROM 'study-step:'||s.id::text OR NEW.call_configuration IS DISTINCT FROM signal_study_analysis_configuration_v1()
 OR a.policy_version_id<>p.policy_version_id OR a.action<>'study_analysis' OR a.target_id<>s.id OR a.request_digest<>s.request_sha256 THEN RAISE EXCEPTION 'study_money_binding_invalid';END IF;
 IF TG_OP='INSERT' OR OLD.call_state='reserved' AND NEW.call_state='in_flight' THEN
  PERFORM signal_processing_lock_actor_v1(p.workspace_id,p.actor_user_id);
  SELECT * INTO p FROM signal_study_executions WHERE id=p.id FOR UPDATE;
  IF p.status<>'running' OR p.execution_token IS NULL OR p.execution_expires_at<=clock_timestamp() OR NEW.metadata->>'lease_token' IS DISTINCT FROM p.execution_token::text
  OR NOT COALESCE(signal_study_source_current_v1(p.id),false) THEN RAISE EXCEPTION 'study_send_authority_invalid';END IF;
  PERFORM signal_processing_capacity_v1(p.workspace_id,p.actor_user_id,s.id,s.admission_id,ARRAY['study_analysis'],'anthropic','claude-sonnet-4-6',NEW.call_configuration,s.reservation_micro_usd,'study',NEW.id,NEW.reserved_micro_usd,NEW.created_at);
  IF signal_study_exposure_v1(p.id,'study',NEW.id)+NEW.reserved_micro_usd>p.cap_micro_usd THEN RAISE EXCEPTION 'study_parent_cap_exhausted';END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.call_state<>'reserved' OR NEW.sent_at IS NOT NULL OR NEW.response_storage_key IS NOT NULL OR NEW.settled_micro_usd IS NOT NULL THEN RAISE EXCEPTION 'study_money_must_reserve';END IF;RETURN NEW;
 END IF;
 IF(to_jsonb(NEW)-ARRAY['call_state','sent_at','response_storage_key','response_sha256','response_size_bytes','response_http_status','provider_request_id','response_received_at','settled_micro_usd','settled_at','input_tokens','output_tokens','total_tokens','metadata'])
 IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['call_state','sent_at','response_storage_key','response_sha256','response_size_bytes','response_http_status','provider_request_id','response_received_at','settled_micro_usd','settled_at','input_tokens','output_tokens','total_tokens','metadata'])
 OR NEW.metadata-ARRAY['usage','error_code','response_complete','lease_token'] IS DISTINCT FROM OLD.metadata-ARRAY['usage','error_code','response_complete','lease_token']
 OR NEW.metadata->>'lease_token' IS DISTINCT FROM OLD.metadata->>'lease_token' AND NOT(NEW.call_state='reserved' AND OLD.call_state='reserved' AND OLD.sent_at IS NULL AND NEW.metadata->>'lease_token'=p.execution_token::text AND p.execution_expires_at>clock_timestamp())
 OR OLD.call_state IN('settled','definitely_not_sent') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
 OR NOT(NEW.call_state=OLD.call_state OR OLD.call_state='reserved' AND NEW.call_state IN('in_flight','definitely_not_sent') OR OLD.call_state='in_flight' AND NEW.call_state IN('response_persisted','outcome_unknown') OR OLD.call_state='outcome_unknown' AND NEW.call_state='response_persisted' OR OLD.call_state='response_persisted' AND NEW.call_state IN('settled','outcome_unknown')) THEN RAISE EXCEPTION 'study_money_transition_invalid';END IF;
 IF NEW.call_state='definitely_not_sent' AND(OLD.call_state<>'reserved' OR OLD.sent_at IS NOT NULL OR NEW.sent_at IS NOT NULL OR OLD.response_storage_key IS NOT NULL OR EXISTS(SELECT 1 FROM signal_study_receipts WHERE step_id=s.id) OR p.status NOT IN('stale','failed','budget_exhausted')) THEN RAISE EXCEPTION 'study_not_sent_unproven';END IF;
 IF NEW.sent_at IS DISTINCT FROM OLD.sent_at AND NOT(OLD.call_state='reserved' AND NEW.call_state='in_flight' AND OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL) OR NEW.call_state='in_flight' AND NEW.sent_at IS NULL THEN RAISE EXCEPTION 'study_sent_immutable';END IF;
 IF NEW.response_storage_key IS NOT NULL THEN
  SELECT * INTO receipt FROM signal_study_receipts WHERE step_id=s.id AND workspace_id=s.workspace_id;
  IF receipt.verification_status IS DISTINCT FROM 'verified' OR ROW(receipt.attempt_token,receipt.storage_key,receipt.raw_sha256,receipt.raw_size_bytes)
   IS DISTINCT FROM ROW(NEW.attempt_token,NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes)
  OR OLD.response_storage_key IS NOT NULL AND ROW(NEW.response_storage_key,NEW.response_sha256,NEW.response_size_bytes,NEW.response_http_status,NEW.provider_request_id,NEW.metadata->'response_complete')
   IS DISTINCT FROM ROW(OLD.response_storage_key,OLD.response_sha256,OLD.response_size_bytes,OLD.response_http_status,OLD.provider_request_id,OLD.metadata->'response_complete') THEN RAISE EXCEPTION 'study_verified_receipt_required';END IF;
  transport:=signal_study_receipt_v1(receipt.raw_json);
  IF NEW.response_http_status IS DISTINCT FROM(transport->>'http_status')::integer OR NEW.provider_request_id IS DISTINCT FROM transport->>'provider_request_id'
   OR NEW.metadata->'response_complete' IS DISTINCT FROM to_jsonb((transport->>'complete')::boolean AND(transport->>'utf8_valid')::boolean)
   OR NEW.call_state IN('response_persisted','settled') AND(transport->'complete'<>'true'::jsonb OR transport->'utf8_valid'<>'true'::jsonb OR NEW.response_http_status IS DISTINCT FROM 200) THEN RAISE EXCEPTION 'study_transport_incomplete';END IF;
 END IF;
 IF NEW.call_state='settled' THEN
  body:=convert_from(decode(transport->>'body_base64','base64'),'UTF8')::jsonb;usage:=body->'usage';
  IF NEW.response_storage_key IS NULL OR NEW.response_http_status IS DISTINCT FROM 200 OR body->>'model'!~'^claude-sonnet-4-6(-[0-9]{8})?$' OR jsonb_typeof(usage) IS DISTINCT FROM 'object'
  OR COALESCE(usage->>'input_tokens','')!~'^[0-9]+$' OR COALESCE(usage->>'output_tokens','')!~'^[0-9]+$'
  OR COALESCE(usage->>'cache_read_input_tokens','0')!~'^[0-9]+$' OR COALESCE(usage->>'cache_creation_input_tokens','0')!~'^[0-9]+$'
  OR COALESCE(usage#>>'{cache_creation,ephemeral_5m_input_tokens}','0')!~'^[0-9]+$' OR COALESCE(usage#>>'{cache_creation,ephemeral_1h_input_tokens}','0')!~'^[0-9]+$' THEN RAISE EXCEPTION 'study_usage_invalid';END IF;
  expected:=ceil((usage->>'input_tokens')::numeric*3+(usage->>'output_tokens')::numeric*15+COALESCE((usage->>'cache_read_input_tokens')::numeric,0)*.3+COALESCE((usage#>>'{cache_creation,ephemeral_5m_input_tokens}')::numeric,0)*3.75+COALESCE((usage#>>'{cache_creation,ephemeral_1h_input_tokens}')::numeric,0)*6);
  IF COALESCE((usage->>'cache_creation_input_tokens')::bigint,0)<>COALESCE((usage#>>'{cache_creation,ephemeral_5m_input_tokens}')::bigint,0)+COALESCE((usage#>>'{cache_creation,ephemeral_1h_input_tokens}')::bigint,0)
   OR NEW.settled_micro_usd IS DISTINCT FROM expected OR NEW.input_tokens IS DISTINCT FROM(usage->>'input_tokens')::integer OR NEW.output_tokens IS DISTINCT FROM(usage->>'output_tokens')::integer
   OR NEW.total_tokens IS DISTINCT FROM NEW.input_tokens+NEW.output_tokens+COALESCE((usage->>'cache_creation_input_tokens')::integer,0)+COALESCE((usage->>'cache_read_input_tokens')::integer,0)
   OR NEW.metadata->'usage' IS DISTINCT FROM usage THEN RAISE EXCEPTION 'study_usage_mismatch';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER aab_signal_study_ledger BEFORE INSERT OR UPDATE OR DELETE ON engine_cost_events FOR EACH ROW EXECUTE FUNCTION signal_study_money_guard_v1();
DO $ddl$DECLARE prior text;BEGIN
 SELECT pg_get_functiondef('guard_workspace_engine_interpretation_v1()'::regprocedure) INTO prior;
 IF position(E'BEGIN\n' IN prior)=0 THEN RAISE EXCEPTION 'study_legacy_guard_shape_changed';END IF;
 EXECUTE replace(prior,E'BEGIN\n',E'BEGIN\n IF TG_OP<>''DELETE'' AND NEW.workspace_contract=''signal-study-step-v1'' THEN RETURN NEW;END IF;\n');
END $ddl$;
CREATE FUNCTION signal_study_step_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;body jsonb;marker jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'study_step_immutable';END IF;
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 IF p.id IS NULL OR NEW.source_digest<>p.source_digest THEN RAISE EXCEPTION 'study_step_source_invalid';END IF;
 IF TG_OP='INSERT' THEN
  body:=NEW.request_body::jsonb;marker:=NULLIF(current_setting('noisia.study_expected_step_v1',true),'')::jsonb;
  IF p.status<>'running' OR p.execution_token IS NULL OR p.execution_expires_at<=clock_timestamp() OR NOT COALESCE(signal_study_source_current_v1(p.id),false)
   OR NEW.status<>'planned' OR NEW.sent_token IS NOT NULL OR NEW.value IS NOT NULL OR NEW.admission_id IS NOT NULL
   OR body->>'model' IS DISTINCT FROM 'claude-sonnet-4-6' OR body->>'max_tokens' IS DISTINCT FROM NEW.maximum_output_tokens::text OR body#>>'{thinking,type}' IS DISTINCT FROM 'disabled'
   OR body ? 'tools' OR octet_length(NEW.request_body)>524288 OR NEW.reservation_micro_usd<>(octet_length(NEW.request_body)+4096)::bigint*6+NEW.maximum_output_tokens::bigint*15
   OR marker IS DISTINCT FROM jsonb_build_object('execution_id',p.id,'execution_token',p.execution_token,'step_key',NEW.step_key,'request_sha256',NEW.request_sha256,'mode',NEW.mode)
   THEN RAISE EXCEPTION 'study_step_not_derived';END IF;
 ELSE
  IF(to_jsonb(NEW)-ARRAY['status','sent_token','admission_id','value','value_digest','error_code','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','sent_token','admission_id','value','value_digest','error_code','updated_at'])
   OR OLD.admission_id IS NOT NULL AND NEW.admission_id IS DISTINCT FROM OLD.admission_id OR OLD.sent_token IS NOT NULL AND NEW.sent_token IS DISTINCT FROM OLD.sent_token
   OR OLD.value IS NOT NULL AND ROW(NEW.value,NEW.value_digest) IS DISTINCT FROM ROW(OLD.value,OLD.value_digest)
   OR NOT(NEW.status=OLD.status OR OLD.status='planned' AND NEW.status='sent' OR OLD.status IN('sent','unknown') AND NEW.status='raw' OR OLD.status='raw' AND NEW.status IN('committed','unknown') OR OLD.status='sent' AND NEW.status='unknown') THEN RAISE EXCEPTION 'study_step_immutable';END IF;
  IF NEW.status='sent' AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE study_step_id=NEW.id AND workspace_contract='signal-study-step-v1' AND call_state='in_flight' AND metadata->>'lease_token'=p.execution_token::text AND attempt_token=NEW.sent_token)
   THEN RAISE EXCEPTION 'study_sent_receipt_required';END IF;
  IF NEW.status='raw' AND NOT EXISTS(SELECT 1 FROM signal_study_receipts WHERE step_id=NEW.id AND verification_status='verified') THEN RAISE EXCEPTION 'study_raw_required';END IF;
  IF NEW.status='committed' AND(NEW.value IS NULL OR NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE study_step_id=NEW.id AND call_state='settled') OR NOT COALESCE(signal_study_source_current_v1(p.id),false)
   OR p.status<>'running' OR p.execution_token IS NULL OR p.execution_expires_at<=clock_timestamp()
   OR NULLIF(current_setting('noisia.study_commit_v1',true),'')::jsonb IS DISTINCT FROM jsonb_build_object('execution_id',p.id,'execution_token',p.execution_token,'step_key',NEW.step_key,'value_digest',NEW.value_digest)) THEN RAISE EXCEPTION 'study_commit_not_derived';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_step_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_steps FOR EACH ROW EXECUTE FUNCTION signal_study_step_guard_v1();
CREATE FUNCTION signal_study_prior_unknown_roots_v1(target uuid,selected_root uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_study_jev_members fresh JOIN signal_study_jev_members old ON old.workspace_id=fresh.workspace_id AND old.root_id=fresh.root_id AND old.state_sha256=fresh.state_sha256 AND old.target_digest=fresh.target_digest AND old.batch_id<>fresh.batch_id
 JOIN signal_study_jev_calls link ON link.batch_id=old.batch_id AND link.root_id=old.root_id JOIN signal_labeling_calls c ON c.id=link.call_id AND c.workspace_id=link.workspace_id
 WHERE fresh.batch_id=target AND(selected_root IS NULL OR fresh.root_id=selected_root) AND(c.status IN('reserved','submitting','submitted','unknown') OR c.terminal_exposure_micro_usd>0 OR c.raw_storage_key IS NOT NULL AND NOT c.results_applied)
 AND EXISTS(SELECT 1 FROM jsonb_each_text(fresh.question_digests) q WHERE old.question_digests->>q.key=q.value))
$$;
CREATE FUNCTION signal_study_prior_unknown_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$ SELECT signal_study_prior_unknown_roots_v1(target,NULL) $$;
CREATE FUNCTION signal_study_late_cache_v1(target uuid,selected_root uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_study_jev_members m JOIN signal_study_source_roots source ON source.execution_id=m.execution_id AND source.workspace_id=m.workspace_id AND source.root_id=m.root_id
 JOIN signal_study_answers a ON a.workspace_id=m.workspace_id AND a.root_id=m.root_id AND a.state_sha256=m.state_sha256 AND a.target_digest=m.target_digest AND a.model='jev-1.13.0'
 WHERE m.batch_id=target AND(selected_root IS NULL OR m.root_id=selected_root) AND NOT(a.id=ANY(source.question_cache_ids)) AND m.question_digests->>a.question_key=a.question_digest)
$$;
CREATE FUNCTION signal_study_batch_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;r signal_labeling_runs;l signal_labeler_versions;marker jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'study_batch_immutable';END IF;
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'study_batch_owner_invalid';END IF;
 IF TG_OP='INSERT' THEN
  marker:=NULLIF(current_setting('noisia.study_batch_plan_v1',true),'')::jsonb;
  IF NEW.status<>'building' OR NEW.run_id IS NOT NULL OR NEW.checkpoint IS NOT NULL OR p.status<>'running' OR p.execution_expires_at<=clock_timestamp() OR p.execution_token IS DISTINCT FROM NEW.parent_execution_token
   OR NOT COALESCE(signal_study_source_current_v1(p.id),false) OR NEW.run_cap_micro_usd+signal_study_exposure_v1(p.id)>p.cap_micro_usd
   OR marker IS DISTINCT FROM jsonb_build_object('execution_id',p.id,'execution_token',p.execution_token,'batch_id',NEW.id,'plan_digest',NEW.plan_digest,'census_digest',NEW.request_census_digest)
   OR NEW.plan_header->>'execution_id' IS DISTINCT FROM p.id::text OR NEW.plan_header->>'source_digest' IS DISTINCT FROM p.source_digest
   OR NEW.plan_header->>'workspace_id' IS DISTINCT FROM p.workspace_id::text OR NEW.plan_header->>'stage_configuration_digest' IS DISTINCT FROM NEW.stage_configuration_digest
   OR NEW.plan_header->>'plan_digest' IS DISTINCT FROM NEW.plan_digest OR NEW.plan_header->>'stage' IS DISTINCT FROM NEW.stage
   OR NEW.plan_header->>'model' IS DISTINCT FROM 'jev-1.13.0' OR(NEW.plan_header->>'request_count')::integer<>NEW.request_count
   OR NEW.plan_header->'stage_dependencies' IS DISTINCT FROM NEW.stage_lineage OR NEW.target_digest IS DISTINCT FROM signal_study_target_digest_v1((SELECT envelope FROM signal_study_configurations WHERE id=p.configuration_id)) THEN RAISE EXCEPTION 'study_batch_not_derived';END IF;
 ELSE
  IF(to_jsonb(NEW)-ARRAY['run_id','status','checkpoint','parent_execution_token','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['run_id','status','checkpoint','parent_execution_token','updated_at'])
   OR OLD.run_id IS NOT NULL AND NEW.run_id IS DISTINCT FROM OLD.run_id OR OLD.checkpoint IS NOT NULL AND NEW.checkpoint IS DISTINCT FROM OLD.checkpoint
   OR NEW.parent_execution_token<>OLD.parent_execution_token AND(p.execution_token IS DISTINCT FROM NEW.parent_execution_token OR p.execution_expires_at<=clock_timestamp() OR NOT COALESCE(signal_study_source_current_v1(p.id),false)) THEN RAISE EXCEPTION 'study_batch_immutable';END IF;
  IF OLD.status='building' AND(NEW.status<>'planned' OR NEW.request_count<>(SELECT count(*) FROM signal_study_jev_members WHERE batch_id=NEW.id)
   OR NEW.request_census_digest IS DISTINCT FROM(SELECT signal_labeling_digest_v1(jsonb_agg(jsonb_build_array(m.root_id,m.request_sha256) ORDER BY m.root_id)) FROM signal_study_jev_members m WHERE m.batch_id=NEW.id)) THEN RAISE EXCEPTION 'study_batch_incomplete';END IF;
  IF NEW.run_id IS NOT NULL THEN
   SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id AND workspace_id=p.workspace_id;SELECT * INTO l FROM signal_labeler_versions WHERE id=r.labeler_version_id;
   IF r.id IS NULL OR r.kind<>'mass_labeling' OR r.actor_user_id<>p.actor_user_id OR r.cap_micro_usd<>NEW.run_cap_micro_usd OR r.entity_context_digest<>p.entity_context_digest
    OR l.identity#>>'{params,request_version}' IS DISTINCT FROM 'study-jev-batch-v1' OR l.identity#>>'{params,study_execution_id}' IS DISTINCT FROM p.id::text OR l.identity#>>'{params,batch_id}' IS DISTINCT FROM NEW.id::text
    OR l.identity#>>'{params,batch_plan_digest}' IS DISTINCT FROM NEW.plan_digest OR l.identity#>>'{params,source_digest}' IS DISTINCT FROM p.source_digest
    OR l.identity#>'{params,configuration}' IS DISTINCT FROM NEW.stage_configuration OR l.identity#>>'{params,configuration_digest}' IS DISTINCT FROM NEW.stage_configuration_digest THEN RAISE EXCEPTION 'study_batch_run_binding_invalid';END IF;
  END IF;
  IF NEW.status='completed' AND(NEW.checkpoint IS NULL OR NOT EXISTS(SELECT 1 FROM signal_labeling_runs WHERE id=NEW.run_id AND status='completed')
   OR NOT COALESCE(signal_study_source_current_v1(p.id),false)) THEN RAISE EXCEPTION 'study_batch_not_completed';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_jev_batches FOR EACH ROW EXECUTE FUNCTION signal_study_batch_guard_v1();
CREATE FUNCTION signal_study_member_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_study_jev_batches;p signal_study_executions;s signal_study_source_roots;request jsonb;q jsonb;k text;expected jsonb;expected_digest text;wire jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_member_immutable';END IF;
 SELECT * INTO b FROM signal_study_jev_batches WHERE id=NEW.batch_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO p FROM signal_study_executions WHERE id=b.execution_id AND workspace_id=b.workspace_id;
 SELECT * INTO s FROM signal_study_source_roots WHERE execution_id=p.id AND workspace_id=p.workspace_id AND root_id=NEW.root_id;
 request:=NEW.request_body::jsonb;
 IF b.status<>'building' OR s.root_id IS NULL OR NEW.execution_id<>p.id OR NEW.target_digest<>b.target_digest OR request->>'model' IS DISTINCT FROM 'jev-1.13.0'
 OR NEW.state_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(request->>'state','UTF8')),'hex') OR NEW.state_sha256 NOT IN(s.asset_sha256,s.chunk_sha256)
 OR NEW.question_keys IS DISTINCT FROM ARRAY(SELECT jsonb_object_keys(request->'questions') ORDER BY 1)
 OR NEW.input_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_object('scope','study','root_id',s.root_id,'source_digest',p.source_digest,'state_sha256',NEW.state_sha256,'target_digest',NEW.target_digest))
 THEN RAISE EXCEPTION 'study_member_binding_invalid';END IF;
 FOREACH k IN ARRAY NEW.question_keys LOOP
  SELECT value INTO q FROM jsonb_array_elements(b.stage_configuration->'questions') WHERE value->>'key'=k;
  IF q IS NULL OR k IN('voice','promotion') OR q->>'scope'<>'all' OR q->>'origin'='base' THEN RAISE EXCEPTION 'study_member_question_invalid';END IF;
  IF q->>'type'='choice' THEN
   SELECT jsonb_object_agg(value->>'key',value->>'definition') INTO expected FROM jsonb_array_elements(q->'options');
   wire:=jsonb_build_object('type','choice','text',q->>'text','criteria',expected);
  ELSE expected:=jsonb_build_object('true',q->>'positive','false',q->>'negative');wire:=jsonb_build_object('type','noul','text',q->>'text','positive',q->>'positive','negative',q->>'negative');END IF;
  expected_digest:=signal_labeling_digest_v1(jsonb_build_object('contract_version','study-jev-question-v1','scope','study','model','jev-1.13.0','target_digest',NEW.target_digest,'key',k,'instructions',b.stage_configuration->>'instructions','question',wire));
  IF NEW.question_digests->>k IS DISTINCT FROM expected_digest OR request#>ARRAY['questions',k] IS DISTINCT FROM jsonb_build_object('type',q->>'type','instructions',jsonb_build_object('rules',b.stage_configuration->>'instructions','question',q->>'text'),'criteria',expected) THEN RAISE EXCEPTION 'study_member_question_invalid';END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER aaa_signal_study_member_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_jev_members FOR EACH ROW EXECUTE FUNCTION signal_study_member_guard_v1();
DO $ddl$DECLARE prior text;BEGIN
 SELECT pg_get_functiondef('guard_signal_mass_labeling_admission_owner_v1()'::regprocedure) INTO prior;
 IF position(E'BEGIN\n' IN prior)=0 THEN RAISE EXCEPTION 'study_legacy_admission_guard_shape';END IF;
 EXECUTE replace(prior,E'BEGIN\n',$branch$BEGIN
 IF EXISTS(SELECT 1 FROM signal_study_jev_batches b JOIN signal_study_executions p ON p.id=b.execution_id AND p.workspace_id=b.workspace_id
 JOIN signal_labeling_runs r ON r.id=b.run_id AND r.workspace_id=b.workspace_id JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
 WHERE r.id=NEW.target_id AND b.workspace_id=NEW.workspace_id AND r.processing_admission_id=NEW.id AND NEW.actor_user_id=p.actor_user_id AND p.policy_version_id=NEW.policy_version_id
 AND r.kind='mass_labeling' AND l.kind='mass_labeling' AND l.provider='typesafe' AND l.model='jev-1.13.0'
 AND l.identity#>>'{params,request_version}'='study-jev-batch-v1' AND l.identity#>>'{params,batch_id}'=b.id::text AND l.identity#>>'{params,study_execution_id}'=p.id::text
 AND l.identity#>>'{params,batch_plan_digest}'=b.plan_digest AND l.identity#>'{params,configuration}'=b.stage_configuration AND l.identity#>>'{params,configuration_digest}'=b.stage_configuration_digest
 AND NEW.execution_cap_micro_usd=b.run_cap_micro_usd AND r.cap_micro_usd=b.run_cap_micro_usd
 AND NEW.configuration='{"contract_version":"mass-labeling-jev-v2","provider":"typesafe","model":"jev-1.13.0"}'::jsonb) THEN RETURN NEW;END IF;
$branch$);
END $ddl$;
CREATE FUNCTION signal_study_generation_header_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(g.status='ready' AND g.kind='confirmed_members' AND(g.counts->>'pending_base')::integer=0 AND(g.counts->>'pending_topics')::integer=0
 AND(g.counts->>'roots')::integer=(g.counts->>'map_roots')::integer AND(g.counts->>'cached_vectors')::integer=(g.counts->>'roots')::integer
 AND cfg.state='published'
 AND g.entity_context_digest=(SELECT digest FROM signal_entity_context_versions WHERE workspace_id=g.workspace_id ORDER BY version_no DESC LIMIT 1)
 AND EXISTS(SELECT 1 FROM signal_corpus_preparation_input_state state WHERE state.workspace_id=g.workspace_id AND state.input_revision=g.input_revision)
 AND EXISTS(SELECT 1 FROM signal_corpus_preparation_runs prep WHERE prep.id=g.preparation_run_id AND prep.workspace_id=g.workspace_id AND prep.status='completed' AND(prep.policy_valid_until IS NULL OR prep.policy_valid_until>clock_timestamp()))
 AND m.preparation_run_id=g.preparation_run_id AND m.input_revision=g.input_revision AND m.embedding_config_digest=g.embedding_config_digest AND m.entity_context_digest=g.entity_context_digest
 AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=g.workspace_id AND feature='mass_labeling')
,false)
 FROM signal_listening_discovery_generations g JOIN signal_mass_labeling_maps m ON m.id=g.map_id AND m.workspace_id=g.workspace_id
 JOIN signal_listening_configurations cfg ON cfg.id=g.configuration_id AND cfg.workspace_id=g.workspace_id WHERE g.id=target
$$;
CREATE FUNCTION signal_study_owner_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(p.configuration_id=(SELECT id FROM signal_study_configurations WHERE study_id=p.study_id AND workspace_id=p.workspace_id ORDER BY revision DESC LIMIT 1)
 AND cfg.configuration_digest=p.configuration_digest AND cfg.human_revision_digest=p.human_revision_digest AND signal_processing_actor_v1(p.workspace_id,p.actor_user_id)
 AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=p.workspace_id AND feature='mass_labeling')
 AND policy.status='active' AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp() AND policy.organization_id=p.organization_id
 AND EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='study_analysis' AND provider='anthropic' AND model='claude-sonnet-4-6' AND configuration=signal_study_analysis_configuration_v1())
 AND EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='mass_labeling_jev' AND provider='typesafe' AND model='jev-1.13.0')
 AND signal_study_generation_header_current_v1(snapshot.generation_id),false)
 FROM signal_study_executions p JOIN signal_study_configurations cfg ON cfg.id=p.configuration_id AND cfg.workspace_id=p.workspace_id
 JOIN signal_processing_policy_versions policy ON policy.id=p.policy_version_id JOIN signal_listening_serving_snapshots snapshot ON snapshot.id=cfg.listening_snapshot_id AND snapshot.workspace_id=p.workspace_id WHERE p.id=target
$$;
CREATE FUNCTION signal_study_jev_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_study_jev_batches;p signal_study_executions;r signal_labeling_runs;m signal_study_jev_members;l signal_labeler_versions;i jsonb;request_digest text;marker jsonb;
BEGIN
 IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM signal_study_jev_batches WHERE run_id=OLD.run_id) THEN RAISE EXCEPTION 'study_call_immutable';END IF;RETURN OLD;END IF;
 SELECT * INTO b FROM signal_study_jev_batches WHERE run_id=NEW.run_id;
 IF b.id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO p FROM signal_study_executions WHERE id=b.execution_id AND workspace_id=b.workspace_id;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=b.run_id AND workspace_id=b.workspace_id;SELECT * INTO l FROM signal_labeler_versions WHERE id=r.labeler_version_id;
 i:=NEW.inputs->0;SELECT * INTO m FROM signal_study_jev_members WHERE batch_id=b.id AND root_id=(i->>'root_id')::uuid AND workspace_id=b.workspace_id;
 request_digest:=signal_labeling_digest_v1(jsonb_build_object('labeler_digest',l.labeler_digest,'root_id',m.root_id,'input_digest',m.input_digest,'request_sha256',m.request_sha256,'question_digests',m.question_digests,'target_digest',m.target_digest));
 IF m.root_id IS NULL OR NEW.workspace_id<>b.workspace_id OR NEW.provider<>'typesafe' OR NEW.model<>'jev-1.13.0' OR NEW.transport<>'sync' OR jsonb_array_length(NEW.inputs)<>1
 OR NEW.request IS DISTINCT FROM m.request_body::jsonb OR NEW.request_digest IS DISTINCT FROM request_digest OR NEW.custom_id IS DISTINCT FROM 'study_'||substring(request_digest FROM 8 FOR 60)
 OR i->>'scope' IS DISTINCT FROM 'study' OR i->>'batch_id' IS DISTINCT FROM b.id::text OR i->>'plan_digest' IS DISTINCT FROM b.plan_digest OR i->>'request_body' IS DISTINCT FROM m.request_body
 OR i->>'request_sha256' IS DISTINCT FROM m.request_sha256 OR i->>'target_digest' IS DISTINCT FROM b.target_digest OR i->>'text' IS DISTINCT FROM NEW.request->>'state' OR i->>'input_digest' IS DISTINCT FROM m.input_digest
 OR i->'question_digests' IS DISTINCT FROM m.question_digests OR i->'question_keys' IS DISTINCT FROM to_jsonb(m.question_keys) OR i->>'configuration_digest' IS DISTINCT FROM b.stage_configuration_digest OR i->>'map_id' IS DISTINCT FROM p.map_id::text
 OR l.identity#>>'{params,request_version}' IS DISTINCT FROM 'study-jev-batch-v1' OR l.identity#>>'{params,batch_id}' IS DISTINCT FROM b.id::text THEN RAISE EXCEPTION 'study_call_plan_binding_invalid';END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.run_id,NEW.workspace_id,NEW.provider,NEW.model,NEW.transport,NEW.custom_id,NEW.request_digest,NEW.request,NEW.inputs,NEW.reserved_micro_usd,NEW.budget_date,NEW.budget_timezone,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.run_id,OLD.workspace_id,OLD.provider,OLD.model,OLD.transport,OLD.custom_id,OLD.request_digest,OLD.request,OLD.inputs,OLD.reserved_micro_usd,OLD.budget_date,OLD.budget_timezone,OLD.created_at)
   OR OLD.raw_sha256 IS NOT NULL AND ROW(NEW.raw_sha256,NEW.raw_storage_key,NEW.raw_size_bytes) IS DISTINCT FROM ROW(OLD.raw_sha256,OLD.raw_storage_key,OLD.raw_size_bytes)
   OR OLD.status='settled' AND ROW(NEW.status,NEW.usage,NEW.settled_micro_usd) IS DISTINCT FROM ROW(OLD.status,OLD.usage,OLD.settled_micro_usd)
   OR OLD.results IS NOT NULL AND NEW.results IS DISTINCT FROM OLD.results OR OLD.results_applied AND NOT NEW.results_applied THEN RAISE EXCEPTION 'study_call_immutable';END IF;
  IF OLD.status<>'reserved' AND NEW.status='reserved' THEN
   marker:=NULLIF(current_setting('noisia.labeling_unsent_requeue_v1',true),'')::jsonb;
   IF OLD.status<>'submitting' OR marker->>'contract_version' IS DISTINCT FROM 'signal-labeling-unsent-requeue-v1' OR marker->>'run_id' IS DISTINCT FROM r.id::text OR marker->>'workspace_id' IS DISTINCT FROM b.workspace_id::text
   OR marker->>'lease_token' IS DISTINCT FROM r.lease_token::text OR r.lease_until<=clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(marker->'calls') exact WHERE exact->>'id'=NEW.id::text AND exact->>'request_digest'=NEW.request_digest)
   OR OLD.raw_storage_key IS NOT NULL OR OLD.raw_sha256 IS NOT NULL OR OLD.usage IS NOT NULL OR OLD.settled_micro_usd IS NOT NULL OR OLD.results IS NOT NULL OR OLD.results_applied
   OR OLD.provider_batch_id IS NOT NULL OR OLD.terminal_exposure_micro_usd>0 OR EXISTS(SELECT 1 FROM signal_labeling_raw_page_members WHERE call_id=NEW.id) THEN RAISE EXCEPTION 'study_call_requeue_invalid';END IF;
  END IF;
 END IF;
 IF TG_OP='INSERT' OR OLD.status='reserved' AND NEW.status='submitting' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||p.organization_id::text,0));PERFORM signal_processing_lock_v1(p.organization_id,NEW.budget_date);PERFORM pg_advisory_xact_lock(hashtextextended('signal-study-config:'||p.study_id::text,0));PERFORM signal_processing_lock_actor_v1(p.workspace_id,p.actor_user_id);
  SELECT * INTO p FROM signal_study_executions WHERE id=b.execution_id FOR UPDATE;
  IF p.status<>'running' OR p.execution_token IS DISTINCT FROM b.parent_execution_token OR p.execution_expires_at<=clock_timestamp() OR NOT COALESCE(signal_study_owner_current_v1(p.id),false)
   OR NOT signal_listening_root_right_v1(p.workspace_id,m.root_id,'llm-processing') OR r.status<>'running' OR r.lease_token IS NULL OR r.lease_until<=clock_timestamp() OR NEW.reserved_micro_usd<=0
   OR signal_study_prior_unknown_roots_v1(b.id,m.root_id) OR signal_study_late_cache_v1(b.id,m.root_id) OR signal_study_exposure_v1(p.id,'labeling',NEW.id)+NEW.reserved_micro_usd>p.cap_micro_usd THEN RAISE EXCEPTION 'study_call_authority_invalid';END IF;
 END IF;
 IF NEW.status='settled' AND(NOT EXISTS(SELECT 1 FROM signal_labeling_raw_pages page JOIN signal_labeling_raw_page_members member ON member.page_id=page.id AND member.call_id=NEW.id
  WHERE page.workspace_id=NEW.workspace_id AND page.run_id=NEW.run_id AND page.status='verified' AND member.request_digest=NEW.request_digest)) THEN RAISE EXCEPTION 'study_page_receipt_required';END IF;
 IF NEW.results_applied THEN
  IF NEW.status<>'settled' OR NOT COALESCE(signal_study_owner_current_v1(p.id),false) OR NOT signal_listening_root_right_v1(p.workspace_id,m.root_id,'llm-processing') THEN RAISE EXCEPTION 'study_apply_authority_invalid';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER aac_signal_study_call_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_labeling_calls FOR EACH ROW EXECUTE FUNCTION signal_study_jev_call_guard_v1();
CREATE FUNCTION signal_study_jev_link_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE b signal_study_jev_batches;
BEGIN
 SELECT * INTO b FROM signal_study_jev_batches WHERE run_id=NEW.run_id AND workspace_id=NEW.workspace_id;
 IF b.id IS NOT NULL THEN INSERT INTO signal_study_jev_calls(call_id,workspace_id,batch_id,root_id,request_sha256)
 SELECT NEW.id,NEW.workspace_id,b.id,(NEW.inputs->0->>'root_id')::uuid,NEW.inputs->0->>'request_sha256';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_jev_link AFTER INSERT ON signal_labeling_calls FOR EACH ROW EXECUTE FUNCTION signal_study_jev_link_v1();
CREATE FUNCTION signal_study_batch_checkpoint_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE row jsonb;c signal_labeling_calls;m signal_study_jev_members;page signal_labeling_raw_pages;value jsonb;
BEGIN
 IF NEW.checkpoint IS NULL THEN RETURN NEW;END IF;
 value:=NEW.checkpoint-'checkpoint_digest';
 IF NEW.checkpoint->>'checkpoint_digest' IS DISTINCT FROM signal_labeling_digest_v1(value) OR value->>'batch_id' IS DISTINCT FROM NEW.id::text OR value->>'plan_digest' IS DISTINCT FROM NEW.plan_digest
 OR value->>'status' IS DISTINCT FROM 'completed' OR jsonb_array_length(value->'results')<>NEW.request_count
 OR(SELECT count(DISTINCT v->>'root_id') FROM jsonb_array_elements(value->'results') v)<>NEW.request_count THEN RAISE EXCEPTION 'study_checkpoint_invalid';END IF;
 FOR row IN SELECT v FROM jsonb_array_elements(value->'results') v LOOP
  SELECT * INTO m FROM signal_study_jev_members WHERE batch_id=NEW.id AND root_id=(row->>'root_id')::uuid AND workspace_id=NEW.workspace_id;
  SELECT * INTO c FROM signal_labeling_calls WHERE id=(row->>'call_id')::uuid AND run_id=NEW.run_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO page FROM signal_labeling_raw_pages WHERE id=signal_study_call_page_v1(c.id) AND workspace_id=c.workspace_id AND run_id=c.run_id;
  IF m.root_id IS NULL OR c.id IS NULL OR c.status<>'settled' OR NOT c.results_applied OR page.status IS DISTINCT FROM 'verified'
  OR c.inputs->0->>'request_sha256' IS DISTINCT FROM m.request_sha256 OR c.inputs->0->>'root_id' IS DISTINCT FROM m.root_id::text
  OR row->>'request_sha256' IS DISTINCT FROM m.request_sha256 OR row->'complete' IS DISTINCT FROM 'true'::jsonb OR row->'http_status' IS DISTINCT FROM '200'::jsonb
  OR row#>>'{receipt_page,page_id}' IS DISTINCT FROM page.id::text OR row#>>'{receipt_page,sha256}' IS DISTINCT FROM page.sha256 OR row#>'{receipt_page,verified}' IS DISTINCT FROM 'true'::jsonb
  OR row#>>'{response,model}' IS DISTINCT FROM 'jev-1.13.0' OR row#>'{response,answers}' IS DISTINCT FROM c.results->0->'answers' THEN RAISE EXCEPTION 'study_checkpoint_call_invalid';END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_batch_checkpoint_guard BEFORE INSERT OR UPDATE ON signal_study_jev_batches FOR EACH ROW EXECUTE FUNCTION signal_study_batch_checkpoint_guard_v1();
CREATE FUNCTION signal_study_answer_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_labeling_calls;m signal_study_jev_members;b signal_study_jev_batches;q jsonb;expected text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_answer_immutable';END IF;
 SELECT * INTO b FROM signal_study_jev_batches WHERE id=NEW.batch_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO m FROM signal_study_jev_members WHERE batch_id=b.id AND root_id=NEW.root_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO c FROM signal_labeling_calls WHERE id=NEW.call_id AND workspace_id=NEW.workspace_id AND run_id=b.run_id;
 q:=c.request#>ARRAY['questions',NEW.question_key];expected:=signal_labeling_digest_v1(jsonb_build_object('contract_version','signal-study-jev-question-identity-v1','model',c.model,'state',c.request->>'state','key',NEW.question_key,'question',q));
 IF c.id IS NULL OR m.root_id IS NULL OR c.status<>'settled' OR signal_study_call_page_v1(c.id) IS DISTINCT FROM NEW.raw_page_id OR c.inputs->0->>'root_id' IS DISTINCT FROM NEW.root_id::text
  OR NOT COALESCE(signal_study_owner_current_v1(b.execution_id),false) OR NOT signal_listening_root_right_v1(NEW.workspace_id,NEW.root_id,'llm-processing')
  OR NEW.state_sha256<>m.state_sha256 OR NEW.target_digest<>m.target_digest OR NEW.request_sha256<>m.request_sha256 OR NEW.question_digest IS DISTINCT FROM m.question_digests->>NEW.question_key
  OR NEW.question_identity_digest<>expected OR q IS NULL OR NEW.answer IS DISTINCT FROM c.results#>ARRAY['0','answers',NEW.question_key] OR c.results->0->>'status'<>'labeled'
  OR NOT EXISTS(SELECT 1 FROM signal_labeling_raw_pages WHERE id=NEW.raw_page_id AND status='verified' AND run_id=b.run_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'study_answer_receipt_required';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_answer_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_answers FOR EACH ROW EXECUTE FUNCTION signal_study_answer_guard_v1();
CREATE FUNCTION signal_study_answer_applied_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE id=NEW.call_id AND workspace_id=NEW.workspace_id AND results_applied) THEN RAISE EXCEPTION 'study_answer_not_applied';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER signal_study_answer_applied AFTER INSERT ON signal_study_answers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_study_answer_applied_v1();

CREATE FUNCTION signal_study_calibration_shape_v1(configuration jsonb,keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE
 SET search_path=public,extensions,pg_temp AS $$
 WITH selected AS(SELECT q FROM jsonb_array_elements(configuration->'questions') q WHERE q->>'key'=ANY(keys)),
 descriptors AS(SELECT jsonb_build_object('type',q->>'type','scope',q->>'scope','topic_source',q->'topic_source',
  'option_count',CASE WHEN q->>'type'='choice' THEN jsonb_array_length(q->'options') ELSE 0 END) d FROM selected),
 shape AS(SELECT jsonb_build_object('compiler_version','listening-jev-v1','model',configuration->>'model',
  'phase',(SELECT CASE WHEN bool_and(q->>'origin'='base') THEN 'base' WHEN bool_and(q->>'scope'='all') THEN 'all'
   WHEN bool_and(q->>'scope'='consumer_category') THEN 'consumer_category' ELSE 'mixed' END FROM selected),
  'questions',jsonb_agg(d ORDER BY signal_labeling_digest_v1(d))) value FROM descriptors HAVING count(*)=cardinality(keys) AND count(*)>0)
 SELECT value||jsonb_build_object('shape_digest',signal_labeling_digest_v1(value)) FROM shape
$$;
CREATE FUNCTION signal_study_calibration_evidence_v1(w uuid,target uuid,shape_digest text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH owner AS(SELECT b.*,p.actor_user_id,p.entity_context_digest FROM signal_study_jev_batches b JOIN signal_study_executions p ON p.id=b.execution_id AND p.workspace_id=b.workspace_id
 JOIN signal_labeling_runs r ON r.id=b.run_id AND r.workspace_id=b.workspace_id JOIN signal_processing_admissions a ON a.id=r.processing_admission_id AND a.workspace_id=w AND a.target_id=r.id
 AND a.actor_user_id=p.actor_user_id AND a.policy_version_id=p.policy_version_id AND a.action='mass_labeling_jev' AND a.provider='typesafe' AND a.model='jev-1.13.0' WHERE b.run_id=target AND b.workspace_id=w),
 recent AS MATERIALIZED(SELECT c.id,c.request_digest,c.raw_sha256,c.usage,c.created_at,octet_length(m.request_body) request_bytes,(c.usage->>'input_tokens')::bigint input_tokens,shape.value shape
 FROM owner b JOIN signal_study_jev_members m ON m.batch_id=b.id AND m.workspace_id=w JOIN signal_study_jev_calls link ON link.batch_id=b.id AND link.root_id=m.root_id AND link.workspace_id=w
 JOIN signal_labeling_calls c ON c.id=link.call_id AND c.run_id=b.run_id AND c.workspace_id=w JOIN signal_labeling_raw_pages page ON page.id=signal_study_call_page_v1(c.id) AND page.run_id=b.run_id AND page.workspace_id=w AND page.status='verified'
 CROSS JOIN LATERAL(SELECT signal_study_calibration_shape_v1(b.stage_configuration,m.question_keys) value) shape
 WHERE c.status='settled' AND c.settled_micro_usd IS NOT NULL AND c.raw_sha256 IS NOT NULL AND c.raw_storage_verified_at IS NOT NULL AND c.raw_storage_verified_key=c.raw_storage_key
 AND c.results_applied AND c.provider='typesafe' AND c.model='jev-1.13.0' AND jsonb_array_length(c.inputs)=1 AND jsonb_array_length(c.results)=1 AND c.results->0->>'status'='labeled'
 AND c.inputs->0->>'request_sha256'=m.request_sha256 AND c.inputs->0->>'batch_id'=b.id::text AND c.inputs->0->>'configuration_digest'=b.stage_configuration_digest AND c.results->0->>'entity_context_digest'=b.entity_context_digest
 AND(c.usage->>'input_tokens')~'^[1-9][0-9]*$' AND shape.value->>'shape_digest'=$3 ORDER BY c.created_at DESC,c.id DESC LIMIT 32),
 aggregate AS(SELECT jsonb_agg(id ORDER BY created_at DESC,id DESC) ids,min(request_bytes) lo,max(request_bytes) hi,max(input_tokens::numeric/request_bytes::numeric)*1.25 ratio,count(*) n,
 jsonb_agg(jsonb_build_object('call_id',id,'request_digest',request_digest,'raw_sha256',raw_sha256,'usage',usage,'request_bytes',request_bytes) ORDER BY created_at DESC,id DESC) receipts FROM recent WHERE request_bytes>0),
 scoped AS(SELECT jsonb_build_object('workspace_id',b.workspace_id,'configuration_digest',b.stage_configuration_digest,'model','jev-1.13.0','compiler_version','listening-jev-v1','shape_digest',$3,'phase',(SELECT shape->>'phase' FROM recent LIMIT 1)) value FROM owner b)
 SELECT jsonb_build_object('scope',scoped.value,'scope_digest',signal_labeling_digest_v1(scoped.value),'source_digest',signal_labeling_digest_v1(jsonb_build_object('source_run_id',target,'receipts',a.receipts)),
 'source_call_ids',a.ids,'source_run_id',target,'request_min_bytes',a.lo,'request_max_bytes',a.hi,'max_input_tokens_per_byte',a.ratio,'sample_count',a.n,'status','measured') FROM aggregate a CROSS JOIN scoped WHERE a.n>0
$$;
CREATE FUNCTION signal_study_calibration_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_calibration_immutable';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 IF NOT EXISTS(SELECT 1 FROM signal_study_jev_batches b JOIN signal_study_executions p ON p.id=b.execution_id AND p.workspace_id=b.workspace_id WHERE b.run_id=NEW.source_run_id AND b.workspace_id=NEW.workspace_id AND p.actor_user_id=NEW.created_by_user_id AND signal_study_owner_current_v1(p.id)) THEN RAISE EXCEPTION 'study_calibration_owner_invalid';END IF;
 expected:=signal_study_calibration_evidence_v1(NEW.workspace_id,NEW.source_run_id,NEW.profile#>>'{scope,shape_digest}');
 IF expected IS NULL OR expected IS DISTINCT FROM NEW.profile OR NEW.scope_digest IS DISTINCT FROM expected->>'scope_digest' OR NEW.source_digest IS DISTINCT FROM expected->>'source_digest' THEN RAISE EXCEPTION 'study_calibration_evidence_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_calibration_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_calibrations FOR EACH ROW EXECUTE FUNCTION signal_study_calibration_guard_v1();
-- A free source snapshot precedes CPU, not a computed-result intent. It fixes
-- the eligible pooled population and proof2 without claiming a fit or a call.
CREATE TABLE signal_study_numeric_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,execution_id uuid NOT NULL,numeric_key text NOT NULL,
 request_sha256 text NOT NULL,fit_plan_digest text NOT NULL,context jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workspace_id,id),UNIQUE(execution_id,numeric_key),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_study_executions(workspace_id,id));
CREATE TABLE signal_study_numeric_source_roots(source_id uuid NOT NULL,workspace_id uuid NOT NULL,execution_id uuid NOT NULL,root_id uuid NOT NULL,
 proof_json text NOT NULL,proof_digest text NOT NULL,PRIMARY KEY(source_id,root_id),FOREIGN KEY(workspace_id,source_id) REFERENCES signal_study_numeric_sources(workspace_id,id),
 FOREIGN KEY(workspace_id,execution_id,root_id) REFERENCES signal_study_source_roots(workspace_id,execution_id,root_id),
 CHECK(proof_digest='sha256:'||encode(sha256(convert_to(proof_json,'UTF8')),'hex')));
ALTER TABLE signal_study_numeric_sources ENABLE ROW LEVEL SECURITY;ALTER TABLE signal_study_numeric_source_roots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_study_numeric_sources,signal_study_numeric_source_roots FROM PUBLIC;
CREATE TRIGGER signal_study_numeric_source_history BEFORE INSERT OR UPDATE OR DELETE ON signal_study_numeric_sources FOR EACH ROW EXECUTE FUNCTION signal_study_history_v1();
CREATE TRIGGER signal_study_numeric_source_root_history BEFORE INSERT OR UPDATE OR DELETE ON signal_study_numeric_source_roots FOR EACH ROW EXECUTE FUNCTION signal_study_history_v1();
CREATE FUNCTION signal_study_axes_answers_v1(target uuid,root uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH scope AS(SELECT p.id execution_id,p.workspace_id,s.root_id,s.question_cache_ids,asset.full_text,cfg.envelope FROM signal_study_executions p
 JOIN signal_study_source_roots s ON s.execution_id=p.id AND s.root_id=$2 AND s.workspace_id=p.workspace_id JOIN signal_study_configurations cfg ON cfg.id=p.configuration_id
 JOIN signal_corpus_text_assets asset ON asset.workspace_id=s.workspace_id AND asset.text_sha256=s.asset_sha256 AND asset.chunk_policy_version=s.chunk_policy_version WHERE p.id=$1),
 questions AS(SELECT s.*,q.value question,jsonb_build_object('type','choice','instructions',jsonb_build_object('rules',s.envelope#>>'{question_configuration,instructions}','question',q.value->>'text'),
  'criteria',(SELECT jsonb_object_agg(o->>'key',o->>'definition') FROM jsonb_array_elements(q.value->'options') o)) wire FROM scope s CROSS JOIN LATERAL jsonb_array_elements(s.envelope#>'{question_configuration,questions}') q),
 known AS(SELECT DISTINCT ON(a.question_key) a.question_key,a.answer FROM questions s JOIN signal_study_answers a ON a.workspace_id=s.workspace_id AND a.root_id=s.root_id AND a.question_key=s.question->>'key'
 AND a.question_identity_digest=signal_labeling_digest_v1(jsonb_build_object('contract_version','signal-study-jev-question-identity-v1','model','jev-1.13.0','state',s.full_text,'key',a.question_key,'question',s.wire))
 WHERE a.id=ANY(s.question_cache_ids) OR EXISTS(SELECT 1 FROM signal_study_jev_batches b WHERE b.id=a.batch_id AND b.execution_id=s.execution_id AND b.stage='axes' AND b.status='completed')
 ORDER BY a.question_key,a.created_at DESC,a.id DESC)
 SELECT COALESCE(jsonb_object_agg(question_key,answer),'{}'::jsonb) FROM known
$$;
CREATE FUNCTION signal_study_axes_v1(target uuid,root uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE answers jsonb;cfg jsonb;roles jsonb;d text;t text;u text;inverted boolean;
BEGIN
 SELECT configuration.envelope INTO cfg FROM signal_study_executions p JOIN signal_study_configurations configuration ON configuration.id=p.configuration_id WHERE p.id=target;
 roles:=cfg#>'{question_configuration,roles}';answers:=signal_study_axes_answers_v1(target,root);
 d:=answers#>>ARRAY[roles->>'direction','choice'];t:=answers#>>ARRAY[roles->>'target','choice'];u:=answers#>>ARRAY[roles->>'use','choice'];
 IF d IS NULL OR d NOT IN('trigger','barrier','mixed','none') OR t IS NULL OR t NOT IN('category','own_brand','competitor_brand','alternative') OR u IS NULL OR u NOT IN('literal','figurative_or_ironic','other') THEN RAISE EXCEPTION 'study_axes_incomplete';END IF;
 inverted:=cfg#>>'{study,subject,kind}'='alternative' AND length(cfg#>>'{study,subject,conventional_category}')>0 AND t='category' AND d='barrier' AND u='literal';
 RETURN jsonb_build_object('source_direction',d,'direction',CASE WHEN inverted THEN 'trigger' ELSE d END,'target',t,'use',u,'alternative_inverted',inverted,
 'aggregate',CASE WHEN u='figurative_or_ironic' THEN 'figurative_or_ironic' WHEN u='other' THEN 'other' WHEN t='competitor_brand' THEN 'competitor' WHEN t='alternative' AND cfg#>>'{study,subject,kind}'<>'alternative' THEN 'alternative' ELSE 'subject' END);
END $$;
CREATE FUNCTION signal_study_numeric_source_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;cfg jsonb;s signal_study_source_roots;n signal_study_numeric_sources;proof jsonb;axes jsonb;marker jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_numeric_source_immutable';END IF;
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 IF p.id IS NULL OR p.status<>'running' OR p.execution_token IS NULL OR p.execution_expires_at<=clock_timestamp() OR NOT COALESCE(signal_study_owner_current_v1(p.id),false) THEN RAISE EXCEPTION 'study_numeric_source_stale';END IF;
 IF TG_TABLE_NAME='signal_study_numeric_sources' THEN
  marker:=NULLIF(current_setting('noisia.study_numeric_source_v1',true),'')::jsonb;
  IF marker IS DISTINCT FROM jsonb_build_object('execution_id',p.id,'execution_token',p.execution_token,'source_id',NEW.id,'numeric_key',NEW.numeric_key,'fit_plan_digest',NEW.fit_plan_digest)
  OR NEW.context->>'execution_id' IS DISTINCT FROM p.id::text OR NEW.context->>'source_digest' IS DISTINCT FROM p.source_digest OR NEW.context->>'fit_plan_digest' IS DISTINCT FROM NEW.fit_plan_digest THEN RAISE EXCEPTION 'study_numeric_source_not_derived';END IF;
 ELSE
  SELECT * INTO s FROM signal_study_source_roots WHERE execution_id=p.id AND root_id=NEW.root_id AND workspace_id=p.workspace_id;
  SELECT * INTO n FROM signal_study_numeric_sources WHERE id=NEW.source_id AND execution_id=p.id AND workspace_id=p.workspace_id;
  SELECT envelope INTO cfg FROM signal_study_configurations WHERE id=p.configuration_id;proof:=NEW.proof_json::jsonb;axes:=signal_study_axes_v1(p.id,NEW.root_id);
  IF s.root_id IS NULL OR n.id IS NULL OR axes->>'direction'='none' OR axes->>'use'<>'literal' OR NOT signal_listening_root_right_v1(p.workspace_id,s.root_id,'llm-processing')
   OR proof IS DISTINCT FROM(s.proof_json::jsonb||jsonb_build_object('contract_version','signal-study-cached-vector-proof-v1','source_proof_digest',s.proof_digest,'source_digest',p.source_digest,
    'cut_digest',signal_labeling_digest_v1(cfg#>'{study,cut}'),'study_digest',cfg->>'study_digest','fit_plan_digest',n.fit_plan_digest,'in_consumer_cut',true,'axes',axes)) THEN RAISE EXCEPTION 'study_numeric_proof_invalid';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER aaa_signal_study_numeric_source_guard BEFORE INSERT ON signal_study_numeric_sources FOR EACH ROW EXECUTE FUNCTION signal_study_numeric_source_guard_v1();
CREATE TRIGGER aaa_signal_study_numeric_source_root_guard BEFORE INSERT ON signal_study_numeric_source_roots FOR EACH ROW EXECUTE FUNCTION signal_study_numeric_source_guard_v1();
CREATE FUNCTION signal_study_numeric_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;cfg jsonb;source signal_study_numeric_sources;manifest jsonb;marker jsonb;ids uuid[];actual uuid[];proof_sha text;fit jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'study_numeric_immutable';END IF;
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 SELECT envelope INTO cfg FROM signal_study_configurations WHERE id=p.configuration_id;SELECT * INTO source FROM signal_study_numeric_sources WHERE execution_id=p.id AND workspace_id=p.workspace_id AND numeric_key=NEW.numeric_key;
 IF p.id IS NULL OR source.id IS NULL OR p.status<>'running' OR p.execution_token IS NULL OR p.execution_expires_at<=clock_timestamp() OR NOT COALESCE(signal_study_source_current_v1(p.id),false) THEN RAISE EXCEPTION 'study_numeric_stale';END IF;
 IF TG_OP='UPDATE' THEN
  marker:=NULLIF(current_setting('noisia.study_numeric_verified_v1',true),'')::jsonb;
  IF OLD.verification_status<>'planned' OR NEW.verification_status<>'verified' OR NEW.verified_at IS NULL OR NEW.verification_token IS DISTINCT FROM p.execution_token
   OR(to_jsonb(NEW)-ARRAY['verification_status','verified_at','verification_token']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['verification_status','verified_at','verification_token'])
   OR marker IS DISTINCT FROM jsonb_build_object('checkpoint_id',NEW.id,'execution_token',p.execution_token,'manifest_sha256',NEW.manifest_sha256,'artifacts_digest',NEW.artifacts_digest)
   OR NEW.artifacts_digest IS DISTINCT FROM(SELECT signal_labeling_digest_v1(jsonb_agg(jsonb_build_object('name',name,'storage_key',storage_key,'sha256',sha256,'size_bytes',size_bytes) ORDER BY name COLLATE "C")) FROM signal_study_numeric_artifacts WHERE checkpoint_id=NEW.id) THEN RAISE EXCEPTION 'study_numeric_unverified';END IF;
 ELSE
  marker:=NULLIF(current_setting('noisia.study_numeric_staged_v1',true),'')::jsonb;manifest:=NEW.manifest_json::jsonb;fit:=NEW.request_body::jsonb;
  SELECT array_agg(n.root_id ORDER BY n.root_id),'sha256:'||encode(sha256(convert_to(COALESCE(string_agg('{"root_id":'||to_json(n.root_id)::text||',"proof_digest":'||to_json(n.proof_digest)::text||',"proof_json":'||to_json(n.proof_json)::text||',"vector_json":'||to_json(cached.embedding::text)::text||'}'||E'\n','' ORDER BY n.root_id),''),'UTF8')),'hex') INTO actual,proof_sha
   FROM signal_study_numeric_source_roots n JOIN signal_study_source_roots s USING(workspace_id,execution_id,root_id)
   JOIN signal_workspace_chunk_embeddings cached ON cached.workspace_id=s.workspace_id AND cached.config_digest=s.embedding_config_digest AND cached.chunk_sha256=s.chunk_sha256 WHERE n.source_id=source.id;
  SELECT array_agg(id ORDER BY id) INTO ids FROM(SELECT (element#>>'{}')::uuid id FROM jsonb_array_elements(NEW.value->'unassigned_root_ids') ids(element) UNION ALL SELECT(element#>>'{}')::uuid FROM jsonb_array_elements(NEW.value->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'root_ids') ids(element)) selected;
  IF NEW.verification_status<>'planned' OR NEW.verification_token IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.planned_by_token IS DISTINCT FROM p.execution_token
   OR marker IS DISTINCT FROM jsonb_build_object('checkpoint_id',NEW.id,'execution_token',p.execution_token,'manifest_sha256',NEW.manifest_sha256,'artifacts_digest',NEW.artifacts_digest)
   OR NEW.source_digest<>p.source_digest OR NEW.fit_plan_digest<>source.fit_plan_digest OR NEW.request_sha256<>source.request_sha256
   OR manifest->>'contract_version' IS DISTINCT FROM 'signal-study-numeric-v1' OR manifest->>'workspace_id' IS DISTINCT FROM p.workspace_id::text OR manifest->>'execution_id' IS DISTINCT FROM p.id::text
   OR manifest->>'study_digest' IS DISTINCT FROM cfg->>'study_digest' OR manifest->>'source_digest' IS DISTINCT FROM p.source_digest OR manifest->>'cut_digest' IS DISTINCT FROM signal_labeling_digest_v1(cfg#>'{study,cut}')
   OR manifest->>'request_sha256' IS DISTINCT FROM NEW.request_sha256 OR manifest->>'fit_plan_digest' IS DISTINCT FROM NEW.fit_plan_digest OR manifest->>'proof_census_digest' IS DISTINCT FROM source.context->>'proof_census_digest'
   OR manifest->>'numeric_config_digest' IS DISTINCT FROM signal_labeling_digest_v1(fit->'configuration') OR manifest->'numeric_config' IS DISTINCT FROM fit->'configuration' OR manifest->>'seed_digest' IS DISTINCT FROM signal_labeling_digest_v1(to_jsonb(source.context->>'sampling_seed'))
   OR manifest->>'source_proofs_sha256' IS DISTINCT FROM proof_sha OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.artifact_manifest) a WHERE a->>'name'='source-proofs.jsonl' AND a->>'sha256'=proof_sha)
   OR manifest->>'embedding_space_digest' IS DISTINCT FROM source.context->>'embedding_space_digest' OR manifest->'source_preparation_run_ids' IS DISTINCT FROM source.context->'source_preparation_run_ids'
   OR manifest->'preparation_unknown_root_ids' IS DISTINCT FROM source.context->'preparation_unknown_root_ids' OR(manifest->>'preparation_unknown_count')::int<>jsonb_array_length(source.context->'preparation_unknown_root_ids')
   OR(manifest->>'root_count')::int<>(source.context->>'root_count')::int OR NEW.value->>'plan_digest' IS DISTINCT FROM NEW.fit_plan_digest OR NEW.value->'groups' IS DISTINCT FROM manifest->'groups' OR NEW.value->'unassigned_root_ids' IS DISTINCT FROM manifest->'unassigned_root_ids'
   OR(manifest->>'grouped_count')::integer IS DISTINCT FROM(SELECT COALESCE(sum(jsonb_array_length(g->'root_ids')),0)::integer FROM jsonb_array_elements(NEW.value->'groups') g)
   OR(manifest->>'unassigned_count')::integer IS DISTINCT FROM jsonb_array_length(NEW.value->'unassigned_root_ids')
   OR manifest->>'status'='insufficient_population' AND jsonb_array_length(NEW.value->'groups')<>0
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.artifact_manifest) a WHERE a->>'name'='input/manifest.json' AND a->>'sha256'=manifest->>'input_manifest_sha256')
   OR manifest->>'status'<>'empty' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.artifact_manifest) a WHERE a->>'name'='output/manifest.json' AND a->>'sha256'=manifest->>'output_manifest_sha256')
   OR manifest->>'status'='empty' AND manifest->'output_manifest_sha256' IS DISTINCT FROM 'null'::jsonb
   OR COALESCE(ids,'{}') IS DISTINCT FROM COALESCE(actual,'{}') OR cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) id)
   OR manifest->>'status' NOT IN('empty','insufficient_population','completed') OR(manifest->>'status'='empty') IS DISTINCT FROM ((source.context->>'root_count')::int=0)
   OR(SELECT jsonb_agg(a ORDER BY a->>'name' COLLATE "C") FROM jsonb_array_elements(manifest->'artifacts') a) IS DISTINCT FROM(SELECT jsonb_agg(value-'storage_key' ORDER BY value->>'name' COLLATE "C") FROM jsonb_array_elements(NEW.artifact_manifest) value WHERE value->>'name'<>'numeric-manifest.json') THEN RAISE EXCEPTION 'study_numeric_manifest_invalid';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_numeric_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_numeric_checkpoints FOR EACH ROW EXECUTE FUNCTION signal_study_numeric_guard_v1();
CREATE FUNCTION signal_study_numeric_artifact_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE n signal_study_numeric_checkpoints;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_numeric_artifact_immutable';END IF;SELECT * INTO n FROM signal_study_numeric_checkpoints WHERE id=NEW.checkpoint_id AND workspace_id=NEW.workspace_id;
 IF n.id IS NULL OR n.verification_status<>'planned' OR NEW.storage_key NOT LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||n.id::text||'/%'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(n.artifact_manifest) a WHERE a=jsonb_build_object('name',NEW.name,'sha256',NEW.sha256,'size_bytes',NEW.size_bytes,'storage_key',NEW.storage_key)) THEN RAISE EXCEPTION 'study_numeric_artifact_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_numeric_artifact_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_study_numeric_artifacts FOR EACH ROW EXECUTE FUNCTION signal_study_numeric_artifact_guard_v1();
CREATE FUNCTION signal_study_output_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;marker jsonb;
BEGIN
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;marker:=NULLIF(current_setting('noisia.study_output_v1',true),'')::jsonb;
 IF p.id IS NULL OR p.status<>'running' OR p.execution_token IS NULL OR p.execution_expires_at<=clock_timestamp() OR NOT COALESCE(signal_study_source_current_v1(p.id),false)
 OR p.study_id<>NEW.study_id OR p.configuration_id<>NEW.configuration_id OR NEW.source_digest<>p.source_digest OR NEW.output->>'source_digest' IS DISTINCT FROM p.source_digest
 OR NEW.output->>'configuration_digest' IS DISTINCT FROM p.configuration_digest OR NEW.output->>'contract_version' IS DISTINCT FROM 'signal-study-runtime-output-v1' OR NEW.output->>'status' IS DISTINCT FROM 'directional'
 OR NEW.output#>>'{promotion,status}' IS DISTINCT FROM 'explicit_action_required' OR NEW.output#>'{promotion,automatic}' IS DISTINCT FROM 'false'::jsonb
 OR signal_study_exposure_v1(p.id)>p.cap_micro_usd OR EXISTS(SELECT 1 FROM signal_study_steps s LEFT JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=p.id AND(s.status<>'committed' OR c.call_state IS DISTINCT FROM 'settled'))
 OR EXISTS(SELECT 1 FROM signal_study_jev_batches WHERE execution_id=p.id AND status<>'completed') OR EXISTS(SELECT 1 FROM signal_study_numeric_checkpoints WHERE execution_id=p.id AND verification_status<>'verified')
 OR marker IS DISTINCT FROM jsonb_build_object('execution_id',p.id,'execution_token',p.execution_token,'output_digest',NEW.output_digest) THEN RAISE EXCEPTION 'study_output_not_derived';END IF;RETURN NEW;
END $$;
CREATE TRIGGER aaa_signal_study_output_guard BEFORE INSERT ON signal_study_outputs FOR EACH ROW EXECUTE FUNCTION signal_study_output_guard_v1();
CREATE FUNCTION signal_study_completion_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM signal_study_outputs WHERE execution_id=NEW.id AND workspace_id=NEW.workspace_id AND output_digest=NEW.output_digest AND output=NEW.output) THEN RAISE EXCEPTION 'study_output_required';END IF;RETURN NEW;
END $$;
CREATE TRIGGER signal_study_completion_guard BEFORE UPDATE ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_study_completion_guard_v1();
-- These guards retain all history, including TRUNCATE by a privileged operator.
CREATE FUNCTION signal_study_truncate_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'study_history_retained';END $$;
DO $ddl$DECLARE name text;role_name text;f regprocedure;BEGIN
 FOR name IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'signal_stud%' LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION signal_study_truncate_v1()',name||'_no_truncate',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',name,role_name);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'signal_study_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);END LOOP;
END $ddl$;
CREATE FUNCTION signal_study_step_admitted_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE s signal_study_steps;
BEGIN
 SELECT * INTO s FROM signal_study_steps WHERE id=NEW.id;
 IF s.admission_id IS NULL OR NOT EXISTS(SELECT 1 FROM engine_cost_events c JOIN signal_processing_admissions a ON a.id=s.admission_id WHERE c.study_step_id=s.id AND c.workspace_contract='signal-study-step-v1' AND a.target_id=s.id AND a.action='study_analysis' AND a.request_digest=s.request_sha256) THEN RAISE EXCEPTION 'study_step_admission_required';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER signal_study_step_admitted AFTER INSERT ON signal_study_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_study_step_admitted_v1();
REVOKE ALL ON FUNCTION signal_study_step_admitted_v1() FROM PUBLIC;

CREATE FUNCTION signal_study_configuration_supersede_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 UPDATE signal_study_executions SET status='stale',error_code='study_configuration_changed',updated_at=clock_timestamp() WHERE study_id=NEW.study_id AND workspace_id=NEW.workspace_id AND configuration_id<>NEW.id AND status IN('queued','running','outcome_unknown');
 RETURN NEW;
END $$;
CREATE TRIGGER signal_study_configuration_supersede AFTER INSERT ON signal_study_configurations FOR EACH ROW EXECUTE FUNCTION signal_study_configuration_supersede_v1();
REVOKE ALL ON FUNCTION signal_study_configuration_supersede_v1() FROM PUBLIC;
CREATE INDEX signal_study_member_semantic_lookup ON signal_study_jev_members(workspace_id,root_id,state_sha256,target_digest) INCLUDE(batch_id);
CREATE INDEX signal_study_numeric_source_fit ON signal_study_numeric_sources(execution_id,workspace_id,fit_plan_digest);
CREATE FUNCTION signal_study_execution_authority_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE policy signal_processing_policy_versions;cap bigint;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO policy FROM signal_processing_policy_versions WHERE id=NEW.policy_version_id AND organization_id=NEW.organization_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||NEW.organization_id::text,0));PERFORM signal_processing_lock_v1(NEW.organization_id,(clock_timestamp() AT TIME ZONE policy.budget_timezone)::date);
  SELECT max_execution_micro_usd INTO cap FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='study_analysis' AND provider='anthropic' AND model='claude-sonnet-4-6' AND configuration=signal_study_analysis_configuration_v1();
  IF policy.id IS NULL OR policy.status<>'active' OR policy.valid_from>clock_timestamp() OR policy.valid_until<=clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='study_analysis' AND configuration=signal_study_analysis_configuration_v1())
   OR NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='mass_labeling_jev' AND provider='typesafe' AND model='jev-1.13.0' AND configuration='{"contract_version":"mass-labeling-jev-v2","provider":"typesafe","model":"jev-1.13.0"}'::jsonb)
   OR cap IS NOT NULL AND NEW.cap_micro_usd>cap OR NEW.cap_micro_usd>9007199254740991 OR NOT signal_processing_actor_v1(NEW.workspace_id,NEW.actor_user_id)
   OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling')
   OR NEW.configuration_id IS DISTINCT FROM(SELECT id FROM signal_study_configurations WHERE workspace_id=NEW.workspace_id AND study_id=NEW.study_id ORDER BY revision DESC LIMIT 1) THEN RAISE EXCEPTION 'study_execution_not_authorized';END IF;
 ELSIF OLD.status IN('completed','failed','stale','budget_exhausted') AND ROW(NEW.status,NEW.output,NEW.output_digest) IS DISTINCT FROM ROW(OLD.status,OLD.output,OLD.output_digest) THEN RAISE EXCEPTION 'study_execution_terminal';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER aaa_signal_study_execution_authority BEFORE INSERT OR UPDATE ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_study_execution_authority_v1();
REVOKE ALL ON FUNCTION signal_study_execution_authority_v1() FROM PUBLIC;
CREATE FUNCTION signal_study_numeric_source_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE actual_census text;counted integer;expected integer;preps jsonb;unknown jsonb;
BEGIN
 SELECT count(*)::integer,signal_labeling_digest_v1(jsonb_build_object('execution_id',NEW.execution_id,'fit_plan_digest',NEW.fit_plan_digest,
 'roots',COALESCE(jsonb_agg(jsonb_build_array(n.root_id,n.proof_digest) ORDER BY n.root_id),'[]'::jsonb),'source_digest',NEW.context->>'source_digest','workspace_id',NEW.workspace_id)),
 COALESCE(jsonb_agg(n.root_id ORDER BY n.root_id) FILTER(WHERE n.proof_json::jsonb->'embedding_preparation_run_id'='null'::jsonb),'[]'::jsonb)
 INTO counted,actual_census,unknown FROM signal_study_numeric_source_roots n WHERE n.source_id=NEW.id;
 SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO preps FROM(SELECT DISTINCT n.proof_json::jsonb->>'embedding_preparation_run_id' id FROM signal_study_numeric_source_roots n WHERE n.source_id=NEW.id AND n.proof_json::jsonb->'embedding_preparation_run_id'<>'null'::jsonb) ids;
 SELECT count(*) INTO expected FROM signal_study_source_roots s CROSS JOIN LATERAL(SELECT signal_study_axes_v1(s.execution_id,s.root_id) axes) q WHERE s.execution_id=NEW.execution_id AND q.axes->>'direction'<>'none' AND q.axes->>'use'='literal';
 IF counted<>expected OR counted<>(NEW.context->>'root_count')::integer OR NEW.context->>'proof_census_digest' IS DISTINCT FROM actual_census
 OR NEW.context->'source_preparation_run_ids' IS DISTINCT FROM preps OR NEW.context->'preparation_unknown_root_ids' IS DISTINCT FROM unknown THEN RAISE EXCEPTION 'study_numeric_source_incomplete';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER signal_study_numeric_source_complete AFTER INSERT ON signal_study_numeric_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_study_numeric_source_complete_v1();
REVOKE ALL ON FUNCTION signal_study_numeric_source_complete_v1() FROM PUBLIC;

CREATE INDEX signal_study_calibration_lookup ON signal_study_calibrations(workspace_id,(profile#>>'{scope,configuration_digest}'),(profile#>>'{scope,shape_digest}'),created_at DESC,id DESC);
REVOKE ALL ON FUNCTION signal_processing_org_exposure_history0306_v1(uuid,date,text,text,uuid) FROM PUBLIC;

CREATE FUNCTION signal_study_promotion_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;cfg signal_listening_configurations;marker jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_promotion_immutable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-listening-config:'||NEW.workspace_id::text,0));
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.actor_user_id);
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO cfg FROM signal_listening_configurations WHERE id=NEW.output_configuration_id AND workspace_id=NEW.workspace_id;
 marker:=NULLIF(current_setting('noisia.study_promotion_v1',true),'')::jsonb;
 IF p.status IS DISTINCT FROM 'completed' OR cfg.id IS NULL OR cfg.provenance<>'human' OR cfg.revision<>NEW.expected_listening_revision+1
 OR cfg.configuration_digest<>NEW.output_configuration_digest OR marker IS DISTINCT FROM jsonb_build_object('execution_id',p.id,'request_digest',NEW.request_digest,'configuration_id',cfg.id)
 OR NOT EXISTS(SELECT 1 FROM signal_study_outputs WHERE execution_id=p.id AND workspace_id=p.workspace_id)
 THEN RAISE EXCEPTION 'study_promotion_not_native';END IF;RETURN NEW;
END $$;
CREATE TRIGGER aaa_signal_study_promotion_guard BEFORE INSERT ON signal_study_promotions FOR EACH ROW EXECUTE FUNCTION signal_study_promotion_guard_v1();
REVOKE ALL ON FUNCTION signal_study_promotion_guard_v1() FROM PUBLIC;
