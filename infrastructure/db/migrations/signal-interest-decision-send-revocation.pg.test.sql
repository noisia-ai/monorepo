-- Disposable local PG after SQL0211. No owner, provider or paid admission is created.
-- A send mark must reject a transaction snapshot that cannot observe revocation
-- committed while it waits for the policy/corpus locks.
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$
BEGIN
 BEGIN
  PERFORM mark_submitting_signal_interest_decision_batch_v1(
   'ea000000-0000-4000-8000-000000000001',
   'ea000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'interest_decision_send_accepted_stale_snapshot';
 EXCEPTION WHEN SQLSTATE '25001' THEN NULL;
 END;
END $$;
ROLLBACK;

-- Missing batch identity must fail before any send state is recorded.
BEGIN;
DO $$
BEGIN
 BEGIN
  PERFORM mark_submitting_signal_interest_decision_batch_v1(
   'ea000000-0000-4000-8000-000000000001',
   'ea000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'interest_decision_send_accepted_missing_batch';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
END $$;
ROLLBACK;
