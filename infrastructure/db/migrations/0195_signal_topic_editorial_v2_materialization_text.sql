-- V2 accepts complete model prose up to the per-result transport envelope.
-- These technical storage bounds match that envelope and do not truncate text.
ALTER TABLE signal_topic_editorial_concepts
  DROP CONSTRAINT signal_topic_editorial_concepts_label_check,
  DROP CONSTRAINT signal_topic_editorial_concepts_definition_check,
  ADD CONSTRAINT signal_topic_editorial_concepts_label_check
    CHECK(octet_length(btrim(label)) BETWEEN 1 AND 8388608),
  ADD CONSTRAINT signal_topic_editorial_concepts_definition_check
    CHECK(octet_length(btrim(definition)) BETWEEN 1 AND 8388608);

ALTER TABLE signal_topic_consolidation_decisions
  DROP CONSTRAINT signal_topic_consolidation_decisions_rationale_check,
  ADD CONSTRAINT signal_topic_consolidation_decisions_rationale_check
    CHECK(rationale IS NULL OR octet_length(rationale)<=8388608);
