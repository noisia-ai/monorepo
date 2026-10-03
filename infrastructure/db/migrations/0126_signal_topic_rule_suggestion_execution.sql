-- Execution JSON reuses 0096 canonical_json_v1 (native JSON string escaping, no NFC rewrite),
-- matching A's UTF-8-sorted closed ASCII field names. Raw provider bytes use digest_v1 directly.
-- Legacy V2 canonical functions and historical evidence-reference identity stay unchanged.
-- One bounded product-purpose execution row: reservation, claim, navigation, calls,
-- terminal and pending dispatch. No Lab dependencies, active topics or separate ledger.
CREATE TABLE signal_topic_rule_suggestion_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,run_id uuid NOT NULL,candidate_id uuid NOT NULL,snapshot_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'topic_rule_suggestion_v1' CHECK(purpose='topic_rule_suggestion_v1'),
  model text NOT NULL DEFAULT 'claude-haiku-4-5-20251001' CHECK(model='claude-haiku-4-5-20251001'),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','claimed','completed','definitely_not_sent','outcome_unknown','failed')),
  claim_token uuid,context jsonb NOT NULL CHECK(jsonb_typeof(context)='object' AND octet_length(context::text)<=262144),
  prepared_context jsonb NOT NULL CHECK(jsonb_typeof(prepared_context)='object' AND octet_length(prepared_context::text)<=22000),
  rights_digest text NOT NULL CHECK(rights_digest~'^sha256:[0-9a-f]{64}$'),authority_digest text NOT NULL CHECK(authority_digest~'^sha256:[0-9a-f]{64}$'),
  budget_micro_usd bigint NOT NULL CHECK(budget_micro_usd BETWEEN 1 AND 1000000),
  calls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(calls)='array' AND jsonb_array_length(calls)<=12 AND octet_length(calls::text)<=600000),
  navigations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(navigations)='array' AND jsonb_array_length(navigations)<=10),
  receipt_id uuid,output_text text CHECK(octet_length(output_text)<=16384),output_digest text,adaptation jsonb,receipt_digest text,
  provider_calls integer NOT NULL DEFAULT 0 CHECK(provider_calls BETWEEN 0 AND 12),
  input_tokens integer NOT NULL DEFAULT 0 CHECK(input_tokens>=0),output_tokens integer NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
  cost_micro_usd bigint DEFAULT 0 CHECK(cost_micro_usd>=0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),terminal_at timestamptz,
  FOREIGN KEY(candidate_id,run_id,workspace_id) REFERENCES signal_topic_evaluation_v2_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(snapshot_id,workspace_id) REFERENCES signal_topic_evaluation_v2_snapshots(id,workspace_id) ON DELETE RESTRICT,
  UNIQUE(id,workspace_id),UNIQUE(workspace_id,idempotency_key),
  -- The authorized cut has exactly one remaining experiment per workspace. Replays reuse it.
  UNIQUE(workspace_id,purpose),
  CHECK((status='pending')=(claim_token IS NULL)),
  CHECK((status IN('pending','claimed'))=(terminal_at IS NULL)),
  CHECK((status='completed')=(receipt_id IS NOT NULL AND output_text IS NOT NULL AND output_digest IS NOT NULL AND adaptation IS NOT NULL AND receipt_digest IS NOT NULL))
);
CREATE INDEX idx_topic_rule_suggestion_pending_dispatch ON signal_topic_rule_suggestion_executions(created_at) WHERE status='pending';

