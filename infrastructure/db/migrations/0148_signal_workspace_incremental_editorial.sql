-- Admission/ownership only. No dispatch or provider route is enabled by this migration.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO definition FROM pg_constraint WHERE conrelid='signal_topic_catalog_executions'::regclass AND conname='workspace_topic_input_shape';
 ALTER TABLE signal_topic_catalog_executions DROP CONSTRAINT workspace_topic_input_shape;
 EXECUTE 'ALTER TABLE signal_topic_catalog_executions ADD CONSTRAINT workspace_topic_input_shape CHECK (('||definition||') OR COALESCE(input_contract=''workspace-incremental-editorial-v1'' AND study_corpus_id IS NULL AND watermark_digest IS NULL AND intent=''search'' AND NOT publish_when_ready AND generation_id IS NULL AND source_execution_id IS NOT NULL AND embedding_run_id IS NOT NULL AND preparation_run_id IS NOT NULL AND input_revision>0 AND input_digest~''^sha256:[0-9a-f]{64}$'' AND jsonb_typeof(input_snapshot)=''object'',false))';
END $$;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO definition FROM pg_constraint WHERE conrelid='signal_topic_catalog_executions'::regclass AND conname='signal_topic_catalog_execution_source';
 ALTER TABLE signal_topic_catalog_executions DROP CONSTRAINT signal_topic_catalog_execution_source;
 EXECUTE 'ALTER TABLE signal_topic_catalog_executions ADD CONSTRAINT signal_topic_catalog_execution_source CHECK (('||definition||') OR (input_contract=''workspace-incremental-editorial-v1'' AND source_execution_id IS NOT NULL))';
END $$;
DROP INDEX uq_signal_topic_catalog_execution_active_profile;
CREATE UNIQUE INDEX uq_signal_topic_catalog_execution_active_profile ON signal_topic_catalog_executions(taxonomy_profile_id,intent,
 (CASE WHEN input_contract='workspace-incremental-editorial-v1' THEN 'incremental_editorial'
 WHEN input_snapshot ? 'numeric_descriptor' THEN 'numeric'
 WHEN input_contract='workspace-topic-classification-v1' AND input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1'
 THEN 'incremental_classification' ELSE 'legacy' END)) WHERE status IN('queued','running');
CREATE UNIQUE INDEX uq_workspace_incremental_editorial_unit ON analysis_artifacts(workspace_id,(metadata->>'component_key'),(metadata->'unit'->>'unit_key'))
 WHERE metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1';
CREATE FUNCTION workspace_incremental_editorial_digest_v1(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT 'sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(value),'UTF8')),'hex')
$$;
CREATE FUNCTION workspace_incremental_editorial_census_v1(target uuid) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT metadata->>'derivation_digest' FROM analysis_artifacts WHERE engine_execution_id=target AND metadata->>'contract_version'='workspace-incremental-unit-census-v1'
 GROUP BY metadata->>'derivation_digest' HAVING signal_workspace_incremental_unit_census_valid_v1(target,metadata->>'derivation_digest')
 ORDER BY max(created_at) DESC,metadata->>'derivation_digest' LIMIT 1
$$;
CREATE FUNCTION workspace_incremental_editorial_units_v1(target uuid)
RETURNS TABLE(census_artifact_id uuid,component_artifact_id uuid,identity jsonb,emergent boolean,claimed_by uuid) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT census.id,component.id,jsonb_build_object('component_key',component.metadata->>'component_key','unit',census.metadata->'unit','model_origin',component.metadata->'model_origin'),
 origin.input_snapshot ? 'numeric_descriptor',claim.engine_execution_id
 FROM analysis_artifacts census JOIN analysis_artifacts component ON component.engine_execution_id=census.engine_execution_id AND component.workspace_id=census.workspace_id
  AND component.metadata->>'contract_version'='workspace-incremental-component-v1' AND component.metadata->>'component_key'=census.metadata->>'component_key'
 JOIN signal_topic_catalog_executions origin ON origin.id::text=component.metadata->'model_origin'->>'execution_id' AND origin.workspace_id=component.workspace_id
 LEFT JOIN analysis_artifacts claim ON claim.workspace_id=census.workspace_id AND claim.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1'
  AND claim.metadata->>'component_key'=component.metadata->>'component_key' AND claim.metadata->'unit'->>'unit_key'=census.metadata->'unit'->>'unit_key'
 WHERE census.engine_execution_id=target AND census.metadata->>'contract_version'='workspace-incremental-unit-census-v1'
  AND census.metadata->>'derivation_digest'=workspace_incremental_editorial_census_v1(target)
$$;
CREATE FUNCTION workspace_incremental_editorial_policy_v1(target uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('source_execution_id',parent.id::text,'budget_actor_user_id',child.actor_user_id::text,
 'budget_timezone',COALESCE(parent.interpretation_revision->'configuration',parent.input_snapshot->'interpretation_config')->>'budget_timezone',
 'daily_cap_micro_usd',COALESCE(parent.interpretation_revision->'configuration',parent.input_snapshot->'interpretation_config')->'daily_cap_micro_usd')
 FROM signal_topic_catalog_executions child CROSS JOIN LATERAL signal_workspace_incremental_projection_lineage_v1(child.id) lineage
 JOIN signal_topic_catalog_executions parent ON parent.id=lineage.parent_id AND parent.workspace_id=child.workspace_id AND parent.actor_user_id=child.actor_user_id
 WHERE child.id=target AND NOT parent.input_snapshot ? 'numeric_descriptor' AND parent.input_snapshot ? 'interpretation_config'
 ORDER BY parent.created_at DESC,parent.id DESC LIMIT 1
$$;
CREATE FUNCTION workspace_incremental_editorial_source_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions source WHERE source.id=target AND source.status='ready'
  AND source.input_contract='workspace-topic-engine-v1' AND source.input_snapshot ? 'numeric_descriptor'
  AND source.result_summary ? 'numeric_checkpoint' AND (source.input_snapshot->>'claude_cap_micro_usd')::bigint=0
  AND NOT source.input_snapshot ? 'interpretation_config' AND source.interpretation_admission_operation_id IS NULL
  AND source.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=source.workspace_id)
  AND signal_workspace_incremental_parent_current_v1(source.id,source.workspace_id,source.actor_user_id)
  AND signal_workspace_incremental_execution_current_v1(source.id) AND signal_workspace_incremental_projection_history_current_v1(source.id)
  AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions newer WHERE newer.workspace_id=source.workspace_id AND newer.status='ready'
   AND newer.input_snapshot ? 'numeric_descriptor' AND newer.input_revision=source.input_revision AND (newer.created_at,newer.id)>(source.created_at,source.id))
  AND workspace_incremental_editorial_census_v1(source.id) IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM engine_cost_events call WHERE call.workspace_id=source.workspace_id AND call.call_state IN('reserved','in_flight','response_persisted','outcome_unknown')
   AND (call.catalog_execution_id=source.id OR call.catalog_execution_id IN(SELECT parent_id FROM signal_workspace_incremental_projection_lineage_v1(source.id))
    OR call.catalog_execution_id IN(SELECT claimed_by FROM workspace_incremental_editorial_units_v1(source.id))))),false)
