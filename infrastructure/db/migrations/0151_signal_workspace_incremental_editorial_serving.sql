-- Paid editorial delivery is a composed serving cut, never an amendment to the
-- historical admission cut or to the immutable numeric/editorial executions.
ALTER TABLE signal_topic_catalog_operations DROP CONSTRAINT signal_topic_catalog_operations_action_check;
ALTER TABLE signal_topic_catalog_operations ADD CONSTRAINT signal_topic_catalog_operations_action_check
 CHECK(action IN('create','adopt','update','archive','restore','select_signal','materialize_incremental'));
CREATE FUNCTION signal_workspace_incremental_editorial_paid_v1(target uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions owner
 JOIN signal_topic_catalog_executions numeric ON numeric.id=owner.source_execution_id AND numeric.workspace_id=owner.workspace_id
 JOIN analysis_artifacts evidence ON evidence.id::text=owner.input_snapshot->>'evidence_plan_artifact_id' AND evidence.workspace_id=owner.workspace_id
 JOIN analysis_artifacts plan ON plan.id::text=owner.result_summary->>'request_plan_artifact_id' AND plan.engine_execution_id=owner.id AND plan.workspace_id=owner.workspace_id
 WHERE owner.id=target AND owner.input_contract='workspace-incremental-editorial-v1' AND owner.status='ready'
 AND owner.result_summary->'editorial_complete'='true'::jsonb AND owner.completed_at IS NOT NULL
 AND owner.input_digest=workspace_incremental_editorial_digest_v1(owner.input_snapshot)
 AND owner.actor_user_id=numeric.actor_user_id AND numeric.input_snapshot ? 'numeric_descriptor'
 AND owner.input_snapshot->>'numeric_checkpoint_digest'=numeric.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
 AND owner.input_snapshot->>'context_digest'=numeric.input_snapshot->>'context_digest'
 AND signal_workspace_incremental_origin_current_v1(numeric.id,numeric.workspace_id)
 AND workspace_incremental_editorial_claims_complete_v1(owner.id)
 AND workspace_incremental_editorial_output_complete_v1(owner.id)
 AND workspace_incremental_editorial_request_plan_valid_v1(plan.id)
 AND plan.metadata->'plan'->>'plan_digest'=owner.result_summary->>'request_plan_digest'
 AND evidence.metadata->>'contract_version'='workspace-incremental-editorial-plan-v1'
 AND evidence.metadata->>'numeric_execution_id'=numeric.id::text
 AND evidence.metadata->>'evidence_digest'=owner.input_snapshot->>'evidence_digest'
 AND evidence.metadata->'descriptor'->>'numeric_checkpoint_digest'=owner.input_snapshot->>'numeric_checkpoint_digest'
 AND evidence.metadata->'descriptor'->>'target_binding_digest'=owner.input_snapshot->>'target_binding_digest'
 AND evidence.metadata->'descriptor'->>'target_unit_digest'=owner.input_snapshot->>'target_unit_digest'
 AND evidence.metadata->>'evidence_digest'=workspace_incremental_editorial_digest_v1(((evidence.metadata->'descriptor')-'evidence_digest')||jsonb_build_object('units',
  (SELECT jsonb_agg(unit.metadata->'unit' ORDER BY unit.metadata->'unit'->>'unit_key' COLLATE "C") FROM analysis_artifacts unit
   WHERE unit.workspace_id=owner.workspace_id AND unit.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND unit.metadata->>'plan_artifact_id'=evidence.id::text)))
 AND NOT EXISTS(SELECT 1 FROM analysis_artifacts claim
  LEFT JOIN analysis_artifacts census ON census.id::text=claim.metadata->>'census_artifact_id' AND census.engine_execution_id=numeric.id AND census.workspace_id=owner.workspace_id
  LEFT JOIN analysis_artifacts component ON component.id::text=claim.metadata->>'component_artifact_id' AND component.engine_execution_id=numeric.id AND component.workspace_id=owner.workspace_id
  WHERE claim.engine_execution_id=owner.id AND claim.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1'
  AND NOT COALESCE(claim.workspace_id=owner.workspace_id AND claim.metadata->>'owner_execution_id'=owner.id::text
   AND claim.metadata->>'numeric_execution_id'=numeric.id::text AND claim.metadata->>'target_unit_digest'=owner.input_snapshot->>'target_unit_digest'
   AND census.metadata->>'contract_version'='workspace-incremental-unit-census-v1' AND census.metadata->>'derivation_digest'=owner.input_snapshot->>'census_derivation_digest'
   AND component.metadata->>'contract_version'='workspace-incremental-component-v1'
   AND claim.metadata->>'component_key'=component.metadata->>'component_key' AND census.metadata->>'component_key'=component.metadata->>'component_key'
   AND claim.metadata->'unit'=census.metadata->'unit' AND claim.metadata->'model_origin'=component.metadata->'model_origin' AND claim.content=census.content
   AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions origin WHERE origin.id::text=claim.metadata->'model_origin'->>'execution_id'
    AND origin.workspace_id=owner.workspace_id AND origin.input_snapshot ? 'numeric_descriptor' AND signal_workspace_incremental_origin_current_v1(origin.id,owner.workspace_id))
   AND EXISTS(SELECT 1 FROM analysis_artifacts unit WHERE unit.workspace_id=owner.workspace_id AND unit.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1'
    AND unit.metadata->>'plan_artifact_id'=evidence.id::text AND unit.metadata->>'census_artifact_id'=census.id::text
    AND unit.metadata->'unit'->>'status'='evidence_ready' AND unit.metadata->'unit'->>'unit_key'=claim.metadata->'unit'->>'unit_key'),false))
 AND NOT EXISTS(SELECT 1 FROM analysis_artifacts checkpoint
  LEFT JOIN engine_cost_events call ON call.id::text=checkpoint.metadata->>'call_id' AND call.catalog_execution_id=owner.id AND call.workspace_id=owner.workspace_id
  WHERE checkpoint.engine_execution_id=owner.id AND checkpoint.metadata->>'contract_version'='workspace-incremental-editorial-checkpoint-v1'
  AND NOT COALESCE(checkpoint.workspace_id=owner.workspace_id AND checkpoint.artifact_type='engine_proposals'
   AND checkpoint.content->>'sha256'~'^sha256:[0-9a-f]{64}$' AND (checkpoint.content->>'size_bytes')::bigint BETWEEN 1 AND 2097152
   AND checkpoint.content->>'storage_key' LIKE 'workspace-engine/'||owner.workspace_id::text||'/'||owner.id::text||'/%'
   AND call.actor_user_id=owner.actor_user_id AND call.workspace_contract='workspace-engine-interpretation-v1'
   AND call.call_state='settled' AND call.response_http_status=200 AND call.metadata->>'response_complete' IS DISTINCT FROM 'false'
   AND call.response_storage_key IS NOT NULL AND call.response_sha256=checkpoint.metadata->>'response_sha256'
   AND call.call_configuration=owner.input_snapshot->'interpretation_configuration' AND call.call_configuration=workspace_incremental_editorial_sonnet_v1()
   AND call.request_digest=checkpoint.metadata->>'request_digest'
   AND checkpoint.metadata->>'numeric_execution_id'=numeric.id::text AND checkpoint.metadata->>'numeric_checkpoint_digest'=owner.input_snapshot->>'numeric_checkpoint_digest'
   AND checkpoint.metadata->>'evidence_digest'=owner.input_snapshot->>'evidence_digest' AND checkpoint.metadata->>'target_binding_digest'=owner.input_snapshot->>'target_binding_digest'
   AND checkpoint.metadata->'unit_keys'=workspace_incremental_editorial_request_v1(owner.id,call.request_digest)->'unit_keys'
   AND call.metadata->'editorial_repair' IS NOT DISTINCT FROM workspace_incremental_editorial_request_v1(owner.id,call.request_digest)->'editorial_repair'
   AND (NOT call.metadata ? 'editorial_repair' OR EXISTS(SELECT 1 FROM engine_cost_events original WHERE original.id::text=call.metadata->'editorial_repair'->>'source_call_id'
    AND original.catalog_execution_id=owner.id AND original.workspace_id=owner.workspace_id AND original.actor_user_id=owner.actor_user_id
    AND original.call_state='settled' AND original.response_http_status=200 AND original.metadata->>'response_complete' IS DISTINCT FROM 'false'
    AND original.response_storage_key IS NOT NULL AND original.response_sha256=call.metadata->'editorial_repair'->>'source_response_sha256'
    AND original.request_digest=call.metadata->'editorial_repair'->>'source_request_digest' AND original.call_configuration=call.call_configuration AND NOT original.metadata ? 'editorial_repair')),false))),false)
