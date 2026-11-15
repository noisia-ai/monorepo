-- Freeze an effective Listening source, including post-run human corrections.
-- Original serving FK and every historical configuration/hash remain intact.
ALTER TABLE signal_study_configurations
 ADD COLUMN listening_source_kind text,ADD COLUMN listening_source_id uuid,
 ADD COLUMN listening_generation_id uuid,ADD COLUMN listening_source_digest text,
 ADD COLUMN listening_human_edit_id uuid,
 ADD CONSTRAINT study_listening_generation FOREIGN KEY(workspace_id,listening_generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 ADD CONSTRAINT study_listening_human_edit FOREIGN KEY(workspace_id,listening_human_edit_id) REFERENCES signal_listening_human_edits(workspace_id,id),
 ADD CONSTRAINT study_listening_source_shape CHECK(
  listening_source_kind IS NULL AND listening_source_id IS NULL AND listening_generation_id IS NULL AND listening_source_digest IS NULL AND listening_human_edit_id IS NULL
  OR listening_source_kind IS NOT NULL AND listening_source_id IS NOT NULL AND listening_generation_id IS NOT NULL AND listening_source_digest IS NOT NULL
   AND listening_source_kind IN('serving','human_edit') AND listening_source_digest~'^sha256:[0-9a-f]{64}$'
   AND(listening_source_kind='serving' AND listening_human_edit_id IS NULL AND listening_source_id=listening_snapshot_id
    OR listening_source_kind='human_edit' AND listening_human_edit_id IS NOT NULL AND listening_source_id=listening_human_edit_id));
CREATE VIEW signal_study_listening_sources_v1 WITH(security_invoker=true) AS
 SELECT s.id,s.workspace_id,s.execution_id,s.round_id,s.map_id,s.configuration_id,s.generation_id,s.classification_run_id,s.snapshot_digest,s.activated_by_user_id,s.created_at,
 'serving'::text source_kind,s.id base_snapshot_id,NULL::uuid human_edit_id
 FROM signal_listening_serving_snapshots s
 UNION ALL
 SELECT h.id,h.workspace_id,s.execution_id,s.round_id,h.map_id,h.configuration_id,h.generation_id,s.classification_run_id,h.snapshot_digest,h.created_by_user_id,h.created_at,
 'human_edit'::text,h.base_snapshot_id,h.id
 FROM signal_listening_human_edits h JOIN signal_listening_serving_snapshots s ON s.id=h.base_snapshot_id AND s.workspace_id=h.workspace_id;
CREATE VIEW signal_study_configuration_sources_v1 WITH(security_invoker=true) AS
 SELECT cfg.id study_configuration_id,s.* FROM signal_study_configurations cfg JOIN signal_study_listening_sources_v1 s
 ON s.id=COALESCE(cfg.listening_source_id,cfg.listening_snapshot_id) AND s.source_kind=COALESCE(cfg.listening_source_kind,'serving')
 AND s.workspace_id=cfg.workspace_id AND s.base_snapshot_id=cfg.listening_snapshot_id AND s.configuration_id=cfg.listening_configuration_id
 AND(cfg.listening_generation_id IS NULL OR cfg.listening_generation_id=s.generation_id)
 AND(cfg.listening_source_digest IS NULL OR cfg.listening_source_digest=s.snapshot_digest);
REVOKE ALL ON signal_study_listening_sources_v1,signal_study_configuration_sources_v1 FROM PUBLIC;
DO $roles$ DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON signal_study_listening_sources_v1,signal_study_configuration_sources_v1 FROM %I',r);END IF;END LOOP;END $roles$;
CREATE FUNCTION signal_study_listening_source_latest_v1(w uuid,kind text,source_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(source_id=COALESCE((SELECT h.id FROM signal_listening_human_edits h WHERE h.workspace_id=w AND h.base_snapshot_id=base.id ORDER BY h.revision DESC LIMIT 1),base.id)
  AND kind=CASE WHEN EXISTS(SELECT 1 FROM signal_listening_human_edits h WHERE h.workspace_id=w AND h.base_snapshot_id=base.id) THEN 'human_edit' ELSE 'serving' END
  AND EXISTS(SELECT 1 FROM signal_study_listening_sources_v1 current_source WHERE current_source.workspace_id=w AND current_source.id=source_id AND current_source.source_kind=kind
   AND current_source.configuration_id=(SELECT id FROM signal_listening_configurations WHERE workspace_id=w AND state='published' ORDER BY revision DESC LIMIT 1)),false)
 FROM(SELECT id FROM signal_listening_serving_snapshots WHERE workspace_id=w ORDER BY created_at DESC,id DESC LIMIT 1)base
$$;
REVOKE ALL ON FUNCTION signal_study_listening_source_latest_v1(uuid,text,uuid) FROM PUBLIC;
CREATE FUNCTION signal_study_listening_binding_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source signal_study_listening_sources_v1%ROWTYPE;previous signal_study_configurations;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_listening_binding_immutable';END IF;
 SELECT * INTO source FROM signal_study_listening_sources_v1 WHERE id=COALESCE(NEW.listening_source_id,NEW.listening_snapshot_id)
  AND source_kind=COALESCE(NEW.listening_source_kind,'serving') AND workspace_id=NEW.workspace_id;
 IF source.id IS NULL OR source.base_snapshot_id<>NEW.listening_snapshot_id OR source.configuration_id<>NEW.listening_configuration_id
  OR NEW.listening_generation_id IS NOT NULL AND NEW.listening_generation_id<>source.generation_id
  OR NEW.listening_source_digest IS NOT NULL AND NEW.listening_source_digest<>source.snapshot_digest
  OR NEW.listening_human_edit_id IS NOT NULL AND NEW.listening_human_edit_id IS DISTINCT FROM source.human_edit_id
  OR NOT COALESCE(signal_listening_discovery_source_current_v1(source.generation_id),false) THEN RAISE EXCEPTION 'study_listening_binding_invalid';END IF;
 SELECT * INTO previous FROM signal_study_configurations WHERE study_id=NEW.study_id AND workspace_id=NEW.workspace_id ORDER BY revision DESC LIMIT 1;
 IF previous.id IS NULL AND NOT COALESCE(signal_study_listening_source_latest_v1(NEW.workspace_id,source.source_kind,source.id),false) THEN RAISE EXCEPTION 'study_listening_source_not_latest';END IF;
 IF previous.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_study_configuration_sources_v1 s WHERE s.study_configuration_id=previous.id
  AND s.source_kind=source.source_kind AND s.id=source.id AND s.generation_id=source.generation_id AND s.snapshot_digest=source.snapshot_digest AND s.base_snapshot_id=source.base_snapshot_id)
 THEN RAISE EXCEPTION 'study_listening_binding_immutable';END IF;
 NEW.listening_source_kind:=source.source_kind;NEW.listening_source_id:=source.id;NEW.listening_generation_id:=source.generation_id;
 NEW.listening_source_digest:=source.snapshot_digest;NEW.listening_human_edit_id:=source.human_edit_id;RETURN NEW;
END $$;
CREATE TRIGGER aaa_signal_study_listening_binding BEFORE INSERT ON signal_study_configurations FOR EACH ROW EXECUTE FUNCTION signal_study_listening_binding_v1();
REVOKE ALL ON FUNCTION signal_study_listening_binding_v1() FROM PUBLIC;

-- Preserve the prior guard; only the frozen Listening binding changes.
CREATE OR REPLACE FUNCTION signal_study_configuration_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e jsonb;q jsonb;previous signal_study_configurations;s signal_studies;listening signal_listening_configurations;snapshot signal_study_listening_sources_v1%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'study_configuration_immutable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-study-config:'||NEW.study_id::text,0));
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 SELECT * INTO s FROM signal_studies WHERE id=NEW.study_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO listening FROM signal_listening_configurations WHERE id=NEW.listening_configuration_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO snapshot FROM signal_study_listening_sources_v1 WHERE id=NEW.listening_source_id AND source_kind=NEW.listening_source_kind AND workspace_id=NEW.workspace_id;
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

