-- Analyst dismissals belong to an exact study lexicon, independently of paid labels.
CREATE TABLE signal_mass_labeling_lexicon_dismissals (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 lexicon_digest text NOT NULL CHECK(lexicon_digest ~ '^sha256:[0-9a-f]{64}$'),
 term text NOT NULL CHECK(length(term) BETWEEN 1 AND 200 AND term=btrim(term)),
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,lexicon_digest,term)
);
ALTER TABLE signal_mass_labeling_lexicon_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mass_labeling_lexicon_dismissals FROM PUBLIC,anon,authenticated;
