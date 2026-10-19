-- 0112: additive, provider-disabled full-evidence Topic Evaluation control plane.
-- Stores stable membership only. Mention text remains in mentions and is read/sanitized on demand.

CREATE TABLE signal_topic_evaluation_v2_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  snapshot_key text NOT NULL,
  import_contract_version text NOT NULL,
  source_run_key text NOT NULL,
  source_algorithm_key text NOT NULL,
  source_seed integer NOT NULL,
  source_manifest_digest text NOT NULL,
  packet_source_manifest_digest text NOT NULL,
  source_assignment_digest text NOT NULL,
  source_export_digest text NOT NULL,
  source_result_digest text NOT NULL,
  source_packet_file_digest text NOT NULL,
  artifact_binding_digest text NOT NULL,
  membership_binding_digest text NOT NULL,
  packet_artifact_id uuid NOT NULL REFERENCES signal_topic_discovery_review_packets(artifact_id) ON DELETE RESTRICT,
  packet_digest text NOT NULL,
  rights_digest text NOT NULL,
  semantic_context_generation_id uuid NOT NULL REFERENCES signal_semantic_context_generations(id) ON DELETE RESTRICT,
  semantic_context_authority_digest text NOT NULL,
  cluster_count integer NOT NULL,
  membership_count integer NOT NULL,
  snapshot_digest text NOT NULL,
  state text NOT NULL DEFAULT 'frozen',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_signal_topic_evaluation_v2_snapshot_key UNIQUE(workspace_id,snapshot_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_snapshot_digest UNIQUE(workspace_id,snapshot_digest),
  CONSTRAINT uq_signal_topic_evaluation_v2_snapshot_workspace UNIQUE(id,workspace_id),
  CONSTRAINT signal_topic_evaluation_v2_snapshot_shape CHECK(
    import_contract_version='signal-topic-evaluation-frozen-membership-import-v1'
    AND source_run_key='backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17'
    AND source_algorithm_key='bertopic-bge-detail' AND source_seed=17
    AND cluster_count=116 AND membership_count=21195 AND state='frozen'
    AND source_manifest_digest='sha256:4244d4227087f28c93ca72946205b9e40cd69c3edd5df118599b1e233d868720'
    AND packet_source_manifest_digest='sha256:9300ea7a0e50870bf2b4dffe58e3e186628b2577692dccf27f5137177bdaed8b'
    AND source_assignment_digest='sha256:59b7e6833192fd6bcae1291b9cc42dc11d98cb22c31587e1acedc67d0587a8c3'
    AND source_export_digest='sha256:3cf49523ebe80a0044eaac6f03de47c787f62e5908a696519d54288de6c4afd9'
    AND source_result_digest='sha256:33a24cc7dd510ce317d5ec056aa464d55ddd1f0b5590efb32e8118268a102707'
    AND source_packet_file_digest='sha256:cf249fa062ee6104c7d4c9f2325b0ea27bd7a2705a2807e262d4cfd1851f1847'
    AND artifact_binding_digest~'^sha256:[0-9a-f]{64}$'
    AND membership_binding_digest~'^sha256:[0-9a-f]{64}$'
    AND packet_digest~'^sha256:[0-9a-f]{64}$' AND rights_digest~'^sha256:[0-9a-f]{64}$'
    AND semantic_context_authority_digest~'^sha256:[0-9a-f]{64}$'
    AND snapshot_digest~'^sha256:[0-9a-f]{64}$')
);