$$;
CREATE FUNCTION workspace_incremental_editorial_targets_v1(target uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('expected_units',count(*),'unique_units',count(DISTINCT identity->'unit'->>'unit_key'),
 'target_units',count(*) FILTER(WHERE emergent AND claimed_by IS NULL),
 'target_unit_digest',workspace_incremental_editorial_digest_v1(COALESCE(jsonb_agg(identity ORDER BY identity->'unit'->>'unit_key' COLLATE "C") FILTER(WHERE emergent AND claimed_by IS NULL),'[]'::jsonb)),
 'legacy_units',count(*) FILTER(WHERE NOT emergent),'claimed_units',count(*) FILTER(WHERE claimed_by IS NOT NULL))
 FROM workspace_incremental_editorial_units_v1(target)
$$;
CREATE FUNCTION workspace_incremental_editorial_plan_unit_valid_v1(artifact analysis_artifacts) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM workspace_incremental_editorial_units_v1((artifact.metadata->>'numeric_execution_id')::uuid) known
 JOIN signal_topic_catalog_executions source ON source.id=(artifact.metadata->>'numeric_execution_id')::uuid AND source.workspace_id=artifact.workspace_id
 WHERE known.census_artifact_id=(artifact.metadata->>'census_artifact_id')::uuid
 AND artifact.metadata->'unit'->>'component_key'=known.identity->>'component_key'
 AND artifact.metadata->'unit'->'model_origin'=known.identity->'model_origin'
 AND (artifact.metadata->'unit'->>'local_label')::bigint=(known.identity->'unit'->>'local_label')::bigint
 AND artifact.metadata->'unit'->>'unit_key'=known.identity->'unit'->>'unit_key'
 AND artifact.metadata->'unit'->>'birth_membership_digest'=known.identity->'unit'->>'birth_membership_digest'
 AND artifact.metadata->'unit'->>'lane'=split_part(known.identity->'unit'->>'unit_key',':',1)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['root_count','chunk_count','local_label']) field WHERE jsonb_typeof(artifact.metadata->'unit'->field) IS DISTINCT FROM 'number' OR artifact.metadata->'unit'->>field !~ '^(0|[1-9][0-9]*)$' OR (artifact.metadata->'unit'->>field)::numeric>9007199254740991)
 AND (artifact.metadata->'unit'->>'chunk_count')::bigint>=(artifact.metadata->'unit'->>'root_count')::bigint
 AND ((artifact.metadata->'unit'->>'chunk_count')::bigint=0)=((artifact.metadata->'unit'->>'root_count')::bigint=0)
 AND artifact.metadata->'unit'->>'cluster_digest'~'^sha256:[0-9a-f]{64}$'
 AND (artifact.metadata->'unit'->>'root_count')::bigint BETWEEN 0 AND source.denominator
 AND (artifact.metadata->'unit'->>'chunk_count')::bigint BETWEEN 0 AND source.expected_chunks
 AND (CASE artifact.metadata->'unit'->>'status'
 WHEN 'editorial_claimed' THEN known.claimed_by IS NOT NULL
 WHEN 'already_interpreted' THEN EXISTS(SELECT 1 FROM signal_workspace_incremental_projection_history_v1(source.id) history JOIN analysis_artifacts proposal ON proposal.id=history.artifact_id
  WHERE proposal.engine_execution_id::text=known.identity->'model_origin'->>'execution_id' AND proposal.metadata->'unit_keys' ? (known.identity->'unit'->>'unit_key'))
 WHEN 'legacy_full_fit' THEN NOT known.emergent AND known.claimed_by IS NULL
 WHEN 'no_current_members' THEN known.emergent AND known.claimed_by IS NULL AND artifact.metadata->'unit'->>'root_count'='0' AND artifact.metadata->'unit'->>'chunk_count'='0'
 WHEN 'evidence_ready' THEN known.emergent AND known.claimed_by IS NULL AND (artifact.metadata->'unit'->>'root_count')::bigint>0 AND (artifact.metadata->'unit'->>'chunk_count')::bigint>0
 ELSE false END)),false)
