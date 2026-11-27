-- R16b: a discovery loop may end with one more round that has no review.
-- When the loop stops with pairs of topics that the merge rule folds, that
-- last round only asks what those merges left pending, so the published map
-- has no such pair. It comes after the last reviewed round (at most the third).
-- Forward-only and safe to re-run: it widens one check, no data changes.

ALTER TABLE signal_listening_rounds DROP CONSTRAINT IF EXISTS signal_listening_rounds_round_no_check;
ALTER TABLE signal_listening_rounds ADD CONSTRAINT signal_listening_rounds_round_no_check CHECK (round_no BETWEEN 1 AND 4);
