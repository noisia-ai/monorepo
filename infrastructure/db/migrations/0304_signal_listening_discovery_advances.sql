-- Scheduling and numerical custody for an ALREADY admitted discovery owner.
-- No provider, monetary ledger, policy, embedding or historical row is created.
CREATE FUNCTION signal_listening_discovery_human_revision_v1(cid uuid) RETURNS text LANGUAGE sql STABLE
SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(jsonb_build_object('contract_version','listening-discovery-human-revision-v1',
  'configuration_id',id,'revision',revision,'configuration_digest',configuration_digest,
  'instructions',configuration->'instructions','retired_question_keys',configuration->'retired_question_keys',
  'retired_theme_keys',configuration->'retired_theme_keys',
  'questions',(SELECT COALESCE(jsonb_agg(q ORDER BY q->>'key'),'[]'::jsonb) FROM jsonb_array_elements(configuration->'questions')q WHERE q->'human_locked'='true'::jsonb),
  'themes',(SELECT COALESCE(jsonb_agg(t ORDER BY t->>'key'),'[]'::jsonb) FROM jsonb_array_elements(configuration->'themes')t WHERE t->'human_locked'='true'::jsonb)))
 FROM signal_listening_configurations WHERE id=cid AND state='published'
$$;

-- Generation.round is a historical materialization counter, not the next
-- editorial ordinal. Explicit native initial/previous-round FKs are authority.
CREATE FUNCTION signal_listening_discovery_advance_source_v1(target uuid)
RETURNS TABLE(workspace_id uuid,actor_user_id uuid,map_id uuid,source_generation_id uuid,configuration_id uuid,
 classification_run_id uuid,next_ordinal integer,policy_version_id uuid,policy_digest text,human_revision_digest text,
 latest_round_id uuid,stop_decision jsonb)
LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT p.workspace_id,p.actor_user_id,p.map_id,g.id,g.configuration_id,child.id,COALESCE(last.ordinal,0)+1,p.policy_version_id,p.policy_digest,
 signal_listening_discovery_human_revision_v1(g.configuration_id),last.id,
 CASE WHEN last.id IS NULL AND(g.counts->>'category_roots')::integer=0 THEN '{"stop":true,"reason":"no_category_population"}'::jsonb
  ELSE '{"stop":false,"reason":"continue"}'::jsonb END
 FROM signal_listening_discovery_executions p
 LEFT JOIN LATERAL(SELECT r.* FROM signal_listening_discovery_rounds r WHERE r.execution_id=p.id AND r.workspace_id=p.workspace_id ORDER BY r.ordinal DESC LIMIT 1)last ON true
 JOIN signal_listening_discovery_generations g ON g.workspace_id=p.workspace_id AND g.id=COALESCE(last.output_generation_id,p.initial_generation_id)
 JOIN signal_labeling_runs child ON child.workspace_id=p.workspace_id AND child.id=COALESCE(last.classification_run_id,p.initial_classification_run_id)
 JOIN signal_listening_runs owner ON owner.run_id=child.id AND owner.workspace_id=p.workspace_id AND owner.configuration_id=g.configuration_id AND owner.map_id=p.map_id
 JOIN signal_processing_policy_versions policy ON policy.id=p.policy_version_id AND policy.organization_id=p.organization_id
 WHERE p.id=target AND p.status='active' AND policy.status='active' AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp()
 AND signal_processing_actor_v1(p.workspace_id,p.actor_user_id)
 AND EXISTS(SELECT 1 FROM signal_processing_policy_actions a WHERE a.policy_version_id=policy.id AND a.action='listening_discovery_review' AND a.configuration=signal_listening_discovery_review_configuration_v1())
 AND child.status='completed' AND child.actor_user_id=p.actor_user_id AND g.kind='confirmed_members' AND g.status='ready' AND g.map_id=p.map_id
 AND g.configuration_id=COALESCE(last.output_configuration_id,p.initial_configuration_id)
 AND COALESCE(signal_listening_discovery_current_v1(g.id),false)
 AND signal_listening_discovery_census_v1(g.id)=p.root_census_digest AND(g.counts->>'roots')::integer=p.root_count
 AND p.policy_digest=signal_labeling_digest_v1(jsonb_build_array('listening-discovery-policy-v1',0.7,0.6,0.8,20,10,0.01,3,8))
 -- Even an exactly exhausted parent must reach the locked budget-failure
 -- path; financial admission remains guarded by its immutable composite cap.
 AND(last.id IS NULL OR last.status='completed' AND last.ordinal<3 AND last.stop_decision='{"stop":false,"reason":"continue"}'::jsonb
  AND EXISTS(SELECT 1 FROM signal_listening_serving_snapshots s WHERE s.workspace_id=p.workspace_id AND s.execution_id=p.id AND s.round_id=last.id
   AND s.configuration_id=last.output_configuration_id AND s.generation_id=last.output_generation_id AND s.classification_run_id=last.classification_run_id))
 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_children c JOIN signal_labeling_calls call ON call.run_id=c.run_id AND call.workspace_id=c.workspace_id
  WHERE c.execution_id=p.id AND(call.status='unknown' OR call.terminal_exposure_micro_usd>0))
 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r JOIN engine_cost_events call ON call.listening_round_id=r.id
  WHERE r.execution_id=p.id AND call.workspace_contract='listening-discovery-round-v1' AND call.call_state='outcome_unknown')
