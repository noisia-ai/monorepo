-- A defined interest is selected independently of the consolidated catalog.
-- This is a local, additive contract. It does not mutate SQL0181, its 17
-- selected concepts, classification results, or the active Signal binding.
CREATE TABLE signal_defined_interest_selection_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
 request_digest text NOT NULL CHECK(request_digest~'^sha256:[a-f0-9]{64}$'),
 term_key text NOT NULL CHECK(term_key~'^[a-z0-9][a-z0-9._-]{0,119}$'),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 result_selection jsonb NOT NULL CHECK(jsonb_typeof(result_selection)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,idempotency_key),UNIQUE(id,workspace_id)
);
CREATE TABLE signal_defined_interest_selections (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
 term_key text NOT NULL CHECK(term_key~'^[a-z0-9][a-z0-9._-]{0,119}$'),
 snapshot_id uuid,
 generation_id uuid NOT NULL REFERENCES signal_classification_generations(id) ON DELETE RESTRICT,
 taxonomy_term_id uuid NOT NULL REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
 definition_digest text NOT NULL CHECK(definition_digest~'^sha256:[a-f0-9]{64}$'),
 definition_revision integer NOT NULL CHECK(definition_revision>0),
 selected boolean NOT NULL,
 selection_revision bigint NOT NULL CHECK(selection_revision>0),
 selection_digest text NOT NULL CHECK(selection_digest~'^sha256:[a-f0-9]{64}$'),
 operation_id uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,term_key),
 FOREIGN KEY(snapshot_id,workspace_id) REFERENCES signal_topic_consolidation_snapshots(id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(operation_id,workspace_id) REFERENCES signal_defined_interest_selection_operations(id,workspace_id) ON DELETE RESTRICT
);

