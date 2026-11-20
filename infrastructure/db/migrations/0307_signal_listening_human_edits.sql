-- Append-only post-run human decisions. These rows never create a provider
-- probability, call, admission, budget or permission to process a corpus.
ALTER TABLE signal_listening_serving_snapshots ADD CONSTRAINT signal_listening_serving_snapshot_workspace_id UNIQUE(workspace_id,id);
CREATE TABLE signal_listening_human_edits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 base_snapshot_id uuid NOT NULL,source_configuration_id uuid NOT NULL,configuration_id uuid NOT NULL,
 source_generation_id uuid NOT NULL,generation_id uuid NOT NULL UNIQUE,map_id uuid NOT NULL,
 expected_revision bigint NOT NULL CHECK(expected_revision>=0),previous_edit_id uuid,
 operation text NOT NULL CHECK(operation IN('remove','move','merge')),payload jsonb NOT NULL,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),request_digest text NOT NULL,
 source_digest text NOT NULL,source_generation_digest text NOT NULL,policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),
 policy_digest text NOT NULL,human_revision_digest text NOT NULL,snapshot_digest text NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_txid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,revision),UNIQUE(workspace_id,created_by_user_id,idempotency_key),UNIQUE(configuration_id),
 FOREIGN KEY(workspace_id,base_snapshot_id) REFERENCES signal_listening_serving_snapshots(workspace_id,id),
 FOREIGN KEY(workspace_id,source_configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 FOREIGN KEY(workspace_id,source_generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,map_id) REFERENCES signal_mass_labeling_maps(workspace_id,id),
 FOREIGN KEY(workspace_id,previous_edit_id) REFERENCES signal_listening_human_edits(workspace_id,id),
 CHECK(revision=expected_revision+1),CHECK(jsonb_typeof(payload)='object'),
 CHECK(request_digest~'^sha256:[0-9a-f]{64}$' AND source_digest~'^sha256:[0-9a-f]{64}$' AND source_generation_digest~'^sha256:[0-9a-f]{64}$'
  AND policy_digest~'^sha256:[0-9a-f]{64}$' AND human_revision_digest~'^sha256:[0-9a-f]{64}$' AND snapshot_digest~'^sha256:[0-9a-f]{64}$')
);
CREATE TABLE signal_listening_human_memberships(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,edit_id uuid NOT NULL,map_id uuid NOT NULL,
 question_key text NOT NULL,question_digest text NOT NULL,root_id uuid NOT NULL,input_digest text NOT NULL,entity_context_digest text NOT NULL,
 belongs boolean NOT NULL,source_evidence jsonb NOT NULL,
 UNIQUE(workspace_id,id),UNIQUE(edit_id,question_key,root_id),
 FOREIGN KEY(workspace_id,edit_id) REFERENCES signal_listening_human_edits(workspace_id,id),
 FOREIGN KEY(map_id,root_id) REFERENCES signal_mass_labeling_items(map_id,root_id),
 CHECK(question_digest~'^sha256:[0-9a-f]{64}$' AND input_digest~'^sha256:[0-9a-f]{64}$' AND entity_context_digest~'^sha256:[0-9a-f]{64}$')
);
CREATE INDEX signal_listening_human_memberships_identity ON signal_listening_human_memberships(workspace_id,map_id,root_id,input_digest,entity_context_digest,question_digest,edit_id);
CREATE TABLE signal_listening_human_aliases(
 workspace_id uuid NOT NULL,edit_id uuid NOT NULL,source_key text NOT NULL,target_key text NOT NULL,
 PRIMARY KEY(edit_id,source_key),FOREIGN KEY(workspace_id,edit_id) REFERENCES signal_listening_human_edits(workspace_id,id),
 CHECK(source_key<>target_key)
);
CREATE INDEX signal_listening_human_aliases_source ON signal_listening_human_aliases(workspace_id,source_key,edit_id);
-- A configuration captures its predecessor human revision at INSERT, rather
-- than comparing transaction-start timestamps with a later human COMMIT.
CREATE TABLE signal_listening_human_configuration_bindings(
 configuration_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>=0),created_txid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id)
);
ALTER TABLE signal_listening_discovery_generations ADD COLUMN human_edit_id uuid UNIQUE;
ALTER TABLE signal_listening_discovery_generations ADD FOREIGN KEY(workspace_id,human_edit_id)
 REFERENCES signal_listening_human_edits(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION signal_listening_human_edit_actor_v1(w uuid,actor uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(ws.status='active' AND b.status='active' AND u.status='active' AND EXISTS(
  SELECT 1 FROM signal_workspace_features WHERE workspace_id=w AND feature='mass_labeling') AND(
   u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','analyst','founder','admin','kam','insights_manager','ux_data_specialist')
   OR u.user_type='client' AND u.primary_role='client_admin' AND u.organization_id=ws.organization_id AND b.organization_id=ws.organization_id
    AND o.status='active' AND EXISTS(SELECT 1 FROM user_brand_access a WHERE a.user_id=u.id AND a.brand_id=b.id AND a.revoked_at IS NULL AND a.access_level IN('comment','admin'))),false)
 FROM signal_workspaces ws JOIN brands b ON b.id=ws.brand_id JOIN organizations o ON o.id=ws.organization_id JOIN users u ON u.id=actor WHERE ws.id=w
$$;
CREATE FUNCTION signal_listening_human_revision_v1(cid uuid) RETURNS bigint LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT greatest(COALESCE((SELECT revision FROM signal_listening_human_configuration_bindings WHERE configuration_id=cid),0),
  COALESCE((SELECT revision FROM signal_listening_human_edits WHERE configuration_id=cid),0))
$$;
CREATE FUNCTION signal_listening_human_bind_configuration_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 INSERT INTO signal_listening_human_configuration_bindings(configuration_id,workspace_id,revision)
 SELECT NEW.id,NEW.workspace_id,COALESCE(max(revision),0) FROM signal_listening_human_edits WHERE workspace_id=NEW.workspace_id;
 RETURN NEW;
END $$;
CREATE TRIGGER listening_human_configuration_binding AFTER INSERT ON signal_listening_configurations FOR EACH ROW EXECUTE FUNCTION signal_listening_human_bind_configuration_v1();

-- answer/cache_call_id remain the original classifier result. A human label is
-- a separate boolean, with explicit provenance, and is never 1.0 or 0.0 usage.
CREATE FUNCTION signal_listening_effective_population_roots_v2(w uuid,cid uuid,mid uuid,ctx text,roots uuid[],purpose text)
RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,
 question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,
 answer jsonb,cache_call_id uuid,scope_basis text,effective_belongs boolean,human_belongs boolean,
 human_decision_id uuid,legacy_manual_id uuid,label_source text,human_edit_revision bigint)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH revision AS(SELECT signal_listening_human_revision_v1(cid) n),
 population AS MATERIALIZED(SELECT * FROM signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose))
 SELECT p.root_id,p.input_digest,p.body,p.published_at,p.platform,p.question_key,p.question_digest,p.definition,p.wire,
  p.candidate OR decision.id IS NOT NULL OR legacy.id IS NOT NULL,p.scope_state,
  CASE WHEN revision.n>0 THEN raw.answer ELSE p.answer END,
  CASE WHEN revision.n>0 THEN raw.call_id ELSE p.cache_call_id END,p.scope_basis,
  CASE WHEN p.definition ? 'topic_source' THEN COALESCE(decision.belongs,legacy.belongs,(raw.answer->>'noul')::double precision>=0.7) END,
  COALESCE(decision.belongs,legacy.belongs),decision.id,legacy.id,
  CASE WHEN decision.id IS NOT NULL THEN 'human' WHEN legacy.id IS NOT NULL THEN 'legacy_human' WHEN raw.call_id IS NOT NULL THEN 'jev' ELSE 'pending' END,
  decision.revision
 FROM population p CROSS JOIN revision
 LEFT JOIN signal_listening_answers raw ON raw.workspace_id=w AND raw.root_id=p.root_id AND raw.input_digest=p.input_digest AND raw.entity_context_digest=ctx AND raw.question_digest=p.question_digest
 LEFT JOIN LATERAL(SELECT d.*,e.revision FROM signal_listening_human_memberships d JOIN signal_listening_human_edits e ON e.id=d.edit_id AND e.workspace_id=d.workspace_id
  WHERE d.workspace_id=w AND d.map_id=mid AND d.root_id=p.root_id AND d.input_digest=p.input_digest AND d.entity_context_digest=ctx AND d.question_digest=p.question_digest
   AND e.revision<=revision.n ORDER BY e.revision DESC,d.id DESC LIMIT 1)decision ON true
 LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=w AND d.map_id=mid AND d.root_id=p.root_id AND d.input_digest=p.input_digest AND d.entity_context_digest=ctx AND d.question_digest=p.question_digest
  ORDER BY d.created_at DESC,d.id DESC LIMIT 1)legacy ON true
