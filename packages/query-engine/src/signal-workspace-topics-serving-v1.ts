/** Workspace-native computed memberships. This contract does not imply calibrated
 * semantic precision, model approval, or activation of a legacy taxonomy profile. */
export type SignalWorkspaceTopicsOverviewV1 = {
  contract_version: "signal-workspace-topics-serving-v1";
  source: "workspace_computed";
  workspace_id: string;
  corpus_id: null;
  scope: "all_conversations";
  generation_id: string | null;
  source_engine_execution_id: string | null;
  is_current: boolean;
  is_processing: boolean;
  selection_revision: number;
  filters: { date_from: string | null; date_to: string | null };
  available_dates: { date_from: string | null; date_to: string | null };
  scope_digest: string;
  observed_at: string;
  denominator: number;
  coverage: {
    processed: number;
    assigned_unique: number;
    abstained: number;
    unresolved: number;
    withheld: number;
  };
  quality: "not_calibrated";
  terms: Array<{
    term_key: string;
    label: string;
    definition: string;
    definition_revision: number;
    definition_digest: string;
    selected: boolean;
    mention_count: number;
    share_of_corpus: number | null;
    basis: "computed_cluster";
  }>;
  series: Array<{ date: string; mention_count: number; assigned_unique: number }>;
  limitations: string[];
};

export type SignalWorkspaceTopicEvidencePageV1 = {
  contract_version: "signal-workspace-topic-evidence-v1";
  workspace_id: string;
  generation_id: string;
  term_key: string;
  scope_digest: string;
  items: Array<{
    mention_id: string;
    text: string;
    platform: string;
    occurred_at: string;
    url: string | null;
    evidence_fragment: { chunk_index: number; start: number; end: number; chunk_sha256: string } | null;
  }>;
  next_cursor: string | null;
};
