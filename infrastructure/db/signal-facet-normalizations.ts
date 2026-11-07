/** Stored parser abstention for the exact current label, excluding human replacement.
 * The expression emits a closed list, never provider text or arbitrary JSON. */
export function facetForcedAbstentionsSqlV1(alias: string): string {
  if (!/^[a-z_]+$/u.test(alias)) throw new Error("facet_sql_alias_invalid");
  return `CASE WHEN ${alias}.facets#>>'{asunto,abstained}'='true' AND NOT EXISTS(
    SELECT 1 FROM signal_mention_facet_overrides o WHERE o.workspace_id=${alias}.workspace_id
      AND o.root_id=${alias}.root_id AND o.dimension='asunto' AND o.superseded_at IS NULL)
    AND EXISTS(SELECT 1 FROM signal_mention_facet_labels label
      JOIN signal_labeling_calls call ON call.id=label.call_id AND call.workspace_id=label.workspace_id
      CROSS JOIN LATERAL jsonb_array_elements(call.results) result
      WHERE label.workspace_id=${alias}.workspace_id AND label.root_id=${alias}.root_id
        AND label.input_digest=${alias}.input_digest AND label.labeler_digest=${alias}.labeler_digest
        AND label.entity_context_digest=${alias}.entity_context_digest
        AND result->>'root_id'=${alias}.root_id::text AND result->>'input_digest'=${alias}.input_digest
        AND result->>'entity_context_digest'=${alias}.entity_context_digest AND call.results_applied
        AND result->'normalizations' @> '[{"dimension":"asunto","reason":"exceeds_word_limit","action":"abstained","max_words":12}]'::jsonb)
    THEN '["asunto"]'::jsonb ELSE '[]'::jsonb END`;
}
