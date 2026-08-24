-- Backend 69B.2: append-only merge/review authority and sealed publication V2.
--
-- This migration extends the 0091 authority in place. Existing V1 publications are
-- deliberately untouched. Every draft -> published transition after this migration is
-- rejected unless PostgreSQL can recompute and match the complete V2 publication graph.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    'reconcile-semantic-context-generation','append-semantic-context-proposals',
    'decide-semantic-context-element','bulk-approve-semantic-context-elements',
    'publish-semantic-context-generation','start-semantic-context-proposal-run',
    'retry-semantic-context-proposal-run','revalidate-semantic-context-proposal-run',
    'merge-semantic-context-elements','correct-semantic-context-element',
    'annotate-semantic-context-element'
  ));

ALTER TABLE signal_semantic_context_element_versions
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_disposition,
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_origin,
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_decision,
  DROP CONSTRAINT IF EXISTS signal_semantic_context_element_lineage;
ALTER TABLE signal_semantic_context_element_versions
  ADD CONSTRAINT signal_semantic_context_element_disposition CHECK(
    disposition IN ('pending','approved','rejected','merged')
  ),
  ADD CONSTRAINT signal_semantic_context_element_origin CHECK(
    origin_kind IN ('server_projection','provider_proposal','operator_decision',
      'operator_correction','operator_merge')
  ),
  ADD CONSTRAINT signal_semantic_context_element_decision CHECK(
    (disposition='pending' AND decided_by_user_id IS NULL AND decided_at IS NULL)
    OR (disposition IN ('approved','rejected','merged')
      AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
  ),
  ADD CONSTRAINT signal_semantic_context_element_lineage CHECK(
    (origin_kind IN ('operator_correction','operator_merge')
      AND supersedes_element_id IS NOT NULL AND original_proposal_element_id IS NOT NULL)
    OR origin_kind NOT IN ('operator_correction','operator_merge')
  );

CREATE TABLE signal_semantic_context_merge_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  source_predecessor_id uuid NOT NULL,
  source_element_key text NOT NULL,
  source_element_version integer NOT NULL,
  source_merged_successor_id uuid NOT NULL,
  target_predecessor_id uuid NOT NULL,
  target_element_key text NOT NULL,
  target_element_version integer NOT NULL,
  target_pending_successor_id uuid NOT NULL,
  reason_code text NOT NULL,
  rationale text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_semantic_context_merge_generation_workspace
    FOREIGN KEY(generation_id,workspace_id)
    REFERENCES signal_semantic_context_generations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_merge_source_predecessor_workspace
    FOREIGN KEY(source_predecessor_id,workspace_id)
    REFERENCES signal_semantic_context_element_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_merge_source_successor_workspace
    FOREIGN KEY(source_merged_successor_id,workspace_id)
    REFERENCES signal_semantic_context_element_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_merge_target_predecessor_workspace
    FOREIGN KEY(target_predecessor_id,workspace_id)
    REFERENCES signal_semantic_context_element_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_merge_target_successor_workspace
    FOREIGN KEY(target_pending_successor_id,workspace_id)
    REFERENCES signal_semantic_context_element_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_merge_reason CHECK(reason_code IN (
    'duplicate_same_concept','alias_or_variant','canonicalization','semantic_boundary',
    'locale_resolution','competitive_unit_resolution','insufficient_context','operator_correction'
  )),
  CONSTRAINT signal_semantic_context_merge_rationale CHECK(
    rationale=normalize(btrim(rationale),NFC) AND char_length(rationale) BETWEEN 1 AND 1000
  ),
  CONSTRAINT signal_semantic_context_merge_keys CHECK(
    source_element_key<>target_element_key AND source_element_version>0 AND target_element_version>0
  ),
  CONSTRAINT uq_signal_semantic_context_merge_source_predecessor UNIQUE(source_predecessor_id),
  CONSTRAINT uq_signal_semantic_context_merge_source_successor UNIQUE(source_merged_successor_id),
  CONSTRAINT uq_signal_semantic_context_merge_operation_source UNIQUE(operation_id,source_element_key)
);
CREATE INDEX idx_signal_semantic_context_merge_graph
  ON signal_semantic_context_merge_edges(generation_id,target_element_key,source_element_key);

