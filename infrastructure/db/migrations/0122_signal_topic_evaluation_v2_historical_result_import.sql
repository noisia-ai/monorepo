-- 0122: a portable, historical result is not a new provider flight.
-- Requires product 0113 + 0115 only. Does not install or impersonate Lab 0116--0121.
-- Existing run bounds, execution authorities, transition guards and live refinement sessions
-- are deliberately untouched. Rollback for an uncommitted rehearsal is ROLLBACK; deployed
-- receipts/results are append-only and require a reviewed forward migration, never deletion.

CREATE FUNCTION signal_topic_evaluation_v2_import_id_v1(namespace text, value text)
RETURNS uuid LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT substr(encode(digest(convert_to(namespace||E'\n'||value,'UTF8'),'sha256'),'hex'),1,32)::uuid
$$;

CREATE TABLE signal_topic_evaluation_v2_result_import_receipts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL UNIQUE,
  snapshot_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  artifact_digest text NOT NULL,
  artifact jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,idempotency_key),
  UNIQUE(workspace_id,artifact_digest),
  UNIQUE(id,run_id,workspace_id,snapshot_id),
  FOREIGN KEY(snapshot_id,workspace_id)
    REFERENCES signal_topic_evaluation_v2_snapshots(id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(run_id,workspace_id)
    REFERENCES signal_topic_evaluation_v2_runs(id,workspace_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT signal_topic_evaluation_v2_result_import_shape CHECK(COALESCE((
    idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'
    AND artifact_digest~'^sha256:[0-9a-f]{64}$'
    AND jsonb_typeof(artifact)='object' AND octet_length(artifact::text)<=524288
    AND artifact->>'contract_version'='signal-topic-evaluation-v2-historical-result-import-v1'
    AND artifact ?& ARRAY['contract_version','snapshot','source_run','model_turns','retrievals',
      'retrieval_evidence','candidates','candidate_revisions','candidate_evidence','rankings','refinement']
    AND artifact-(ARRAY['contract_version','snapshot','source_run','model_turns','retrievals',
      'retrieval_evidence','candidates','candidate_revisions','candidate_evidence','rankings','refinement'])='{}'::jsonb
    AND artifact_digest=signal_semantic_context_digest_json_v2(artifact)
    AND id=signal_topic_evaluation_v2_import_id_v1(workspace_id::text,artifact_digest||E'\n'||idempotency_key)
    AND run_id=signal_topic_evaluation_v2_import_id_v1(id::text,'run'||E'\n'||(artifact->'source_run'->>'id'))
    AND jsonb_array_length(artifact->'model_turns')=12
    AND jsonb_array_length(artifact->'retrievals')=11
    AND jsonb_array_length(artifact->'retrieval_evidence') BETWEEN 1 AND 480
    AND jsonb_array_length(artifact->'candidates')=10
    AND jsonb_array_length(artifact->'candidate_revisions')=10
    AND jsonb_array_length(artifact->'candidate_evidence')=30
    AND jsonb_array_length(artifact->'rankings')=10
    AND jsonb_typeof(artifact->'refinement')='object'
  ),false))
);

ALTER TABLE signal_topic_evaluation_v2_runs ADD COLUMN origin text NOT NULL DEFAULT 'native';
ALTER TABLE signal_topic_evaluation_v2_runs ADD COLUMN import_receipt_id uuid;
ALTER TABLE signal_topic_evaluation_v2_runs ADD CONSTRAINT signal_topic_evaluation_v2_run_import_receipt
  FOREIGN KEY(import_receipt_id,id,workspace_id,snapshot_id)
  REFERENCES signal_topic_evaluation_v2_result_import_receipts(id,run_id,workspace_id,snapshot_id)
  ON DELETE RESTRICT;
ALTER TABLE signal_topic_evaluation_v2_runs ADD CONSTRAINT signal_topic_evaluation_v2_run_origin CHECK(COALESCE((
  (origin='native' AND import_receipt_id IS NULL)
  OR (origin='imported_result' AND import_receipt_id IS NOT NULL AND status='completed'
    AND NOT provider_execution_enabled AND execution_authorization_id IS NULL
    AND provider_call_count=0 AND reserved_micro_usd=0 AND settled_micro_usd=0
    AND model_turn_count=12 AND tool_call_count=11 AND output_digest IS NOT NULL
    AND completed_at IS NOT NULL AND error_code IS NULL
    AND flight_card->>'origin'='imported_result'
    AND flight_card @> '{"execution_enabled":false,"provider_calls_allowed":0,"hard_cap_micro_usd":1,"topic_adoption":false,"publication":false,"serving":false}'::jsonb)
),false));

CREATE FUNCTION protect_signal_topic_evaluation_v2_import_origin_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.origin IS DISTINCT FROM NEW.origin OR OLD.import_receipt_id IS DISTINCT FROM NEW.import_receipt_id THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Topic result import origin is immutable.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_import_origin
BEFORE UPDATE ON signal_topic_evaluation_v2_runs FOR EACH ROW
EXECUTE FUNCTION protect_signal_topic_evaluation_v2_import_origin_v1();

-- Only the retrieval shape gains a new operation on product 0113. A separate scoped guard below
-- retains the pre-existing Lab allowance without granting it to native UAT/offline runs.
ALTER TABLE signal_topic_evaluation_v2_retrievals DROP CONSTRAINT signal_topic_evaluation_v2_retrieval_shape;
ALTER TABLE signal_topic_evaluation_v2_retrievals ADD CONSTRAINT signal_topic_evaluation_v2_retrieval_shape CHECK(
  retrieval_index BETWEEN 0 AND 23
  AND operation IN('evaluation_brief','cluster_catalog','cluster_profile','representative_mentions',
    'search_cluster','compare_clusters','brand_os_context')
  AND tool_input_digest~'^sha256:[0-9a-f]{64}$' AND result_digest~'^sha256:[0-9a-f]{64}$'
  AND result_bytes BETWEEN 1 AND 32768
);
CREATE FUNCTION validate_signal_topic_evaluation_v2_import_brief_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation='evaluation_brief' AND NOT EXISTS(
    SELECT 1 FROM signal_topic_evaluation_v2_runs run
    LEFT JOIN signal_topic_evaluation_v2_execution_authorizations authority
      ON authority.id=run.execution_authorization_id
    WHERE run.id=NEW.run_id AND run.workspace_id=NEW.workspace_id AND (
      (run.origin='imported_result' AND run.import_receipt_id IS NOT NULL AND NEW.retrieval_index=0)
      OR (run.origin='native' AND authority.runtime_profile='local_disposable_lab_v1'
        AND EXISTS(SELECT 1 FROM signal_workspace_data_plane_migration_ledger
          WHERE ordinal=117 AND disposition='applied')))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic evaluation brief requires its original Lab or imported-result authority.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_import_brief
BEFORE INSERT ON signal_topic_evaluation_v2_retrievals FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_import_brief_v1();

CREATE TABLE signal_topic_evaluation_v2_archived_refinements (
  id uuid PRIMARY KEY,
  import_receipt_id uuid NOT NULL UNIQUE,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  source_revision integer NOT NULL,
  source_version_digest text NOT NULL,
  source_proposal_digest text NOT NULL,
  source_created_at timestamptz NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL,
  rationale text NOT NULL,
  evidence_refs text[] NOT NULL,
  related_candidate_keys text[] NOT NULL,
  recommendation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(import_receipt_id,run_id,workspace_id,snapshot_id)
    REFERENCES signal_topic_evaluation_v2_result_import_receipts(id,run_id,workspace_id,snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY(candidate_id,run_id,workspace_id)
    REFERENCES signal_topic_evaluation_v2_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT signal_topic_evaluation_v2_archived_refinement_shape CHECK(
    source_revision=1 AND source_version_digest~'^sha256:[0-9a-f]{64}$'
    AND source_proposal_digest~'^sha256:[0-9a-f]{64}$'
    AND btrim(display_name)<>'' AND char_length(display_name)<=160
    AND btrim(description)<>'' AND char_length(description)<=1500
    AND btrim(rationale)<>'' AND char_length(rationale)<=1200
    AND cardinality(evidence_refs) BETWEEN 1 AND 48 AND NOT evidence_refs&&ARRAY['']::text[]
    AND cardinality(related_candidate_keys) BETWEEN 0 AND 8 AND NOT related_candidate_keys&&ARRAY['']::text[]
    AND recommendation IN('none','consider_merge','consider_split')
    AND (recommendation<>'consider_merge' OR cardinality(related_candidate_keys)>0)
  )
);

CREATE FUNCTION protect_signal_topic_evaluation_v2_result_import_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Topic historical result provenance is append-only.';
END;
$$;
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_result_import
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_result_import_receipts FOR EACH ROW
EXECUTE FUNCTION protect_signal_topic_evaluation_v2_result_import_v1();
CREATE TRIGGER trg_protect_signal_topic_evaluation_v2_archived_refinement
BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_archived_refinements FOR EACH ROW
EXECUTE FUNCTION protect_signal_topic_evaluation_v2_result_import_v1();

CREATE FUNCTION validate_signal_topic_evaluation_v2_result_import_authority_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot signal_topic_evaluation_v2_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO snapshot FROM signal_topic_evaluation_v2_snapshots WHERE id=NEW.snapshot_id;
  IF snapshot.id IS NULL OR snapshot.workspace_id<>NEW.workspace_id OR snapshot.state<>'frozen'
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
    OR snapshot.snapshot_digest IS DISTINCT FROM NEW.artifact->'snapshot'->>'snapshot_digest'
    OR snapshot.rights_digest IS DISTINCT FROM NEW.artifact->'snapshot'->>'rights_digest'
    OR snapshot.semantic_context_authority_digest IS DISTINCT FROM NEW.artifact->'snapshot'->>'semantic_context_authority_digest'
    OR snapshot.artifact_binding_digest IS DISTINCT FROM NEW.artifact->'snapshot'->>'artifact_binding_digest'
    OR snapshot.membership_binding_digest IS DISTINCT FROM NEW.artifact->'snapshot'->>'membership_binding_digest'
    OR signal_topic_evaluation_v2_semantic_authority_digest_v1(snapshot.semantic_context_generation_id)
      IS DISTINCT FROM snapshot.semantic_context_authority_digest
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_clusters WHERE snapshot_id=snapshot.id)<>116
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=snapshot.id)<>21195
    OR (SELECT 'sha256:'||encode(digest(convert_to(string_agg(assignment_index::text||'|'||
      assignment_label::text||'|'||source_record_key||'|'||canonical_binding_digest,E'\n' ORDER BY assignment_index),
      'UTF8'),'sha256'),'hex') FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=snapshot.id)
      IS DISTINCT FROM snapshot.membership_binding_digest
    OR NOT EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets packet
      JOIN signal_semantic_context_generations generation ON generation.id=snapshot.semantic_context_generation_id
      WHERE packet.artifact_id=snapshot.packet_artifact_id AND packet.workspace_id=snapshot.workspace_id
        AND packet.packet_digest=snapshot.packet_digest AND packet.rights_digest=snapshot.rights_digest
        AND packet.proposal_count=115 AND packet.modeling_denominator=21195
        AND packet.packet_file_digest=snapshot.source_packet_file_digest
        AND packet.source_manifest_digest=snapshot.packet_source_manifest_digest
        AND generation.workspace_id=snapshot.workspace_id AND generation.status='draft'
        AND NOT EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets newer
          WHERE newer.workspace_id=packet.workspace_id AND newer.registered_at>packet.registered_at)
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations newer
          WHERE newer.workspace_id=generation.workspace_id AND newer.supersedes_generation_id=generation.id))
    OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_cluster_memberships membership
      JOIN mentions mention ON mention.id=membership.mention_id
      JOIN data_sources source ON source.id=mention.data_source_id
      WHERE membership.snapshot_id=snapshot.id AND (mention.workspace_id<>snapshot.workspace_id
        OR mention.inclusion_status<>'included' OR source.workspace_id<>snapshot.workspace_id OR source.status<>'active'))
  THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic historical result snapshot, rights or actor authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_signal_topic_evaluation_v2_result_import_authority