CREATE FUNCTION signal_defined_interest_selection_actor_v1(target_workspace uuid,target_actor uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 PERFORM signal_processing_lock_actor_v1(target_workspace,target_actor,false);
 IF NOT EXISTS(SELECT 1 FROM signal_workspaces w
  JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
  JOIN organizations o ON o.id=w.organization_id
  JOIN users u ON u.id=target_actor AND u.status='active'
  WHERE w.id=target_workspace AND w.status='active' AND b.status='active' AND o.status='active'
   AND ((u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','analyst','founder','admin','kam','insights_manager','ux_data_specialist'))
    OR (u.user_type='client' AND u.organization_id=o.id AND u.primary_role IN('client_admin','brand_manager','client_owner')
     AND EXISTS(SELECT 1 FROM user_brand_access a WHERE a.brand_id=b.id AND a.user_id=u.id
       AND a.revoked_at IS NULL AND a.access_level IN('comment','admin'))))) THEN
  RAISE EXCEPTION 'defined_interest_selection_forbidden' USING ERRCODE='42501';END IF;
END $$;

CREATE FUNCTION signal_defined_interest_selection_history_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
BEGIN RAISE EXCEPTION 'defined_interest_selection_history_retained' USING ERRCODE='55000';END $$;
CREATE TRIGGER defined_interest_selection_operation_history BEFORE UPDATE OR DELETE
 ON signal_defined_interest_selection_operations FOR EACH ROW EXECUTE FUNCTION signal_defined_interest_selection_history_v1();

CREATE FUNCTION signal_defined_interest_selection_guard_v1() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE receipt signal_defined_interest_selection_operations%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'defined_interest_selection_history_retained' USING ERRCODE='55000';END IF;
 SELECT * INTO receipt FROM signal_defined_interest_selection_operations
  WHERE id=NEW.operation_id AND workspace_id=NEW.workspace_id AND term_key=NEW.term_key;
 IF receipt.id IS NULL OR receipt.result_selection IS DISTINCT FROM jsonb_build_object(
   'workspace_id',NEW.workspace_id,'snapshot_id',NEW.snapshot_id,'generation_id',NEW.generation_id,
   'taxonomy_term_id',NEW.taxonomy_term_id,'term_key',NEW.term_key,'definition_digest',NEW.definition_digest,
   'definition_revision',NEW.definition_revision,'selected',NEW.selected,'selection_revision',NEW.selection_revision,
   'selection_digest',NEW.selection_digest,'operation_id',NEW.operation_id)
  OR (TG_OP='UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.term_key IS DISTINCT FROM OLD.term_key
   OR NEW.selection_revision<>OLD.selection_revision+1)) THEN
  RAISE EXCEPTION 'defined_interest_selection_receipt_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER defined_interest_selection_guard BEFORE INSERT OR UPDATE OR DELETE
 ON signal_defined_interest_selections FOR EACH ROW EXECUTE FUNCTION signal_defined_interest_selection_guard_v1();

CREATE FUNCTION mutate_signal_defined_interest_selection_v1(target_workspace uuid,target_actor uuid,
 request_key text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE prior signal_defined_interest_selection_operations%ROWTYPE;
 current_row signal_defined_interest_selections%ROWTYPE;
 snapshot signal_topic_consolidation_snapshots%ROWTYPE;
 generation signal_classification_generations%ROWTYPE;
 term taxonomy_terms%ROWTYPE;
 operation uuid:=gen_random_uuid();request_hash text;result jsonb;revision bigint;
 binding_snapshot_id uuid;
 target_term text:=payload->>'term_key';is_selected boolean;
BEGIN
 IF request_key IS NULL OR request_key!~'^[A-Za-z0-9._:-]{8,200}$'
  OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
  OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(payload) AS keys(key)) IS DISTINCT FROM
   ARRAY['definition_digest','definition_revision','expected_selection_revision','expected_snapshot_digest',
     'generation_id','selected','snapshot_id','taxonomy_term_id','term_key']
  OR target_term IS NULL OR target_term!~'^[a-z0-9][a-z0-9._-]{0,119}$'
  OR jsonb_typeof(payload->'selected') IS DISTINCT FROM 'boolean'
  OR COALESCE(payload->>'definition_digest','')!~'^sha256:[a-f0-9]{64}$'
  OR (jsonb_typeof(payload->'snapshot_id')='null') IS DISTINCT FROM
     (jsonb_typeof(payload->'expected_snapshot_digest')='null')
  OR (jsonb_typeof(payload->'snapshot_id')='string' AND COALESCE(payload->>'snapshot_id','')!~
   '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
  OR (jsonb_typeof(payload->'expected_snapshot_digest')='string' AND
   COALESCE(payload->>'expected_snapshot_digest','')!~'^sha256:[a-f0-9]{64}$')
  OR jsonb_typeof(payload->'snapshot_id') NOT IN('null','string')
  OR jsonb_typeof(payload->'expected_snapshot_digest') NOT IN('null','string')
  OR COALESCE(payload->>'definition_revision','')!~'^[1-9][0-9]*$'
  OR COALESCE(payload->>'expected_selection_revision','')!~'^(0|[1-9][0-9]*)$' THEN
  RAISE EXCEPTION 'defined_interest_selection_request_invalid' USING ERRCODE='22023';END IF;
 is_selected:=(payload->>'selected')::boolean;
 PERFORM pg_advisory_xact_lock(hashtextextended('signal-defined-interest-selection:'||target_workspace::text||':'||target_term,0));
 PERFORM signal_defined_interest_selection_actor_v1(target_workspace,target_actor);
 request_hash:=signal_topic_editorial_digest_json_v1(jsonb_build_object('actor',target_actor,'payload',payload));
 SELECT * INTO prior FROM signal_defined_interest_selection_operations
  WHERE workspace_id=target_workspace AND idempotency_key=request_key;
 IF prior.id IS NOT NULL THEN
  IF prior.actor_user_id IS DISTINCT FROM target_actor OR prior.request_digest IS DISTINCT FROM request_hash THEN
   RAISE EXCEPTION 'defined_interest_selection_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('selection',prior.result_selection,'replayed',true);END IF;
 SELECT * INTO current_row FROM signal_defined_interest_selections
  WHERE workspace_id=target_workspace AND term_key=target_term FOR UPDATE;
 IF COALESCE(current_row.selection_revision,0)<>(payload->>'expected_selection_revision')::bigint THEN
  RAISE EXCEPTION 'defined_interest_selection_revision_conflict' USING ERRCODE='23514';END IF;
 SELECT binding.snapshot_id INTO binding_snapshot_id FROM signal_topic_consolidation_bindings binding
  WHERE binding.workspace_id=target_workspace FOR SHARE;
 SELECT * INTO snapshot FROM signal_topic_consolidation_snapshots
  WHERE id=COALESCE((payload->>'snapshot_id')::uuid,binding_snapshot_id)
    AND workspace_id=target_workspace FOR SHARE;
 IF (payload->>'snapshot_id' IS NOT NULL AND
      (snapshot.id IS NULL OR snapshot.snapshot_digest IS DISTINCT FROM payload->>'expected_snapshot_digest'))
  OR (is_selected AND (payload->>'snapshot_id' IS NOT NULL AND
    binding_snapshot_id IS DISTINCT FROM (payload->>'snapshot_id')::uuid
    OR binding_snapshot_id IS NOT NULL AND snapshot.id IS NULL)) THEN
  RAISE EXCEPTION 'defined_interest_selection_snapshot_changed' USING ERRCODE='23514';END IF;
 SELECT * INTO generation FROM signal_classification_generations
  WHERE id=(payload->>'generation_id')::uuid AND workspace_id=target_workspace FOR SHARE;
 SELECT * INTO term FROM taxonomy_terms WHERE id=(payload->>'taxonomy_term_id')::uuid FOR SHARE;
 IF is_selected AND (generation.id IS NULL OR term.id IS NULL OR generation.input_contract<>'workspace-topic-classification-v1'
  OR generation.status<>'ready' OR generation.finalized_digest IS NULL
  OR generation.input_snapshot->>'interest_term_key' IS DISTINCT FROM target_term
  OR generation.input_snapshot ? 'source_projection'
  OR NOT EXISTS(SELECT 1 FROM signal_taxonomy_profiles profile WHERE profile.id=generation.taxonomy_profile_id
   AND profile.taxonomy_id=term.taxonomy_id AND profile.workspace_id=target_workspace)
  OR term.term_key IS DISTINCT FROM target_term OR term.status NOT IN('candidate','active')
  OR term.metadata->'topic'->>'definition_digest' IS DISTINCT FROM payload->>'definition_digest'
  OR (term.metadata->'topic'->>'definition_revision')::int IS DISTINCT FROM (payload->>'definition_revision')::int
  OR term.metadata->'topic'->>'lifecycle'='archived'
  OR generation.input_snapshot->'topics' IS NULL OR jsonb_array_length(generation.input_snapshot->'topics')<>1
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(generation.input_snapshot->'topics') topic
   WHERE topic->>'taxonomy_term_id'=term.id::text
    AND topic->'definition'->>'definition_digest'=payload->>'definition_digest'
    AND (topic->'definition'->>'definition_revision')::int=(payload->>'definition_revision')::int)
  OR (snapshot.id IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot.catalog) concept
    WHERE concept->>'term_key'=target_term))) THEN
  RAISE EXCEPTION 'defined_interest_selection_definition_changed' USING ERRCODE='23514';END IF;
 IF is_selected THEN
  IF (snapshot.id IS NOT NULL AND (NOT signal_topic_consolidation_snapshot_current_v1(snapshot.id)
    OR generation.input_revision IS DISTINCT FROM snapshot.input_revision))
   OR generation.input_revision IS DISTINCT FROM (SELECT input_revision FROM signal_corpus_preparation_input_state
     WHERE workspace_id=target_workspace)
   OR NOT EXISTS(SELECT 1 FROM signal_corpus_preparation_runs preparation
     WHERE preparation.id=generation.preparation_run_id AND preparation.workspace_id=target_workspace
       AND preparation.status='completed' AND (preparation.policy_valid_until IS NULL OR preparation.policy_valid_until>now()))
   OR (generation.policy_valid_until IS NOT NULL AND generation.policy_valid_until<=clock_timestamp())
   OR EXISTS(SELECT 1 FROM signal_classification_generation_items item
     WHERE item.generation_id=generation.id AND item.resolution_state='error')
   OR NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
     WHERE execution.workspace_id=target_workspace AND execution.generation_id=generation.id
       AND execution.status='ready' AND execution.processed_roots=execution.denominator)
  THEN RAISE EXCEPTION 'defined_interest_selection_generation_stale' USING ERRCODE='23514';END IF;
  -- A completed decision with zero approved memberships is selectable for future
  -- imports. If positive memberships exist, at least one must retain current
  -- provenance rights; similarity suggestions never count as decisions.
  IF EXISTS(SELECT 1 FROM signal_classification_assignments assignment
    WHERE assignment.workspace_id=target_workspace AND assignment.generation_id=generation.id
     AND assignment.taxonomy_term_id=term.id AND assignment.definition_digest=payload->>'definition_digest'
     AND assignment.definition_revision=(payload->>'definition_revision')::int
     AND assignment.disposition='approved' AND assignment.resolution_method IN('model','human')
     AND signal_workspace_classification_assignment_current_v1(assignment,generation)
     AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments correction
       WHERE correction.generation_id=generation.id AND correction.canonical_root_id=assignment.canonical_root_id
        AND correction.taxonomy_term_id=term.id AND correction.resolution_method='human' AND correction.disposition='rejected'
        AND signal_workspace_classification_assignment_current_v1(correction,generation)))
   AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments assignment
   JOIN signal_classification_generation_items item ON item.id=assignment.generation_item_id
    AND item.generation_id=generation.id AND item.canonical_root_id=assignment.canonical_root_id
   JOIN mentions mention ON mention.id=assignment.canonical_root_id AND mention.workspace_id=target_workspace
    AND mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id
   WHERE assignment.workspace_id=target_workspace AND assignment.generation_id=generation.id
    AND assignment.taxonomy_term_id=term.id AND assignment.definition_digest=payload->>'definition_digest'
    AND assignment.definition_revision=(payload->>'definition_revision')::int
    AND assignment.disposition='approved' AND assignment.resolution_method IN('model','human')
    AND signal_workspace_classification_assignment_current_v1(assignment,generation)
    AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments correction
      WHERE correction.generation_id=generation.id AND correction.canonical_root_id=assignment.canonical_root_id
       AND correction.taxonomy_term_id=term.id AND correction.resolution_method='human' AND correction.disposition='rejected'
       AND signal_workspace_classification_assignment_current_v1(correction,generation))
    AND EXISTS(SELECT 1 FROM signal_mention_import_memberships path
      JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=target_workspace
       AND batch.data_source_id=path.data_source_id AND batch.status='completed'
      JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=target_workspace AND source.status='active'
      JOIN signal_provenance_policy_bindings binding ON binding.workspace_id=target_workspace AND binding.data_source_id=source.id
       AND binding.status='active' AND binding.effective_from<=now() AND (binding.effective_to IS NULL OR binding.effective_to>now())
       AND (binding.import_batch_id=batch.id OR binding.import_batch_id IS NULL)
      JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=target_workspace
       AND license.status='active' AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
      JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=target_workspace
       AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
       AND (retention.effective_to IS NULL OR retention.effective_to>now())
       AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
      JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=target_workspace
      WHERE path.workspace_id=target_workspace AND origin.canonical_mention_id=mention.id
       AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=target_workspace
        AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-derived-metrics' AND usage.decision='allowed')
       AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=target_workspace
        AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-mention-list' AND usage.decision='allowed')
       AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=target_workspace
        AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-text-or-excerpt' AND usage.decision='allowed'))
   LIMIT 1) THEN RAISE EXCEPTION 'defined_interest_selection_approved_membership_required' USING ERRCODE='23514';END IF;
 ELSIF current_row.workspace_id IS NULL OR NOT current_row.selected
  OR ROW(current_row.snapshot_id,current_row.generation_id,current_row.taxonomy_term_id,current_row.definition_digest,current_row.definition_revision)
   IS DISTINCT FROM ROW((payload->>'snapshot_id')::uuid,generation.id,term.id,payload->>'definition_digest',(payload->>'definition_revision')::int) THEN
  RAISE EXCEPTION 'defined_interest_selection_not_selected' USING ERRCODE='23514';
 END IF;
 revision:=COALESCE(current_row.selection_revision,0)+1;
 result:=jsonb_build_object('workspace_id',target_workspace,'snapshot_id',(payload->>'snapshot_id')::uuid,'generation_id',generation.id,
  'taxonomy_term_id',term.id,'term_key',target_term,'definition_digest',payload->>'definition_digest',
  'definition_revision',(payload->>'definition_revision')::int,'selected',is_selected,
  'selection_revision',revision,'selection_digest',signal_topic_editorial_digest_json_v1(jsonb_build_object(
   'workspace_id',target_workspace,'snapshot_id',(payload->>'snapshot_id')::uuid,'generation_id',generation.id,'taxonomy_term_id',term.id,
   'term_key',target_term,'definition_digest',payload->>'definition_digest',
   'definition_revision',(payload->>'definition_revision')::int,'selected',is_selected,'selection_revision',revision)),
  'operation_id',operation);
 INSERT INTO signal_defined_interest_selection_operations(id,workspace_id,actor_user_id,idempotency_key,
  request_digest,term_key,request,result_selection)
 VALUES(operation,target_workspace,target_actor,request_key,request_hash,target_term,payload,result);
 INSERT INTO signal_defined_interest_selections(workspace_id,term_key,snapshot_id,generation_id,taxonomy_term_id,
  definition_digest,definition_revision,selected,selection_revision,selection_digest,operation_id)
 VALUES(target_workspace,target_term,(payload->>'snapshot_id')::uuid,generation.id,term.id,payload->>'definition_digest',
  (payload->>'definition_revision')::int,is_selected,revision,result->>'selection_digest',operation)
 ON CONFLICT(workspace_id,term_key) DO UPDATE SET snapshot_id=excluded.snapshot_id,generation_id=excluded.generation_id,
  taxonomy_term_id=excluded.taxonomy_term_id,definition_digest=excluded.definition_digest,
  definition_revision=excluded.definition_revision,selected=excluded.selected,
  selection_revision=excluded.selection_revision,selection_digest=excluded.selection_digest,
  operation_id=excluded.operation_id,updated_at=clock_timestamp();
 RETURN jsonb_build_object('selection',result,'replayed',false);