-- Preserve the prior guard; only the frozen Listening binding changes.
CREATE OR REPLACE FUNCTION signal_study_source_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
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
 JOIN signal_processing_policy_versions policy ON policy.id=p.policy_version_id JOIN signal_study_configuration_sources_v1 snapshot ON snapshot.study_configuration_id=cfg.id AND snapshot.workspace_id=p.workspace_id WHERE p.id=target
$$;

-- Preserve the prior guard; only the frozen Listening binding changes.
CREATE OR REPLACE FUNCTION signal_study_source_cut_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p signal_study_executions;cfg signal_study_configurations;snapshot signal_study_configuration_sources_v1%ROWTYPE;source signal_listening_discovery_roots;m mentions;actual_cache jsonb;
BEGIN
 SELECT * INTO p FROM signal_study_executions WHERE id=NEW.execution_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO cfg FROM signal_study_configurations WHERE id=p.configuration_id AND workspace_id=p.workspace_id;
 SELECT * INTO snapshot FROM signal_study_configuration_sources_v1 WHERE study_configuration_id=cfg.id AND workspace_id=p.workspace_id;
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

-- Preserve the prior guard; only the frozen Listening binding changes.
CREATE OR REPLACE FUNCTION signal_study_expected_cut_roots_v1(target uuid) RETURNS TABLE(root_id uuid) LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT r.root_id FROM signal_study_executions p JOIN signal_study_configurations cfg ON cfg.id=p.configuration_id AND cfg.workspace_id=p.workspace_id
 JOIN signal_study_configuration_sources_v1 s ON s.study_configuration_id=cfg.id AND s.workspace_id=p.workspace_id
 JOIN signal_listening_discovery_roots r ON r.generation_id=s.generation_id AND r.workspace_id=s.workspace_id
 JOIN signal_mass_labeling_maps map ON map.id=s.map_id AND map.workspace_id=s.workspace_id
 JOIN mentions m ON m.id=r.root_id AND m.workspace_id=r.workspace_id AND m.canonical_mention_id=m.id AND m.inclusion_status='included'
 CROSS JOIN LATERAL(SELECT signal_study_attributes_v1(signal_study_listening_cache_v1(p.workspace_id,cfg.listening_configuration_id,r.root_id,r.proof->>'input_digest',map.entity_context_digest),r.proof,m.platform) value) attributes
 WHERE p.id=target AND r.proof->'in_category'='true'::jsonb AND signal_listening_root_right_v1(p.workspace_id,r.root_id,'llm-processing')
 AND m.published_at>=(cfg.envelope#>>'{study,cut,start_at}')::timestamptz AND m.published_at<(cfg.envelope#>>'{study,cut,end_at}')::timestamptz
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(cfg.envelope#>'{study,cut,filters}') f WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.value) allowed(value) WHERE attributes.value->f.key ? allowed.value))
$$;

-- Preserve the prior guard; only the frozen Listening binding changes.
CREATE OR REPLACE FUNCTION signal_study_source_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE cfg signal_study_configurations;map signal_mass_labeling_maps;total integer;in_period integer;
BEGIN
 SELECT * INTO cfg FROM signal_study_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id;
 SELECT m.* INTO map FROM signal_study_configuration_sources_v1 s JOIN signal_mass_labeling_maps m ON m.id=s.map_id AND m.workspace_id=s.workspace_id WHERE s.study_configuration_id=cfg.id;
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
  FROM signal_study_configuration_sources_v1 s JOIN signal_listening_discovery_roots r ON r.generation_id=s.generation_id AND r.workspace_id=s.workspace_id
  JOIN mentions m ON m.id=r.root_id AND m.workspace_id=r.workspace_id WHERE s.study_configuration_id=cfg.id AND signal_listening_root_right_v1(r.workspace_id,r.root_id,'client-derived-metrics');
  IF(NEW.source_header#>>'{selection,corpus_roots}')::integer IS DISTINCT FROM total OR(NEW.source_header->>'brand_baseline_roots')::integer IS DISTINCT FROM in_period THEN RAISE EXCEPTION 'study_source_baseline_invalid';END IF;
 END IF;RETURN NEW;
END $$;

-- Preserve the prior guard; only the frozen Listening binding changes.
CREATE OR REPLACE FUNCTION signal_study_owner_current_v1(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(p.configuration_id=(SELECT id FROM signal_study_configurations WHERE study_id=p.study_id AND workspace_id=p.workspace_id ORDER BY revision DESC LIMIT 1)
 AND cfg.configuration_digest=p.configuration_digest AND cfg.human_revision_digest=p.human_revision_digest AND signal_processing_actor_v1(p.workspace_id,p.actor_user_id)
 AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=p.workspace_id AND feature='mass_labeling')
 AND policy.status='active' AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp() AND policy.organization_id=p.organization_id
 AND EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='study_analysis' AND provider='anthropic' AND model='claude-sonnet-4-6' AND configuration=signal_study_analysis_configuration_v1())
 AND EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=policy.id AND action='mass_labeling_jev' AND provider='typesafe' AND model='jev-1.13.0')
 AND signal_study_generation_header_current_v1(snapshot.generation_id),false)
 FROM signal_study_executions p JOIN signal_study_configurations cfg ON cfg.id=p.configuration_id AND cfg.workspace_id=p.workspace_id
 JOIN signal_processing_policy_versions policy ON policy.id=p.policy_version_id JOIN signal_study_configuration_sources_v1 snapshot ON snapshot.study_configuration_id=cfg.id AND snapshot.workspace_id=p.workspace_id WHERE p.id=target
$$;

CREATE FUNCTION signal_study_source_binding_header_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE cfg signal_study_configurations;source signal_study_configuration_sources_v1%ROWTYPE;
BEGIN
 SELECT * INTO cfg FROM signal_study_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO source FROM signal_study_configuration_sources_v1 WHERE study_configuration_id=cfg.id;
 IF cfg.listening_source_id IS NOT NULL AND NEW.source_header->'listening_source_binding' IS DISTINCT FROM jsonb_build_object(
  'kind',source.source_kind,'id',source.id,'configuration_id',source.configuration_id,'generation_id',source.generation_id,'source_digest',source.snapshot_digest,'base_snapshot_id',source.base_snapshot_id)
 THEN RAISE EXCEPTION 'study_source_binding_header_invalid';END IF;RETURN NEW;
END $$;
CREATE TRIGGER aab_signal_study_source_binding_header BEFORE INSERT OR UPDATE ON signal_study_executions FOR EACH ROW EXECUTE FUNCTION signal_study_source_binding_header_v1();
REVOKE ALL ON FUNCTION signal_study_source_binding_header_v1() FROM PUBLIC;