$$;

CREATE TABLE signal_listening_discovery_advances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_user_id uuid NOT NULL,
 source_generation_id uuid NOT NULL,configuration_id uuid NOT NULL,next_ordinal integer NOT NULL CHECK(next_ordinal BETWEEN 1 AND 3),
 policy_version_id uuid NOT NULL REFERENCES signal_processing_policy_versions(id),policy_digest text NOT NULL,human_revision_digest text NOT NULL,
 source_digest text NOT NULL,root_census_digest text NOT NULL,execution_token uuid,execution_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(execution_id,next_ordinal),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_listening_discovery_executions(workspace_id,id),
 FOREIGN KEY(workspace_id,source_generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(workspace_id,configuration_id) REFERENCES signal_listening_configurations(workspace_id,id),
 CHECK((execution_token IS NULL)=(execution_expires_at IS NULL)),
 CHECK(policy_digest~'^sha256:[0-9a-f]{64}$' AND human_revision_digest~'^sha256:[0-9a-f]{64}$' AND source_digest~'^sha256:[0-9a-f]{64}$' AND root_census_digest~'^sha256:[0-9a-f]{64}$')
);
CREATE FUNCTION signal_listening_discovery_advance_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE source record;g signal_listening_discovery_generations;
BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND(to_jsonb(NEW)-ARRAY['execution_token','execution_expires_at','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['execution_token','execution_expires_at','updated_at']) THEN RAISE EXCEPTION 'listening_discovery_advance_immutable';END IF;
 IF TG_OP='UPDATE' AND OLD.execution_token IS NOT NULL AND OLD.execution_expires_at>clock_timestamp() THEN
  IF NEW.execution_token IS NOT NULL AND NEW.execution_token IS DISTINCT FROM OLD.execution_token THEN RAISE EXCEPTION 'listening_discovery_advance_lease_held';END IF;
 ELSE
  SELECT * INTO source FROM signal_listening_discovery_advance_source_v1(NEW.execution_id);
  SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.source_generation_id AND workspace_id=NEW.workspace_id;
  IF source.source_generation_id IS NULL OR source.stop_decision->'stop'<>'false'::jsonb
   OR ROW(NEW.workspace_id,NEW.actor_user_id,NEW.source_generation_id,NEW.configuration_id,NEW.next_ordinal,NEW.policy_version_id,NEW.policy_digest,NEW.human_revision_digest)
    IS DISTINCT FROM ROW(source.workspace_id,source.actor_user_id,source.source_generation_id,source.configuration_id,source.next_ordinal,source.policy_version_id,source.policy_digest,source.human_revision_digest)
   OR NEW.source_digest IS DISTINCT FROM g.snapshot_digest OR NEW.root_census_digest IS DISTINCT FROM signal_listening_discovery_census_v1(g.id)
   OR NEW.execution_token IS NULL THEN RAISE EXCEPTION 'listening_discovery_advance_source_invalid';END IF;
 END IF;
 IF NEW.execution_token IS NOT NULL AND(NEW.execution_expires_at<=clock_timestamp() OR NEW.execution_expires_at>clock_timestamp()+interval '300 seconds') THEN RAISE EXCEPTION 'listening_discovery_advance_lease_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_advance_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_advances FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_advance_guard_v1();

-- Bind a complete native subset without adding uniqueness to old snapshots.
CREATE TABLE signal_listening_discovery_subset_bindings(
 generation_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,subset_id uuid NOT NULL UNIQUE,created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(workspace_id,generation_id) REFERENCES signal_listening_discovery_generations(workspace_id,id),
 FOREIGN KEY(subset_id,generation_id) REFERENCES signal_listening_discovery_subsets(id,generation_id)
);
CREATE FUNCTION signal_listening_discovery_subset_complete_v1(sid uuid,gid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(s.status='ready' AND s.generation_id=gid AND s.workspace_id=g.workspace_id
 AND s.root_count=(SELECT count(*) FROM signal_listening_discovery_roots r WHERE r.generation_id=g.id AND r.proof->'in_category'='true'::jsonb
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.proof->'evaluations')e WHERE e->>'probability' IS NULL OR(e->>'probability')::double precision>=0.7))
 AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subset_roots chosen JOIN signal_listening_discovery_roots r ON r.generation_id=chosen.generation_id AND r.root_id=chosen.root_id
  WHERE chosen.subset_id=s.id AND(chosen.generation_id<>g.id OR chosen.proof_digest<>r.proof_digest OR r.proof->'in_category' IS DISTINCT FROM 'true'::jsonb
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.proof->'evaluations')e WHERE e->>'probability' IS NULL OR(e->>'probability')::double precision>=0.7)))
 AND s.root_count=(SELECT count(*) FROM signal_listening_discovery_subset_roots WHERE subset_id=s.id),false)
 FROM signal_listening_discovery_subsets s JOIN signal_listening_discovery_generations g ON g.id=gid AND g.workspace_id=s.workspace_id WHERE s.id=sid