$$;
-- Only suppress NEW questions matching an effective human decision. Recovery of
-- already-reserved/raw/unknown calls uses its existing native path unchanged.
CREATE FUNCTION signal_listening_human_decision_exists_v1(w uuid,cid uuid,mid uuid,rid uuid,input text,ctx text,question text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM signal_listening_human_memberships d JOIN signal_listening_human_edits e ON e.id=d.edit_id AND e.workspace_id=d.workspace_id
  WHERE d.workspace_id=w AND d.map_id=mid AND d.root_id=rid AND d.input_digest=input AND d.entity_context_digest=ctx AND d.question_digest=question
   AND e.revision<=signal_listening_human_revision_v1(cid))
$$;
CREATE FUNCTION signal_listening_human_new_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE owner signal_listening_runs;r signal_labeling_runs;i jsonb;q record;
BEGIN
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=NEW.run_id AND workspace_id=NEW.workspace_id;
 IF owner.run_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=owner.run_id;
 FOR i IN SELECT * FROM jsonb_array_elements(NEW.inputs) LOOP
  FOR q IN SELECT * FROM jsonb_each_text(i->'question_digests') LOOP
   IF signal_listening_human_decision_exists_v1(owner.workspace_id,owner.configuration_id,owner.map_id,(i->>'root_id')::uuid,i->>'input_digest',r.entity_context_digest,q.value)
    THEN RAISE EXCEPTION 'listening_human_question_already_resolved';END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
-- Existing submitted/unknown/raw calls remain recoverable: this only guards INSERT.
CREATE TRIGGER listening_human_new_call_guard BEFORE INSERT ON signal_labeling_calls FOR EACH ROW EXECUTE FUNCTION signal_listening_human_new_call_guard_v1();
CREATE FUNCTION signal_listening_human_alias_v1(w uuid,cid uuid,k text) RETURNS text LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$
DECLARE current_key text:=k;next_key text;seen text[]:=ARRAY[k];n integer;
BEGIN
 FOR n IN 1..256 LOOP
  SELECT a.target_key INTO next_key FROM signal_listening_human_aliases a JOIN signal_listening_human_edits e ON e.id=a.edit_id AND e.workspace_id=a.workspace_id
   WHERE a.workspace_id=w AND e.revision<=signal_listening_human_revision_v1(cid) AND a.source_key=current_key ORDER BY e.revision DESC LIMIT 1;
  IF next_key IS NULL THEN RETURN current_key;END IF;
  IF next_key=ANY(seen) THEN RAISE EXCEPTION 'listening_human_alias_cycle';END IF;
  seen:=array_append(seen,next_key);current_key:=next_key;
 END LOOP;
 RAISE EXCEPTION 'listening_human_alias_capacity';