CREATE TABLE signal_semantic_context_review_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  annotation_key text NOT NULL,
  annotation_version integer NOT NULL,
  annotation_type text NOT NULL,
  state text NOT NULL,
  resolution text,
  subject_element_id uuid NOT NULL,
  related_element_ids uuid[] NOT NULL DEFAULT '{}',
  reason_code text NOT NULL,
  rationale text NOT NULL,
  supersedes_annotation_id uuid,
  operation_id uuid NOT NULL REFERENCES signal_governance_control_operations(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_signal_semantic_context_annotation_id_workspace UNIQUE(id,workspace_id),
  CONSTRAINT uq_signal_semantic_context_annotation_version
    UNIQUE(generation_id,annotation_key,annotation_version),
  CONSTRAINT signal_semantic_context_annotation_generation_workspace
    FOREIGN KEY(generation_id,workspace_id)
    REFERENCES signal_semantic_context_generations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_annotation_subject_workspace
    FOREIGN KEY(subject_element_id,workspace_id)
    REFERENCES signal_semantic_context_element_versions(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_annotation_supersedes_workspace
    FOREIGN KEY(supersedes_annotation_id,workspace_id)
    REFERENCES signal_semantic_context_review_annotations(id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_semantic_context_annotation_version_positive CHECK(annotation_version>0),
  CONSTRAINT signal_semantic_context_annotation_type CHECK(annotation_type IN (
    'uncertain','needs_more_context','near_duplicate','locale_unresolved',
    'competitive_unit_unresolved'
  )),
  CONSTRAINT signal_semantic_context_annotation_state CHECK(
    (state='open' AND resolution IS NULL)
    OR (state='resolved' AND resolution IN (
      'merged','kept_distinct','context_sufficient','not_supported','governed_locale',
      'global','canonical_unit','not_applicable'
    ))
  ),
  CONSTRAINT signal_semantic_context_annotation_reason CHECK(reason_code IN (
    'duplicate_same_concept','alias_or_variant','canonicalization','semantic_boundary',
    'locale_resolution','competitive_unit_resolution','insufficient_context','operator_correction'
  )),
  CONSTRAINT signal_semantic_context_annotation_rationale CHECK(
    rationale=normalize(btrim(rationale),NFC) AND char_length(rationale) BETWEEN 1 AND 1000
  ),
  CONSTRAINT signal_semantic_context_annotation_related CHECK(
    cardinality(related_element_ids)<=100 AND array_position(related_element_ids,NULL) IS NULL
  )
);
CREATE UNIQUE INDEX uq_signal_semantic_context_annotation_successor
  ON signal_semantic_context_review_annotations(supersedes_annotation_id)
  WHERE supersedes_annotation_id IS NOT NULL;
CREATE INDEX idx_signal_semantic_context_annotation_current
  ON signal_semantic_context_review_annotations(generation_id,annotation_key,annotation_version DESC);

ALTER TABLE signal_semantic_context_generations
  ADD COLUMN publication_schema_version text,
  ADD COLUMN candidate_pack_digest text,
  ADD COLUMN evidence_graph_digest text,
  ADD COLUMN review_graph_digest text,
  ADD COLUMN publication_authority_digest text,
  ADD COLUMN publication_authority_snapshot jsonb,
  ADD COLUMN semantic_context_pack_digest text,
  ADD COLUMN publish_preflight_digest text,
  ADD COLUMN publication_counts jsonb;

ALTER TABLE signal_semantic_context_generations
  ADD CONSTRAINT signal_semantic_context_generation_publication_v2_digests CHECK(
    (candidate_pack_digest IS NULL OR candidate_pack_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (evidence_graph_digest IS NULL OR evidence_graph_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (review_graph_digest IS NULL OR review_graph_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (publication_authority_digest IS NULL OR publication_authority_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (semantic_context_pack_digest IS NULL OR semantic_context_pack_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (publish_preflight_digest IS NULL OR publish_preflight_digest ~ '^sha256:[0-9a-f]{64}$')
  );

ALTER TABLE signal_semantic_context_events
  DROP CONSTRAINT IF EXISTS signal_semantic_context_event_kind;
ALTER TABLE signal_semantic_context_events
  ADD CONSTRAINT signal_semantic_context_event_kind CHECK(event_kind IN (
    'generation_created','generation_reconciled','proposals_appended','element_approved',
    'element_rejected','element_corrected','elements_bulk_approved','elements_merged',
    'review_annotation_created','review_annotation_updated','review_annotation_resolved',
    'generation_published'
  ));

CREATE OR REPLACE FUNCTION signal_semantic_context_escape_string_v2(value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE normalized text:=normalize(value,NFC);result text:='"';position integer;character text;code integer;
BEGIN
  FOR position IN 1..char_length(normalized) LOOP
    character:=substr(normalized,position,1);code:=ascii(character);
    IF code BETWEEN 55296 AND 57343 THEN
      RAISE EXCEPTION 'canonical_json_v2 rejects lone surrogate code points.' USING ERRCODE='22021';
    ELSIF character='"' THEN result:=result||E'\\"';
    ELSIF character=E'\\' THEN result:=result||E'\\\\';
    ELSIF code BETWEEN 0 AND 31 THEN result:=result||'\u00'||upper(lpad(to_hex(code),2,'0'));
    ELSIF code=8232 THEN result:=result||'\u2028';
    ELSIF code=8233 THEN result:=result||'\u2029';
    ELSE result:=result||character;
    END IF;
  END LOOP;
  RETURN result||'"';
END; $$;

CREATE OR REPLACE FUNCTION signal_semantic_context_canonical_json_v2(value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text;entry record;scalar text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      IF EXISTS(
        SELECT 1 FROM jsonb_object_keys(value) member(key)
        GROUP BY normalize(member.key,NFC) HAVING count(*)>1
      ) THEN
        RAISE EXCEPTION 'canonical_json_v2 rejects normalized key collisions.' USING ERRCODE='22023';
      END IF;
      result:='{';
      FOR entry IN SELECT key,item FROM jsonb_each(value) member(key,item)
        ORDER BY convert_to(normalize(key,NFC),'UTF8') LOOP
        IF length(result)>1 THEN result:=result||','; END IF;
        result:=result||signal_semantic_context_escape_string_v2(entry.key)||':'
          ||signal_semantic_context_canonical_json_v2(entry.item);
      END LOOP;
      RETURN result||'}';
    WHEN 'array' THEN
      result:='[';
      FOR entry IN SELECT item FROM jsonb_array_elements(value) WITH ORDINALITY member(item,position)
        ORDER BY position LOOP
        IF length(result)>1 THEN result:=result||','; END IF;
        result:=result||signal_semantic_context_canonical_json_v2(entry.item);
      END LOOP;
      RETURN result||']';
    WHEN 'string' THEN RETURN signal_semantic_context_escape_string_v2(value#>>'{}');
    WHEN 'number' THEN
      scalar:=value#>>'{}';
      IF scalar !~ '^-?(0|[1-9][0-9]*)$' THEN
        RAISE EXCEPTION 'canonical_json_v2 accepts integers only.' USING ERRCODE='22023';
      END IF;
      RETURN scalar;
    WHEN 'boolean' THEN RETURN value#>>'{}';
    WHEN 'null' THEN RETURN 'null';
    ELSE RAISE EXCEPTION 'canonical_json_v2 received an unsupported value.' USING ERRCODE='22023';
  END CASE;
END; $$;

CREATE OR REPLACE FUNCTION signal_semantic_context_digest_json_v2(value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v2(value));
$$;

CREATE OR REPLACE FUNCTION signal_semantic_context_publication_snapshot_v2(
  target_generation_id uuid,
  expected_live_authority jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE generation signal_semantic_context_generations%ROWTYPE;candidate jsonb;evidence jsonb;review jsonb;
DECLARE authority jsonb;publication_graph jsonb;preflight jsonb;counts jsonb;collisions jsonb;blockers text[]:='{}';
DECLARE candidate_digest text;evidence_digest text;review_digest text;authority_digest text;pack_digest text;
DECLARE total_leaves integer;pending_count integer;approved_count integer;rejected_count integer;merged_count integer;
DECLARE open_annotations integer;open_uncertainty integer;open_near_duplicate integer;
DECLARE unresolved_locale integer;unresolved_competitive integer;merge_count integer;collision_count integer;
DECLARE invalid_evidence integer;fork_count integer;cycle_count integer;unresolved_corrections integer;
DECLARE invalid_relation_targets integer;
DECLARE nonterminal_runs integer;executable_outbox integer;reserved_budget integer;
BEGIN
  SELECT * INTO generation FROM signal_semantic_context_generations WHERE id=target_generation_id;
  IF generation.id IS NULL THEN RAISE EXCEPTION 'Semantic context generation not found.' USING ERRCODE='P0002'; END IF;

  WITH leaves AS (
    SELECT element.* FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=generation.id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*)::int,count(*) FILTER(WHERE disposition='pending')::int,
      count(*) FILTER(WHERE disposition='approved')::int,count(*) FILTER(WHERE disposition='rejected')::int,
      count(*) FILTER(WHERE disposition='merged')::int
    INTO total_leaves,pending_count,approved_count,rejected_count,merged_count FROM leaves;

  WITH annotation_leaves AS (
    SELECT annotation.* FROM signal_semantic_context_review_annotations annotation
    WHERE annotation.generation_id=generation.id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_review_annotations successor
      WHERE successor.supersedes_annotation_id=annotation.id)
  ) SELECT count(*) FILTER(WHERE state='open')::int,
      count(*) FILTER(WHERE state='open' AND annotation_type IN ('uncertain','needs_more_context'))::int,
      count(*) FILTER(WHERE state='open' AND annotation_type='near_duplicate')::int,
      count(*) FILTER(WHERE state='open' AND annotation_type='locale_unresolved')::int,
      count(*) FILTER(WHERE state='open' AND annotation_type='competitive_unit_unresolved')::int
    INTO open_annotations,open_uncertainty,open_near_duplicate,unresolved_locale,unresolved_competitive
    FROM annotation_leaves;

  SELECT count(*)::int INTO merge_count FROM signal_semantic_context_merge_edges
    WHERE generation_id=generation.id;
  WITH leaves AS (
    SELECT element.* FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=generation.id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ), grouped AS (
    SELECT element_kind,canonical_key,COALESCE(locale,'') resolved_locale,count(*)::int amount
    FROM leaves WHERE disposition='approved' GROUP BY element_kind,canonical_key,COALESCE(locale,'') HAVING count(*)>1
  ) SELECT count(*)::int,COALESCE(jsonb_agg(jsonb_build_array(element_kind,canonical_key,resolved_locale)
      ORDER BY convert_to(element_kind,'UTF8'),convert_to(canonical_key,'UTF8'),convert_to(resolved_locale,'UTF8')),'[]'::jsonb)
    INTO collision_count,collisions FROM grouped;
  WITH approved AS (
    SELECT element.* FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=generation.id AND element.disposition='approved' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*)::int INTO invalid_evidence FROM approved
    WHERE NOT EXISTS(SELECT 1 FROM analysis_evidence_links link WHERE link.evidence_group_id=approved.evidence_group_id)
      OR EXISTS(
        SELECT 1 FROM analysis_evidence_links link
        JOIN signal_workspaces workspace ON workspace.id=generation.workspace_id
        WHERE link.evidence_group_id=approved.evidence_group_id AND NOT CASE link.source_type
          WHEN 'brand_os_profile' THEN EXISTS(SELECT 1 FROM brand_os_profiles source
            WHERE source.id=link.source_id AND source.id=generation.brand_os_profile_id)
          WHEN 'brand_os_product' THEN EXISTS(SELECT 1 FROM brand_os_products source
            WHERE source.id=link.source_id AND source.brand_os_profile_id=generation.brand_os_profile_id)
          WHEN 'brand_os_competitor' THEN EXISTS(SELECT 1 FROM brand_os_competitors source
            WHERE source.id=link.source_id AND source.brand_os_profile_id=generation.brand_os_profile_id)
          WHEN 'brand_os_seed_term' THEN EXISTS(SELECT 1 FROM brand_os_seed_terms source
            JOIN brand_os_seed_sets seed_set ON seed_set.id=source.seed_set_id
            WHERE source.id=link.source_id AND seed_set.brand_os_profile_id=generation.brand_os_profile_id)
          WHEN 'knowledge_source' THEN EXISTS(SELECT 1 FROM brand_knowledge_sources source
            WHERE source.id=link.source_id AND source.organization_id=workspace.organization_id
              AND source.brand_id=workspace.brand_id AND source.study_corpus_id IS NULL
              AND source.status IN ('processed','profiled','active'))
          WHEN 'knowledge_chunk' THEN EXISTS(SELECT 1 FROM knowledge_chunks source
            JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
            WHERE source.id=link.source_id AND knowledge.organization_id=workspace.organization_id
              AND knowledge.brand_id=workspace.brand_id AND knowledge.study_corpus_id IS NULL
              AND knowledge.status IN ('processed','profiled','active'))
          WHEN 'knowledge_assertion' THEN EXISTS(SELECT 1 FROM knowledge_assertions source
            JOIN brand_knowledge_sources knowledge ON knowledge.id=source.knowledge_source_id
            WHERE source.id=link.source_id AND knowledge.organization_id=workspace.organization_id
              AND knowledge.brand_id=workspace.brand_id AND knowledge.study_corpus_id IS NULL
              AND knowledge.status IN ('processed','profiled','active'))
          ELSE false END
      );
  WITH leaves AS (
    SELECT element.* FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=generation.id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*)::int INTO invalid_relation_targets FROM leaves relation
    WHERE relation.disposition='approved' AND relation.element_kind='typed_relation' AND (
      relation.relation_target_key IS NULL OR relation.relation_target_key=relation.element_key OR NOT EXISTS(
        SELECT 1 FROM leaves target WHERE target.element_key=relation.relation_target_key
          AND target.disposition='approved'));
  SELECT count(*)::int INTO fork_count FROM (
    SELECT supersedes_element_id FROM signal_semantic_context_element_versions
    WHERE generation_id=generation.id AND supersedes_element_id IS NOT NULL
    GROUP BY supersedes_element_id HAVING count(*)<>1
  ) forks;
  WITH RECURSIVE merge_paths(source_key,target_key) AS (
    SELECT edge.source_element_key,edge.target_element_key
    FROM signal_semantic_context_merge_edges edge WHERE edge.generation_id=generation.id
    UNION
    SELECT path.source_key,edge.target_element_key
    FROM merge_paths path JOIN signal_semantic_context_merge_edges edge
      ON edge.generation_id=generation.id AND edge.source_element_key=path.target_key
  ) SELECT count(*)::int INTO cycle_count FROM merge_paths WHERE source_key=target_key;
  WITH leaves AS (
    SELECT element.* FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=generation.id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*)::int INTO unresolved_corrections FROM leaves
    WHERE disposition='pending' AND origin_kind='operator_correction';
  SELECT count(*)::int INTO nonterminal_runs FROM signal_semantic_context_proposal_runs
    WHERE generation_id=generation.id AND status IN ('queued','processing','validating');
  SELECT count(*)::int INTO executable_outbox FROM signal_semantic_context_proposal_outbox outbox
    JOIN signal_semantic_context_proposal_runs run ON run.id=outbox.run_id
    WHERE run.generation_id=generation.id AND outbox.status IN ('pending','dispatching');
  SELECT count(*)::int INTO reserved_budget FROM signal_semantic_context_budget_reservations reservation
    JOIN signal_semantic_context_proposal_runs run ON run.id=reservation.run_id
    WHERE run.generation_id=generation.id AND reservation.status='reserved';

  candidate:=jsonb_build_object('contract_version','signal-semantic-context-candidate-pack-v2',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'elements',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'element_key',element.element_key,'element_version',element.element_version,
      'element_kind',element.element_kind,'canonical_key',element.canonical_key,
      'display_text',element.display_text,'scope',element.scope,'entity_type',element.entity_type,
      'entity_id',lower(element.entity_id::text),'locale',element.locale,'relation_kind',element.relation_kind,
      'relation_target_key',element.relation_target_key)
      ORDER BY convert_to(element.element_key,'UTF8'),element.element_version)
      FROM signal_semantic_context_element_versions element
      WHERE element.generation_id=generation.id AND element.disposition='approved' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)),'[]'::jsonb));
  candidate_digest:=signal_semantic_context_digest_json_v2(candidate);

  evidence:=jsonb_build_object('contract_version','signal-semantic-context-evidence-graph-v2',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'elements',COALESCE((SELECT jsonb_agg(jsonb_build_object('element_key',element.element_key,
      'element_version',element.element_version,'refs',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'source_type',link.source_type,'source_id',lower(link.source_id::text),'relation_type',link.relation_type)
        ORDER BY convert_to(link.source_type,'UTF8'),convert_to(lower(link.source_id::text),'UTF8'),
          convert_to(link.relation_type,'UTF8')) FROM (SELECT DISTINCT source_type,source_id,relation_type
          FROM analysis_evidence_links WHERE evidence_group_id=element.evidence_group_id) link),'[]'::jsonb))
      ORDER BY convert_to(element.element_key,'UTF8'),element.element_version)
      FROM signal_semantic_context_element_versions element
      WHERE element.generation_id=generation.id AND element.disposition='approved' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)),'[]'::jsonb));
  evidence_digest:=signal_semantic_context_digest_json_v2(evidence);

  review:=jsonb_build_object('contract_version','signal-semantic-context-review-graph-v2',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'element_versions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'element_key',element_key,'element_version',element_version,'element_digest',element_digest,
      'disposition',disposition,'origin_kind',origin_kind,'supersedes_element_id',lower(supersedes_element_id::text),
      'original_proposal_element_id',lower(original_proposal_element_id::text),'operation_id',lower(operation_id::text),
      'decided_by_user_id',lower(decided_by_user_id::text),'decided_at',CASE WHEN decided_at IS NULL THEN NULL
        ELSE to_char(decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END)
      ORDER BY convert_to(element_key,'UTF8'),element_version,convert_to(id::text,'UTF8'))
      FROM signal_semantic_context_element_versions WHERE generation_id=generation.id),'[]'::jsonb),
    'merge_edges',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'operation_id',lower(operation_id::text),'source_predecessor_id',lower(source_predecessor_id::text),
      'source_element_key',source_element_key,'source_element_version',source_element_version,
      'source_merged_successor_id',lower(source_merged_successor_id::text),
      'target_predecessor_id',lower(target_predecessor_id::text),'target_element_key',target_element_key,
      'target_element_version',target_element_version,'target_pending_successor_id',lower(target_pending_successor_id::text),
      'reason_code',reason_code,'rationale',rationale,'actor_user_id',lower(actor_user_id::text),
      'created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ORDER BY convert_to(operation_id::text,'UTF8'),convert_to(source_element_key,'UTF8'),source_element_version)
      FROM signal_semantic_context_merge_edges WHERE generation_id=generation.id),'[]'::jsonb),
    'annotations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'annotation_key',annotation_key,'annotation_version',annotation_version,'annotation_type',annotation_type,
      'state',state,'resolution',resolution,'subject_element_id',lower(subject_element_id::text),
      'related_element_ids',COALESCE((SELECT jsonb_agg(lower(item::text) ORDER BY convert_to(item::text,'UTF8'))
        FROM unnest(related_element_ids) item),'[]'::jsonb),'reason_code',reason_code,'rationale',rationale,
      'supersedes_annotation_id',lower(supersedes_annotation_id::text),'operation_id',lower(operation_id::text),
      'actor_user_id',lower(actor_user_id::text),'created_at',
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ORDER BY convert_to(annotation_key,'UTF8'),annotation_version,convert_to(id::text,'UTF8'))
      FROM signal_semantic_context_review_annotations WHERE generation_id=generation.id),'[]'::jsonb));
  review_digest:=signal_semantic_context_digest_json_v2(review);
  authority:=jsonb_build_object('brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'proposal_provider_lineage',generation.proposal_provider_lineage,
    'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest);
  authority_digest:=signal_semantic_context_digest_json_v2(authority);
  publication_graph:=jsonb_build_object('contract_version','signal-semantic-context-publication-graph-v2',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version),
    'candidate_pack_digest',candidate_digest,'evidence_graph_digest',evidence_digest,
    'review_graph_digest',review_digest,'authority',authority);
  pack_digest:=signal_semantic_context_digest_json_v2(publication_graph);

  counts:=jsonb_build_object('total_leaves',total_leaves,'pending',pending_count,'approved',approved_count,
    'rejected',rejected_count,'merged',merged_count,'open_annotations',open_annotations,
    'open_uncertainty',open_uncertainty,'open_near_duplicate',open_near_duplicate,
    'unresolved_locale',unresolved_locale,'unresolved_competitive_unit',unresolved_competitive,
    'merge_edges',merge_count,'canonical_collisions',collision_count,'invalid_evidence_refs',invalid_evidence,
    'invalid_relation_targets',invalid_relation_targets);
  IF generation.status<>'draft' OR EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
      WHERE successor.supersedes_generation_id=generation.id) THEN blockers:=array_append(blockers,'generation_not_effective_draft'); END IF;
  IF nonterminal_runs>0 THEN blockers:=array_append(blockers,'proposal_run_nonterminal'); END IF;
  IF executable_outbox>0 THEN blockers:=array_append(blockers,'executable_outbox'); END IF;
  IF reserved_budget>0 THEN blockers:=array_append(blockers,'reserved_budget'); END IF;
  IF pending_count>0 THEN blockers:=array_append(blockers,'pending_elements'); END IF;
  IF unresolved_corrections>0 THEN blockers:=array_append(blockers,'unresolved_correction'); END IF;
  IF approved_count=0 THEN blockers:=array_append(blockers,'zero_approved_elements'); END IF;
  IF open_uncertainty>0 THEN blockers:=array_append(blockers,'open_uncertainty'); END IF;
  IF open_near_duplicate>0 THEN blockers:=array_append(blockers,'open_near_duplicate'); END IF;
  IF unresolved_locale>0 THEN blockers:=array_append(blockers,'locale_unresolved'); END IF;
  IF unresolved_competitive>0 THEN blockers:=array_append(blockers,'competitive_unit_unresolved'); END IF;
  IF open_annotations>open_uncertainty+open_near_duplicate+unresolved_locale+unresolved_competitive THEN
    blockers:=array_append(blockers,'open_annotation'); END IF;
  IF collision_count>0 THEN blockers:=array_append(blockers,'canonical_collision'); END IF;
  IF invalid_evidence>0 THEN blockers:=array_append(blockers,'invalid_current_evidence'); END IF;
  IF invalid_relation_targets>0 THEN blockers:=array_append(blockers,'invalid_relation_target'); END IF;
  IF expected_live_authority IS NOT NULL THEN
    IF generation.brand_os_digest IS DISTINCT FROM expected_live_authority->>'brand_os_digest'
       OR generation.knowledge_digest IS DISTINCT FROM expected_live_authority->>'knowledge_digest'
       OR generation.locale_context_digest IS DISTINCT FROM expected_live_authority->>'locale_context_digest' THEN
      blockers:=array_append(blockers,'authority_drift');
    END IF;
    IF generation.proposal_provider_lineage IS DISTINCT FROM expected_live_authority->'proposal_provider_lineage'
       OR generation.proposal_provider_lineage_digest IS DISTINCT FROM expected_live_authority->>'proposal_provider_lineage_digest' THEN
      blockers:=array_append(blockers,'provider_lineage_not_current');
    END IF;
    IF authority IS DISTINCT FROM expected_live_authority THEN
      blockers:=array_append(blockers,'live_authority_drift');
    END IF;
  END IF;
  IF fork_count>0 OR cycle_count>0 OR total_leaves<>pending_count+approved_count+rejected_count+merged_count THEN
    blockers:=array_append(blockers,'graph_count_inconsistent'); END IF;
  IF cycle_count>0 THEN blockers:=array_append(blockers,'merge_cycle'); END IF;
  IF EXISTS(SELECT 1 FROM signal_semantic_context_element_versions leaf
      WHERE leaf.generation_id=generation.id AND leaf.disposition='merged' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_merge_edges edge
        WHERE edge.source_merged_successor_id=leaf.id)) THEN blockers:=array_append(blockers,'unresolved_merge'); END IF;
  IF EXISTS(SELECT 1 FROM signal_semantic_context_element_versions leaf
      WHERE leaf.generation_id=generation.id AND leaf.disposition='approved' AND leaf.locale IS NULL
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations annotation
          WHERE annotation.generation_id=generation.id AND annotation.subject_element_id=leaf.id
            AND annotation.annotation_type='locale_unresolved' AND annotation.state='resolved'
            AND annotation.resolution='global' AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations successor
              WHERE successor.supersedes_annotation_id=annotation.id))) THEN
    blockers:=array_append(blockers,'locale_market_required_unresolved'); END IF;

  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item),'{}'::text[]) INTO blockers FROM unnest(blockers) item;
  preflight:=jsonb_build_object('contract_version','signal-semantic-context-publish-preflight-v2',
    'generation',jsonb_build_object('key',generation.generation_key,'version',generation.generation_version,
      'expected_status','draft'),'candidate_pack_digest',candidate_digest,'evidence_graph_digest',evidence_digest,
    'review_graph_digest',review_digest,'authority',authority,
    'expected_live_authority',expected_live_authority,'semantic_context_pack_digest',pack_digest,
    'counts',counts,'collisions',collisions,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0);
  RETURN jsonb_build_object('candidate_pack_digest',candidate_digest,'evidence_graph_digest',evidence_digest,
    'review_graph_digest',review_digest,'publication_authority_digest',authority_digest,
    'semantic_context_pack_digest',pack_digest,'publish_preflight_digest',
      signal_semantic_context_digest_json_v2(preflight),'counts',counts,'collisions',collisions,
    'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,'preflight',preflight);
END; $$;

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_publication_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;computed jsonb;
BEGIN
  IF OLD.status='draft' AND NEW.status='published' THEN
    SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.published_operation_id;
    IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
       OR operation.actor_user_id<>NEW.published_by_user_id
       OR operation.action<>'publish-semantic-context-generation' OR operation.status<>'in_progress'
       OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.published_by_user_id) THEN
      RAISE EXCEPTION 'Semantic context publication operation authority is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.publication_schema_version IS DISTINCT FROM 'signal-semantic-context-publication-v2' THEN
      RAISE EXCEPTION 'semantic_context_publish_v1_retired' USING ERRCODE='55000';
    END IF;
    IF NEW.publication_authority_snapshot IS NULL THEN
      RAISE EXCEPTION 'Semantic context V2 publication requires the sealed live authority.' USING ERRCODE='23514';
    END IF;
    computed:=signal_semantic_context_publication_snapshot_v2(NEW.id,NEW.publication_authority_snapshot);
    IF computed->>'publishable'<>'true'
       OR NEW.candidate_pack_digest IS DISTINCT FROM computed->>'candidate_pack_digest'
       OR NEW.evidence_graph_digest IS DISTINCT FROM computed->>'evidence_graph_digest'
       OR NEW.review_graph_digest IS DISTINCT FROM computed->>'review_graph_digest'
       OR NEW.publication_authority_digest IS DISTINCT FROM computed->>'publication_authority_digest'
       OR NEW.semantic_context_pack_digest IS DISTINCT FROM computed->>'semantic_context_pack_digest'
       OR NEW.publish_preflight_digest IS DISTINCT FROM computed->>'publish_preflight_digest'
       OR NEW.publication_counts IS DISTINCT FROM computed->'counts'
       OR NEW.pack_digest IS DISTINCT FROM computed->>'semantic_context_pack_digest' THEN
      RAISE EXCEPTION 'Semantic context V2 publication seal does not match the DB-owned graph.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_validate_signal_semantic_context_publication_v2 ON signal_semantic_context_generations;