$$;

CREATE FUNCTION signal_workspace_incremental_serving_owners_v1(target uuid)
RETURNS TABLE(owner_id uuid) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT owner.id FROM signal_topic_catalog_executions owner JOIN signal_topic_catalog_executions numeric ON numeric.id=target
 WHERE owner.workspace_id=numeric.workspace_id AND owner.input_contract='workspace-incremental-editorial-v1' AND owner.status='ready'
 AND (owner.source_execution_id=numeric.id OR owner.source_execution_id IN(SELECT parent_id FROM signal_workspace_incremental_projection_lineage_v1(numeric.id)))
$$;
CREATE FUNCTION signal_workspace_incremental_serving_current_v1(target uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_workspace_incremental_projection_history_current_v1(target)
 AND NOT EXISTS(SELECT 1 FROM signal_workspace_incremental_serving_owners_v1(target) candidate
  JOIN signal_topic_catalog_executions owner ON owner.id=candidate.owner_id JOIN signal_topic_catalog_executions numeric ON numeric.id=target
  WHERE NOT signal_workspace_incremental_editorial_paid_v1(owner.id) OR owner.input_snapshot->>'context_digest' IS DISTINCT FROM numeric.input_snapshot->>'context_digest')
$$;
CREATE FUNCTION signal_workspace_incremental_serving_history_v1(target uuid)
RETURNS TABLE(artifact_id uuid,source jsonb) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT artifact_id,NULL::jsonb FROM signal_workspace_incremental_projection_history_v1(target)
 UNION ALL SELECT artifact.id,jsonb_build_object('kind','incremental_editorial','numeric_execution_id',owner.source_execution_id::text,
  'numeric_checkpoint_digest',owner.input_snapshot->>'numeric_checkpoint_digest','evidence_plan_artifact_id',owner.input_snapshot->>'evidence_plan_artifact_id',
  'evidence_digest',owner.input_snapshot->>'evidence_digest','target_binding_digest',owner.input_snapshot->>'target_binding_digest',
  'request_plan_artifact_id',owner.result_summary->>'request_plan_artifact_id','request_plan_digest',owner.result_summary->>'request_plan_digest',
  'response_sha256',artifact.metadata->>'response_sha256','claims',(SELECT jsonb_agg(jsonb_build_object('claim_artifact_id',claim.id::text,
   'owner_execution_id',owner.id::text,'component_key',claim.metadata->>'component_key','unit',claim.metadata->'unit','model_origin',claim.metadata->'model_origin')
   ORDER BY claim.metadata->'unit'->>'unit_key' COLLATE "C") FROM analysis_artifacts claim WHERE claim.engine_execution_id=owner.id
   AND claim.workspace_id=owner.workspace_id AND claim.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1' AND artifact.metadata->'unit_keys' ? (claim.metadata->'unit'->>'unit_key')))
 FROM signal_workspace_incremental_serving_owners_v1(target) candidate JOIN signal_topic_catalog_executions owner ON owner.id=candidate.owner_id
 JOIN analysis_artifacts artifact ON artifact.engine_execution_id=owner.id AND artifact.workspace_id=owner.workspace_id
 WHERE artifact.metadata->>'contract_version'='workspace-incremental-editorial-checkpoint-v1' AND signal_workspace_incremental_editorial_paid_v1(owner.id)
$$;
CREATE FUNCTION signal_workspace_incremental_serving_digest_v1(target uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT workspace_incremental_editorial_digest_v1(COALESCE(jsonb_agg(jsonb_build_object('artifact_id',artifact.id::text,
 'owner_execution_id',artifact.engine_execution_id::text,'artifact_sha256',artifact.content->>'sha256','call_id',call.id::text,'request_digest',call.request_digest)
 ||CASE WHEN history.source IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('source_digest',workspace_incremental_editorial_digest_v1(history.source)) END ORDER BY artifact.id),'[]'::jsonb))
 FROM signal_workspace_incremental_serving_history_v1(target) history JOIN analysis_artifacts artifact ON artifact.id=history.artifact_id
 JOIN engine_cost_events call ON call.id::text=artifact.metadata->>'call_id'
$$;
CREATE FUNCTION signal_workspace_incremental_binding_provenance_v1(target uuid,binding jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_workspace_incremental_serving_history_v1(target) history
 JOIN analysis_artifacts proposal ON proposal.id=history.artifact_id WHERE proposal.id::text=binding->'proposal'->>'artifact_id'
 AND CASE WHEN history.source IS NULL THEN NOT (binding->'proposal') ? 'source' AND binding->'model_origin'->>'execution_id'=proposal.engine_execution_id::text
 ELSE binding->'proposal'->'source'->>'kind'='incremental_editorial' AND binding->'proposal'->'source'->>'source_digest'=workspace_incremental_editorial_digest_v1(history.source)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(history.source->'claims') claim WHERE claim->>'claim_artifact_id'=binding->'proposal'->'source'->>'claim_artifact_id'
  AND claim->>'owner_execution_id'=proposal.engine_execution_id::text AND claim->>'component_key'=binding->>'component_key'
  AND claim->'unit'->>'unit_key'=binding->>'unit_key' AND claim->'unit'->>'birth_membership_digest'=binding->>'birth_membership_digest'
  AND claim->'model_origin'=binding->'model_origin') END),false)
$$;

-- Preserve the existing population, census, digest and membership guards; only
-- the serving provenance branch changes. Admission functions remain untouched.
CREATE OR REPLACE FUNCTION signal_workspace_incremental_binding_scope_v1(artifact analysis_artifacts)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN signal_topic_classification_outbox dispatch ON dispatch.execution_id=engine.id AND dispatch.workspace_id=engine.workspace_id
   AND dispatch.dispatch_kind='incremental_projection' AND dispatch.status IN('dispatching','dispatched')
  WHERE engine.id=artifact.engine_execution_id AND engine.workspace_id=artifact.workspace_id AND engine.status='ready'
   AND engine.input_snapshot ? 'numeric_descriptor' AND engine.result_summary ? 'numeric_checkpoint'
   AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=engine.workspace_id)
   AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp())
   AND signal_workspace_incremental_execution_current_v1(engine.id) AND signal_workspace_incremental_serving_current_v1(engine.id)
   AND signal_workspace_classification_actor_v1(engine.workspace_id,engine.actor_user_id)
   AND artifact.metadata->>'actor_user_id'=engine.actor_user_id::text
   AND artifact.metadata->>'worker_job_id'=dispatch.worker_job_id
   AND dispatch.worker_job_id='workspace-incremental-projection-'||engine.id::text||'-'||substring(workspace_incremental_editorial_digest_v1(jsonb_build_array(
    engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest',(SELECT id::text FROM signal_taxonomy_profiles WHERE workspace_id=engine.workspace_id AND kind='topic'
     AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1),
    signal_workspace_incremental_correction_epoch_v1(engine.workspace_id),signal_workspace_incremental_serving_digest_v1(engine.id))) FROM 8)
   AND artifact.metadata->>'numeric_checkpoint_digest'=engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
   AND artifact.metadata->>'derivation_digest'~'^sha256:[0-9a-f]{64}$'),false)
