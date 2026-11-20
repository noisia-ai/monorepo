-- Narrow the same fresh receipt lookup to the seventeen fields the guard reads.
-- Keep the seed and all four LEFT joins, including the run independent of call.
-- Four NULL CASE slots retain the original whole-row column permission masks.
-- Every BEFORE ROW check, right lookup and actor lock retains its original order.
-- No authority is cached; structural width does not prove a performance gain.
CREATE OR REPLACE FUNCTION signal_listening_answer_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE result jsonb;looked_up record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 SELECT answer_call.id call_id,answer_call.status call_status,
  answer_call.settled_micro_usd call_settled_micro_usd,answer_call.usage call_usage,
  answer_call.raw_sha256 call_raw_sha256,answer_call.raw_storage_verified_at call_raw_storage_verified_at,
  answer_call.raw_storage_verified_key call_raw_storage_verified_key,answer_call.raw_storage_key call_raw_storage_key,
  answer_call.results_applied call_results_applied,answer_call.results call_results,answer_call.request_digest call_request_digest,
  answer_run.entity_context_digest run_entity_context_digest,answer_run.workspace_id run_workspace_id,answer_run.actor_user_id run_actor_user_id,
  answer_question.question_digest question_digest,answer_question.definition->>'type' question_type,
  answer_question.wire->'criteria' question_criteria,
  CASE WHEN false THEN answer_call END permission_call,
  CASE WHEN false THEN answer_run END permission_run,
  CASE WHEN false THEN answer_owner END permission_owner,
  CASE WHEN false THEN answer_question END permission_question INTO looked_up
 FROM (VALUES(true)) AS seed(present)
 LEFT JOIN signal_labeling_calls answer_call ON answer_call.id=NEW.call_id
  AND answer_call.workspace_id=NEW.workspace_id AND answer_call.run_id=NEW.run_id
 LEFT JOIN signal_labeling_runs answer_run ON answer_run.id=NEW.run_id
 LEFT JOIN signal_listening_runs answer_owner ON answer_owner.run_id=answer_run.id AND answer_owner.workspace_id=NEW.workspace_id
 LEFT JOIN signal_listening_questions answer_question ON answer_question.configuration_id=answer_owner.configuration_id
  AND answer_question.question_key=NEW.question_key;
 result:=looked_up.call_results->0;
 IF looked_up.call_id IS NULL OR looked_up.call_status<>'settled' OR looked_up.call_settled_micro_usd IS NULL OR looked_up.call_usage IS NULL
  OR looked_up.call_raw_sha256 IS NULL OR looked_up.call_raw_storage_verified_at IS NULL OR looked_up.call_raw_storage_verified_key IS DISTINCT FROM looked_up.call_raw_storage_key
  OR NOT looked_up.call_results_applied OR jsonb_array_length(looked_up.call_results)<>1 OR result->>'status' NOT IN('labeled','abstained')
  OR NEW.entity_context_digest IS DISTINCT FROM looked_up.run_entity_context_digest OR NEW.root_id::text IS DISTINCT FROM result->>'root_id'
  OR NEW.input_digest IS DISTINCT FROM result->>'input_digest' OR NEW.entity_context_digest IS DISTINCT FROM result->>'entity_context_digest'
  OR NEW.question_digest IS DISTINCT FROM looked_up.question_digest OR NEW.question_digest IS DISTINCT FROM result->'question_digests'->>NEW.question_key
  OR NEW.answer IS DISTINCT FROM result->'answers'->NEW.question_key OR NEW.request_digest IS DISTINCT FROM looked_up.call_request_digest
  OR NEW.raw_sha256 IS DISTINCT FROM looked_up.call_raw_sha256 OR NOT signal_listening_root_right_v1(NEW.workspace_id,NEW.root_id,'llm-processing')
  OR NEW.answer->>'type' IS DISTINCT FROM looked_up.question_type
 THEN RAISE EXCEPTION 'listening_answer_receipt_invalid'; END IF;
 PERFORM signal_processing_lock_actor_v1(looked_up.run_workspace_id,looked_up.run_actor_user_id);
 IF NEW.answer->>'type'='noul' THEN
  IF NOT COALESCE((NEW.answer->>'noul')::double precision BETWEEN 0 AND 1,false) OR (SELECT count(*) FROM jsonb_object_keys(NEW.answer))<>2
   THEN RAISE EXCEPTION 'listening_answer_invalid'; END IF;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.answer))<>4
   OR NOT COALESCE((NEW.answer->>'confidence')::double precision BETWEEN 0 AND 1,false)
   OR NOT looked_up.question_criteria ? (NEW.answer->>'choice')
   OR (SELECT count(*) FROM jsonb_each(NEW.answer->'probabilities'))<>(SELECT count(*) FROM jsonb_each(looked_up.question_criteria))
   OR EXISTS(SELECT 1 FROM jsonb_each(NEW.answer->'probabilities') p WHERE NOT looked_up.question_criteria ? p.key
      OR NOT COALESCE((p.value#>>'{}')::double precision BETWEEN 0 AND 1,false)) THEN RAISE EXCEPTION 'listening_answer_invalid'; END IF;
 END IF;
 RETURN NEW;
END $$;