CREATE TRIGGER trg_validate_signal_semantic_context_publication_v2
BEFORE UPDATE ON signal_semantic_context_generations
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_publication_v2();

CREATE OR REPLACE FUNCTION protect_signal_semantic_context_publication_fields_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='draft' AND NEW.status='draft' AND (
    NEW.publication_schema_version IS DISTINCT FROM OLD.publication_schema_version
    OR NEW.candidate_pack_digest IS DISTINCT FROM OLD.candidate_pack_digest
    OR NEW.evidence_graph_digest IS DISTINCT FROM OLD.evidence_graph_digest
    OR NEW.review_graph_digest IS DISTINCT FROM OLD.review_graph_digest
    OR NEW.publication_authority_digest IS DISTINCT FROM OLD.publication_authority_digest
    OR NEW.publication_authority_snapshot IS DISTINCT FROM OLD.publication_authority_snapshot
    OR NEW.semantic_context_pack_digest IS DISTINCT FROM OLD.semantic_context_pack_digest
    OR NEW.publish_preflight_digest IS DISTINCT FROM OLD.publish_preflight_digest
    OR NEW.publication_counts IS DISTINCT FROM OLD.publication_counts) THEN
    RAISE EXCEPTION 'Semantic context publication fields are write-once at publish.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_protect_signal_semantic_context_publication_fields_v2
