-- Backend 05B: close relational integrity gaps in the atomic brand binding set.
-- Forward-only. This migration creates no policy, population, binding, membership,
-- pointer, event or operation row.

-- Refuse to install the stronger contract over fabricated or incomplete history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM signal_governed_brand_binding_set_operations operation
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS item_count,
        array_agg(item.module_key ORDER BY item.module_key) AS modules
      FROM signal_governed_brand_binding_set_operation_items item
      WHERE item.operation_id = operation.id
    ) item_set ON true
    WHERE item_set.item_count <> 3
       OR item_set.modules IS DISTINCT FROM
          ARRAY['brand-monitoring','mentions','topics-narratives']::text[]
  ) OR EXISTS (
    SELECT 1
    FROM signal_governed_brand_binding_set_operation_items item
    JOIN signal_governed_brand_binding_set_operations operation
      ON operation.id = item.operation_id
    JOIN signal_governed_view_binding_events event
      ON event.id = item.binding_event_id
    LEFT JOIN signal_governed_view_bindings previous_binding
      ON previous_binding.id = item.previous_binding_id
    LEFT JOIN signal_governed_view_bindings next_binding
      ON next_binding.id = item.next_binding_id
    WHERE operation.workspace_id IS DISTINCT FROM item.workspace_id
       OR event.workspace_id IS DISTINCT FROM item.workspace_id
       OR event.module_key IS DISTINCT FROM item.module_key
       OR event.view_key IS DISTINCT FROM item.view_key
       OR event.action IS DISTINCT FROM operation.action
       OR event.actor_user_id IS DISTINCT FROM operation.actor_user_id
       OR event.previous_binding_id IS DISTINCT FROM item.previous_binding_id
       OR event.next_binding_id IS DISTINCT FROM item.next_binding_id
       OR (item.previous_binding_id IS NOT NULL AND (
         previous_binding.id IS NULL
         OR previous_binding.workspace_id IS DISTINCT FROM item.workspace_id
         OR previous_binding.module_key IS DISTINCT FROM item.module_key
         OR previous_binding.view_key IS DISTINCT FROM item.view_key
       ))
       OR (item.next_binding_id IS NOT NULL AND (
         next_binding.id IS NULL
         OR next_binding.workspace_id IS DISTINCT FROM item.workspace_id
         OR next_binding.module_key IS DISTINCT FROM item.module_key
         OR next_binding.view_key IS DISTINCT FROM item.view_key
       ))
       OR (operation.action = 'promote' AND (
         item.next_binding_id IS NULL
         OR next_binding.policy_bundle_id IS DISTINCT FROM operation.policy_bundle_id
       ))
       OR (operation.action = 'withdraw-to-bridge' AND (
         item.previous_binding_id IS NULL
         OR item.next_binding_id IS NOT NULL
         OR previous_binding.policy_bundle_id IS DISTINCT FROM operation.policy_bundle_id
       ))
  ) THEN
    RAISE EXCEPTION
      'Existing governed brand binding-set history violates the 0072 integrity contract.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_governed_brand_binding_set_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE operation signal_governed_brand_binding_set_operations%ROWTYPE;
DECLARE event signal_governed_view_binding_events%ROWTYPE;
DECLARE previous_binding signal_governed_view_bindings%ROWTYPE;
DECLARE next_binding signal_governed_view_bindings%ROWTYPE;
BEGIN
  SELECT * INTO operation
  FROM signal_governed_brand_binding_set_operations candidate
  WHERE candidate.id = NEW.operation_id;

  SELECT * INTO event
  FROM signal_governed_view_binding_events candidate
  WHERE candidate.id = NEW.binding_event_id;

  IF NEW.previous_binding_id IS NOT NULL THEN
    SELECT * INTO previous_binding
    FROM signal_governed_view_bindings candidate
    WHERE candidate.id = NEW.previous_binding_id;
  END IF;

  IF NEW.next_binding_id IS NOT NULL THEN
    SELECT * INTO next_binding
    FROM signal_governed_view_bindings candidate
    WHERE candidate.id = NEW.next_binding_id;
  END IF;

  IF operation.id IS NULL OR event.id IS NULL
     OR operation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR event.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR event.module_key IS DISTINCT FROM NEW.module_key
     OR event.view_key IS DISTINCT FROM NEW.view_key
     OR event.action IS DISTINCT FROM operation.action
     OR event.actor_user_id IS DISTINCT FROM operation.actor_user_id
     OR event.previous_binding_id IS DISTINCT FROM NEW.previous_binding_id
     OR event.next_binding_id IS DISTINCT FROM NEW.next_binding_id
     OR (NEW.previous_binding_id IS NOT NULL AND (
       previous_binding.id IS NULL
       OR previous_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR previous_binding.module_key IS DISTINCT FROM NEW.module_key
       OR previous_binding.view_key IS DISTINCT FROM NEW.view_key
     ))
     OR (NEW.next_binding_id IS NOT NULL AND (
       next_binding.id IS NULL
       OR next_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR next_binding.module_key IS DISTINCT FROM NEW.module_key
       OR next_binding.view_key IS DISTINCT FROM NEW.view_key
     ))
     OR (operation.action = 'promote' AND (
       NEW.next_binding_id IS NULL
       OR next_binding.policy_bundle_id IS DISTINCT FROM operation.policy_bundle_id
     ))
     OR (operation.action = 'withdraw-to-bridge' AND (
       NEW.previous_binding_id IS NULL
       OR NEW.next_binding_id IS NOT NULL
       OR previous_binding.policy_bundle_id IS DISTINCT FROM operation.policy_bundle_id
     )) THEN
    RAISE EXCEPTION
      'Governed brand binding-set item is incompatible with its operation authority.'
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

