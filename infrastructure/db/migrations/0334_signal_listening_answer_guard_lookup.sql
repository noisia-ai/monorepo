-- One statement reads the four unique receipt composites from one fresh snapshot.
-- The run remains independent of a missing/mismatched call. LEFT joins preserve
-- the original all-NULL variables; the complete receipt/actor/shape guard below
-- is unchanged. This does not cache authority or change the BEFORE ROW trigger.
CREATE OR REPLACE FUNCTION signal_listening_answer_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE call signal_labeling_calls;r signal_labeling_runs;owner signal_listening_runs;q signal_listening_questions;result jsonb;looked_up record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'listening_history_immutable'; END IF;
 SELECT answer_call AS selected_call,answer_run AS selected_run,
  answer_owner AS selected_owner,answer_question AS selected_question INTO looked_up
 FROM (VALUES(true)) AS seed(present)
 LEFT JOIN signal_labeling_calls answer_call ON answer_call.id=NEW.call_id
  AND answer_call.workspace_id=NEW.workspace_id AND answer_call.run_id=NEW.run_id
 LEFT JOIN signal_labeling_runs answer_run ON answer_run.id=NEW.run_id
 LEFT JOIN signal_listening_runs answer_owner ON answer_owner.run_id=answer_run.id AND answer_owner.workspace_id=NEW.workspace_id
 LEFT JOIN signal_listening_questions answer_question ON answer_question.configuration_id=answer_owner.configuration_id
  AND answer_question.question_key=NEW.question_key;
 call:=looked_up.selected_call;r:=looked_up.selected_run;
 owner:=looked_up.selected_owner;q:=looked_up.selected_question;
 result:=call.results->0;
 IF call.id IS NULL OR call.status<>'settled' OR call.settled_micro_usd IS NULL OR call.usage IS NULL
  OR call.raw_sha256 IS NULL OR call.raw_storage_verified_at IS NULL OR call.raw_storage_verified_key IS DISTINCT FROM call.raw_storage_key
  OR NOT call.results_applied OR jsonb_array_length(call.results)<>1 OR result->>'status' NOT IN('labeled','abstained')
  OR NEW.entity_context_digest IS DISTINCT FROM r.entity_context_digest OR NEW.root_id::text IS DISTINCT FROM result->>'root_id'
  OR NEW.input_digest IS DISTINCT FROM result->>'input_digest' OR NEW.entity_context_digest IS DISTINCT FROM result->>'entity_context_digest'
  OR NEW.question_digest IS DISTINCT FROM q.question_digest OR NEW.question_digest IS DISTINCT FROM result->'question_digests'->>NEW.question_key
  OR NEW.answer IS DISTINCT FROM result->'answers'->NEW.question_key OR NEW.request_digest IS DISTINCT FROM call.request_digest
  OR NEW.raw_sha256 IS DISTINCT FROM call.raw_sha256 OR NOT signal_listening_root_right_v1(NEW.workspace_id,NEW.root_id,'llm-processing')
  OR NEW.answer->>'type' IS DISTINCT FROM q.definition->>'type'
 THEN RAISE EXCEPTION 'listening_answer_receipt_invalid'; END IF;
 PERFORM signal_processing_lock_actor_v1(r.workspace_id,r.actor_user_id);
 IF NEW.answer->>'type'='noul' THEN
  IF NOT COALESCE((NEW.answer->>'noul')::double precision BETWEEN 0 AND 1,false) OR (SELECT count(*) FROM jsonb_object_keys(NEW.answer))<>2
   THEN RAISE EXCEPTION 'listening_answer_invalid'; END IF;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.answer))<>4
   OR NOT COALESCE((NEW.answer->>'confidence')::double precision BETWEEN 0 AND 1,false)
   OR NOT q.wire->'criteria' ? (NEW.answer->>'choice')
   OR (SELECT count(*) FROM jsonb_each(NEW.answer->'probabilities'))<>(SELECT count(*) FROM jsonb_each(q.wire->'criteria'))
   OR EXISTS(SELECT 1 FROM jsonb_each(NEW.answer->'probabilities') p WHERE NOT q.wire->'criteria' ? p.key
      OR NOT COALESCE((p.value#>>'{}')::double precision BETWEEN 0 AND 1,false)) THEN RAISE EXCEPTION 'listening_answer_invalid'; END IF;
 END IF;
 RETURN NEW;
END $$;