BEFORE UPDATE ON signal_semantic_context_generations
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_publication_fields_v2();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_merge_edge_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_pre signal_semantic_context_element_versions%ROWTYPE;
DECLARE source_post signal_semantic_context_element_versions%ROWTYPE;
DECLARE target_pre signal_semantic_context_element_versions%ROWTYPE;
DECLARE target_post signal_semantic_context_element_versions%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;
BEGIN
  SELECT * INTO source_pre FROM signal_semantic_context_element_versions WHERE id=NEW.source_predecessor_id;
  SELECT * INTO source_post FROM signal_semantic_context_element_versions WHERE id=NEW.source_merged_successor_id;
  SELECT * INTO target_pre FROM signal_semantic_context_element_versions WHERE id=NEW.target_predecessor_id;
  SELECT * INTO target_post FROM signal_semantic_context_element_versions WHERE id=NEW.target_pending_successor_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF operation.id IS NULL OR operation.action<>'merge-semantic-context-elements'
     OR operation.workspace_id<>NEW.workspace_id OR operation.actor_user_id<>NEW.actor_user_id
     OR source_pre.workspace_id<>NEW.workspace_id OR source_post.workspace_id<>NEW.workspace_id
     OR target_pre.workspace_id<>NEW.workspace_id OR target_post.workspace_id<>NEW.workspace_id
     OR source_pre.generation_id<>NEW.generation_id OR source_post.generation_id<>NEW.generation_id
     OR target_pre.generation_id<>NEW.generation_id OR target_post.generation_id<>NEW.generation_id
     OR source_pre.element_kind<>target_pre.element_kind
     OR source_post.supersedes_element_id<>source_pre.id OR target_post.supersedes_element_id<>target_pre.id
     OR source_post.disposition<>'merged' OR source_post.origin_kind<>'operator_merge'
     OR target_post.disposition<>'pending' OR target_post.origin_kind<>'operator_correction'
     OR source_pre.element_key<>NEW.source_element_key OR source_pre.element_version<>NEW.source_element_version
     OR target_pre.element_key<>NEW.target_element_key OR target_pre.element_version<>NEW.target_element_version THEN
    RAISE EXCEPTION 'Semantic context merge edge is incompatible.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM signal_semantic_context_merge_edges edge
      WHERE edge.operation_id=NEW.operation_id AND (
        edge.target_predecessor_id<>NEW.target_predecessor_id
        OR edge.target_pending_successor_id<>NEW.target_pending_successor_id
        OR edge.target_element_key<>NEW.target_element_key
        OR edge.target_element_version<>NEW.target_element_version)) THEN
    RAISE EXCEPTION 'Semantic context merge operation has multiple targets.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(
    WITH RECURSIVE historical_path(source_key,target_key) AS (
      SELECT edge.source_element_key,edge.target_element_key
      FROM signal_semantic_context_merge_edges edge WHERE edge.generation_id=NEW.generation_id
      UNION
      SELECT path.source_key,edge.target_element_key
      FROM historical_path path JOIN signal_semantic_context_merge_edges edge
        ON edge.generation_id=NEW.generation_id AND edge.source_element_key=path.target_key
    )
    SELECT 1 FROM historical_path path
    WHERE (path.source_key=NEW.target_element_key AND path.target_key=NEW.source_element_key)
       OR (path.source_key=NEW.source_element_key AND path.target_key=NEW.target_element_key)
  ) THEN
    RAISE EXCEPTION 'Semantic context merge edge would create or duplicate a path.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_signal_semantic_context_merge_edge
