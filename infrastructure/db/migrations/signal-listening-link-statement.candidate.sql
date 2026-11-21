-- EXPERIMENT ONLY, unnumbered: the migration runner must not adopt this.
-- Candidate moves only the child-link writer. Both authoritative BEFORE ROW
-- guards and every financial/actor/fresh-input/RAW predicate remain installed.
CREATE FUNCTION signal_listening_link_calls_statement_candidate_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 -- AFTER STATEMENT fires for zero inserted rows; the old AFTER ROW did not.
 -- Do not introduce a new owner-table lookup for that empty transition set.
 IF NOT EXISTS(SELECT 1 FROM listening_link_new_calls) THEN RETURN NULL;END IF;
 -- The old link writer planned/executed child INSERT only for Listening.
 -- An unconditional INSERT...JOIN would require INSERT privilege even when
 -- the join produces zero rows, breaking valid non-Listening callers.
 IF NOT EXISTS(SELECT 1 FROM listening_link_new_calls n WHERE EXISTS(
  SELECT 1 FROM signal_listening_runs owner WHERE owner.run_id=n.run_id AND owner.workspace_id=n.workspace_id))
 THEN RETURN NULL;END IF;
 -- Materialize ownership before lateral JSON/casts: malformed inputs of a
 -- non-Listening sibling must not be expanded by this Listening-only writer.
 WITH listening_calls AS MATERIALIZED(
  SELECT n.workspace_id,n.run_id,n.id,n.inputs FROM listening_link_new_calls n
  WHERE EXISTS(SELECT 1 FROM signal_listening_runs owner
   WHERE owner.run_id=n.run_id AND owner.workspace_id=n.workspace_id))
 INSERT INTO signal_listening_call_questions(workspace_id,run_id,call_id,root_id,question_key,question_digest)
 SELECT n.workspace_id,n.run_id,n.id,(n.inputs->0->>'root_id')::uuid,q.key,q.value
 FROM listening_calls n CROSS JOIN LATERAL jsonb_each_text(n.inputs->0->'question_digests') q;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION signal_listening_link_calls_statement_candidate_v1() FROM PUBLIC;

DROP TRIGGER signal_listening_link_call ON signal_labeling_calls;
-- All existing AFTER ROW triggers still run first. Among AFTER STATEMENT
-- triggers, link before listening_statement_money_insert and the mass total.
CREATE TRIGGER listening_00_link_insert AFTER INSERT ON signal_labeling_calls
 REFERENCING NEW TABLE AS listening_link_new_calls FOR EACH STATEMENT
 EXECUTE FUNCTION signal_listening_link_calls_statement_candidate_v1();
