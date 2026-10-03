-- Backend 09A: make the compatibility bridge self-consistent without changing
-- its predicate, memberships, definition hash or operational pointer. The
-- digest is derived state and is refreshed at product transaction boundaries.

CREATE OR REPLACE FUNCTION refresh_signal_operational_bridge_membership_digest_v1(
  target_workspace_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE target_population_id uuid;
DECLARE computed_digest text;
BEGIN
  SELECT definition.id INTO target_population_id
  FROM signal_workspace_population_pointers pointer
  JOIN signal_population_definitions definition
    ON definition.id=pointer.population_id
   AND definition.workspace_id=pointer.workspace_id
  WHERE pointer.workspace_id=target_workspace_id
    AND pointer.purpose='operational'
    AND definition.purpose='operational'
    AND definition.status='active'
    AND COALESCE(definition.definition->>'contract_version','')
      <> 'signal-operational-primary-brand-semantic-v2';
  IF target_population_id IS NULL THEN RETURN NULL; END IF;

  SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
    membership.mention_id::text,',' ORDER BY membership.mention_id
  ),''),'UTF8')),'hex') INTO computed_digest
  FROM signal_population_memberships membership
  WHERE membership.population_id=target_population_id
    AND membership.workspace_id=target_workspace_id
    AND membership.membership_status='included'
    AND membership.removed_at IS NULL;

  UPDATE signal_population_definitions
  SET membership_digest=computed_digest,updated_at=clock_timestamp()
  WHERE id=target_population_id
    AND membership_digest IS DISTINCT FROM computed_digest;
  RETURN computed_digest;
END;
$$;

COMMENT ON FUNCTION refresh_signal_operational_bridge_membership_digest_v1(uuid) IS
  'Refreshes only the current compatibility bridge digest from canonical included memberships; never changes memberships, definition identity or pointers.';

CREATE OR REPLACE FUNCTION refresh_signal_operational_bridge_after_import_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM refresh_signal_operational_bridge_membership_digest_v1(NEW.workspace_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_operational_bridge_digest_import ON import_batches;
CREATE TRIGGER trg_signal_operational_bridge_digest_import
  AFTER INSERT OR UPDATE OF status ON import_batches
  FOR EACH ROW EXECUTE FUNCTION refresh_signal_operational_bridge_after_import_v1();

CREATE OR REPLACE FUNCTION refresh_signal_operational_bridge_after_review_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_signal_operational_bridge_membership_digest_v1(NEW.workspace_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_operational_bridge_digest_review
  ON signal_mention_attribution_review_events;
CREATE TRIGGER trg_signal_operational_bridge_digest_review
  AFTER INSERT ON signal_mention_attribution_review_events
  FOR EACH ROW EXECUTE FUNCTION refresh_signal_operational_bridge_after_review_v1();

CREATE OR REPLACE FUNCTION refresh_signal_operational_bridge_after_source_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_signal_operational_bridge_membership_digest_v1(NEW.workspace_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_zz_operational_bridge_digest_source ON data_sources;
CREATE TRIGGER trg_signal_zz_operational_bridge_digest_source
  AFTER UPDATE OF governed_scope,governed_entity_type,governed_entity_id,
    scope_review_status,scope_policy_version
  ON data_sources FOR EACH ROW
  EXECUTE FUNCTION refresh_signal_operational_bridge_after_source_v1();

CREATE OR REPLACE FUNCTION refresh_signal_operational_bridge_after_membership_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE affected_workspace_id uuid;
BEGIN
  affected_workspace_id := COALESCE(NEW.workspace_id,OLD.workspace_id);
  IF EXISTS (
    SELECT 1 FROM signal_workspace_population_pointers pointer
    WHERE pointer.workspace_id=affected_workspace_id
      AND pointer.purpose='operational'
      AND pointer.population_id=COALESCE(NEW.population_id,OLD.population_id)
  ) THEN
    PERFORM refresh_signal_operational_bridge_membership_digest_v1(affected_workspace_id);
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_signal_operational_bridge_digest_membership
  ON signal_population_memberships;
CREATE TRIGGER trg_signal_operational_bridge_digest_membership
  AFTER INSERT OR UPDATE OF membership_status,removed_at OR DELETE
  ON signal_population_memberships FOR EACH ROW
  EXECUTE FUNCTION refresh_signal_operational_bridge_after_membership_v1();

DO $$
DECLARE workspace record;
BEGIN
  FOR workspace IN
    SELECT pointer.workspace_id
    FROM signal_workspace_population_pointers pointer
    WHERE pointer.purpose='operational'
  LOOP
    PERFORM refresh_signal_operational_bridge_membership_digest_v1(workspace.workspace_id);
  END LOOP;
END;
$$;