$$;
CREATE FUNCTION signal_listening_discovery_subset_binding_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_discovery_history_immutable';END IF;
 PERFORM signal_processing_lock_actor_v1(NEW.workspace_id,NEW.created_by_user_id);
 IF NOT COALESCE(signal_listening_discovery_current_v1(NEW.generation_id),false) OR NOT COALESCE(signal_listening_discovery_subset_complete_v1(NEW.subset_id,NEW.generation_id),false)
 OR NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subsets s WHERE s.id=NEW.subset_id AND s.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'listening_discovery_subset_binding_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_subset_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_subset_bindings FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_subset_binding_guard_v1();

CREATE FUNCTION signal_listening_discovery_numeric_configuration_v1(roots bigint) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT jsonb_build_object('profile_version','workspace-bertopic-mass-labeling-v3','seed',17,'language_families',jsonb_build_array('pt','es','en'),
 'umap_n_neighbors',15,'umap_n_components',8,'umap_min_dist',0,'hdbscan_min_cluster_size',greatest(40,ceil(roots::numeric/1000)),'hdbscan_min_samples',5,
 'cluster_selection_method','eom','vectorizer_min_df',1,'vectorizer_max_df',1,'vectorizer_max_features',50000,'ngram_min',1,'ngram_max',3,'top_n_words',15,
 'guide_mix',0.25,'lineage_min_common_roots',2,'lineage_min_fraction',0.5,'memory_budget_bytes',4294967296::bigint,'maximum_topics',200,'representatives',30,
 'output_locale','pt-BR','guidance_policy','brand-competitors-category-corpus-centroids-v1','editorial_lane','guided-or-open-v1','fit_unit','canonical-root-centroid-v1',
 'minimum_editorial_roots',20,'vectorizer_min_df_unit','document-count','vectorizer_max_df_unit','document-proportion')
$$;
CREATE FUNCTION signal_listening_discovery_subset_proofs_v1(sid uuid) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_labeling_digest_v1(jsonb_build_object('subset_id',sid,'roots',COALESCE(jsonb_agg(jsonb_build_array(r.root_id,r.proof_digest,r.proof->'embedding_sha256') ORDER BY r.root_id),'[]'::jsonb)))
 FROM signal_listening_discovery_subset_roots chosen JOIN signal_listening_discovery_roots r ON r.generation_id=chosen.generation_id AND r.root_id=chosen.root_id WHERE chosen.subset_id=sid
