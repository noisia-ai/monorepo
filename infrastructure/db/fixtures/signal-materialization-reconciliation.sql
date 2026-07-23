-- Disposable SQL fixture for Phase 0 / SB-10 reconciliation.
-- Run inside a disposable transaction with ON_ERROR_STOP enabled.

BEGIN;

CREATE TEMP TABLE signal_fixture_mentions (
  id uuid PRIMARY KEY,
  period_start date NOT NULL,
  included boolean NOT NULL,
  engagement numeric,
  topic_review_status text
) ON COMMIT DROP;

INSERT INTO signal_fixture_mentions (
  id, period_start, included, engagement, topic_review_status
) VALUES
  ('10000000-0000-4000-8000-000000000001', '2026-05-01', true, 2, 'approved'),
  ('10000000-0000-4000-8000-000000000002', '2026-05-01', true, 4, 'unreviewed'),
  ('10000000-0000-4000-8000-000000000003', '2026-06-01', true, 6, 'approved'),
  ('10000000-0000-4000-8000-000000000004', '2026-06-01', true, NULL, 'approved'),
  ('10000000-0000-4000-8000-000000000005', '2026-06-01', false, 100, 'approved');

DO $fixture$
DECLARE
  previous_volume numeric;
  current_volume numeric;
  velocity numeric;
  drill_down_count integer;
  engagement_denominator integer;
  accepted_topic_count integer;
  pending_topic_count integer;
BEGIN
  SELECT count(*) FILTER (WHERE period_start = '2026-05-01' AND included),
    count(*) FILTER (WHERE period_start = '2026-06-01' AND included)
  INTO previous_volume, current_volume
  FROM signal_fixture_mentions;

  velocity := (current_volume - previous_volume) / NULLIF(previous_volume, 0);
  IF previous_volume <> 2 OR current_volume <> 2 OR velocity <> 0 THEN
    RAISE EXCEPTION 'velocity aggregate/denominator reconciliation failed';
  END IF;

  SELECT count(*) INTO drill_down_count
  FROM signal_fixture_mentions
  WHERE period_start = '2026-06-01' AND included;
  IF drill_down_count <> current_volume THEN
    RAISE EXCEPTION 'aggregate/drill-down reconciliation failed';
  END IF;

  SELECT count(*) INTO engagement_denominator
  FROM signal_fixture_mentions
  WHERE period_start = '2026-06-01' AND included AND engagement IS NOT NULL;
  IF engagement_denominator <> 1 THEN
    RAISE EXCEPTION 'engagement denominator reconciliation failed';
  END IF;

  SELECT count(*) FILTER (WHERE topic_review_status = 'approved'),
    count(*) FILTER (WHERE topic_review_status NOT IN ('approved', 'rejected'))
  INTO accepted_topic_count, pending_topic_count
  FROM signal_fixture_mentions
  WHERE included;
  IF accepted_topic_count <> 3 OR pending_topic_count <> 1 THEN
    RAISE EXCEPTION 'governed topic quality reconciliation failed';
  END IF;
END
$fixture$;

ROLLBACK;