END $$;
CREATE FUNCTION signal_listening_human_edit_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE s signal_listening_serving_snapshots;p signal_listening_discovery_executions;g signal_listening_discovery_generations;
 cfg signal_listening_configurations;prior signal_listening_configurations;last_edit signal_listening_human_edits;policy signal_processing_policy_versions;marker jsonb;expected_cfg jsonb;expected_questions jsonb;expected_retired jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_human_history_immutable';END IF;
 marker:=COALESCE(NULLIF(current_setting('noisia.listening_human_edit_v1',true),''),'{}')::jsonb;
 IF NEW.created_txid<>pg_current_xact_id() OR marker->>'edit_id' IS DISTINCT FROM NEW.id::text OR marker->>'actor_user_id' IS DISTINCT FROM NEW.created_by_user_id::text
  OR NOT signal_listening_human_edit_actor_v1(NEW.workspace_id,NEW.created_by_user_id) THEN RAISE EXCEPTION 'listening_human_forbidden' USING ERRCODE='42501';END IF;
 PERFORM signal_listening_human_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 SELECT * INTO s FROM signal_listening_serving_snapshots WHERE id=NEW.base_snapshot_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO p FROM signal_listening_discovery_executions WHERE id=s.execution_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.source_generation_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO cfg FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO prior FROM signal_listening_configurations WHERE id=NEW.source_configuration_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO last_edit FROM signal_listening_human_edits WHERE workspace_id=NEW.workspace_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO policy FROM signal_processing_policy_versions WHERE id=p.policy_version_id;
 IF s.id IS NULL OR p.status IS DISTINCT FROM 'completed' OR s.map_id<>NEW.map_id OR g.map_id<>NEW.map_id OR g.configuration_id<>prior.id
  OR g.status<>'ready' OR g.snapshot_digest<>NEW.source_generation_digest OR NOT signal_listening_discovery_source_current_v1(g.id)
  OR g.id IS DISTINCT FROM COALESCE((SELECT generation_id FROM signal_listening_human_edits WHERE workspace_id=NEW.workspace_id AND base_snapshot_id=s.id ORDER BY revision DESC LIMIT 1),s.generation_id)
  OR NEW.source_digest<>s.snapshot_digest OR cfg.state<>'published' OR cfg.provenance<>'human' OR prior.state<>'published'
  OR cfg.revision<=prior.revision OR cfg.id IS DISTINCT FROM(SELECT id FROM signal_listening_configurations WHERE workspace_id=NEW.workspace_id AND state='published' ORDER BY revision DESC LIMIT 1)
  OR prior.id IS DISTINCT FROM(SELECT id FROM signal_listening_configurations WHERE workspace_id=NEW.workspace_id AND state='published' AND id<>cfg.id ORDER BY revision DESC LIMIT 1)
  OR NEW.expected_revision<>COALESCE(last_edit.revision,0) OR NEW.previous_edit_id IS DISTINCT FROM last_edit.id
  OR NEW.policy_version_id IS DISTINCT FROM p.policy_version_id OR NEW.policy_digest IS DISTINCT FROM policy.policy_digest
  OR NEW.human_revision_digest IS DISTINCT FROM signal_listening_discovery_human_revision_v1(prior.id)
  OR NOT EXISTS(SELECT 1 FROM signal_listening_human_configuration_bindings b WHERE b.configuration_id=cfg.id AND b.revision=NEW.expected_revision AND b.created_txid=pg_current_xact_id())
  THEN RAISE EXCEPTION 'listening_human_context_changed';END IF;
 IF NEW.request_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_object('contract_version','signal-listening-human-edit-v1','workspace_id',NEW.workspace_id,'actor_user_id',NEW.created_by_user_id,'operation',NEW.operation,'payload',NEW.payload,
  'expected',jsonb_build_object('base_snapshot_id',s.id,'configuration_id',prior.id,'configuration_digest',prior.configuration_digest,'source_generation_id',g.id,'source_generation_digest',g.snapshot_digest,'map_id',s.map_id,'source_digest',s.snapshot_digest,'policy_version_id',p.policy_version_id,'policy_digest',policy.policy_digest,'human_revision_digest',NEW.human_revision_digest,'edit_revision',NEW.expected_revision,'previous_edit_id',NEW.previous_edit_id))) THEN RAISE EXCEPTION 'listening_human_request_digest_invalid';END IF;
 IF NEW.operation IN('move','remove') AND(NEW.payload->>'root_id' IS NULL OR NEW.payload->>'from_question_key' IS NULL
  OR (NEW.operation='move') IS DISTINCT FROM(NEW.payload->>'to_question_key' IS NOT NULL)) THEN RAISE EXCEPTION 'listening_human_payload_invalid';END IF;
 IF NEW.operation='merge' AND(jsonb_array_length(NEW.payload->'source_question_keys')<2 OR NEW.payload->>'target_question_key' IS NULL) THEN RAISE EXCEPTION 'listening_human_payload_invalid';END IF;
 IF NEW.operation='merge' AND(NOT(NEW.payload->'source_question_keys' ? (NEW.payload->>'target_question_key'))
  OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(NEW.payload->'source_question_keys'))<>jsonb_array_length(NEW.payload->'source_question_keys')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.payload->'source_question_keys') k WHERE NOT EXISTS(SELECT 1 FROM signal_listening_questions q WHERE q.configuration_id=prior.id AND q.question_key=k AND q.definition->>'type'='noul' AND q.definition ? 'topic_source'))
  OR(SELECT count(DISTINCT q.definition->>'scope') FROM signal_listening_questions q WHERE q.configuration_id=prior.id AND NEW.payload->'source_question_keys' ? q.question_key)<>1)
  THEN RAISE EXCEPTION 'listening_human_merge_scope_invalid';END IF;
 SELECT COALESCE(jsonb_agg(CASE WHEN NEW.operation='merge' AND q->>'key'=NEW.payload->>'target_question_key'
   OR NEW.operation IN('move','remove') AND q->>'key' IN(NEW.payload->>'from_question_key',NEW.payload->>'to_question_key') THEN jsonb_set(q,'{human_locked}','true'::jsonb) ELSE q END ORDER BY ordinal),'[]'::jsonb)
 INTO expected_questions FROM jsonb_array_elements(prior.configuration->'questions') WITH ORDINALITY questions(q,ordinal)
 WHERE NEW.operation<>'merge' OR NOT(NEW.payload->'source_question_keys' ? (q->>'key')) OR q->>'key'=NEW.payload->>'target_question_key';
 expected_cfg:=jsonb_set(prior.configuration,'{questions}',expected_questions);
 IF NEW.operation='merge' THEN
  SELECT COALESCE(jsonb_agg(k ORDER BY k),'[]'::jsonb) INTO expected_retired FROM(
   SELECT DISTINCT k FROM(SELECT jsonb_array_elements_text(prior.configuration->'retired_question_keys') k
    UNION ALL SELECT jsonb_array_elements_text(NEW.payload->'source_question_keys')) keys WHERE k<>NEW.payload->>'target_question_key') retired;
  expected_cfg:=jsonb_set(expected_cfg,'{retired_question_keys}',expected_retired);
 END IF;
 IF cfg.configuration IS DISTINCT FROM expected_cfg THEN RAISE EXCEPTION 'listening_human_configuration_delta_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER listening_human_edit_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_human_edits FOR EACH ROW EXECUTE FUNCTION signal_listening_human_edit_guard_v1();
