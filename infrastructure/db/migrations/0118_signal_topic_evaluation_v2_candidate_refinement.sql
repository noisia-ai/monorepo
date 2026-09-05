-- 0118: append-only, local-disposable candidate-refinement control plane.
--
-- This is deliberately a Lab-only migration.  It gives a bounded model a narrow,
-- session-scoped evidence-navigation surface around one existing pending candidate.  It cannot
-- alter editorial history, create a Topic Contract, adopt, publish or serve a Topic.

DO $$
BEGIN
  IF current_database()!~'^noisia_topic_eval_lab_[a-z0-9_]{8,64}$'
     OR to_regclass('noisia_topic_evaluation_lab.clone_provenance') IS NULL
     OR NOT EXISTS(
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal=116 AND migration_name='0116_signal_topic_evaluation_disposable_lab_execution.sql'
         AND disposition='applied'
     )
     OR NOT EXISTS(
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal=117 AND migration_name='0117_signal_topic_evaluation_lab_evaluation_brief.sql'
         AND disposition='applied'
     ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Migration 0118 requires the externally anchored disposable Topic Lab.';
  END IF;
END;
$$;

CREATE TABLE signal_topic_evaluation_v2_candidate_refinement_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_runs(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_snapshots(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_candidates(id) ON DELETE RESTRICT,
  base_model_revision_id uuid NOT NULL
    REFERENCES signal_topic_evaluation_v2_candidate_revisions(id) ON DELETE RESTRICT,
  candidate_editorial_revision_id uuid
    REFERENCES signal_topic_evaluation_v2_candidate_editorial_revisions(id) ON DELETE RESTRICT,
  candidate_revision integer NOT NULL,
  candidate_state_token text NOT NULL,
  candidate_version_digest text NOT NULL,
  brand_os_authority_digest text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_cluster_keys text[] NOT NULL,
  idempotency_key text NOT NULL,
  start_input_digest text NOT NULL,
  session_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  session_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_signal_topic_evaluation_v2_refinement_session_scope
    UNIQUE(id,workspace_id,run_id,snapshot_id,candidate_id),
  CONSTRAINT uq_signal_topic_evaluation_v2_refinement_session_idempotency
    UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_refinement_session_key
    UNIQUE(workspace_id,session_key),
  CONSTRAINT signal_topic_evaluation_v2_refinement_session_shape CHECK(
    candidate_revision>=1
    AND candidate_state_token~'^sha256:[0-9a-f]{64}$'
    AND candidate_version_digest~'^sha256:[0-9a-f]{64}$'
    AND brand_os_authority_digest~'^sha256:[0-9a-f]{64}$'
    AND idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'
    AND start_input_digest~'^sha256:[0-9a-f]{64}$'
    AND session_key~'^topic-refine-[a-f0-9]{16}$'
    AND cardinality(source_cluster_keys) BETWEEN 1 AND 12
    AND NOT source_cluster_keys&&ARRAY['']::text[]
    AND expires_at=created_at+interval '15 minutes'
    AND session_digest~'^sha256:[0-9a-f]{64}$'
  )
);

CREATE TABLE signal_topic_evaluation_v2_candidate_refinement_navigation_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  trace_index integer NOT NULL,
  operation text NOT NULL,
  request jsonb NOT NULL,
  request_digest text NOT NULL,
  result_digest text NOT NULL,
  result_bytes integer NOT NULL,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  cursor_digest text,
  cursor_context_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_topic_evaluation_v2_refinement_trace_session_fk FOREIGN KEY(
    session_id,workspace_id,run_id,snapshot_id,candidate_id
  ) REFERENCES signal_topic_evaluation_v2_candidate_refinement_sessions(
    id,workspace_id,run_id,snapshot_id,candidate_id
  ) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_v2_refinement_trace_index UNIQUE(session_id,trace_index),
  CONSTRAINT signal_topic_evaluation_v2_refinement_trace_shape CHECK(
    trace_index BETWEEN 0 AND 11
    AND operation IN('candidate_context','cluster_profile','representative_mentions',
      'search_cluster','compare_clusters','brand_os_context')
    AND jsonb_typeof(request)='object'
    AND request_digest~'^sha256:[0-9a-f]{64}$'
    AND result_digest~'^sha256:[0-9a-f]{64}$'
    AND result_bytes BETWEEN 1 AND 32768
    AND cardinality(evidence_refs) BETWEEN 0 AND 48
    AND NOT evidence_refs&&ARRAY['']::text[]
    AND (cursor_digest IS NULL OR cursor_digest~'^sha256:[0-9a-f]{64}$')
    AND (cursor_context_digest IS NULL OR cursor_context_digest~'^sha256:[0-9a-f]{64}$')
  )
);

CREATE TABLE signal_topic_evaluation_v2_candidate_refinement_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL,
  evidence_refs text[] NOT NULL,
  related_candidate_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  recommendation text NOT NULL,
  rationale text NOT NULL,
  idempotency_key text NOT NULL,
  proposal_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_topic_evaluation_v2_refinement_proposal_session_fk FOREIGN KEY(
    session_id,workspace_id,run_id,snapshot_id,candidate_id
  ) REFERENCES signal_topic_evaluation_v2_candidate_refinement_sessions(
    id,workspace_id,run_id,snapshot_id,candidate_id
  ) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_v2_one_refinement_proposal UNIQUE(session_id),
  CONSTRAINT uq_signal_topic_evaluation_v2_refinement_proposal_idempotency
    UNIQUE(session_id,idempotency_key),
  CONSTRAINT signal_topic_evaluation_v2_refinement_proposal_shape CHECK(
    btrim(display_name)<>'' AND char_length(display_name)<=160
    AND btrim(description)<>'' AND char_length(description)<=1500
    AND cardinality(evidence_refs) BETWEEN 1 AND 48
    AND NOT evidence_refs&&ARRAY['']::text[]
    AND cardinality(related_candidate_keys) BETWEEN 0 AND 8
    AND NOT related_candidate_keys&&ARRAY['']::text[]
    AND recommendation IN('none','consider_merge','consider_split')
    AND (recommendation<>'consider_merge' OR cardinality(related_candidate_keys)>=1)
    AND btrim(rationale)<>'' AND char_length(rationale)<=1200
    AND idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'
    AND proposal_digest~'^sha256:[0-9a-f]{64}$'
  )
);

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_candidate_refinement_session_digest_v1(
  session_id uuid, workspace uuid, run uuid, snapshot uuid, candidate uuid,
  base_revision uuid, editorial_revision uuid, current_revision integer,
  state_token text, version_digest text, brand_os_digest text, actor uuid,
  clusters text[], idempotency text, expiry timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-candidate-refinement-v1',
    'session_id',session_id,'workspace_id',workspace,'run_id',run,'snapshot_id',snapshot,
    'candidate_id',candidate,'base_model_revision_id',base_revision,
    'candidate_editorial_revision_id',editorial_revision,'candidate_revision',current_revision,
    'candidate_state_token',state_token,'candidate_version_digest',version_digest,
    'brand_os_authority_digest',brand_os_digest,'actor_user_id',actor,
    'source_cluster_keys',to_jsonb(clusters),'idempotency_key',idempotency,'expires_at',expiry
  ))
