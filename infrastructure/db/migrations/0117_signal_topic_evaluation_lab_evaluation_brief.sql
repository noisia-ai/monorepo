-- 0117: persist the server-owned evaluation_brief navigation in the disposable Topic Lab only.
-- It is forward-only and deliberately cannot run against Preview/UAT or production.

DO $$
BEGIN
  IF current_database()!~'^noisia_topic_eval_lab_[a-z0-9_]{8,64}$'
     OR to_regclass('noisia_topic_evaluation_lab.clone_provenance') IS NULL
     OR NOT EXISTS(
       SELECT 1 FROM signal_workspace_data_plane_migration_ledger
       WHERE ordinal=116 AND migration_name='0116_signal_topic_evaluation_disposable_lab_execution.sql'
         AND disposition='applied'
     ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE='Migration 0117 requires the 0116 externally anchored disposable Topic Lab.';
  END IF;
END;
$$;

ALTER TABLE signal_topic_evaluation_v2_retrievals
  DROP CONSTRAINT signal_topic_evaluation_v2_retrieval_shape;

ALTER TABLE signal_topic_evaluation_v2_retrievals
  ADD CONSTRAINT signal_topic_evaluation_v2_retrieval_shape CHECK(
    retrieval_index BETWEEN 0 AND 23
    AND operation IN(
      'evaluation_brief',
      'cluster_catalog',
      'cluster_profile',
      'representative_mentions',
      'search_cluster',
      'compare_clusters',
      'brand_os_context'
    )
    AND tool_input_digest~'^sha256:[0-9a-f]{64}$'
    AND result_digest~'^sha256:[0-9a-f]{64}$'
    AND result_bytes BETWEEN 1 AND 32768
  );
