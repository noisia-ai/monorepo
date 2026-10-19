-- Backend 10C.3A-R: workspace-owned, append-only operator review for private
-- topic-discovery proposals.
--
-- This extends the existing analysis artifact/evidence graph. It does not create
-- Topic Contracts, classification assignments, serving bindings, or a second
-- semantic authority.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE analysis_artifacts
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS discovery_run_digest text;

ALTER TABLE analysis_artifacts
  ALTER COLUMN study_corpus_id DROP NOT NULL;

ALTER TABLE analysis_artifacts
  DROP CONSTRAINT IF EXISTS analysis_artifacts_exactly_one_analysis;
ALTER TABLE analysis_artifacts
  ADD CONSTRAINT analysis_artifacts_exactly_one_analysis CHECK (
    (
      study_corpus_id IS NOT NULL
      AND workspace_id IS NULL
      AND discovery_run_digest IS NULL
      AND ((tb_analysis_id IS NOT NULL)::int + (engine_analysis_id IS NOT NULL)::int) = 1
    )
    OR (
      study_corpus_id IS NULL
      AND workspace_id IS NOT NULL
      AND tb_analysis_id IS NULL
      AND engine_analysis_id IS NULL
      AND discovery_run_digest ~ '^sha256:[0-9a-f]{64}$'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_artifacts_discovery_key_revision
  ON analysis_artifacts(workspace_id, discovery_run_digest, artifact_key, revision)
  WHERE workspace_id IS NOT NULL AND discovery_run_digest IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_discovery_review
  ON analysis_artifacts(workspace_id, discovery_run_digest, artifact_type, review_status, position)
  WHERE workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_topic_discovery_review_packets (
  artifact_id uuid PRIMARY KEY REFERENCES analysis_artifacts(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  discovery_run_digest text NOT NULL,
  candidate_artifact_digest text NOT NULL,
  packet_digest text NOT NULL,
  packet_file_digest text NOT NULL,
  source_manifest_digest text NOT NULL,
  packet_policy_version text NOT NULL,
  packet_policy_digest text NOT NULL,
  reference_seed integer NOT NULL,
  rights_digest text NOT NULL,
  rights_valid_until timestamptz,
  modeling_denominator integer NOT NULL,
  proposal_count integer NOT NULL,
  evidence_count integer NOT NULL,
  outlier_evidence_count integer NOT NULL,
  review_scope text NOT NULL,
  source_holdout_state text NOT NULL,
  registered_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_discovery_review_packet_digests CHECK (
    discovery_run_digest ~ '^sha256:[0-9a-f]{64}$'
    AND candidate_artifact_digest ~ '^sha256:[0-9a-f]{64}$'
    AND packet_digest ~ '^sha256:[0-9a-f]{64}$'
    AND packet_file_digest ~ '^sha256:[0-9a-f]{64}$'
    AND source_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
    AND packet_policy_digest ~ '^sha256:[0-9a-f]{64}$'
    AND rights_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_topic_discovery_review_packet_counts CHECK (
    modeling_denominator > 0 AND proposal_count > 0
    AND evidence_count >= proposal_count AND outlier_evidence_count >= 0
  ),
  CONSTRAINT signal_topic_discovery_review_packet_scope CHECK (
    review_scope = 'complete_cluster_census'
    AND source_holdout_state = 'sealed'
  ),
  CONSTRAINT uq_signal_topic_discovery_review_packet_digest
    UNIQUE(workspace_id, packet_digest)
);

CREATE TABLE IF NOT EXISTS signal_topic_discovery_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  packet_artifact_id uuid NOT NULL REFERENCES signal_topic_discovery_review_packets(artifact_id) ON DELETE RESTRICT,
  review_revision integer NOT NULL,
  supersedes_review_id uuid REFERENCES signal_topic_discovery_reviews(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_discovery_review_revision_positive CHECK (review_revision > 0),
  CONSTRAINT uq_signal_topic_discovery_review_revision
    UNIQUE(packet_artifact_id, review_revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_topic_discovery_review_successor
  ON signal_topic_discovery_reviews(supersedes_review_id)
  WHERE supersedes_review_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_topic_discovery_reviews_workspace
  ON signal_topic_discovery_reviews(workspace_id, packet_artifact_id, review_revision DESC);

CREATE TABLE IF NOT EXISTS signal_topic_discovery_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  review_id uuid NOT NULL REFERENCES signal_topic_discovery_reviews(id) ON DELETE RESTRICT,
  proposal_artifact_id uuid NOT NULL REFERENCES analysis_artifacts(id) ON DELETE RESTRICT,
  decision_revision integer NOT NULL,
  supersedes_decision_id uuid REFERENCES signal_topic_discovery_review_decisions(id) ON DELETE RESTRICT,
  state text NOT NULL,
  candidate_artifact_digest text NOT NULL,
  discovery_proposal_key text NOT NULL,
  cluster_key text NOT NULL,
  evidence_refs text[] NOT NULL,
  data_split text NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  internal_coherence smallint,
  neighbor_distinction smallint,
  human_nameability smallint,
  strategic_utility smallint,
  merge_needed boolean,
  split_needed boolean,
  convert_to_topic_contract_candidate boolean,
  none_acceptable boolean,
  notes text,
  decision_digest text NOT NULL,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_discovery_review_decision_revision_positive CHECK (decision_revision > 0),
  CONSTRAINT signal_topic_discovery_review_decision_state CHECK (state IN ('draft','finalized')),
  CONSTRAINT signal_topic_discovery_review_decision_score_ranges CHECK (
    (internal_coherence IS NULL OR internal_coherence BETWEEN 1 AND 5)
    AND (neighbor_distinction IS NULL OR neighbor_distinction BETWEEN 1 AND 5)
    AND (human_nameability IS NULL OR human_nameability BETWEEN 1 AND 5)
    AND (strategic_utility IS NULL OR strategic_utility BETWEEN 1 AND 5)
  ),
  CONSTRAINT signal_topic_discovery_review_decision_final_complete CHECK (
    state = 'draft' OR (
      internal_coherence IS NOT NULL AND neighbor_distinction IS NOT NULL
      AND human_nameability IS NOT NULL AND strategic_utility IS NOT NULL
      AND merge_needed IS NOT NULL AND split_needed IS NOT NULL
      AND convert_to_topic_contract_candidate IS NOT NULL AND none_acceptable IS NOT NULL
    )
  ),
  CONSTRAINT signal_topic_discovery_review_decision_authority_separation CHECK (
    NOT (COALESCE(none_acceptable,false) AND COALESCE(convert_to_topic_contract_candidate,false))
  ),
  CONSTRAINT signal_topic_discovery_review_decision_digests CHECK (
    candidate_artifact_digest ~ '^sha256:[0-9a-f]{64}$'
    AND decision_digest ~ '^sha256:[0-9a-f]{64}$'
    AND cardinality(evidence_refs) > 0
    AND array_position(evidence_refs,NULL) IS NULL
    AND array_to_string(evidence_refs,',') ~
      '^sha256:[0-9a-f]{64}(,sha256:[0-9a-f]{64})*$'
  ),
  CONSTRAINT uq_signal_topic_discovery_review_decision_revision
    UNIQUE(review_id, proposal_artifact_id, decision_revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_topic_discovery_review_decision_successor
  ON signal_topic_discovery_review_decisions(supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_topic_discovery_review_decision_current
  ON signal_topic_discovery_review_decisions(review_id, proposal_artifact_id, decision_revision DESC);

CREATE TABLE IF NOT EXISTS signal_topic_discovery_outlier_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  review_id uuid NOT NULL REFERENCES signal_topic_discovery_reviews(id) ON DELETE RESTRICT,
  decision_revision integer NOT NULL,
  supersedes_decision_id uuid REFERENCES signal_topic_discovery_outlier_decisions(id) ON DELETE RESTRICT,
  state text NOT NULL,
  study_boundary_thresholds boolean,
  study_missing_topic_families boolean,
  study_later_recovery boolean,
  notes text,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  decision_digest text NOT NULL,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_discovery_outlier_decision_revision_positive CHECK (decision_revision > 0),
  CONSTRAINT signal_topic_discovery_outlier_decision_state CHECK (state IN ('draft','finalized')),
  CONSTRAINT signal_topic_discovery_outlier_decision_final_complete CHECK (
    state = 'draft' OR (
      study_boundary_thresholds IS NOT NULL
      AND study_missing_topic_families IS NOT NULL
      AND study_later_recovery IS NOT NULL
    )
  ),
  CONSTRAINT signal_topic_discovery_outlier_decision_digest CHECK (
    decision_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT uq_signal_topic_discovery_outlier_decision_revision
    UNIQUE(review_id, decision_revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_topic_discovery_outlier_decision_successor
  ON signal_topic_discovery_outlier_decisions(supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_topic_discovery_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  review_id uuid NOT NULL REFERENCES signal_topic_discovery_reviews(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  event_index integer NOT NULL,
  event_kind text NOT NULL,
  previous_state text,
  next_state text NOT NULL,
  outcome text,
  outlier_decision_digest text,
  score_sheet_digest text,
  decision_sheet_digest text,
  review_digest text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_topic_discovery_review_event_index_nonnegative CHECK (event_index >= 0),
  CONSTRAINT signal_topic_discovery_review_event_kind CHECK (
    event_kind IN ('review_opened','review_finalized','review_superseded')
  ),
  CONSTRAINT signal_topic_discovery_review_event_state CHECK (
    (previous_state IS NULL OR previous_state IN ('open','finalized','superseded'))
    AND next_state IN ('open','finalized','superseded')
  ),
  CONSTRAINT signal_topic_discovery_review_event_outcome CHECK (
    outcome IS NULL OR outcome IN ('candidate_preferred','none_acceptable','rerun_requested')
  ),
  CONSTRAINT signal_topic_discovery_review_event_digests CHECK (
    review_digest ~ '^sha256:[0-9a-f]{64}$'
    AND (outlier_decision_digest IS NULL OR outlier_decision_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (score_sheet_digest IS NULL OR score_sheet_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (decision_sheet_digest IS NULL OR decision_sheet_digest ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT uq_signal_topic_discovery_review_operation_event UNIQUE(operation_id, event_index)
);

CREATE INDEX IF NOT EXISTS idx_signal_topic_discovery_review_events_history
  ON signal_topic_discovery_review_events(review_id, created_at, id);

ALTER TABLE signal_governance_control_operations
  DROP CONSTRAINT IF EXISTS signal_governance_control_action;
ALTER TABLE signal_governance_control_operations
  ADD CONSTRAINT signal_governance_control_action CHECK(action IN (
    'create-quality-draft','create-retention-draft','create-licensing-draft',
    'activate-policy','create-provenance-binding-draft','activate-provenance-binding',
    'upsert-identity','update-timezone','reconcile-brand-os','create-source','import-source',
    'reconcile-governed-view','reconcile-strategic-authority','promote-strategic-authority',
    'reconcile-acquisition-plan','promote-acquisition-plan','create-acquisition-query',
    'review-acquisition-query','retire-acquisition-slot','decide-acquisition-reference',
    'retire-competitor','reactivate-competitor','create-competitor','seal-acquisition-import',
    'seal-acquisition-brief','generate-acquisition-queries','authorize-acquisition-benchmark',
    'register-topic-discovery-review','save-topic-discovery-review-draft',
    'save-topic-discovery-outlier-draft','finalize-topic-discovery-review',
    'supersede-topic-discovery-review'
  ));

CREATE OR REPLACE FUNCTION protect_signal_topic_discovery_review_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Topic discovery review authority is append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_review_packets
  ON signal_topic_discovery_review_packets;
CREATE TRIGGER trg_protect_signal_topic_discovery_review_packets
BEFORE UPDATE OR DELETE ON signal_topic_discovery_review_packets
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_review_append_only_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_reviews
  ON signal_topic_discovery_reviews;
CREATE TRIGGER trg_protect_signal_topic_discovery_reviews
BEFORE UPDATE OR DELETE ON signal_topic_discovery_reviews
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_review_append_only_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_review_decisions
  ON signal_topic_discovery_review_decisions;
CREATE TRIGGER trg_protect_signal_topic_discovery_review_decisions
BEFORE UPDATE OR DELETE ON signal_topic_discovery_review_decisions
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_review_append_only_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_outlier_decisions
  ON signal_topic_discovery_outlier_decisions;
CREATE TRIGGER trg_protect_signal_topic_discovery_outlier_decisions
BEFORE UPDATE OR DELETE ON signal_topic_discovery_outlier_decisions
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_review_append_only_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_review_events
  ON signal_topic_discovery_review_events;
CREATE TRIGGER trg_protect_signal_topic_discovery_review_events
BEFORE UPDATE OR DELETE ON signal_topic_discovery_review_events
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_review_append_only_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_discovery_artifact_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workspace_id IS NOT NULL AND OLD.discovery_run_digest IS NOT NULL THEN
    RAISE EXCEPTION 'Workspace topic discovery artifacts are immutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE OR REPLACE FUNCTION signal_topic_discovery_artifact_is_registered_v1(target_artifact_id_arg uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1
    FROM analysis_artifacts artifact
    LEFT JOIN analysis_artifact_relations relation
      ON relation.target_artifact_id=artifact.id AND relation.relation_type='contains_proposal'
    JOIN signal_topic_discovery_review_packets packet
      ON packet.artifact_id=COALESCE(relation.source_artifact_id,artifact.id)
    WHERE artifact.id=target_artifact_id_arg
  );
$$;

CREATE OR REPLACE FUNCTION protect_signal_topic_discovery_evidence_group_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_artifact_id uuid;
BEGIN
  target_artifact_id:=CASE WHEN TG_OP='DELETE' THEN OLD.artifact_id ELSE NEW.artifact_id END;
  IF signal_topic_discovery_artifact_is_registered_v1(target_artifact_id) THEN
    RAISE EXCEPTION 'Registered topic discovery evidence is immutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE OR REPLACE FUNCTION protect_signal_topic_discovery_evidence_link_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_group_id uuid;DECLARE target_artifact_id uuid;
BEGIN
  target_group_id:=CASE WHEN TG_OP='DELETE' THEN OLD.evidence_group_id ELSE NEW.evidence_group_id END;
  SELECT artifact_id INTO target_artifact_id FROM analysis_evidence_groups WHERE id=target_group_id;
  IF signal_topic_discovery_artifact_is_registered_v1(target_artifact_id) THEN
    RAISE EXCEPTION 'Registered topic discovery evidence is immutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE OR REPLACE FUNCTION protect_signal_topic_discovery_relation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid;DECLARE target_id uuid;
BEGIN
  source_id:=CASE WHEN TG_OP='DELETE' THEN OLD.source_artifact_id ELSE NEW.source_artifact_id END;
  target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.target_artifact_id ELSE NEW.target_artifact_id END;
  IF signal_topic_discovery_artifact_is_registered_v1(source_id)
     OR signal_topic_discovery_artifact_is_registered_v1(target_id) THEN
    RAISE EXCEPTION 'Registered topic discovery relations are immutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_artifact ON analysis_artifacts;
CREATE TRIGGER trg_protect_signal_topic_discovery_artifact
BEFORE UPDATE OR DELETE ON analysis_artifacts
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_artifact_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_evidence_groups ON analysis_evidence_groups;
CREATE TRIGGER trg_protect_signal_topic_discovery_evidence_groups
BEFORE INSERT OR UPDATE OR DELETE ON analysis_evidence_groups
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_evidence_group_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_evidence_links ON analysis_evidence_links;
CREATE TRIGGER trg_protect_signal_topic_discovery_evidence_links
BEFORE INSERT OR UPDATE OR DELETE ON analysis_evidence_links
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_evidence_link_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_relations ON analysis_artifact_relations;
CREATE TRIGGER trg_protect_signal_topic_discovery_relations
BEFORE INSERT OR UPDATE OR DELETE ON analysis_artifact_relations
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_discovery_relation_v1();

COMMENT ON TABLE signal_topic_discovery_review_packets IS
  'Private workspace-owned registration for one verified diagnostic packet in the canonical analysis artifact/evidence graph; never serving authority.';
COMMENT ON TABLE signal_topic_discovery_review_decisions IS
  'Append-only operator rubric drafts and finalized decisions. A row never creates a Topic Contract or propagation assignment.';
COMMENT ON TABLE signal_topic_discovery_review_events IS
  'Append-only lifecycle and contractual export digests for operator discovery review.';