CREATE TABLE signal_topic_evaluation_v2_clusters (
  snapshot_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_snapshots(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  cluster_key text NOT NULL,
  proposal_key text,
  member_count integer NOT NULL,
  profile jsonb NOT NULL,
  profile_digest text NOT NULL,
  PRIMARY KEY(snapshot_id,cluster_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_cluster_workspace UNIQUE(snapshot_id,cluster_key,workspace_id),
  CONSTRAINT signal_topic_evaluation_v2_cluster_shape CHECK(
    cluster_key~'^[a-z0-9][a-z0-9._:-]{0,179}$' AND member_count>0
    AND jsonb_typeof(profile)='object' AND profile-(ARRAY['label','terms','phrases','limitations','distributions','centrality_available'])='{}'::jsonb
    AND jsonb_typeof(profile->'label')='string' AND jsonb_typeof(profile->'terms')='array'
    AND jsonb_typeof(profile->'phrases')='array' AND jsonb_typeof(profile->'limitations')='array'
    AND jsonb_typeof(profile->'distributions')='object' AND jsonb_typeof(profile->'centrality_available')='boolean'
    AND profile_digest~'^sha256:[0-9a-f]{64}$')
);

CREATE TABLE signal_topic_evaluation_v2_cluster_memberships (
  snapshot_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  cluster_key text NOT NULL,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE RESTRICT,
  member_ref text NOT NULL,
  source_record_key text NOT NULL,
  source_record_digest text NOT NULL,
  source_content_hash text NOT NULL,
  canonical_text_hash text NOT NULL,
  canonical_binding_digest text NOT NULL,
  assignment_index integer NOT NULL,
  assignment_label integer NOT NULL,
  assignment_strength real,
  language text,
  market text,
  scope text,
  markets text[] NOT NULL,
  scopes text[] NOT NULL,
  published_month text NOT NULL,
  stratum text NOT NULL,
  cluster_rank integer NOT NULL,
  PRIMARY KEY(snapshot_id,mention_id),
  CONSTRAINT signal_topic_evaluation_v2_membership_cluster_fk FOREIGN KEY(snapshot_id,cluster_key)
    REFERENCES signal_topic_evaluation_v2_clusters(snapshot_id,cluster_key) ON DELETE RESTRICT,
  CONSTRAINT uq_signal_topic_evaluation_v2_member_ref UNIQUE(snapshot_id,member_ref),
  CONSTRAINT uq_signal_topic_evaluation_v2_assignment_index UNIQUE(snapshot_id,assignment_index),
  CONSTRAINT uq_signal_topic_evaluation_v2_source_record_key UNIQUE(snapshot_id,source_record_key),
  CONSTRAINT signal_topic_evaluation_v2_membership_shape CHECK(
    member_ref~'^sha256:[0-9a-f]{64}$' AND source_record_key~'^sha256:[0-9a-f]{64}$'
    AND source_record_digest~'^sha256:[0-9a-f]{64}$' AND source_content_hash~'^sha256:[0-9a-f]{64}$'
    AND canonical_text_hash<>'' AND canonical_binding_digest~'^sha256:[0-9a-f]{64}$'
    AND assignment_index BETWEEN 0 AND 21194 AND assignment_label BETWEEN -1 AND 114
    AND (assignment_strength IS NULL OR assignment_strength BETWEEN 0 AND 1)
    AND (language IS NULL OR language~'^[a-z]{2}$') AND (market IS NULL OR market~'^[A-Z]{2}$')
    AND (scope IS NULL OR scope IN('primary_brand','same_entity','competitor','category','other'))
    AND cardinality(markets) BETWEEN 1 AND 4 AND cardinality(scopes) BETWEEN 1 AND 4
    AND NOT markets&&ARRAY['']::text[] AND NOT scopes&&ARRAY['']::text[]
    AND published_month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'
    AND stratum IN('central','edge','minority') AND cluster_rank>0)
);
CREATE INDEX idx_signal_topic_evaluation_v2_membership_navigation
  ON signal_topic_evaluation_v2_cluster_memberships(snapshot_id,cluster_key,language,market,scope,published_month,cluster_rank,member_ref);

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_canonical_membership_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_binding text; cluster_proposal text; mention_row record;
BEGIN
  SELECT mention.*,source.workspace_id source_workspace_id,source.status source_status
    INTO mention_row FROM mentions mention JOIN data_sources source ON source.id=mention.data_source_id
    WHERE mention.id=NEW.mention_id;
  SELECT proposal_key INTO cluster_proposal FROM signal_topic_evaluation_v2_clusters
    WHERE snapshot_id=NEW.snapshot_id AND cluster_key=NEW.cluster_key;
  expected_binding:=signal_semantic_context_digest_json_v2(jsonb_build_object(
    'contract_version','signal-topic-evaluation-frozen-membership-import-v1',
    'workspace_id',NEW.workspace_id::text,'mention_id',NEW.mention_id::text,
    'canonical_text_hash',NEW.canonical_text_hash,'source_record_key',NEW.source_record_key,
    'source_record_digest',NEW.source_record_digest,'source_content_hash',NEW.source_content_hash,
    'language',NEW.language,'markets',to_jsonb(NEW.markets),'scopes',to_jsonb(NEW.scopes),
    'published_month',NEW.published_month,'assignment_index',NEW.assignment_index,
    'assignment_label',NEW.assignment_label));
  IF mention_row IS NULL OR mention_row.workspace_id<>NEW.workspace_id
     OR mention_row.id<>mention_row.canonical_mention_id OR mention_row.inclusion_status<>'included'
     OR mention_row.source_workspace_id<>NEW.workspace_id OR mention_row.source_status<>'active'
     OR mention_row.text_hash<>NEW.canonical_text_hash
     OR to_char(mention_row.published_at AT TIME ZONE 'UTC','YYYY-MM')<>NEW.published_month
     OR lower(COALESCE(mention_row.language,'und')) IS DISTINCT FROM COALESCE(NEW.language,'und')
     OR NEW.markets<>ARRAY(SELECT DISTINCT value FROM unnest(NEW.markets) value ORDER BY value)
     OR NEW.scopes<>ARRAY(SELECT DISTINCT value FROM unnest(NEW.scopes) value ORDER BY value)
     OR NEW.market IS DISTINCT FROM (CASE WHEN cardinality(NEW.markets)=1 THEN NEW.markets[1] ELSE NULL END)
     OR NEW.scope IS DISTINCT FROM (CASE WHEN cardinality(NEW.scopes)=1 THEN NEW.scopes[1] ELSE NULL END)
     OR (NEW.assignment_label=-1)<>(NEW.cluster_key='outlier-reservoir' AND cluster_proposal IS NULL)
     OR (NEW.assignment_label>=0)<>(NEW.cluster_key<>'outlier-reservoir' AND cluster_proposal IS NOT NULL)
     OR expected_binding<>NEW.canonical_binding_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 canonical frozen membership authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_canonical_membership
BEFORE INSERT ON signal_topic_evaluation_v2_cluster_memberships FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_canonical_membership_v1();

CREATE TABLE signal_topic_evaluation_v2_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_snapshots(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  run_key text NOT NULL,
  confirmation text NOT NULL,
  flight_card jsonb NOT NULL,
  flight_card_digest text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  provider_execution_enabled boolean NOT NULL DEFAULT false,
  provider_call_count integer NOT NULL DEFAULT 0,
  model_turn_count integer NOT NULL DEFAULT 0,
  tool_call_count integer NOT NULL DEFAULT 0,
  total_input_tokens integer NOT NULL DEFAULT 0,
  total_output_tokens integer NOT NULL DEFAULT 0,
  total_tool_result_bytes integer NOT NULL DEFAULT 0,
  reserved_micro_usd bigint NOT NULL DEFAULT 0,
  settled_micro_usd bigint,
  error_code text,
  output_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT uq_signal_topic_evaluation_v2_idempotency UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_run_key UNIQUE(workspace_id,run_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_run_workspace UNIQUE(id,workspace_id),
  CONSTRAINT signal_topic_evaluation_v2_run_bounds CHECK(
    idempotency_key~'^[a-zA-Z0-9._:-]{8,200}$' AND run_key~'^[a-z0-9][a-z0-9._:-]{7,199}$'
    AND confirmation='RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION'
    AND jsonb_typeof(flight_card)='object' AND flight_card_digest~'^sha256:[0-9a-f]{64}$'
    AND flight_card_digest=signal_semantic_context_digest_json_v2(flight_card)
    AND flight_card @> '{"contract_version":"signal-topic-evaluation-full-evidence-v2","execution_enabled":false,"provider_calls_allowed":0,"no_retry":true,"action_time_confirmation_required":true,"preserve_complete_candidate_pool":true,"top_view_limit":10}'::jsonb
    AND (flight_card->>'max_model_turns')::int BETWEEN 1 AND 12
    AND (flight_card->>'max_tool_calls')::int BETWEEN 1 AND 24
    AND (flight_card->>'max_tool_result_bytes')::int BETWEEN 1 AND 32768
    AND (flight_card->>'max_total_tool_result_bytes')::int BETWEEN 1 AND 262144
    AND (flight_card->>'max_total_input_tokens')::int BETWEEN 1 AND 450000
    AND (flight_card->>'max_total_output_tokens')::int BETWEEN 1 AND 50000
    AND (flight_card->>'hard_cap_micro_usd')::bigint BETWEEN 1 AND 20000000
    AND status IN('planned','in_progress','completed','failed','outcome_unknown')
    AND NOT provider_execution_enabled AND provider_call_count=0 AND model_turn_count BETWEEN 0 AND 12
    AND tool_call_count BETWEEN 0 AND 24
    AND total_input_tokens BETWEEN 0 AND 450000 AND total_output_tokens BETWEEN 0 AND 50000
    AND total_tool_result_bytes BETWEEN 0 AND 262144
    AND reserved_micro_usd BETWEEN 0 AND 20000000
    AND (settled_micro_usd IS NULL OR settled_micro_usd BETWEEN 0 AND 20000000)
    AND (error_code IS NULL OR error_code~'^[a-z0-9_]{1,120}$')
    AND (output_digest IS NULL OR output_digest~'^sha256:[0-9a-f]{64}$'))
);

CREATE TABLE signal_topic_evaluation_v2_retrievals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  retrieval_index integer NOT NULL,
  operation text NOT NULL,
  tool_input_digest text NOT NULL,
  result_digest text NOT NULL,
  result_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_signal_topic_evaluation_v2_retrieval UNIQUE(run_id,retrieval_index),
  CONSTRAINT uq_signal_topic_evaluation_v2_retrieval_run UNIQUE(id,run_id),
  CONSTRAINT signal_topic_evaluation_v2_retrieval_shape CHECK(
    retrieval_index BETWEEN 0 AND 23
    AND operation IN('cluster_catalog','cluster_profile','representative_mentions','search_cluster','compare_clusters','brand_os_context')
    AND tool_input_digest~'^sha256:[0-9a-f]{64}$' AND result_digest~'^sha256:[0-9a-f]{64}$'
    AND result_bytes BETWEEN 1 AND 32768)
);

CREATE TABLE signal_topic_evaluation_v2_retrieval_evidence (
  retrieval_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_retrievals(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_snapshots(id) ON DELETE RESTRICT,
  member_ref text NOT NULL,
  evidence_ref text NOT NULL,
  PRIMARY KEY(retrieval_id,evidence_ref),
  CONSTRAINT signal_topic_evaluation_v2_retrieval_member_fk FOREIGN KEY(snapshot_id,member_ref)
    REFERENCES signal_topic_evaluation_v2_cluster_memberships(snapshot_id,member_ref) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_v2_retrieval_evidence_retrieval_fk FOREIGN KEY(retrieval_id)
    REFERENCES signal_topic_evaluation_v2_retrievals(id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_v2_retrieval_evidence_shape CHECK(evidence_ref~'^sha256:[0-9a-f]{64}$')
);

CREATE TABLE signal_topic_evaluation_v2_model_turns (
  run_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  turn_index integer NOT NULL,
  turn_kind text NOT NULL,
  input_digest text NOT NULL,
  output_digest text NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(run_id,turn_index),
  CONSTRAINT signal_topic_evaluation_v2_turn_shape CHECK(
    turn_index BETWEEN 0 AND 11 AND turn_kind IN('tool','final')
    AND input_digest~'^sha256:[0-9a-f]{64}$' AND output_digest~'^sha256:[0-9a-f]{64}$'
    AND input_tokens>=0 AND output_tokens>=0)
);

CREATE TABLE signal_topic_evaluation_v2_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  candidate_key text NOT NULL,
  candidate_digest text NOT NULL,
  source_cluster_keys text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  adopted boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  serving boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_signal_topic_evaluation_v2_candidate UNIQUE(run_id,candidate_key),
  CONSTRAINT uq_signal_topic_evaluation_v2_candidate_run UNIQUE(id,run_id),
  CONSTRAINT signal_topic_evaluation_v2_candidate_shape CHECK(
    candidate_key~'^[a-z0-9][a-z0-9._:-]{0,179}$' AND candidate_digest~'^sha256:[0-9a-f]{64}$'
    AND cardinality(source_cluster_keys) BETWEEN 1 AND 12 AND status='pending'
    AND NOT adopted AND NOT published AND NOT serving)
);

CREATE TABLE signal_topic_evaluation_v2_candidate_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_candidates(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  predecessor_revision_id uuid REFERENCES signal_topic_evaluation_v2_candidate_revisions(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  payload_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_signal_topic_evaluation_v2_candidate_revision UNIQUE(candidate_id,revision),
  CONSTRAINT signal_topic_evaluation_v2_candidate_revision_shape CHECK(
    revision>0 AND jsonb_typeof(payload)='object' AND payload->>'status'='pending'
    AND payload-(ARRAY['candidate_key','title','description','inclusion','exclusion','explanation',
      'source_cluster_keys','evidence_refs','status'])='{}'::jsonb
    AND jsonb_typeof(payload->'candidate_key')='string' AND jsonb_typeof(payload->'title')='string'
    AND jsonb_typeof(payload->'description')='string' AND jsonb_typeof(payload->'inclusion')='array'
    AND jsonb_typeof(payload->'exclusion')='array' AND jsonb_typeof(payload->'explanation')='string'
    AND jsonb_typeof(payload->'source_cluster_keys')='array' AND jsonb_typeof(payload->'evidence_refs')='array'
    AND payload_digest~'^sha256:[0-9a-f]{64}$')
);

CREATE TABLE signal_topic_evaluation_v2_candidate_evidence (
  candidate_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_candidates(id) ON DELETE RESTRICT,
  retrieval_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_retrievals(id) ON DELETE RESTRICT,
  evidence_ref text NOT NULL,
  explanation_digest text NOT NULL,
  PRIMARY KEY(candidate_id,evidence_ref),
  CONSTRAINT signal_topic_evaluation_v2_candidate_evidence_retrieval_fk FOREIGN KEY(retrieval_id,evidence_ref)
    REFERENCES signal_topic_evaluation_v2_retrieval_evidence(retrieval_id,evidence_ref) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_v2_candidate_evidence_shape CHECK(
    evidence_ref~'^sha256:[0-9a-f]{64}$' AND explanation_digest~'^sha256:[0-9a-f]{64}$')
);

CREATE TABLE signal_topic_evaluation_v2_rankings (
  run_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_runs(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL REFERENCES signal_topic_evaluation_v2_candidates(id) ON DELETE RESTRICT,
  rank integer NOT NULL,
  ranking_reason text NOT NULL,
  ranking_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(run_id,rank),
  CONSTRAINT uq_signal_topic_evaluation_v2_ranked_candidate UNIQUE(run_id,candidate_id),
  CONSTRAINT signal_topic_evaluation_v2_ranking_candidate_fk FOREIGN KEY(candidate_id,run_id)
    REFERENCES signal_topic_evaluation_v2_candidates(id,run_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_v2_ranking_shape CHECK(rank BETWEEN 1 AND 10
    AND char_length(ranking_reason) BETWEEN 1 AND 600 AND ranking_digest~'^sha256:[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_workspace_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_workspace uuid;
BEGIN
  IF TG_TABLE_NAME='signal_topic_evaluation_v2_clusters' THEN
    SELECT workspace_id INTO expected_workspace FROM signal_topic_evaluation_v2_snapshots WHERE id=NEW.snapshot_id;
  ELSIF TG_TABLE_NAME='signal_topic_evaluation_v2_cluster_memberships' THEN
    SELECT snapshot.workspace_id INTO expected_workspace
    FROM signal_topic_evaluation_v2_snapshots snapshot JOIN mentions mention ON mention.id=NEW.mention_id
    JOIN data_sources source ON source.id=mention.data_source_id
    WHERE snapshot.id=NEW.snapshot_id AND mention.workspace_id=snapshot.workspace_id
      AND mention.inclusion_status='included' AND source.workspace_id=snapshot.workspace_id
      AND source.status='active';
  ELSIF TG_TABLE_NAME='signal_topic_evaluation_v2_runs' THEN
    SELECT workspace_id INTO expected_workspace FROM signal_topic_evaluation_v2_snapshots WHERE id=NEW.snapshot_id;
  ELSE
    SELECT workspace_id INTO expected_workspace FROM signal_topic_evaluation_v2_runs
    WHERE id=NEW.run_id;
  END IF;
  IF expected_workspace IS NULL OR expected_workspace<>NEW.workspace_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic Evaluation V2 workspace authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_cluster_workspace
BEFORE INSERT ON signal_topic_evaluation_v2_clusters FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_workspace_v1();
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_membership_workspace
BEFORE INSERT ON signal_topic_evaluation_v2_cluster_memberships FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_workspace_v1();
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_run_workspace
BEFORE INSERT ON signal_topic_evaluation_v2_runs FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_workspace_v1();
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_retrieval_workspace
BEFORE INSERT ON signal_topic_evaluation_v2_retrievals FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_workspace_v1();
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_turn_workspace
BEFORE INSERT ON signal_topic_evaluation_v2_model_turns FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_workspace_v1();
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_workspace
BEFORE INSERT ON signal_topic_evaluation_v2_candidates FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_workspace_v1();
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_revision_workspace
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_revisions FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_workspace_v1();

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_semantic_authority_digest_v1(generation_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  WITH generation AS(SELECT * FROM signal_semantic_context_generations WHERE id=$1),
  leaves AS(SELECT element.* FROM signal_semantic_context_element_versions element,generation
    WHERE element.generation_id=generation.id AND element.workspace_id=generation.workspace_id
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)), graph AS(
    SELECT 'sha256:'||encode(digest(convert_to(string_agg(element_digest,E'\n' ORDER BY element_key),'UTF8'),'sha256'),'hex') pack_digest
    FROM leaves)
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'generation_key',generation.generation_key,'brand_os_digest',generation.brand_os_digest,
    'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
    'candidate_pack_digest',graph.pack_digest)) FROM generation,graph;
$$;

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_snapshot_cohort_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM signal_topic_evaluation_v2_clusters WHERE snapshot_id=NEW.id)<>NEW.cluster_count
     OR (SELECT count(*) FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=NEW.id)<>NEW.membership_count
     OR (SELECT count(DISTINCT assignment_index) FROM signal_topic_evaluation_v2_cluster_memberships
       WHERE snapshot_id=NEW.id)<>NEW.membership_count
     OR (SELECT min(assignment_index) FROM signal_topic_evaluation_v2_cluster_memberships
       WHERE snapshot_id=NEW.id)<>0
     OR (SELECT max(assignment_index) FROM signal_topic_evaluation_v2_cluster_memberships
       WHERE snapshot_id=NEW.id)<>21194
     OR (SELECT 'sha256:'||encode(digest(convert_to(string_agg(assignment_index::text||'|'||
       assignment_label::text||'|'||source_record_key||'|'||canonical_binding_digest,E'\n'
       ORDER BY assignment_index),'UTF8'),'sha256'),'hex')
       FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=NEW.id)
       IS DISTINCT FROM NEW.membership_binding_digest
     OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_clusters cluster
       WHERE cluster.snapshot_id=NEW.id AND cluster.member_count<>(SELECT count(*)
         FROM signal_topic_evaluation_v2_cluster_memberships membership
         WHERE membership.snapshot_id=cluster.snapshot_id AND membership.cluster_key=cluster.cluster_key))
     OR (SELECT count(*) FROM signal_topic_evaluation_v2_clusters
       WHERE snapshot_id=NEW.id AND proposal_key IS NOT NULL)<>115
     OR (SELECT count(*) FROM signal_topic_evaluation_v2_clusters
       WHERE snapshot_id=NEW.id AND cluster_key='outlier-reservoir' AND proposal_key IS NULL
         AND member_count=10009)<>1
     OR (SELECT COALESCE(sum(member_count),0) FROM signal_topic_evaluation_v2_clusters
       WHERE snapshot_id=NEW.id AND proposal_key IS NOT NULL)<>11186
     OR NOT EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets packet
       WHERE packet.artifact_id=NEW.packet_artifact_id AND packet.workspace_id=NEW.workspace_id
         AND packet.packet_digest=NEW.packet_digest AND packet.proposal_count=115
         AND packet.modeling_denominator=21195 AND packet.rights_digest=NEW.rights_digest
         AND packet.packet_file_digest=NEW.source_packet_file_digest
         AND packet.source_manifest_digest=NEW.packet_source_manifest_digest
         AND NOT EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets newer
           WHERE newer.workspace_id=packet.workspace_id AND newer.registered_at>packet.registered_at))
     OR NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations generation
       WHERE generation.id=NEW.semantic_context_generation_id AND generation.workspace_id=NEW.workspace_id
         AND generation.status='draft' AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
           WHERE successor.workspace_id=generation.workspace_id
             AND successor.supersedes_generation_id=generation.id))
     OR signal_topic_evaluation_v2_semantic_authority_digest_v1(NEW.semantic_context_generation_id)
       IS DISTINCT FROM NEW.semantic_context_authority_digest
     OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.created_by_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic Evaluation V2 snapshot cohort is incomplete or unauthorized.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_validate_signal_topic_evaluation_v2_snapshot_cohort
