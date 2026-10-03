-- Backend 07 / Gate D unblock: preserve the per-operation hard-cap invariant
-- at the relational boundary. 0074 already rejects over-settlement in its
-- writer; this constraint prevents any alternate SQL path from persisting an
-- actual provider charge above the reservation that authorized it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM signal_strategic_budget_reservations
    WHERE actual_usd IS NOT NULL AND actual_usd > reservation_usd
  ) THEN
    RAISE EXCEPTION 'Existing strategic budget settlement exceeds its reservation.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'signal_strategic_budget_reservations'::regclass
      AND conname = 'signal_strategic_budget_settlement_within_reservation'
  ) THEN
    ALTER TABLE signal_strategic_budget_reservations
      ADD CONSTRAINT signal_strategic_budget_settlement_within_reservation
      CHECK (actual_usd IS NULL OR actual_usd <= reservation_usd) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE signal_strategic_budget_reservations
  VALIDATE CONSTRAINT signal_strategic_budget_settlement_within_reservation;

COMMENT ON CONSTRAINT signal_strategic_budget_settlement_within_reservation
  ON signal_strategic_budget_reservations IS
  'A provider settlement can consume at most the exact reservation authorized before dispatch.';

-- 0074 rounded observed cost to six decimals while the reservation authority
-- conservatively rounds upward to the next micro-USD. Keep both sides on the
-- same integer boundary: tokens * USD-per-million is already micro-USD.
CREATE OR REPLACE FUNCTION settle_signal_strategic_budget_v1(
  target_run_control_id uuid,
  target_idempotency_key text,
  target_input_tokens bigint,
  target_output_tokens bigint
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE control signal_strategic_run_controls%ROWTYPE;
DECLARE persisted signal_strategic_budget_reservations%ROWTYPE;
DECLARE computed_micro_usd numeric;
DECLARE computed_actual numeric(14,6);
DECLARE total_actual numeric(14,6);
DECLARE total_committed numeric(14,6);
BEGIN
  IF target_input_tokens < 0 OR target_output_tokens < 0 THEN
    RAISE EXCEPTION 'Observed token counts must be non-negative.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strategic-budget:'||target_run_control_id::text,0
  ));
  SELECT * INTO control FROM signal_strategic_run_controls
  WHERE id=target_run_control_id FOR UPDATE;
  SELECT * INTO persisted FROM signal_strategic_budget_reservations
  WHERE run_control_id=target_run_control_id AND idempotency_key=target_idempotency_key
  FOR UPDATE;
  IF control.id IS NULL OR persisted.id IS NULL OR persisted.status NOT IN ('reserved','settled') THEN
    RAISE EXCEPTION 'Strategic budget reservation is unavailable for settlement.'
      USING ERRCODE='23514';
  END IF;
  computed_micro_usd := ceil(
    target_input_tokens::numeric*control.input_usd_per_million_tokens
    +target_output_tokens::numeric*control.output_usd_per_million_tokens
  );
  computed_actual := computed_micro_usd/1000000;
  IF persisted.status='settled' THEN
    IF persisted.input_tokens IS DISTINCT FROM target_input_tokens
       OR persisted.output_tokens IS DISTINCT FROM target_output_tokens
       OR persisted.actual_usd IS DISTINCT FROM computed_actual THEN
      RAISE EXCEPTION 'Strategic budget settlement key has incompatible observed usage.'
        USING ERRCODE='23514';
    END IF;
    RETURN persisted.actual_usd;
  END IF;
  SELECT COALESCE(sum(CASE WHEN reservation.id=persisted.id THEN computed_actual
      ELSE reservation.actual_usd END),0)
  INTO total_actual
  FROM signal_strategic_budget_reservations reservation
  WHERE reservation.run_control_id=target_run_control_id
    AND (reservation.status='settled' OR reservation.id=persisted.id);
  IF computed_actual > persisted.reservation_usd OR total_actual > control.hard_cap_usd THEN
    RAISE EXCEPTION 'Observed provider cost exceeds its reservation or strategic hard cap.'
      USING ERRCODE='P0001';
  END IF;
  UPDATE signal_strategic_budget_reservations SET status='settled',
    input_tokens=target_input_tokens,output_tokens=target_output_tokens,
    actual_usd=computed_actual,settled_at=clock_timestamp()
  WHERE id=persisted.id;
  SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_usd
    ELSE reservation_usd END),0) INTO total_committed
  FROM signal_strategic_budget_reservations
  WHERE run_control_id=target_run_control_id AND status IN ('reserved','settled');
  UPDATE signal_strategic_run_controls SET actual_cost_usd=total_actual,
    reserved_cost_usd=total_committed,updated_at=now()
  WHERE id=control.id;
  RETURN computed_actual;
END;
$$;

COMMENT ON FUNCTION settle_signal_strategic_budget_v1(uuid,text,bigint,bigint) IS
  'Settles provider usage with the same conservative integer micro-USD ceiling as the server-owned reservation plan.';