CREATE FUNCTION validate_signal_topic_rule_suggestion_execution_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c jsonb; idx integer:=0; known boolean:=true; amount bigint:=0; tokens_in bigint:=0; tokens_out bigint:=0; src record;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Execution history is retained.'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status NOT IN('pending','claimed') OR
      (to_jsonb(NEW)-ARRAY['status','claim_token','context','prepared_context','calls','navigations','receipt_id','output_text','output_digest','adaptation','receipt_digest','provider_calls','input_tokens','output_tokens','cost_micro_usd','terminal_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','claim_token','context','prepared_context','calls','navigations','receipt_id','output_text','output_digest','adaptation','receipt_digest','provider_calls','input_tokens','output_tokens','cost_micro_usd','terminal_at'])
      OR (OLD.claim_token IS NOT NULL AND NEW.claim_token IS DISTINCT FROM OLD.claim_token)
      OR (OLD.status='pending' AND NEW.status<>'claimed') OR (OLD.status='claimed' AND NEW.status='pending')
      OR NEW.context-'traces' IS DISTINCT FROM OLD.context-'traces'
      OR jsonb_array_length(NEW.navigations)<jsonb_array_length(OLD.navigations)
      OR jsonb_array_length(NEW.navigations)>jsonb_array_length(OLD.navigations)+1
      OR jsonb_array_length(NEW.calls)<jsonb_array_length(OLD.calls)
      OR jsonb_array_length(NEW.calls)>jsonb_array_length(OLD.calls)+1 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Execution seal or transition is invalid.'; END IF;
    IF jsonb_array_length(NEW.calls)>jsonb_array_length(OLD.calls) AND (
      EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.calls) item WHERE item->>'outcome' IN('pending','outcome_unknown'))
      OR COALESCE((SELECT sum(COALESCE((item->>'cost_micro_usd')::bigint,(item->>'reserved_micro_usd')::bigint)) FROM jsonb_array_elements(OLD.calls) item),0)
        +(NEW.calls->-1->>'reserved_micro_usd')::bigint>NEW.budget_micro_usd
      OR NEW.calls->-1->>'outcome'<>'pending') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Call exceeds reserved budget or unresolved predecessor.'; END IF;
    FOR idx IN 0..jsonb_array_length(OLD.navigations)-1 LOOP
      IF NEW.navigations->idx IS DISTINCT FROM OLD.navigations->idx OR NEW.context->'traces'->idx IS DISTINCT FROM OLD.context->'traces'->idx THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Navigation history is immutable.'; END IF;
    END LOOP;
    FOR idx IN 0..jsonb_array_length(OLD.calls)-1 LOOP
      IF OLD.calls->idx->>'outcome'<>'pending' AND NEW.calls->idx IS DISTINCT FROM OLD.calls->idx THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Settled calls are immutable.'; END IF;
      IF (NEW.calls->idx)-ARRAY['outcome','response_text','response_digest','input_tokens','output_tokens','request_id','cost_micro_usd']
        IS DISTINCT FROM (OLD.calls->idx)-ARRAY['outcome','response_text','response_digest','input_tokens','output_tokens','request_id','cost_micro_usd'] THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Call reservation is immutable.'; END IF;
    END LOOP;
  ELSE
    IF NEW.status<>'pending' OR NEW.claim_token IS NOT NULL OR NEW.calls<>'[]'::jsonb OR NEW.navigations<>'[]'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New execution must be an unclaimed dispatch.'; END IF;
    SELECT run.run_key,candidate.candidate_key,snapshot.snapshot_digest,snapshot.rights_digest,
      snapshot.semantic_context_authority_digest authority_digest,snapshot.id snapshot_id,
      COALESCE(editorial.revision,1) revision,COALESCE(editorial.version_digest,base.payload_digest) version_digest
      INTO src FROM signal_topic_evaluation_v2_candidates candidate
      JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id AND run.workspace_id=candidate.workspace_id
      JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id AND snapshot.workspace_id=run.workspace_id
      JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
      LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions WHERE candidate_id=candidate.id ORDER BY revision DESC LIMIT 1) editorial ON true
      WHERE candidate.id=NEW.candidate_id AND candidate.run_id=NEW.run_id AND candidate.workspace_id=NEW.workspace_id
        AND run.status='completed' AND snapshot.state='frozen' AND candidate.status='pending'
        AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving AND COALESCE(editorial.review_state,'pending')='pending';
    IF src IS NULL OR src.snapshot_id<>NEW.snapshot_id OR src.rights_digest<>NEW.rights_digest OR src.authority_digest<>NEW.authority_digest
      OR NEW.context->'source' IS DISTINCT FROM jsonb_build_object('workspace_id',NEW.workspace_id::text,'run_key',src.run_key,'candidate_key',src.candidate_key,
        'snapshot_digest',src.snapshot_digest,'session_key','topic-rule-execution:'||NEW.id::text,'candidate_revision',src.revision,
        'candidate_state_token',signal_topic_evaluation_v2_candidate_state_token_v1(NEW.candidate_id,src.revision,src.version_digest),'candidate_version_digest',src.version_digest)
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
      OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Execution source/actor is invalid.'; END IF;
  END IF;
  IF NEW.request_digest<>signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1(NEW.request))
    OR NEW.prepared_context->>'context_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1(NEW.context))
    OR NEW.context->'brand_os'->'source' IS DISTINCT FROM NEW.context->'source'
    OR NEW.context->'brand_os'->>'authority_digest' IS DISTINCT FROM NEW.authority_digest
    OR jsonb_array_length(NEW.context->'traces')<>jsonb_array_length(NEW.navigations) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Execution context/digest is invalid.'; END IF;
  idx:=0;
  FOR c IN SELECT value FROM jsonb_array_elements(NEW.calls) LOOP
    idx:=idx+1;
    IF (c->>'call_index')::int<>idx OR c->>'prompt_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(c->>'prompt')
      OR octet_length(c->>'prompt')>22528 OR (c->>'max_output_tokens')::int NOT BETWEEN 1 AND 2000
      OR (c->>'reserved_micro_usd')::bigint<>octet_length(c->>'prompt')+8192+5*(c->>'max_output_tokens')::bigint
      OR c->>'outcome' NOT IN('pending','succeeded','definitely_not_sent','outcome_unknown','failed') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Call envelope is invalid.'; END IF;
    IF c ? 'response_text' AND (octet_length(c->>'response_text')>16384 OR c->>'response_digest' IS DISTINCT FROM signal_semantic_context_digest_v1(c->>'response_text')) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Response bytes/digest are invalid.'; END IF;
    IF c->>'outcome'='succeeded' AND NOT (c ? 'input_tokens' AND c ? 'output_tokens' AND c ? 'cost_micro_usd' AND c ? 'response_text') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Successful call needs exact response and usage.'; END IF;
    IF c ? 'cost_micro_usd' THEN
      IF (c->>'cost_micro_usd')::bigint<>(CASE WHEN c->>'outcome'='definitely_not_sent' THEN 0 ELSE (c->>'input_tokens')::bigint+5*(c->>'output_tokens')::bigint END) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cost is not derived from provider usage.'; END IF;
      amount:=amount+(c->>'cost_micro_usd')::bigint;
    ELSE known:=false; END IF;
    tokens_in:=tokens_in+COALESCE((c->>'input_tokens')::bigint,0);tokens_out:=tokens_out+COALESCE((c->>'output_tokens')::bigint,0);
  END LOOP;
  IF NEW.provider_calls<>jsonb_array_length(NEW.calls) OR NEW.input_tokens<>tokens_in OR NEW.output_tokens<>tokens_out
    OR NEW.cost_micro_usd IS DISTINCT FROM (CASE WHEN known THEN amount ELSE NULL END) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Execution counters do not reconcile.'; END IF;
  IF NEW.status='completed' THEN
    c:=NEW.calls->-1;
    IF c->>'outcome'<>'succeeded' OR NEW.output_text IS DISTINCT FROM c->>'response_text'
      OR NEW.output_digest IS DISTINCT FROM signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1(NEW.adaptation->'suggestion'))
      OR NEW.cost_micro_usd IS NULL
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.calls) item WHERE item->>'outcome'<>'succeeded') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed execution is not backed by calls.'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_signal_topic_rule_suggestion_executions BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_rule_suggestion_executions
  FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_rule_suggestion_execution_v1();