BEFORE INSERT ON signal_semantic_context_merge_edges
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_merge_edge_v2();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_annotation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject signal_semantic_context_element_versions%ROWTYPE;
DECLARE predecessor signal_semantic_context_review_annotations%ROWTYPE;
DECLARE operation signal_governance_control_operations%ROWTYPE;related uuid;
BEGIN
  SELECT * INTO subject FROM signal_semantic_context_element_versions WHERE id=NEW.subject_element_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  IF subject.id IS NULL OR subject.workspace_id<>NEW.workspace_id OR subject.generation_id<>NEW.generation_id
     OR operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.status<>'in_progress'
     OR operation.action NOT IN ('annotate-semantic-context-element','merge-semantic-context-elements',
       'correct-semantic-context-element') THEN
    RAISE EXCEPTION 'Semantic context annotation authority is invalid.' USING ERRCODE='23514';
  END IF;
  FOREACH related IN ARRAY NEW.related_element_ids LOOP
    IF NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element
      WHERE element.id=related AND element.workspace_id=NEW.workspace_id
        AND element.generation_id=NEW.generation_id) THEN
      RAISE EXCEPTION 'Semantic context annotation relation is cross-authority.' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF NEW.supersedes_annotation_id IS NULL THEN
    IF NEW.annotation_version<>1 OR NEW.state<>'open' OR operation.action<>'annotate-semantic-context-element' THEN
      RAISE EXCEPTION 'Semantic context annotation creation is invalid.' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO predecessor FROM signal_semantic_context_review_annotations WHERE id=NEW.supersedes_annotation_id;
    IF predecessor.id IS NULL OR predecessor.workspace_id<>NEW.workspace_id
       OR predecessor.generation_id<>NEW.generation_id OR predecessor.annotation_key<>NEW.annotation_key
       OR predecessor.annotation_version+1<>NEW.annotation_version OR predecessor.state<>'open'
       OR predecessor.annotation_type<>NEW.annotation_type THEN
      RAISE EXCEPTION 'Semantic context annotation successor is invalid.' USING ERRCODE='23514';
    END IF;
    IF NEW.related_element_ids IS DISTINCT FROM predecessor.related_element_ids THEN
      RAISE EXCEPTION 'Semantic context annotation related authority cannot be rebound.' USING ERRCODE='23514';
    END IF;
    IF operation.action='annotate-semantic-context-element'
       AND NEW.subject_element_id IS DISTINCT FROM predecessor.subject_element_id THEN
      RAISE EXCEPTION 'Semantic context annotation resolution must preserve its subject.' USING ERRCODE='23514';
    ELSIF operation.action='correct-semantic-context-element' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.id=NEW.subject_element_id
        AND successor.supersedes_element_id=predecessor.subject_element_id
        AND successor.generation_id=NEW.generation_id
        AND successor.workspace_id=NEW.workspace_id
        AND successor.operation_id=NEW.operation_id
        AND successor.origin_kind='operator_correction'
    ) THEN
      RAISE EXCEPTION 'Semantic context correction annotation must bind to the exact element successor.' USING ERRCODE='23514';
    ELSIF operation.action='merge-semantic-context-elements' AND NEW.resolution='merged' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_merge_edges edge
      WHERE edge.operation_id=NEW.operation_id AND edge.generation_id=NEW.generation_id
        AND edge.workspace_id=NEW.workspace_id
        AND edge.source_predecessor_id=predecessor.subject_element_id
        AND NEW.subject_element_id=predecessor.subject_element_id
        AND edge.target_predecessor_id=ANY(predecessor.related_element_ids)
    ) THEN
      RAISE EXCEPTION 'Semantic context merge-source annotation authority is invalid.' USING ERRCODE='23514';
    ELSIF operation.action='merge-semantic-context-elements' AND NEW.resolution IS DISTINCT FROM 'merged' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_merge_edges edge
      WHERE edge.operation_id=NEW.operation_id AND edge.generation_id=NEW.generation_id
        AND edge.workspace_id=NEW.workspace_id
        AND edge.target_predecessor_id=predecessor.subject_element_id
        AND edge.target_pending_successor_id=NEW.subject_element_id
    ) THEN
      RAISE EXCEPTION 'Semantic context merge-target annotation must bind to the exact target successor.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.annotation_type='near_duplicate' AND NEW.state='resolved' AND NEW.resolution='merged'
     AND operation.action<>'merge-semantic-context-elements' THEN
    RAISE EXCEPTION 'Near duplicate merged resolution requires atomic merge.' USING ERRCODE='23514';
  END IF;
  IF NEW.annotation_type='near_duplicate' AND NEW.state='resolved'
     AND NEW.resolution NOT IN ('merged','kept_distinct') THEN
    RAISE EXCEPTION 'Near duplicate resolution is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.annotation_type IN ('uncertain','needs_more_context') AND NEW.state='resolved'
     AND NEW.resolution NOT IN ('context_sufficient','not_supported') THEN
    RAISE EXCEPTION 'Uncertainty resolution is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.annotation_type='locale_unresolved' AND NEW.state='resolved'
     AND NEW.resolution NOT IN ('governed_locale','global') THEN
    RAISE EXCEPTION 'Locale resolution is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.annotation_type='competitive_unit_unresolved' AND NEW.state='resolved'
     AND NEW.resolution NOT IN ('canonical_unit','not_applicable') THEN
    RAISE EXCEPTION 'Competitive-unit resolution is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_signal_semantic_context_annotation