$$;
CREATE FUNCTION workspace_incremental_editorial_validation_v1(target uuid,census jsonb,component_order jsonb) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT workspace_incremental_editorial_digest_v1(jsonb_build_object('contract_version','workspace-incremental-file-validation-v1',
 'request_digest',workspace_incremental_editorial_digest_v1(jsonb_build_object('input',input.metadata->'input','runtime_digest',source.input_snapshot->'numeric_descriptor'->'compatibility'->>'runtime_digest')),
 'population_digest',source.result_summary->'numeric_checkpoint'->>'population_digest',
 'complete_file_digest',(SELECT workspace_incremental_editorial_digest_v1(jsonb_agg(jsonb_build_object('file',artifact_key,'sha256',content->>'sha256','bytes',(content->>'size_bytes')::bigint) ORDER BY artifact_key COLLATE "C"))
 FROM analysis_artifacts file WHERE file.engine_execution_id=source.id AND file.metadata->>'filename'=file.artifact_key AND file.id::text<>source.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'),
 'origin_digest',(SELECT workspace_incremental_editorial_digest_v1(jsonb_agg(jsonb_build_object('component_key',component.metadata->>'component_key','lane',component.metadata->>'lane','model_origin',component.metadata->'model_origin',
 'model',jsonb_build_object('sha256',model.content->>'sha256','bytes',(model.content->>'size_bytes')::bigint),
 'center',CASE WHEN center.id IS NULL THEN NULL ELSE jsonb_build_object('sha256',center.content->>'sha256','bytes',(center.content->>'size_bytes')::bigint) END,
 'units',(SELECT jsonb_agg(unit.metadata->'unit' ORDER BY (unit.metadata->'unit'->>'local_label')::bigint) FROM analysis_artifacts unit WHERE unit.engine_execution_id=source.id
 AND unit.metadata->>'contract_version'='workspace-incremental-unit-census-v1' AND unit.metadata->>'component_key'=component.metadata->>'component_key' AND unit.metadata->>'derivation_digest'=workspace_incremental_editorial_census_v1(source.id))) ORDER BY ordering.ordinality))
 FROM jsonb_array_elements_text(component_order) WITH ORDINALITY ordering(component_key,ordinality)
 JOIN analysis_artifacts component ON component.metadata->>'component_key'=ordering.component_key JOIN analysis_artifacts model ON model.id=(component.metadata->>'model_artifact_id')::uuid
 LEFT JOIN analysis_artifacts center ON center.id=(component.metadata->>'center_artifact_id')::uuid
 WHERE component.engine_execution_id=source.id AND component.metadata->>'contract_version'='workspace-incremental-component-v1'),
 'roots',(census->>'roots')::bigint,'occurrences',(census->>'chunks')::bigint,'memberships',(census->>'memberships')::bigint,
 'pending_occurrences',(census->>'pending_occurrences')::bigint,'relations_scope','new_candidates_in_this_execution'))
 FROM signal_topic_catalog_executions source JOIN analysis_artifacts input ON input.id::text=source.result_summary->'numeric_checkpoint'->>'input_artifact_id' WHERE source.id=target
$$;

CREATE FUNCTION workspace_incremental_editorial_plan_valid_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM analysis_artifacts plan JOIN signal_topic_catalog_executions source ON source.id=(plan.metadata->>'numeric_execution_id')::uuid AND source.workspace_id=plan.workspace_id
 CROSS JOIN LATERAL(SELECT count(*) count,count(DISTINCT unit.metadata->'unit'->>'unit_key') unique_count,
 jsonb_agg(unit.metadata->'unit' ORDER BY unit.metadata->'unit'->>'unit_key' COLLATE "C") units,
 count(*) FILTER(WHERE unit.metadata->'unit'->>'status'='evidence_ready') ready,
 workspace_incremental_editorial_digest_v1(COALESCE(jsonb_agg(jsonb_build_object('component_key',unit.metadata->'unit'->>'component_key',
 'unit',jsonb_build_object('local_label',unit.metadata->'unit'->'local_label','unit_key',unit.metadata->'unit'->>'unit_key','birth_membership_digest',unit.metadata->'unit'->>'birth_membership_digest'),
 'model_origin',unit.metadata->'unit'->'model_origin') ORDER BY unit.metadata->'unit'->>'unit_key' COLLATE "C") FILTER(WHERE unit.metadata->'unit'->>'status'='evidence_ready'),'[]'::jsonb)) binding_digest,
 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(unit.metadata->'unit'->>'unit_key')::text||E'\n','' ORDER BY unit.metadata->'unit'->>'unit_key' COLLATE "C") FILTER(WHERE unit.metadata->'unit'->>'status'='evidence_ready'),''),'UTF8')),'hex') unit_digest
 FROM analysis_artifacts unit WHERE unit.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND unit.metadata->>'plan_artifact_id'=plan.id::text AND unit.workspace_id=plan.workspace_id AND (unit.metadata->>'numeric_execution_id')::uuid=source.id) census
 WHERE plan.id=target AND plan.metadata->>'contract_version'='workspace-incremental-editorial-plan-v1'
 AND workspace_incremental_editorial_source_v1(source.id)
 AND plan.metadata->>'plan_artifact_id'=plan.id::text AND plan.metadata->>'evidence_digest'=plan.metadata->'descriptor'->>'evidence_digest'
 AND plan.metadata->'descriptor'->>'contract_version'='workspace-incremental-editorial-evidence-stream-v1'
 AND plan.metadata->'descriptor'->>'representative_selection_policy'='distinct-roots-affiliation-boundary-v1'
 AND plan.metadata->'descriptor'->'stream'->>'contract_version'='workspace-incremental-editorial-evidence-jsonl-v1'
 AND plan.metadata->'descriptor'->>'numeric_execution_id'=source.id::text
 AND plan.metadata->'descriptor'->>'numeric_checkpoint_digest'=source.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
 AND plan.metadata->'descriptor'->>'population_digest'=source.result_summary->'numeric_checkpoint'->>'population_digest'
 AND plan.metadata->'descriptor'->>'numeric_manifest_sha256'=(SELECT content->>'sha256' FROM analysis_artifacts WHERE id::text=source.result_summary->'numeric_checkpoint'->>'output_artifact_id')
 AND census.count=(workspace_incremental_editorial_targets_v1(source.id)->>'expected_units')::bigint AND census.unique_count=census.count
 AND NOT EXISTS(SELECT 1 FROM analysis_artifacts unit WHERE unit.metadata->>'plan_artifact_id'=plan.id::text AND unit.id<>plan.id AND (NOT workspace_incremental_editorial_plan_unit_valid_v1(unit) OR unit.content<>plan.content OR unit.metadata->>'evidence_digest'<>plan.metadata->>'evidence_digest'))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions origin_run JOIN analysis_artifacts manifest ON manifest.id::text=origin_run.result_summary->'numeric_checkpoint'->>'output_artifact_id' JOIN analysis_artifacts candidate ON candidate.engine_execution_id=origin_run.id AND candidate.workspace_id=origin_run.workspace_id AND candidate.artifact_key='candidate-groups.json' WHERE origin_run.id::text=origin->>'execution_id' AND origin_run.workspace_id=source.workspace_id AND manifest.content->>'sha256'=origin->>'manifest_sha256' AND candidate.content->>'sha256'=origin->>'candidate_sha256' AND signal_workspace_incremental_parent_current_v1(origin_run.id,source.workspace_id,source.actor_user_id)))
 AND NOT EXISTS(SELECT 1 FROM workspace_incremental_editorial_units_v1(source.id) unit WHERE unit.emergent AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE origin->>'execution_id'=unit.identity->'model_origin'->>'execution_id'))
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['roots','chunks','memberships','pending_roots','pending_occurrences','expected_unit_count']) field WHERE jsonb_typeof(plan.metadata->'descriptor'->'census'->field) IS DISTINCT FROM 'number' OR plan.metadata->'descriptor'->'census'->>field !~ '^(0|[1-9][0-9]*)$' OR (plan.metadata->'descriptor'->'census'->>field)::numeric>9007199254740991)
 AND jsonb_typeof(plan.metadata->'descriptor'->'origins')='array'
 AND jsonb_typeof(plan.metadata->'descriptor'->'numeric_component_order')='array'
 AND (SELECT count(*)=count(DISTINCT key) AND count(*)=(source.result_summary->'numeric_checkpoint'->>'components')::bigint FROM jsonb_array_elements_text(plan.metadata->'descriptor'->'numeric_component_order') key)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(plan.metadata->'descriptor'->'numeric_component_order') key WHERE NOT EXISTS(SELECT 1 FROM analysis_artifacts component WHERE component.engine_execution_id=source.id AND component.metadata->>'contract_version'='workspace-incremental-component-v1' AND component.metadata->>'component_key'=key))
 AND (SELECT count(*)=count(DISTINCT origin->>'execution_id') FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.metadata->'descriptor'->'origins') origin WHERE NOT EXISTS(SELECT 1 FROM workspace_incremental_editorial_units_v1(source.id) unit WHERE unit.emergent AND unit.identity->'model_origin'->>'execution_id'=origin->>'execution_id'))
 AND (plan.metadata->'descriptor'->'census'->>'pending_roots')::bigint<=LEAST(source.denominator,(plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint)
 AND ((plan.metadata->'descriptor'->'census'->>'pending_roots')::bigint=0)=((plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint=0)
 AND (plan.metadata->'descriptor'->'census'->>'pending_occurrences')::bigint<=source.expected_chunks
 AND workspace_incremental_editorial_validation_v1(source.id,plan.metadata->'descriptor'->'census',plan.metadata->'descriptor'->'numeric_component_order')=source.result_summary->'numeric_checkpoint'->>'validation_digest'
 AND plan.metadata->'descriptor'->'census'->>'expected_unit_digest'=(SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(unit.identity->'unit'->>'unit_key')::text||E'\n','' ORDER BY unit.identity->'unit'->>'unit_key' COLLATE "C"),''),'UTF8')),'hex') FROM workspace_incremental_editorial_units_v1(source.id) unit)
 AND (plan.metadata->'descriptor'->'census'->>'roots')::bigint=source.denominator AND (plan.metadata->'descriptor'->'census'->>'chunks')::bigint=source.expected_chunks
 AND (plan.metadata->'descriptor'->'census'->>'expected_unit_count')::bigint=census.count
 AND plan.metadata->'descriptor'->'census'->>'population_digest'=source.result_summary->'numeric_checkpoint'->>'population_digest'
 AND plan.metadata->'descriptor'->>'evidence_digest'=workspace_incremental_editorial_digest_v1(((plan.metadata->'descriptor')-'evidence_digest')||jsonb_build_object('units',census.units))
 AND plan.metadata->'descriptor'->>'target_binding_digest'=census.binding_digest AND plan.metadata->'descriptor'->>'target_unit_digest'=census.unit_digest
 AND (plan.metadata->'descriptor'->'stream'->>'rows')::bigint=census.ready
 AND plan.metadata->'descriptor'->'stream'->>'sha256'=plan.content->>'sha256'
 AND plan.metadata->'descriptor'->'stream'->>'bytes'=plan.content->>'size_bytes'
 AND plan.metadata->>'history_cut_digest'=signal_workspace_incremental_projection_editorial_digest_v1(source.id)),false)
