/** Materialize each governed view once before joining the frozen H1 evaluation population. */
export const hybridH1PopulationSqlV1 = `WITH current_facets AS MATERIALIZED (
  SELECT workspace_id,root_id,input_digest,full_text,requires_context_review
  FROM signal_mention_facets_current_v1 WHERE workspace_id=$1
), authorized_roots AS MATERIALIZED (
  SELECT root_id FROM signal_membership_evidence_rights_v1
  WHERE workspace_id=$1 AND metrics AND evidence
), jev_labels AS MATERIALIZED (
  SELECT DISTINCT ON(label.root_id) label.root_id,label.input_digest,label.facets,label.relevance,label.status,
    label.entity_context_digest
  FROM signal_mention_facet_labels label JOIN signal_labeler_versions version
    ON version.labeler_digest=label.labeler_digest
  WHERE label.workspace_id=$1 AND version.id=$2
  ORDER BY label.root_id,label.created_at DESC
)
SELECT f.root_id,f.input_digest,f.full_text text,f.requires_context_review,
  jev.facets,jev.relevance,jev.status,jev.entity_context_digest
FROM current_facets f JOIN jev_labels jev ON jev.root_id=f.root_id AND jev.input_digest=f.input_digest
JOIN authorized_roots rights ON rights.root_id=f.root_id
ORDER BY f.root_id`;