$$;

CREATE OR REPLACE FUNCTION guard_workspace_incremental_binding_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE engine signal_topic_catalog_executions%ROWTYPE; binding jsonb; component analysis_artifacts%ROWTYPE;
 proposal analysis_artifacts%ROWTYPE; receipt engine_cost_events%ROWTYPE; census_row analysis_artifacts%ROWTYPE;
 topic taxonomy_terms%ROWTYPE; actual_bindings jsonb; coverage jsonb; expected_count bigint; actual_count bigint; expected_digest text; actual_digest text;
BEGIN
 IF NOT (COALESCE(NEW.metadata->>'contract_version','') IN('workspace-incremental-unit-census-v1','workspace-incremental-unit-binding-v1','workspace-incremental-binding-index-v1') OR COALESCE(OLD.metadata->>'contract_version','') IN('workspace-incremental-unit-census-v1','workspace-incremental-unit-binding-v1','workspace-incremental-binding-index-v1')) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' OR ROW(NEW.content,NEW.metadata,NEW.engine_execution_id,NEW.workspace_id,NEW.artifact_key,NEW.artifact_type)
    IS DISTINCT FROM ROW(OLD.content,OLD.metadata,OLD.engine_execution_id,OLD.workspace_id,OLD.artifact_key,OLD.artifact_type) THEN
   RAISE EXCEPTION 'workspace_incremental_projection_history_immutable' USING ERRCODE='55000'; END IF;RETURN NEW;
 END IF;
 IF NEW.artifact_type<>'engine_output' OR NOT signal_workspace_incremental_binding_scope_v1(NEW) THEN
  RAISE EXCEPTION 'workspace_incremental_projection_binding_scope_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO engine FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id;
 IF NEW.metadata->>'contract_version'='workspace-incremental-unit-census-v1' THEN
  SELECT * INTO component FROM analysis_artifacts WHERE engine_execution_id=engine.id AND workspace_id=engine.workspace_id
   AND metadata->>'contract_version'='workspace-incremental-component-v1' AND metadata->>'component_key'=NEW.metadata->>'component_key';
  IF NOT COALESCE(component.id IS NOT NULL AND NEW.metadata->'unit'->>'unit_key'~'^(open|guided):[0-9a-f-]{36}$'
   AND split_part(NEW.metadata->'unit'->>'unit_key',':',1)=component.metadata->>'lane'
   AND (NEW.metadata->'unit'->>'local_label')::bigint>=0 AND NEW.metadata->'unit'->>'birth_membership_digest'~'^sha256:[0-9a-f]{64}$'
   AND NEW.artifact_key='incremental-census-'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_array(
    NEW.metadata->>'derivation_digest',NEW.metadata->'unit'->>'unit_key')),'UTF8')),'hex')
   AND EXISTS(SELECT 1 FROM analysis_artifacts file WHERE file.engine_execution_id=engine.id AND file.workspace_id=engine.workspace_id
    AND file.artifact_key='model-components.json' AND file.content=NEW.content),false) THEN
   RAISE EXCEPTION 'workspace_incremental_projection_census_invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT COALESCE(NEW.metadata->>'engine_execution_id'=engine.id::text
  AND NEW.metadata->>'editorial_cut_digest'=signal_workspace_incremental_serving_digest_v1(engine.id)
  AND NEW.metadata->>'catalog_profile_id'=(SELECT id::text FROM signal_taxonomy_profiles WHERE workspace_id=engine.workspace_id AND kind='topic'
   AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1)
  AND NEW.metadata->'identity'->>'workspace_id'=engine.workspace_id::text
  AND NEW.metadata->'identity'->>'context_digest'=engine.input_snapshot->>'context_digest'
  AND NEW.metadata->'identity'->>'embedding_config_digest'=engine.embedding_config_digest
  AND NEW.metadata->>'derivation_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_object(
   'engine_execution_id',engine.id::text,'numeric_checkpoint_digest',NEW.metadata->>'numeric_checkpoint_digest',
   'catalog_profile_id',NEW.metadata->>'catalog_profile_id','identity',NEW.metadata->'identity',
   'correction_digest',NEW.metadata->>'correction_digest','editorial_cut_digest',NEW.metadata->>'editorial_cut_digest')),'UTF8')),'hex'),false) THEN
  RAISE EXCEPTION 'workspace_incremental_projection_binding_identity_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.metadata->>'contract_version'='workspace-incremental-unit-binding-v1' THEN
  binding:=NEW.metadata->'binding';
  SELECT * INTO component FROM analysis_artifacts WHERE engine_execution_id=engine.id AND workspace_id=engine.workspace_id
   AND metadata->>'contract_version'='workspace-incremental-component-v1' AND metadata->>'component_key'=binding->>'component_key';
  SELECT * INTO census_row FROM analysis_artifacts WHERE engine_execution_id=engine.id AND workspace_id=engine.workspace_id
   AND metadata->>'contract_version'='workspace-incremental-unit-census-v1' AND metadata->>'derivation_digest'=NEW.metadata->>'derivation_digest'
   AND metadata->'unit'->>'unit_key'=binding->>'unit_key';
  SELECT artifact.* INTO proposal FROM signal_workspace_incremental_serving_history_v1(engine.id) history
   JOIN analysis_artifacts artifact ON artifact.id=history.artifact_id WHERE artifact.id=(binding->'proposal'->>'artifact_id')::uuid;
  SELECT * INTO receipt FROM engine_cost_events WHERE id=(binding->'proposal'->>'call_id')::uuid;
  IF NOT COALESCE(component.id IS NOT NULL AND census_row.id IS NOT NULL AND proposal.id IS NOT NULL
   AND census_row.metadata->>'component_key'=component.metadata->>'component_key'
   AND census_row.metadata->'unit'->>'birth_membership_digest'=binding->>'birth_membership_digest'
   AND component.metadata->'model_origin'=binding->'model_origin'
   AND signal_workspace_incremental_binding_provenance_v1(engine.id,binding)
   AND binding->'proposal'->>'owner_execution_id'=proposal.engine_execution_id::text
   AND binding->'proposal'->>'artifact_sha256'=proposal.content->>'sha256'
   AND proposal.metadata->'unit_keys' ? (binding->>'unit_key')
   AND proposal.metadata->>'call_id'=receipt.id::text AND receipt.call_state='settled'
   AND binding->'proposal'->>'request_digest'=receipt.request_digest
   AND binding->'proposal'->>'configuration_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(receipt.call_configuration),'UTF8')),'hex')
   AND binding->'proposal'->>'cluster_digest'~'^sha256:[0-9a-f]{64}$'
   AND binding->'proposal'->>'proposal_semantics_digest'~'^sha256:[0-9a-f]{64}$'
   AND binding->'proposal'->>'status' IN('coherent','mixed','insufficient')
   AND NEW.artifact_key='incremental-unit-'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_array(
    NEW.metadata->>'derivation_digest',binding->>'unit_key')),'UTF8')),'hex'),false) THEN
   RAISE EXCEPTION 'workspace_incremental_projection_binding_invalid' USING ERRCODE='23514'; END IF;
  IF binding->>'term_key' IS NOT NULL THEN
   SELECT term.* INTO topic FROM signal_taxonomy_profiles profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
    WHERE profile.id=(NEW.metadata->>'catalog_profile_id')::uuid AND profile.workspace_id=engine.workspace_id AND term.term_key=binding->>'term_key';
   IF NOT COALESCE(topic.id IS NOT NULL AND topic.metadata->'topic'->>'definition_digest'=binding->>'definition_digest'
    AND topic.metadata->'topic'->>'definition_revision'=binding->>'definition_revision'
    AND topic.metadata->'topic'->'source'->>'candidate_key'=binding->>'unit_key'
    AND topic.metadata->'topic'->'source'->>'run_key'='workspace-engine:'||proposal.engine_execution_id::text
    AND topic.metadata->'topic'->'source'->>'candidate_digest'=binding->'proposal'->>'cluster_digest',false) THEN
    RAISE EXCEPTION 'workspace_incremental_projection_topic_invalid' USING ERRCODE='23514'; END IF;
  ELSIF binding->>'definition_digest' IS NOT NULL OR binding->>'definition_revision' IS NOT NULL THEN
   RAISE EXCEPTION 'workspace_incremental_projection_topic_invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.artifact_key<>'incremental-bindings-'||substring(NEW.metadata->>'derivation_digest' from 8)||'.jsonl'
  OR NOT signal_workspace_incremental_unit_census_valid_v1(engine.id,NEW.metadata->>'derivation_digest') THEN
  RAISE EXCEPTION 'workspace_incremental_projection_census_incomplete' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(jsonb_agg(artifact.metadata->'binding' ORDER BY artifact.metadata->'binding'->>'unit_key' COLLATE "C"),'[]'::jsonb),count(*),
  'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(artifact.metadata->'binding'->>'unit_key')::text||E'\n','' ORDER BY artifact.metadata->'binding'->>'unit_key' COLLATE "C"),''),'UTF8')),'hex')
 INTO actual_bindings,actual_count,actual_digest FROM analysis_artifacts artifact WHERE artifact.engine_execution_id=engine.id
  AND artifact.metadata->>'contract_version'='workspace-incremental-unit-binding-v1' AND artifact.metadata->>'derivation_digest'=NEW.metadata->>'derivation_digest';
 SELECT count(*),'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(census.metadata->'unit'->>'unit_key')::text||E'\n','' ORDER BY census.metadata->'unit'->>'unit_key' COLLATE "C"),''),'UTF8')),'hex')
 INTO expected_count,expected_digest FROM analysis_artifacts census WHERE census.engine_execution_id=engine.id
  AND census.metadata->>'contract_version'='workspace-incremental-unit-census-v1' AND census.metadata->>'derivation_digest'=NEW.metadata->>'derivation_digest';
 coverage:=jsonb_build_object('interpreted_unit_count',actual_count,'expected_unit_count',expected_count,
  'unit_digest',actual_digest,'expected_unit_digest',expected_digest,'complete',actual_count=expected_count);
 IF NOT COALESCE(NEW.metadata->'interpretation_coverage'=coverage
  AND NEW.metadata->>'binding_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_object(
   'bindings',actual_bindings,'editorial_cut_digest',NEW.metadata->>'editorial_cut_digest','interpretation_coverage',coverage)),'UTF8')),'hex')
  AND NEW.metadata->'discovery_coverage'->>'state'=engine.result_summary->'numeric_checkpoint'->>'discovery_status'
  AND (NEW.metadata->'discovery_coverage'->>'pending_roots')::bigint BETWEEN 0 AND engine.denominator
  AND ((NEW.metadata->'discovery_coverage'->>'state'='complete')=((NEW.metadata->'discovery_coverage'->>'pending_roots')::bigint=0)),false)
  OR EXISTS(SELECT 1 FROM analysis_artifacts alias WHERE alias.engine_execution_id=engine.id
   AND alias.metadata->>'contract_version'='workspace-incremental-unit-binding-v1' AND alias.metadata->>'derivation_digest'=NEW.metadata->>'derivation_digest'
   AND (alias.content<>NEW.content OR alias.metadata-'contract_version'-'binding'<>NEW.metadata-'contract_version')) THEN
  RAISE EXCEPTION 'workspace_incremental_projection_index_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_workspace_incremental_projection_source_current_v1(generation signal_classification_generations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions engine
  JOIN analysis_artifacts binding ON binding.id::text=generation.input_snapshot->'source_projection'->>'binding_artifact_id'
   AND binding.engine_execution_id=engine.id AND binding.workspace_id=engine.workspace_id AND binding.artifact_type='engine_output'
  JOIN analysis_artifacts output ON output.id::text=generation.input_snapshot->'source_projection'->>'output_artifact_id'
   AND output.engine_execution_id=engine.id AND output.workspace_id=engine.workspace_id AND output.artifact_key='manifest.json'
  WHERE engine.id::text=generation.input_snapshot->'source_projection'->>'engine_execution_id' AND engine.workspace_id=generation.workspace_id
   AND engine.status='ready' AND engine.input_snapshot ? 'numeric_descriptor' AND engine.result_summary ? 'numeric_checkpoint'
   AND engine.input_revision=generation.input_revision AND engine.embedding_run_id=generation.embedding_run_id AND engine.preparation_run_id=generation.preparation_run_id
   AND signal_workspace_incremental_execution_current_v1(engine.id) AND signal_workspace_incremental_serving_current_v1(engine.id)
   AND signal_workspace_incremental_origin_current_v1(engine.id,engine.workspace_id)
   AND binding.metadata->>'contract_version'='workspace-incremental-binding-index-v1'
   AND binding.metadata->>'catalog_profile_id'=generation.taxonomy_profile_id::text
   AND binding.metadata->'identity'=generation.input_snapshot->'identity'
   AND binding.metadata->>'correction_digest'=generation.input_snapshot->>'correction_digest'
   AND binding.metadata->>'actor_user_id'=generation.created_by_user_id::text
   AND binding.metadata->>'numeric_checkpoint_digest'=engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
   AND generation.input_snapshot->'source_projection'->>'numeric_checkpoint_digest'=binding.metadata->>'numeric_checkpoint_digest'
   AND generation.input_snapshot->'source_projection'->>'workspace_id'=engine.workspace_id::text
   AND generation.input_snapshot->'source_projection'->>'population_digest'=engine.result_summary->'numeric_checkpoint'->>'population_digest'
   AND generation.input_snapshot->'source_projection'->>'editorial_cut_digest'=binding.metadata->>'editorial_cut_digest'
   AND generation.input_snapshot->'source_projection'->>'binding_digest'=binding.metadata->>'binding_digest'
   AND generation.input_snapshot->'source_projection'->>'policy_digest'=generation.input_snapshot->'identity'->>'decision_policy_digest'
   AND generation.input_snapshot->'source_projection'->'interpretation_coverage'=binding.metadata->'interpretation_coverage'
   AND generation.input_snapshot->'source_projection'->'discovery_coverage'=binding.metadata->'discovery_coverage'
   AND output.id::text=engine.result_summary->'numeric_checkpoint'->>'output_artifact_id'
   AND generation.input_snapshot->'source_projection'->>'output_manifest_sha256'=output.content->>'sha256'
   AND EXISTS(SELECT 1 FROM analysis_artifacts members WHERE members.id::text=generation.input_snapshot->'source_projection'->>'memberships_artifact_id'
    AND members.engine_execution_id=engine.id AND members.workspace_id=engine.workspace_id AND members.artifact_key='memberships.jsonl')
   AND EXISTS(SELECT 1 FROM analysis_artifacts roots WHERE roots.id::text=generation.input_snapshot->'source_projection'->>'roots_artifact_id'
    AND roots.engine_execution_id=engine.id AND roots.workspace_id=engine.workspace_id AND roots.artifact_key='roots.jsonl')
   AND CASE WHEN engine.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id' IS NULL THEN
    generation.input_snapshot->'source_projection'->>'model_bank_artifact_id' IS NULL AND generation.input_snapshot->'source_projection'->>'model_version_id' IS NULL
    AND generation.input_snapshot->'identity'->>'engine_artifact_digest'=output.content->>'sha256'
   ELSE EXISTS(SELECT 1 FROM analysis_artifacts bank JOIN tagging_model_versions registry
    ON registry.id::text=generation.input_snapshot->'source_projection'->>'model_version_id'
     AND registry.configuration->>'binding_artifact_id'=binding.id::text AND registry.configuration->>'binding_digest'=binding.metadata->>'binding_digest'
     AND registry.configuration->'workspace_classification_identity'=generation.input_snapshot->'identity'
     AND registry.configuration->>'contract_version'='workspace-topic-incremental-projection-v1'
     AND registry.taxonomy_profile_id=generation.taxonomy_profile_id AND registry.artifact_digest=bank.content->>'sha256'
     AND (SELECT event.status FROM signal_tagging_model_version_events event WHERE event.model_version_id=registry.id
      AND event.workspace_id=generation.workspace_id AND event.effective_at<=now() ORDER BY event.effective_at DESC,event.created_at DESC,event.id DESC LIMIT 1) IN('draft','evaluated','approved')
    WHERE bank.id::text=engine.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id' AND bank.engine_execution_id=engine.id AND bank.workspace_id=engine.workspace_id
     AND generation.input_snapshot->'source_projection'->>'model_bank_artifact_id'=bank.id::text
     AND generation.input_snapshot->'identity'->>'engine_artifact_digest'=bank.content->>'sha256') END),false)