$$;

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_candidate_refinement_cursor_context_digest_v1(
  session_digest text, candidate_version_digest text, expiry timestamptz,
  cluster_key text, filters jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-candidate-refinement-cursor-v1',
    'session_digest',session_digest,'candidate_version_digest',candidate_version_digest,
    'expires_at',expiry,'operation','search_cluster','cluster_key',cluster_key,'filters',filters
  ))
$$;

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_candidate_refinement_start_input_digest_v1(
  run_key_value text, candidate_key_value text, revision_value integer, state_token_value text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'run_key',run_key_value,'candidate_key',candidate_key_value,
    'expected_revision',revision_value,'state_token',state_token_value
  ))
$$;

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_candidate_refinement_proposal_digest_v1(
  session_id uuid, session_digest text, display_name_value text, description_value text,
  evidence_values text[], related_values text[], recommendation_value text, rationale_value text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-candidate-refinement-v1','session_id',session_id,
    'session_digest',session_digest,'display_name',display_name_value,
    'description',description_value,'evidence_refs',to_jsonb(evidence_values),
    'related_candidate_keys',to_jsonb(related_values),'recommendation',recommendation_value,
    'rationale',rationale_value
  ))
$$;

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_candidate_refinement_filters_valid_v1(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value)='object'
    AND value-(ARRAY['language','market','scope','month_from','month_to','query'])='{}'::jsonb
    AND (NOT (value ? 'language') OR (jsonb_typeof(value->'language')='string'
      AND value->>'language'~'^[a-z]{2}$'))
    AND (NOT (value ? 'market') OR (jsonb_typeof(value->'market')='string'
      AND value->>'market'~'^[A-Z]{2}$'))
    AND (NOT (value ? 'scope') OR (jsonb_typeof(value->'scope')='string'
      AND value->>'scope' IN('primary_brand','same_entity','competitor','category','other')))
    AND (NOT (value ? 'month_from') OR (jsonb_typeof(value->'month_from')='string'
      AND value->>'month_from'~'^20[0-9]{2}-(0[1-9]|1[0-2])$'))
    AND (NOT (value ? 'month_to') OR (jsonb_typeof(value->'month_to')='string'
      AND value->>'month_to'~'^20[0-9]{2}-(0[1-9]|1[0-2])$'))
    AND (NOT (value ? 'month_from') OR NOT (value ? 'month_to') OR value->>'month_from'<=value->>'month_to')
    AND (NOT (value ? 'query') OR (jsonb_typeof(value->'query')='string'
      AND char_length(btrim(value->>'query')) BETWEEN 2 AND 80
      AND value->>'query' !~ '[[:cntrl:]]'))