$$;
CREATE TABLE signal_listening_discovery_numeric_checkpoints(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,advance_id uuid NOT NULL UNIQUE,execution_id uuid NOT NULL,generation_id uuid NOT NULL,subset_id uuid NOT NULL,
 numeric_config_digest text NOT NULL,manifest_json text NOT NULL,manifest_sha256 text NOT NULL,source_proofs_sha256 text NOT NULL,source_proofs_digest text NOT NULL,
 artifact_manifest jsonb NOT NULL,artifacts_digest text NOT NULL,planned_by_token uuid NOT NULL,
 verification_status text NOT NULL DEFAULT 'planned' CHECK(verification_status IN('planned','verified')),verified_at timestamptz,verification_token uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id),UNIQUE(advance_id,numeric_config_digest),
 FOREIGN KEY(workspace_id,advance_id) REFERENCES signal_listening_discovery_advances(workspace_id,id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES signal_listening_discovery_executions(workspace_id,id),
 FOREIGN KEY(subset_id,generation_id) REFERENCES signal_listening_discovery_subsets(id,generation_id),
 CHECK(octet_length(manifest_json) BETWEEN 1 AND 33554432 AND manifest_sha256='sha256:'||encode(sha256(convert_to(manifest_json,'UTF8')),'hex')),
 CHECK(jsonb_typeof(artifact_manifest)='array' AND jsonb_array_length(artifact_manifest) BETWEEN 2 AND 64 AND artifacts_digest=signal_labeling_digest_v1(artifact_manifest)),
 CHECK((verification_status='verified')=(verified_at IS NOT NULL)),CHECK((verification_status='verified')=(verification_token IS NOT NULL))
);
CREATE TABLE signal_listening_discovery_numeric_artifacts(
 checkpoint_id uuid NOT NULL,workspace_id uuid NOT NULL,name text NOT NULL,storage_key text NOT NULL,sha256 text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>=0 AND size_bytes<=9007199254740991),
 PRIMARY KEY(checkpoint_id,name),FOREIGN KEY(workspace_id,checkpoint_id) REFERENCES signal_listening_discovery_numeric_checkpoints(workspace_id,id),
 CHECK(name~'^(numeric-manifest\.json|source-proofs\.jsonl|(input|output)/[a-z0-9][a-z0-9_.-]{0,100})$' AND position('..' IN name)=0),
 CHECK(sha256~'^sha256:[0-9a-f]{64}$'),CHECK(length(storage_key)<=512 AND position('..' IN storage_key)=0 AND storage_key~'^workspace-engine/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,200}$')
);