$$;
CREATE FUNCTION guard_workspace_incremental_editorial_plan_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF COALESCE(NEW.metadata->>'contract_version','') NOT IN('workspace-incremental-editorial-plan-v1','workspace-incremental-editorial-plan-unit-v1')
 AND COALESCE(OLD.metadata->>'contract_version','') NOT IN('workspace-incremental-editorial-plan-v1','workspace-incremental-editorial-plan-unit-v1') THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'workspace_incremental_editorial_plan_immutable' USING ERRCODE='55000'; END IF;
 IF NOT COALESCE(NEW.engine_execution_id IS NULL AND NEW.source_entity_type IS NULL AND NEW.source_entity_id IS NULL AND NEW.metadata->>'numeric_execution_id'~'^[0-9a-f-]{36}$'
 AND NEW.artifact_type='engine_output' AND NEW.review_status='draft' AND NEW.workspace_artifact_kind='topic_discovery'
 AND NEW.metadata->>'plan_artifact_id'~'^[0-9a-f-]{36}$' AND pg_column_size(NEW.metadata)<=65536 AND pg_column_size(NEW.content)<=4096
 AND NEW.content->>'contract_version'='workspace-engine-private-artifact-v1' AND NEW.content->>'sha256'~'^sha256:[0-9a-f]{64}$'
 AND (NEW.content->>'size_bytes')::bigint>=0 AND NEW.content->>'storage_key' LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||(NEW.metadata->>'numeric_execution_id')||'/%'
 AND position('..' in NEW.content->>'storage_key')=0 AND workspace_incremental_editorial_source_v1((NEW.metadata->>'numeric_execution_id')::uuid)
 AND workspace_interpretation_admission_admin_v1(NEW.workspace_id,(NEW.metadata->>'actor_user_id')::uuid)
 AND NEW.discovery_run_digest=NEW.workspace_authority_digest AND NEW.discovery_run_digest=NEW.metadata->>'evidence_digest',false) THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_plan_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND NOT workspace_incremental_editorial_plan_unit_valid_v1(NEW) THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_plan_unit_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_workspace_incremental_editorial_plan BEFORE INSERT OR UPDATE OR DELETE ON analysis_artifacts FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_plan_v1();