BEFORE INSERT ON signal_topic_evaluation_v2_result_import_receipts FOR EACH ROW
EXECUTE FUNCTION validate_signal_topic_evaluation_v2_result_import_authority_v1();

-- Compare every imported row with the sealed portable projection, including relationships after
-- deterministic UUID remapping. Existing 0112 row/digest/FK and completed-cohort triggers still run.
CREATE FUNCTION signal_topic_evaluation_v2_assert_result_import_v1(receipt_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE receipt signal_topic_evaluation_v2_result_import_receipts%ROWTYPE;
DECLARE r signal_topic_evaluation_v2_runs%ROWTYPE;
DECLARE a jsonb; f jsonb; target_candidate uuid;
BEGIN
  SELECT * INTO receipt FROM signal_topic_evaluation_v2_result_import_receipts WHERE id=receipt_id;
  SELECT * INTO r FROM signal_topic_evaluation_v2_runs WHERE id=receipt.run_id;
  a:=receipt.artifact; f:=a->'refinement';
  target_candidate:=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'candidate'||E'\n'||(f->>'candidate_id'));
  IF receipt.id IS NULL OR r.id IS NULL OR r.origin<>'imported_result' OR r.import_receipt_id<>receipt.id
    OR r.workspace_id<>receipt.workspace_id OR r.snapshot_id<>receipt.snapshot_id
    OR r.requested_by_user_id<>receipt.actor_user_id OR r.status<>'completed'
    OR r.provider_execution_enabled OR r.execution_authorization_id IS NOT NULL
    OR r.provider_call_count<>0 OR r.reserved_micro_usd<>0 OR r.settled_micro_usd IS DISTINCT FROM 0
    OR r.output_digest IS DISTINCT FROM a->'source_run'->>'output_digest'
    OR r.model_turn_count<>(a->'source_run'->>'model_turn_count')::int
    OR r.tool_call_count<>(a->'source_run'->>'tool_call_count')::int
    OR r.total_input_tokens<>(a->'source_run'->>'total_input_tokens')::int
    OR r.total_output_tokens<>(a->'source_run'->>'total_output_tokens')::int
    OR r.total_tool_result_bytes<>(a->'source_run'->>'total_tool_result_bytes')::int
    OR (a->'source_run'->>'provider_call_count')::int NOT BETWEEN 1 AND 12
    OR (a->'source_run'->>'settled_micro_usd')::bigint NOT BETWEEN 0 AND 20000000
    OR (a->'source_run'->>'reserved_micro_usd')::bigint NOT BETWEEN 0 AND 20000000
    OR (a->'source_run'->>'settled_micro_usd')::bigint>(a->'source_run'->>'reserved_micro_usd')::bigint
    OR signal_semantic_context_digest_json_v2(a->'source_run'->'flight_card')
      IS DISTINCT FROM a->'source_run'->>'flight_card_digest'
    OR signal_semantic_context_digest_json_v2(jsonb_build_object(
      'contract_version','signal-topic-evaluation-full-evidence-output-v2',
      'candidates',(SELECT jsonb_agg(value->'payload' ORDER BY ordinality)
        FROM jsonb_array_elements(a->'candidate_revisions') WITH ORDINALITY),
      'ranking',(SELECT jsonb_agg(jsonb_build_object('rank',ranking->'rank',
        'candidate_key',candidate->>'candidate_key','ranking_reason',ranking->>'ranking_reason') ORDER BY ordinality)
        FROM jsonb_array_elements(a->'rankings') WITH ORDINALITY AS rankings(ranking,ordinality)
        JOIN LATERAL jsonb_array_elements(a->'candidates') candidate
          ON candidate->>'id'=ranking->>'candidate_id')))
      IS DISTINCT FROM a->'source_run'->>'output_digest'
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_candidates WHERE run_id=r.id)<>10
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_candidate_revisions WHERE run_id=r.id)<>10
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_rankings WHERE run_id=r.id)<>10
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_model_turns WHERE run_id=r.id)<>12
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_retrievals WHERE run_id=r.id)<>11
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_retrieval_evidence e
      JOIN signal_topic_evaluation_v2_retrievals t ON t.id=e.retrieval_id WHERE t.run_id=r.id)
      <>jsonb_array_length(a->'retrieval_evidence')
    OR (SELECT count(*) FROM signal_topic_evaluation_v2_candidate_evidence e
      JOIN signal_topic_evaluation_v2_candidates c ON c.id=e.candidate_id WHERE c.run_id=r.id)<>30
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(a->'model_turns') AS s(turn_index int,turn_kind text,
      input_digest text,output_digest text,input_tokens int,output_tokens int,created_at timestamptz)
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_model_turns t WHERE t.run_id=r.id
        AND t.workspace_id=r.workspace_id AND t.turn_index=s.turn_index AND t.turn_kind=s.turn_kind
        AND t.input_digest=s.input_digest AND t.output_digest=s.output_digest
        AND t.input_tokens=s.input_tokens AND t.output_tokens=s.output_tokens AND t.created_at=s.created_at))
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(a->'retrievals') AS s(id text,retrieval_index int,
      operation text,tool_input_digest text,result_digest text,result_bytes int,created_at timestamptz)
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_retrievals t WHERE t.run_id=r.id
        AND t.id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'retrieval'||E'\n'||s.id)
        AND t.workspace_id=r.workspace_id AND t.retrieval_index=s.retrieval_index AND t.operation=s.operation
        AND t.tool_input_digest=s.tool_input_digest AND t.result_digest=s.result_digest
        AND t.result_bytes=s.result_bytes AND t.created_at=s.created_at))
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(a->'retrieval_evidence') AS s(retrieval_id text,member_ref text,evidence_ref text)
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_retrieval_evidence t
        WHERE t.retrieval_id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'retrieval'||E'\n'||s.retrieval_id)
          AND t.snapshot_id=r.snapshot_id AND t.member_ref=s.member_ref AND t.evidence_ref=s.evidence_ref))
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(a->'candidates') AS s(id text,candidate_key text,
      candidate_digest text,source_cluster_keys text[],created_at timestamptz)
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidates t WHERE t.run_id=r.id
        AND t.id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'candidate'||E'\n'||s.id)
        AND t.workspace_id=r.workspace_id AND t.candidate_key=s.candidate_key AND t.candidate_digest=s.candidate_digest
        AND t.source_cluster_keys=s.source_cluster_keys AND t.created_at=s.created_at
        AND t.status='pending' AND NOT t.adopted AND NOT t.published AND NOT t.serving))
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(a->'candidate_revisions') AS s(id text,candidate_id text,
      payload jsonb,payload_digest text,created_at timestamptz)
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_revisions t WHERE t.run_id=r.id
        AND t.id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'revision'||E'\n'||s.id)
        AND t.candidate_id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'candidate'||E'\n'||s.candidate_id)
        AND t.workspace_id=r.workspace_id AND t.revision=1 AND t.predecessor_revision_id IS NULL
        AND t.payload=s.payload AND t.payload_digest=s.payload_digest AND t.created_at=s.created_at))
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(a->'candidate_evidence') AS s(candidate_id text,
      retrieval_id text,evidence_ref text,explanation_digest text)
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_evidence t
        WHERE t.candidate_id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'candidate'||E'\n'||s.candidate_id)
          AND t.retrieval_id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'retrieval'||E'\n'||s.retrieval_id)
          AND t.evidence_ref=s.evidence_ref AND t.explanation_digest=s.explanation_digest))
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(a->'rankings') AS s(candidate_id text,rank int,
      ranking_reason text,ranking_digest text,created_at timestamptz)
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_rankings t WHERE t.run_id=r.id
        AND t.candidate_id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'candidate'||E'\n'||s.candidate_id)
        AND t.rank=s.rank AND t.ranking_reason=s.ranking_reason AND t.ranking_digest=s.ranking_digest AND t.created_at=s.created_at))
  THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic historical result imported cohort differs from its receipt.';
  END IF;

  IF (SELECT count(*) FROM signal_topic_evaluation_v2_archived_refinements WHERE import_receipt_id=receipt.id)<>1
    OR (f->>'source_revision')::int<>1
    OR f->>'source_brand_os_authority_digest' IS DISTINCT FROM a->'snapshot'->>'semantic_context_authority_digest'
    OR (f->>'session_expires_at')::timestamptz<>(f->>'session_created_at')::timestamptz+interval '15 minutes'
    OR (f->>'created_at')::timestamptz NOT BETWEEN (f->>'session_created_at')::timestamptz AND (f->>'session_expires_at')::timestamptz
    OR signal_semantic_context_digest_json_v2(jsonb_build_object(
      'contract_version','signal-topic-candidate-refinement-v1','session_id',f->>'source_session_id',
      'session_digest',f->>'source_session_digest','display_name',f->>'display_name','description',f->>'description',
      'evidence_refs',f->'evidence_refs','related_candidate_keys',f->'related_candidate_keys',
      'recommendation',f->>'recommendation','rationale',f->>'rationale')) IS DISTINCT FROM f->>'source_proposal_digest'
    OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_revisions
      WHERE candidate_id=target_candidate AND run_id=r.id AND workspace_id=r.workspace_id AND revision=1
        AND payload_digest=f->>'source_version_digest')
    OR NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_archived_refinements t
      WHERE t.import_receipt_id=receipt.id AND t.run_id=r.id AND t.workspace_id=r.workspace_id AND t.snapshot_id=r.snapshot_id
        AND t.id=signal_topic_evaluation_v2_import_id_v1(receipt.id::text,'refinement'||E'\n'||(f->>'source_proposal_id'))
        AND t.candidate_id=target_candidate AND t.source_revision=(f->>'source_revision')::int
        AND t.source_version_digest=f->>'source_version_digest' AND t.source_proposal_digest=f->>'source_proposal_digest'
        AND t.source_created_at=(f->>'created_at')::timestamptz AND t.display_name=f->>'display_name'
        AND t.description=f->>'description' AND t.rationale=f->>'rationale'
        AND to_jsonb(t.evidence_refs)=f->'evidence_refs' AND to_jsonb(t.related_candidate_keys)=f->'related_candidate_keys'
        AND t.recommendation=f->>'recommendation')
    OR jsonb_array_length(f->'evidence')<>jsonb_array_length(f->'evidence_refs')
    OR (SELECT count(DISTINCT e->>'evidence_ref') FROM jsonb_array_elements(f->'evidence') e)<>jsonb_array_length(f->'evidence_refs')
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(f->'evidence') AS e(member_ref text,evidence_ref text)
      WHERE NOT (f->'evidence_refs' ? e.evidence_ref) OR NOT EXISTS(
        SELECT 1 FROM signal_topic_evaluation_v2_cluster_memberships membership
        JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=target_candidate
        JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=membership.snapshot_id
        WHERE membership.snapshot_id=r.snapshot_id AND membership.member_ref=e.member_ref
          AND membership.cluster_key=ANY(candidate.source_cluster_keys)
          AND signal_semantic_context_digest_json_v2(jsonb_build_object('snapshot',snapshot.snapshot_digest,
            'member_ref',membership.member_ref,'source',membership.source_record_digest))=e.evidence_ref))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(f->'related_candidate_keys') related_key
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidates c WHERE c.run_id=r.id
        AND c.workspace_id=r.workspace_id AND c.candidate_key=related_key AND c.id<>target_candidate))
  THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Topic historical refinement is not the sealed candidate/evidence projection.';
  END IF;
