-- Add an explicit workspace opt-in. Applying this migration enables no workspace.
-- Forward-only. Rollback consists of disabling the runtime switch and removing
-- an operator-selected opt-in after all its work has reached a terminal state.
ALTER TABLE signal_workspace_features DROP CONSTRAINT signal_workspace_features_feature_check;
ALTER TABLE signal_workspace_features ADD CONSTRAINT signal_workspace_features_feature_check
  CHECK(feature IN ('mention_facets','concept_membership','mfp_discovery','mass_labeling'));
