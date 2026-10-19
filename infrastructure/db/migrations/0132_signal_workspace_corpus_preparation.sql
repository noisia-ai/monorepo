-- Provider-free, workspace-native full-text preparation. No legacy corpus bridge.
-- Forward-only. Inputs retain their original authority; derived snapshots never serve as attribution.
CREATE TABLE signal_corpus_preparation_input_state (
  workspace_id uuid PRIMARY KEY REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  input_revision bigint NOT NULL DEFAULT 1 CHECK(input_revision>0),
  opted_in_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Every workspace receives its revision row before inputs can commit, including
-- before the first preparation request. This closes the first-opt-in writer race.
INSERT INTO signal_corpus_preparation_input_state(workspace_id) SELECT id FROM signal_workspaces;
CREATE OR REPLACE FUNCTION initialize_signal_corpus_preparation_workspace_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO signal_corpus_preparation_input_state(workspace_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_corpus_preparation_workspace_state AFTER INSERT ON signal_workspaces
  FOR EACH ROW EXECUTE FUNCTION initialize_signal_corpus_preparation_workspace_v1();
CREATE TABLE signal_corpus_preparation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_corpus_preparation_input_state(workspace_id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_keys jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(request_keys)='object'),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed','canceled','superseded')),
  phase text NOT NULL DEFAULT 'queued' CHECK(phase IN('queued','snapshotting','chunking','complete')),
  chunk_policy_version text NOT NULL DEFAULT 'corpus-text-chunks-v1' CHECK(chunk_policy_version='corpus-text-chunks-v1'),
  input_revision bigint,
  snapshot_at timestamptz,
  policy_valid_until timestamptz,
  previous_run_id uuid REFERENCES signal_corpus_preparation_runs(id) ON DELETE RESTRICT,
  cursor_root_id uuid,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(counts)='object'),
  accepted_imports jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(accepted_imports)='array'),
  dispatch_attempts integer NOT NULL DEFAULT 0 CHECK(dispatch_attempts>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  dispatch_generation integer NOT NULL DEFAULT 1 CHECK(dispatch_generation>0),
  worker_job_id text NOT NULL,
  dispatch_status text NOT NULL DEFAULT 'pending' CHECK(dispatch_status IN('pending','dispatching','dispatched')),
  dispatch_token uuid,
  dispatch_expires_at timestamptz,
  execution_token uuid,
  execution_expires_at timestamptz,
  error_code text CHECK(error_code IS NULL OR error_code ~ '^corpus_preparation_[a-z_]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(workspace_id,id),
  CHECK((execution_token IS NULL)=(execution_expires_at IS NULL)),
  CHECK((dispatch_token IS NULL)=(dispatch_expires_at IS NULL)),
  CHECK(status<>'completed' OR (phase='complete' AND input_revision IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_signal_corpus_preparation_active ON signal_corpus_preparation_runs(workspace_id)
  WHERE status IN('queued','running');
CREATE INDEX idx_signal_corpus_preparation_latest ON signal_corpus_preparation_runs(workspace_id,created_at DESC,id DESC);
CREATE INDEX idx_signal_corpus_preparation_dispatch ON signal_corpus_preparation_runs(dispatch_status,updated_at,id)
  WHERE status IN('queued','running');
CREATE TABLE signal_corpus_text_assets (
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  text_sha256 text NOT NULL CHECK(text_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  chunk_policy_version text NOT NULL CHECK(chunk_policy_version='corpus-text-chunks-v1'),
  full_text text NOT NULL,
  chunks jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  prepared_at timestamptz,
  PRIMARY KEY(workspace_id,text_sha256,chunk_policy_version),
  CHECK(text_sha256='sha256:'||encode(sha256(convert_to(full_text,'UTF8')),'hex')),
  CHECK((chunks IS NULL)=(prepared_at IS NULL)),
  CHECK(chunks IS NULL OR (jsonb_typeof(chunks)='object'
    AND chunks->>'contract_version'=chunk_policy_version AND chunks->>'text_sha256'=text_sha256
    AND chunks->>'offset_unit'='utf16' AND chunks->>'max_code_units'='1400'
    AND jsonb_typeof(chunks->'chunks')='array'))
);
CREATE TABLE signal_corpus_preparation_items (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  root_id uuid NOT NULL,
  asset_sha256 text,
  chunk_policy_version text NOT NULL DEFAULT 'corpus-text-chunks-v1',
  disposition text NOT NULL CHECK(disposition IN('eligible','excluded','rights_blocked','missing_text','inclusion_pending')),
  root_metadata jsonb NOT NULL CHECK(jsonb_typeof(root_metadata)='object'),
  provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='array'),
  semantic_eligible boolean NOT NULL DEFAULT false,
  fingerprint text NOT NULL CHECK(fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY(run_id,root_id),
  FOREIGN KEY(workspace_id,run_id) REFERENCES signal_corpus_preparation_runs(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,asset_sha256,chunk_policy_version)
    REFERENCES signal_corpus_text_assets(workspace_id,text_sha256,chunk_policy_version) ON DELETE RESTRICT,
  CHECK((disposition='eligible')=(asset_sha256 IS NOT NULL))
);
CREATE INDEX idx_signal_corpus_preparation_item_asset ON signal_corpus_preparation_items(workspace_id,asset_sha256,chunk_policy_version);
CREATE OR REPLACE FUNCTION protect_signal_corpus_preparation_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='signal_corpus_preparation_items' THEN
    RAISE EXCEPTION 'Corpus preparation manifest items are immutable.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.text_sha256 IS DISTINCT FROM OLD.text_sha256 OR NEW.full_text IS DISTINCT FROM OLD.full_text
    OR NEW.chunk_policy_version IS DISTINCT FROM OLD.chunk_policy_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.chunks IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Corpus text assets are immutable after preparation.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_signal_corpus_preparation_item_immutable BEFORE UPDATE OR DELETE ON signal_corpus_preparation_items
  FOR EACH ROW EXECUTE FUNCTION protect_signal_corpus_preparation_immutable_v1();
CREATE TRIGGER trg_signal_corpus_text_asset_immutable BEFORE UPDATE OR DELETE ON signal_corpus_text_assets
  FOR EACH ROW EXECUTE FUNCTION protect_signal_corpus_preparation_immutable_v1();

-- Statement-level transition tables coalesce a batch of edits into one revision per
-- opted-in workspace. Import progress alone does not invalidate a completed snapshot.
CREATE OR REPLACE FUNCTION invalidate_signal_corpus_preparation_inputs_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE query_text text;
BEGIN
  IF TG_OP='INSERT' THEN
    query_text := 'SELECT DISTINCT n.workspace_id FROM new_rows n WHERE '||TG_ARGV[0];
  ELSIF TG_OP='DELETE' THEN
    query_text := 'SELECT DISTINCT o.workspace_id FROM old_rows o WHERE '||TG_ARGV[1];
  ELSE
    query_text := 'SELECT DISTINCT workspace_id FROM ('||
      'SELECT n.workspace_id FROM new_rows n FULL JOIN old_rows o ON n.id=o.id WHERE '||TG_ARGV[2]||
      ' UNION SELECT o.workspace_id FROM new_rows n FULL JOIN old_rows o ON n.id=o.id WHERE '||TG_ARGV[2]||') changed';
  END IF;
  EXECUTE 'UPDATE signal_corpus_preparation_input_state state SET input_revision=state.input_revision+1,'||
    'updated_at=clock_timestamp() WHERE state.workspace_id IN ('||query_text||')';
  RETURN NULL;
END; $$;
CREATE TRIGGER trg_corpus_input_mentions_insert AFTER INSERT ON mentions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('EXISTS(SELECT 1 FROM signal_mention_import_memberships m JOIN import_batches b ON b.id=m.import_batch_id AND b.workspace_id=m.workspace_id WHERE m.workspace_id=n.workspace_id AND m.mention_id=n.id AND b.status=''completed'')','true','(ROW(n.workspace_id,n.canonical_mention_id,n.text_clean,n.inclusion_status,n.exclusion_reason,n.published_at,n.language,n.country,n.platform,n.url) IS DISTINCT FROM ROW(o.workspace_id,o.canonical_mention_id,o.text_clean,o.inclusion_status,o.exclusion_reason,o.published_at,o.language,o.country,o.platform,o.url))');
CREATE TRIGGER trg_corpus_input_mentions_update AFTER UPDATE ON mentions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('EXISTS(SELECT 1 FROM signal_mention_import_memberships m JOIN import_batches b ON b.id=m.import_batch_id AND b.workspace_id=m.workspace_id WHERE m.workspace_id=n.workspace_id AND m.mention_id=n.id AND b.status=''completed'')','true','(ROW(n.workspace_id,n.canonical_mention_id,n.text_clean,n.inclusion_status,n.exclusion_reason,n.published_at,n.language,n.country,n.platform,n.url) IS DISTINCT FROM ROW(o.workspace_id,o.canonical_mention_id,o.text_clean,o.inclusion_status,o.exclusion_reason,o.published_at,o.language,o.country,o.platform,o.url))');
CREATE TRIGGER trg_corpus_input_mentions_delete AFTER DELETE ON mentions
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('EXISTS(SELECT 1 FROM signal_mention_import_memberships m JOIN import_batches b ON b.id=m.import_batch_id AND b.workspace_id=m.workspace_id WHERE m.workspace_id=n.workspace_id AND m.mention_id=n.id AND b.status=''completed'')','true','(ROW(n.workspace_id,n.canonical_mention_id,n.text_clean,n.inclusion_status,n.exclusion_reason,n.published_at,n.language,n.country,n.platform,n.url) IS DISTINCT FROM ROW(o.workspace_id,o.canonical_mention_id,o.text_clean,o.inclusion_status,o.exclusion_reason,o.published_at,o.language,o.country,o.platform,o.url))');
CREATE TRIGGER trg_corpus_input_import_batches_insert AFTER INSERT ON import_batches
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('n.status=''completed''','o.status=''completed''','(ROW(n.workspace_id,n.data_source_id,n.status,n.record_count,n.included_count,n.excluded_count,n.duplicate_count,n.source_file_hash,n.provider_observation_projection_state,n.provider_observation_count) IS DISTINCT FROM ROW(o.workspace_id,o.data_source_id,o.status,o.record_count,o.included_count,o.excluded_count,o.duplicate_count,o.source_file_hash,o.provider_observation_projection_state,o.provider_observation_count)) AND ((n.status=''completed'') OR (o.status=''completed''))');
CREATE TRIGGER trg_corpus_input_import_batches_update AFTER UPDATE ON import_batches
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('n.status=''completed''','o.status=''completed''','(ROW(n.workspace_id,n.data_source_id,n.status,n.record_count,n.included_count,n.excluded_count,n.duplicate_count,n.source_file_hash,n.provider_observation_projection_state,n.provider_observation_count) IS DISTINCT FROM ROW(o.workspace_id,o.data_source_id,o.status,o.record_count,o.included_count,o.excluded_count,o.duplicate_count,o.source_file_hash,o.provider_observation_projection_state,o.provider_observation_count)) AND ((n.status=''completed'') OR (o.status=''completed''))');
CREATE TRIGGER trg_corpus_input_import_batches_delete AFTER DELETE ON import_batches
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('n.status=''completed''','o.status=''completed''','(ROW(n.workspace_id,n.data_source_id,n.status,n.record_count,n.included_count,n.excluded_count,n.duplicate_count,n.source_file_hash,n.provider_observation_projection_state,n.provider_observation_count) IS DISTINCT FROM ROW(o.workspace_id,o.data_source_id,o.status,o.record_count,o.included_count,o.excluded_count,o.duplicate_count,o.source_file_hash,o.provider_observation_projection_state,o.provider_observation_count)) AND ((n.status=''completed'') OR (o.status=''completed''))');
CREATE TRIGGER trg_corpus_input_mention_import_memberships_insert AFTER INSERT ON signal_mention_import_memberships
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('EXISTS(SELECT 1 FROM import_batches b WHERE b.id=n.import_batch_id AND b.workspace_id=n.workspace_id AND b.status=''completed'')','EXISTS(SELECT 1 FROM import_batches b WHERE b.id=o.import_batch_id AND b.workspace_id=o.workspace_id AND b.status=''completed'')','(ROW(n.workspace_id,n.mention_id,n.import_batch_id,n.data_source_id,n.ingestion_disposition) IS DISTINCT FROM ROW(o.workspace_id,o.mention_id,o.import_batch_id,o.data_source_id,o.ingestion_disposition)) AND ((EXISTS(SELECT 1 FROM import_batches b WHERE b.id=n.import_batch_id AND b.workspace_id=n.workspace_id AND b.status=''completed'')) OR (EXISTS(SELECT 1 FROM import_batches b WHERE b.id=o.import_batch_id AND b.workspace_id=o.workspace_id AND b.status=''completed'')))');
CREATE TRIGGER trg_corpus_input_mention_import_memberships_update AFTER UPDATE ON signal_mention_import_memberships
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('EXISTS(SELECT 1 FROM import_batches b WHERE b.id=n.import_batch_id AND b.workspace_id=n.workspace_id AND b.status=''completed'')','EXISTS(SELECT 1 FROM import_batches b WHERE b.id=o.import_batch_id AND b.workspace_id=o.workspace_id AND b.status=''completed'')','(ROW(n.workspace_id,n.mention_id,n.import_batch_id,n.data_source_id,n.ingestion_disposition) IS DISTINCT FROM ROW(o.workspace_id,o.mention_id,o.import_batch_id,o.data_source_id,o.ingestion_disposition)) AND ((EXISTS(SELECT 1 FROM import_batches b WHERE b.id=n.import_batch_id AND b.workspace_id=n.workspace_id AND b.status=''completed'')) OR (EXISTS(SELECT 1 FROM import_batches b WHERE b.id=o.import_batch_id AND b.workspace_id=o.workspace_id AND b.status=''completed'')))');
CREATE TRIGGER trg_corpus_input_mention_import_memberships_delete AFTER DELETE ON signal_mention_import_memberships
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('EXISTS(SELECT 1 FROM import_batches b WHERE b.id=n.import_batch_id AND b.workspace_id=n.workspace_id AND b.status=''completed'')','EXISTS(SELECT 1 FROM import_batches b WHERE b.id=o.import_batch_id AND b.workspace_id=o.workspace_id AND b.status=''completed'')','(ROW(n.workspace_id,n.mention_id,n.import_batch_id,n.data_source_id,n.ingestion_disposition) IS DISTINCT FROM ROW(o.workspace_id,o.mention_id,o.import_batch_id,o.data_source_id,o.ingestion_disposition)) AND ((EXISTS(SELECT 1 FROM import_batches b WHERE b.id=n.import_batch_id AND b.workspace_id=n.workspace_id AND b.status=''completed'')) OR (EXISTS(SELECT 1 FROM import_batches b WHERE b.id=o.import_batch_id AND b.workspace_id=o.workspace_id AND b.status=''completed'')))');
CREATE TRIGGER trg_corpus_input_data_sources_insert AFTER INSERT ON data_sources
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.source_key) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.source_key)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_data_sources_update AFTER UPDATE ON data_sources
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.source_key) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.source_key)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_data_sources_delete AFTER DELETE ON data_sources
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.source_key) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.source_key)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_provenance_policy_bindings_insert AFTER INSERT ON signal_provenance_policy_bindings
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.data_source_id,n.import_batch_id,n.status,n.effective_from,n.effective_to,n.binding_version,n.retention_policy_id,n.licensing_policy_id) IS DISTINCT FROM ROW(o.workspace_id,o.data_source_id,o.import_batch_id,o.status,o.effective_from,o.effective_to,o.binding_version,o.retention_policy_id,o.licensing_policy_id)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_provenance_policy_bindings_update AFTER UPDATE ON signal_provenance_policy_bindings
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.data_source_id,n.import_batch_id,n.status,n.effective_from,n.effective_to,n.binding_version,n.retention_policy_id,n.licensing_policy_id) IS DISTINCT FROM ROW(o.workspace_id,o.data_source_id,o.import_batch_id,o.status,o.effective_from,o.effective_to,o.binding_version,o.retention_policy_id,o.licensing_policy_id)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_provenance_policy_bindings_delete AFTER DELETE ON signal_provenance_policy_bindings
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.data_source_id,n.import_batch_id,n.status,n.effective_from,n.effective_to,n.binding_version,n.retention_policy_id,n.licensing_policy_id) IS DISTINCT FROM ROW(o.workspace_id,o.data_source_id,o.import_batch_id,o.status,o.effective_from,o.effective_to,o.binding_version,o.retention_policy_id,o.licensing_policy_id)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_retention_policies_insert AFTER INSERT ON signal_retention_policies
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.effective_from,n.effective_to,n.retention_state,n.retention_mode,n.retain_until) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.effective_from,o.effective_to,o.retention_state,o.retention_mode,o.retain_until)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_retention_policies_update AFTER UPDATE ON signal_retention_policies
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.effective_from,n.effective_to,n.retention_state,n.retention_mode,n.retain_until) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.effective_from,o.effective_to,o.retention_state,o.retention_mode,o.retain_until)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_retention_policies_delete AFTER DELETE ON signal_retention_policies
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.effective_from,n.effective_to,n.retention_state,n.retention_mode,n.retain_until) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.effective_from,o.effective_to,o.retention_state,o.retention_mode,o.retain_until)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_licensing_policies_insert AFTER INSERT ON signal_licensing_policies
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.effective_from,n.effective_to) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.effective_from,o.effective_to)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_licensing_policies_update AFTER UPDATE ON signal_licensing_policies
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.effective_from,n.effective_to) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.effective_from,o.effective_to)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_licensing_policies_delete AFTER DELETE ON signal_licensing_policies
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.status,n.effective_from,n.effective_to) IS DISTINCT FROM ROW(o.workspace_id,o.status,o.effective_from,o.effective_to)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_licensing_policy_usages_insert AFTER INSERT ON signal_licensing_policy_usages
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.licensing_policy_id,n.usage_purpose,n.decision) IS DISTINCT FROM ROW(o.workspace_id,o.licensing_policy_id,o.usage_purpose,o.decision)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_licensing_policy_usages_update AFTER UPDATE ON signal_licensing_policy_usages
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.licensing_policy_id,n.usage_purpose,n.decision) IS DISTINCT FROM ROW(o.workspace_id,o.licensing_policy_id,o.usage_purpose,o.decision)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_licensing_policy_usages_delete AFTER DELETE ON signal_licensing_policy_usages
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('true','true','(ROW(n.workspace_id,n.licensing_policy_id,n.usage_purpose,n.decision) IS DISTINCT FROM ROW(o.workspace_id,o.licensing_policy_id,o.usage_purpose,o.decision)) AND ((true) OR (true))');
CREATE TRIGGER trg_corpus_input_mention_attributions_insert AFTER INSERT ON signal_mention_attributions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('n.attribution_basis=''mention_semantic'' AND n.is_current AND n.review_status=''approved'' AND n.eligibility_status=''eligible''','o.attribution_basis=''mention_semantic'' AND o.is_current AND o.review_status=''approved'' AND o.eligibility_status=''eligible''','(ROW(n.workspace_id,n.mention_id,n.data_source_id,n.import_batch_id,n.attribution_basis,n.is_current,n.review_status,n.eligibility_status,n.scope,n.entity_type,n.entity_id,n.model_version,n.policy_version) IS DISTINCT FROM ROW(o.workspace_id,o.mention_id,o.data_source_id,o.import_batch_id,o.attribution_basis,o.is_current,o.review_status,o.eligibility_status,o.scope,o.entity_type,o.entity_id,o.model_version,o.policy_version)) AND ((n.attribution_basis=''mention_semantic'' AND n.is_current AND n.review_status=''approved'' AND n.eligibility_status=''eligible'') OR (o.attribution_basis=''mention_semantic'' AND o.is_current AND o.review_status=''approved'' AND o.eligibility_status=''eligible''))');
CREATE TRIGGER trg_corpus_input_mention_attributions_update AFTER UPDATE ON signal_mention_attributions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('n.attribution_basis=''mention_semantic'' AND n.is_current AND n.review_status=''approved'' AND n.eligibility_status=''eligible''','o.attribution_basis=''mention_semantic'' AND o.is_current AND o.review_status=''approved'' AND o.eligibility_status=''eligible''','(ROW(n.workspace_id,n.mention_id,n.data_source_id,n.import_batch_id,n.attribution_basis,n.is_current,n.review_status,n.eligibility_status,n.scope,n.entity_type,n.entity_id,n.model_version,n.policy_version) IS DISTINCT FROM ROW(o.workspace_id,o.mention_id,o.data_source_id,o.import_batch_id,o.attribution_basis,o.is_current,o.review_status,o.eligibility_status,o.scope,o.entity_type,o.entity_id,o.model_version,o.policy_version)) AND ((n.attribution_basis=''mention_semantic'' AND n.is_current AND n.review_status=''approved'' AND n.eligibility_status=''eligible'') OR (o.attribution_basis=''mention_semantic'' AND o.is_current AND o.review_status=''approved'' AND o.eligibility_status=''eligible''))');
CREATE TRIGGER trg_corpus_input_mention_attributions_delete AFTER DELETE ON signal_mention_attributions
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_signal_corpus_preparation_inputs_v1('n.attribution_basis=''mention_semantic'' AND n.is_current AND n.review_status=''approved'' AND n.eligibility_status=''eligible''','o.attribution_basis=''mention_semantic'' AND o.is_current AND o.review_status=''approved'' AND o.eligibility_status=''eligible''','(ROW(n.workspace_id,n.mention_id,n.data_source_id,n.import_batch_id,n.attribution_basis,n.is_current,n.review_status,n.eligibility_status,n.scope,n.entity_type,n.entity_id,n.model_version,n.policy_version) IS DISTINCT FROM ROW(o.workspace_id,o.mention_id,o.data_source_id,o.import_batch_id,o.attribution_basis,o.is_current,o.review_status,o.eligibility_status,o.scope,o.entity_type,o.entity_id,o.model_version,o.policy_version)) AND ((n.attribution_basis=''mention_semantic'' AND n.is_current AND n.review_status=''approved'' AND n.eligibility_status=''eligible'') OR (o.attribution_basis=''mention_semantic'' AND o.is_current AND o.review_status=''approved'' AND o.eligibility_status=''eligible''))');

-- Private server-side preparation ledger and text; never expose through default Data API grants.
ALTER TABLE signal_corpus_preparation_input_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_corpus_preparation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_corpus_preparation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_corpus_text_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_corpus_preparation_input_state,signal_corpus_preparation_runs,
  signal_corpus_preparation_items,signal_corpus_text_assets FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION invalidate_signal_corpus_preparation_inputs_v1(),
  protect_signal_corpus_preparation_immutable_v1(),initialize_signal_corpus_preparation_workspace_v1() FROM PUBLIC;
DO $$ DECLARE restricted_role text;
BEGIN
  FOREACH restricted_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted_role) THEN
      EXECUTE format('REVOKE ALL ON signal_corpus_preparation_input_state,signal_corpus_preparation_runs,signal_corpus_preparation_items,signal_corpus_text_assets FROM %I',restricted_role);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION invalidate_signal_corpus_preparation_inputs_v1(),protect_signal_corpus_preparation_immutable_v1(),initialize_signal_corpus_preparation_workspace_v1() FROM %I',restricted_role);
    END IF;
  END LOOP;
END; $$;
