-- C2: versioned consolidation of the complete atomic BERTopic census.
-- Numerical artifacts remain the authority for vectors and sealed output. This
-- migration stores references, compact dossiers, editorial disposition and
-- reversible lineage; it does not change the active Signal generation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE signal_topic_consolidation_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  source_engine_execution_id uuid NOT NULL,
  source_checkpoint_digest text NOT NULL CHECK(source_checkpoint_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact_key text NOT NULL CHECK(artifact_key ~ '^centroids\.consolidation\.[0-9a-f]{16}\.json$'),
  storage_key text NOT NULL CHECK(octet_length(storage_key) BETWEEN 1 AND 1024),
  sha256 text NOT NULL CHECK(sha256 ~ '^sha256:[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK(size_bytes>0),
  media_type text NOT NULL CHECK(media_type='application/json'),
  metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,source_engine_execution_id,artifact_key),
  UNIQUE(id,workspace_id),
  FOREIGN KEY(workspace_id,source_engine_execution_id)
    REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION signal_topic_consolidation_artifact_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source signal_topic_catalog_executions%ROWTYPE; checkpoint jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'signal_topic_consolidation_history_retained' USING ERRCODE='55000';
  END IF;
  SELECT * INTO source FROM signal_topic_catalog_executions WHERE id=NEW.source_engine_execution_id
    AND workspace_id=NEW.workspace_id FOR SHARE;
  checkpoint:=source.result_summary->'fit_checkpoint';
  IF source.id IS NULL OR source.input_contract IS DISTINCT FROM 'workspace-topic-engine-v1'
    OR checkpoint->>'checkpoint_digest' IS DISTINCT FROM NEW.source_checkpoint_digest
    OR NEW.storage_key NOT LIKE 'workspace-engine/'||NEW.workspace_id::text||'/'||NEW.source_engine_execution_id::text||'/%'
    OR NEW.metadata->>'contract_version' IS DISTINCT FROM 'signal-topic-centroid-artifact-v1'
    OR NEW.metadata->>'source_checkpoint_digest' IS DISTINCT FROM NEW.source_checkpoint_digest
    OR NOT COALESCE(NEW.metadata->>'centroid_set_digest' ~ '^sha256:[0-9a-f]{64}$',false)
    OR COALESCE((NEW.metadata->>'centroid_count')::integer,0)<=0
    OR NEW.metadata->>'dimensions' IS DISTINCT FROM '1024'
    OR NEW.metadata->>'aggregation' IS DISTINCT FROM 'normalized-mean-document-embeddings-v1' THEN
    RAISE EXCEPTION 'signal_topic_consolidation_centroid_artifact_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_signal_topic_consolidation_artifact_guard BEFORE INSERT OR UPDATE OR DELETE
ON signal_topic_consolidation_artifacts FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_artifact_guard_v1();

CREATE TABLE signal_topic_consolidation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  source_engine_execution_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_checkpoint_digest text NOT NULL CHECK(source_checkpoint_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_artifact_id uuid NOT NULL,
  output_artifact_sha256 text NOT NULL CHECK(output_artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  model_artifact_id uuid NOT NULL,
  model_artifact_sha256 text NOT NULL CHECK(model_artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  centroid_artifact_id uuid,
  centroid_artifact_sha256 text CHECK(centroid_artifact_sha256 IS NULL OR centroid_artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  context_digest text NOT NULL CHECK(context_digest ~ '^sha256:[0-9a-f]{64}$'),
  census_digest text NOT NULL CHECK(census_digest ~ '^sha256:[0-9a-f]{64}$'),
  configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object' AND octet_length(configuration::text)<=65536),
  configuration_digest text NOT NULL CHECK(configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_group_count integer NOT NULL CHECK(expected_group_count>0),
  community_plan_digest text CHECK(community_plan_digest IS NULL OR community_plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'building' CHECK(status IN('building','census_ready','ready_for_review','reviewing','validated','failed','superseded')),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(workspace_id,source_engine_execution_id,configuration_digest),
  UNIQUE(id,workspace_id,source_engine_execution_id),
  FOREIGN KEY(workspace_id,source_engine_execution_id)
    REFERENCES signal_topic_catalog_executions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(output_artifact_id,workspace_id)
    REFERENCES analysis_artifacts(id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(model_artifact_id,workspace_id)
    REFERENCES analysis_artifacts(id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(centroid_artifact_id,workspace_id)
    REFERENCES signal_topic_consolidation_artifacts(id,workspace_id) ON DELETE RESTRICT,
  CHECK((centroid_artifact_id IS NULL)=(centroid_artifact_sha256 IS NULL)),
  CONSTRAINT signal_topic_consolidation_run_failure CHECK(
    (status='failed' AND NULLIF(btrim(failure_code),'') IS NOT NULL)
    OR (status<>'failed' AND failure_code IS NULL)
  )
);

CREATE TABLE signal_topic_atomic_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consolidation_run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  source_engine_execution_id uuid NOT NULL,
  group_key text NOT NULL CHECK(group_key ~ '^(open|guided):[A-Za-z0-9_.:-]{1,180}$'),
  lane text NOT NULL CHECK(lane IN('open','guided')),
  stable_cluster_id text NOT NULL CHECK(octet_length(stable_cluster_id)>0 AND octet_length(stable_cluster_id)<=256),
  local_label integer NOT NULL CHECK(local_label>=0),
  group_digest text NOT NULL CHECK(group_digest ~ '^sha256:[0-9a-f]{64}$'),
  root_count integer NOT NULL CHECK(root_count>0),
  chunk_count integer NOT NULL CHECK(chunk_count>=root_count),
  terms text[] NOT NULL DEFAULT '{}'::text[] CHECK(cardinality(terms)<=64),
  dossier jsonb NOT NULL CHECK(jsonb_typeof(dossier)='object' AND dossier->>'contract_version'='signal-topic-group-dossier-v1' AND octet_length(dossier::text)<=131072),
  dossier_digest text NOT NULL CHECK(dossier_digest ~ '^sha256:[0-9a-f]{64}$'),
  centroid_artifact_id uuid,
  centroid_key text,
  centroid_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(consolidation_run_id,group_key),
  UNIQUE(consolidation_run_id,lane,local_label),
  UNIQUE(id,consolidation_run_id,workspace_id),
  FOREIGN KEY(consolidation_run_id,workspace_id,source_engine_execution_id)
    REFERENCES signal_topic_consolidation_runs(id,workspace_id,source_engine_execution_id) ON DELETE CASCADE,
  FOREIGN KEY(centroid_artifact_id,workspace_id)
    REFERENCES signal_topic_consolidation_artifacts(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_atomic_group_lane_key CHECK(group_key=lane||':'||stable_cluster_id),
  CONSTRAINT signal_topic_atomic_group_centroid CHECK(
    (centroid_artifact_id IS NULL AND centroid_key IS NULL AND centroid_digest IS NULL)
    OR (centroid_artifact_id IS NOT NULL AND NULLIF(btrim(centroid_key),'') IS NOT NULL
      AND centroid_digest ~ '^sha256:[0-9a-f]{64}$')
  )
);

CREATE TABLE signal_topic_atomic_group_roots (
  atomic_group_id uuid NOT NULL,
  consolidation_run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  canonical_root_id uuid NOT NULL,
  chunk_count integer NOT NULL CHECK(chunk_count>0),
  strength double precision CHECK(strength IS NULL OR strength BETWEEN 0 AND 1),
  assignment_digest text NOT NULL CHECK(assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(atomic_group_id,canonical_root_id),
  UNIQUE(atomic_group_id,canonical_root_id,consolidation_run_id,workspace_id),
  FOREIGN KEY(atomic_group_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_atomic_groups(id,consolidation_run_id,workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,canonical_root_id)
    REFERENCES mentions(workspace_id,id) ON DELETE RESTRICT
);

CREATE TABLE signal_topic_atomic_group_evidence (
  atomic_group_id uuid NOT NULL,
  canonical_root_id uuid NOT NULL,
  consolidation_run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  evidence_ordinal smallint NOT NULL CHECK(evidence_ordinal BETWEEN 0 AND 9),
  ref_id text NOT NULL CHECK(ref_id ~ '^sha256:[0-9a-f]{64}$'),
  chunk_index integer NOT NULL CHECK(chunk_index>=0),
  start_offset integer NOT NULL CHECK(start_offset>=0),
  end_offset integer NOT NULL CHECK(end_offset>start_offset),
  chunk_sha256 text NOT NULL CHECK(chunk_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  locale text CHECK(locale IS NULL OR octet_length(locale) BETWEEN 1 AND 35),
  platform text CHECK(platform IS NULL OR octet_length(platform) BETWEEN 1 AND 100),
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(atomic_group_id,evidence_ordinal),
  UNIQUE(atomic_group_id,ref_id),
  FOREIGN KEY(atomic_group_id,canonical_root_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_atomic_group_roots(atomic_group_id,canonical_root_id,consolidation_run_id,workspace_id) ON DELETE CASCADE
);

CREATE TABLE signal_topic_consolidation_communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consolidation_run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  source_engine_execution_id uuid NOT NULL,
  community_key text NOT NULL CHECK(octet_length(community_key) BETWEEN 1 AND 256),
  community_digest text NOT NULL CHECK(community_digest ~ '^sha256:[0-9a-f]{64}$'),
  configuration_digest text NOT NULL CHECK(configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(consolidation_run_id,community_key),
  UNIQUE(id,consolidation_run_id,workspace_id),
  FOREIGN KEY(consolidation_run_id,workspace_id,source_engine_execution_id)
    REFERENCES signal_topic_consolidation_runs(id,workspace_id,source_engine_execution_id) ON DELETE CASCADE
);

CREATE TABLE signal_topic_consolidation_community_members (
  community_id uuid NOT NULL,
  atomic_group_id uuid NOT NULL,
  consolidation_run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  rank integer NOT NULL CHECK(rank>=0),
  similarity double precision NOT NULL CHECK(similarity BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(community_id,atomic_group_id),
  UNIQUE(consolidation_run_id,atomic_group_id),
  UNIQUE(community_id,rank),
  FOREIGN KEY(community_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_consolidation_communities(id,consolidation_run_id,workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(atomic_group_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_atomic_groups(id,consolidation_run_id,workspace_id) ON DELETE CASCADE
);

CREATE TABLE signal_topic_consolidation_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consolidation_run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  source_engine_execution_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','validated','superseded')),
  parent_revision_id uuid,
  revision_digest text CHECK(revision_digest IS NULL OR revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  validated_at timestamptz,
  UNIQUE(consolidation_run_id,revision),
  UNIQUE(id,consolidation_run_id,workspace_id),
  FOREIGN KEY(consolidation_run_id,workspace_id,source_engine_execution_id)
    REFERENCES signal_topic_consolidation_runs(id,workspace_id,source_engine_execution_id) ON DELETE CASCADE,
  FOREIGN KEY(parent_revision_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_consolidation_revisions(id,consolidation_run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_consolidation_revision_state CHECK(
    (status='draft' AND revision_digest IS NULL AND validated_at IS NULL)
    OR (status IN('validated','superseded') AND revision_digest IS NOT NULL AND validated_at IS NOT NULL)
  )
);

CREATE TABLE signal_topic_editorial_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL,
  consolidation_run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  concept_key text NOT NULL CHECK(octet_length(concept_key) BETWEEN 1 AND 256),
  kind text NOT NULL CHECK(kind IN('topic','narrative')),
  label text NOT NULL CHECK(octet_length(btrim(label)) BETWEEN 1 AND 500),
  definition text NOT NULL CHECK(octet_length(btrim(definition)) BETWEEN 1 AND 4000),
  locale text NOT NULL CHECK(octet_length(locale) BETWEEN 1 AND 35),
  source text NOT NULL CHECK(source IN('numeric','model','human')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=32768),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(revision_id,concept_key),
  UNIQUE(id,revision_id,consolidation_run_id,workspace_id),
  FOREIGN KEY(revision_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_consolidation_revisions(id,consolidation_run_id,workspace_id) ON DELETE CASCADE
);

CREATE TABLE signal_topic_consolidation_decisions (
  revision_id uuid NOT NULL,
  atomic_group_id uuid NOT NULL,
  consolidation_run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  disposition text NOT NULL CHECK(disposition IN('topic','narrative','noise','unresolved')),
  concept_id uuid,
  source text NOT NULL CHECK(source IN('numeric','model','human')),
  confidence double precision CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  rationale text CHECK(rationale IS NULL OR octet_length(rationale)<=4000),
  decision_digest text NOT NULL CHECK(decision_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(revision_id,atomic_group_id),
  FOREIGN KEY(revision_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_consolidation_revisions(id,consolidation_run_id,workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(atomic_group_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_atomic_groups(id,consolidation_run_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(concept_id,revision_id,consolidation_run_id,workspace_id)
    REFERENCES signal_topic_editorial_concepts(id,revision_id,consolidation_run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_consolidation_decision_target CHECK(
    (disposition IN('topic','narrative') AND concept_id IS NOT NULL)
    OR (disposition IN('noise','unresolved') AND concept_id IS NULL)
  )
);

CREATE INDEX idx_signal_topic_atomic_groups_run ON signal_topic_atomic_groups(consolidation_run_id,group_key);
CREATE INDEX idx_signal_topic_atomic_roots_root ON signal_topic_atomic_group_roots(workspace_id,canonical_root_id,consolidation_run_id);
CREATE INDEX idx_signal_topic_atomic_evidence_root ON signal_topic_atomic_group_evidence(workspace_id,canonical_root_id,consolidation_run_id);
CREATE INDEX idx_signal_topic_concepts_revision ON signal_topic_editorial_concepts(revision_id,kind,concept_key);
CREATE INDEX idx_signal_topic_decisions_disposition ON signal_topic_consolidation_decisions(revision_id,disposition,concept_id);
CREATE UNIQUE INDEX uq_signal_topic_consolidation_validated_revision
  ON signal_topic_consolidation_revisions(consolidation_run_id) WHERE status='validated';

CREATE FUNCTION signal_topic_consolidation_run_source_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source signal_topic_catalog_executions%ROWTYPE; output analysis_artifacts%ROWTYPE; model analysis_artifacts%ROWTYPE;
DECLARE centroid signal_topic_consolidation_artifacts%ROWTYPE; checkpoint jsonb;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.workspace_id,NEW.source_engine_execution_id,NEW.actor_user_id,NEW.source_checkpoint_digest,
    NEW.output_artifact_id,NEW.output_artifact_sha256,NEW.model_artifact_id,NEW.model_artifact_sha256,
    NEW.centroid_artifact_id,NEW.centroid_artifact_sha256,NEW.context_digest,
    NEW.census_digest,NEW.configuration,NEW.configuration_digest,NEW.expected_group_count,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.source_engine_execution_id,OLD.actor_user_id,OLD.source_checkpoint_digest,
    OLD.output_artifact_id,OLD.output_artifact_sha256,OLD.model_artifact_id,OLD.model_artifact_sha256,
    OLD.centroid_artifact_id,OLD.centroid_artifact_sha256,OLD.context_digest,
    OLD.census_digest,OLD.configuration,OLD.configuration_digest,OLD.expected_group_count,OLD.created_at) THEN
    RAISE EXCEPTION 'signal_topic_consolidation_run_identity_frozen' USING ERRCODE='23514';
  END IF;
  SELECT * INTO source FROM signal_topic_catalog_executions
   WHERE id=NEW.source_engine_execution_id AND workspace_id=NEW.workspace_id FOR SHARE;
  IF source.id IS NULL OR source.input_contract IS DISTINCT FROM 'workspace-topic-engine-v1'
    OR NOT (source.result_summary ? 'fit_checkpoint') THEN
    RAISE EXCEPTION 'signal_topic_consolidation_source_invalid' USING ERRCODE='23514';
  END IF;
  checkpoint:=source.result_summary->'fit_checkpoint';
  SELECT * INTO output FROM analysis_artifacts WHERE id=NEW.output_artifact_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO model FROM analysis_artifacts WHERE id=NEW.model_artifact_id AND workspace_id=NEW.workspace_id;
  IF NEW.centroid_artifact_id IS NOT NULL THEN
    SELECT * INTO centroid FROM signal_topic_consolidation_artifacts WHERE id=NEW.centroid_artifact_id AND workspace_id=NEW.workspace_id;
  END IF;
  IF checkpoint->>'checkpoint_digest' IS DISTINCT FROM NEW.source_checkpoint_digest
    OR checkpoint->>'output_artifact_id' IS DISTINCT FROM NEW.output_artifact_id::text
    OR checkpoint->>'model_artifact_id' IS DISTINCT FROM NEW.model_artifact_id::text
    OR (checkpoint->'interpretation_manifest'->>'unit_count')::integer IS DISTINCT FROM NEW.expected_group_count
    OR source.input_snapshot->>'context_digest' IS DISTINCT FROM NEW.context_digest
    OR output.engine_execution_id IS DISTINCT FROM source.id OR output.artifact_type IS DISTINCT FROM 'engine_output'
    OR output.content->>'sha256' IS DISTINCT FROM NEW.output_artifact_sha256
    OR model.engine_execution_id IS DISTINCT FROM source.id OR model.artifact_type IS DISTINCT FROM 'engine_model'
    OR model.content->>'sha256' IS DISTINCT FROM NEW.model_artifact_sha256
    OR (NEW.centroid_artifact_id IS NOT NULL AND (centroid.source_engine_execution_id IS DISTINCT FROM source.id
      OR centroid.source_checkpoint_digest IS DISTINCT FROM NEW.source_checkpoint_digest
      OR centroid.sha256 IS DISTINCT FROM NEW.centroid_artifact_sha256)) THEN
    RAISE EXCEPTION 'signal_topic_consolidation_lineage_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_signal_topic_consolidation_run_source
BEFORE INSERT OR UPDATE OF workspace_id,source_engine_execution_id,source_checkpoint_digest,output_artifact_id,
 output_artifact_sha256,model_artifact_id,model_artifact_sha256,centroid_artifact_id,centroid_artifact_sha256,
 context_digest,census_digest,configuration,
 configuration_digest,expected_group_count,actor_user_id,created_at
ON signal_topic_consolidation_runs FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_run_source_guard_v1();

CREATE FUNCTION signal_topic_consolidation_run_delete_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'signal_topic_consolidation_history_retained' USING ERRCODE='55000'; RETURN OLD; END; $$;
CREATE TRIGGER trg_signal_topic_consolidation_run_retained BEFORE DELETE ON signal_topic_consolidation_runs
FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_run_delete_guard_v1();

CREATE FUNCTION signal_topic_consolidation_run_status_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status='building' AND NEW.status IN('census_ready','failed'))
    OR (OLD.status='census_ready' AND NEW.status IN('ready_for_review','failed'))
    OR (OLD.status='ready_for_review' AND NEW.status IN('reviewing','validated','failed'))
    OR (OLD.status='reviewing' AND NEW.status IN('validated','failed'))
    OR (OLD.status='validated' AND NEW.status='superseded')
  ) THEN
    RAISE EXCEPTION 'signal_topic_consolidation_run_transition_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_signal_topic_consolidation_run_status
BEFORE UPDATE OF status ON signal_topic_consolidation_runs FOR EACH ROW
EXECUTE FUNCTION signal_topic_consolidation_run_status_guard_v1();

CREATE FUNCTION signal_topic_consolidation_numeric_content_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE target_run uuid; required_status text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.consolidation_run_id IS DISTINCT FROM NEW.consolidation_run_id THEN
    RAISE EXCEPTION 'signal_topic_consolidation_numeric_content_frozen' USING ERRCODE='23514';
  END IF;
  target_run:=CASE WHEN TG_OP='DELETE' THEN OLD.consolidation_run_id ELSE NEW.consolidation_run_id END;
  required_status:=CASE WHEN TG_TABLE_NAME IN('signal_topic_consolidation_communities','signal_topic_consolidation_community_members')
    THEN 'census_ready' ELSE 'building' END;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_runs WHERE id=target_run AND status=required_status) THEN
    RAISE EXCEPTION 'signal_topic_consolidation_numeric_content_frozen' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='signal_topic_atomic_groups' AND NEW.centroid_artifact_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM signal_topic_consolidation_runs run WHERE run.id=target_run AND (
      NEW.centroid_artifact_id=run.centroid_artifact_id AND NEW.centroid_digest IS NOT NULL)) THEN
    RAISE EXCEPTION 'signal_topic_consolidation_centroid_lineage_invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_signal_topic_atomic_groups_mutable BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_atomic_groups
FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_numeric_content_guard_v1();
CREATE TRIGGER trg_signal_topic_atomic_roots_mutable BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_atomic_group_roots
FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_numeric_content_guard_v1();
CREATE TRIGGER trg_signal_topic_atomic_evidence_mutable BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_atomic_group_evidence
FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_numeric_content_guard_v1();
CREATE TRIGGER trg_signal_topic_communities_mutable BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_consolidation_communities
FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_numeric_content_guard_v1();
CREATE TRIGGER trg_signal_topic_community_members_mutable BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_consolidation_community_members
FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_numeric_content_guard_v1();

CREATE FUNCTION signal_topic_atomic_group_centroid_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.centroid_artifact_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM signal_topic_consolidation_artifacts artifact
    WHERE artifact.id=NEW.centroid_artifact_id AND artifact.workspace_id=NEW.workspace_id
      AND artifact.source_engine_execution_id=NEW.source_engine_execution_id
  ) THEN RAISE EXCEPTION 'signal_topic_atomic_group_centroid_invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_signal_topic_atomic_group_centroid
BEFORE INSERT OR UPDATE OF centroid_artifact_id,workspace_id,source_engine_execution_id
ON signal_topic_atomic_groups FOR EACH ROW EXECUTE FUNCTION signal_topic_atomic_group_centroid_guard_v1();

CREATE FUNCTION signal_topic_consolidation_revision_edit_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE target_revision uuid;
BEGIN
  IF TG_OP='UPDATE' AND OLD.revision_id IS DISTINCT FROM NEW.revision_id THEN
    RAISE EXCEPTION 'signal_topic_consolidation_revision_frozen' USING ERRCODE='23514';
  END IF;
  target_revision:=CASE WHEN TG_OP='DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_revisions WHERE id=target_revision AND status='draft') THEN
    RAISE EXCEPTION 'signal_topic_consolidation_revision_frozen' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_signal_topic_editorial_concepts_editable
BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_editorial_concepts
FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_revision_edit_guard_v1();
CREATE TRIGGER trg_signal_topic_consolidation_decisions_editable
BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_consolidation_decisions
FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_revision_edit_guard_v1();

CREATE FUNCTION signal_topic_consolidation_decision_kind_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.concept_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM signal_topic_editorial_concepts concept
    WHERE concept.id=NEW.concept_id AND concept.revision_id=NEW.revision_id
      AND concept.consolidation_run_id=NEW.consolidation_run_id AND concept.workspace_id=NEW.workspace_id
      AND concept.kind=NEW.disposition
  ) THEN RAISE EXCEPTION 'signal_topic_consolidation_concept_kind_invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_signal_topic_consolidation_decision_kind
BEFORE INSERT OR UPDATE OF concept_id,disposition,revision_id,consolidation_run_id,workspace_id
ON signal_topic_consolidation_decisions FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_decision_kind_guard_v1();

CREATE FUNCTION validate_signal_topic_consolidation_revision_v1(target_revision_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  WITH target AS (
    SELECT revision.id revision_id,run.id run_id,run.expected_group_count
    FROM signal_topic_consolidation_revisions revision
    JOIN signal_topic_consolidation_runs run ON run.id=revision.consolidation_run_id AND run.workspace_id=revision.workspace_id
    WHERE revision.id=target_revision_id
  ), counts AS (
    SELECT target.*,
      (SELECT count(*) FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=target.run_id) group_count,
      (SELECT count(*) FROM signal_topic_consolidation_decisions d WHERE d.revision_id=target.revision_id) decision_count,
      (SELECT count(*) FROM signal_topic_consolidation_community_members m WHERE m.consolidation_run_id=target.run_id) community_member_count,
      (SELECT count(*) FROM signal_topic_editorial_concepts c WHERE c.revision_id=target.revision_id) concept_count,
      NOT EXISTS(
        SELECT 1 FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=target.run_id AND (
          g.root_count<>(SELECT count(*) FROM signal_topic_atomic_group_roots r WHERE r.atomic_group_id=g.id)
          OR g.chunk_count<>COALESCE((SELECT sum(r.chunk_count) FROM signal_topic_atomic_group_roots r WHERE r.atomic_group_id=g.id),0)
        )
      ) AND NOT EXISTS(
        SELECT 1 FROM signal_topic_atomic_group_roots r JOIN mentions root
          ON root.workspace_id=r.workspace_id AND root.id=r.canonical_root_id
        WHERE r.consolidation_run_id=target.run_id AND root.canonical_mention_id<>root.id
      ) lineage_complete,
      NOT EXISTS(
        SELECT 1 FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=target.run_id
        AND NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_decisions d WHERE d.revision_id=target.revision_id AND d.atomic_group_id=g.id)
      ) decisions_complete
    FROM target
  )
  SELECT jsonb_build_object(
    'contract_version','signal-topic-consolidation-validation-v1',
    'revision_id',revision_id,'expected_group_count',expected_group_count,'group_count',group_count,
    'decision_count',decision_count,'community_member_count',community_member_count,'concept_count',concept_count,
    'lineage_complete',lineage_complete,'decisions_complete',decisions_complete,
    'complete',group_count=expected_group_count AND decision_count=expected_group_count
      AND community_member_count=expected_group_count AND lineage_complete AND decisions_complete
  ) FROM counts;
$$;

CREATE FUNCTION signal_topic_consolidation_revision_transition_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE validation jsonb;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'draft' OR NEW.revision_digest IS NOT NULL OR NEW.validated_at IS NOT NULL THEN
      RAISE EXCEPTION 'signal_topic_consolidation_revision_incomplete' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='validated' AND NEW.status='superseded'
    AND (to_jsonb(NEW)-'status') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status') THEN RETURN NEW; END IF;
  IF OLD.status<>'draft' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'signal_topic_consolidation_revision_frozen' USING ERRCODE='23514';
  END IF;
  IF OLD.status='draft' AND NEW.status='validated' THEN
    validation:=validate_signal_topic_consolidation_revision_v1(NEW.id);
    IF validation IS NULL OR NOT COALESCE((validation->>'complete')::boolean,false) THEN
      RAISE EXCEPTION 'signal_topic_consolidation_revision_incomplete' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_signal_topic_consolidation_revision_transition
BEFORE INSERT OR UPDATE ON signal_topic_consolidation_revisions FOR EACH ROW
EXECUTE FUNCTION signal_topic_consolidation_revision_transition_guard_v1();

CREATE VIEW signal_topic_consolidation_lineage_v1 WITH (security_invoker=true) AS
SELECT revision.workspace_id,revision.consolidation_run_id,revision.id revision_id,revision.revision,
 concept.id concept_id,concept.concept_key,concept.kind concept_kind,decision.disposition,
 atomic.id atomic_group_id,atomic.group_key,atomic.group_digest,root.canonical_root_id,
 evidence.ref_id evidence_ref_id,evidence.chunk_index,evidence.chunk_sha256
FROM signal_topic_consolidation_revisions revision
JOIN signal_topic_consolidation_decisions decision ON decision.revision_id=revision.id
JOIN signal_topic_atomic_groups atomic ON atomic.id=decision.atomic_group_id
LEFT JOIN signal_topic_editorial_concepts concept ON concept.id=decision.concept_id
JOIN signal_topic_atomic_group_roots root ON root.atomic_group_id=atomic.id
LEFT JOIN signal_topic_atomic_group_evidence evidence
  ON evidence.atomic_group_id=root.atomic_group_id AND evidence.canonical_root_id=root.canonical_root_id;

COMMENT ON TABLE signal_topic_consolidation_runs IS
  'Versioned, provider-free consolidation over a sealed workspace engine fit. It does not change serving authority.';
COMMENT ON TABLE signal_topic_atomic_groups IS
  'Complete atomic BERTopic census. Centroids remain in sealed consolidation artifacts and are referenced, never copied.';
COMMENT ON TABLE signal_topic_atomic_group_evidence IS
  'Up to ten representative evidence locators per group. Original text remains in governed corpus storage.';
COMMENT ON TABLE signal_topic_consolidation_decisions IS
  'Exactly one reversible editorial disposition per atomic group in a validated revision.';

REVOKE ALL ON signal_topic_consolidation_artifacts,signal_topic_consolidation_runs,signal_topic_atomic_groups,signal_topic_atomic_group_roots,
 signal_topic_atomic_group_evidence,signal_topic_consolidation_communities,signal_topic_consolidation_community_members,
 signal_topic_consolidation_revisions,signal_topic_editorial_concepts,signal_topic_consolidation_decisions,
 signal_topic_consolidation_lineage_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION signal_topic_consolidation_artifact_guard_v1(),signal_topic_consolidation_run_source_guard_v1(),signal_topic_atomic_group_centroid_guard_v1(),
 signal_topic_consolidation_run_delete_guard_v1(),signal_topic_consolidation_run_status_guard_v1(),signal_topic_consolidation_numeric_content_guard_v1(),
 signal_topic_consolidation_revision_edit_guard_v1(),signal_topic_consolidation_decision_kind_guard_v1(),
 validate_signal_topic_consolidation_revision_v1(uuid),signal_topic_consolidation_revision_transition_guard_v1()
 FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON signal_topic_consolidation_artifacts,signal_topic_consolidation_runs,signal_topic_atomic_groups,signal_topic_atomic_group_roots,signal_topic_atomic_group_evidence,signal_topic_consolidation_communities,signal_topic_consolidation_community_members,signal_topic_consolidation_revisions,signal_topic_editorial_concepts,signal_topic_consolidation_decisions,signal_topic_consolidation_lineage_v1 FROM %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_consolidation_artifact_guard_v1(),signal_topic_consolidation_run_source_guard_v1(),signal_topic_atomic_group_centroid_guard_v1(),signal_topic_consolidation_run_delete_guard_v1(),signal_topic_consolidation_run_status_guard_v1(),signal_topic_consolidation_numeric_content_guard_v1(),signal_topic_consolidation_revision_edit_guard_v1(),signal_topic_consolidation_decision_kind_guard_v1(),validate_signal_topic_consolidation_revision_v1(uuid),signal_topic_consolidation_revision_transition_guard_v1() FROM %I',role_name);
 END LOOP;
END $$;
