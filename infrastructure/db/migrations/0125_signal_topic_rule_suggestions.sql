-- Local-fixture suggestion receipts and ordinary-draft links only. No execution authority.
-- Depends on product 0112/0115/0123; does not copy or require Lab migrations.
CREATE TABLE signal_topic_rule_suggestion_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,candidate_id uuid NOT NULL,snapshot_id uuid NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>=1),
  source_version_digest text NOT NULL CHECK(source_version_digest~'^sha256:[0-9a-f]{64}$'),
  source_state_token text NOT NULL CHECK(source_state_token~'^sha256:[0-9a-f]{64}$'),
  rights_digest text NOT NULL CHECK(rights_digest~'^sha256:[0-9a-f]{64}$'),
  authority_digest text NOT NULL CHECK(authority_digest~'^sha256:[0-9a-f]{64}$'),
  origin text NOT NULL DEFAULT 'local_fixture' CHECK(origin='local_fixture'),
  provider_execution boolean NOT NULL DEFAULT false CHECK(NOT provider_execution),
  provider_calls integer NOT NULL DEFAULT 0 CHECK(provider_calls=0),input_tokens integer NOT NULL DEFAULT 0 CHECK(input_tokens=0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK(output_tokens=0),cost_micro_usd bigint NOT NULL DEFAULT 0 CHECK(cost_micro_usd=0),
  fixture jsonb NOT NULL CHECK(jsonb_typeof(fixture)='object' AND pg_column_size(fixture)<=32768),
  fixture_digest text NOT NULL CHECK(fixture_digest~'^sha256:[0-9a-f]{64}$'),
  context jsonb NOT NULL CHECK(jsonb_typeof(context)='object' AND pg_column_size(context)<=262144),
  context_digest text NOT NULL CHECK(context_digest~'^sha256:[0-9a-f]{64}$'),
  prepared_context jsonb NOT NULL CHECK(jsonb_typeof(prepared_context)='object' AND pg_column_size(prepared_context)<=32768),
  prepared_context_digest text NOT NULL CHECK(prepared_context_digest~'^sha256:[0-9a-f]{64}$'),
  adaptation jsonb NOT NULL CHECK(jsonb_typeof(adaptation)='object' AND pg_column_size(adaptation)<=65536),
  output_digest text NOT NULL CHECK(output_digest~'^sha256:[0-9a-f]{64}$'),
  receipt_digest text NOT NULL CHECK(receipt_digest~'^sha256:[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND pg_column_size(request)<=49152),
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(candidate_id,run_id,workspace_id) REFERENCES signal_topic_evaluation_v2_candidates(id,run_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(snapshot_id,workspace_id) REFERENCES signal_topic_evaluation_v2_snapshots(id,workspace_id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,idempotency_key),UNIQUE(id,workspace_id)
);
CREATE TABLE signal_topic_rule_suggestion_draft_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL,draft_id uuid NOT NULL,action text NOT NULL CHECK(action IN('save','restore')),
  restore_draft_id uuid REFERENCES signal_topic_contract_draft_versions(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._:-]{8,200}$'),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND pg_column_size(request)<=49152),
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
  draft_key text NOT NULL CHECK(draft_key~'^topic-suggestion-draft:[0-9a-f]{64}$'),
  draft_request jsonb NOT NULL CHECK(jsonb_typeof(draft_request)='object' AND pg_column_size(draft_request)<=49152),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((action='restore')=(restore_draft_id IS NOT NULL)),
  FOREIGN KEY(receipt_id,workspace_id) REFERENCES signal_topic_rule_suggestion_receipts(id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(draft_id,workspace_id) REFERENCES signal_topic_contract_draft_versions(id,workspace_id) ON DELETE RESTRICT,
  UNIQUE(workspace_id,idempotency_key),UNIQUE(draft_id)
);

CREATE FUNCTION validate_signal_topic_rule_suggestion_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src record; prior record; context_source jsonb; c jsonb; b jsonb; t jsonb; mention jsonb; item jsonb;
DECLARE suggestion jsonb; provenance jsonb; expected_evidence jsonb; selected_refs jsonb; expected_spec jsonb;
DECLARE k text; lexical_count integer:=0; member record; expected_refs jsonb; prepared_trace jsonb; prepared_mention jsonb;
DECLARE element_row record; safe_text text; prepared_bootstrap jsonb; visible_item jsonb; original_item jsonb; ordinal bigint;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion actor is outside workspace authority.'; END IF;
  PERFORM 1 FROM signal_topic_evaluation_v2_candidates WHERE id=NEW.candidate_id FOR UPDATE;
  SELECT run.run_key,candidate.candidate_key,candidate.source_cluster_keys,snapshot.snapshot_digest,snapshot.rights_digest,
    snapshot.semantic_context_authority_digest, snapshot.semantic_context_generation_id,
    COALESCE(editorial.revision,1) revision,COALESCE(editorial.version_digest,base.payload_digest) version_digest,
    COALESCE(editorial.review_state,'pending') review_state,COALESCE(editorial.title,base.payload->>'title') title,
    COALESCE(editorial.description,base.payload->>'description') description,
    COALESCE(editorial.inclusion,base.payload->'inclusion') inclusion,COALESCE(editorial.exclusion,base.payload->'exclusion') exclusion
    INTO src FROM signal_topic_evaluation_v2_candidates candidate JOIN signal_topic_evaluation_v2_runs run
      ON run.id=candidate.run_id AND run.workspace_id=candidate.workspace_id
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id AND snapshot.workspace_id=run.workspace_id
    JOIN signal_semantic_context_generations generation ON generation.id=snapshot.semantic_context_generation_id AND generation.workspace_id=snapshot.workspace_id
    JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
    LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions
      WHERE candidate_id=candidate.id ORDER BY revision DESC LIMIT 1) editorial ON true
    WHERE candidate.id=NEW.candidate_id AND candidate.workspace_id=NEW.workspace_id AND candidate.run_id=NEW.run_id
      AND run.snapshot_id=NEW.snapshot_id AND run.status='completed' AND snapshot.state='frozen'
      AND candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
      AND generation.status='draft' AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations newer
        WHERE newer.workspace_id=generation.workspace_id AND newer.supersedes_generation_id=generation.id)
      AND signal_topic_evaluation_v2_semantic_authority_digest_v1(generation.id)=snapshot.semantic_context_authority_digest;
  IF src IS NULL OR src.review_state<>'pending' OR NEW.source_revision<>src.revision OR NEW.source_version_digest<>src.version_digest
    OR NEW.source_state_token<>signal_topic_evaluation_v2_candidate_state_token_v1(NEW.candidate_id,src.revision,src.version_digest)
    OR NEW.rights_digest<>src.rights_digest OR NEW.authority_digest<>src.semantic_context_authority_digest THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion source or Brand OS authority is stale.'; END IF;
  SELECT revision,draft_digest INTO prior FROM signal_topic_contract_draft_versions WHERE candidate_id=NEW.candidate_id ORDER BY revision DESC LIMIT 1;
  context_source:=jsonb_build_object('workspace_id',NEW.workspace_id::text,'run_key',src.run_key,'candidate_key',src.candidate_key,
    'snapshot_digest',src.snapshot_digest,'session_key','topic-rule-fixture:'||substr(substr(signal_semantic_context_digest_json_v2(
      jsonb_build_object('requestDigest',NEW.request_digest,'key',NEW.idempotency_key)),8),1,32),
    'candidate_revision',src.revision,'candidate_state_token',NEW.source_state_token,'candidate_version_digest',src.version_digest);
  SELECT COALESCE(jsonb_agg(evidence_ref ORDER BY evidence_ref),'[]'::jsonb) INTO expected_refs
    FROM signal_topic_evaluation_v2_candidate_evidence WHERE candidate_id=NEW.candidate_id;
  c:=NEW.context->'candidate';b:=NEW.context->'brand_os';
  IF NEW.context-(ARRAY['source','candidate','draft','brand_os','traces'])<>'{}'::jsonb
    OR NEW.context->'source' IS DISTINCT FROM context_source
    OR NEW.context->'draft' IS DISTINCT FROM jsonb_build_object('revision',COALESCE(prior.revision,0),'digest',prior.draft_digest)
    OR c IS DISTINCT FROM jsonb_build_object('label',src.title,'definition',src.description,'inclusion',src.inclusion,'exclusion',src.exclusion,
      'source_cluster_keys',(SELECT jsonb_agg(key ORDER BY key COLLATE "C") FROM unnest(src.source_cluster_keys) key),'historical_evidence_refs',expected_refs)
    OR b-(ARRAY['source','status','authority_digest','elements'])<>'{}'::jsonb OR b->'source' IS DISTINCT FROM context_source
    OR b->>'authority_digest' IS DISTINCT FROM NEW.authority_digest OR b->>'status' NOT IN('available','empty')
    OR jsonb_typeof(b->'elements') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'elements')>40
    OR (b->>'status'='empty') IS DISTINCT FROM (jsonb_array_length(b->'elements')=0)
    OR jsonb_typeof(NEW.context->'traces') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.context->'traces')<>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion context is invalid.'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(b->'elements') LOOP
    SELECT element.*,COALESCE(element.scope,'workspace') public_scope,
      (SELECT count(*)::int FROM analysis_evidence_links link WHERE link.evidence_group_id=element.evidence_group_id) evidence_count
      INTO element_row FROM signal_semantic_context_element_versions element
      WHERE element.generation_id=src.semantic_context_generation_id AND element.workspace_id=NEW.workspace_id
        AND element.element_key=item->>'element_key' AND element.disposition='approved' AND element.lifecycle_state='active'
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions newer WHERE newer.supersedes_element_id=element.id);
    -- Same redaction order as sanitizeSignalTopicEvidenceExcerptV2. A bounded prefix is
    -- permitted because the pure context compiler shortens prose, never metadata.
    safe_text:=regexp_replace(normalize(element_row.display_text,NFC),U&'[\0001-\001F\007F]',' ','g');
    safe_text:=regexp_replace(safe_text,'\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y','[email]','gi');
    safe_text:=regexp_replace(safe_text,'https?://[^[:space:]]+','[url]','gi');
    safe_text:=regexp_replace(safe_text,'(^|[^A-Za-z0-9_])@[[:alpha:][:digit:]_.-]{2,}','\1[handle]','g');
    safe_text:=regexp_replace(safe_text,'\y(sk|key|token|secret)[-_][A-Za-z0-9_-]{8,}\y','[redacted]','gi');
    safe_text:=btrim(regexp_replace(safe_text,U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'));
    IF item-(ARRAY['element_key','element_kind','display_text','scope','locale','source_refs_digest','evidence_count'])<>'{}'::jsonb
      OR element_row.id IS NULL OR item->>'element_kind' IS DISTINCT FROM element_row.element_kind
      OR item->>'source_refs_digest' IS DISTINCT FROM element_row.source_refs_digest
      OR item->>'scope' IS DISTINCT FROM element_row.public_scope OR item->'locale' IS DISTINCT FROM COALESCE(to_jsonb(element_row.locale),'null'::jsonb)
      OR item->'evidence_count' IS DISTINCT FROM to_jsonb(element_row.evidence_count)
      OR jsonb_typeof(item->'display_text') IS DISTINCT FROM 'string' OR char_length(item->>'display_text') NOT BETWEEN 1 AND 600
      OR left(safe_text,char_length(item->>'display_text')) IS DISTINCT FROM item->>'display_text' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion Brand OS element is invalid.'; END IF;
  END LOOP;
  t:=NEW.context->'traces'->0;
  IF t-(ARRAY['source','trace_index','operation','cluster_key','result_digest','mentions'])<>'{}'::jsonb
    OR t->'source' IS DISTINCT FROM context_source OR t->'trace_index' IS DISTINCT FROM '3'::jsonb
    OR t->>'operation' IS DISTINCT FROM 'representative_mentions'
    OR t->>'cluster_key' IS DISTINCT FROM (SELECT key FROM unnest(src.source_cluster_keys) key ORDER BY key COLLATE "C" LIMIT 1)
    OR NOT COALESCE(t->>'result_digest'~'^sha256:[0-9a-f]{64}$',false)
    OR jsonb_typeof(t->'mentions') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'mentions')>12
    OR (SELECT count(DISTINCT value->>'evidence_ref') FROM jsonb_array_elements(t->'mentions'))<>jsonb_array_length(t->'mentions') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion fresh trace is invalid.'; END IF;
  FOR mention IN SELECT value FROM jsonb_array_elements(t->'mentions') LOOP
    IF mention->>'status'='available' THEN
      SELECT membership.*,m.text_hash,m.text_clean INTO member FROM signal_topic_evaluation_v2_cluster_memberships membership
        JOIN mentions m ON m.id=membership.mention_id JOIN data_sources data_source ON data_source.id=m.data_source_id
        WHERE membership.snapshot_id=NEW.snapshot_id AND membership.workspace_id=NEW.workspace_id AND membership.cluster_key=t->>'cluster_key'
          AND signal_semantic_context_digest_json_v2(jsonb_build_object('snapshot',src.snapshot_digest,'member_ref',membership.member_ref,
            'source',membership.source_record_digest))=mention->>'evidence_ref'
          AND membership.source_record_digest=mention->>'source_digest' AND m.workspace_id=NEW.workspace_id AND m.id=m.canonical_mention_id
          AND m.inclusion_status='included' AND data_source.workspace_id=NEW.workspace_id AND data_source.status='active'
          AND m.text_hash=membership.canonical_text_hash AND signal_semantic_context_digest_v1(btrim(regexp_replace(normalize(m.text_clean,NFKC),
            U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')))=membership.source_content_hash;
      safe_text:=regexp_replace(normalize(member.text_clean,NFC),U&'[\0001-\001F\007F]',' ','g');
      safe_text:=regexp_replace(safe_text,'\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y','[email]','gi');
      safe_text:=regexp_replace(safe_text,'https?://[^[:space:]]+','[url]','gi');
      safe_text:=regexp_replace(safe_text,'(^|[^A-Za-z0-9_])@[[:alpha:][:digit:]_.-]{2,}','\1[handle]','g');
      safe_text:=regexp_replace(safe_text,'\y(sk|key|token|secret)[-_][A-Za-z0-9_-]{8,}\y','[redacted]','gi');
      safe_text:=btrim(regexp_replace(safe_text,U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'));
      IF member IS NULL OR mention-(ARRAY['status','evidence_ref','source_digest','excerpt','language','market','scope','month','stratum'])<>'{}'::jsonb
        OR jsonb_typeof(mention->'excerpt') IS DISTINCT FROM 'string' OR char_length(mention->>'excerpt') NOT BETWEEN 1 AND 600
        OR left(safe_text,char_length(mention->>'excerpt')) IS DISTINCT FROM mention->>'excerpt'
        OR mention->'language' IS DISTINCT FROM COALESCE(to_jsonb(member.language),'null'::jsonb)
        OR mention->'market' IS DISTINCT FROM COALESCE(to_jsonb(member.market),'null'::jsonb)
        OR mention->'scope' IS DISTINCT FROM COALESCE(to_jsonb(member.scope),'null'::jsonb)
        OR mention->>'month' IS DISTINCT FROM member.published_month OR mention->>'stratum' IS DISTINCT FROM member.stratum THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion mention binding or current rights is invalid.'; END IF;
    ELSIF mention->>'status'='unavailable' THEN
      IF mention-(ARRAY['status','evidence_ref','reason'])<>'{}'::jsonb OR NOT COALESCE(mention->>'evidence_ref'~'^sha256:[0-9a-f]{64}$'
        AND mention->>'reason' IN('rights_changed','source_changed','reference_unavailable'),false) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion unavailable mention is invalid.'; END IF;
    ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion mention status is invalid.'; END IF;
  END LOOP;
  IF NEW.prepared_context-(ARRAY['contract_version','context_digest','bootstrap','history','omitted_trace_count','omitted_mention_count',
      'history_compacted','bootstrap_compacted'])<>'{}'::jsonb
    OR NEW.prepared_context->>'contract_version' IS DISTINCT FROM 'signal-topic-rule-suggestion-context-v1'
    OR NEW.prepared_context->>'context_digest' IS DISTINCT FROM NEW.context_digest
    OR jsonb_typeof(NEW.prepared_context->'history') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.prepared_context->'history')>1
    OR octet_length(signal_semantic_context_canonical_json_v2(NEW.prepared_context))>18432
    OR NEW.prepared_context->'omitted_trace_count' IS DISTINCT FROM to_jsonb(1-jsonb_array_length(NEW.prepared_context->'history'))
    OR NEW.prepared_context->'omitted_mention_count' IS DISTINCT FROM to_jsonb(jsonb_array_length(t->'mentions')-
      COALESCE((SELECT sum(jsonb_array_length(value->'mentions'))::int FROM jsonb_array_elements(NEW.prepared_context->'history')),0))
    OR jsonb_typeof(NEW.prepared_context->'history_compacted') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(NEW.prepared_context->'bootstrap_compacted') IS DISTINCT FROM 'boolean'
    OR NEW.prepared_context_digest<>signal_semantic_context_digest_json_v2(NEW.prepared_context) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion prepared context is invalid.'; END IF;
  prepared_bootstrap:=NEW.prepared_context->'bootstrap';
  IF prepared_bootstrap-(ARRAY['candidate','brand_os'])<>'{}'::jsonb
    OR (prepared_bootstrap->'candidate')-(ARRAY['inclusion','exclusion']) IS DISTINCT FROM
      (c-(ARRAY['inclusion','exclusion','historical_evidence_refs']))||jsonb_build_object('candidate_key',src.candidate_key)
    OR (prepared_bootstrap->'brand_os')-'elements' IS DISTINCT FROM b-(ARRAY['source','elements'])
    OR jsonb_typeof(prepared_bootstrap->'brand_os'->'elements') IS DISTINCT FROM 'array'
    OR jsonb_array_length(prepared_bootstrap->'brand_os'->'elements')<>jsonb_array_length(b->'elements') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion pinned bootstrap is invalid.'; END IF;
  FOREACH k IN ARRAY ARRAY['inclusion','exclusion'] LOOP
    IF jsonb_typeof(prepared_bootstrap->'candidate'->k) IS DISTINCT FROM 'array'
      OR jsonb_array_length(prepared_bootstrap->'candidate'->k)<>jsonb_array_length(c->k) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion pinned editorial list is invalid.'; END IF;
    FOR visible_item,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(prepared_bootstrap->'candidate'->k) WITH ORDINALITY LOOP
      original_item:=c->k->(ordinal::int-1);
      IF jsonb_typeof(visible_item) IS DISTINCT FROM 'string' OR char_length(visible_item#>>'{}')<1
        OR left(original_item#>>'{}',char_length(visible_item#>>'{}')) IS DISTINCT FROM visible_item#>>'{}' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion visible editorial prose is invalid.'; END IF;
    END LOOP;
  END LOOP;
  FOR visible_item,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(prepared_bootstrap->'brand_os'->'elements') WITH ORDINALITY LOOP
    original_item:=b->'elements'->(ordinal::int-1);
    IF (visible_item-'display_text') IS DISTINCT FROM (original_item-'display_text')
      OR jsonb_typeof(visible_item->'display_text') IS DISTINCT FROM 'string' OR char_length(visible_item->>'display_text')<1
      OR left(original_item->>'display_text',char_length(visible_item->>'display_text')) IS DISTINCT FROM visible_item->>'display_text' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion visible Brand OS is invalid.'; END IF;
  END LOOP;
  FOR prepared_trace IN SELECT value FROM jsonb_array_elements(NEW.prepared_context->'history') LOOP
    IF prepared_trace-(ARRAY['trace_index','operation','cluster_key','result_digest','mentions'])<>'{}'::jsonb
      OR prepared_trace-'mentions' IS DISTINCT FROM t-(ARRAY['source','mentions'])
      OR jsonb_typeof(prepared_trace->'mentions') IS DISTINCT FROM 'array' OR jsonb_array_length(prepared_trace->'mentions')>12
      OR (SELECT count(DISTINCT value->>'evidence_ref') FROM jsonb_array_elements(prepared_trace->'mentions'))<>jsonb_array_length(prepared_trace->'mentions') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion visible trace is invalid.'; END IF;
    FOR prepared_mention IN SELECT value FROM jsonb_array_elements(prepared_trace->'mentions') LOOP
      SELECT value INTO mention FROM jsonb_array_elements(t->'mentions') WHERE value->>'evidence_ref'=prepared_mention->>'evidence_ref';
      IF mention IS NULL OR (prepared_mention-'excerpt') IS DISTINCT FROM (mention-'excerpt')
        OR (prepared_mention->>'status'='available' AND (jsonb_typeof(prepared_mention->'excerpt') IS DISTINCT FROM 'string'
          OR char_length(prepared_mention->>'excerpt') NOT BETWEEN 1 AND 600
          OR left(mention->>'excerpt',char_length(prepared_mention->>'excerpt')) IS DISTINCT FROM prepared_mention->>'excerpt')) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion visible citation is invalid.'; END IF;
    END LOOP;
  END LOOP;
  suggestion:=NEW.adaptation->'suggestion';
  IF NEW.fixture->>'status'='suggested' THEN
    IF NEW.fixture-(ARRAY['status','lexical','filters','explanation','citation_count'])<>'{}'::jsonb
      OR NOT COALESCE((NEW.fixture->>'citation_count')::int BETWEEN 1 AND 12,false) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion fixture is invalid.'; END IF;
    SELECT COALESCE(jsonb_agg(ref ORDER BY ref),'[]'::jsonb) INTO selected_refs FROM(
      SELECT m.value->>'evidence_ref' ref FROM jsonb_array_elements(NEW.prepared_context->'history') h,
        LATERAL jsonb_array_elements(h.value->'mentions') m WHERE m.value->>'status'='available'
      ORDER BY (m.value->>'evidence_ref') COLLATE "C" LIMIT (NEW.fixture->>'citation_count')::int) selected;
    IF jsonb_array_length(selected_refs)<>(NEW.fixture->>'citation_count')::int THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion fixture lacks available evidence.'; END IF;
    expected_spec:=jsonb_build_object('contract_version','signal-topic-rule-spec-v1','kind','topic','label',src.title,'definition',src.description,
      'lexical',NEW.fixture->'lexical','filters',NEW.fixture->'filters');
    IF suggestion IS DISTINCT FROM jsonb_build_object('contract_version','signal-topic-rule-suggestion-v1','status','suggested',
      'lexical',NEW.fixture->'lexical','filters',NEW.fixture->'filters','explanation',NEW.fixture->'explanation','evidence_refs',selected_refs)
      OR NEW.adaptation->'rule_spec' IS DISTINCT FROM expected_spec
      OR NEW.adaptation->>'spec_digest' IS DISTINCT FROM signal_semantic_context_digest_json_v2(expected_spec)
      OR (expected_spec->'lexical')-(ARRAY['any','all','not'])<>'{}'::jsonb
      OR (expected_spec->'filters')-(ARRAY['languages','markets','scopes'])<>'{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion output or spec is invalid.'; END IF;
    FOREACH k IN ARRAY ARRAY['any','all','not'] LOOP
      IF jsonb_typeof(expected_spec->'lexical'->k) IS DISTINCT FROM 'array' OR jsonb_array_length(expected_spec->'lexical'->k)>16 THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion lexical clause is invalid.'; END IF;
      IF expected_spec->'lexical'->k IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb)
        FROM(SELECT DISTINCT value FROM jsonb_array_elements_text(expected_spec->'lexical'->k)) literals) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion lexical clause must be canonical.'; END IF;
      lexical_count:=lexical_count+jsonb_array_length(expected_spec->'lexical'->k);
      FOR item IN SELECT value FROM jsonb_array_elements(expected_spec->'lexical'->k) LOOP
        IF jsonb_typeof(item)<>'string' OR char_length(item#>>'{}') NOT BETWEEN 1 AND 160
          OR (item#>>'{}')!~'[[:alnum:]]' OR (item#>>'{}')~U&'[\0001-\0008\000E-\001F\007F]'
          OR (item#>>'{}') IS DISTINCT FROM btrim(regexp_replace(item#>>'{}',U&'[\0009-\000D\0020]+',' ','g')) THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion lexical literal is invalid.'; END IF;
      END LOOP;
    END LOOP;
    IF lexical_count>32 OR jsonb_array_length(expected_spec->'lexical'->'any')+jsonb_array_length(expected_spec->'lexical'->'all')=0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion needs positive lexical evidence.'; END IF;
    FOREACH k IN ARRAY ARRAY['languages','markets','scopes'] LOOP
      IF jsonb_typeof(expected_spec->'filters'->k) IS DISTINCT FROM 'array' OR jsonb_array_length(expected_spec->'filters'->k)>16 THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion filter is invalid.'; END IF;
      IF expected_spec->'filters'->k IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb)
        FROM(SELECT DISTINCT value FROM jsonb_array_elements_text(expected_spec->'filters'->k)) filters) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion filter must be canonical.'; END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(expected_spec->'filters'->k) LOOP
        IF jsonb_typeof(item)<>'string' OR (k='languages' AND (item#>>'{}')!~'^[a-z]{2}$')
          OR (k='markets' AND (item#>>'{}')!~'^[A-Z]{2}$') OR (k='scopes' AND (item#>>'{}') NOT IN('primary_brand','same_entity','competitor','category','other')) THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion filter value is invalid.'; END IF;
      END LOOP;
    END LOOP;
  ELSIF NEW.fixture->>'status'='insufficient_evidence' THEN
    selected_refs:='[]'::jsonb;
    IF NEW.fixture-(ARRAY['status','explanation'])<>'{}'::jsonb OR suggestion IS DISTINCT FROM
      jsonb_build_object('contract_version','signal-topic-rule-suggestion-v1','status','insufficient_evidence','explanation',NEW.fixture->'explanation')
      OR NEW.adaptation->'rule_spec' IS DISTINCT FROM 'null'::jsonb OR NEW.adaptation->'spec_digest' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Insufficient fixture cannot contain a matcher.'; END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion fixture status is invalid.'; END IF;
  IF jsonb_typeof(NEW.fixture->'explanation') IS DISTINCT FROM 'string' OR char_length(btrim(NEW.fixture->>'explanation')) NOT BETWEEN 1 AND 600
    OR (NEW.fixture->>'explanation')~U&'[\0001-\0008\000E-\001F\007F]' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion explanation is invalid.'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('evidence_ref',value->>'evidence_ref','source_digest',value->>'source_digest',
    'traces',jsonb_build_array(jsonb_build_object('trace_index',3,'operation','representative_mentions','cluster_key',t->>'cluster_key',
      'result_digest',t->>'result_digest'))) ORDER BY value->>'evidence_ref'),'[]'::jsonb) INTO expected_evidence
    FROM jsonb_array_elements(t->'mentions') WHERE selected_refs ? (value->>'evidence_ref');
  provenance:=jsonb_build_object('source',context_source,'context_digest',NEW.context_digest,'brand_os_status',b->>'status',
    'brand_os_authority_digest',NEW.authority_digest,'evidence',expected_evidence);
  IF NEW.adaptation IS DISTINCT FROM jsonb_build_object('contract_version','signal-topic-rule-suggestion-draft-v1',
      'status',NEW.fixture->>'status','suggestion',suggestion,'suggestion_digest',signal_semantic_context_digest_json_v2(
        jsonb_build_object('suggestion',suggestion,'provenance',provenance)),'provenance',provenance,
      'run_key',src.run_key,'candidate_key',src.candidate_key,'expected_candidate_revision',src.revision,
      'expected_candidate_state_token',NEW.source_state_token,'expected_draft_revision',COALESCE(prior.revision,0),
      'expected_draft_digest',prior.draft_digest,'rule_spec',expected_spec,'spec_digest',CASE WHEN expected_spec IS NULL THEN NULL
        ELSE signal_semantic_context_digest_json_v2(expected_spec) END)
    OR NEW.request IS DISTINCT FROM jsonb_build_object('run_key',src.run_key,'candidate_key',src.candidate_key,
      'expected_candidate_revision',src.revision,'expected_candidate_state_token',NEW.source_state_token,
      'expected_draft_revision',COALESCE(prior.revision,0),'expected_draft_digest',prior.draft_digest,'fixture',NEW.fixture)
    OR NEW.fixture_digest<>signal_semantic_context_digest_json_v2(NEW.fixture) OR NEW.context_digest<>signal_semantic_context_digest_json_v2(NEW.context)
    OR NEW.output_digest<>signal_semantic_context_digest_json_v2(suggestion) OR NEW.request_digest<>signal_semantic_context_digest_json_v2(NEW.request)
    OR NEW.receipt_digest<>signal_semantic_context_digest_json_v2(jsonb_build_object('origin','local_fixture','request_digest',NEW.request_digest,
      'fixture_digest',NEW.fixture_digest,'output_digest',NEW.output_digest,'context_digest',NEW.context_digest,
      'prepared_context_digest',NEW.prepared_context_digest,
      'suggestion_digest',NEW.adaptation->>'suggestion_digest','rights_digest',NEW.rights_digest,'authority_digest',NEW.authority_digest)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion receipt digest or projection is invalid.'; END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION validate_signal_topic_rule_suggestion_draft_link_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt signal_topic_rule_suggestion_receipts%ROWTYPE; draft signal_topic_contract_draft_versions%ROWTYPE;
DECLARE restored signal_topic_contract_draft_versions%ROWTYPE; expected jsonb;
BEGIN
  SELECT * INTO receipt FROM signal_topic_rule_suggestion_receipts WHERE id=NEW.receipt_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO draft FROM signal_topic_contract_draft_versions WHERE id=NEW.draft_id AND workspace_id=NEW.workspace_id;
  IF receipt.id IS NULL OR draft.id IS NULL OR receipt.adaptation->>'status'<>'suggested'
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND user_type='noisia_internal' AND status='active')
    OR NOT signal_data_governance_actor_is_valid(NEW.workspace_id,NEW.actor_user_id)
    OR draft.actor_user_id<>NEW.actor_user_id OR draft.run_id<>receipt.run_id OR draft.candidate_id<>receipt.candidate_id
    OR draft.snapshot_id<>receipt.snapshot_id OR draft.source_revision<>receipt.source_revision
    OR draft.source_version_digest<>receipt.source_version_digest OR draft.source_state_token<>receipt.source_state_token
    OR draft.idempotency_key<>NEW.draft_key OR NEW.draft_request<>draft.request
    OR NEW.request_digest<>signal_semantic_context_digest_json_v2(NEW.request)
    OR NEW.draft_key<>'topic-suggestion-draft:'||substr(signal_semantic_context_digest_json_v2(
      jsonb_build_object('workspace',NEW.workspace_id::text,'key',NEW.idempotency_key)),8)
    OR EXISTS(SELECT 1 FROM signal_topic_contract_draft_versions newer WHERE newer.candidate_id=draft.candidate_id AND newer.revision>draft.revision) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion draft link is outside its source or request.'; END IF;
  -- A historical receipt is not permission to link after editorial, authority or rights drift.
  IF NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id AND run.workspace_id=candidate.workspace_id
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id AND snapshot.workspace_id=run.workspace_id
    JOIN signal_semantic_context_generations generation ON generation.id=snapshot.semantic_context_generation_id
    JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
    LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions
      WHERE candidate_id=candidate.id ORDER BY revision DESC LIMIT 1) editorial ON true
    WHERE candidate.id=receipt.candidate_id AND candidate.workspace_id=NEW.workspace_id AND run.id=receipt.run_id
      AND snapshot.id=receipt.snapshot_id AND snapshot.state='frozen' AND run.status='completed'
      AND candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
      AND COALESCE(editorial.review_state,'pending')='pending' AND COALESCE(editorial.revision,1)=receipt.source_revision
      AND COALESCE(editorial.version_digest,base.payload_digest)=receipt.source_version_digest
      AND generation.workspace_id=NEW.workspace_id AND generation.status='draft'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations newer WHERE newer.supersedes_generation_id=generation.id)
      AND snapshot.rights_digest=receipt.rights_digest AND snapshot.semantic_context_authority_digest=receipt.authority_digest
      AND signal_topic_evaluation_v2_semantic_authority_digest_v1(generation.id)=receipt.authority_digest)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(receipt.adaptation->'provenance'->'evidence') evidence
      WHERE NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_cluster_memberships membership
        JOIN mentions mention ON mention.id=membership.mention_id JOIN data_sources source ON source.id=mention.data_source_id
        WHERE membership.snapshot_id=receipt.snapshot_id AND membership.workspace_id=NEW.workspace_id
          AND signal_semantic_context_digest_json_v2(jsonb_build_object('snapshot',receipt.context->'source'->>'snapshot_digest',
            'member_ref',membership.member_ref,'source',membership.source_record_digest))=evidence.value->>'evidence_ref'
          AND membership.source_record_digest=evidence.value->>'source_digest'
          AND mention.workspace_id=NEW.workspace_id AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
          AND source.workspace_id=NEW.workspace_id AND source.status='active' AND mention.text_hash=membership.canonical_text_hash
          AND signal_semantic_context_digest_v1(btrim(regexp_replace(normalize(mention.text_clean,NFKC),
            U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')))=membership.source_content_hash)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion link source or current evidence is stale.'; END IF;
  expected:=(draft.request-'rule_spec')||jsonb_build_object('receipt_id',receipt.id::text,'action',NEW.action);
  IF NEW.action='restore' THEN
    SELECT * INTO restored FROM signal_topic_contract_draft_versions WHERE id=NEW.restore_draft_id AND workspace_id=NEW.workspace_id
      AND candidate_id=draft.candidate_id AND run_id=draft.run_id AND snapshot_id=draft.snapshot_id AND revision<draft.revision-1;
    IF restored.id IS NULL OR draft.rule_spec->'lexical' IS DISTINCT FROM restored.rule_spec->'lexical'
      OR draft.rule_spec->'filters' IS DISTINCT FROM restored.rule_spec->'filters' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion restoration must append a prior ordinary rule.'; END IF;
    expected:=expected||jsonb_build_object('restore_draft_id',restored.id::text);
  ELSE expected:=expected||jsonb_build_object('lexical',draft.rule_spec->'lexical','filters',draft.rule_spec->'filters'); END IF;
  IF NEW.request IS DISTINCT FROM expected THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion link request is invalid.'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_signal_topic_rule_suggestion_receipts BEFORE INSERT ON signal_topic_rule_suggestion_receipts
  FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_rule_suggestion_receipt_v1();
CREATE TRIGGER validate_signal_topic_rule_suggestion_draft_links BEFORE INSERT ON signal_topic_rule_suggestion_draft_links
  FOR EACH ROW EXECUTE FUNCTION validate_signal_topic_rule_suggestion_draft_link_v1();
CREATE TRIGGER protect_signal_topic_rule_suggestion_receipts BEFORE UPDATE OR DELETE ON signal_topic_rule_suggestion_receipts
  FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_contract_draft_v1();
CREATE TRIGGER protect_signal_topic_rule_suggestion_draft_links BEFORE UPDATE OR DELETE ON signal_topic_rule_suggestion_draft_links
  FOR EACH ROW EXECUTE FUNCTION protect_signal_topic_contract_draft_v1();
CREATE INDEX idx_signal_topic_rule_suggestion_latest ON signal_topic_rule_suggestion_receipts(workspace_id,run_id,candidate_id,created_at DESC,id DESC);
CREATE INDEX idx_signal_topic_rule_suggestion_link_latest ON signal_topic_rule_suggestion_draft_links(receipt_id,created_at DESC,id DESC);
