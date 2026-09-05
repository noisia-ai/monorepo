-- 0116: local-disposable-only Full Evidence execution authority.
-- This migration is never a Preview/UAT release migration. It preserves the UAT outbox path and
-- adds one direct, no-queue Lab cohort for an externally anchored local clone.

DO $$
DECLARE marker record;
BEGIN
  IF current_database()!~'^noisia_topic_eval_lab_[a-z0-9_]{8,64}$'
     OR to_regclass('noisia_topic_evaluation_lab.clone_provenance') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Migration 0116 requires the externally anchored disposable Lab clone.';
  END IF;
  SELECT * INTO marker FROM noisia_topic_evaluation_lab.clone_provenance;
  IF marker IS NULL OR marker.clone_name<>current_database()
     OR marker.system_identifier<>(pg_control_system()).system_identifier::text
     OR marker.source_run_key<>'backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17'
     OR (SELECT count(*) FROM signal_topic_evaluation_v2_snapshots WHERE state='frozen')<>1
     OR (SELECT count(*) FROM signal_topic_evaluation_v2_cluster_memberships)<>21195
     OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_execution_authorizations)
     OR EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_runs) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Migration 0116 disposable Lab authority is not pristine.';
  END IF;
END;
$$;

ALTER TABLE signal_topic_evaluation_v2_execution_authorizations
  ADD COLUMN authority_channel text NOT NULL DEFAULT 'uat_management_v1',
  ADD COLUMN authority_input jsonb,
  ADD COLUMN authority_input_digest text;

ALTER TABLE signal_topic_evaluation_v2_execution_authorizations
  DROP CONSTRAINT signal_topic_evaluation_v2_execution_authorization_shape;
ALTER TABLE signal_topic_evaluation_v2_execution_authorizations
  ADD CONSTRAINT signal_topic_evaluation_v2_execution_authorization_shape CHECK(
    idempotency_key~'^[a-zA-Z0-9._:-]{8,200}$'
    AND authorization_key~'^[a-z0-9][a-z0-9._:-]{7,199}$'
    AND provider='anthropic'
    AND model~'^[a-z0-9][a-z0-9._.-]{2,159}$'
    AND pricing_version~'^[a-z0-9][a-z0-9._:-]{2,159}$'
    AND input_micro_usd_per_token BETWEEN 0 AND 1000000
    AND output_micro_usd_per_token BETWEEN 0 AND 1000000
    AND jsonb_typeof(flight_card)='object'
    AND flight_card_digest~'^sha256:[0-9a-f]{64}$'
    AND flight_card_digest=signal_semantic_context_digest_json_v2(flight_card)
    AND flight_card @> '{"contract_version":"signal-topic-evaluation-full-evidence-v2","execution_enabled":true,"no_retry":true,"action_time_confirmation_required":true,"preserve_complete_candidate_pool":true,"top_view_limit":10}'::jsonb
    AND COALESCE((flight_card->>'provider_calls_allowed')::int,0) BETWEEN 1 AND 12
    AND COALESCE((flight_card->>'max_model_turns')::int,0) BETWEEN 1 AND 12
    AND COALESCE((flight_card->>'max_tool_calls')::int,0) BETWEEN 1 AND 24
    AND COALESCE((flight_card->>'max_tool_result_bytes')::int,0) BETWEEN 1 AND 32768
    AND COALESCE((flight_card->>'max_total_tool_result_bytes')::int,0) BETWEEN 1 AND 262144
    AND COALESCE((flight_card->>'max_total_input_tokens')::int,0) BETWEEN 1 AND 450000
    AND COALESCE((flight_card->>'max_total_output_tokens')::int,0) BETWEEN 1 AND 50000
    AND COALESCE((flight_card->>'hard_cap_micro_usd')::bigint,0) BETWEEN 1 AND 20000000
    AND reserved_micro_usd BETWEEN 1 AND 20000000
    AND reserved_micro_usd<=COALESCE((flight_card->>'hard_cap_micro_usd')::bigint,0)
    AND (settled_micro_usd IS NULL OR settled_micro_usd BETWEEN 0 AND reserved_micro_usd)
    AND provider_call_count BETWEEN 0 AND COALESCE((flight_card->>'provider_calls_allowed')::int,0)
    AND status IN('authorized','claimed','completed','failed','outcome_unknown')
    AND (error_code IS NULL OR error_code~'^[a-z0-9_]{1,120}$')
    AND (
      (runtime_profile='uat'
        AND confirmation='AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION'
        AND authority_channel='uat_management_v1'
        AND authority_input IS NULL AND authority_input_digest IS NULL)
      OR
      (runtime_profile='local_disposable_lab_v1'
        AND confirmation='AUTHORIZE_LOCAL_DISPOSABLE_FULL_EVIDENCE_TOPIC_EVALUATION'
        AND authority_channel='local_disposable_lab_runner_v1'
        AND jsonb_typeof(authority_input)='object'
        AND authority_input_digest~'^sha256:[0-9a-f]{64}$'
        AND authority_input_digest=signal_semantic_context_digest_json_v2(authority_input))
    )
  );

