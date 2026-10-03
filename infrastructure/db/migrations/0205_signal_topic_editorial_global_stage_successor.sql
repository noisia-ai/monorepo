-- An immutable global stage whose provider rejected every schema at zero cost
-- may be superseded by a new, deterministic stage identity for the same
-- screening census. Only one non-blocked stage may exist for that census.
ALTER TABLE signal_topic_editorial_global_stages_v2
 DROP CONSTRAINT signal_topic_editorial_global_execution_id_snapshot_digest__key;

CREATE UNIQUE INDEX signal_topic_editorial_global_live_census_v2
 ON signal_topic_editorial_global_stages_v2(execution_id,snapshot_digest,screening_review_digest)
 WHERE state IN('open','complete','materialized');