CREATE FUNCTION signal_listening_discovery_numeric_groups_v1(sid uuid,payload jsonb) RETURNS boolean LANGUAGE plpgsql STABLE
SET search_path=public,extensions,pg_temp AS $$
DECLARE s signal_listening_discovery_subsets;grp jsonb;ids uuid[];representatives uuid[];all_ids uuid[]:='{}';keys text[]:='{}';group_digest text;grouped bigint:=0;
BEGIN
 SELECT * INTO s FROM signal_listening_discovery_subsets WHERE id=sid AND status='ready';
 IF s.id IS NULL OR jsonb_typeof(payload->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'groups')>200
  OR jsonb_typeof(payload->'group_digests') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 FOR grp IN SELECT value FROM jsonb_array_elements(payload->'groups') LOOP
  IF jsonb_typeof(grp) IS DISTINCT FROM 'object' OR grp-ARRAY['group_key','root_count','root_ids','terms','representative_root_ids']<>'{}'::jsonb
   OR jsonb_typeof(grp->'root_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(grp->'representative_root_ids') IS DISTINCT FROM 'array'
   OR jsonb_typeof(grp->'terms') IS DISTINCT FROM 'array' OR jsonb_array_length(grp->'terms')>40
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(grp->'terms') t WHERE jsonb_typeof(t)<>'string' OR length(t#>>'{}') NOT BETWEEN 1 AND 160)
   OR grp->>'group_key'=ANY(keys) THEN RETURN false;END IF;
  SELECT array_agg(value::uuid ORDER BY value) INTO ids FROM jsonb_array_elements_text(grp->'root_ids');
  SELECT array_agg(value::uuid ORDER BY value) INTO representatives FROM jsonb_array_elements_text(grp->'representative_root_ids');
  IF cardinality(ids) IS DISTINCT FROM(grp->>'root_count')::integer OR cardinality(ids)<greatest(40,ceil(s.cached_count::numeric/1000))
   OR cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) t(id)) OR ids&&all_ids
   OR cardinality(representatives) NOT BETWEEN 20 AND 40 OR cardinality(representatives)<>(SELECT count(DISTINCT id) FROM unnest(representatives)t(id))
   OR NOT representatives<@ids OR EXISTS(SELECT 1 FROM unnest(ids)t(id) WHERE NOT EXISTS(
    SELECT 1 FROM signal_listening_discovery_subset_roots chosen JOIN signal_listening_discovery_roots r ON r.generation_id=chosen.generation_id AND r.root_id=chosen.root_id
    WHERE chosen.subset_id=s.id AND r.root_id=t.id AND r.proof->>'embedding_call_id' IS NOT NULL)) THEN RETURN false;END IF;
  group_digest:=signal_labeling_digest_v1(jsonb_build_object('subset_id',s.id,'root_ids',to_jsonb(ids)));
  IF payload->'group_digests'->> (grp->>'group_key') IS DISTINCT FROM group_digest OR grp->>'group_key' IS DISTINCT FROM 'orphan_'||substring(group_digest FROM 8 FOR 56) THEN RETURN false;END IF;
  keys:=array_append(keys,grp->>'group_key');all_ids:=all_ids||ids;grouped:=grouped+cardinality(ids);
 END LOOP;
 RETURN grouped=(payload->>'grouped_count')::bigint AND grouped<=s.cached_count AND(payload->>'unclustered_count')::bigint=s.root_count-grouped
  AND(SELECT count(*) FROM jsonb_object_keys(payload->'group_digests'))=cardinality(keys)
  AND(payload->>'status'='completed' OR grouped=0);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE FUNCTION signal_listening_discovery_numeric_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE h signal_listening_discovery_advances;s signal_listening_discovery_subsets;g signal_listening_discovery_generations;m jsonb;marker jsonb;source record;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'listening_discovery_numeric_immutable';END IF;
 SELECT * INTO h FROM signal_listening_discovery_advances WHERE id=NEW.advance_id AND workspace_id=NEW.workspace_id;
 IF TG_OP='UPDATE' THEN
  SELECT * INTO source FROM signal_listening_discovery_advance_source_v1(NEW.execution_id);
  marker:=NULLIF(current_setting('noisia.listening_discovery_numeric_verification_v1',true),'')::jsonb;
  IF(to_jsonb(NEW)-ARRAY['verification_status','verified_at','verification_token']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['verification_status','verified_at','verification_token'])
   OR OLD.verification_status<>'planned' OR NEW.verification_status<>'verified' OR NEW.verified_at IS NULL
   OR source.source_generation_id IS NULL OR source.stop_decision->'stop'<>'false'::jsonb
   OR ROW(h.workspace_id,h.actor_user_id,h.source_generation_id,h.configuration_id,h.next_ordinal,h.policy_version_id,h.policy_digest,h.human_revision_digest)
    IS DISTINCT FROM ROW(source.workspace_id,source.actor_user_id,source.source_generation_id,source.configuration_id,source.next_ordinal,source.policy_version_id,source.policy_digest,source.human_revision_digest)
   OR h.execution_token IS NULL OR NEW.verification_token IS DISTINCT FROM h.execution_token OR h.execution_expires_at<=clock_timestamp()
   OR marker IS DISTINCT FROM jsonb_build_object('contract_version','listening-discovery-numeric-verification-v1','checkpoint_id',NEW.id,'execution_token',h.execution_token,'manifest_sha256',NEW.manifest_sha256,'artifacts_digest',NEW.artifacts_digest)
   THEN RAISE EXCEPTION 'listening_discovery_numeric_immutable';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO source FROM signal_listening_discovery_advance_source_v1(NEW.execution_id);
 SELECT * INTO s FROM signal_listening_discovery_subsets WHERE id=NEW.subset_id AND workspace_id=NEW.workspace_id AND generation_id=NEW.generation_id;
 SELECT * INTO g FROM signal_listening_discovery_generations WHERE id=NEW.generation_id AND workspace_id=NEW.workspace_id;
 m:=NEW.manifest_json::jsonb;
 marker:=NULLIF(current_setting('noisia.listening_discovery_numeric_staging_v1',true),'')::jsonb;
 IF h.id IS NULL OR s.id IS NULL OR g.id IS NULL OR source.source_generation_id IS NULL OR source.stop_decision->'stop'<>'false'::jsonb
  OR marker IS DISTINCT FROM jsonb_build_object('contract_version','listening-discovery-numeric-staging-v1','checkpoint_id',NEW.id,'execution_token',h.execution_token,'manifest_sha256',NEW.manifest_sha256,'artifacts_digest',NEW.artifacts_digest)
  OR ROW(h.execution_id,h.source_generation_id,h.next_ordinal,h.policy_version_id,h.policy_digest,h.human_revision_digest)
   IS DISTINCT FROM ROW(NEW.execution_id,NEW.generation_id,source.next_ordinal,source.policy_version_id,source.policy_digest,source.human_revision_digest)
  OR h.source_digest IS DISTINCT FROM g.snapshot_digest OR h.execution_token IS DISTINCT FROM NEW.planned_by_token OR h.execution_expires_at<=clock_timestamp()
  OR NEW.verification_status<>'planned' OR NEW.verified_at IS NOT NULL OR NEW.verification_token IS NOT NULL
  OR NOT COALESCE(signal_listening_discovery_subset_complete_v1(s.id,g.id),false)
  OR NOT EXISTS(SELECT 1 FROM signal_listening_discovery_subset_bindings b WHERE b.generation_id=g.id AND b.workspace_id=NEW.workspace_id AND b.subset_id=s.id)
  OR NEW.source_proofs_digest IS DISTINCT FROM signal_listening_discovery_subset_proofs_v1(s.id)
  OR m->>'contract_version' IS DISTINCT FROM 'listening-orphan-numeric-v1' OR m->>'workspace_id' IS DISTINCT FROM NEW.workspace_id::text
  OR m-ARRAY['contract_version','workspace_id','generation_id','generation_digest','subset_id','subset_digest','source_proofs_sha256','root_count','cached_count','uncached_count','grouped_count','unclustered_count','status','numeric_config','numeric_config_digest','input_manifest_sha256','output_manifest_sha256','groups','group_digests']<>'{}'::jsonb
  OR m->>'generation_id' IS DISTINCT FROM g.id::text OR m->>'generation_digest' IS DISTINCT FROM g.snapshot_digest
  OR m->>'subset_id' IS DISTINCT FROM s.id::text OR m->>'subset_digest' IS DISTINCT FROM s.subset_digest
  OR(m->>'root_count')::integer IS DISTINCT FROM s.root_count OR(m->>'cached_count')::integer IS DISTINCT FROM s.cached_count
  OR(m->>'uncached_count')::integer IS DISTINCT FROM s.root_count-s.cached_count
  OR m->'numeric_config' IS DISTINCT FROM signal_listening_discovery_numeric_configuration_v1(s.cached_count)
  OR NEW.numeric_config_digest IS DISTINCT FROM signal_labeling_digest_v1(m->'numeric_config') OR m->>'numeric_config_digest' IS DISTINCT FROM NEW.numeric_config_digest
  OR NEW.source_proofs_sha256!~'^sha256:[0-9a-f]{64}$' OR m->>'source_proofs_sha256' IS DISTINCT FROM NEW.source_proofs_sha256
  OR NOT COALESCE(signal_listening_discovery_numeric_groups_v1(s.id,m),false)
  OR s.cached_count=0 AND(m->>'status' IS DISTINCT FROM CASE WHEN s.root_count=0 THEN 'empty' ELSE 'no_cached_vectors' END
   OR m->'input_manifest_sha256' IS DISTINCT FROM 'null'::jsonb OR m->'output_manifest_sha256' IS DISTINCT FROM 'null'::jsonb OR jsonb_array_length(NEW.artifact_manifest)<>2)
  OR s.cached_count>0 AND(COALESCE(m->>'status','') NOT IN('completed','insufficient_population') OR COALESCE(m->>'input_manifest_sha256','')!~'^sha256:[0-9a-f]{64}$' OR COALESCE(m->>'output_manifest_sha256','')!~'^sha256:[0-9a-f]{64}$')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.artifact_manifest) a WHERE jsonb_typeof(a)<>'object' OR a-ARRAY['name','storage_key','sha256','size_bytes']<>'{}'::jsonb OR(SELECT count(*) FROM jsonb_object_keys(a))<>4)
  OR NOT NEW.artifact_manifest @> jsonb_build_array(jsonb_build_object('name','numeric-manifest.json','sha256',NEW.manifest_sha256,'size_bytes',octet_length(NEW.manifest_json)))
  OR NOT NEW.artifact_manifest @> jsonb_build_array(jsonb_build_object('name','source-proofs.jsonl','sha256',NEW.source_proofs_sha256))
  OR s.root_count=0 AND(NEW.source_proofs_sha256<>'sha256:'||encode(sha256(''::bytea),'hex') OR NOT NEW.artifact_manifest @> '[{"name":"source-proofs.jsonl","size_bytes":0}]'::jsonb)
  OR s.cached_count>0 AND(NOT NEW.artifact_manifest @> jsonb_build_array(jsonb_build_object('name','input/manifest.json','sha256',m->>'input_manifest_sha256'),jsonb_build_object('name','output/manifest.json','sha256',m->>'output_manifest_sha256'),jsonb_build_object('name','input/source-proofs.jsonl','sha256',NEW.source_proofs_sha256))
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['input/chunks.jsonl','input/vectors.npy','input/guides.jsonl','input/guide-vectors.npy','output/assignments.open.jsonl']) required(name)
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.artifact_manifest) a WHERE a->>'name'=required.name)))
  THEN RAISE EXCEPTION 'listening_discovery_numeric_source_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_numeric_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_numeric_checkpoints FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_numeric_guard_v1();
