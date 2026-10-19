-- Global stage results include immutable numeric affinity evidence from BERTopic.
-- The older editorial digest intentionally rejects non-integer JSON numbers.
-- Hash PostgreSQL's canonical jsonb representation for this receipt only;
-- do not relax the older digest or alter historical paid requests.
CREATE FUNCTION signal_topic_editorial_global_validation_digest_v2(value jsonb) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path=public,extensions,pg_temp AS $$
 SELECT signal_semantic_context_digest_v1(value::text)
$$;
REVOKE ALL ON FUNCTION signal_topic_editorial_global_validation_digest_v2(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION signal_topic_editorial_global_stage_batch_item_guard_v2() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,extensions,pg_temp AS $$
DECLARE req signal_topic_editorial_global_stage_requests_v2%ROWTYPE;
 call_row signal_topic_editorial_global_stage_calls_v2%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['outcome','raw_text','raw_sha256','validation','validation_sha256','received_at'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['outcome','raw_text','raw_sha256','validation','validation_sha256','received_at'])
   OR OLD.raw_text IS NOT NULL AND ROW(NEW.raw_text,NEW.raw_sha256) IS DISTINCT FROM ROW(OLD.raw_text,OLD.raw_sha256)
   OR OLD.validation IS NOT NULL AND ROW(NEW.validation,NEW.validation_sha256) IS DISTINCT FROM ROW(OLD.validation,OLD.validation_sha256)
   OR NEW.raw_text IS NOT NULL AND (NEW.raw_sha256 IS DISTINCT FROM signal_semantic_context_digest_v1(NEW.raw_text)
     OR NEW.outcome IS NULL OR NEW.received_at IS NULL)
   OR NEW.validation IS NOT NULL AND (NEW.validation_sha256 IS DISTINCT FROM signal_topic_editorial_global_validation_digest_v2(NEW.validation)
     OR NEW.raw_text IS NULL) THEN
   RAISE EXCEPTION 'topic_editorial_global_stage_batch_item_immutable' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'topic_editorial_global_stage_batch_item_immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO req FROM signal_topic_editorial_global_stage_requests_v2 WHERE id=NEW.request_id AND stage_id=NEW.stage_id;
 SELECT * INTO call_row FROM signal_topic_editorial_global_stage_calls_v2 WHERE id=NEW.call_id AND request_id=NEW.request_id AND stage_id=NEW.stage_id;
 IF req.id IS NULL OR call_row.id IS NULL OR req.custom_id<>NEW.custom_id OR
   (req.call_identity<>NEW.call_identity AND call_row.retry_of_call_id IS NULL) THEN
  RAISE EXCEPTION 'topic_editorial_global_stage_batch_item_binding_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
