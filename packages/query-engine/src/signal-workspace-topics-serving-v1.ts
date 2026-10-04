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
  filters: { date_from: string | null; date_to: string | null; timezone?: string };
  available_dates: { date_from: string | null; date_to: string | null };
  scope_digest: string;
  observed_at: string;
  denominator: number;
  coverage: {
    processed: number;
    assigned_unique: number;
    abstained: number;
    /** Editorial Noise at the canonical-mention level. Null means the legacy
     * classifier did not produce a governed Noise disposition. */
    noise: number | null;
    unresolved: number;
    withheld: number;
  };
  /** MFP fiche relevance: the first four categories partition the rights-filtered,
   * date-filtered root denominator. without_concept is a subset of relevant,
   * considering every current MFP concept, independently of Signal selection.
   * assigned_unique counts visible roots and is not an additional partition. */
  membership_population?: { relevant: number; unrelated: number; spam: number; unknown: number; without_concept: number };
  interpretation_coverage: { interpreted_unit_count: number; expected_unit_count: number; complete: boolean } | null;
  quality: "not_calibrated";
  terms: Array<{
    term_key: string;
    kind: "topic" | "narrative";
    label: string;
    definition: string;
    definition_revision: number;
    definition_digest: string;
    selected: boolean;
    mention_count: number;
    share_of_corpus: number | null;
    basis: "computed_cluster" | "defined_interest" | "concept_membership";
    /** Present only for an independently classified, selected interest. */
    interest_generation_id?: string;
    /** False until the cited decision receipt is available to the evidence API. */
    evidence_available?: boolean;
  }>;
  series: Array<{ date: string; mention_count: number; assigned_unique: number }>;
  limitations: string[];
};

export type SignalWorkspaceTopicEvidencePageV1 = {
  contract_version: "signal-workspace-topic-evidence-v1";
  workspace_id: string;
  generation_id: string | null;
  kind: "topic" | "narrative";
  term_key: string;
  scope_digest: string;
  items: Array<{
    mention_id: string;
    text: string;
    /** Exact MFP citation within the complete root text; absent for human-only evidence. */
    quote?: string | null;
    platform: string;
    occurred_at: string | null;
    url: string | null;
    evidence_fragment: { chunk_index: number; start: number; end: number; chunk_sha256: string } | null;
    /** A human correction is never presented as a Claude citation. */
    evidence_origin?: "model_decision" | "human_correction";
    /** A cited, settled interest decision. Never substitute a generic excerpt. */
    decision_citation?: { role: "supports"; output_digest: string; decision_digest: string;
      chunk_index: number; quote_start: number; quote_end: number; chunk_sha256: string };
  }>;
  next_cursor: string | null;
};

/** An accepted, rights-filtered corpus before classification. Null classification
 * counts mean not analyzed; they are not zero-valued model results. */
export type SignalWorkspaceImportedIdentityV1 = {
  source: "workspace_imported";
  classification_state: "pending";
  generation_id: null;
  source_engine_execution_id: null;
};
export type SignalWorkspaceImportedOverviewV1 = Omit<SignalWorkspaceTopicsOverviewV1,
  "source" | "generation_id" | "source_engine_execution_id" | "coverage" | "quality" | "series"> & SignalWorkspaceImportedIdentityV1 & {
  quality: "not_analyzed";
  evidence_visible_total: number;
  series: Array<{ date: string; mention_count: number; assigned_unique: null }>;
  coverage: { processed: null; assigned_unique: null; abstained: null; noise: null; unresolved: null; withheld: null };
};
/** A brand may publish defined interests without running open discovery. Each
 * interest owns a separate classification generation; there is no fictitious
 * workspace-wide generation or BERTopic interpretation behind this view. */
export type SignalWorkspaceDefinedInterestOverviewV1 = Omit<SignalWorkspaceTopicsOverviewV1,
  "source" | "generation_id" | "source_engine_execution_id" | "terms" | "coverage"> & {
  source: "workspace_defined_interest";
  classification_state: "ready";
  generation_id: null;
  source_engine_execution_id: null;
  interest_generation_ids: string[];
  interest_selection_digest: string;
  evidence_visible_total: number;
  /** Open-discovery Noise and a single global abstention state have not been
   * computed by independent interest decisions. Null is not zero. */
  coverage: { processed: number; assigned_unique: number; abstained: null; noise: null;
    unresolved: null; withheld: number };
  terms: Array<SignalWorkspaceTopicsOverviewV1["terms"][number] & {
    kind: "topic"; basis: "defined_interest"; interest_generation_id: string;
    evidence_available: boolean;
  }>;
};
export type SignalWorkspaceOverviewV1 = SignalWorkspaceTopicsOverviewV1 | SignalWorkspaceImportedOverviewV1
  | SignalWorkspaceDefinedInterestOverviewV1;