BEFORE INSERT ON signal_semantic_context_review_annotations
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_annotation_v2();

CREATE TRIGGER trg_protect_signal_semantic_context_merge_edges
BEFORE UPDATE OR DELETE ON signal_semantic_context_merge_edges
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_append_only_v1();
CREATE TRIGGER trg_protect_signal_semantic_context_annotations
BEFORE UPDATE OR DELETE ON signal_semantic_context_review_annotations
FOR EACH ROW EXECUTE FUNCTION protect_signal_semantic_context_append_only_v1();

-- Extend the existing element trust boundary for merge/correction operations.
CREATE OR REPLACE FUNCTION validate_signal_semantic_context_element_operation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;generation_status text;
DECLARE artifact_kind text;artifact_authority text;group_artifact uuid;
DECLARE generation_has_provider_lineage boolean;generation_profile_id uuid;
DECLARE workspace_organization_id uuid;workspace_brand_id uuid;
BEGIN
  SELECT generation.status,(generation.proposal_model IS NOT NULL
      AND generation.proposal_model_version IS NOT NULL
      AND generation.proposal_prompt_digest IS NOT NULL
      AND generation.proposal_pricing_version IS NOT NULL
      AND generation.proposal_provider_lineage IS NOT NULL
      AND generation.proposal_provider_lineage_digest IS NOT NULL),
      generation.brand_os_profile_id,workspace.organization_id,workspace.brand_id
    INTO generation_status,generation_has_provider_lineage,generation_profile_id,
      workspace_organization_id,workspace_brand_id
    FROM signal_semantic_context_generations generation
    JOIN signal_workspaces workspace ON workspace.id=generation.workspace_id
    WHERE generation.id=NEW.generation_id AND generation.workspace_id=NEW.workspace_id;
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  SELECT workspace_artifact_kind,workspace_authority_digest INTO artifact_kind,artifact_authority
    FROM analysis_artifacts WHERE id=NEW.artifact_id AND workspace_id=NEW.workspace_id;
  SELECT artifact_id INTO group_artifact FROM analysis_evidence_groups WHERE id=NEW.evidence_group_id;
  IF generation_status IS DISTINCT FROM 'draft' OR operation.id IS NULL
     OR operation.workspace_id<>NEW.workspace_id OR operation.actor_user_id<>NEW.proposed_by_user_id
     OR operation.status<>'in_progress' OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.proposed_by_user_id) THEN
    RAISE EXCEPTION 'Semantic context element operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  IF artifact_kind IS DISTINCT FROM 'semantic_context' OR artifact_authority IS DISTINCT FROM NEW.element_digest
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
    WHERE predecessor.id=NEW.supersedes_element_id AND predecessor.workspace_id=NEW.workspace_id
      AND predecessor.generation_id=NEW.generation_id AND predecessor.element_key=NEW.element_key
      AND predecessor.element_version=NEW.element_version-1
  ) THEN
    RAISE EXCEPTION 'Semantic context element supersession is incompatible.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind IN ('server_projection','provider_proposal') AND
     (operation.action<>'append-semantic-context-proposals' OR NEW.disposition<>'pending') THEN
    RAISE EXCEPTION 'Semantic context proposal disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_decision' AND
     (operation.action NOT IN ('decide-semantic-context-element','bulk-approve-semantic-context-elements')
       OR NEW.disposition NOT IN ('approved','rejected')
       OR NEW.decided_by_user_id IS DISTINCT FROM operation.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context operator decision is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_merge' AND (operation.action<>'merge-semantic-context-elements'
       OR NEW.disposition<>'merged') THEN
    RAISE EXCEPTION 'Semantic context merged disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='operator_correction' AND (operation.action NOT IN (
      'decide-semantic-context-element','correct-semantic-context-element','merge-semantic-context-elements')
      OR NEW.disposition<>'pending') THEN
    RAISE EXCEPTION 'Semantic context correction disposition is invalid.' USING ERRCODE='23514';
  END IF;
  IF NEW.origin_kind='provider_proposal' AND NOT generation_has_provider_lineage THEN
    RAISE EXCEPTION 'Provider proposal lineage is incomplete.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_validate_signal_semantic_context_element
  ON signal_semantic_context_element_versions;
