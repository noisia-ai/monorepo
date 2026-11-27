-- R16b: a study may cut the corpus with its own lexicon instead of the brand's.
-- The brand's lexicon says which posts talk about the category the report
-- listens to. A study can be about something else in the same corpus, so it
-- carries its own terms and keeps here which posts they matched, computed once
-- when the study starts.
-- Additive: one table. Safe to re-run. Server-side access only.

CREATE TABLE IF NOT EXISTS signal_study_lexicon_matches (
 study_id uuid NOT NULL REFERENCES signal_studies(id),
 root_id uuid NOT NULL,
 PRIMARY KEY (study_id, root_id)
);

DO $$ DECLARE role_name text; BEGIN
 ALTER TABLE signal_study_lexicon_matches ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON TABLE signal_study_lexicon_matches FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON TABLE signal_study_lexicon_matches FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
