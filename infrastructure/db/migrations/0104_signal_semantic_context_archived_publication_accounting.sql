-- 0104_signal_semantic_context_archived_publication_accounting.sql
-- Counts terminal archived leaves in the publication graph equation without publishing them.

ALTER FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb)
  RENAME TO signal_semantic_context_publication_snapshot_pre_0104;

CREATE FUNCTION signal_semantic_context_publication_snapshot_v2(
  p_generation_id uuid,
  current_authority jsonb
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE base jsonb;counts jsonb;preflight jsonb;blockers text[];
DECLARE total_leaves integer;pending_count integer;approved_count integer;
DECLARE rejected_count integer;merged_count integer;archived_count integer;
DECLARE fork_count integer;cycle_count integer;
BEGIN
  base:=signal_semantic_context_publication_snapshot_pre_0104(p_generation_id,current_authority);

  WITH leaves AS (
    SELECT element.* FROM signal_semantic_context_element_versions element
    WHERE element.generation_id=p_generation_id AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
  ) SELECT count(*)::int,
      count(*) FILTER(WHERE disposition='pending')::int,
      count(*) FILTER(WHERE disposition='approved')::int,
      count(*) FILTER(WHERE disposition='rejected')::int,
      count(*) FILTER(WHERE disposition='merged')::int,
      count(*) FILTER(WHERE disposition='archived' AND lifecycle_state='archived')::int
    INTO total_leaves,pending_count,approved_count,rejected_count,merged_count,archived_count
    FROM leaves;

  SELECT count(*)::int INTO fork_count FROM (
    SELECT supersedes_element_id FROM signal_semantic_context_element_versions
    WHERE generation_id=p_generation_id AND supersedes_element_id IS NOT NULL
    GROUP BY supersedes_element_id HAVING count(*)<>1
  ) forks;

  WITH RECURSIVE merge_paths(source_key,target_key) AS (
    SELECT edge.source_element_key,edge.target_element_key
    FROM signal_semantic_context_merge_edges edge WHERE edge.generation_id=p_generation_id
    UNION
    SELECT path.source_key,edge.target_element_key
    FROM merge_paths path JOIN signal_semantic_context_merge_edges edge
      ON edge.generation_id=p_generation_id AND edge.source_element_key=path.target_key
  ) SELECT count(*)::int INTO cycle_count FROM merge_paths WHERE source_key=target_key;

  counts:=(base->'counts')||jsonb_build_object(
    'total_leaves',total_leaves,'pending',pending_count,'approved',approved_count,
    'rejected',rejected_count,'merged',merged_count,'archived',archived_count);
  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::text[]) INTO blockers
    FROM jsonb_array_elements_text(base->'blockers') item(value)
    WHERE value<>'graph_count_inconsistent';
  IF fork_count>0 OR cycle_count>0 OR
      total_leaves<>pending_count+approved_count+rejected_count+merged_count+archived_count THEN
    blockers:=array_append(blockers,'graph_count_inconsistent');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) INTO blockers
    FROM unnest(blockers) item(value);
  preflight:=(base->'preflight')||jsonb_build_object(
    'counts',counts,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,
    'archived_publication_accounting_contract_version',
      'signal-semantic-context-archived-publication-accounting-v1');
  RETURN base||jsonb_build_object(
    'counts',counts,'blockers',to_jsonb(blockers),'publishable',cardinality(blockers)=0,
    'preflight',preflight,
    'publish_preflight_digest',signal_semantic_context_digest_json_v2(preflight));
END; $$;

COMMENT ON FUNCTION signal_semantic_context_publication_snapshot_v2(uuid,jsonb) IS
  'Counts archived terminal leaves in graph accounting while excluding them from candidate publication; forks and cycles remain fail-closed.';