CREATE FUNCTION signal_listening_human_membership_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_listening_human_edits;q signal_listening_questions;p record;marker jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_human_history_immutable';END IF;
 SELECT * INTO e FROM signal_listening_human_edits WHERE id=NEW.edit_id AND workspace_id=NEW.workspace_id;
 marker:=COALESCE(NULLIF(current_setting('noisia.listening_human_edit_v1',true),''),'{}')::jsonb;
 SELECT * INTO q FROM signal_listening_questions WHERE configuration_id=e.configuration_id AND question_key=NEW.question_key;
 SELECT * INTO p FROM signal_listening_effective_population_roots_v2(e.workspace_id,e.source_configuration_id,e.map_id,NEW.entity_context_digest,ARRAY[NEW.root_id],'client-derived-metrics')
  WHERE question_key=COALESCE(e.payload->>'from_question_key',e.payload->>'target_question_key');
 IF e.id IS NULL OR e.created_txid<>pg_current_xact_id() OR marker->>'edit_id' IS DISTINCT FROM e.id::text OR NOT signal_listening_human_edit_actor_v1(e.workspace_id,e.created_by_user_id)
  OR q.question_key IS NULL OR q.definition->>'type'<>'noul' OR NOT(q.definition ? 'topic_source') OR q.definition->'human_locked'<>'true'::jsonb
  OR NEW.question_digest IS DISTINCT FROM q.question_digest OR NEW.map_id<>e.map_id OR p.root_id IS NULL OR p.scope_state<>'included'
  OR NEW.input_digest<>p.input_digest OR NEW.entity_context_digest<>(SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=e.map_id)
  OR NOT signal_listening_root_right_v1(e.workspace_id,NEW.root_id,'client-derived-metrics')
  OR NOT EXISTS(SELECT 1 FROM signal_listening_effective_population_roots_v2(e.workspace_id,e.source_configuration_id,e.map_id,NEW.entity_context_digest,ARRAY[NEW.root_id],'client-derived-metrics') dest WHERE dest.question_key=NEW.question_key AND dest.scope_state='included')
  THEN RAISE EXCEPTION 'listening_human_membership_invalid';END IF;
 IF e.operation IN('remove','move') AND(NEW.root_id::text<>e.payload->>'root_id' OR p.effective_belongs IS DISTINCT FROM true
  OR NOT(NEW.question_key=e.payload->>'from_question_key' AND NOT NEW.belongs OR e.operation='move' AND NEW.question_key=e.payload->>'to_question_key' AND NEW.belongs)) THEN RAISE EXCEPTION 'listening_human_membership_invalid';END IF;
 IF e.operation='merge' AND(NEW.question_key<>e.payload->>'target_question_key' OR NOT NEW.belongs OR NOT EXISTS(
  SELECT 1 FROM signal_listening_effective_population_roots_v2(e.workspace_id,e.source_configuration_id,e.map_id,NEW.entity_context_digest,ARRAY[NEW.root_id],'client-derived-metrics') prior_member
   WHERE prior_member.question_key IN(SELECT jsonb_array_elements_text(e.payload->'source_question_keys')) AND prior_member.scope_state='included' AND prior_member.effective_belongs)) THEN RAISE EXCEPTION 'listening_human_merge_member_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER listening_human_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_human_memberships FOR EACH ROW EXECUTE FUNCTION signal_listening_human_membership_guard_v1();
CREATE FUNCTION signal_listening_human_alias_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE e signal_listening_human_edits;marker jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_human_history_immutable';END IF;
 SELECT * INTO e FROM signal_listening_human_edits WHERE id=NEW.edit_id AND workspace_id=NEW.workspace_id;
 marker:=COALESCE(NULLIF(current_setting('noisia.listening_human_edit_v1',true),''),'{}')::jsonb;
 IF e.id IS NULL OR e.created_txid<>pg_current_xact_id() OR e.operation<>'merge' OR marker->>'edit_id' IS DISTINCT FROM e.id::text OR NOT signal_listening_human_edit_actor_v1(e.workspace_id,e.created_by_user_id)
  OR NOT(e.payload->'source_question_keys' ? NEW.source_key) OR NEW.target_key<>e.payload->>'target_question_key'
  OR NOT EXISTS(SELECT 1 FROM signal_listening_questions WHERE configuration_id=e.configuration_id AND question_key=NEW.target_key AND definition->'human_locked'='true'::jsonb)
  OR EXISTS(SELECT 1 FROM signal_listening_questions WHERE configuration_id=e.configuration_id AND question_key=NEW.source_key)
  OR NOT EXISTS(SELECT 1 FROM signal_listening_configurations WHERE id=e.configuration_id AND(configuration->'retired_question_keys') ? NEW.source_key)
  THEN RAISE EXCEPTION 'listening_human_alias_invalid';END IF;
 IF signal_listening_human_alias_v1(e.workspace_id,e.source_configuration_id,NEW.target_key)=NEW.source_key THEN RAISE EXCEPTION 'listening_human_alias_cycle';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER listening_human_alias_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_human_aliases FOR EACH ROW EXECUTE FUNCTION signal_listening_human_alias_guard_v1();

