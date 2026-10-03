/** Full workspace input for the existing Python discovery engines. No provider
 * credentials, database connection or classification approval lives in this wire. */
export const SIGNAL_WORKSPACE_ENGINE_INPUT_V1 = "workspace-topic-engine-input-v1" as const;
export const SIGNAL_WORKSPACE_ENGINE_PROFILE_V1 = "workspace-bertopic-guided-open-v1" as const;
export const SIGNAL_WORKSPACE_ENGINE_JOB_V1 = "signal_workspace_topic_engine_v1" as const;
/** Agreed before fitting. Changing these values creates a different model identity. */
export const SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 = Object.freeze({
  profile_version: SIGNAL_WORKSPACE_ENGINE_PROFILE_V1, seed: 17, language_families: ["es", "en"],
  umap_n_neighbors: 15, umap_n_components: 8, umap_min_dist: 0,
  hdbscan_min_cluster_size: 40, hdbscan_min_samples: 5, cluster_selection_method: "leaf",
  vectorizer_min_df: 1, vectorizer_max_df: 1, vectorizer_max_features: 50000,
  ngram_min: 1, ngram_max: 3, top_n_words: 15, guide_mix: 0.25,
  lineage_min_common_roots: 2, lineage_min_fraction: 0.5, memory_budget_bytes: 4294967296
});

export type SignalWorkspaceEngineChunkV1 = {
  root_id: string; root_fingerprint: string; asset_sha256: string; expected_chunks: number;
  chunk_index: number; start: number; end: number; chunk_sha256: string; text: string;
  vector: number[];
};
export type SignalWorkspaceEngineGuideV1 = {
  guide_key: string;
  role: "topic_positive" | "topic_negative" | "scope_positive" | "scope_negative";
  input_digest: string; vector: number[];
};
export type SignalWorkspaceEngineSnapshotV1 = {
  workspace_id: string; input_revision: number; preparation_run_id: string; embedding_run_id: string;
  embedding_config_digest: string; context_digest: string; catalog_digest: string;
  chunk_policy_version: "corpus-text-chunks-v1";
  roots: number; chunks: number; guides: number; dimensions: 1024;
  // Server-owned, versioned parameters; never accepted from a browser request.
  config: Record<string, unknown>;
};
export type SignalWorkspaceEngineInputManifestV1 = Omit<SignalWorkspaceEngineSnapshotV1,
  "roots" | "chunks" | "guides" | "dimensions"> & {
  contract_version: typeof SIGNAL_WORKSPACE_ENGINE_INPUT_V1;
  records: { file: "chunks.jsonl"; sha256: string; rows: number; roots: number };
  vectors: { file: "vectors.npy"; sha256: string; rows: number; dimensions: 1024; dtype: "float32" };
  guides: { file: "guides.jsonl"; sha256: string; rows: number };
  guide_vectors: { file: "guide-vectors.npy"; sha256: string; rows: number; dimensions: 1024; dtype: "float32" };
};
