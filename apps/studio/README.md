# Studio UAT release notes

The consolidated Topics editor creates a new catalog revision when a name or definition changes. Existing Signal serving, selection, rank, and group decisions stay on the previous published revision until the new revision is explicitly activated. The original group census remains available for evidence and traceability.

This UI depends on the corrected `prepare_signal_topic_consolidation_snapshot_v1` binding in SQL 0185. Apply that database change before deploying the Studio revision that exposes editing. The database change is applied once; subsequent app deployments do not replay it.