CREATE FUNCTION signal_listening_human_evaluation_approved_v1(e jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(e->'human_belongs')='boolean' THEN (e->>'human_belongs')::boolean ELSE (e->>'probability')::double precision>=0.7 END
$$;
ALTER FUNCTION signal_listening_discovery_root_proofs_v1(uuid,uuid[]) RENAME TO signal_listening_discovery_root_proofs_before_human_v1;
CREATE FUNCTION signal_listening_discovery_root_proofs_v1(target uuid,roots uuid[]) RETURNS TABLE(root_id uuid,proof jsonb)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH generation AS MATERIALIZED(SELECT * FROM signal_listening_discovery_generations WHERE id=target),
 original AS MATERIALIZED(SELECT * FROM signal_listening_discovery_root_proofs_before_human_v1(target,roots)),
 population AS MATERIALIZED(SELECT p.*,g.workspace_id,g.configuration_id,g.map_id,g.entity_context_digest,
  signal_listening_discovery_candidates_v1(g.workspace_id,g.configuration_id,g.map_id,p.root_id,target) generation_candidates
  FROM generation g CROSS JOIN LATERAL signal_listening_effective_population_roots_v2(g.workspace_id,g.configuration_id,g.map_id,g.entity_context_digest,roots,'llm-processing') p
  WHERE signal_listening_human_revision_v1(g.configuration_id)>0),
 evaluations AS(SELECT p.root_id,jsonb_agg(jsonb_build_object('question_key',p.question_key,'question_digest',p.question_digest,
  'probability',(p.answer->>'noul')::double precision,'call_id',p.cache_call_id,
  'manual_id',COALESCE(p.human_decision_id,p.legacy_manual_id),'human_decision_id',COALESCE(p.human_decision_id,p.legacy_manual_id),
  'human_belongs',p.human_belongs,'human_decision_kind',CASE WHEN p.human_decision_id IS NOT NULL THEN 'human_edit' WHEN p.legacy_manual_id IS NOT NULL THEN 'legacy_manual' END) ORDER BY p.question_key) value
 FROM population p WHERE p.definition ? 'topic_source' AND p.scope_state='included'
  AND(CASE WHEN p.definition->>'topic_source'='discovered' THEN COALESCE(p.question_key=ANY(p.generation_candidates),p.candidate) ELSE p.candidate END OR p.human_belongs IS NOT NULL)
 GROUP BY p.root_id)
 SELECT original.root_id,CASE WHEN signal_listening_human_revision_v1(g.configuration_id)=0 THEN original.proof
  ELSE jsonb_set(original.proof,'{evaluations}',COALESCE(evaluations.value,'[]'::jsonb)) END
 FROM original CROSS JOIN generation g LEFT JOIN evaluations ON evaluations.root_id=original.root_id
$$;

-- The generic refresh SQL predates human decisions. Suppress only an exact
-- native insertion contradicted by an immutable human false decision; at seal,
-- add human true members even when no JEV probability exists. Nothing is deleted.
CREATE FUNCTION signal_listening_human_confirm_members_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF OLD.status='building' AND NEW.status='ready' AND NEW.kind='confirmed_members' AND signal_listening_human_revision_v1(NEW.configuration_id)>0 THEN
  INSERT INTO signal_listening_discovery_members(generation_id,workspace_id,question_key,root_id,evidence)
   SELECT r.generation_id,r.workspace_id,e->>'question_key',r.root_id,jsonb_build_object('kind',CASE WHEN e->>'manual_id' IS NULL THEN 'jev' ELSE 'manual' END,'evaluation',e)
   FROM signal_listening_discovery_roots r CROSS JOIN LATERAL jsonb_array_elements(r.proof->'evaluations') e
   JOIN signal_listening_discovery_topics t ON t.generation_id=r.generation_id AND t.question_key=e->>'question_key'
   WHERE r.generation_id=NEW.id AND r.proof->>'embedding_call_id' IS NOT NULL AND signal_listening_human_evaluation_approved_v1(e)
   ON CONFLICT DO NOTHING;
  UPDATE signal_listening_discovery_topics t SET centroid=signal_listening_discovery_centroid_v1(t.generation_id,t.question_key),
   member_count=(SELECT count(*) FROM signal_listening_discovery_members WHERE generation_id=t.generation_id AND question_key=t.question_key)
   WHERE t.generation_id=NEW.id;
  NEW.counts:=signal_listening_discovery_counts_v1(NEW.id);NEW.snapshot_digest:=signal_listening_discovery_digest_v1(NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_listening_human_confirm_members BEFORE UPDATE ON signal_listening_discovery_generations FOR EACH ROW EXECUTE FUNCTION signal_listening_human_confirm_members_v1();

CREATE OR REPLACE FUNCTION signal_listening_discovery_member_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE g signal_listening_discovery_generations;t signal_listening_discovery_topics;r signal_listening_discovery_roots;v jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id AND status='building';
 SELECT * INTO t FROM signal_listening_discovery_topics WHERE generation_id=g.id AND question_key=NEW.question_key;
 SELECT * INTO r FROM signal_listening_discovery_roots WHERE generation_id=g.id AND root_id=NEW.root_id;
 IF g.id IS NULL OR t.question_key IS NULL OR r.root_id IS NULL OR r.proof->>'embedding_call_id' IS NULL THEN RAISE EXCEPTION 'listening_discovery_member_invalid';END IF;
 IF t.kind='confirmed_members' AND signal_listening_human_revision_v1(g.configuration_id)>0 THEN
  SELECT value INTO v FROM jsonb_array_elements(r.proof->'evaluations') WHERE value->>'question_key'=t.question_key AND value->>'question_digest'=t.question_digest;
  IF v->'human_belongs'='false'::jsonb THEN
   IF NEW.evidence IS DISTINCT FROM jsonb_build_object('kind',CASE WHEN v->>'manual_id' IS NULL THEN 'jev' ELSE 'manual' END,'evaluation',v) THEN RAISE EXCEPTION 'listening_discovery_confirmation_invalid';END IF;
   RETURN NULL;
  END IF;
 END IF;
 IF t.kind='confirmed_members' THEN
  SELECT value INTO v FROM jsonb_array_elements(r.proof->'evaluations') WHERE value->>'question_key'=t.question_key AND value->>'question_digest'=t.question_digest AND signal_listening_human_evaluation_approved_v1(value);
  IF v IS NULL OR NEW.evidence IS DISTINCT FROM jsonb_build_object('kind',CASE WHEN v->>'manual_id' IS NULL THEN 'jev' ELSE 'manual' END,'evaluation',v) THEN RAISE EXCEPTION 'listening_discovery_confirmation_invalid';END IF;
 ELSIF t.kind='source_seed' THEN
  IF NEW.evidence->>'kind'='source_confirmed' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_listening_discovery_members source JOIN signal_listening_discovery_generations sg ON sg.id=source.generation_id
    JOIN signal_listening_discovery_roots sr ON sr.generation_id=source.generation_id AND sr.root_id=source.root_id
    WHERE source.generation_id=g.source_generation_id AND source.root_id=NEW.root_id AND source.question_key=NEW.evidence->>'question_key'
     AND NEW.evidence->>'generation_id'=source.generation_id::text AND source.evidence->>'kind' IN('jev','manual')
     AND (t.lineage->'source_topic_keys') ? source.question_key AND sg.status='ready'
     AND sr.proof->>'input_digest'=r.proof->>'input_digest' AND sr.proof->>'embedding_sha256'=r.proof->>'embedding_sha256') THEN RAISE EXCEPTION 'listening_discovery_source_member_invalid';END IF;
  ELSIF NEW.evidence->>'kind'='orphan_seed' THEN
   IF NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subsets subset JOIN signal_listening_discovery_subset_roots sr ON sr.subset_id=subset.id
    JOIN signal_listening_discovery_roots original ON original.generation_id=sr.generation_id AND original.root_id=sr.root_id
    JOIN signal_listening_discovery_generations sg ON sg.id=subset.generation_id
    WHERE subset.id=(NEW.evidence->>'subset_id')::uuid AND subset.status='ready' AND subset.workspace_id=g.workspace_id AND sr.root_id=NEW.root_id
     AND sg.map_id=g.map_id AND sg.embedding_config_digest=g.embedding_config_digest AND sg.entity_context_digest=g.entity_context_digest
     AND t.lineage->>'subset_id'=subset.id::text AND t.lineage->>'group_digest'=NEW.evidence->>'group_digest' AND (t.lineage->'orphan_root_ids') ? NEW.root_id::text AND original.proof->>'input_digest'=r.proof->>'input_digest'
     AND original.proof->>'embedding_sha256'=r.proof->>'embedding_sha256') THEN RAISE EXCEPTION 'listening_discovery_orphan_seed_invalid';END IF;
  ELSE RAISE EXCEPTION 'listening_discovery_source_kind_invalid';END IF;
 ELSE RAISE EXCEPTION 'listening_discovery_legacy_members_invalid';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_listening_discovery_generation_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE map signal_mass_labeling_maps;cfg signal_listening_configurations;source signal_listening_discovery_generations;topic signal_listening_discovery_topics;expected_roots uuid[];actual_roots uuid[];
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND (OLD.status<>'building' OR NEW.status<>'ready' OR
  (to_jsonb(NEW)-ARRAY['status','counts','snapshot_digest']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','counts','snapshot_digest'])) THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 IF NEW.human_edit_id IS NULL THEN
  PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 ELSE
  IF NOT signal_listening_human_edit_actor_v1(NEW.workspace_id,NEW.created_by_user_id) OR NOT EXISTS(
   SELECT 1 FROM signal_listening_human_edits e WHERE e.id=NEW.human_edit_id AND e.workspace_id=NEW.workspace_id
    AND e.created_txid=pg_current_xact_id() AND e.generation_id=NEW.id AND e.configuration_id=NEW.configuration_id AND e.source_generation_id=NEW.source_generation_id
    AND e.created_by_user_id=NEW.created_by_user_id AND e.map_id=NEW.map_id
    AND(COALESCE(NULLIF(current_setting('noisia.listening_human_edit_v1',true),''),'{}')::jsonb->>'edit_id')=e.id::text)
   THEN RAISE EXCEPTION 'listening_human_generation_forbidden';END IF;
 END IF;
 SELECT * INTO map FROM signal_mass_labeling_maps WHERE id=NEW.map_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO cfg FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id AND state='published';
 IF cfg.id IS NULL OR map.id IS NULL OR ROW(NEW.preparation_run_id,NEW.input_revision,NEW.embedding_config_digest,NEW.entity_context_digest,NEW.configuration_digest)
  IS DISTINCT FROM ROW(map.preparation_run_id,map.input_revision,map.embedding_config_digest,map.entity_context_digest,cfg.configuration_digest)
  OR NOT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=NEW.workspace_id AND feature='mass_labeling') THEN RAISE EXCEPTION 'listening_discovery_scope_invalid';END IF;
 IF NEW.source_generation_id IS NOT NULL THEN
  SELECT * INTO source FROM signal_listening_discovery_generations WHERE id=NEW.source_generation_id AND status='ready';
  IF source.id IS NULL OR ROW(source.workspace_id,source.map_id,source.preparation_run_id,source.input_revision,source.embedding_config_digest,source.entity_context_digest)
   IS DISTINCT FROM ROW(NEW.workspace_id,NEW.map_id,NEW.preparation_run_id,NEW.input_revision,NEW.embedding_config_digest,NEW.entity_context_digest)
   THEN RAISE EXCEPTION 'listening_discovery_source_invalid';END IF;
 END IF;
 IF NEW.human_edit_id IS NULL AND signal_listening_human_revision_v1(NEW.configuration_id)>0 AND(NEW.kind='legacy_seed'
  OR NEW.source_generation_id IS NOT NULL AND signal_listening_human_revision_v1(source.configuration_id)<>signal_listening_human_revision_v1(NEW.configuration_id))
  THEN RAISE EXCEPTION 'listening_human_source_revision_changed';END IF;
 IF TG_OP='INSERT' AND(NEW.status<>'building' OR NEW.counts IS NOT NULL OR NEW.snapshot_digest IS NOT NULL) THEN RAISE EXCEPTION 'listening_discovery_must_build';END IF;
 IF TG_OP='UPDATE' AND(NEW.counts IS DISTINCT FROM signal_listening_discovery_counts_v1(NEW.id)
   OR (NEW.counts->>'roots')::integer<>(SELECT count(*) FROM signal_mass_labeling_items i JOIN mentions m ON m.workspace_id=i.workspace_id AND m.id=i.root_id WHERE i.workspace_id=NEW.workspace_id AND i.map_id=NEW.map_id AND m.canonical_mention_id=m.id AND m.inclusion_status='included' AND signal_listening_root_right_v1(NEW.workspace_id,i.root_id,'llm-processing'))
   OR NEW.snapshot_digest IS DISTINCT FROM signal_listening_discovery_digest_v1(NEW.id)
   OR (SELECT count(*) FROM signal_listening_discovery_topics WHERE generation_id=NEW.id)<>(SELECT count(*) FROM signal_listening_questions WHERE configuration_id=NEW.configuration_id AND definition->>'topic_source'='discovered'))
  THEN RAISE EXCEPTION 'listening_discovery_snapshot_incomplete';END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM signal_listening_discovery_topics t WHERE t.generation_id=NEW.id AND (t.kind='source_seed' AND t.member_count=0 AND NOT signal_listening_discovery_empty_seed_v1(t) OR t.kind='confirmed_members' AND t.member_count<>(SELECT count(*) FROM signal_listening_discovery_roots r CROSS JOIN LATERAL jsonb_array_elements(r.proof->'evaluations') e WHERE r.generation_id=NEW.id AND r.proof->>'embedding_call_id' IS NOT NULL AND e->>'question_key'=t.question_key AND e->>'question_digest'=t.question_digest AND signal_listening_human_evaluation_approved_v1(e)))) THEN RAISE EXCEPTION 'listening_discovery_members_incomplete';END IF;
 IF TG_OP='UPDATE' THEN
  FOR topic IN SELECT * FROM signal_listening_discovery_topics WHERE generation_id=NEW.id AND kind='source_seed' LOOP
   SELECT ARRAY(SELECT root_id FROM(SELECT member.root_id FROM signal_listening_discovery_members member WHERE member.generation_id=NEW.source_generation_id AND member.question_key IN(SELECT jsonb_array_elements_text(topic.lineage->'source_topic_keys')) AND member.evidence->>'kind' IN('jev','manual')
    UNION SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(topic.lineage->'orphan_root_ids','[]'::jsonb))) expected ORDER BY root_id) INTO expected_roots;
   SELECT ARRAY(SELECT root_id FROM signal_listening_discovery_members WHERE generation_id=NEW.id AND question_key=topic.question_key ORDER BY root_id) INTO actual_roots;
   IF expected_roots IS DISTINCT FROM actual_roots THEN RAISE EXCEPTION 'listening_discovery_seed_members_incomplete';END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION signal_listening_discovery_counts_v1(target uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('map_roots',(SELECT m.root_count FROM signal_listening_discovery_generations g JOIN signal_mass_labeling_maps m ON m.id=g.map_id WHERE g.id=target),'roots',count(*),'cached_vectors',count(*) FILTER(WHERE proof->>'embedding_call_id' IS NOT NULL),
  'category_roots',count(*) FILTER(WHERE proof->'in_category'='true'::jsonb),'pending_base',count(*) FILTER(WHERE proof->'pending_base'='true'::jsonb),
  'pending_topics',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'evaluations') e WHERE e->>'probability' IS NULL AND jsonb_typeof(e->'human_belongs') IS DISTINCT FROM 'boolean')),
  'topics',(SELECT count(*) FROM signal_listening_discovery_topics WHERE generation_id=target)) FROM signal_listening_discovery_roots WHERE generation_id=target