ALTER TABLE signal_topic_rule_suggestion_receipts
  DROP CONSTRAINT signal_topic_rule_suggestion_receipts_origin_check,
  DROP CONSTRAINT signal_topic_rule_suggestion_receipts_provider_execution_check,
  DROP CONSTRAINT signal_topic_rule_suggestion_receipts_provider_calls_check,
  DROP CONSTRAINT signal_topic_rule_suggestion_receipts_input_tokens_check,
  DROP CONSTRAINT signal_topic_rule_suggestion_receipts_output_tokens_check,
  DROP CONSTRAINT signal_topic_rule_suggestion_receipts_cost_micro_usd_check,
  ADD COLUMN execution_id uuid REFERENCES signal_topic_rule_suggestion_executions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT signal_topic_suggestion_origin_execution CHECK(
    (origin='local_fixture' AND NOT provider_execution AND execution_id IS NULL AND provider_calls=0 AND input_tokens=0 AND output_tokens=0 AND cost_micro_usd=0)
    OR (origin='provider' AND provider_execution AND execution_id IS NOT NULL AND provider_calls BETWEEN 1 AND 12 AND input_tokens>=0 AND output_tokens>=0 AND cost_micro_usd>=0)),
  ADD CONSTRAINT signal_topic_suggestion_execution_unique UNIQUE(execution_id);
