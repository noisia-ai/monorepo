-- Backend 10C.3B-A / NOI-71: workspace-owned Semantic Context Pack authority.
--
-- The pack is a structured, operator-approved projection over Brand OS and Knowledge.
-- It is not a corpus, taxonomy, classification assignment, Topic Contract, or serving
-- binding. Confidence is retained as evidence only and never grants approval.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION signal_semantic_context_digest_v1(canonical_text text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 'sha256:'||encode(digest(convert_to(canonical_text,'UTF8'),'sha256'),'hex');
$$;

ALTER TABLE analysis_artifacts
  ADD COLUMN IF NOT EXISTS workspace_artifact_kind text,
  ADD COLUMN IF NOT EXISTS workspace_authority_digest text;

-- 0090 protects registered workspace artifacts. Temporarily remove that trigger so
-- the exact, non-semantic discriminator backfill below can run once.
DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_artifact ON analysis_artifacts;
DROP TRIGGER IF EXISTS trg_protect_signal_workspace_artifact ON analysis_artifacts;

UPDATE analysis_artifacts
SET workspace_artifact_kind='topic_discovery',
    workspace_authority_digest=discovery_run_digest
WHERE workspace_id IS NOT NULL
  AND discovery_run_digest IS NOT NULL
  AND workspace_artifact_kind IS NULL;

ALTER TABLE analysis_artifacts
  DROP CONSTRAINT IF EXISTS analysis_artifacts_exactly_one_analysis;
ALTER TABLE analysis_artifacts
  ADD CONSTRAINT analysis_artifacts_exactly_one_analysis CHECK (
    (
      study_corpus_id IS NOT NULL
      AND workspace_id IS NULL
      AND workspace_artifact_kind IS NULL
      AND workspace_authority_digest IS NULL
      AND discovery_run_digest IS NULL
      AND ((tb_analysis_id IS NOT NULL)::int + (engine_analysis_id IS NOT NULL)::int) = 1
    )
    OR (
      study_corpus_id IS NULL
      AND workspace_id IS NOT NULL
      AND tb_analysis_id IS NULL
      AND engine_analysis_id IS NULL
      AND workspace_artifact_kind='topic_discovery'
      AND discovery_run_digest ~ '^sha256:[0-9a-f]{64}$'
      AND workspace_authority_digest=discovery_run_digest
    )
    OR (
      study_corpus_id IS NULL
      AND workspace_id IS NOT NULL
      AND tb_analysis_id IS NULL
      AND engine_analysis_id IS NULL
      AND workspace_artifact_kind='semantic_context'
      AND discovery_run_digest IS NULL
      AND workspace_authority_digest ~ '^sha256:[0-9a-f]{64}$'
    )
  );

ALTER TABLE analysis_artifacts
  ADD CONSTRAINT uq_analysis_artifacts_id_workspace UNIQUE(id,workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_artifacts_semantic_context_key_revision
  ON analysis_artifacts(workspace_id,workspace_authority_digest,artifact_key,revision)
  WHERE workspace_artifact_kind='semantic_context';
CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_semantic_context
  ON analysis_artifacts(workspace_id,artifact_type,review_status,position)
  WHERE workspace_artifact_kind='semantic_context';

CREATE TABLE IF NOT EXISTS signal_semantic_context_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL,
  generation_key text NOT NULL,
  generation_version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  supersedes_generation_id uuid,
  brand_os_profile_id uuid NOT NULL REFERENCES brand_os_profiles(id) ON DELETE RESTRICT,
  brand_os_profile_version integer NOT NULL,
  brand_os_digest text NOT NULL,
  knowledge_generation_key text NOT NULL,
  knowledge_digest text NOT NULL,
  locale_context_digest text NOT NULL,
  primary_locale text NOT NULL,
  locale_variants text[] NOT NULL,
  markets text[] NOT NULL,
  timezone text NOT NULL,
  proposal_model text,
  proposal_model_version text,
  proposal_prompt_digest text,
  proposal_pricing_version text,
  draft_digest text NOT NULL,
  pack_digest text,
  created_operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  published_operation_id uuid REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT uq_signal_semantic_context_generation_artifact UNIQUE(artifact_id,workspace_id),
  CONSTRAINT uq_signal_semantic_context_generation_id_workspace UNIQUE(id,workspace_id),
  CONSTRAINT uq_signal_semantic_context_generation_version UNIQUE(workspace_id,generation_version),
  CONSTRAINT uq_signal_semantic_context_generation_key UNIQUE(workspace_id,generation_key),
  CONSTRAINT signal_semantic_context_generation_artifact_workspace
    FOREIGN KEY(artifact_id,workspace_id) REFERENCES analysis_artifacts(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_generation_supersedes_workspace
    FOREIGN KEY(supersedes_generation_id,workspace_id)
    REFERENCES signal_semantic_context_generations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_generation_version_positive CHECK(generation_version>0),
  CONSTRAINT signal_semantic_context_generation_status CHECK(status IN ('draft','published')),
  CONSTRAINT signal_semantic_context_generation_digests CHECK(
    brand_os_digest ~ '^sha256:[0-9a-f]{64}$'
    AND knowledge_digest ~ '^sha256:[0-9a-f]{64}$'
    AND locale_context_digest ~ '^sha256:[0-9a-f]{64}$'
    AND draft_digest ~ '^sha256:[0-9a-f]{64}$'
    AND (pack_digest IS NULL OR pack_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (proposal_prompt_digest IS NULL OR proposal_prompt_digest ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT signal_semantic_context_generation_locale CHECK(
    primary_locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    AND cardinality(locale_variants)>0
    AND primary_locale=ANY(locale_variants)
    AND array_position(locale_variants,NULL) IS NULL
    AND cardinality(markets)>0
    AND array_position(markets,NULL) IS NULL
  ),
  CONSTRAINT signal_semantic_context_generation_provider_lineage CHECK(
    (proposal_model IS NULL AND proposal_model_version IS NULL
      AND proposal_prompt_digest IS NULL AND proposal_pricing_version IS NULL)
    OR
    (proposal_model IS NOT NULL AND proposal_model_version IS NOT NULL
      AND proposal_prompt_digest IS NOT NULL AND proposal_pricing_version IS NOT NULL)
  ),
  CONSTRAINT signal_semantic_context_generation_publication CHECK(
    (status='draft' AND pack_digest IS NULL AND published_operation_id IS NULL
      AND published_by_user_id IS NULL AND published_at IS NULL)
    OR
    (status='published' AND pack_digest IS NOT NULL AND published_operation_id IS NOT NULL
      AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_context_open_draft
  ON signal_semantic_context_generations(workspace_id) WHERE status='draft';
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_context_generation_successor
  ON signal_semantic_context_generations(supersedes_generation_id)
  WHERE supersedes_generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_generation_history
  ON signal_semantic_context_generations(workspace_id,generation_version DESC);

CREATE TABLE IF NOT EXISTS signal_semantic_context_element_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  evidence_group_id uuid NOT NULL REFERENCES analysis_evidence_groups(id) ON DELETE RESTRICT,
  element_key text NOT NULL,
  element_version integer NOT NULL,
  element_kind text NOT NULL,
  canonical_key text NOT NULL,
  display_text text NOT NULL,
  scope text,
  entity_type text,
  entity_id uuid,
  locale text,
  relation_kind text,
  relation_target_key text,
  confidence numeric(7,6),
  disposition text NOT NULL,
  origin_kind text NOT NULL,
  supersedes_element_id uuid,
  original_proposal_element_id uuid,
  source_refs_digest text NOT NULL,
  element_digest text NOT NULL,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  proposed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_semantic_context_element_artifact UNIQUE(artifact_id,workspace_id),
  CONSTRAINT uq_signal_semantic_context_element_id_workspace UNIQUE(id,workspace_id),
  CONSTRAINT uq_signal_semantic_context_element_evidence_group UNIQUE(evidence_group_id),
  CONSTRAINT uq_signal_semantic_context_element_version UNIQUE(generation_id,element_key,element_version),
  CONSTRAINT signal_semantic_context_element_generation_workspace
    FOREIGN KEY(generation_id,workspace_id)
    REFERENCES signal_semantic_context_generations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_element_artifact_workspace
    FOREIGN KEY(artifact_id,workspace_id) REFERENCES analysis_artifacts(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_element_supersedes_workspace
    FOREIGN KEY(supersedes_element_id,workspace_id)
    REFERENCES signal_semantic_context_element_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_element_original_workspace
    FOREIGN KEY(original_proposal_element_id,workspace_id)
    REFERENCES signal_semantic_context_element_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_element_version_positive CHECK(element_version>0),
  CONSTRAINT signal_semantic_context_element_kind CHECK(element_kind IN (
    'identity_term','alias','product','feature','surface','category','need','benefit',
    'friction','usage_occasion','competitor_term','locale_variant','exclusion','homonym',
    'ambiguous_term','abstention_rule','positive_anchor','negative_anchor','boundary_anchor',
    'typed_relation'
  )),
  CONSTRAINT signal_semantic_context_element_disposition CHECK(
    disposition IN ('pending','approved','rejected')
  ),
  CONSTRAINT signal_semantic_context_element_origin CHECK(
    origin_kind IN ('server_projection','provider_proposal','operator_decision','operator_correction')
  ),
  CONSTRAINT signal_semantic_context_element_entity_pair CHECK(
    (entity_type IS NULL AND entity_id IS NULL) OR (entity_type IS NOT NULL AND entity_id IS NOT NULL)
  ),
  CONSTRAINT signal_semantic_context_element_relation CHECK(
    (element_kind='typed_relation' AND relation_kind IN (
      'is_a','part_of','surface_of','competes_with','associated_with'
    ) AND relation_target_key IS NOT NULL)
    OR
    (element_kind<>'typed_relation' AND relation_kind IS NULL AND relation_target_key IS NULL)
  ),
  CONSTRAINT signal_semantic_context_element_confidence CHECK(
    confidence IS NULL OR (confidence>=0 AND confidence<=1)
  ),
  CONSTRAINT signal_semantic_context_element_decision CHECK(
    (disposition='pending' AND decided_by_user_id IS NULL AND decided_at IS NULL)
    OR
    (disposition IN ('approved','rejected') AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT signal_semantic_context_element_lineage CHECK(
    (origin_kind='operator_correction' AND supersedes_element_id IS NOT NULL
      AND original_proposal_element_id IS NOT NULL)
    OR origin_kind<>'operator_correction'
  ),
  CONSTRAINT signal_semantic_context_element_digests CHECK(
    source_refs_digest ~ '^sha256:[0-9a-f]{64}$'
    AND element_digest ~ '^sha256:[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_semantic_context_element_successor
  ON signal_semantic_context_element_versions(supersedes_element_id)
  WHERE supersedes_element_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_element_current
  ON signal_semantic_context_element_versions(generation_id,element_key,element_version DESC);
CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_element_disposition
  ON signal_semantic_context_element_versions(generation_id,disposition,element_kind);

CREATE TABLE IF NOT EXISTS signal_semantic_context_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  element_id uuid,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  event_index integer NOT NULL,
  event_kind text NOT NULL,
  previous_state_digest text,
  next_state_digest text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_semantic_context_event_generation_workspace
    FOREIGN KEY(generation_id,workspace_id)
    REFERENCES signal_semantic_context_generations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_event_element_workspace
    FOREIGN KEY(element_id,workspace_id)
    REFERENCES signal_semantic_context_element_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_event_index CHECK(event_index>=0),
  CONSTRAINT signal_semantic_context_event_kind CHECK(event_kind IN (
    'generation_created','proposals_appended','element_approved','element_rejected',
    'element_corrected','elements_bulk_approved','generation_published'
  )),
  CONSTRAINT signal_semantic_context_event_digests CHECK(
    (previous_state_digest IS NULL OR previous_state_digest ~ '^sha256:[0-9a-f]{64}$')
    AND next_state_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT uq_signal_semantic_context_operation_event UNIQUE(operation_id,event_index)
);

CREATE INDEX IF NOT EXISTS idx_signal_semantic_context_events_history
  ON signal_semantic_context_events(generation_id,created_at,id);

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
    'supersede-topic-discovery-review','create-semantic-context-draft',
    'append-semantic-context-proposals','decide-semantic-context-element',
    'bulk-approve-semantic-context-elements','publish-semantic-context-generation'
  ));

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_kind text;artifact_authority text;profile_brand uuid;workspace_brand uuid;
DECLARE operation signal_governance_control_operations%ROWTYPE;
BEGIN
  SELECT workspace_artifact_kind,workspace_authority_digest
    INTO artifact_kind,artifact_authority
  FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  IF artifact_kind IS DISTINCT FROM 'semantic_context'
     OR artifact_authority !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Semantic context generation artifact authority is incompatible.' USING ERRCODE='23514';
  END IF;
  SELECT brand_id INTO profile_brand FROM brand_os_profiles WHERE id=NEW.brand_os_profile_id;
  SELECT brand_id INTO workspace_brand FROM signal_workspaces WHERE id=NEW.workspace_id;
  IF profile_brand IS NULL OR workspace_brand IS NULL OR profile_brand<>workspace_brand THEN
    RAISE EXCEPTION 'Semantic context generation is cross-workspace.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO operation FROM signal_governance_control_operations
      WHERE id=NEW.created_operation_id;
    IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
       OR operation.actor_user_id<>NEW.created_by_user_id
       OR operation.action<>'create-semantic-context-draft'
       OR operation.status<>'in_progress'
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id) THEN
      RAISE EXCEPTION 'Semantic context generation operation authority is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.supersedes_generation_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_generations predecessor
      WHERE predecessor.id=NEW.supersedes_generation_id
        AND predecessor.workspace_id=NEW.workspace_id
        AND predecessor.status='published'
        AND predecessor.generation_version=NEW.generation_version-1
    ) THEN
      RAISE EXCEPTION 'Semantic context generation supersession is incompatible.' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.status='draft' AND NEW.status='published' THEN
    SELECT * INTO operation FROM signal_governance_control_operations
      WHERE id=NEW.published_operation_id;
    IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
       OR operation.actor_user_id<>NEW.published_by_user_id
       OR operation.action<>'publish-semantic-context-generation'
       OR operation.status<>'in_progress'
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.published_by_user_id) THEN
      RAISE EXCEPTION 'Semantic context publication operation authority is invalid.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_signal_semantic_context_generation
  ON signal_semantic_context_generations;
CREATE TRIGGER trg_validate_signal_semantic_context_generation
BEFORE INSERT OR UPDATE ON signal_semantic_context_generations
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_generation_v1();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_generation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Semantic context generations cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF OLD.status='published' THEN
    RAISE EXCEPTION 'Published semantic context generations are immutable.' USING ERRCODE='55000';
  END IF;
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.artifact_id<>OLD.artifact_id
     OR NEW.generation_key<>OLD.generation_key OR NEW.generation_version<>OLD.generation_version
     OR NEW.supersedes_generation_id IS DISTINCT FROM OLD.supersedes_generation_id
     OR NEW.brand_os_profile_id<>OLD.brand_os_profile_id
     OR NEW.brand_os_profile_version<>OLD.brand_os_profile_version
     OR NEW.brand_os_digest<>OLD.brand_os_digest
     OR NEW.knowledge_generation_key<>OLD.knowledge_generation_key
     OR NEW.knowledge_digest<>OLD.knowledge_digest
     OR NEW.locale_context_digest<>OLD.locale_context_digest
     OR NEW.primary_locale<>OLD.primary_locale OR NEW.locale_variants<>OLD.locale_variants
     OR NEW.markets<>OLD.markets OR NEW.timezone<>OLD.timezone
     OR NEW.proposal_model IS DISTINCT FROM OLD.proposal_model
     OR NEW.proposal_model_version IS DISTINCT FROM OLD.proposal_model_version
     OR NEW.proposal_prompt_digest IS DISTINCT FROM OLD.proposal_prompt_digest
     OR NEW.proposal_pricing_version IS DISTINCT FROM OLD.proposal_pricing_version
     OR NEW.created_operation_id<>OLD.created_operation_id
     OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Semantic context generation authority cannot be rewritten.' USING ERRCODE='55000';
  END IF;
  IF NEW.status='draft' AND (NEW.pack_digest IS NOT NULL OR NEW.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Draft semantic context publication fields are invalid.' USING ERRCODE='55000';
  END IF;
  IF NEW.status NOT IN ('draft','published') THEN
    RAISE EXCEPTION 'Semantic context generation lifecycle is invalid.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_semantic_context_generation
  ON signal_semantic_context_generations;
CREATE TRIGGER trg_protect_signal_semantic_context_generation
BEFORE UPDATE OR DELETE ON signal_semantic_context_generations
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_generation_v1();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_element_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation_status text;artifact_kind text;artifact_authority text;group_artifact uuid;
DECLARE operation signal_governance_control_operations%ROWTYPE;generation_has_provider_lineage boolean;
DECLARE generation_profile_id uuid;workspace_organization_id uuid;workspace_brand_id uuid;
BEGIN
  SELECT generation.status,(generation.proposal_model IS NOT NULL
      AND generation.proposal_model_version IS NOT NULL
      AND generation.proposal_prompt_digest IS NOT NULL
      AND generation.proposal_pricing_version IS NOT NULL),
      generation.brand_os_profile_id,workspace.organization_id,workspace.brand_id
    INTO generation_status,generation_has_provider_lineage,generation_profile_id,
      workspace_organization_id,workspace_brand_id
    FROM signal_semantic_context_generations generation
    JOIN signal_workspaces workspace ON workspace.id=generation.workspace_id
    WHERE generation.id=NEW.generation_id AND generation.workspace_id=NEW.workspace_id;
  IF generation_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Semantic context elements require a draft generation.' USING ERRCODE='55000';
  END IF;
  SELECT workspace_artifact_kind,workspace_authority_digest
    INTO artifact_kind,artifact_authority
    FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  SELECT artifact_id INTO group_artifact FROM analysis_evidence_groups WHERE id=NEW.evidence_group_id;
  IF artifact_kind IS DISTINCT FROM 'semantic_context'
     OR artifact_authority IS DISTINCT FROM NEW.element_digest
     OR group_artifact IS DISTINCT FROM NEW.artifact_id THEN
    RAISE EXCEPTION 'Semantic context element artifact/evidence lineage is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM analysis_evidence_links link
      WHERE link.evidence_group_id=NEW.evidence_group_id)
     OR EXISTS(
      SELECT 1 FROM analysis_evidence_links link
      WHERE link.evidence_group_id=NEW.evidence_group_id AND NOT CASE link.source_type
        WHEN 'brand_os_profile' THEN EXISTS(SELECT 1 FROM brand_os_profiles source
          WHERE source.id=link.source_id AND source.id=generation_profile_id)
        WHEN 'brand_os_product' THEN EXISTS(SELECT 1 FROM brand_os_products source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation_profile_id)
        WHEN 'brand_os_competitor' THEN EXISTS(SELECT 1 FROM brand_os_competitors source
          WHERE source.id=link.source_id AND source.brand_os_profile_id=generation_profile_id)
        WHEN 'brand_os_seed_term' THEN EXISTS(SELECT 1 FROM brand_os_seed_terms source
          JOIN brand_os_seed_sets seed_set ON seed_set.id=source.seed_set_id
          WHERE source.id=link.source_id AND seed_set.brand_os_profile_id=generation_profile_id)
        WHEN 'knowledge_source' THEN EXISTS(SELECT 1 FROM brand_knowledge_sources source
          WHERE source.id=link.source_id AND source.organization_id=workspace_organization_id
            AND source.brand_id=workspace_brand_id AND source.study_corpus_id IS NULL
            AND source.status IN ('processed','profiled','active'))
        WHEN 'knowledge_chunk' THEN EXISTS(SELECT 1 FROM knowledge_chunks source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace_organization_id
            AND knowledge.brand_id=workspace_brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        WHEN 'knowledge_assertion' THEN EXISTS(SELECT 1 FROM knowledge_assertions source
          JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
          WHERE source.id=link.source_id AND knowledge.organization_id=workspace_organization_id
            AND knowledge.brand_id=workspace_brand_id AND knowledge.study_corpus_id IS NULL
            AND knowledge.status IN ('processed','profiled','active'))
        ELSE false END
    ) THEN
    RAISE EXCEPTION 'Semantic context source references are cross-workspace or stale.' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_element_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM signal_semantic_context_element_versions predecessor
    WHERE predecessor.id=NEW.supersedes_element_id
      AND predecessor.generation_id=NEW.generation_id
      AND predecessor.element_key=NEW.element_key
      AND predecessor.element_version=NEW.element_version-1
  ) THEN
    RAISE EXCEPTION 'Semantic context element supersession is incompatible.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.proposed_by_user_id
     OR operation.status<>'in_progress'
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.proposed_by_user_id)
     OR operation.action NOT IN (
       'append-semantic-context-proposals','decide-semantic-context-element',
       'bulk-approve-semantic-context-elements'
     ) THEN
    RAISE EXCEPTION 'Semantic context element operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF (NEW.origin_kind IN ('server_projection','provider_proposal')
       AND (operation.action<>'append-semantic-context-proposals' OR NEW.disposition<>'pending'))
     OR (NEW.origin_kind='operator_correction'
       AND (operation.action<>'decide-semantic-context-element' OR NEW.disposition<>'pending'))
     OR (NEW.origin_kind='operator_decision'
       AND (operation.action NOT IN ('decide-semantic-context-element','bulk-approve-semantic-context-elements')
         OR NEW.disposition NOT IN ('approved','rejected')))
     OR (NEW.disposition IN ('approved','rejected')
       AND NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context disposition cannot be inferred from evidence.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='provider_proposal' AND NOT generation_has_provider_lineage THEN
    RAISE EXCEPTION 'Provider proposal lineage is incomplete.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_signal_semantic_context_element
  ON signal_semantic_context_element_versions;
CREATE TRIGGER trg_validate_signal_semantic_context_element
BEFORE INSERT ON signal_semantic_context_element_versions
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_element_v1();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Semantic context authority is append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_semantic_context_elements
  ON signal_semantic_context_element_versions;
CREATE TRIGGER trg_protect_signal_semantic_context_elements
BEFORE UPDATE OR DELETE ON signal_semantic_context_element_versions
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_append_only_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_semantic_context_events
  ON signal_semantic_context_events;
CREATE TRIGGER trg_protect_signal_semantic_context_events
BEFORE UPDATE OR DELETE ON signal_semantic_context_events
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_append_only_v1();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;expected_action text;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  expected_action:=CASE NEW.event_kind
    WHEN 'generation_created' THEN 'create-semantic-context-draft'
    WHEN 'proposals_appended' THEN 'append-semantic-context-proposals'
    WHEN 'element_approved' THEN 'decide-semantic-context-element'
    WHEN 'element_rejected' THEN 'decide-semantic-context-element'
    WHEN 'element_corrected' THEN 'decide-semantic-context-element'
    WHEN 'elements_bulk_approved' THEN 'bulk-approve-semantic-context-elements'
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id
     OR operation.action IS DISTINCT FROM expected_action
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_signal_semantic_context_event
  ON signal_semantic_context_events;
CREATE TRIGGER trg_validate_signal_semantic_context_event
BEFORE INSERT ON signal_semantic_context_events
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_event_v1();

CREATE OR REPLACE FUNCTION signal_semantic_context_artifact_is_registered_v1(target_artifact_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM signal_semantic_context_generations WHERE artifact_id=target_artifact_id
    UNION ALL
    SELECT 1 FROM signal_semantic_context_element_versions WHERE artifact_id=target_artifact_id
  );
$$;

CREATE OR REPLACE FUNCTION protect_signal_workspace_artifact_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workspace_id IS NOT NULL
     AND OLD.workspace_artifact_kind IN ('topic_discovery','semantic_context') THEN
    RAISE EXCEPTION 'Registered workspace artifacts are immutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_artifact ON analysis_artifacts;
DROP TRIGGER IF EXISTS trg_protect_signal_workspace_artifact ON analysis_artifacts;
CREATE TRIGGER trg_protect_signal_workspace_artifact
BEFORE UPDATE OR DELETE ON analysis_artifacts
FOR EACH ROW EXECUTE FUNCTION protect_signal_workspace_artifact_v1();

CREATE OR REPLACE FUNCTION protect_signal_context_evidence_group_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_artifact_id uuid;
BEGIN
  target_artifact_id:=CASE WHEN TG_OP='DELETE' THEN OLD.artifact_id ELSE NEW.artifact_id END;
  IF signal_semantic_context_artifact_is_registered_v1(target_artifact_id)
     OR signal_topic_discovery_artifact_is_registered_v1(target_artifact_id) THEN
    RAISE EXCEPTION 'Registered workspace evidence is immutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE OR REPLACE FUNCTION protect_signal_context_evidence_link_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_group_id uuid;target_artifact_id uuid;
BEGIN
  target_group_id:=CASE WHEN TG_OP='DELETE' THEN OLD.evidence_group_id ELSE NEW.evidence_group_id END;
  SELECT artifact_id INTO target_artifact_id FROM analysis_evidence_groups WHERE id=target_group_id;
  IF signal_semantic_context_artifact_is_registered_v1(target_artifact_id)
     OR signal_topic_discovery_artifact_is_registered_v1(target_artifact_id) THEN
    RAISE EXCEPTION 'Registered workspace evidence is immutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_evidence_groups ON analysis_evidence_groups;
DROP TRIGGER IF EXISTS trg_protect_signal_context_evidence_groups ON analysis_evidence_groups;
CREATE TRIGGER trg_protect_signal_context_evidence_groups
BEFORE INSERT OR UPDATE OR DELETE ON analysis_evidence_groups
FOR EACH ROW EXECUTE FUNCTION protect_signal_context_evidence_group_v1();

DROP TRIGGER IF EXISTS trg_protect_signal_topic_discovery_evidence_links ON analysis_evidence_links;
DROP TRIGGER IF EXISTS trg_protect_signal_context_evidence_links ON analysis_evidence_links;
CREATE TRIGGER trg_protect_signal_context_evidence_links
BEFORE INSERT OR UPDATE OR DELETE ON analysis_evidence_links
FOR EACH ROW EXECUTE FUNCTION protect_signal_context_evidence_link_v1();

COMMENT ON TABLE signal_semantic_context_generations IS
  'Workspace-owned Semantic Context Pack generations tied to exact Brand OS, Knowledge and locale authority. Published rows are immutable and never serving authority.';
COMMENT ON TABLE signal_semantic_context_element_versions IS
  'Append-only typed context element proposals and operator decisions. Confidence is evidence only; disposition is explicit authority.';
COMMENT ON TABLE signal_semantic_context_events IS
  'Append-only operation-indexed lifecycle for Semantic Context Pack drafts, decisions and publication.';