END;
$$;

CREATE FUNCTION validate_signal_topic_evaluation_v2_result_import_cohort_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id uuid; target_run uuid;
BEGIN
  IF TG_TABLE_NAME='signal_topic_evaluation_v2_result_import_receipts' THEN
    receipt_id:=NEW.id;
  ELSIF TG_TABLE_NAME='signal_topic_evaluation_v2_archived_refinements' THEN
    receipt_id:=NEW.import_receipt_id;
  ELSE
    IF TG_TABLE_NAME='signal_topic_evaluation_v2_runs' THEN target_run:=NEW.id;
    ELSIF TG_TABLE_NAME='signal_topic_evaluation_v2_candidate_evidence' THEN
      SELECT run_id INTO target_run FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id;
    ELSIF TG_TABLE_NAME='signal_topic_evaluation_v2_retrieval_evidence' THEN
      SELECT run_id INTO target_run FROM signal_topic_evaluation_v2_retrievals WHERE id=NEW.retrieval_id;
    ELSE target_run:=NEW.run_id;
    END IF;
    SELECT import_receipt_id INTO receipt_id FROM signal_topic_evaluation_v2_runs WHERE id=target_run;
  END IF;
  IF receipt_id IS NOT NULL THEN PERFORM signal_topic_evaluation_v2_assert_result_import_v1(receipt_id); END IF;
  RETURN NULL;
END;
$$;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['signal_topic_evaluation_v2_result_import_receipts',
    'signal_topic_evaluation_v2_archived_refinements','signal_topic_evaluation_v2_runs',
    'signal_topic_evaluation_v2_candidates','signal_topic_evaluation_v2_candidate_revisions',
    'signal_topic_evaluation_v2_candidate_evidence','signal_topic_evaluation_v2_retrievals',
    'signal_topic_evaluation_v2_retrieval_evidence','signal_topic_evaluation_v2_model_turns',
    'signal_topic_evaluation_v2_rankings'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER trg_validate_topic_result_import_cohort AFTER INSERT ON %I '
      'DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_evaluation_v2_result_import_cohort_v1()',table_name);
  END LOOP;
END;
$$;