CREATE OR REPLACE FUNCTION enforce_signal_governed_brand_binding_set_cardinality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE observed_count integer;
DECLARE observed_modules text[];
BEGIN
  SELECT count(*)::int, array_agg(item.module_key ORDER BY item.module_key)
  INTO observed_count, observed_modules
  FROM signal_governed_brand_binding_set_operation_items item
  WHERE item.operation_id = NEW.id;

  IF observed_count <> 3
     OR observed_modules IS DISTINCT FROM
        ARRAY['brand-monitoring','mentions','topics-narratives']::text[] THEN
    RAISE EXCEPTION
      'Governed brand binding-set operation requires exactly the three canonical brand modules.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_brand_binding_set_cardinality
  ON signal_governed_brand_binding_set_operations;
CREATE CONSTRAINT TRIGGER trg_signal_governed_brand_binding_set_cardinality
  AFTER INSERT ON signal_governed_brand_binding_set_operations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_brand_binding_set_cardinality();

-- Reassert the append-only contract in the migration that closes the relational
-- binding-set proof. These triggers already originate in 0068/0071; recreating them
-- here makes 0072 fail closed even on an environment whose historical objects drifted.
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

DROP TRIGGER IF EXISTS trg_signal_governed_view_binding_events_append_only
  ON signal_governed_view_binding_events;
CREATE TRIGGER trg_signal_governed_view_binding_events_append_only
  BEFORE UPDATE OR DELETE ON signal_governed_view_binding_events
  FOR EACH ROW EXECUTE FUNCTION prevent_signal_governed_view_binding_event_mutation();

CREATE OR REPLACE FUNCTION protect_signal_governed_brand_referenced_binding_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE is_referenced boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM signal_governed_brand_binding_set_operation_items item
    WHERE item.previous_binding_id = OLD.id OR item.next_binding_id = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM signal_governed_view_binding_events event
    WHERE event.previous_binding_id = OLD.id OR event.next_binding_id = OLD.id
  ) INTO is_referenced;

  IF NOT is_referenced THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Promotion and bridge withdrawal legitimately retire the prior current row.
  -- Its identity and proof remain immutable; only lifecycle status and the closing
  -- timestamp may change in that one direction.
  IF TG_OP = 'UPDATE'
     AND OLD.binding_status = 'current'
     AND OLD.effective_to IS NULL
     AND NEW.binding_status = 'retired'
     AND NEW.effective_to IS NOT NULL
     AND NEW.effective_to >= NEW.effective_from
     AND (to_jsonb(NEW) - ARRAY['binding_status','effective_to']::text[])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['binding_status','effective_to']::text[]) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'A governed binding referenced by append-only history is immutable except for its current-to-retired lifecycle transition.'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_brand_referenced_binding_history
  ON signal_governed_view_bindings;
CREATE TRIGGER trg_signal_governed_brand_referenced_binding_history
  BEFORE UPDATE OR DELETE ON signal_governed_view_bindings
  FOR EACH ROW EXECUTE FUNCTION protect_signal_governed_brand_referenced_binding_history();

COMMENT ON FUNCTION enforce_signal_governed_brand_binding_set_item() IS
  'Requires operation, event, actor, module/view identity and action-specific policy bundle authority to agree exactly.';
COMMENT ON FUNCTION enforce_signal_governed_brand_binding_set_cardinality() IS
  'Deferred commit-time guard requiring one item for each canonical brand module in every binding-set operation.';
COMMENT ON FUNCTION protect_signal_governed_brand_referenced_binding_history() IS
  'Protects binding-set evidence from mutation while preserving the exact current-to-retired transition used by promote and withdraw.';