AFTER INSERT ON signal_topic_evaluation_v2_snapshots DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_snapshot_cohort_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot uuid;
BEGIN
  SELECT run.snapshot_id INTO snapshot FROM signal_topic_evaluation_v2_runs run
  WHERE run.id=NEW.run_id AND run.workspace_id=NEW.workspace_id;
  IF snapshot IS NULL OR EXISTS(SELECT key FROM unnest(NEW.source_cluster_keys) key
    WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_clusters cluster
      WHERE cluster.snapshot_id=snapshot AND cluster.cluster_key=key)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic Evaluation V2 candidate authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate
BEFORE INSERT ON signal_topic_evaluation_v2_candidates FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_retrieval_evidence_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_snapshot uuid; expected_ref text;
BEGIN
  SELECT run.snapshot_id INTO run_snapshot FROM signal_topic_evaluation_v2_retrievals retrieval
  JOIN signal_topic_evaluation_v2_runs run ON run.id=retrieval.run_id
  WHERE retrieval.id=NEW.retrieval_id;
  SELECT signal_semantic_context_digest_json_v2(jsonb_build_object(
    'snapshot',snapshot.snapshot_digest,'member_ref',membership.member_ref,
    'source',membership.source_record_digest)) INTO expected_ref
  FROM signal_topic_evaluation_v2_cluster_memberships membership
  JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=membership.snapshot_id
  WHERE membership.snapshot_id=NEW.snapshot_id AND membership.member_ref=NEW.member_ref;
  IF run_snapshot IS NULL OR run_snapshot<>NEW.snapshot_id OR expected_ref IS NULL
     OR expected_ref<>NEW.evidence_ref THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 retrieval evidence authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_retrieval_evidence