-- Preserve the original fixture validator byte-for-byte and constrain it to fixtures.
DROP TRIGGER validate_signal_topic_rule_suggestion_receipts ON signal_topic_rule_suggestion_receipts;
CREATE TRIGGER validate_signal_topic_rule_suggestion_receipts BEFORE INSERT ON signal_topic_rule_suggestion_receipts
  FOR EACH ROW WHEN(NEW.origin='local_fixture') EXECUTE FUNCTION validate_signal_topic_rule_suggestion_receipt_v1();
CREATE FUNCTION validate_signal_topic_rule_provider_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution signal_topic_rule_suggestion_executions%ROWTYPE;
BEGIN
  SELECT * INTO execution FROM signal_topic_rule_suggestion_executions WHERE id=NEW.execution_id FOR UPDATE;
  IF execution.id IS NULL OR execution.status<>'completed' OR execution.purpose<>'topic_rule_suggestion_v1'
    OR execution.receipt_id<>NEW.id OR execution.workspace_id<>NEW.workspace_id OR execution.run_id<>NEW.run_id
    OR execution.candidate_id<>NEW.candidate_id OR execution.snapshot_id<>NEW.snapshot_id OR execution.actor_user_id<>NEW.actor_user_id
    OR execution.request IS DISTINCT FROM NEW.request OR execution.request_digest<>NEW.request_digest
    OR execution.context IS DISTINCT FROM NEW.context OR execution.prepared_context IS DISTINCT FROM NEW.prepared_context
    OR execution.adaptation IS DISTINCT FROM NEW.adaptation OR execution.output_digest<>NEW.output_digest OR execution.receipt_digest<>NEW.receipt_digest
    OR execution.provider_calls<>NEW.provider_calls OR execution.input_tokens<>NEW.input_tokens OR execution.output_tokens<>NEW.output_tokens
    OR execution.cost_micro_usd IS DISTINCT FROM NEW.cost_micro_usd OR execution.rights_digest<>NEW.rights_digest OR execution.authority_digest<>NEW.authority_digest
    OR NEW.source_revision<>(execution.context->'source'->>'candidate_revision')::int
    OR NEW.source_state_token IS DISTINCT FROM execution.context->'source'->>'candidate_state_token'
    OR NEW.source_version_digest IS DISTINCT FROM execution.context->'source'->>'candidate_version_digest'
    OR NEW.context_digest<>signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1(NEW.context)) OR NEW.prepared_context_digest<>signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1(NEW.prepared_context))
    OR NEW.fixture IS DISTINCT FROM jsonb_build_object('execution_id',execution.id::text,'purpose',execution.purpose)
    OR NEW.fixture_digest<>signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1(NEW.fixture))
    OR NEW.idempotency_key<>'topic-rule-execution:'||execution.id::text
    OR NEW.receipt_digest<>signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1(jsonb_build_object('origin','provider','execution_id',execution.id::text,
      'request_digest',execution.request_digest,'output_digest',execution.output_digest,'context_digest',NEW.context_digest,
      'prepared_context_digest',NEW.prepared_context_digest,'calls_digest',signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1((SELECT jsonb_agg(item-ARRAY['prompt','response_text'] ORDER BY ord) FROM jsonb_array_elements(execution.calls) WITH ORDINALITY entry(item,ord)))),
      'adaptation_digest',signal_semantic_context_digest_v1(signal_semantic_context_canonical_json_v1(execution.adaptation))))) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Provider receipt lacks its exact durable purpose terminal.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id AND run.workspace_id=candidate.workspace_id
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id AND snapshot.workspace_id=run.workspace_id
    JOIN signal_semantic_context_generations generation ON generation.id=snapshot.semantic_context_generation_id
    JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
    LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions WHERE candidate_id=candidate.id ORDER BY revision DESC LIMIT 1) editorial ON true
    WHERE candidate.id=NEW.candidate_id AND candidate.workspace_id=NEW.workspace_id AND run.id=NEW.run_id AND snapshot.id=NEW.snapshot_id
      AND run.status='completed' AND snapshot.state='frozen' AND candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
      AND COALESCE(editorial.review_state,'pending')='pending' AND COALESCE(editorial.revision,1)=NEW.source_revision
      AND COALESCE(editorial.version_digest,base.payload_digest)=NEW.source_version_digest
      AND generation.workspace_id=NEW.workspace_id AND generation.status='draft'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations newer WHERE newer.supersedes_generation_id=generation.id)
      AND signal_topic_evaluation_v2_semantic_authority_digest_v1(generation.id)=NEW.authority_digest)
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.adaptation->'provenance'->'evidence') evidence
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_cluster_memberships membership
        JOIN mentions mention ON mention.id=membership.mention_id JOIN data_sources source ON source.id=mention.data_source_id
        WHERE membership.snapshot_id=NEW.snapshot_id AND membership.workspace_id=NEW.workspace_id
          AND signal_semantic_context_digest_json_v2(jsonb_build_object('snapshot',NEW.context->'source'->>'snapshot_digest',
            'member_ref',membership.member_ref,'source',membership.source_record_digest))=evidence.value->>'evidence_ref'
          AND membership.source_record_digest=evidence.value->>'source_digest' AND mention.workspace_id=NEW.workspace_id
          AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included' AND source.workspace_id=NEW.workspace_id AND source.status='active'
          AND mention.text_hash=membership.canonical_text_hash AND signal_semantic_context_digest_v1(btrim(regexp_replace(normalize(mention.text_clean,NFKC),
            U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')))=membership.source_content_hash)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Provider receipt source, actor or evidence is no longer current.'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_signal_topic_rule_provider_receipts BEFORE INSERT ON signal_topic_rule_suggestion_receipts
  FOR EACH ROW WHEN(NEW.origin='provider') EXECUTE FUNCTION validate_signal_topic_rule_provider_receipt_v1();
ALTER TABLE signal_topic_rule_suggestion_executions ADD CONSTRAINT signal_topic_suggestion_terminal_receipt
  FOREIGN KEY(receipt_id) REFERENCES signal_topic_rule_suggestion_receipts(id) DEFERRABLE INITIALLY DEFERRED;
