-- Backend 05A: auditable governed-binding withdrawal to the operational bridge.
-- Forward-only. This migration never creates a binding, changes a population pointer,
-- or activates a policy bundle by itself.

ALTER TABLE signal_governed_view_binding_events
  ALTER COLUMN next_binding_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS request_digest text;

ALTER TABLE signal_governed_view_binding_events
  DROP CONSTRAINT IF EXISTS signal_governed_view_binding_event_action,
  ADD CONSTRAINT signal_governed_view_binding_event_action CHECK (
    action IN ('promote', 'rollback', 'withdraw-to-bridge')
  ),
  DROP CONSTRAINT IF EXISTS signal_governed_view_binding_event_transition_shape,
  ADD CONSTRAINT signal_governed_view_binding_event_transition_shape CHECK (
    (
      action IN ('promote', 'rollback')
      AND next_binding_id IS NOT NULL
    ) OR (
      action = 'withdraw-to-bridge'
      AND previous_binding_id IS NOT NULL
      AND next_binding_id IS NULL
      AND request_digest ~ '^sha256:[0-9a-f]{64}$'
    )
  ),
  DROP CONSTRAINT IF EXISTS signal_governed_view_binding_event_request_digest,
  ADD CONSTRAINT signal_governed_view_binding_event_request_digest CHECK (
    request_digest IS NULL OR request_digest ~ '^sha256:[0-9a-f]{64}$'
  );

CREATE OR REPLACE FUNCTION signal_governed_view_binding_digest_v1(
  target_binding_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(concat_ws('|',
    binding.workspace_id::text,
    binding.module_key,
    binding.view_key,
    binding.binding_version::text,
    binding.policy_bundle_id::text,
    binding.policy_definition_hash,
    COALESCE(binding.population_id::text, '∅'),
    COALESCE(binding.policy_compilation_id::text, '∅'),
    binding.binding_status,
    binding.effective_from::text,
    COALESCE(binding.effective_to::text, '∅'),
    binding.promoted_by_user_id::text,
    binding.created_at::text
  ), 'UTF8')), 'hex')
  FROM signal_governed_view_bindings binding
  WHERE binding.id = target_binding_id;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_governed_view_binding_event_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE next_binding signal_governed_view_bindings%ROWTYPE;
DECLARE previous_binding signal_governed_view_bindings%ROWTYPE;
DECLARE target_organization_id uuid;
BEGIN
  IF NEW.action = 'withdraw-to-bridge' THEN
    IF NEW.next_binding_id IS NOT NULL OR NEW.previous_binding_id IS NULL THEN
      RAISE EXCEPTION 'Bridge withdrawal must retire one binding without a successor.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.next_binding_id IS NULL THEN
      RAISE EXCEPTION 'Promotion and rollback events require a successor binding.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO next_binding
    FROM signal_governed_view_bindings binding
    WHERE binding.id = NEW.next_binding_id;
    IF next_binding.id IS NULL
       OR next_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR next_binding.module_key IS DISTINCT FROM NEW.module_key
       OR next_binding.view_key IS DISTINCT FROM NEW.view_key THEN
      RAISE EXCEPTION 'Governed binding event target is cross-workspace or incompatible.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT workspace.organization_id INTO target_organization_id
  FROM signal_workspaces workspace WHERE workspace.id = NEW.workspace_id;
  IF NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.actor_user_id
      AND (actor.user_type = 'noisia_internal' OR actor.organization_id = target_organization_id)
  ) THEN
    RAISE EXCEPTION 'Governed binding event actor is not valid for the workspace.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.previous_binding_id IS NOT NULL THEN
    SELECT * INTO previous_binding
    FROM signal_governed_view_bindings binding
    WHERE binding.id = NEW.previous_binding_id;
    IF previous_binding.id IS NULL
       OR previous_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR previous_binding.module_key IS DISTINCT FROM NEW.module_key
       OR previous_binding.view_key IS DISTINCT FROM NEW.view_key THEN
      RAISE EXCEPTION 'Governed binding event history is cross-workspace or incompatible.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION withdraw_signal_governed_view_binding(
  target_workspace_id uuid,
  target_module_key text,
  target_view_key text,
  target_actor_user_id uuid,
  target_expected_binding_id uuid,
  target_expected_binding_digest text,
  target_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE workspace signal_workspaces%ROWTYPE;