CREATE FUNCTION workspace_incremental_editorial_claim_valid_v1(artifact analysis_artifacts) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_topic_catalog_executions owner
 JOIN analysis_artifacts census ON census.id=(artifact.metadata->>'census_artifact_id')::uuid
 JOIN analysis_artifacts component ON component.id=(artifact.metadata->>'component_artifact_id')::uuid
 JOIN signal_topic_catalog_executions origin ON origin.id::text=component.metadata->'model_origin'->>'execution_id' AND origin.workspace_id=owner.workspace_id
 WHERE owner.id=artifact.engine_execution_id AND owner.workspace_id=artifact.workspace_id AND owner.input_contract='workspace-incremental-editorial-v1'
  AND owner.status='queued' AND artifact.artifact_type='engine_output' AND artifact.review_status='draft' AND artifact.workspace_artifact_kind='topic_discovery'
  AND artifact.metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1' AND pg_column_size(artifact.metadata)<=4096
  AND artifact.metadata->>'owner_execution_id'=owner.id::text AND artifact.metadata->>'numeric_execution_id'=owner.source_execution_id::text
  AND artifact.metadata->>'target_unit_digest'=owner.input_snapshot->>'target_unit_digest'
  AND EXISTS(SELECT 1 FROM analysis_artifacts plan_unit WHERE plan_unit.metadata->>'plan_artifact_id'=owner.input_snapshot->>'evidence_plan_artifact_id' AND plan_unit.metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND plan_unit.metadata->'unit'->>'status'='evidence_ready' AND plan_unit.metadata->>'census_artifact_id'=census.id::text)
  AND census.engine_execution_id=owner.source_execution_id AND census.workspace_id=owner.workspace_id AND artifact.content=census.content
  AND census.metadata->>'contract_version'='workspace-incremental-unit-census-v1'
  AND census.metadata->>'derivation_digest'=owner.input_snapshot->>'census_derivation_digest'
  AND component.engine_execution_id=owner.source_execution_id AND component.workspace_id=owner.workspace_id
  AND component.metadata->>'contract_version'='workspace-incremental-component-v1' AND origin.input_snapshot ? 'numeric_descriptor'
  AND artifact.metadata->>'component_key'=component.metadata->>'component_key' AND census.metadata->>'component_key'=component.metadata->>'component_key'
  AND artifact.metadata->'unit'=census.metadata->'unit' AND artifact.metadata->'model_origin'=component.metadata->'model_origin'
  AND artifact.discovery_run_digest='sha256:'||encode(sha256(convert_to(owner.input_digest||':'||owner.id::text,'UTF8')),'hex')
  AND artifact.workspace_authority_digest=artifact.discovery_run_digest
  AND artifact.artifact_key='incremental-editorial-claim-'||substring(workspace_incremental_editorial_digest_v1(jsonb_build_array(artifact.metadata->>'component_key',artifact.metadata->'unit'->>'unit_key')) FROM 8)),false)
$$;
CREATE FUNCTION guard_workspace_incremental_editorial_claim_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF COALESCE(NEW.metadata->>'contract_version','')<>'workspace-incremental-editorial-unit-claim-v1' AND COALESCE(OLD.metadata->>'contract_version','')<>'workspace-incremental-editorial-unit-claim-v1' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'workspace_incremental_editorial_claim_immutable' USING ERRCODE='55000'; END IF;
 IF NOT workspace_incremental_editorial_claim_valid_v1(NEW) THEN RAISE EXCEPTION 'workspace_incremental_editorial_claim_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_workspace_incremental_editorial_claim BEFORE INSERT OR UPDATE OR DELETE ON analysis_artifacts FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_claim_v1();
CREATE FUNCTION workspace_incremental_editorial_claims_complete_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE((SELECT count(*)=(owner.input_snapshot->>'target_units')::bigint AND count(DISTINCT metadata->'unit'->>'unit_key')=count(*)
  AND workspace_incremental_editorial_digest_v1(COALESCE(jsonb_agg(jsonb_build_object('component_key',metadata->>'component_key','unit',metadata->'unit','model_origin',metadata->'model_origin') ORDER BY metadata->'unit'->>'unit_key' COLLATE "C"),'[]'::jsonb))=owner.input_snapshot->>'target_binding_digest'
  FROM analysis_artifacts WHERE engine_execution_id=owner.id AND workspace_id=owner.workspace_id AND metadata->>'contract_version'='workspace-incremental-editorial-unit-claim-v1'),false)
 FROM signal_topic_catalog_executions owner WHERE owner.id=target AND owner.input_contract='workspace-incremental-editorial-v1'