CREATE FUNCTION signal_listening_discovery_numeric_artifact_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_listening_discovery_numeric_checkpoints;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_discovery_numeric_immutable';END IF;
 SELECT * INTO c FROM signal_listening_discovery_numeric_checkpoints WHERE id=NEW.checkpoint_id AND workspace_id=NEW.workspace_id;
 IF c.id IS NULL OR c.verification_status<>'planned' OR NOT c.artifact_manifest @> jsonb_build_array(to_jsonb(NEW)-ARRAY['checkpoint_id','workspace_id'])
  OR NEW.storage_key NOT LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||c.id::text||'/%' THEN RAISE EXCEPTION 'listening_discovery_numeric_artifact_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_listening_discovery_numeric_artifact_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_listening_discovery_numeric_artifacts FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_numeric_artifact_guard_v1();
CREATE FUNCTION signal_listening_discovery_numeric_complete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE c signal_listening_discovery_numeric_checkpoints;h signal_listening_discovery_advances;
BEGIN
 SELECT * INTO c FROM signal_listening_discovery_numeric_checkpoints WHERE id=NEW.id;
 SELECT * INTO h FROM signal_listening_discovery_advances WHERE id=c.advance_id AND workspace_id=c.workspace_id;
 IF(SELECT count(*) FROM signal_listening_discovery_numeric_artifacts WHERE checkpoint_id=c.id)<>jsonb_array_length(c.artifact_manifest)
  OR h.execution_token IS DISTINCT FROM(CASE WHEN c.verification_status='verified' THEN c.verification_token ELSE c.planned_by_token END) OR h.execution_expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'listening_discovery_numeric_artifacts_incomplete';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_discovery_numeric_complete AFTER INSERT OR UPDATE ON signal_listening_discovery_numeric_checkpoints DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_numeric_complete_v1();

