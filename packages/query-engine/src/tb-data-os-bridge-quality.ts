export type TbCodingBridgeCounts = {
  codings: number;
  coded_mentions: number;
  non_irrelevant_mentions: number;
  ambiguous_mentions: number;
  missing_layer_mentions: number;
  missing_emergent_tag_mentions: number;
  unlinked_finding_mentions: number;
  record_tags: number;
  record_features: number;
  polarity_tagged_mentions: number;
  layer_tagged_mentions: number;
  emergent_candidate_tags: number;
  tag_lineage_edges: number;
  feature_lineage_edges: number;
  lineage_edges: number;
};

export type TbCodingBridgeStage = "step2_coding" | "step3_hierarchy" | "reconcile";

export type TbCodingBridgeQuality = {
  status: "accepted" | "needs_review" | "blocked";
  ready: boolean;
  warnings: string[];
};

export function assessTbCodingBridgeQuality(
  counts: TbCodingBridgeCounts,
  stage: TbCodingBridgeStage
): TbCodingBridgeQuality {
  const warnings: string[] = [];
  if (counts.codings === 0 || counts.coded_mentions === 0) {
    return {
      status: "blocked",
      ready: false,
      warnings: ["No T&B mention codings were available to materialize."]
    };
  }
  if (counts.record_features !== counts.coded_mentions) {
    return {
      status: "blocked",
      ready: false,
      warnings: [
        `Only ${counts.record_features}/${counts.coded_mentions} coded mentions have a governed feature record.`
      ]
    };
  }
  if (counts.feature_lineage_edges !== counts.record_features) {
    return {
      status: "blocked",
      ready: false,
      warnings: [
        `Only ${counts.feature_lineage_edges}/${counts.record_features} governed feature records have coding lineage.`
      ]
    };
  }
  if (counts.tag_lineage_edges !== counts.record_tags) {
    return {
      status: "blocked",
      ready: false,
      warnings: [
        `Only ${counts.tag_lineage_edges}/${counts.record_tags} governed tag records have coding lineage.`
      ]
    };
  }
  const taggableMentions = Math.max(
    counts.non_irrelevant_mentions - counts.missing_emergent_tag_mentions,
    0
  );
  if (counts.polarity_tagged_mentions < taggableMentions) {
    return {
      status: "blocked",
      ready: false,
      warnings: [
        `Only ${counts.polarity_tagged_mentions}/${taggableMentions} taggable mentions have a governed trigger/barrier tag.`
      ]
    };
  }
  const layerEligibleMentions = Math.max(
    counts.non_irrelevant_mentions - counts.missing_layer_mentions,
    0
  );
  if (counts.layer_tagged_mentions < layerEligibleMentions) {
    return {
      status: "blocked",
      ready: false,
      warnings: [
        `Only ${counts.layer_tagged_mentions}/${layerEligibleMentions} mentions with an explicit layer have a governed layer tag.`
      ]
    };
  }
  if (counts.missing_layer_mentions > 0) {
    warnings.push(`${counts.missing_layer_mentions} coded mentions have no explicit T&B layer.`);
  }
  if (counts.missing_emergent_tag_mentions > 0) {
    warnings.push(`${counts.missing_emergent_tag_mentions} non-irrelevant mentions have no emergent tag.`);
  }
  if (counts.ambiguous_mentions > 0) {
    warnings.push(`${counts.ambiguous_mentions} coded mentions remain ambiguous and require review.`);
  }
  if (stage !== "step2_coding" && counts.unlinked_finding_mentions > 0) {
    warnings.push(`${counts.unlinked_finding_mentions} non-irrelevant mentions are not linked to a finding.`);
  }

  return {
    status: warnings.length > 0 ? "needs_review" : "accepted",
    ready: true,
    warnings
  };
}
