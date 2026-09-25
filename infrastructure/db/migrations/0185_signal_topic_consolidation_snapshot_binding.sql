-- Fix ambiguous PL/pgSQL source variable in consolidated Topic snapshot preparation.
-- This is the existing user-visible publication path; no tables, rows or grants change.
CREATE OR REPLACE FUNCTION prepare_signal_topic_consolidation_snapshot_v1(target_workspace uuid,target_actor uuid,target_revision uuid,expected_digest text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE r signal_topic_consolidation_revisions%ROWTYPE;s signal_topic_consolidation_snapshots%ROWTYPE;
 engine signal_topic_catalog_executions%ROWTYPE;source_binding jsonb;catalog jsonb;denominator bigint;seal text;stamp text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-taxonomy:'||target_workspace::text||':topic',0));
 PERFORM signal_brand_context_processing_lock_actor_v1(target_workspace,target_actor);
 SELECT * INTO r FROM signal_topic_consolidation_revisions WHERE id=target_revision AND workspace_id=target_workspace FOR SHARE;
 IF r.id IS NULL OR r.revision_digest IS DISTINCT FROM expected_digest OR r.status<>'validated' THEN
  RAISE EXCEPTION 'topic_consolidation_activation_revision_conflict' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM signal_topic_consolidation_snapshots WHERE workspace_id=target_workspace AND revision_id=r.id;
 IF s.id IS NOT NULL THEN RETURN jsonb_build_object('snapshot_id',s.id,'snapshot_digest',s.snapshot_digest,'denominator',s.denominator,'replayed',true,'activation','pending');END IF;
 source_binding:=signal_topic_editorial_source_v1(r.consolidation_run_id);
 IF source_binding IS NULL OR NOT COALESCE((validate_signal_topic_consolidation_revision_v1(r.id)->>'complete')::boolean,false) THEN
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
   'source_context_digest',source_binding->>'context_digest','kind',c.kind,'definition',c.definition,'locale',c.locale,
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
  'source_binding',source_binding,'catalog',catalog,'denominator',denominator));
 INSERT INTO signal_topic_consolidation_snapshots(workspace_id,revision_id,consolidation_run_id,revision_digest,source_engine_execution_id,
  preparation_run_id,input_revision,source_binding,source_digest,catalog,denominator,snapshot_digest,created_by_user_id)
 VALUES(target_workspace,r.id,r.consolidation_run_id,r.revision_digest,r.source_engine_execution_id,engine.preparation_run_id,engine.input_revision,
  source_binding,signal_topic_editorial_digest_json_v1(source_binding),catalog,denominator,seal,target_actor) RETURNING * INTO s;
 RETURN jsonb_build_object('snapshot_id',s.id,'snapshot_digest',s.snapshot_digest,'denominator',s.denominator,'replayed',false,'activation','pending');
END;$$;