BEFORE INSERT ON signal_topic_evaluation_v2_retrieval_evidence FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_retrieval_evidence_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_evidence_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payload jsonb;
BEGIN
  SELECT revision.payload INTO payload FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_retrievals retrieval ON retrieval.id=NEW.retrieval_id
    JOIN signal_topic_evaluation_v2_candidate_revisions revision
      ON revision.candidate_id=candidate.id AND revision.revision=1
    WHERE candidate.id=NEW.candidate_id AND candidate.run_id=retrieval.run_id;
  IF payload IS NULL OR NOT (payload->'evidence_refs' ? NEW.evidence_ref)
     OR NEW.explanation_digest<>signal_semantic_context_digest_json_v2(payload->'explanation') THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate evidence authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_evidence
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_evidence FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_evidence_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_candidate_revision_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate signal_topic_evaluation_v2_candidates%ROWTYPE;
BEGIN
  SELECT * INTO candidate FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id;
  IF candidate.id IS NULL OR candidate.run_id<>NEW.run_id OR candidate.workspace_id<>NEW.workspace_id
     OR NEW.payload_digest<>signal_semantic_context_digest_json_v2(NEW.payload)
     OR NEW.payload->>'candidate_key'<>candidate.candidate_key
     OR NEW.payload->>'status'<>'pending'
     OR ARRAY(SELECT jsonb_array_elements_text(NEW.payload->'source_cluster_keys'))<>candidate.source_cluster_keys
     OR (NEW.revision=1 AND NEW.payload_digest<>candidate.candidate_digest)
     OR (NEW.revision=1 AND NEW.predecessor_revision_id IS NOT NULL)
     OR (NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_revisions prior
       WHERE prior.id=NEW.predecessor_revision_id AND prior.candidate_id=NEW.candidate_id
         AND prior.revision=NEW.revision-1)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 candidate revision authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_candidate_revision