$$;

CREATE FUNCTION guard_signal_workspace_incremental_catalog_receipt_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE body jsonb; engine signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF COALESCE(NEW.action,'')<>'materialize_incremental' AND COALESCE(OLD.action,'')<>'materialize_incremental' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'workspace_incremental_catalog_receipt_immutable' USING ERRCODE='55000'; END IF;
 body:=NEW.result_summary;
 SELECT * INTO engine FROM signal_topic_catalog_executions WHERE id::text=body->>'numeric_execution_id' AND workspace_id=NEW.workspace_id;
 IF NOT COALESCE(engine.input_snapshot ? 'numeric_descriptor' AND engine.status='ready' AND engine.actor_user_id=NEW.actor_user_id
  AND signal_workspace_classification_actor_v1(NEW.workspace_id,NEW.actor_user_id) AND signal_workspace_incremental_execution_current_v1(engine.id)
  AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=NEW.workspace_id)
  AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp()) AND signal_workspace_incremental_origin_current_v1(engine.id,engine.workspace_id)
  AND signal_workspace_incremental_serving_current_v1(engine.id)
  AND body->>'contract_version'='workspace-incremental-editorial-catalog-receipt-v1' AND body->>'receipt_id'=NEW.id::text
  AND body->>'serving_editorial_cut_digest'=signal_workspace_incremental_serving_digest_v1(engine.id)
  AND NEW.idempotency_key='incremental-catalog:'||engine.id::text||':'||substring(body->>'serving_editorial_cut_digest' FROM 8)
  AND NEW.request_digest=workspace_incremental_editorial_digest_v1(jsonb_build_object('numeric_execution_id',engine.id::text,'serving_editorial_cut_digest',body->>'serving_editorial_cut_digest'))
  AND body->>'output_catalog_profile_id'=NEW.result_profile_id::text AND body->>'mapping_digest'~'^sha256:[0-9a-f]{64}$'
  AND EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile WHERE profile.id=NEW.result_profile_id AND profile.workspace_id=NEW.workspace_id
   AND profile.version::text=body->>'output_catalog_revision' AND profile.id=(SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=NEW.workspace_id AND kind='topic'
    AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1))
  AND jsonb_typeof(body->'topic_count')='number' AND jsonb_typeof(body->'discovered_topic_count')='number'
  AND body->>'topic_count'=(SELECT count(*)::text FROM taxonomy_terms term JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id
   WHERE profile.id=NEW.result_profile_id AND term.metadata->'topic'->>'lifecycle'<>'archived')
  AND body->>'discovered_topic_count'=(SELECT count(*)::text FROM taxonomy_terms term JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id
   WHERE profile.id=NEW.result_profile_id AND term.metadata->'topic'->>'lifecycle'<>'archived' AND term.metadata->'topic'->>'origin'='workspace_discovery')
  AND NEW.result_term_key='' AND NEW.selection_result IS NULL,false) THEN RAISE EXCEPTION 'workspace_incremental_catalog_receipt_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_incremental_catalog_receipt BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_catalog_operations
 FOR EACH ROW EXECUTE FUNCTION guard_signal_workspace_incremental_catalog_receipt_v1();
DO $$ DECLARE function_oid regprocedure; role_name text; BEGIN
 FOR function_oid IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[
 'signal_workspace_incremental_editorial_paid_v1','signal_workspace_incremental_serving_owners_v1','signal_workspace_incremental_serving_current_v1',
 'signal_workspace_incremental_serving_history_v1','signal_workspace_incremental_serving_digest_v1','signal_workspace_incremental_binding_provenance_v1',
 'signal_workspace_incremental_binding_scope_v1','guard_workspace_incremental_binding_v1','signal_workspace_incremental_projection_source_current_v1',
 'guard_signal_workspace_incremental_catalog_receipt_v1']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',function_oid);
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',function_oid,role_name); END IF; END LOOP;
 END LOOP; END $$;