CREATE UNIQUE INDEX uq_signal_topic_evaluation_v2_one_disposable_lab_flight
  ON signal_topic_evaluation_v2_execution_authorizations(workspace_id,snapshot_id)
  WHERE runtime_profile='local_disposable_lab_v1';

ALTER TABLE signal_topic_evaluation_v2_runs DROP CONSTRAINT signal_topic_evaluation_v2_run_bounds;
ALTER TABLE signal_topic_evaluation_v2_runs ADD CONSTRAINT signal_topic_evaluation_v2_run_bounds CHECK(
  idempotency_key~'^[a-zA-Z0-9._:-]{8,200}$' AND run_key~'^[a-z0-9][a-z0-9._:-]{7,199}$'
  AND confirmation IN('RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION',
    'AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION',
    'AUTHORIZE_LOCAL_DISPOSABLE_FULL_EVIDENCE_TOPIC_EVALUATION')
  AND jsonb_typeof(flight_card)='object' AND flight_card_digest~'^sha256:[0-9a-f]{64}$'
  AND flight_card_digest=signal_semantic_context_digest_json_v2(flight_card)
  AND (flight_card->>'max_model_turns')::int BETWEEN 1 AND 12
  AND (flight_card->>'max_tool_calls')::int BETWEEN 1 AND 24
  AND (flight_card->>'max_tool_result_bytes')::int BETWEEN 1 AND 32768
  AND (flight_card->>'max_total_tool_result_bytes')::int BETWEEN 1 AND 262144
  AND (flight_card->>'max_total_input_tokens')::int BETWEEN 1 AND 450000
  AND (flight_card->>'max_total_output_tokens')::int BETWEEN 1 AND 50000
  AND (flight_card->>'hard_cap_micro_usd')::bigint BETWEEN 1 AND 20000000
  AND status IN('planned','in_progress','completed','failed','outcome_unknown')
  AND model_turn_count BETWEEN 0 AND 12 AND tool_call_count BETWEEN 0 AND 24
  AND total_input_tokens BETWEEN 0 AND 450000 AND total_output_tokens BETWEEN 0 AND 50000
  AND total_tool_result_bytes BETWEEN 0 AND 262144
  AND reserved_micro_usd BETWEEN 0 AND 20000000
  AND (settled_micro_usd IS NULL OR settled_micro_usd BETWEEN 0 AND 20000000)
  AND (error_code IS NULL OR error_code~'^[a-z0-9_]{1,120}$')
  AND (output_digest IS NULL OR output_digest~'^sha256:[0-9a-f]{64}$')
  AND ((NOT provider_execution_enabled
    AND execution_authorization_id IS NULL AND provider_call_count=0
    AND confirmation='RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION'
    AND flight_card @> '{"contract_version":"signal-topic-evaluation-full-evidence-v2","execution_enabled":false,"provider_calls_allowed":0,"no_retry":true,"action_time_confirmation_required":true,"preserve_complete_candidate_pool":true,"top_view_limit":10}'::jsonb)
    OR (provider_execution_enabled AND execution_authorization_id IS NOT NULL
      AND confirmation IN('AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION',
        'AUTHORIZE_LOCAL_DISPOSABLE_FULL_EVIDENCE_TOPIC_EVALUATION')
      AND provider_call_count BETWEEN 0 AND 12
      AND flight_card @> '{"contract_version":"signal-topic-evaluation-full-evidence-v2","execution_enabled":true,"no_retry":true,"action_time_confirmation_required":true,"preserve_complete_candidate_pool":true,"top_view_limit":10}'::jsonb
      AND COALESCE((flight_card->>'provider_calls_allowed')::int,0) BETWEEN 1 AND 12))
);

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_lab_authority_valid_v1(authority_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1
    FROM signal_topic_evaluation_v2_execution_authorizations authority
    JOIN signal_topic_evaluation_v2_snapshots snapshot
      ON snapshot.id=authority.snapshot_id AND snapshot.workspace_id=authority.workspace_id
    JOIN users actor ON actor.id=authority.requested_by_user_id
    JOIN noisia_topic_evaluation_lab.clone_provenance marker ON true
    WHERE authority.id=authority_id
      AND authority.runtime_profile='local_disposable_lab_v1'
      AND authority.authority_channel='local_disposable_lab_runner_v1'
      AND authority.confirmation='AUTHORIZE_LOCAL_DISPOSABLE_FULL_EVIDENCE_TOPIC_EVALUATION'
      AND authority.requested_by_user_id=snapshot.created_by_user_id
      AND actor.status='active' AND actor.user_type='noisia_internal'
      AND signal_data_governance_actor_is_valid(authority.workspace_id,actor.id)
      AND snapshot.state='frozen'
      AND marker.clone_name=current_database()
      AND marker.system_identifier=(pg_control_system()).system_identifier::text
      AND marker.source_run_key=snapshot.source_run_key
      AND marker.source_snapshot_digest=snapshot.snapshot_digest
      AND marker.source_artifact_binding_digest=snapshot.artifact_binding_digest
      AND authority.authority_input= jsonb_build_object(
        'contract_version','signal-topic-evaluation-disposable-lab-authority-v1',
        'runtime_profile','local_disposable_lab_v1',
        'idempotency_key',authority.idempotency_key,
        'confirmation',authority.confirmation,
        'host_receipt_digest',authority.authority_input->>'host_receipt_digest',
        'container_identity_digest',authority.authority_input->>'container_identity_digest',
        'snapshot_digest',snapshot.snapshot_digest)
      AND authority.authority_input->>'host_receipt_digest'~'^sha256:[0-9a-f]{64}$'
      AND authority.authority_input->>'container_identity_digest'~'^sha256:[0-9a-f]{64}$'
      AND authority.authority_input_digest=signal_semantic_context_digest_json_v2(authority.authority_input)
  );
