-- Add semantic unrelated state without rewriting historical snapshots or memberships.
-- Apply once after 0225. Recovery: leave additive view in place; stop new discovery requests.
CREATE OR REPLACE VIEW signal_topic_consolidation_snapshot_roots_v1 WITH(security_invoker=true) AS
 SELECT s.id snapshot_id,s.workspace_id,p.root_id,
  CASE WHEN bool_or(f.relevance='unrelated') THEN 'unrelated'
    WHEN bool_or(d.disposition IN('topic','narrative')) THEN 'resolved'
    WHEN bool_or(d.disposition='unresolved') THEN 'unresolved'
    WHEN bool_or(d.disposition='noise') THEN 'noise' ELSE 'abstained' END resolution_state,
  COALESCE(bool_or(d.disposition='unresolved') FILTER (WHERE f.relevance IS DISTINCT FROM 'unrelated'),false) has_unresolved_topics
 FROM signal_topic_consolidation_snapshots s
 JOIN signal_corpus_preparation_items p ON p.workspace_id=s.workspace_id AND p.run_id=s.preparation_run_id AND p.disposition='eligible'
 LEFT JOIN signal_mention_facets_current_v1 f ON f.workspace_id=p.workspace_id AND f.root_id=p.root_id
 LEFT JOIN signal_topic_atomic_group_roots root ON root.consolidation_run_id=s.consolidation_run_id AND root.canonical_root_id=p.root_id
 LEFT JOIN signal_topic_consolidation_decisions d ON d.revision_id=s.revision_id AND d.atomic_group_id=root.atomic_group_id
 GROUP BY s.id,s.workspace_id,p.root_id;