$$;

-- Selection, row admission and full-census validation share one predicate.
-- A human false decision overrides a positive or absent model probability;
-- a human true decision remains a member even when JEV was negative/unasked.
CREATE FUNCTION signal_listening_human_orphan_proof_v1(proof jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(proof->'in_category'='true'::jsonb AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(proof->'evaluations') e WHERE
   (e->>'probability' IS NULL AND jsonb_typeof(e->'human_belongs') IS DISTINCT FROM 'boolean')
   OR signal_listening_human_evaluation_approved_v1(e)),false)
$$;
CREATE OR REPLACE FUNCTION signal_listening_discovery_subset_complete_v1(sid uuid,gid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(s.status='ready' AND s.generation_id=gid AND s.workspace_id=g.workspace_id
 AND s.root_count=(SELECT count(*) FROM signal_listening_discovery_roots r WHERE r.generation_id=g.id AND signal_listening_human_orphan_proof_v1(r.proof))
 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subset_roots chosen JOIN signal_listening_discovery_roots r ON r.generation_id=chosen.generation_id AND r.root_id=chosen.root_id
  WHERE chosen.subset_id=s.id AND(chosen.generation_id<>g.id OR chosen.proof_digest<>r.proof_digest OR NOT signal_listening_human_orphan_proof_v1(r.proof)))
 AND s.root_count=(SELECT count(*) FROM signal_listening_discovery_subset_roots WHERE subset_id=s.id),false)
 FROM signal_listening_discovery_subsets s JOIN signal_listening_discovery_generations g ON g.id=gid AND g.workspace_id=s.workspace_id WHERE s.id=sid