$$;

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_execution_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authority signal_topic_evaluation_v2_execution_authorizations%ROWTYPE;
BEGIN
  IF NOT NEW.provider_execution_enabled THEN RETURN NEW; END IF;
  SELECT * INTO authority FROM signal_topic_evaluation_v2_execution_authorizations
    WHERE id=NEW.execution_authorization_id;
  IF authority.id IS NULL OR authority.workspace_id<>NEW.workspace_id
     OR authority.snapshot_id<>NEW.snapshot_id
     OR authority.requested_by_user_id<>NEW.requested_by_user_id
     OR authority.idempotency_key<>NEW.idempotency_key
     OR authority.flight_card<>NEW.flight_card
     OR authority.flight_card_digest<>NEW.flight_card_digest
     OR authority.reserved_micro_usd<>NEW.reserved_micro_usd
     OR authority.status NOT IN('authorized','claimed')
     OR (authority.runtime_profile='uat'
       AND NEW.confirmation<>'AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION')
     OR (authority.runtime_profile='local_disposable_lab_v1'
       AND (NEW.confirmation<>'AUTHORIZE_LOCAL_DISPOSABLE_FULL_EVIDENCE_TOPIC_EVALUATION'
         OR NOT signal_topic_evaluation_v2_lab_authority_valid_v1(authority.id)))
     OR authority.runtime_profile NOT IN('uat','local_disposable_lab_v1') THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 provider execution authority is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_execution_authorization_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Topic Evaluation V2 execution authorization is append-only.';
  END IF;
  IF OLD.status IN('completed','failed','outcome_unknown')
     OR OLD.workspace_id<>NEW.workspace_id OR OLD.snapshot_id<>NEW.snapshot_id
     OR OLD.requested_by_user_id<>NEW.requested_by_user_id
     OR OLD.idempotency_key<>NEW.idempotency_key OR OLD.authorization_key<>NEW.authorization_key
     OR OLD.confirmation<>NEW.confirmation OR OLD.runtime_profile<>NEW.runtime_profile
     OR OLD.provider<>NEW.provider OR OLD.model<>NEW.model OR OLD.pricing_version<>NEW.pricing_version
     OR OLD.input_micro_usd_per_token<>NEW.input_micro_usd_per_token
     OR OLD.output_micro_usd_per_token<>NEW.output_micro_usd_per_token
     OR OLD.flight_card<>NEW.flight_card OR OLD.flight_card_digest<>NEW.flight_card_digest
     OR OLD.reserved_micro_usd<>NEW.reserved_micro_usd
     OR OLD.authority_channel<>NEW.authority_channel
     OR OLD.authority_input IS DISTINCT FROM NEW.authority_input
     OR OLD.authority_input_digest IS DISTINCT FROM NEW.authority_input_digest
     OR NEW.provider_call_count<OLD.provider_call_count
     OR (NEW.status IN('authorized','claimed') AND
       (NEW.settled_micro_usd IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.completed_at IS NOT NULL))
     OR (NEW.status='completed' AND
       (NEW.settled_micro_usd IS NULL OR NEW.error_code IS NOT NULL OR NEW.completed_at IS NULL))
     OR (NEW.status='failed' AND
       (NEW.settled_micro_usd IS NULL OR NEW.error_code IS NULL OR NEW.completed_at IS NULL))
     OR (NEW.status='outcome_unknown' AND
       (NEW.settled_micro_usd IS NOT NULL OR NEW.error_code IS NULL OR NEW.completed_at IS NULL))
     OR (OLD.status='authorized' AND NEW.status NOT IN('authorized','claimed'))
     OR (OLD.status='claimed' AND NEW.status NOT IN('claimed','completed','failed','outcome_unknown')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 execution authorization transition is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_v2_execution_outbox_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paired record;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Topic Evaluation V2 execution outbox is append-only.';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT run.workspace_id run_workspace_id,run.execution_authorization_id run_authorization_id,
      run.status run_status,run.provider_execution_enabled,authority.status authority_status,
      authority.runtime_profile
    INTO paired
    FROM signal_topic_evaluation_v2_runs run
    JOIN signal_topic_evaluation_v2_execution_authorizations authority
      ON authority.id=run.execution_authorization_id
    WHERE run.id=NEW.run_id;
    IF paired IS NULL OR paired.run_workspace_id<>NEW.workspace_id
       OR paired.run_authorization_id<>NEW.execution_authorization_id
       OR paired.run_status<>'planned' OR NOT paired.provider_execution_enabled
       OR paired.authority_status<>'authorized' OR paired.runtime_profile<>'uat'
       OR NEW.status<>'pending' OR NEW.dispatch_count<>0 OR NEW.dispatched_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Topic Evaluation V2 execution outbox insert is invalid.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.run_id<>NEW.run_id OR OLD.workspace_id<>NEW.workspace_id
     OR OLD.execution_authorization_id<>NEW.execution_authorization_id
     OR OLD.outbox_key<>NEW.outbox_key OR OLD.created_at<>NEW.created_at
     OR OLD.status<>'pending' OR NEW.status<>'dispatched'
     OR OLD.dispatch_count<>0 OR NEW.dispatch_count<>1
     OR NEW.dispatched_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 execution outbox transition is invalid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_signal_topic_evaluation_v2_execution_pair_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authorization_id uuid;
DECLARE paired record;
BEGIN
  IF TG_TABLE_NAME='signal_topic_evaluation_v2_execution_authorizations' THEN
    authorization_id:=NEW.id;
  ELSE
    authorization_id:=NEW.execution_authorization_id;
  END IF;
  IF authorization_id IS NULL THEN RETURN NULL; END IF;

  SELECT authority.id authority_id,authority.workspace_id authority_workspace_id,
    authority.runtime_profile,authority.status authority_status,
    authority.provider_call_count authority_calls,authority.settled_micro_usd authority_settled,
    authority.error_code authority_error,authority.completed_at authority_completed,
    run.id run_id,run.workspace_id run_workspace_id,run.execution_authorization_id run_authority_id,
    run.status run_status,run.provider_call_count run_calls,run.settled_micro_usd run_settled,
    run.error_code run_error,run.completed_at run_completed,
    outbox.run_id outbox_run_id,outbox.workspace_id outbox_workspace_id,
    outbox.execution_authorization_id outbox_authority_id,outbox.status outbox_status,
    outbox.dispatch_count outbox_dispatch_count,outbox.dispatched_at outbox_dispatched_at
  INTO paired
  FROM signal_topic_evaluation_v2_execution_authorizations authority
  JOIN signal_topic_evaluation_v2_runs run ON run.execution_authorization_id=authority.id
  LEFT JOIN signal_topic_evaluation_v2_execution_outbox outbox
    ON outbox.execution_authorization_id=authority.id AND outbox.run_id=run.id
  WHERE authority.id=authorization_id;

  IF paired IS NULL OR paired.authority_workspace_id<>paired.run_workspace_id
     OR paired.run_authority_id<>paired.authority_id
     OR paired.authority_calls<>paired.run_calls
     OR paired.authority_settled IS DISTINCT FROM paired.run_settled
     OR paired.authority_error IS DISTINCT FROM paired.run_error
     OR (paired.authority_completed IS NULL)<>(paired.run_completed IS NULL)
     OR (paired.runtime_profile='uat' AND (
       paired.outbox_run_id IS NULL
       OR paired.authority_workspace_id<>paired.outbox_workspace_id
       OR paired.outbox_authority_id<>paired.authority_id OR paired.outbox_run_id<>paired.run_id
       OR NOT ((paired.authority_status='authorized' AND paired.run_status='planned'
          AND paired.outbox_status='pending' AND paired.outbox_dispatch_count=0
          AND paired.outbox_dispatched_at IS NULL)
        OR (paired.authority_status='claimed' AND paired.run_status='in_progress'
          AND paired.outbox_status='dispatched' AND paired.outbox_dispatch_count=1
          AND paired.outbox_dispatched_at IS NOT NULL)
        OR (paired.authority_status IN('completed','failed','outcome_unknown')
          AND paired.authority_status=paired.run_status
          AND paired.outbox_status='dispatched' AND paired.outbox_dispatch_count=1
          AND paired.outbox_dispatched_at IS NOT NULL))))
     OR (paired.runtime_profile='local_disposable_lab_v1' AND (
       paired.outbox_run_id IS NOT NULL OR NOT signal_topic_evaluation_v2_lab_authority_valid_v1(paired.authority_id)
       OR NOT ((paired.authority_status='authorized' AND paired.run_status='planned')
         OR (paired.authority_status='claimed' AND paired.run_status='in_progress')
         OR (paired.authority_status IN('completed','failed','outcome_unknown')
           AND paired.authority_status=paired.run_status))))
     OR paired.runtime_profile NOT IN('uat','local_disposable_lab_v1') THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Topic Evaluation V2 execution authority/run/outbox cohort is invalid.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION signal_topic_evaluation_v2_lab_create_and_claim_v1(input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE snapshot signal_topic_evaluation_v2_snapshots%ROWTYPE;
DECLARE actor users%ROWTYPE;
DECLARE marker noisia_topic_evaluation_lab.clone_provenance%ROWTYPE;
DECLARE card jsonb;
DECLARE sealed_input jsonb;
DECLARE input_digest text;
DECLARE authorization_id uuid:=gen_random_uuid();
DECLARE run_id uuid:=gen_random_uuid();
DECLARE authorization_key text;
DECLARE run_key text;
BEGIN
  IF input IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'object'
     OR input-(ARRAY['contract_version','idempotency_key','confirmation','expected_snapshot_digest',
       'host_receipt_digest','container_identity_digest'])<>'{}'::jsonb
     OR input->>'contract_version'<>'signal-topic-evaluation-disposable-lab-authority-v1'
     OR input->>'confirmation'<>'AUTHORIZE_LOCAL_DISPOSABLE_FULL_EVIDENCE_TOPIC_EVALUATION'
     OR input->>'idempotency_key'!~'^[a-zA-Z0-9._:-]{8,200}$'
     OR input->>'expected_snapshot_digest'!~'^sha256:[0-9a-f]{64}$'
     OR input->>'host_receipt_digest'!~'^sha256:[0-9a-f]{64}$'
     OR input->>'container_identity_digest'!~'^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Disposable Lab execution input is invalid.';
  END IF;
  SELECT * INTO snapshot FROM signal_topic_evaluation_v2_snapshots WHERE state='frozen';
  SELECT * INTO marker FROM noisia_topic_evaluation_lab.clone_provenance;
  IF snapshot IS NULL OR marker IS NULL OR snapshot.snapshot_digest<>input->>'expected_snapshot_digest'
     OR marker.clone_name<>current_database()
     OR marker.system_identifier<>(pg_control_system()).system_identifier::text
     OR marker.source_run_key<>snapshot.source_run_key
     OR marker.source_snapshot_digest<>snapshot.snapshot_digest
     OR marker.source_artifact_binding_digest<>snapshot.artifact_binding_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Disposable Lab frozen authority is invalid.';
  END IF;
  SELECT * INTO actor FROM users WHERE id=snapshot.created_by_user_id;
  IF actor IS NULL OR actor.status<>'active' OR actor.user_type<>'noisia_internal'
     OR NOT signal_data_governance_actor_is_valid(snapshot.workspace_id,actor.id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Disposable Lab system actor is invalid.';
  END IF;
  card:=jsonb_build_object('contract_version','signal-topic-evaluation-full-evidence-v2',
    'execution_enabled',true,'provider_calls_allowed',12,'no_retry',true,
    'action_time_confirmation_required',true,'max_model_turns',12,'max_tool_calls',24,
    'max_tool_result_bytes',32768,'max_total_tool_result_bytes',262144,
    'max_total_input_tokens',450000,'max_total_output_tokens',50000,
    'hard_cap_micro_usd',2100000,'preserve_complete_candidate_pool',true,'top_view_limit',10);
  sealed_input:=jsonb_build_object(
    'contract_version','signal-topic-evaluation-disposable-lab-authority-v1',
    'runtime_profile','local_disposable_lab_v1','idempotency_key',input->>'idempotency_key',
    'confirmation',input->>'confirmation','host_receipt_digest',input->>'host_receipt_digest',
    'container_identity_digest',input->>'container_identity_digest',
    'snapshot_digest',snapshot.snapshot_digest);
  input_digest:=signal_semantic_context_digest_json_v2(sealed_input);
  authorization_key:='topic-v2-lab-auth-'||substr(input_digest,8,24);
  run_key:='topic-v2-lab-run-'||substr(signal_semantic_context_digest_json_v2(jsonb_build_object(
    'authority_input_digest',input_digest,'snapshot_digest',snapshot.snapshot_digest)),8,24);

  INSERT INTO signal_topic_evaluation_v2_execution_authorizations(id,workspace_id,snapshot_id,
    requested_by_user_id,idempotency_key,authorization_key,confirmation,runtime_profile,provider,
    model,pricing_version,input_micro_usd_per_token,output_micro_usd_per_token,flight_card,
    flight_card_digest,reserved_micro_usd,authority_channel,authority_input,authority_input_digest)
  VALUES(authorization_id,snapshot.workspace_id,snapshot.id,actor.id,input->>'idempotency_key',
    authorization_key,input->>'confirmation','local_disposable_lab_v1','anthropic','claude-sonnet-5',
    'anthropic-2026-08-29',3,15,card,signal_semantic_context_digest_json_v2(card),2100000,
    'local_disposable_lab_runner_v1',sealed_input,input_digest);
  INSERT INTO signal_topic_evaluation_v2_runs(id,workspace_id,snapshot_id,execution_authorization_id,
    requested_by_user_id,idempotency_key,run_key,confirmation,flight_card,flight_card_digest,
    provider_execution_enabled,reserved_micro_usd)
  VALUES(run_id,snapshot.workspace_id,snapshot.id,authorization_id,actor.id,input->>'idempotency_key',
    run_key,input->>'confirmation',card,signal_semantic_context_digest_json_v2(card),true,2100000);
  UPDATE signal_topic_evaluation_v2_execution_authorizations SET status='claimed'
    WHERE id=authorization_id;
  UPDATE signal_topic_evaluation_v2_runs SET status='in_progress' WHERE id=run_id;
  RETURN jsonb_build_object('execution_authorization_id',authorization_id::text,'run_id',run_id::text,
    'run_key',run_key,'workspace_id',snapshot.workspace_id::text,'requested_by_user_id',actor.id::text,
    'snapshot_id',snapshot.id::text,'snapshot_digest',snapshot.snapshot_digest,'configuration',
    jsonb_build_object('model','claude-sonnet-5','input_micro_usd_per_token',3,
      'output_micro_usd_per_token',15,'flight_card',card));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Disposable Lab evaluation already exists.';
END;
$$;

COMMENT ON FUNCTION signal_topic_evaluation_v2_lab_create_and_claim_v1(jsonb) IS
  'Non-HTTP, no-outbox, one-flight authority for the externally anchored disposable local Lab. It derives workspace and actor from the frozen snapshot.';
COMMENT ON TABLE signal_topic_evaluation_v2_execution_authorizations IS
  'Append-only bounded provider authority. UAT requires its existing outbox; the one local_disposable_lab_v1 flight is direct and has no queue.';