DECLARE actor users%ROWTYPE;
DECLARE current_binding signal_governed_view_bindings%ROWTYPE;
DECLARE persisted_event signal_governed_view_binding_events%ROWTYPE;
DECLARE expected_request_digest text;
DECLARE observed_binding_digest text;
DECLARE transition_at timestamptz := clock_timestamp();
BEGIN
  IF NOT signal_governed_view_pair_is_valid(target_module_key, target_view_key)
     OR target_view_key <> 'brand'
     OR target_expected_binding_id IS NULL
     OR target_expected_binding_digest !~ '^sha256:[0-9a-f]{64}$'
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Governed view withdrawal contract is invalid.' USING ERRCODE = '23514';
  END IF;
  expected_request_digest := 'sha256:' || encode(sha256(convert_to(concat_ws('|',
    'signal-governed-view-withdrawal-v1', target_workspace_id::text,
    target_module_key, target_view_key, target_actor_user_id::text,
    target_expected_binding_id::text, target_expected_binding_digest
  ), 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':brand-binding-set', 0
  ));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':' || target_module_key || ':' || target_view_key, 0
  ));
  SELECT * INTO persisted_event
  FROM signal_governed_view_binding_events event
  WHERE event.workspace_id = target_workspace_id
    AND event.idempotency_key = target_idempotency_key;
  IF persisted_event.id IS NOT NULL THEN
    IF persisted_event.action <> 'withdraw-to-bridge'
       OR persisted_event.module_key IS DISTINCT FROM target_module_key
       OR persisted_event.view_key IS DISTINCT FROM target_view_key
       OR persisted_event.actor_user_id IS DISTINCT FROM target_actor_user_id
       OR persisted_event.previous_binding_id IS DISTINCT FROM target_expected_binding_id
       OR persisted_event.next_binding_id IS NOT NULL
       OR persisted_event.request_digest IS DISTINCT FROM expected_request_digest THEN
      RAISE EXCEPTION 'Governed view idempotency key was reused with incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    RETURN persisted_event.previous_binding_id;
  END IF;
  SELECT * INTO workspace FROM signal_workspaces candidate
  WHERE candidate.id = target_workspace_id AND candidate.status = 'active';
  SELECT * INTO actor FROM users candidate WHERE candidate.id = target_actor_user_id;
  IF workspace.id IS NULL OR actor.id IS NULL OR NOT (
    actor.user_type = 'noisia_internal'
    OR actor.organization_id IS NOT DISTINCT FROM workspace.organization_id
  ) THEN
    RAISE EXCEPTION 'Governed view withdrawal actor is not valid for the workspace.'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO current_binding
  FROM signal_governed_view_bindings binding
  WHERE binding.workspace_id = target_workspace_id
    AND binding.module_key = target_module_key
    AND binding.view_key = target_view_key
    AND binding.binding_status = 'current'
  FOR UPDATE;
  observed_binding_digest := signal_governed_view_binding_digest_v1(current_binding.id);
  IF current_binding.id IS NULL
     OR current_binding.id IS DISTINCT FROM target_expected_binding_id
     OR observed_binding_digest IS DISTINCT FROM target_expected_binding_digest THEN
    RAISE EXCEPTION 'Governed view withdrawal compare-and-swap failed.' USING ERRCODE = '40001';
  END IF;
  UPDATE signal_governed_view_bindings
  SET binding_status = 'retired', effective_to = transition_at
  WHERE id = current_binding.id;
  INSERT INTO signal_governed_view_binding_events (
    workspace_id, module_key, view_key, action,
    previous_binding_id, next_binding_id, actor_user_id,
    idempotency_key, request_digest
  ) VALUES (
    target_workspace_id, target_module_key, target_view_key, 'withdraw-to-bridge',
    current_binding.id, NULL, target_actor_user_id,
    target_idempotency_key, expected_request_digest
  );
  RETURN current_binding.id;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_governed_binding_governance_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.binding_status = 'current'
     AND NEW.binding_status = 'retired'
     AND NEW.effective_to IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['binding_status','effective_to']::text[])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['binding_status','effective_to']::text[]) THEN
    RETURN NEW;
  END IF;
  IF NEW.population_id IS NOT NULL AND (
    NEW.policy_compilation_id IS NULL
    OR EXISTS (
      SELECT 1 FROM signal_data_governance_invalidations invalidation
      WHERE invalidation.policy_compilation_id = NEW.policy_compilation_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM signal_population_policy_compilations compilation
      JOIN signal_data_governance_evaluations evaluation
        ON evaluation.id = compilation.governance_evaluation_id
      WHERE compilation.id = NEW.policy_compilation_id
        AND compilation.workspace_id = NEW.workspace_id
        AND compilation.population_id = NEW.population_id
        AND compilation.policy_bundle_id = NEW.policy_bundle_id
        AND compilation.module_key = NEW.module_key
        AND compilation.view_key = NEW.view_key
        AND compilation.compilation_status = 'ready'
        AND compilation.is_current
        AND compilation.governance_data_watermark_id IS NOT NULL
        AND compilation.governance_digest IS NOT NULL
        AND compilation.next_policy_transition_at IS NOT DISTINCT FROM evaluation.next_policy_transition_at
        AND (compilation.next_policy_transition_at IS NULL
          OR compilation.next_policy_transition_at > clock_timestamp())
    )
  ) THEN
    RAISE EXCEPTION 'Governed binding requires current, durable and temporally valid governance proof.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS signal_governed_brand_binding_set_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  action text NOT NULL,
  policy_bundle_id uuid NOT NULL
    REFERENCES signal_population_policy_bundles(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_digest text NOT NULL,
  result_digest text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_governed_brand_binding_set_action
    CHECK (action IN ('promote', 'withdraw-to-bridge')),
  CONSTRAINT signal_governed_brand_binding_set_hashes CHECK (
    request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND result_digest ~ '^sha256:[0-9a-f]{64}$'
    AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT uq_signal_governed_brand_binding_set_idempotency
    UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS signal_governed_brand_binding_set_operation_items (
  operation_id uuid NOT NULL
    REFERENCES signal_governed_brand_binding_set_operations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  view_key text NOT NULL DEFAULT 'brand',
  previous_binding_id uuid REFERENCES signal_governed_view_bindings(id) ON DELETE RESTRICT,
  next_binding_id uuid REFERENCES signal_governed_view_bindings(id) ON DELETE RESTRICT,
  binding_event_id uuid NOT NULL
    REFERENCES signal_governed_view_binding_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, module_key, view_key),
  CONSTRAINT signal_governed_brand_binding_set_item_identity CHECK (
    module_key IN ('brand-monitoring', 'mentions', 'topics-narratives')
    AND view_key = 'brand'
  ),
  CONSTRAINT uq_signal_governed_brand_binding_set_event UNIQUE (binding_event_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_governed_brand_binding_set_history
  ON signal_governed_brand_binding_set_operations (workspace_id, created_at, id);

CREATE OR REPLACE FUNCTION enforce_signal_governed_brand_binding_set_operation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_organization_id uuid;
BEGIN
  SELECT workspace.organization_id INTO target_organization_id
  FROM signal_workspaces workspace WHERE workspace.id = NEW.workspace_id;
  IF target_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.actor_user_id
      AND (actor.user_type = 'noisia_internal' OR actor.organization_id = target_organization_id)
  ) OR NOT EXISTS (
    SELECT 1 FROM signal_population_policy_bundles bundle
    WHERE bundle.id = NEW.policy_bundle_id AND bundle.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Governed brand binding-set operation is cross-workspace or unauthorized.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_brand_binding_set_operation
  ON signal_governed_brand_binding_set_operations;
CREATE TRIGGER trg_signal_governed_brand_binding_set_operation
  BEFORE INSERT ON signal_governed_brand_binding_set_operations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_brand_binding_set_operation();

CREATE OR REPLACE FUNCTION enforce_signal_governed_brand_binding_set_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE operation signal_governed_brand_binding_set_operations%ROWTYPE;
DECLARE event signal_governed_view_binding_events%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM signal_governed_brand_binding_set_operations
  WHERE id = NEW.operation_id;
  SELECT * INTO event FROM signal_governed_view_binding_events
  WHERE id = NEW.binding_event_id;
  IF operation.id IS NULL OR event.id IS NULL
     OR operation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR event.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR event.module_key IS DISTINCT FROM NEW.module_key
     OR event.view_key IS DISTINCT FROM NEW.view_key
     OR event.action IS DISTINCT FROM operation.action
     OR event.previous_binding_id IS DISTINCT FROM NEW.previous_binding_id
     OR event.next_binding_id IS DISTINCT FROM NEW.next_binding_id
     OR (operation.action = 'promote' AND NEW.next_binding_id IS NULL)
     OR (operation.action = 'withdraw-to-bridge'
       AND (NEW.previous_binding_id IS NULL OR NEW.next_binding_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Governed brand binding-set item is incompatible with its operation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_brand_binding_set_item
  ON signal_governed_brand_binding_set_operation_items;
CREATE TRIGGER trg_signal_governed_brand_binding_set_item
  BEFORE INSERT ON signal_governed_brand_binding_set_operation_items
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_brand_binding_set_item();

CREATE OR REPLACE FUNCTION prevent_signal_governed_brand_binding_set_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Governed brand binding-set history is append-only.' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_brand_binding_set_operations_append_only
  ON signal_governed_brand_binding_set_operations;
CREATE TRIGGER trg_signal_governed_brand_binding_set_operations_append_only
  BEFORE UPDATE OR DELETE ON signal_governed_brand_binding_set_operations
  FOR EACH ROW EXECUTE FUNCTION prevent_signal_governed_brand_binding_set_mutation();

DROP TRIGGER IF EXISTS trg_signal_governed_brand_binding_set_items_append_only
  ON signal_governed_brand_binding_set_operation_items;
CREATE TRIGGER trg_signal_governed_brand_binding_set_items_append_only
  BEFORE UPDATE OR DELETE ON signal_governed_brand_binding_set_operation_items
  FOR EACH ROW EXECUTE FUNCTION prevent_signal_governed_brand_binding_set_mutation();

COMMENT ON FUNCTION withdraw_signal_governed_view_binding IS
  'CAS-protected, idempotent withdrawal of one governed binding so the server resolver falls back to the operational brand bridge.';
COMMENT ON TABLE signal_governed_brand_binding_set_operations IS
  'Append-only parent record for an atomic three-module brand binding promotion or withdrawal.';
COMMENT ON TABLE signal_governed_brand_binding_set_operation_items IS
  'Relational per-module results for one atomic governed brand binding-set operation.';