$$;

CREATE OR REPLACE FUNCTION signal_listening_discovery_subset_root_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE p jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subsets WHERE id=NEW.subset_id AND generation_id=NEW.generation_id AND status='building') THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 SELECT proof INTO p FROM signal_listening_discovery_roots WHERE generation_id=NEW.generation_id AND root_id=NEW.root_id AND proof_digest=NEW.proof_digest;
 IF p IS NULL OR NOT signal_listening_human_orphan_proof_v1(p) THEN RAISE EXCEPTION 'listening_discovery_not_orphan';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION signal_listening_human_lock_actor_v1(w uuid,actor uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 PERFORM u.id FROM users u JOIN signal_workspaces ws ON ws.id=w JOIN brands b ON b.id=ws.brand_id JOIN organizations o ON o.id=ws.organization_id WHERE u.id=actor FOR SHARE OF u,ws,b,o;
 PERFORM a.id FROM user_brand_access a JOIN signal_workspaces ws ON ws.brand_id=a.brand_id WHERE ws.id=w AND a.user_id=actor AND a.revoked_at IS NULL ORDER BY a.id FOR SHARE OF a;
 IF NOT signal_listening_human_edit_actor_v1(w,actor) THEN RAISE EXCEPTION 'listening_human_forbidden' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION signal_listening_human_source_evidence_v1(eid uuid,rid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('question_key',p.question_key,'question_digest',p.question_digest,
  'model_call_id',p.cache_call_id,'answer',p.answer,'human_decision_id',p.human_decision_id,'legacy_manual_id',p.legacy_manual_id,
  'effective_belongs',p.effective_belongs) ORDER BY p.question_key),'[]'::jsonb)
 FROM signal_listening_human_edits e JOIN signal_mass_labeling_maps m ON m.id=e.map_id AND m.workspace_id=e.workspace_id
 CROSS JOIN LATERAL signal_listening_effective_population_roots_v2(e.workspace_id,e.source_configuration_id,e.map_id,m.entity_context_digest,ARRAY[rid],'client-derived-metrics') p
 WHERE e.id=eid AND p.scope_state='included' AND p.effective_belongs AND
  (e.operation='merge' AND e.payload->'source_question_keys' ? p.question_key OR e.operation IN('move','remove') AND p.question_key=e.payload->>'from_question_key')
