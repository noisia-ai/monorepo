-- Provenance is independent of the standard/H1 membership route.
-- Existing corrections remain unknown until explicitly audited; never infer human review.
ALTER TABLE signal_concept_membership_overrides
  ADD COLUMN decided_via text,
  ADD CONSTRAINT signal_membership_decision_origin_valid
    CHECK (decided_via IN ('human_ui','agent_assisted'));

-- Only current, explicitly human-reviewed corrections qualify as human evaluation data.
CREATE VIEW signal_concept_membership_human_evaluation_v1 AS
 SELECT o.id,o.workspace_id,o.root_id,o.concept_key,o.verdict,o.actor_user_id,
   o.definition_digest,o.root_fingerprint,o.created_at,o.decided_via
 FROM signal_concept_membership_overrides o
 JOIN signal_concept_memberships_current_v1 m ON m.workspace_id=o.workspace_id
   AND m.root_id=o.root_id AND m.concept_key=o.concept_key
   AND m.definition_digest=o.definition_digest AND m.root_fingerprint=o.root_fingerprint
 WHERE o.superseded_at IS NULL AND o.decided_via='human_ui' AND m.source='human'
   AND m.verdict=o.verdict AND NOT m.requires_override_review;
REVOKE ALL ON signal_concept_membership_human_evaluation_v1 FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   REVOKE ALL ON signal_concept_membership_human_evaluation_v1 FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   REVOKE ALL ON signal_concept_membership_human_evaluation_v1 FROM authenticated;
 END IF;
END $$;
