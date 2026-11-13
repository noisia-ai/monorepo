export type SignalConversationSegmentV1 = "all" | "conversation" | "advertising" | "hashtags";
export type SignalTopicLocalizationV1 = {original_language: string;
  original: {name: string; definition: string}; en: {name: string; definition: string}; es: {name: string; definition: string}};

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
  filters: { date_from: string | null; date_to: string | null; timezone?: string; conversation_segment?: SignalConversationSegmentV1 };
  available_dates: { date_from: string | null; date_to: string | null };
  scope_digest: string;
  observed_at: string;
  denominator: number;
  /** Present only when the native monitoring surface requested its governed metadata. */
  monitoring?: SignalWorkspaceMonitoringV1;
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
  population_segments?: {all: number; conversation: number; advertising: number; hashtags: number};
  consumer_indicators?: {eligible: number; category_matched?: number; category_excluded?: number; processed: number; trigger: number; barrier: number; none: number; intermediate: number; unresolved: number};
  quality: "not_calibrated";
  terms: Array<{
    term_key: string;
    kind: "topic" | "narrative";
    label: string;
    definition: string;
    localization?: SignalTopicLocalizationV1;
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
    forced_abstentions?: string[];
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


export type SignalWorkspaceMonitoringHighlightV1 = {
  id: string; occurred_at: string; title: string | null; text: string; url: string | null;
  platform: string; sentiment: number; engagement: number; reach: number | null;
  source_sha256: string;
};

/** Provider metadata aggregated over exactly the native rights-filtered root population.
 * Evidence rows require current mention-list/text rights and the prepared text SHA.
 * Source coverage distinguishes absent provider measurements from observed zero. */
export type SignalWorkspaceMonitoringV1 = {
  contract_version: "signal-workspace-monitoring-v1";
  denominator: number;
  scope_digest: string;
  metadata_digest: string;
  population: { map_id: string; map_digest: string; input_revision: string; policy_revision: number };
  source_coverage: {
    sentiment_known: number; emotion_classified: number; thread_id_known: number;
    content_type_known: number; engagement_known: number; views_known: number;
    engagement_known_root_posts: number; views_known_root_posts: number;
    provider_observation_roots: number; evidence_eligible: number; llm_eligible_roots: number;
  };
  summary: { mentions: number; conversations: number; root_posts: number; comments: number;
    unknown_roles: number; classified_sentiment: number };
  series: Array<{ period_start: string; mentions: number; conversations: number;
    root_posts: number; comments: number;
    sentiment: { positive: number; neutral: number; negative: number; classified: number } }>;
  sentiment: { positive: number; neutral: number; negative: number; unclassified: number };
  platforms: Array<{ key: string; count: number }>;
  emotions: Array<{ key: string; count: number }>;
  attention: { root_posts: number; total_interactions: number; median_interactions: number;
    p90_interactions: number; active_root_posts: number; active_ratio: number | null;
    total_views: number; viewed_root_posts: number };
  drivers: Array<{ id: string; title: string | null; text: string; url: string | null;
    platform: string; mention_count: number; root_post_count: number; comment_count: number;
    interaction_count: number; view_count: number; source_sha256: string }>;
  highlights: { positive: SignalWorkspaceMonitoringHighlightV1[]; negative: SignalWorkspaceMonitoringHighlightV1[] };
  limitations: string[];
};
