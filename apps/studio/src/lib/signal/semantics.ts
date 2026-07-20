export const SIGNAL_SERVING_CONTRACT_VERSION = "signal-serving-v1";

export const REQUIRED_SIGNAL_DATA_REF_KEYS = [
  "published_mentions",
  "social_overview",
  "social_timeseries",
  "social_dimensions",
  "analysis_findings",
  "analysis_opportunities",
  "analysis_evidence",
  "cross_source_timeline"
] as const;

export type RequiredSignalDataRefKey = (typeof REQUIRED_SIGNAL_DATA_REF_KEYS)[number];

export const SIGNAL_OPPORTUNITY_KINDS = ["activation", "friction_removal"] as const;
export type SignalOpportunityKind = (typeof SIGNAL_OPPORTUNITY_KINDS)[number];

export type SignalMobility = "movable" | "partial" | "structural" | "unknown";

export const SIGNAL_SEMANTIC_DEFINITIONS = {
  finding: {
    source: "tb_findings",
    grain: "one reviewed finding within one analysis",
    rule: "Count only findings owned by the published analysis. Mention codings are evidence, not findings."
  },
  opportunity: {
    source: "tb_recommendations",
    grain: "one reviewed recommendation within one analysis",
    rule: "Count recommendations whose kind is activation or friction_removal. Never infer opportunities from uncoded mentions."
  },
  mobility: {
    source: "tb_findings.movilidad",
    grain: "one mobility classification per finding",
    rule: "Mobility describes a finding. Unknown remains unknown and must not be counted as movable."
  },
  mention: {
    source: "corpus_snapshot_mentions + mentions",
    grain: "one mention included in the immutable published snapshot",
    rule: "All dashboard populations and aggregations use the same snapshot membership."
  }
} as const;

export function isSignalOpportunityKind(value: unknown): value is SignalOpportunityKind {
  return typeof value === "string" && SIGNAL_OPPORTUNITY_KINDS.includes(value as SignalOpportunityKind);
}

export function normalizeSignalMobility(value: unknown): SignalMobility {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (["movable", "movible", "movible_por_marca", "brand_movable"].includes(normalized)) return "movable";
  if (["partial", "partially_movable", "parcial", "parcialmente_movible"].includes(normalized)) return "partial";
  if (["structural", "estructural"].includes(normalized)) return "structural";
  return "unknown";
}

export function attachSignalServingContract<TManifest extends Record<string, unknown>>(
  manifest: TManifest,
  args: { analysisId: string; snapshotId: string }
) {
  return {
    ...manifest,
    data_contract: {
      version: SIGNAL_SERVING_CONTRACT_VERSION,
      analysis_id: args.analysisId,
      snapshot_id: args.snapshotId,
      source_of_truth: "relational",
      population: "corpus_snapshot_mentions",
      payload_role: "manifest_only",
      required_data_refs: [...REQUIRED_SIGNAL_DATA_REF_KEYS],
      definitions: SIGNAL_SEMANTIC_DEFINITIONS
    }
  };
}

export function hasSignalServingContract(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;

  const dataContract = (manifest as Record<string, unknown>).data_contract;
  if (!dataContract || typeof dataContract !== "object" || Array.isArray(dataContract)) return false;

  const contract = dataContract as Record<string, unknown>;
  return (
    contract.version === SIGNAL_SERVING_CONTRACT_VERSION &&
    contract.source_of_truth === "relational"
  );
}
