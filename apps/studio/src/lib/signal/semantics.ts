export const SIGNAL_SERVING_CONTRACT_VERSION = "signal-serving-v2";

export const REQUIRED_SIGNAL_DATA_REF_KEYS = [
  "published_mentions",
  "social_overview",
  "social_timeseries",
  "social_dimensions",
  "analysis_findings",
  "analysis_opportunities",
  "analysis_actions",
  "analysis_evidence",
  "cross_source_timeline"
] as const;

export type RequiredSignalDataRefKey = (typeof REQUIRED_SIGNAL_DATA_REF_KEYS)[number];

export type SignalMobility = "movable" | "partial" | "structural" | "unknown";

export const SIGNAL_SEMANTIC_DEFINITIONS = {
  finding: {
    source: "tb_findings",
    grain: "one reviewed finding within one analysis",
    rule: "Count only findings owned by the published analysis. Mention codings are evidence, not findings."
  },
  opportunity: {
    source: "tb_strategic_opportunities + tb_opportunity_findings",
    grain: "one strategic decision object within one analysis",
    rule: "Every opportunity must link to reviewed findings with evidence in the approved snapshot. Operational recommendations are not strategic opportunities."
  },
  action: {
    source: "tb_action_studio + tb_action_findings",
    grain: "one prioritized execution card within one analysis",
    rule: "Every action must link to reviewed findings with evidence in the approved snapshot. Actions do not replace findings or opportunities."
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

export function normalizeSignalMobility(value: unknown): SignalMobility {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (["movable", "movible", "movible_por_marca", "brand_movable"].includes(normalized)) return "movable";
  if (["partial", "partially_movable", "parcial", "parcialmente_movible"].includes(normalized)) return "partial";
  if (["structural", "estructural"].includes(normalized)) return "structural";
  return "unknown";
}

export function isImmutablePublishedSignalStatus(status: unknown): boolean {
  return status === "published";
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
  return getSignalServingContractVersion(manifest) === SIGNAL_SERVING_CONTRACT_VERSION;
}

export function getSignalServingContractVersion(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;

  const dataContract = (manifest as Record<string, unknown>).data_contract;
  if (!dataContract || typeof dataContract !== "object" || Array.isArray(dataContract)) return null;

  const contract = dataContract as Record<string, unknown>;
  return contract.source_of_truth === "relational" && typeof contract.version === "string"
    ? contract.version
    : null;
}