$$;
CREATE FUNCTION workspace_incremental_editorial_sonnet_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$ SELECT '{"contract_version":"workspace-engine-interpretation-config-v1","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:0f6899018e107524f7a9805eae8725da6850d19cbb66426ef8fe981acdb8d52e","schema_digest":"sha256:584f513175a1b748a5dd2de79d7abeb5a0cb57cf51f5534b3bad9368348ba542","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"cache_read_micro_usd_per_million_tokens":300000,"cache_creation_micro_usd_per_million_tokens":3750000,"thinking":"disabled","effort":"high","max_output_tokens":8192,"token_bound_version":"utf8-request-bytes-times-four-plus-8192-v1","citation_wire_version":"group-local-reference-labels-v1"}'::jsonb $$;
CREATE FUNCTION guard_workspace_incremental_editorial_execution_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source signal_topic_catalog_executions%ROWTYPE; body jsonb; policy jsonb; targets jsonb;
BEGIN
 IF COALESCE(NEW.input_contract,'')<>'workspace-incremental-editorial-v1' AND COALESCE(OLD.input_contract,'')<>'workspace-incremental-editorial-v1' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND (to_jsonb(NEW)-'interpretation_admission_operation_id') IS DISTINCT FROM (to_jsonb(OLD)-'interpretation_admission_operation_id') THEN
  RAISE EXCEPTION 'workspace_incremental_editorial_history_immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 SELECT * INTO source FROM signal_topic_catalog_executions WHERE id=NEW.source_execution_id FOR UPDATE;
 body:=NEW.input_snapshot; policy:=workspace_incremental_editorial_policy_v1(source.id);targets:=workspace_incremental_editorial_targets_v1(source.id);
 IF NOT COALESCE(source.id IS NOT NULL AND source.workspace_id=NEW.workspace_id AND NEW.actor_user_id=source.actor_user_id
  AND NEW.status='queued' AND NEW.execution_token IS NULL AND NEW.execution_expires_at IS NULL AND NEW.completed_at IS NULL
  AND NEW.interpretation_revision IS NULL AND NEW.interpretation_admission_operation_id IS NULL
  AND NEW.processed_roots=0 AND NEW.processed_chunks=0 AND NEW.denominator=source.denominator AND NEW.expected_chunks=source.expected_chunks
  AND NEW.embedding_run_id=source.embedding_run_id AND NEW.preparation_run_id=source.preparation_run_id AND NEW.embedding_config_digest=source.embedding_config_digest
  AND NEW.input_revision=source.input_revision AND NEW.policy_valid_until IS NOT DISTINCT FROM source.policy_valid_until
  AND NEW.population_digest=source.result_summary->'numeric_checkpoint'->>'population_digest'
  AND NEW.identity_catalog_digest=source.identity_catalog_digest AND NEW.definition_digest=source.definition_digest
  AND NEW.taxonomy_profile_id=(SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=NEW.workspace_id AND kind='topic' AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1)
  AND workspace_incremental_editorial_source_v1(source.id) AND policy IS NOT NULL
  AND body->>'contract_version'='workspace-incremental-editorial-v1' AND pg_column_size(body)<=16384
  AND body->>'execution_id'=NEW.id::text AND body->>'workspace_id'=NEW.workspace_id::text
  AND body->>'numeric_execution_id'=source.id::text AND body->>'numeric_checkpoint_digest'=source.result_summary->'numeric_checkpoint'->>'checkpoint_digest'
  AND body->>'population_digest'=NEW.population_digest AND body->>'input_revision'=NEW.input_revision::text
  AND body->>'context_digest'=source.input_snapshot->>'context_digest' AND body->>'catalog_input_digest'=source.input_snapshot->>'catalog_digest'
  AND body->>'model_bank_artifact_id'=source.result_summary->'numeric_checkpoint'->>'model_bank_artifact_id'
  AND body->>'model_bank_sha256'=(SELECT content->>'sha256' FROM analysis_artifacts WHERE id=(body->>'model_bank_artifact_id')::uuid AND engine_execution_id=source.id)
  AND body->>'census_derivation_digest'=workspace_incremental_editorial_census_v1(source.id)
  AND body->>'history_cut_digest'=signal_workspace_incremental_projection_editorial_digest_v1(source.id)
  AND (body->>'expected_units')::bigint=(targets->>'expected_units')::bigint AND targets->>'expected_units'=targets->>'unique_units'
  AND workspace_incremental_editorial_plan_valid_v1((body->>'evidence_plan_artifact_id')::uuid)
  AND EXISTS(SELECT 1 FROM analysis_artifacts plan WHERE plan.id::text=body->>'evidence_plan_artifact_id' AND (plan.metadata->>'numeric_execution_id')::uuid=source.id
   AND body->>'target_units'=plan.metadata->'descriptor'->'stream'->>'rows' AND (body->>'target_units')::bigint>0
   AND body->>'target_unit_digest'=plan.metadata->'descriptor'->>'target_unit_digest' AND body->>'target_binding_digest'=plan.metadata->'descriptor'->>'target_binding_digest'
   AND body->>'evidence_digest'=plan.metadata->>'evidence_digest')
  AND body->'budget_policy'=policy AND body->>'budget_actor_user_id'=source.actor_user_id::text
  AND workspace_interpretation_admission_admin_v1(NEW.workspace_id,(body->>'authorized_by_user_id')::uuid)
  AND (body->>'claude_cap_micro_usd')::bigint>0 AND (body->>'claude_cap_micro_usd')::bigint<=(policy->>'daily_cap_micro_usd')::bigint
  AND body->'interpretation_configuration'=workspace_incremental_editorial_sonnet_v1()
  AND NEW.input_digest=workspace_incremental_editorial_digest_v1(body)
  AND NEW.result_summary='{"phase":"admitted","analysis_complete":false,"provider_enabled":false}'::jsonb
  AND NEW.engine_request_keys IS NULL,false) THEN RAISE EXCEPTION 'workspace_incremental_editorial_execution_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_workspace_incremental_editorial_execution BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_catalog_executions FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_execution_v1();
CREATE FUNCTION guard_workspace_incremental_editorial_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.input_contract='workspace-incremental-editorial-v1' AND (NOT workspace_incremental_editorial_claims_complete_v1(NEW.id)
  OR NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution JOIN signal_classification_operations operation ON operation.id=execution.interpretation_admission_operation_id
    WHERE execution.id=NEW.id AND operation.result->>'contract_version'='workspace-incremental-editorial-admission-v1')) THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_admission_incomplete' USING ERRCODE='23514'; END IF;
 RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER trg_workspace_incremental_editorial_complete AFTER INSERT OR UPDATE ON signal_topic_catalog_executions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_complete_v1();