BEFORE INSERT ON signal_topic_evaluation_v2_candidate_revisions FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_candidate_revision_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_ranking_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate_key text;
BEGIN
  SELECT candidate.candidate_key INTO candidate_key FROM signal_topic_evaluation_v2_candidates candidate
  WHERE candidate.id=NEW.candidate_id AND candidate.run_id=NEW.run_id;
  IF candidate_key IS NULL OR NEW.ranking_digest<>signal_semantic_context_digest_json_v2(
    jsonb_build_object('rank',NEW.rank,'candidate_key',candidate_key,
      'ranking_reason',NEW.ranking_reason)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 ranking authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_ranking
BEFORE INSERT ON signal_topic_evaluation_v2_rankings FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_ranking_v1();

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_run_cohort_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate_count integer; ranking_count integer;
BEGIN
  IF NEW.status='completed' THEN
    SELECT count(*)::int INTO candidate_count FROM signal_topic_evaluation_v2_candidates WHERE run_id=NEW.id;
    SELECT count(*)::int INTO ranking_count FROM signal_topic_evaluation_v2_rankings WHERE run_id=NEW.id;
    IF NEW.completed_at IS NULL OR NEW.output_digest IS NULL OR candidate_count<1
       OR NEW.model_turn_count<>(SELECT count(*) FROM signal_topic_evaluation_v2_model_turns WHERE run_id=NEW.id)
       OR NEW.tool_call_count<>(SELECT count(*) FROM signal_topic_evaluation_v2_retrievals WHERE run_id=NEW.id)
       OR NEW.total_tool_result_bytes<>COALESCE((SELECT sum(result_bytes) FROM signal_topic_evaluation_v2_retrievals WHERE run_id=NEW.id),0)
       OR NEW.total_input_tokens<>COALESCE((SELECT sum(input_tokens) FROM signal_topic_evaluation_v2_model_turns WHERE run_id=NEW.id),0)
       OR NEW.total_output_tokens<>COALESCE((SELECT sum(output_tokens) FROM signal_topic_evaluation_v2_model_turns WHERE run_id=NEW.id),0)
       OR (SELECT count(*) FROM signal_topic_evaluation_v2_model_turns WHERE run_id=NEW.id AND turn_kind='final')<>1
       OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_model_turns
         WHERE run_id=NEW.id AND turn_kind='final' AND output_digest=NEW.output_digest)
       OR (SELECT count(*) FROM signal_topic_evaluation_v2_candidate_revisions WHERE run_id=NEW.id)<>candidate_count
       OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidates candidate WHERE candidate.run_id=NEW.id
         AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_evidence evidence
           WHERE evidence.candidate_id=candidate.id))
       OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidates candidate
         JOIN signal_topic_evaluation_v2_candidate_revisions revision
           ON revision.candidate_id=candidate.id AND revision.revision=1
         WHERE candidate.run_id=NEW.id AND (
           (SELECT count(*) FROM signal_topic_evaluation_v2_candidate_evidence evidence
             WHERE evidence.candidate_id=candidate.id)<>jsonb_array_length(revision.payload->'evidence_refs')
           OR EXISTS(SELECT value FROM jsonb_array_elements_text(revision.payload->'evidence_refs') value
             WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_evidence evidence
               WHERE evidence.candidate_id=candidate.id AND evidence.evidence_ref=value))))
       OR ranking_count<>least(10,candidate_count) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic Evaluation V2 completed run cohort is invalid.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_validate_signal_topic_evaluation_v2_run_cohort