DROP TRIGGER IF EXISTS trg_validate_signal_semantic_context_element_operation_v2
  ON signal_semantic_context_element_versions;
CREATE TRIGGER trg_validate_signal_semantic_context_element_operation_v2
BEFORE INSERT ON signal_semantic_context_element_versions
FOR EACH ROW EXECUTE FUNCTION validate_signal_semantic_context_element_operation_v2();

CREATE OR REPLACE FUNCTION validate_signal_semantic_context_event_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation signal_governance_control_operations%ROWTYPE;expected_action text;
BEGIN
  SELECT * INTO operation FROM signal_governance_control_operations WHERE id=NEW.operation_id;
  expected_action:=CASE NEW.event_kind
    WHEN 'generation_created' THEN 'create-semantic-context-draft'
    WHEN 'generation_reconciled' THEN 'reconcile-semantic-context-generation'
    WHEN 'proposals_appended' THEN 'append-semantic-context-proposals'
    WHEN 'element_approved' THEN 'decide-semantic-context-element'
    WHEN 'element_rejected' THEN 'decide-semantic-context-element'
    WHEN 'element_corrected' THEN CASE WHEN operation.action='correct-semantic-context-element'
      THEN 'correct-semantic-context-element' ELSE 'decide-semantic-context-element' END
    WHEN 'elements_bulk_approved' THEN 'bulk-approve-semantic-context-elements'
    WHEN 'elements_merged' THEN 'merge-semantic-context-elements'
    WHEN 'review_annotation_created' THEN 'annotate-semantic-context-element'
    WHEN 'review_annotation_updated' THEN CASE
      WHEN operation.action IN ('merge-semantic-context-elements','correct-semantic-context-element')
        THEN operation.action ELSE 'annotate-semantic-context-element' END
    WHEN 'review_annotation_resolved' THEN CASE
      WHEN operation.action IN ('merge-semantic-context-elements','correct-semantic-context-element')
        THEN operation.action ELSE 'annotate-semantic-context-element' END
    WHEN 'generation_published' THEN 'publish-semantic-context-generation'
  END;
  IF operation.id IS NULL OR operation.workspace_id<>NEW.workspace_id
     OR operation.actor_user_id<>NEW.actor_user_id OR operation.action IS DISTINCT FROM expected_action
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Semantic context event operation authority is invalid.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

COMMENT ON TABLE signal_semantic_context_merge_edges IS
  'Append-only N-to-one review graph under the 0091 Semantic Context authority.';
COMMENT ON TABLE signal_semantic_context_review_annotations IS
  'Append-only, versioned operator review annotations; never serving tags.';
COMMENT ON COLUMN signal_semantic_context_generations.publication_schema_version IS
  'Write-once V2 publication contract discriminator; historical V1 rows remain null.';