CREATE FUNCTION workspace_incremental_editorial_admission_validate_v1(operation signal_classification_operations) RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_topic_catalog_executions%ROWTYPE; body jsonb:=operation.result; policy jsonb; current_receipt jsonb; spent bigint;
BEGIN
 SELECT * INTO owner FROM signal_topic_catalog_executions WHERE id=(body->>'execution_id')::uuid FOR UPDATE;policy:=owner.input_snapshot->'budget_policy';
 IF NOT COALESCE(owner.input_contract='workspace-incremental-editorial-v1' AND owner.workspace_id=operation.workspace_id
  AND operation.status='completed' AND operation.completed_at IS NOT NULL AND pg_column_size(body)<=8192
  AND workspace_interpretation_admission_admin_v1(operation.workspace_id,operation.actor_user_id)
  AND body->>'contract_version'='workspace-incremental-editorial-admission-v1' AND body->>'operation_id'=operation.id::text
  AND body->>'workspace_id'=owner.workspace_id::text AND body->>'authorized_by_user_id'=operation.actor_user_id::text
  AND body->>'budget_actor_user_id'=owner.actor_user_id::text AND body->>'input_digest'=owner.input_digest
  AND body->>'numeric_execution_id'=owner.source_execution_id::text AND body->>'numeric_checkpoint_digest'=owner.input_snapshot->>'numeric_checkpoint_digest'
  AND body->>'target_unit_digest'=owner.input_snapshot->>'target_unit_digest'
  AND body->>'target_binding_digest'=owner.input_snapshot->>'target_binding_digest' AND body->>'evidence_plan_artifact_id'=owner.input_snapshot->>'evidence_plan_artifact_id'
  AND body->>'configuration_digest'=workspace_incremental_editorial_digest_v1(owner.input_snapshot->'interpretation_configuration')
  AND (body->>'prior_admission_operation_id')::uuid IS NOT DISTINCT FROM owner.interpretation_admission_operation_id
  AND body->>'budget_timezone'=policy->>'budget_timezone' AND body->>'daily_cap_micro_usd'=policy->>'daily_cap_micro_usd'
  AND body->>'run_cap_micro_usd'=owner.input_snapshot->>'claude_cap_micro_usd'
  AND body->>'authorized_at'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND abs(extract(epoch FROM ((body->>'authorized_at')::timestamptz-clock_timestamp())))<60
  AND body->>'grant_digest'=workspace_incremental_editorial_digest_v1(body-'grant_digest'),false) THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_permission_invalid' USING ERRCODE='23514'; END IF;
 IF operation.operation_kind='revoke-interpretation' THEN
  current_receipt:=workspace_interpretation_admission_receipt_v1(owner.id);
  IF body->>'action' IS DISTINCT FROM 'revoke_interpretation' OR body->>'grant_cap_micro_usd' IS DISTINCT FROM '0'
   OR current_receipt->>'action' IS DISTINCT FROM 'authorize_interpretation'
   OR body-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd'
    IS DISTINCT FROM current_receipt-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd' THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_revoke_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  -- Initial permission only: a new key never renews or reacquires a unit.
  IF NOT COALESCE(owner.interpretation_admission_operation_id IS NULL AND body->>'action'='authorize_interpretation'
   AND body->>'grant_cap_micro_usd'=owner.input_snapshot->>'claude_cap_micro_usd'
   AND workspace_incremental_editorial_source_v1(owner.source_execution_id) AND workspace_incremental_editorial_claims_complete_v1(owner.id)
   AND body->>'budget_date'=(clock_timestamp() AT TIME ZONE (policy->>'budget_timezone'))::date::text
   AND body->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   AND (body->>'admission_not_after')::timestamptz>clock_timestamp()
   AND (body->>'admission_not_after')::timestamptz<=(((body->>'budget_date')::date+1)::timestamp AT TIME ZONE (policy->>'budget_timezone')),false) THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_permission_unavailable' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-interpretation-budget:'||owner.actor_user_id::text,0));
  SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END),0)
   INTO spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=owner.actor_user_id AND budget_date=(body->>'budget_date')::date;
  IF (body->>'grant_cap_micro_usd')::bigint<=0 OR (body->>'grant_cap_micro_usd')::bigint>(policy->>'daily_cap_micro_usd')::bigint-spent THEN
   RAISE EXCEPTION 'workspace_incremental_editorial_cap_exceeded' USING ERRCODE='23514'; END IF;
 END IF;
END $$;
-- Deliberately closed until the separate evidence/checkpoint/provider adapter is delivered.
CREATE FUNCTION guard_workspace_incremental_editorial_no_dispatch_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=NEW.execution_id AND input_contract='workspace-incremental-editorial-v1') THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_adapter_required' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_workspace_incremental_editorial_no_dispatch BEFORE INSERT OR UPDATE ON signal_topic_classification_outbox FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_no_dispatch_v1();
CREATE FUNCTION guard_workspace_incremental_editorial_no_provider_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=NEW.catalog_execution_id AND input_contract='workspace-incremental-editorial-v1') THEN
 RAISE EXCEPTION 'workspace_incremental_editorial_adapter_required' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_workspace_incremental_editorial_no_provider BEFORE INSERT ON engine_cost_events FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_no_provider_v1();

CREATE OR REPLACE FUNCTION guard_workspace_interpretation_admission_operation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE body jsonb; execution signal_topic_catalog_executions%ROWTYPE; config jsonb; run_spent bigint; day_spent bigint;
BEGIN
 IF NEW.operation_kind NOT IN('authorize-interpretation','revoke-interpretation') THEN RETURN NEW; END IF;
 body:=NEW.result;
 IF EXISTS(SELECT 1 FROM signal_topic_catalog_executions WHERE id=(body->>'execution_id')::uuid AND input_contract='workspace-incremental-editorial-v1') THEN
  PERFORM workspace_incremental_editorial_admission_validate_v1(NEW); RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=(body->>'execution_id')::uuid FOR UPDATE;
 config:=COALESCE(execution.interpretation_revision->'configuration',execution.input_snapshot->'interpretation_config');
 IF NEW.status<>'completed' OR NEW.completed_at IS NULL OR pg_column_size(body)>8192
 OR NOT workspace_interpretation_admission_admin_v1(NEW.workspace_id,NEW.actor_user_id)
 OR execution.id IS NULL OR execution.workspace_id<>NEW.workspace_id OR execution.input_contract<>'workspace-topic-engine-v1'
 OR execution.input_snapshot ? 'numeric_descriptor'
 OR NOT COALESCE(body->>'contract_version'='workspace-interpretation-admission-v1'
  AND body->>'operation_id'=NEW.id::text AND body->>'workspace_id'=NEW.workspace_id::text
  AND body->>'authorized_by_user_id'=NEW.actor_user_id::text AND body->>'budget_actor_user_id'=execution.actor_user_id::text
  AND (body->>'prior_admission_operation_id')::uuid IS NOT DISTINCT FROM execution.interpretation_admission_operation_id
  AND body->>'input_digest'=execution.input_digest
  AND body->>'fit_checkpoint_digest'=execution.result_summary->'fit_checkpoint'->>'checkpoint_digest'
  AND body->>'interpretation_revision_digest' IS NOT DISTINCT FROM execution.interpretation_revision->>'revision_digest'
  AND body->>'configuration_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(config->'call_configuration'),'UTF8')),'hex')
  AND (body->>'run_cap_micro_usd')::bigint=(execution.input_snapshot->>'claude_cap_micro_usd')::bigint
  AND (body->>'daily_cap_micro_usd')::bigint=(config->>'daily_cap_micro_usd')::bigint
  AND body->>'budget_timezone'=config->>'budget_timezone'
  AND body->>'authorized_at'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND abs(extract(epoch FROM ((body->>'authorized_at')::timestamptz-clock_timestamp())))<60
  AND body->>'grant_digest'='sha256:'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(body-'grant_digest'),'UTF8')),'hex'),false) THEN
 RAISE EXCEPTION 'Interpretation admission receipt invalid.' USING ERRCODE='23514'; END IF;
 IF NEW.operation_kind='revoke-interpretation' THEN
  IF body->>'action'<>'revoke_interpretation' OR (body->>'grant_cap_micro_usd')::bigint<>0
   OR workspace_interpretation_admission_receipt_v1(execution.id)->>'action' IS DISTINCT FROM 'authorize_interpretation'
   OR body-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd'
      IS DISTINCT FROM workspace_interpretation_admission_receipt_v1(execution.id)-'operation_id'-'grant_digest'-'action'-'authorized_by_user_id'-'prior_admission_operation_id'-'authorized_at'-'grant_cap_micro_usd' THEN
   RAISE EXCEPTION 'Interpretation revocation invalid.' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT workspace_interpretation_admission_eligible_v1(execution.id)
   OR NOT COALESCE(body->>'action'='authorize_interpretation' AND (body->>'grant_cap_micro_usd')::bigint>0
    AND body->>'budget_date'=(clock_timestamp() AT TIME ZONE (config->>'budget_timezone'))::date::text
    AND body->>'admission_not_after'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    AND (body->>'admission_not_after')::timestamptz>clock_timestamp()
    AND (body->>'admission_not_after')::timestamptz<=(((body->>'budget_date')::date+1)::timestamp AT TIME ZONE (config->>'budget_timezone')),false) THEN
   RAISE EXCEPTION 'Interpretation authorization unavailable.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END) FILTER(WHERE catalog_execution_id=execution.id),0),
   COALESCE(sum(CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END) FILTER(WHERE budget_date=(body->>'budget_date')::date),0)
  INTO run_spent,day_spent FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=execution.actor_user_id;
  IF (body->>'grant_cap_micro_usd')::bigint>LEAST((body->>'run_cap_micro_usd')::bigint-run_spent,(body->>'daily_cap_micro_usd')::bigint-day_spent) THEN
   RAISE EXCEPTION 'Interpretation admission cap exceeded.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_signal_workspace_engine_artifact_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE execution signal_topic_catalog_executions%ROWTYPE;
