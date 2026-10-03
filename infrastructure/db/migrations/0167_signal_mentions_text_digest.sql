-- Stage 1/3: install byte-exact digest maintenance without rewriting mentions.
-- The existing text_hash remains the case-insensitive ingestion identity.
ALTER TABLE mentions ADD COLUMN text_clean_sha256 text;

CREATE FUNCTION maintain_signal_mention_text_clean_sha256_v1() RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,extensions
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.text_clean_sha256 := 'sha256:'||encode(sha256(convert_to(NEW.text_clean,'UTF8')),'hex');
  ELSIF NEW.text_clean IS DISTINCT FROM OLD.text_clean
    OR NEW.text_clean_sha256 IS NULL
    OR NEW.text_clean_sha256 IS DISTINCT FROM OLD.text_clean_sha256 THEN
    NEW.text_clean_sha256 := 'sha256:'||encode(sha256(convert_to(NEW.text_clean,'UTF8')),'hex');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_signal_mention_text_clean_sha256
  BEFORE INSERT OR UPDATE ON mentions
  FOR EACH ROW EXECUTE FUNCTION maintain_signal_mention_text_clean_sha256_v1();

ALTER TABLE mentions ADD CONSTRAINT mentions_text_clean_sha256_exact CHECK(
  text_clean_sha256 IS NULL
  OR text_clean_sha256='sha256:'||encode(sha256(convert_to(text_clean,'UTF8')),'hex')
) NOT VALID;

CREATE TABLE signal_mention_text_digest_backfill_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  last_id uuid,
  rows_updated bigint NOT NULL DEFAULT 0 CHECK(rows_updated>=0)
);
INSERT INTO signal_mention_text_digest_backfill_state(singleton) VALUES(true);
REVOKE ALL ON signal_mention_text_digest_backfill_state FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON signal_mention_text_digest_backfill_state FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON signal_mention_text_digest_backfill_state FROM authenticated';
  END IF;
END $$;

CREATE FUNCTION backfill_signal_mention_text_clean_sha256_v1(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SET search_path=pg_catalog,public,extensions
AS $$
DECLARE cursor_id uuid;DECLARE next_id uuid;DECLARE changed integer;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>10000 THEN
    RAISE EXCEPTION 'signal_mentions_text_digest_backfill_limit_invalid' USING ERRCODE='22023';
  END IF;
  SELECT last_id INTO cursor_id FROM signal_mention_text_digest_backfill_state
    WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signal_mentions_text_digest_backfill_state_invalid' USING ERRCODE='55000';
  END IF;
  LOOP
    WITH candidates AS MATERIALIZED (
      SELECT id FROM mentions WHERE text_clean_sha256 IS NULL
        AND (cursor_id IS NULL OR id>cursor_id)
      ORDER BY id LIMIT p_limit
    ), updated AS (
      UPDATE mentions mention SET text_clean_sha256=NULL FROM candidates
      WHERE mention.id=candidates.id RETURNING mention.id
    ) SELECT (SELECT count(*)::integer FROM updated),
      (SELECT id FROM updated ORDER BY id DESC LIMIT 1) INTO changed,next_id;
    IF changed>0 THEN
      UPDATE signal_mention_text_digest_backfill_state
        SET last_id=next_id,rows_updated=rows_updated+changed WHERE singleton;
      RETURN changed;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM mentions WHERE text_clean_sha256 IS NULL) THEN
      RETURN 0;
    END IF;
    cursor_id:=NULL;
    UPDATE signal_mention_text_digest_backfill_state SET last_id=NULL WHERE singleton;
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION backfill_signal_mention_text_clean_sha256_v1(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION backfill_signal_mention_text_clean_sha256_v1(integer) FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION backfill_signal_mention_text_clean_sha256_v1(integer) FROM authenticated';
  END IF;
END $$;
