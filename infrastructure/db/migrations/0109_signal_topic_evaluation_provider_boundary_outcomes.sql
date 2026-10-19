-- 0109: distinguish a proven pre-send provider failure without weakening one-call safety.

CREATE OR REPLACE FUNCTION protect_signal_topic_evaluation_run_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Topic evaluation runs cannot be deleted.' USING ERRCODE='55000'; END IF;
  IF ROW(NEW.id,NEW.workspace_id,NEW.requested_by_user_id,NEW.idempotency_key,NEW.run_key,
    NEW.input_contract_version,NEW.output_contract_version,NEW.corpus_identity,
    NEW.discovery_run_digest,NEW.source_manifest_digest,NEW.rights_digest,NEW.modeling_count,
    NEW.packet_digest,NEW.packet_proposal_count,NEW.packet_evidence_count,
    NEW.semantic_context_generation_id,NEW.semantic_context_generation_key,
    NEW.semantic_context_authority_digest,NEW.brand_os_digest,NEW.knowledge_digest,
    NEW.locale_context_digest,NEW.candidate_pack_digest,NEW.approved_context_count,
    NEW.envelope_digest,NEW.request_digest,NEW.provider,NEW.model,NEW.pricing_version,
    NEW.max_input_tokens,NEW.max_output_tokens,NEW.input_usd_per_million_tokens,
    NEW.output_usd_per_million_tokens,NEW.hard_cap_micro_usd,
    NEW.reservation_micro_usd,NEW.provider_request_identity)
    IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.requested_by_user_id,OLD.idempotency_key,OLD.run_key,
    OLD.input_contract_version,OLD.output_contract_version,OLD.corpus_identity,
    OLD.discovery_run_digest,OLD.source_manifest_digest,OLD.rights_digest,OLD.modeling_count,
    OLD.packet_digest,OLD.packet_proposal_count,OLD.packet_evidence_count,
    OLD.semantic_context_generation_id,OLD.semantic_context_generation_key,
    OLD.semantic_context_authority_digest,OLD.brand_os_digest,OLD.knowledge_digest,
    OLD.locale_context_digest,OLD.candidate_pack_digest,OLD.approved_context_count,
    OLD.envelope_digest,OLD.request_digest,OLD.provider,OLD.model,OLD.pricing_version,
    OLD.max_input_tokens,OLD.max_output_tokens,OLD.input_usd_per_million_tokens,
    OLD.output_usd_per_million_tokens,OLD.hard_cap_micro_usd,
    OLD.reservation_micro_usd,OLD.provider_request_identity)
     OR NEW.provider_call_count<OLD.provider_call_count THEN
    RAISE EXCEPTION 'Topic evaluation sealed authority is immutable.' USING ERRCODE='55000';
  END IF;
  IF NOT (CASE OLD.status
    WHEN 'queued' THEN NEW.status IN('queued','in_flight','failed')
    WHEN 'in_flight' THEN NEW.status IN('in_flight','response_persisted','outcome_unknown') OR (
      NEW.status='failed'
      AND NEW.provider_call_count=1
      AND NEW.provider_call_state='settled'
      AND NEW.error_code='topic_evaluation_provider_definitely_not_sent'
      AND NEW.provider_response_private IS NULL
      AND NEW.provider_response_digest IS NULL
      AND NEW.provider_request_id IS NULL
      AND NEW.input_tokens=0 AND NEW.output_tokens=0 AND NEW.settled_micro_usd=0
      AND NEW.output_digest IS NULL AND NEW.candidate_count IS NULL AND NEW.rubric_met IS NULL
      AND NEW.completed_at IS NULL AND NEW.failed_at IS NOT NULL)
    WHEN 'response_persisted' THEN NEW.status IN('response_persisted','completed','failed')
    ELSE NEW.status=OLD.status END) THEN
    RAISE EXCEPTION 'Topic evaluation state is terminal or regressive.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
