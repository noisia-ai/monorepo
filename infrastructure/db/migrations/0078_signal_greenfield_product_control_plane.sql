-- Backend 09: durable request identity for product-operated governance commands.
-- This is an operation ledger only; relational policies/bindings remain authority.

CREATE TABLE IF NOT EXISTS signal_governance_control_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES signal_workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  request_digest text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT signal_governance_control_action CHECK (action IN (
    'create-quality-draft','create-retention-draft','create-licensing-draft',
    'activate-policy','create-provenance-binding-draft','activate-provenance-binding',
    'upsert-identity','update-timezone','reconcile-brand-os',
    'create-source','import-source','reconcile-governed-view',
    'reconcile-strategic-authority','promote-strategic-authority'
  )),
  CONSTRAINT signal_governance_control_hashes CHECK (
    request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND idempotency_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT signal_governance_control_status CHECK (status IN ('in_progress','completed')),
  CONSTRAINT signal_governance_control_completion CHECK (
    (status='in_progress' AND result IS NULL AND completed_at IS NULL)
    OR (status='completed' AND result IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT uq_signal_governance_control_operation UNIQUE (workspace_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_governance_control_operations_workspace
  ON signal_governance_control_operations (workspace_id,created_at DESC);

CREATE OR REPLACE FUNCTION protect_signal_governance_control_operation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Governance control operation history is append-only' USING ERRCODE='55000';
  END IF;
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR OLD.action IS DISTINCT FROM NEW.action
     OR OLD.request_digest IS DISTINCT FROM NEW.request_digest
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.status<>'in_progress' OR NEW.status<>'completed'
     OR OLD.result IS NOT NULL OR NEW.result IS NULL
     OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Governance control operation mutation is forbidden' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_signal_governance_control_operation
  ON signal_governance_control_operations;
CREATE TRIGGER trg_protect_signal_governance_control_operation
  BEFORE UPDATE OR DELETE ON signal_governance_control_operations
  FOR EACH ROW EXECUTE FUNCTION protect_signal_governance_control_operation_v1();

COMMENT ON TABLE signal_governance_control_operations IS
  'Append-only completion ledger for authenticated Admin governance commands. It stores no legal decision text and is not policy authority.';

ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS product_idempotency_key text,
  ADD COLUMN IF NOT EXISTS product_request_digest text;

ALTER TABLE import_batches
  DROP CONSTRAINT IF EXISTS import_batches_product_operation_shape;
ALTER TABLE import_batches
  ADD CONSTRAINT import_batches_product_operation_shape CHECK (
    (product_idempotency_key IS NULL AND product_request_digest IS NULL)
    OR (product_idempotency_key ~ '^sha256:[0-9a-f]{64}$'
      AND product_request_digest ~ '^sha256:[0-9a-f]{64}$')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_product_idempotency
  ON import_batches (workspace_id,product_idempotency_key)
  WHERE product_idempotency_key IS NOT NULL;