AFTER INSERT OR UPDATE ON signal_topic_evaluation_v2_runs DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_run_cohort_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Topic Evaluation V2 run is append-only.';
  END IF;
  IF OLD.status IN('completed','failed','outcome_unknown') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Topic Evaluation V2 terminal run is append-only.';
  END IF;
  IF OLD.workspace_id<>NEW.workspace_id OR OLD.snapshot_id<>NEW.snapshot_id
     OR OLD.requested_by_user_id<>NEW.requested_by_user_id OR OLD.idempotency_key<>NEW.idempotency_key
     OR OLD.run_key<>NEW.run_key OR OLD.confirmation<>NEW.confirmation
     OR OLD.flight_card<>NEW.flight_card OR OLD.flight_card_digest<>NEW.flight_card_digest
     OR OLD.provider_execution_enabled<>NEW.provider_execution_enabled
     OR (OLD.status='planned' AND NEW.status NOT IN('planned','in_progress','failed'))
     OR (OLD.status='in_progress' AND NEW.status NOT IN('in_progress','completed','failed','outcome_unknown')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic Evaluation V2 run transition is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_run
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_runs FOR EACH ROW
EXECUTE FUNCTION protect_signal_topic_evaluation_v2_run_v1();

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Topic Evaluation V2 evidence and provenance are append-only.';
END;
$$;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'signal_topic_evaluation_v2_snapshots','signal_topic_evaluation_v2_clusters',
    'signal_topic_evaluation_v2_cluster_memberships','signal_topic_evaluation_v2_retrievals',
    'signal_topic_evaluation_v2_retrieval_evidence','signal_topic_evaluation_v2_model_turns',
    'signal_topic_evaluation_v2_candidates','signal_topic_evaluation_v2_candidate_revisions',
    'signal_topic_evaluation_v2_candidate_evidence','signal_topic_evaluation_v2_rankings']
  LOOP EXECUTE format('CREATE TRIGGER trg_protect_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_evaluation_v2_append_only_v1()',table_name,table_name);
  END LOOP;
END;
$$;

COMMENT ON TABLE signal_topic_evaluation_v2_cluster_memberships IS
  'Frozen server-owned BERTopic membership. Text is never copied here; evidence navigation joins mentions and sanitizes bounded excerpts.';
COMMENT ON TABLE signal_topic_evaluation_v2_runs IS
  'Provider-disabled-by-default bounded multi-turn control plane. It cannot adopt, publish or serve Topics.';
