-- Keep the shared numeric-content trigger polymorphic. PostgreSQL records do
-- not expose columns from a sibling trigger table, even behind a boolean AND.

CREATE OR REPLACE FUNCTION signal_topic_consolidation_numeric_content_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE target_run uuid; required_status text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.consolidation_run_id IS DISTINCT FROM NEW.consolidation_run_id THEN
    RAISE EXCEPTION 'signal_topic_consolidation_numeric_content_frozen' USING ERRCODE='23514';
  END IF;
  target_run:=CASE WHEN TG_OP='DELETE' THEN OLD.consolidation_run_id ELSE NEW.consolidation_run_id END;
  required_status:=CASE WHEN TG_TABLE_NAME IN('signal_topic_consolidation_communities','signal_topic_consolidation_community_members')
    THEN 'census_ready' ELSE 'building' END;
  IF NOT EXISTS(SELECT 1 FROM signal_topic_consolidation_runs WHERE id=target_run AND status=required_status) THEN
    RAISE EXCEPTION 'signal_topic_consolidation_numeric_content_frozen' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='signal_topic_atomic_groups' THEN
    IF NEW.centroid_artifact_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM signal_topic_consolidation_runs run WHERE run.id=target_run AND (
        NEW.centroid_artifact_id=run.centroid_artifact_id AND NEW.centroid_digest IS NOT NULL)) THEN
      RAISE EXCEPTION 'signal_topic_consolidation_centroid_lineage_invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION signal_topic_consolidation_numeric_content_guard_v1() FROM PUBLIC;
DO $$DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION signal_topic_consolidation_numeric_content_guard_v1() FROM %I',role_name);
    END IF;
  END LOOP;
END$$;

