-- A window is new governed coverage, not a repeated attempt at the same text window.
-- Preserve the strict three-attempt bound independently for each window/stage/provenance.
CREATE OR REPLACE FUNCTION signal_hybrid_pair_attempts_v1(target_workspace uuid,target_route text,target_stage text,
 target_root text,target_fingerprint text,target_concept text,target_definition text,target_context text,target_entities text)
 RETURNS integer LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT COALESCE(max(attempts),0)::int FROM (
 SELECT count(DISTINCT call.id)::int attempts FROM signal_labeling_calls call
 JOIN signal_labeling_runs run ON run.id=call.run_id
 CROSS JOIN LATERAL jsonb_array_elements(call.inputs) input
 CROSS JOIN LATERAL jsonb_array_elements(input->'evaluated_concepts') concept
 WHERE call.workspace_id=target_workspace AND run.membership_snapshot->>'route_digest'=target_route
 AND run.membership_snapshot->>'hybrid_stage'=target_stage
 AND input->>'root_id'=target_root AND input->>'root_fingerprint'=target_fingerprint
 AND concept->>'concept_key'=target_concept AND concept->>'definition_digest'=target_definition
 AND input->>'entity_context_digest'=target_context AND input->>'effective_entities_digest'=target_entities
 AND call.results_applied AND (call.status='settled' OR jsonb_array_length(call.results)>0)
 GROUP BY COALESCE(input#>>'{citation_window,index}','whole_root')
 ) window_attempts
 $$;
REVOKE ALL ON FUNCTION signal_hybrid_pair_attempts_v1(uuid,text,text,text,text,text,text,text,text) FROM PUBLIC;