$$;

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_session_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate_row signal_topic_evaluation_v2_candidates%ROWTYPE;
DECLARE run_row signal_topic_evaluation_v2_runs%ROWTYPE;
DECLARE snapshot_row signal_topic_evaluation_v2_snapshots%ROWTYPE;
DECLARE base_row signal_topic_evaluation_v2_candidate_revisions%ROWTYPE;
DECLARE editorial_row signal_topic_evaluation_v2_candidate_editorial_revisions%ROWTYPE;
DECLARE actor_row users%ROWTYPE;
DECLARE current_revision integer;
DECLARE current_version_digest text;
DECLARE current_state text;
DECLARE expected_digest text;
BEGIN
  SELECT * INTO candidate_row FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id;
  SELECT * INTO run_row FROM signal_topic_evaluation_v2_runs WHERE id=candidate_row.run_id;
  SELECT * INTO snapshot_row FROM signal_topic_evaluation_v2_snapshots WHERE id=run_row.snapshot_id;
  SELECT * INTO base_row FROM signal_topic_evaluation_v2_candidate_revisions
    WHERE candidate_id=NEW.candidate_id AND revision=1;
  SELECT * INTO editorial_row FROM signal_topic_evaluation_v2_candidate_editorial_revisions
    WHERE candidate_id=NEW.candidate_id ORDER BY revision DESC LIMIT 1;
  SELECT * INTO actor_row FROM users WHERE id=NEW.actor_user_id;

  IF candidate_row.id IS NULL OR run_row.id IS NULL OR snapshot_row.id IS NULL OR base_row.id IS NULL
     OR candidate_row.workspace_id<>NEW.workspace_id OR candidate_row.run_id<>NEW.run_id
     OR run_row.workspace_id<>NEW.workspace_id OR run_row.snapshot_id<>NEW.snapshot_id
     OR base_row.run_id<>NEW.run_id OR base_row.workspace_id<>NEW.workspace_id
     OR NEW.base_model_revision_id<>base_row.id
     OR NEW.start_input_digest<>signal_topic_evaluation_v2_candidate_refinement_start_input_digest_v1(
       run_row.run_key,candidate_row.candidate_key,NEW.candidate_revision,NEW.candidate_state_token)
     OR run_row.status<>'completed' OR snapshot_row.state<>'frozen'
     OR candidate_row.status<>'pending' OR candidate_row.adopted OR candidate_row.published OR candidate_row.serving
     OR actor_row.id IS NULL OR actor_row.status<>'active' OR actor_row.user_type<>'noisia_internal'
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
     OR snapshot_row.semantic_context_authority_digest<>NEW.brand_os_authority_digest
     OR signal_topic_evaluation_v2_semantic_authority_digest_v1(snapshot_row.semantic_context_generation_id)
       IS DISTINCT FROM NEW.brand_os_authority_digest
     OR NEW.created_at < clock_timestamp()-interval '1 minute'
     OR NEW.created_at > clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate refinement session authority is invalid.';
  END IF;

  IF editorial_row.id IS NULL THEN
    current_revision:=1;
    current_version_digest:=base_row.payload_digest;
    current_state:='pending';
    IF NEW.candidate_editorial_revision_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate refinement session revision is invalid.';
    END IF;
  ELSE
    current_revision:=editorial_row.revision;
    current_version_digest:=editorial_row.version_digest;
    current_state:=editorial_row.review_state;
    IF NEW.candidate_editorial_revision_id<>editorial_row.id
       OR editorial_row.run_id<>NEW.run_id OR editorial_row.workspace_id<>NEW.workspace_id
       OR editorial_row.base_model_revision_id<>base_row.id THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate refinement session revision is invalid.';
    END IF;
  END IF;

  expected_digest:=signal_topic_evaluation_v2_candidate_refinement_session_digest_v1(
    NEW.id,NEW.workspace_id,NEW.run_id,NEW.snapshot_id,NEW.candidate_id,NEW.base_model_revision_id,
    NEW.candidate_editorial_revision_id,NEW.candidate_revision,NEW.candidate_state_token,
    NEW.candidate_version_digest,NEW.brand_os_authority_digest,NEW.actor_user_id,
    NEW.source_cluster_keys,NEW.idempotency_key,NEW.expires_at);
  IF current_state<>'pending' OR NEW.candidate_revision<>current_revision
     OR NEW.candidate_version_digest<>current_version_digest
     OR NEW.candidate_state_token<>signal_topic_evaluation_v2_candidate_state_token_v1(
       NEW.candidate_id,current_revision,current_version_digest)
     OR NEW.source_cluster_keys<>candidate_row.source_cluster_keys
     OR NEW.source_cluster_keys<>ARRAY(SELECT cluster_key_value FROM unnest(NEW.source_cluster_keys)
       cluster_key_value ORDER BY cluster_key_value)
     OR cardinality(NEW.source_cluster_keys)<>(SELECT count(DISTINCT cluster_key_value)
       FROM unnest(NEW.source_cluster_keys) cluster_key_value)
     OR EXISTS(SELECT 1 FROM unnest(NEW.source_cluster_keys) cluster_key_value
       WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_clusters cluster
         WHERE cluster.snapshot_id=NEW.snapshot_id AND cluster.cluster_key=cluster_key_value))
     OR NEW.session_digest<>expected_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate refinement session seal is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_refinement_session
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_refinement_sessions
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_session_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_trace_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_row signal_topic_evaluation_v2_candidate_refinement_sessions%ROWTYPE;
DECLARE candidate_row signal_topic_evaluation_v2_candidates%ROWTYPE;
DECLARE snapshot_row signal_topic_evaluation_v2_snapshots%ROWTYPE;
DECLARE base_row signal_topic_evaluation_v2_candidate_revisions%ROWTYPE;
DECLARE editorial_row signal_topic_evaluation_v2_candidate_editorial_revisions%ROWTYPE;
DECLARE actor_row users%ROWTYPE;
DECLARE requested_cluster text;
DECLARE requested_clusters text[];
DECLARE requested_limit integer;
DECLARE expected_cursor_context text;
DECLARE current_revision integer;
DECLARE current_version_digest text;
DECLARE current_state text;
BEGIN
  SELECT * INTO session_row FROM signal_topic_evaluation_v2_candidate_refinement_sessions
    WHERE id=NEW.session_id AND workspace_id=NEW.workspace_id AND run_id=NEW.run_id
      AND snapshot_id=NEW.snapshot_id AND candidate_id=NEW.candidate_id;
  SELECT * INTO candidate_row FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id;
  SELECT * INTO snapshot_row FROM signal_topic_evaluation_v2_snapshots WHERE id=NEW.snapshot_id;
  SELECT * INTO base_row FROM signal_topic_evaluation_v2_candidate_revisions
    WHERE candidate_id=NEW.candidate_id AND revision=1;
  SELECT * INTO editorial_row FROM signal_topic_evaluation_v2_candidate_editorial_revisions
    WHERE candidate_id=NEW.candidate_id ORDER BY revision DESC LIMIT 1;
  SELECT * INTO actor_row FROM users WHERE id=session_row.actor_user_id;
  IF editorial_row.id IS NULL THEN
    current_revision:=1;
    current_version_digest:=base_row.payload_digest;
    current_state:='pending';
  ELSE
    current_revision:=editorial_row.revision;
    current_version_digest:=editorial_row.version_digest;
    current_state:=editorial_row.review_state;
  END IF;
  IF session_row.id IS NULL OR NEW.created_at<session_row.created_at
     OR NEW.created_at>session_row.expires_at OR clock_timestamp()>session_row.expires_at
     OR candidate_row.id IS NULL OR snapshot_row.id IS NULL OR base_row.id IS NULL
     OR candidate_row.run_id<>session_row.run_id OR candidate_row.workspace_id<>session_row.workspace_id
     OR base_row.id<>session_row.base_model_revision_id
     OR candidate_row.status<>'pending' OR candidate_row.adopted OR candidate_row.published OR candidate_row.serving
     OR current_state<>'pending' OR current_revision<>session_row.candidate_revision
     OR current_version_digest<>session_row.candidate_version_digest
     OR session_row.candidate_state_token<>signal_topic_evaluation_v2_candidate_state_token_v1(
       session_row.candidate_id,current_revision,current_version_digest)
     OR snapshot_row.semantic_context_authority_digest<>session_row.brand_os_authority_digest
     OR signal_topic_evaluation_v2_semantic_authority_digest_v1(snapshot_row.semantic_context_generation_id)
       IS DISTINCT FROM session_row.brand_os_authority_digest
     OR actor_row.id IS NULL OR actor_row.status<>'active' OR actor_row.user_type<>'noisia_internal'
     OR NOT signal_data_governance_actor_is_valid(session_row.workspace_id,session_row.actor_user_id)
     OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_refinement_proposals
       WHERE session_id=NEW.session_id)
     OR NEW.trace_index<>COALESCE((SELECT max(trace_index)+1
       FROM signal_topic_evaluation_v2_candidate_refinement_navigation_traces
       WHERE session_id=NEW.session_id),0)
     OR NEW.request_digest<>signal_semantic_context_digest_json_v2(NEW.request)
     OR NEW.evidence_refs<>ARRAY(SELECT evidence_ref_value FROM unnest(NEW.evidence_refs)
       evidence_ref_value ORDER BY evidence_ref_value)
     OR cardinality(NEW.evidence_refs)<>(SELECT count(DISTINCT evidence_ref_value)
       FROM unnest(NEW.evidence_refs) evidence_ref_value)
     OR EXISTS(SELECT 1 FROM unnest(NEW.evidence_refs) evidence_ref_value
       WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_cluster_memberships membership
         JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=membership.snapshot_id
         WHERE membership.snapshot_id=session_row.snapshot_id
           AND membership.cluster_key=ANY(session_row.source_cluster_keys)
           AND signal_semantic_context_digest_json_v2(jsonb_build_object(
             'snapshot',snapshot.snapshot_digest,'member_ref',membership.member_ref,
             'source',membership.source_record_digest))=evidence_ref_value)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate refinement trace authority is invalid.';
  END IF;

  IF NEW.result_bytes+COALESCE((SELECT sum(result_bytes)
      FROM signal_topic_evaluation_v2_candidate_refinement_navigation_traces
      WHERE session_id=NEW.session_id),0)>196608 THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate refinement aggregate result budget is invalid.';
  END IF;

  IF NEW.operation='candidate_context' THEN
    IF NEW.request<>'{"operation":"candidate_context"}'::jsonb
       OR cardinality(NEW.evidence_refs)<>0 OR NEW.cursor_digest IS NOT NULL
       OR NEW.cursor_context_digest IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate refinement candidate context is invalid.';
    END IF;
  ELSIF NEW.operation='brand_os_context' THEN
    IF NEW.request<>'{"operation":"brand_os_context"}'::jsonb
       OR cardinality(NEW.evidence_refs)<>0 OR NEW.cursor_digest IS NOT NULL
       OR NEW.cursor_context_digest IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate refinement Brand OS context is invalid.';
    END IF;
  ELSIF NEW.operation='cluster_profile' THEN
    requested_cluster:=NEW.request->>'cluster_key';
    IF NEW.request-(ARRAY['operation','cluster_key'])<>'{}'::jsonb
       OR NEW.request->>'operation' IS DISTINCT FROM 'cluster_profile' OR requested_cluster IS NULL
       OR requested_cluster!~'^[a-z0-9][a-z0-9._:-]{0,179}$'
       OR cardinality(NEW.evidence_refs)<>0 OR NEW.cursor_digest IS NOT NULL
       OR NEW.cursor_context_digest IS NOT NULL
       OR requested_cluster<>ALL(session_row.source_cluster_keys) THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate refinement cluster profile is invalid.';
    END IF;
  ELSIF NEW.operation='compare_clusters' THEN
    requested_clusters:=ARRAY(SELECT jsonb_array_elements_text(NEW.request->'cluster_keys'));
    IF NEW.request-(ARRAY['operation','cluster_keys'])<>'{}'::jsonb
       OR NEW.request->>'operation' IS DISTINCT FROM 'compare_clusters'
       OR jsonb_typeof(NEW.request->'cluster_keys') IS DISTINCT FROM 'array'
       OR cardinality(requested_clusters)<>2 OR requested_clusters[1]=requested_clusters[2]
       OR EXISTS(SELECT 1 FROM unnest(requested_clusters) cluster_key_value
         WHERE cluster_key_value!~'^[a-z0-9][a-z0-9._:-]{0,179}$'
           OR cluster_key_value<>ALL(session_row.source_cluster_keys))
       OR cardinality(NEW.evidence_refs)<>0 OR NEW.cursor_digest IS NOT NULL
       OR NEW.cursor_context_digest IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate refinement cluster comparison is invalid.';
    END IF;
  ELSIF NEW.operation IN('representative_mentions','search_cluster') THEN
    requested_cluster:=NEW.request->>'cluster_key';
    IF NEW.request->>'operation' IS DISTINCT FROM NEW.operation OR requested_cluster IS NULL
       OR requested_cluster!~'^[a-z0-9][a-z0-9._:-]{0,179}$'
       OR requested_cluster<>ALL(session_row.source_cluster_keys)
       OR jsonb_typeof(NEW.request->'limit') IS DISTINCT FROM 'number'
       OR NEW.request->>'limit'!~'^[0-9]+$'
       OR NOT signal_topic_evaluation_v2_candidate_refinement_filters_valid_v1(NEW.request->'filters') THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 candidate refinement mention navigation is invalid.';
    END IF;
    requested_limit:=(NEW.request->>'limit')::integer;
    IF NEW.operation='representative_mentions' THEN
      IF NEW.request-(ARRAY['operation','cluster_key','limit','filters'])<>'{}'::jsonb
         OR requested_limit NOT BETWEEN 3 AND 12
         OR cardinality(NEW.evidence_refs)>requested_limit
         OR NEW.cursor_digest IS NOT NULL OR NEW.cursor_context_digest IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='23514',
          MESSAGE='Topic Evaluation V2 candidate refinement representative navigation is invalid.';
      END IF;
    ELSE
      IF NEW.request-(ARRAY['operation','cluster_key','limit','cursor','filters'])<>'{}'::jsonb
         OR requested_limit NOT BETWEEN 1 AND 20
         OR cardinality(NEW.evidence_refs)>requested_limit
         OR NOT (NEW.request ? 'cursor')
         OR (jsonb_typeof(NEW.request->'cursor') IS DISTINCT FROM 'null'
             AND jsonb_typeof(NEW.request->'cursor') IS DISTINCT FROM 'string') THEN
        RAISE EXCEPTION USING ERRCODE='23514',
          MESSAGE='Topic Evaluation V2 candidate refinement search navigation is invalid.';
      END IF;
      IF jsonb_typeof(NEW.request->'cursor')='null' THEN
        IF NEW.cursor_digest IS NOT NULL OR NEW.cursor_context_digest IS NOT NULL THEN
          RAISE EXCEPTION USING ERRCODE='23514',
            MESSAGE='Topic Evaluation V2 candidate refinement search cursor is invalid.';
        END IF;
      ELSE
        expected_cursor_context:=signal_topic_evaluation_v2_candidate_refinement_cursor_context_digest_v1(
          session_row.session_digest,session_row.candidate_version_digest,session_row.expires_at,
          requested_cluster,NEW.request->'filters');
        IF char_length(NEW.request->>'cursor') NOT BETWEEN 16 AND 512
           OR NEW.cursor_digest<>signal_semantic_context_digest_json_v2(
             jsonb_build_object('cursor',NEW.request->>'cursor'))
           OR NEW.cursor_context_digest<>expected_cursor_context THEN
          RAISE EXCEPTION USING ERRCODE='23514',
            MESSAGE='Topic Evaluation V2 candidate refinement search cursor is invalid.';
        END IF;
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate refinement operation is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_refinement_trace
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_refinement_navigation_traces
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_trace_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_proposal_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_row signal_topic_evaluation_v2_candidate_refinement_sessions%ROWTYPE;
DECLARE candidate_row signal_topic_evaluation_v2_candidates%ROWTYPE;
DECLARE run_row signal_topic_evaluation_v2_runs%ROWTYPE;
DECLARE snapshot_row signal_topic_evaluation_v2_snapshots%ROWTYPE;
DECLARE base_row signal_topic_evaluation_v2_candidate_revisions%ROWTYPE;
DECLARE editorial_row signal_topic_evaluation_v2_candidate_editorial_revisions%ROWTYPE;
DECLARE actor_row users%ROWTYPE;
DECLARE current_revision integer;
DECLARE current_version_digest text;
DECLARE current_state text;
DECLARE expected_digest text;
BEGIN
  SELECT * INTO session_row FROM signal_topic_evaluation_v2_candidate_refinement_sessions
    WHERE id=NEW.session_id AND workspace_id=NEW.workspace_id AND run_id=NEW.run_id
      AND snapshot_id=NEW.snapshot_id AND candidate_id=NEW.candidate_id;
  SELECT * INTO candidate_row FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id;
  SELECT * INTO run_row FROM signal_topic_evaluation_v2_runs WHERE id=candidate_row.run_id;
  SELECT * INTO snapshot_row FROM signal_topic_evaluation_v2_snapshots WHERE id=NEW.snapshot_id;
  SELECT * INTO base_row FROM signal_topic_evaluation_v2_candidate_revisions
    WHERE candidate_id=NEW.candidate_id AND revision=1;
  SELECT * INTO editorial_row FROM signal_topic_evaluation_v2_candidate_editorial_revisions
    WHERE candidate_id=NEW.candidate_id ORDER BY revision DESC LIMIT 1;
  SELECT * INTO actor_row FROM users WHERE id=session_row.actor_user_id;

  IF session_row.id IS NULL OR candidate_row.id IS NULL OR run_row.id IS NULL OR snapshot_row.id IS NULL
     OR base_row.id IS NULL
     OR NEW.created_at<session_row.created_at OR NEW.created_at>session_row.expires_at
     OR clock_timestamp()>session_row.expires_at OR run_row.status<>'completed'
     OR candidate_row.run_id<>session_row.run_id OR candidate_row.workspace_id<>session_row.workspace_id
     OR run_row.snapshot_id<>session_row.snapshot_id OR base_row.id<>session_row.base_model_revision_id
     OR snapshot_row.semantic_context_authority_digest<>session_row.brand_os_authority_digest
     OR signal_topic_evaluation_v2_semantic_authority_digest_v1(snapshot_row.semantic_context_generation_id)
       IS DISTINCT FROM session_row.brand_os_authority_digest
     OR actor_row.id IS NULL OR actor_row.status<>'active' OR actor_row.user_type<>'noisia_internal'
     OR NOT signal_data_governance_actor_is_valid(session_row.workspace_id,session_row.actor_user_id)
     OR candidate_row.status<>'pending' OR candidate_row.adopted OR candidate_row.published OR candidate_row.serving
     OR NEW.evidence_refs<>ARRAY(SELECT evidence_ref_value FROM unnest(NEW.evidence_refs)
       evidence_ref_value ORDER BY evidence_ref_value)
     OR NEW.related_candidate_keys<>ARRAY(SELECT candidate_key_value FROM unnest(NEW.related_candidate_keys)
       candidate_key_value ORDER BY candidate_key_value)
     OR cardinality(NEW.evidence_refs)<>(SELECT count(DISTINCT evidence_ref_value)
       FROM unnest(NEW.evidence_refs) evidence_ref_value)
     OR cardinality(NEW.related_candidate_keys)<>(SELECT count(DISTINCT candidate_key_value)
       FROM unnest(NEW.related_candidate_keys) candidate_key_value)
     OR EXISTS(SELECT 1 FROM unnest(NEW.evidence_refs) evidence_ref_value
       WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_refinement_navigation_traces trace
         WHERE trace.session_id=NEW.session_id AND evidence_ref_value=ANY(trace.evidence_refs)))
     OR EXISTS(SELECT 1 FROM unnest(NEW.related_candidate_keys) candidate_key_value
       WHERE candidate_key_value=(SELECT candidate_key FROM signal_topic_evaluation_v2_candidates
           WHERE id=NEW.candidate_id)
         OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidates related
           WHERE related.run_id=NEW.run_id AND related.candidate_key=candidate_key_value)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate refinement proposal authority is invalid.';
  END IF;

  IF editorial_row.id IS NULL THEN
    current_revision:=1;
    current_version_digest:=base_row.payload_digest;
    current_state:='pending';
  ELSE
    current_revision:=editorial_row.revision;
    current_version_digest:=editorial_row.version_digest;
    current_state:=editorial_row.review_state;
  END IF;
  expected_digest:=signal_topic_evaluation_v2_candidate_refinement_proposal_digest_v1(
    NEW.session_id,session_row.session_digest,NEW.display_name,NEW.description,NEW.evidence_refs,
    NEW.related_candidate_keys,NEW.recommendation,NEW.rationale);
  IF current_state<>'pending' OR session_row.candidate_revision<>current_revision
     OR session_row.candidate_version_digest<>current_version_digest
     OR session_row.candidate_state_token<>signal_topic_evaluation_v2_candidate_state_token_v1(
       NEW.candidate_id,current_revision,current_version_digest)
     OR NEW.proposal_digest<>expected_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate refinement proposal is stale or invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_refinement_proposal
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_refinement_proposals
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_refinement_proposal_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000',
    MESSAGE='Topic Evaluation V2 candidate refinement control plane is append-only.';
END;
$$;

CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_refinement_sessions
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_refinement_sessions
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_refinement_traces
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_refinement_navigation_traces
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_candidate_refinement_proposals
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_candidate_refinement_proposals
FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_candidate_refinement_v1();

CREATE INDEX idx_signal_topic_evaluation_v2_refinement_session_candidate
  ON signal_topic_evaluation_v2_candidate_refinement_sessions(candidate_id,created_at DESC);
CREATE INDEX idx_signal_topic_evaluation_v2_refinement_trace_session
  ON signal_topic_evaluation_v2_candidate_refinement_navigation_traces(session_id,trace_index);
CREATE INDEX idx_signal_topic_evaluation_v2_refinement_proposal_candidate
  ON signal_topic_evaluation_v2_candidate_refinement_proposals(candidate_id,created_at DESC);

COMMENT ON TABLE signal_topic_evaluation_v2_candidate_refinement_sessions IS
  'Local-disposable, append-only sealed sessions for bounded candidate evidence navigation. They do not create or activate Topics.';
COMMENT ON TABLE signal_topic_evaluation_v2_candidate_refinement_proposals IS
  'Append-only review context only. A proposal cannot save editorial state, merge/split candidates, adopt, publish or serve a Topic.';