$$;
CREATE FUNCTION signal_listening_human_configuration_binding_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_human_history_immutable';END IF;
 IF NEW.created_txid<>pg_current_xact_id() OR NOT EXISTS(SELECT 1 FROM signal_listening_configurations c WHERE c.id=NEW.configuration_id AND c.workspace_id=NEW.workspace_id AND c.xmin=pg_current_xact_id()::xid)
  OR NEW.revision<>(SELECT COALESCE(max(revision),0) FROM signal_listening_human_edits WHERE workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'listening_human_configuration_binding_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER listening_human_configuration_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_human_configuration_bindings FOR EACH ROW EXECUTE FUNCTION signal_listening_human_configuration_binding_guard_v1();
CREATE FUNCTION signal_listening_human_edit_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE expected integer;actual integer;g signal_listening_discovery_generations;config signal_listening_configurations;
BEGIN
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO config FROM signal_listening_configurations WHERE id=NEW.configuration_id AND workspace_id=NEW.workspace_id;
 IF g.id IS NULL OR g.status<>'ready' OR g.human_edit_id IS DISTINCT FROM NEW.id OR g.configuration_id<>NEW.configuration_id
  OR NOT signal_listening_human_edit_actor_v1(NEW.workspace_id,NEW.created_by_user_id) OR NOT signal_listening_discovery_source_current_v1(g.id)
  THEN RAISE EXCEPTION 'listening_human_edit_incomplete';END IF;
 IF NEW.operation='merge' THEN
  SELECT count(DISTINCT p.root_id)::integer INTO expected FROM signal_mass_labeling_maps m
   CROSS JOIN LATERAL signal_listening_effective_population_roots_v2(NEW.workspace_id,NEW.source_configuration_id,NEW.map_id,m.entity_context_digest,NULL,'client-derived-metrics') p
   WHERE m.id=NEW.map_id AND p.scope_state='included' AND p.effective_belongs AND NEW.payload->'source_question_keys' ? p.question_key;
  IF(SELECT count(*) FROM signal_listening_human_aliases WHERE edit_id=NEW.id)<>jsonb_array_length(NEW.payload->'source_question_keys')-1 THEN RAISE EXCEPTION 'listening_human_aliases_incomplete';END IF;
 ELSE expected:=CASE NEW.operation WHEN 'move' THEN 2 ELSE 1 END;
 END IF;
 SELECT count(*)::integer INTO actual FROM signal_listening_human_memberships WHERE edit_id=NEW.id;
 IF actual<>expected THEN RAISE EXCEPTION 'listening_human_memberships_incomplete';END IF;
 IF EXISTS(SELECT 1 FROM signal_listening_human_memberships d WHERE d.edit_id=NEW.id AND d.source_evidence IS DISTINCT FROM signal_listening_human_source_evidence_v1(NEW.id,d.root_id)) THEN RAISE EXCEPTION 'listening_human_source_evidence_invalid';END IF;
 IF NEW.snapshot_digest IS DISTINCT FROM signal_labeling_digest_v1(jsonb_build_object('contract_version','signal-listening-human-snapshot-v1','workspace_id',NEW.workspace_id,
  'base_snapshot_id',NEW.base_snapshot_id,'configuration_id',NEW.configuration_id,'configuration_digest',config.configuration_digest,
  'generation_id',NEW.generation_id,'revision',NEW.revision,'operation',NEW.operation,'payload',NEW.payload,'source_digest',NEW.source_digest)) THEN RAISE EXCEPTION 'listening_human_snapshot_digest_invalid';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER listening_human_edit_complete AFTER INSERT ON signal_listening_human_edits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_human_edit_complete_v1();
CREATE FUNCTION signal_listening_human_no_truncate_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'listening_human_history_immutable';END $$;
DO $$DECLARE name text;fn text;BEGIN
 FOREACH name IN ARRAY ARRAY['signal_listening_human_edits','signal_listening_human_memberships','signal_listening_human_aliases','signal_listening_human_configuration_bindings'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC,anon,authenticated',name);
  EXECUTE format('GRANT ALL ON TABLE %I TO service_role',name);
  EXECUTE format('CREATE TRIGGER retain_human_edit_history BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION signal_listening_human_no_truncate_v1()',name);
 END LOOP;
 FOR fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND(p.proname LIKE 'signal_listening_human_%' OR p.proname IN('signal_listening_effective_population_roots_v2','signal_listening_discovery_root_proofs_v1','signal_listening_discovery_root_proofs_before_human_v1')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
 END LOOP;
END $$;
