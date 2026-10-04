-- The existing (workspace, term) selection also accepts new-engine concepts.
-- A NULL classification generation identifies a membership-engine selection;
-- legacy mutations still require their original finalized V2 generation.
ALTER TABLE signal_defined_interest_selections ALTER COLUMN generation_id DROP NOT NULL;
COMMENT ON COLUMN signal_defined_interest_selections.generation_id IS 'NULL for MFP concept membership; otherwise legacy classification generation. Receipt trigger unchanged.';
