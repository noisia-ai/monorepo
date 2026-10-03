-- Disposable SB-09 fixture. It proves the strategic metric boundary: only
-- mentions frozen into the run snapshot may affect a published release.
-- Run with ON_ERROR_STOP in a disposable Postgres transaction.

BEGIN;

CREATE TEMP TABLE tb_fixture_mentions (
  id integer PRIMARY KEY,
  finding_key text NOT NULL,
  platform text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE tb_fixture_snapshot_mentions (
  snapshot_id integer NOT NULL,
  mention_id integer NOT NULL REFERENCES tb_fixture_mentions(id),
  PRIMARY KEY (snapshot_id, mention_id)
) ON COMMIT DROP;

INSERT INTO tb_fixture_mentions (id, finding_key, platform) VALUES
  (1, 'barrier:cost', 'instagram'),
  (2, 'barrier:cost', 'tiktok'),
  (3, 'trigger:trust', 'instagram');
INSERT INTO tb_fixture_snapshot_mentions (snapshot_id, mention_id) VALUES
  (1, 1), (1, 2), (1, 3);

CREATE TEMP TABLE tb_fixture_published_release AS
SELECT
  1::integer AS snapshot_id,
  finding_key,
  COUNT(*)::integer AS value,
  COUNT(*) OVER ()::integer AS denominator
FROM tb_fixture_snapshot_mentions snapshot_mention
JOIN tb_fixture_mentions mention ON mention.id = snapshot_mention.mention_id
WHERE snapshot_mention.snapshot_id = 1
GROUP BY finding_key;

-- Later operational ingestion is intentionally not a member of snapshot 1.
INSERT INTO tb_fixture_mentions (id, finding_key, platform) VALUES
  (4, 'barrier:cost', 'instagram'),
  (5, 'barrier:cost', 'instagram');

DO $fixture$
DECLARE
  published_value integer;
  recomputed_value integer;
  live_value integer;
BEGIN
  SELECT value INTO published_value
  FROM tb_fixture_published_release
  WHERE finding_key = 'barrier:cost';

  SELECT COUNT(*)::integer INTO recomputed_value
  FROM tb_fixture_snapshot_mentions snapshot_mention
  JOIN tb_fixture_mentions mention ON mention.id = snapshot_mention.mention_id
  WHERE snapshot_mention.snapshot_id = 1
    AND mention.finding_key = 'barrier:cost';

  SELECT COUNT(*)::integer INTO live_value
  FROM tb_fixture_mentions
  WHERE finding_key = 'barrier:cost';

  IF published_value <> 2 OR recomputed_value <> published_value OR live_value <> 4 THEN
    RAISE EXCEPTION 'strategic release changed after operational ingestion';
  END IF;
END
$fixture$;

ROLLBACK;