ALTER TABLE signal_listening_discovery_rounds ADD COLUMN advance_id uuid,ADD COLUMN advance_token uuid,
 ADD CONSTRAINT signal_listening_discovery_advance_token_shape CHECK((advance_id IS NULL)=(advance_token IS NULL)),
 ADD CONSTRAINT signal_listening_discovery_round_advance FOREIGN KEY(workspace_id,advance_id) REFERENCES signal_listening_discovery_advances(workspace_id,id);
CREATE UNIQUE INDEX signal_listening_discovery_one_round_per_advance ON signal_listening_discovery_rounds(advance_id) WHERE advance_id IS NOT NULL;
CREATE FUNCTION signal_listening_discovery_advance_round_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE h signal_listening_discovery_advances;c signal_listening_discovery_numeric_checkpoints;source record;marker jsonb;groups jsonb;
BEGIN
 IF NEW.advance_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO h FROM signal_listening_discovery_advances WHERE id=NEW.advance_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO c FROM signal_listening_discovery_numeric_checkpoints WHERE advance_id=h.id AND workspace_id=h.workspace_id AND verification_status='verified';
 SELECT * INTO source FROM signal_listening_discovery_advance_source_v1(h.execution_id);
 marker:=NULLIF(current_setting('noisia.listening_discovery_advance_enqueue_v1',true),'')::jsonb;
 SELECT COALESCE(jsonb_agg(value-'root_ids'),'[]'::jsonb) INTO groups FROM jsonb_array_elements(c.manifest_json::jsonb->'groups');
 IF h.id IS NULL OR c.id IS NULL OR source.source_generation_id IS NULL OR source.stop_decision->'stop'<>'false'::jsonb
  OR h.execution_token IS NULL OR NEW.advance_token IS DISTINCT FROM h.execution_token OR h.execution_expires_at<=clock_timestamp()
  OR marker IS DISTINCT FROM jsonb_build_object('contract_version','listening-discovery-advance-enqueue-v1','advance_id',h.id,'execution_token',h.execution_token,'checkpoint_id',c.id,'manifest_sha256',c.manifest_sha256)
  OR ROW(NEW.execution_id,NEW.ordinal,NEW.input_generation_id,NEW.configuration_id,NEW.source_digest)
   IS DISTINCT FROM ROW(h.execution_id,h.next_ordinal,h.source_generation_id,h.configuration_id,h.source_digest)
  OR ROW(h.next_ordinal,h.source_generation_id,h.policy_version_id,h.policy_digest,h.human_revision_digest)
   IS DISTINCT FROM ROW(source.next_ordinal,source.source_generation_id,source.policy_version_id,source.policy_digest,source.human_revision_digest)
  OR NEW.quote->'orphan_groups' IS DISTINCT FROM c.manifest_json::jsonb->'groups'
  OR(SELECT COALESCE(jsonb_agg(value-'examples'),'[]'::jsonb) FROM jsonb_array_elements(((NEW.request_body::jsonb#>>'{messages,0,content}')::jsonb)->'orphan_groups')) IS DISTINCT FROM groups
  THEN RAISE EXCEPTION 'listening_discovery_advance_enqueue_invalid';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aab_listening_discovery_advance_round BEFORE INSERT ON signal_listening_discovery_rounds FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_advance_round_guard_v1();
CREATE FUNCTION signal_listening_discovery_advance_admitted_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.advance_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_advances h
  WHERE h.id=NEW.advance_id AND h.workspace_id=NEW.workspace_id AND h.execution_id=NEW.execution_id AND h.execution_token=NEW.advance_token AND h.execution_expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'listening_discovery_advance_lease_lost';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER signal_listening_discovery_advance_admitted AFTER INSERT ON signal_listening_discovery_rounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION signal_listening_discovery_advance_admitted_v1();
CREATE FUNCTION signal_listening_discovery_advance_no_truncate_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'listening_discovery_history_immutable';END $$;
DO $$DECLARE name text;role_name text;BEGIN
 FOREACH name IN ARRAY ARRAY['signal_listening_discovery_advances','signal_listening_discovery_subset_bindings','signal_listening_discovery_numeric_checkpoints','signal_listening_discovery_numeric_artifacts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);
  EXECUTE format('CREATE TRIGGER retain_discovery_advance_history BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION signal_listening_discovery_advance_no_truncate_v1()',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',name,role_name);END IF;END LOOP;
 END LOOP;
 FOR name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'signal_listening_discovery_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||name||' FROM PUBLIC';
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',name,role_name);END IF;END LOOP;
 END LOOP;
END $$;