END $$;

-- Read-side authority is recomputed; a stored selected=true receipt alone is
-- historical and never makes a stale interest visible in Signal.
CREATE FUNCTION signal_defined_interest_selection_current_v1(target_workspace uuid,target_term text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM signal_defined_interest_selections selected
  LEFT JOIN signal_topic_consolidation_bindings binding ON binding.workspace_id=selected.workspace_id
  LEFT JOIN signal_topic_consolidation_snapshots snapshot ON snapshot.id=binding.snapshot_id
    AND snapshot.workspace_id=selected.workspace_id
  JOIN signal_classification_generations generation ON generation.id=selected.generation_id
    AND generation.workspace_id=selected.workspace_id AND generation.status='ready'
    AND generation.finalized_digest IS NOT NULL AND generation.input_contract='workspace-topic-classification-v1'
    AND generation.input_snapshot->>'interest_term_key'=selected.term_key
    AND (generation.policy_valid_until IS NULL OR generation.policy_valid_until>now())
  JOIN signal_corpus_preparation_input_state state ON state.workspace_id=selected.workspace_id
    AND state.input_revision=generation.input_revision
  JOIN signal_corpus_preparation_runs preparation ON preparation.id=generation.preparation_run_id
    AND preparation.workspace_id=selected.workspace_id AND preparation.status='completed'
    AND (preparation.policy_valid_until IS NULL OR preparation.policy_valid_until>now())
  JOIN signal_topic_catalog_executions execution ON execution.generation_id=generation.id
    AND execution.workspace_id=selected.workspace_id AND execution.status='ready'
    AND execution.processed_roots=execution.denominator
  JOIN taxonomy_terms term ON term.id=selected.taxonomy_term_id AND term.term_key=selected.term_key
    AND term.status IN('candidate','active')
    AND term.metadata->'topic'->>'definition_digest'=selected.definition_digest
    AND (term.metadata->'topic'->>'definition_revision')::int=selected.definition_revision
  LEFT JOIN signal_classification_assignments assignment ON assignment.generation_id=generation.id
    AND assignment.workspace_id=selected.workspace_id AND assignment.taxonomy_term_id=term.id
    AND assignment.definition_digest=selected.definition_digest
    AND assignment.definition_revision=selected.definition_revision
    AND assignment.disposition='approved' AND assignment.resolution_method IN('model','human')
    AND signal_workspace_classification_assignment_current_v1(assignment,generation)
    AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments correction
      WHERE correction.generation_id=generation.id AND correction.canonical_root_id=assignment.canonical_root_id
       AND correction.taxonomy_term_id=term.id AND correction.resolution_method='human'
       AND correction.disposition='rejected'
       AND signal_workspace_classification_assignment_current_v1(correction,generation))
  LEFT JOIN mentions mention ON mention.id=assignment.canonical_root_id AND mention.workspace_id=selected.workspace_id
    AND mention.inclusion_status='included' AND mention.canonical_mention_id=mention.id
  WHERE selected.workspace_id=target_workspace AND selected.term_key=target_term AND selected.selected
    AND (selected.snapshot_id IS NULL OR binding.snapshot_id=selected.snapshot_id)
    AND (binding.snapshot_id IS NULL OR
      signal_topic_consolidation_snapshot_current_v1(snapshot.id)
       AND generation.input_revision=snapshot.input_revision)
    AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items failed
      WHERE failed.generation_id=generation.id AND failed.resolution_state='error')
    AND (assignment.id IS NULL OR EXISTS(SELECT 1 FROM signal_mention_import_memberships path
      JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=selected.workspace_id
       AND batch.data_source_id=path.data_source_id AND batch.status='completed'
      JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=selected.workspace_id AND source.status='active'
      JOIN signal_provenance_policy_bindings policy_binding ON policy_binding.workspace_id=selected.workspace_id
       AND policy_binding.data_source_id=source.id AND policy_binding.status='active'
       AND policy_binding.effective_from<=now() AND (policy_binding.effective_to IS NULL OR policy_binding.effective_to>now())
       AND (policy_binding.import_batch_id=batch.id OR policy_binding.import_batch_id IS NULL)
      JOIN signal_licensing_policies license ON license.id=policy_binding.licensing_policy_id
       AND license.workspace_id=selected.workspace_id AND license.status='active'
       AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
      JOIN signal_retention_policies retention ON retention.id=policy_binding.retention_policy_id
       AND retention.workspace_id=selected.workspace_id AND retention.status='active'
       AND retention.retention_state='allowed' AND retention.effective_from<=now()
       AND (retention.effective_to IS NULL OR retention.effective_to>now())
       AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
      JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=selected.workspace_id
      WHERE path.workspace_id=selected.workspace_id AND origin.canonical_mention_id=mention.id
       AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=selected.workspace_id
        AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-derived-metrics' AND usage.decision='allowed')
       AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=selected.workspace_id
        AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-mention-list' AND usage.decision='allowed')
       AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=selected.workspace_id
        AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-text-or-excerpt' AND usage.decision='allowed')))
  LIMIT 1),false)
$$;

REVOKE ALL ON signal_defined_interest_selection_operations,signal_defined_interest_selections FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_defined_interest_selection_actor_v1(uuid,uuid),
 signal_defined_interest_selection_history_v1(),signal_defined_interest_selection_guard_v1(),
 mutate_signal_defined_interest_selection_v1(uuid,uuid,text,jsonb),
 signal_defined_interest_selection_current_v1(uuid,text) FROM PUBLIC;
DO $$ DECLARE role_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON signal_defined_interest_selection_operations,signal_defined_interest_selections FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION signal_defined_interest_selection_actor_v1(uuid,uuid),signal_defined_interest_selection_history_v1(),signal_defined_interest_selection_guard_v1(),mutate_signal_defined_interest_selection_v1(uuid,uuid,text,jsonb),signal_defined_interest_selection_current_v1(uuid,text) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