BEGIN
 IF NEW.engine_execution_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO execution FROM signal_topic_catalog_executions WHERE id=NEW.engine_execution_id AND workspace_id=NEW.workspace_id;
 IF execution.input_contract='workspace-incremental-editorial-v1' THEN
  IF NOT workspace_incremental_editorial_claim_valid_v1(NEW) THEN RAISE EXCEPTION 'workspace_incremental_editorial_claim_invalid' USING ERRCODE='23514'; END IF; RETURN NEW; END IF;
 IF execution.id IS NULL OR execution.input_contract<>'workspace-topic-engine-v1' OR NOT (execution.status='ready' AND NEW.metadata->>'contract_version' IN('workspace-incremental-unit-census-v1','workspace-incremental-unit-binding-v1','workspace-incremental-binding-index-v1') AND signal_workspace_incremental_binding_scope_v1(NEW) OR execution.status='running' OR execution.status IN('failed','ready') AND NEW.artifact_type='engine_proposals' AND NEW.metadata->>'contract_version'='workspace-topic-materialization-progress-v1')
  OR NEW.workspace_artifact_kind<>'topic_discovery' OR NEW.discovery_run_digest<>'sha256:'||encode(sha256(convert_to(execution.input_digest||':'||execution.id::text,'UTF8')),'hex')
  OR NEW.review_status<>'draft' OR NEW.artifact_type NOT IN('engine_model','engine_output','engine_proposals')
  OR NOT COALESCE(NEW.content->>'contract_version'='workspace-engine-private-artifact-v1'
    AND NEW.content->>'sha256'~'^sha256:[0-9a-f]{64}$'
    AND (NEW.content->>'size_bytes')::bigint>=0
    AND NEW.content->>'storage_key' LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||execution.id::text||'/%',false)
  OR pg_column_size(NEW.content)>65536 OR pg_column_size(NEW.metadata)>65536 THEN
  RAISE EXCEPTION 'Engine artifact authority is invalid.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

DO $$ DECLARE function_oid regprocedure; role_name text; BEGIN
 FOR function_oid IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['workspace_incremental_editorial_validation_v1','workspace_incremental_editorial_plan_unit_valid_v1','workspace_incremental_editorial_plan_valid_v1','guard_workspace_incremental_editorial_plan_v1','workspace_incremental_editorial_digest_v1','workspace_incremental_editorial_census_v1','workspace_incremental_editorial_units_v1','workspace_incremental_editorial_policy_v1','workspace_incremental_editorial_source_v1','workspace_incremental_editorial_targets_v1','workspace_incremental_editorial_claim_valid_v1','guard_workspace_incremental_editorial_claim_v1','workspace_incremental_editorial_claims_complete_v1','workspace_incremental_editorial_sonnet_v1','guard_workspace_incremental_editorial_execution_v1','guard_workspace_incremental_editorial_complete_v1','workspace_incremental_editorial_admission_validate_v1','guard_workspace_incremental_editorial_no_dispatch_v1','guard_workspace_incremental_editorial_no_provider_v1','guard_workspace_interpretation_admission_operation_v1','guard_signal_workspace_engine_artifact_v1']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',function_oid);
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',function_oid,role_name); END IF; END LOOP;
 END LOOP; END $$;

CREATE UNIQUE INDEX uq_workspace_incremental_editorial_plan_unit ON analysis_artifacts((metadata->>'plan_artifact_id'),(metadata->'unit'->>'unit_key')) WHERE metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1';
CREATE UNIQUE INDEX uq_workspace_incremental_editorial_plan ON analysis_artifacts(workspace_id,(metadata->>'numeric_execution_id'),(metadata->>'evidence_digest')) WHERE metadata->>'contract_version'='workspace-incremental-editorial-plan-v1';
CREATE FUNCTION guard_workspace_incremental_editorial_plan_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$ BEGIN
 IF NEW.metadata->>'contract_version'='workspace-incremental-editorial-plan-v1' AND NOT workspace_incremental_editorial_plan_valid_v1(NEW.id) THEN RAISE EXCEPTION 'workspace_incremental_editorial_plan_incomplete' USING ERRCODE='23514'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER trg_workspace_incremental_editorial_plan_complete AFTER INSERT ON analysis_artifacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_workspace_incremental_editorial_plan_complete_v1();
REVOKE ALL ON FUNCTION guard_workspace_incremental_editorial_plan_complete_v1() FROM PUBLIC;

DO $$ DECLARE role_name text; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION guard_workspace_incremental_editorial_plan_complete_v1() FROM %I',role_name); END IF; END LOOP; END $$;
