import type { Confidence, Ownership } from "./engine";
import { confidenceFromMentions, evidenceConfidence } from "./engine-scoring";

export type EngineCodingAggregateInput = {
  findingKey: string;
  entityId: string | null;
  dimensions: Record<string, unknown>;
  intensity: number | null;
  sentiment: number | null;
  platform: string | null;
  publishedAt: Date | string | null;
  qualityScore: number | null;
  mentionId: string | null;
  span: string | null;
};

export type EngineFindingAggregate = {
  findingKey: string;
  entityId: string | null;
  name: string;
  dimensions: Record<string, unknown>;
  frequency: number;
  intensity: number;
  sentiment: number | null;
  sharePct: number;
  compositeScore: number;
  confidence: Confidence;
  confidenceFactors: Record<"volume" | "source_diversity" | "consistency" | "recency" | "citation_quality", number>;
  periodStart: string | null;
  periodEnd: string | null;
  position: number;
  citations: Array<{ mentionId: string; position: number }>;
};

export type NarrativeOwnershipInput = {
  findingKey: string;
  entityId: string | null;
  entityKind: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
};

export type NarrativeOwnershipScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  ownership: Ownership;
  differentiationIndex: number;
  dimensions: {
    narrative_total: number;
    entity_share_pct: number;
    dominant_share_pct: number;
    dominant_entity_id: string | null;
    dominant_entity_kind: string | null;
    ownership_decision: "owned" | "shared" | "insufficient_evidence";
  };
};

export type SentimentAdvocacyInput = {
  findingKey: string;
  entityId: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  sentiment: number | null;
  intensity: number | null;
};

export type SentimentAdvocacyScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  dimensions: {
    is_survey_nps: false;
    advocacy_proxy: number;
    pct_promoter: number;
    pct_detractor: number;
    pct_passive: number;
    avg_sentiment: number | null;
    avg_emotional_intensity: number | null;
    driver_share_pct: number;
    sentiment_source: "provider_or_llm_proxy";
  };
};

export type TrustRiskInput = {
  findingKey: string;
  entityId: string | null;
  entityKind: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  sentiment: number | null;
};

export type TrustRiskScore = {
  findingKey: string;
  entityId: string | null;
  ownership: Ownership | null;
  differentiationIndex: number | null;
  dimensions: {
    trust_score: number;
    risk_score: number;
    severity_weight: number;
    escalating_weight: number;
    risk_theme_share_pct: number | null;
    reputational_vulnerability: boolean;
    sensitive_risk_requires_evidence: boolean;
  };
};

export type ValuePerceptionInput = {
  findingKey: string;
  entityId: string | null;
  entityKind: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
  sentiment: number | null;
};

export type ValuePerceptionScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  ownership: Ownership;
  differentiationIndex: number;
  dimensions: {
    value_ownership_share: number;
    value_cell_total: number;
    value_score: number;
    perceived_value_weight: number;
    whitespace_candidate: boolean;
    whitespace_status: "not_whitespace" | "candidate_requires_absence_evidence";
    declared_vs_perceived: "perceived";
  };
};

export type JourneyFrictionInput = {
  findingKey: string;
  entityId: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
  sentiment: number | null;
};

export type JourneyFrictionScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  dimensions: {
    choke_score: number;
    accelerator_score: number;
    journey_cell_total: number;
    journey_cell_share_pct: number;
    removability_effort: "low" | "medium" | "high";
    removability_impact: "low" | "medium" | "high";
    quick_win_candidate: boolean;
    impact_basis: "declared_or_inferred_from_corpus";
    removability_basis: "heuristic_directional_not_measured";
  };
};

export type CategoryOpportunityInput = {
  findingKey: string;
  entityId: string | null;
  entityKind: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
  sentiment: number | null;
};

export type CategoryOpportunityScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  ownership: Ownership;
  differentiationIndex: number;
  dimensions: {
    need_total: number;
    demand_strength_score: number;
    coverage_score: number;
    urgency_weight: number;
    opportunity_score: number;
    best_positioned_entity_id: string | null;
    coverage_evidence_status: "coverage_evidence_present" | "insufficient_coverage_evidence";
  };
};

export type WhiteSpaceInput = {
  findingKey: string;
  entityId: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
  sentiment: number | null;
};

export type WhiteSpaceScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  dimensions: {
    demand_score: number;
    competitive_coverage_score: number;
    brand_permission_score: number;
    whitespace_score: number;
    whitespace_classification: "capturable" | "aspirational" | "defend" | "not_whitespace";
    absence_evidence_status: "directional_from_competitive_corpus" | "missing_absence_evidence" | "not_absence";
  };
};

export type BrandPositioningInput = {
  findingKey: string;
  entityId: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
  sentiment: number | null;
};

export type BrandPositioningScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  dimensions: {
    axis_position: number;
    attribute_score: number;
    perceptual_x: number;
    perceptual_y: number;
    nearest_entity_distance: number | null;
    entity_attribute_count: number;
    axis_defined: boolean;
    position_basis: "perceived_corpus_not_declared_positioning";
  };
};

export type CulturalCodesInput = {
  findingKey: string;
  entityId: string | null;
  entityKind: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
};

export type CulturalCodesScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  ownership: Ownership;
  differentiationIndex: number;
  dimensions: {
    code_total: number;
    entity_code_share_pct: number;
    cultural_intensity: number;
    maturity_weight: number;
    tension_score: number;
    cultural_level_present: boolean;
    opposition_present: boolean;
    long_text_evidence_status: "requires_source_validation" | "not_required_for_surface";
  };
};

export type CompetitiveWaveInput = {
  findingKey: string;
  entityId: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
  sentiment: number | null;
};

type CompetitiveWaveAxis = "resonance" | "cultural_ownership" | "sentiment" | "decision_velocity" | "differentiation";
type CompetitiveWaveAxisScores = Record<CompetitiveWaveAxis, number>;

export type CompetitiveWaveScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  dimensions: {
    axis_score: number;
    resonance_score: number;
    cultural_ownership_score: number;
    sentiment_score: number;
    decision_velocity_score: number;
    differentiation_score: number;
    wave_x: number;
    wave_y: number;
    wave_zone: "leader" | "challenger" | "niche" | "emerging" | "directional";
    entity_volume: number;
    wave_entity_count: number;
    wave_publishable: boolean;
  };
};

export type AudienceSegmentInput = {
  findingKey: string;
  entityId: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
  sentiment: number | null;
};

export type AudienceSegmentScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  dimensions: {
    segment_cell_total: number;
    segment_entity_share_pct: number;
    segment_skew: number;
    segment_metric_value: number;
    segment_source: "declared_or_metadata_or_coded" | "missing";
    sensitive_inference_used: boolean;
  };
};

export type InfluenceArchitectureInput = {
  findingKey: string;
  entityId: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
};

export type InfluenceArchitectureScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  dimensions: {
    influence_score: number;
    role_weight: number;
    community_total: number;
    graph_centrality_available: boolean;
    author_metadata_status: "required_for_real_graph";
    influence_basis: "coded_mentions_not_network_graph";
  };
};

export type DecisionVelocityInput = {
  findingKey: string;
  entityId: string | null;
  frequency: number;
  dimensions: Record<string, unknown>;
  intensity: number | null;
};

export type DecisionVelocityScore = {
  findingKey: string;
  entityId: string | null;
  sharePct: number;
  dimensions: {
    blocker_score: number;
    accelerator_score: number;
    phase_blocker_score: number;
    phase_accelerator_score: number;
    velocity_index: number;
    measured_vs_inferred: "inferred_from_corpus";
    benchmark_status: "benchmark_required_for_publication";
    ab_hypothesis_status: "requires_experiment";
  };
};

export function aggregateEngineCodings(rows: EngineCodingAggregateInput[]): EngineFindingAggregate[] {
  const groups = groupCodings(rows);
  const totalRows = Math.max(1, rows.length);
  return groups.map((group, index) => {
    const frequency = group.rows.length;
    const intensityValues = group.rows.map((row) => row.intensity ?? 0).filter(Number.isFinite);
    const sentimentValues = group.rows.map((row) => row.sentiment ?? 0).filter(Number.isFinite);
    const intensity = average(intensityValues);
    const sentiment = average(sentimentValues);
    const confidence = evidenceConfidence({
      volume: frequency,
      distinctSources: new Set(group.rows.map((row) => row.platform).filter(Boolean)).size,
      sentimentVariance: variance01(sentimentValues),
      newestAgeMonths: newestAgeMonths(group.rows.map((row) => row.publishedAt)),
      hasProtagonistQuote: group.rows.some((row) => Boolean(row.span && row.span.length >= 24))
    });

    return {
      findingKey: group.findingKey,
      entityId: group.entityId,
      name: titleFromFindingKey(group.findingKey, group.dimensions),
      dimensions: group.dimensions,
      frequency,
      intensity,
      sentiment: sentimentValues.length > 0 ? sentiment : null,
      sharePct: Math.round((frequency / totalRows) * 10000) / 100,
      compositeScore: Math.round((frequency * Math.max(0.5, intensity || 1)) * 1000) / 1000,
      confidence: frequency >= 30 ? confidence.confidence : confidenceFromMentions(frequency),
      confidenceFactors: confidence.factors,
      periodStart: minDate(group.rows.map((row) => row.publishedAt)),
      periodEnd: maxDate(group.rows.map((row) => row.publishedAt)),
      position: index + 1,
      citations: selectCitations(group.rows)
    };
  });
}

function groupCodings(rows: EngineCodingAggregateInput[]) {
  const map = new Map<string, { findingKey: string; entityId: string | null; dimensions: Record<string, unknown>; rows: EngineCodingAggregateInput[] }>();
  for (const row of rows) {
    const findingKey = row.findingKey || "uncategorized";
    const key = `${findingKey}::${row.entityId ?? ""}`;
    const group = map.get(key) ?? {
      findingKey,
      entityId: row.entityId,
      dimensions: row.dimensions,
      rows: []
    };
    group.rows.push(row);
    map.set(key, group);
  }
  return Array.from(map.values()).sort((a, b) => b.rows.length - a.rows.length);
}

function selectCitations(rows: EngineCodingAggregateInput[]) {
  return rows
    .filter((row): row is EngineCodingAggregateInput & { mentionId: string } => Boolean(row.mentionId))
    .sort((a, b) => Number(b.qualityScore ?? 0) - Number(a.qualityScore ?? 0))
    .slice(0, 3)
    .map((row, index) => ({ mentionId: row.mentionId, position: index + 1 }));
}

export function titleFromFindingKey(key: string, dimensions: Record<string, unknown>) {
  const observedLabel =
    stringValue(dimensions.signal_label) ||
    stringValue(dimensions.finding_label) ||
    stringValue(dimensions.observed_signal) ||
    stringValue(dimensions.narrative) ||
    stringValue(dimensions.theme) ||
    stringValue(dimensions.need);

  if (observedLabel) {
    return sentenceLabel(observedLabel);
  }

  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function sentenceLabel(value: string) {
  const normalized = value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return normalized;
  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}

export function scoreNarrativeOwnership(rows: NarrativeOwnershipInput[]): NarrativeOwnershipScore[] {
  const byNarrative = new Map<string, NarrativeOwnershipInput[]>();
  for (const row of rows) {
    const key = row.findingKey || "uncategorized";
    const bucket = byNarrative.get(key) ?? [];
    bucket.push({ ...row, findingKey: key });
    byNarrative.set(key, bucket);
  }

  const output: NarrativeOwnershipScore[] = [];
  for (const [findingKey, group] of byNarrative) {
    const total = group.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    const shares = group
      .map((row) => ({
        row,
        sharePct: total > 0 ? round2((row.frequency / total) * 100) : 0
      }))
      .sort((a, b) => b.sharePct - a.sharePct || b.row.frequency - a.row.frequency);
    const dominant = shares[0] ?? null;
    const runnerUp = shares[1] ?? null;
    const dominantShare = dominant?.sharePct ?? 0;
    const sharedByTie = Boolean(runnerUp && dominantShare - runnerUp.sharePct <= 5);
    const insufficient = total < 2 || dominantShare < 35;

    for (const item of shares) {
      const maxOtherShare = shares
        .filter((peer) => peer.row.entityId !== item.row.entityId)
        .reduce((max, peer) => Math.max(max, peer.sharePct), 0);
      const isDominant = dominant?.row.entityId === item.row.entityId && dominant?.row.entityKind === item.row.entityKind;
      const ownership: Ownership = insufficient
        ? "insufficient_evidence"
        : sharedByTie
          ? "shared"
          : isDominant
            ? ownershipFromEntityKind(item.row.entityKind)
            : "shared";
      const ownershipDecision = insufficient ? "insufficient_evidence" : ownership === "shared" ? "shared" : "owned";

      output.push({
        findingKey,
        entityId: item.row.entityId,
        sharePct: item.sharePct,
        ownership,
        differentiationIndex: round3(item.sharePct / 100 - maxOtherShare / 100),
        dimensions: {
          narrative_total: total,
          entity_share_pct: item.sharePct,
          dominant_share_pct: dominantShare,
          dominant_entity_id: dominant?.row.entityId ?? null,
          dominant_entity_kind: dominant?.row.entityKind ?? null,
          ownership_decision: ownershipDecision
        }
      });
    }
  }

  return output;
}

export function scoreSentimentAdvocacy(rows: SentimentAdvocacyInput[]): SentimentAdvocacyScore[] {
  const entityBuckets = new Map<string, SentimentAdvocacyInput[]>();
  for (const row of rows) {
    const key = row.entityId ?? "";
    const bucket = entityBuckets.get(key) ?? [];
    bucket.push(row);
    entityBuckets.set(key, bucket);
  }

  const output: SentimentAdvocacyScore[] = [];
  for (const [entityKey, bucket] of entityBuckets) {
    const total = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    const classCounts = { promoter: 0, passive: 0, detractor: 0 };
    const sentimentValues: number[] = [];
    const intensityValues: number[] = [];

    for (const row of bucket) {
      const klass = advocacyClass(row);
      classCounts[klass] += row.frequency;
      if (row.sentiment !== null && Number.isFinite(row.sentiment)) sentimentValues.push(row.sentiment);
      const intensity = readNumber(row.dimensions.emotional_intensity) ?? row.intensity;
      if (intensity !== null && Number.isFinite(intensity)) intensityValues.push(intensity);
    }

    const pctPromoter = total > 0 ? round2((classCounts.promoter / total) * 100) : 0;
    const pctDetractor = total > 0 ? round2((classCounts.detractor / total) * 100) : 0;
    const pctPassive = total > 0 ? round2((classCounts.passive / total) * 100) : 0;
    const advocacyProxy = round2(pctPromoter - pctDetractor);
    const avgSentiment = sentimentValues.length > 0 ? round3(average(sentimentValues)) : null;
    const avgIntensity = intensityValues.length > 0 ? round3(average(intensityValues)) : null;

    for (const row of bucket) {
      const driverSharePct = total > 0 ? round2((row.frequency / total) * 100) : 0;
      output.push({
        findingKey: row.findingKey,
        entityId: entityKey || null,
        sharePct: driverSharePct,
        dimensions: {
          is_survey_nps: false,
          advocacy_proxy: advocacyProxy,
          pct_promoter: pctPromoter,
          pct_detractor: pctDetractor,
          pct_passive: pctPassive,
          avg_sentiment: avgSentiment,
          avg_emotional_intensity: avgIntensity,
          driver_share_pct: driverSharePct,
          sentiment_source: "provider_or_llm_proxy"
        }
      });
    }
  }

  return output;
}

export function scoreTrustRiskBenchmark(rows: TrustRiskInput[]): TrustRiskScore[] {
  const entityBuckets = new Map<string, TrustRiskInput[]>();
  for (const row of rows) {
    const key = row.entityId ?? "";
    const bucket = entityBuckets.get(key) ?? [];
    bucket.push(row);
    entityBuckets.set(key, bucket);
  }

  const trustByEntity = new Map<string, number>();
  for (const [entityKey, bucket] of entityBuckets) {
    const total = Math.max(1, bucket.reduce((sum, row) => sum + row.frequency, 0));
    const trustFrequency = bucket
      .filter((row) => Boolean(stringValue(row.dimensions.trust_driver)))
      .reduce((sum, row) => sum + row.frequency, 0);
    const riskFrequency = bucket
      .filter((row) => Boolean(stringValue(row.dimensions.risk_theme)))
      .reduce((sum, row) => sum + row.frequency, 0);
    const avgSentiment = average(bucket.map((row) => row.sentiment ?? 0).filter(Number.isFinite));
    const trustShare = trustFrequency / total;
    const riskShare = riskFrequency / total;
    const trustScore = clamp100(50 + avgSentiment * 30 + trustShare * 20 - riskShare * 25);
    trustByEntity.set(entityKey, round2(trustScore));
  }

  const riskShareByKey = buildRiskThemeShares(rows);
  return rows.map((row) => {
    const isRisk = Boolean(stringValue(row.dimensions.risk_theme));
    const severityWeight = severityWeightFor(row.dimensions.severity);
    const escalatingWeight = escalatingWeightFor(row.dimensions.escalating);
    const riskScore = isRisk ? round2(row.frequency * severityWeight * escalatingWeight) : 0;
    const riskShare = riskShareByKey.get(trustRiskShareKey(row));
    const ownership = isRisk ? riskShare?.ownership ?? null : null;
    return {
      findingKey: row.findingKey,
      entityId: row.entityId,
      ownership,
      differentiationIndex: isRisk ? riskShare?.differentiationIndex ?? null : null,
      dimensions: {
        trust_score: trustByEntity.get(row.entityId ?? "") ?? 50,
        risk_score: riskScore,
        severity_weight: severityWeight,
        escalating_weight: escalatingWeight,
        risk_theme_share_pct: isRisk ? riskShare?.sharePct ?? 0 : null,
        reputational_vulnerability: Boolean(isRisk && ownership && ownership !== "shared" && ownership !== "insufficient_evidence"),
        sensitive_risk_requires_evidence: Boolean(isRisk && severityWeight >= 3)
      }
    };
  });
}

export function scoreValuePerceptionMatrix(rows: ValuePerceptionInput[]): ValuePerceptionScore[] {
  const byCell = new Map<string, ValuePerceptionInput[]>();
  for (const row of rows) {
    const key = valueCellKey(row.dimensions);
    const bucket = byCell.get(key) ?? [];
    bucket.push(row);
    byCell.set(key, bucket);
  }

  const output: ValuePerceptionScore[] = [];
  for (const [, bucket] of byCell) {
    const total = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    const shares = bucket
      .map((row) => ({ row, sharePct: total > 0 ? round2((row.frequency / total) * 100) : 0 }))
      .sort((a, b) => b.sharePct - a.sharePct || b.row.frequency - a.row.frequency);
    const dominant = shares[0] ?? null;
    const runnerUp = shares[1] ?? null;
    const dominantShare = dominant?.sharePct ?? 0;
    const sharedByTie = Boolean(runnerUp && dominantShare - runnerUp.sharePct <= 5);
    const insufficient = total < 2 || dominantShare < 35;
    const noClearOwner = insufficient || sharedByTie;
    const whitespaceCandidate = total >= 30 && noClearOwner;

    for (const item of shares) {
      const maxOtherShare = shares
        .filter((peer) => peer.row.entityId !== item.row.entityId)
        .reduce((max, peer) => Math.max(max, peer.sharePct), 0);
      const isDominant = dominant?.row.entityId === item.row.entityId && dominant?.row.entityKind === item.row.entityKind;
      const ownership: Ownership = insufficient
        ? "insufficient_evidence"
        : sharedByTie
          ? "shared"
          : isDominant
            ? ownershipFromEntityKind(item.row.entityKind)
            : "shared";
      const perceivedWeight = perceivedValueWeight(item.row.dimensions.perceived_value);
      const intensity = item.row.intensity ?? 1;
      const sentimentLift = item.row.sentiment === null ? 1 : Math.max(0.3, 1 + item.row.sentiment);
      const valueScore = round2(item.row.frequency * perceivedWeight * Math.max(0.5, intensity) * sentimentLift);

      output.push({
        findingKey: item.row.findingKey,
        entityId: item.row.entityId,
        sharePct: item.sharePct,
        ownership,
        differentiationIndex: round3(item.sharePct / 100 - maxOtherShare / 100),
        dimensions: {
          value_ownership_share: item.sharePct,
          value_cell_total: total,
          value_score: valueScore,
          perceived_value_weight: perceivedWeight,
          whitespace_candidate: whitespaceCandidate,
          whitespace_status: whitespaceCandidate ? "candidate_requires_absence_evidence" : "not_whitespace",
          declared_vs_perceived: "perceived"
        }
      });
    }
  }

  return output;
}

export function scoreJourneyFrictionMapping(rows: JourneyFrictionInput[]): JourneyFrictionScore[] {
  const byCell = new Map<string, JourneyFrictionInput[]>();
  for (const row of rows) {
    const key = journeyCellKey(row.dimensions, row.entityId);
    const bucket = byCell.get(key) ?? [];
    bucket.push(row);
    byCell.set(key, bucket);
  }

  const output: JourneyFrictionScore[] = [];
  for (const [, bucket] of byCell) {
    const total = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    for (const row of bucket) {
      const intensity = row.intensity ?? 1;
      const polarity = stringValue(row.dimensions.polarity).toLowerCase();
      const isAccelerator = polarity === "accelerator";
      const baseScore = round2(row.frequency * Math.max(0.5, intensity));
      const chokeScore = isAccelerator ? 0 : baseScore;
      const acceleratorScore = isAccelerator ? baseScore : 0;
      const sharePct = total > 0 ? round2((row.frequency / total) * 100) : 0;
      const effort = removabilityEffort(row.dimensions.friction_type);
      const impact = removabilityImpact(chokeScore, acceleratorScore, intensity);

      output.push({
        findingKey: row.findingKey,
        entityId: row.entityId,
        sharePct,
        dimensions: {
          choke_score: chokeScore,
          accelerator_score: acceleratorScore,
          journey_cell_total: total,
          journey_cell_share_pct: sharePct,
          removability_effort: effort,
          removability_impact: impact,
          quick_win_candidate: Boolean(!isAccelerator && effort !== "high" && impact === "high"),
          impact_basis: "declared_or_inferred_from_corpus",
          removability_basis: "heuristic_directional_not_measured"
        }
      });
    }
  }

  return output;
}

export function scoreCategoryOpportunityMap(rows: CategoryOpportunityInput[]): CategoryOpportunityScore[] {
  const byNeed = new Map<string, CategoryOpportunityInput[]>();
  for (const row of rows) {
    const need = stringValue(row.dimensions.need) || row.findingKey || "uncategorized_need";
    const bucket = byNeed.get(need) ?? [];
    bucket.push(row);
    byNeed.set(need, bucket);
  }

  const output: CategoryOpportunityScore[] = [];
  for (const [, bucket] of byNeed) {
    const total = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    const demandStrength = round2(bucket.reduce((sum, row) => sum + demandStrengthFor(row), 0));
    const coverageScore = round3(weightedAverage(bucket.map((row) => ({
      value: coverageScoreFor(row.dimensions.coverage),
      weight: Math.max(1, row.frequency)
    }))));
    const urgency = Math.max(...bucket.map((row) => urgencyWeightFor(row.dimensions.urgency)), 0.5);
    const opportunityScore = round2(demandStrength * (1 - coverageScore) * urgency);
    const shares = bucket
      .map((row) => ({ row, sharePct: total > 0 ? round2((row.frequency / total) * 100) : 0 }))
      .sort((a, b) => b.sharePct - a.sharePct || b.row.frequency - a.row.frequency);
    const best = [...shares].sort((a, b) => {
      const sentimentDelta = (b.row.sentiment ?? 0) - (a.row.sentiment ?? 0);
      if (Math.abs(sentimentDelta) > 0.05) return sentimentDelta;
      return b.row.frequency - a.row.frequency;
    })[0] ?? null;

    for (const item of shares) {
      const maxOtherShare = shares
        .filter((peer) => peer.row.entityId !== item.row.entityId)
        .reduce((max, peer) => Math.max(max, peer.sharePct), 0);
      const ownsBestPosition = Boolean(best && best.row.entityId === item.row.entityId);
      output.push({
        findingKey: item.row.findingKey,
        entityId: item.row.entityId,
        sharePct: item.sharePct,
        ownership: ownsBestPosition ? ownershipFromEntityKind(item.row.entityKind) : "shared",
        differentiationIndex: round3(item.sharePct / 100 - maxOtherShare / 100),
        dimensions: {
          need_total: total,
          demand_strength_score: demandStrength,
          coverage_score: coverageScore,
          urgency_weight: urgency,
          opportunity_score: opportunityScore,
          best_positioned_entity_id: best?.row.entityId ?? null,
          coverage_evidence_status: coverageScore >= 0.49 && coverageScore <= 0.51
            ? "insufficient_coverage_evidence"
            : "coverage_evidence_present"
        }
      });
    }
  }
  return output;
}

export function scoreWhiteSpaceAnalysis(rows: WhiteSpaceInput[]): WhiteSpaceScore[] {
  const bySpace = new Map<string, WhiteSpaceInput[]>();
  for (const row of rows) {
    const space = stringValue(row.dimensions.demand) || row.findingKey || "uncategorized_space";
    const bucket = bySpace.get(space) ?? [];
    bucket.push(row);
    bySpace.set(space, bucket);
  }

  const output: WhiteSpaceScore[] = [];
  for (const [, bucket] of bySpace) {
    const total = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    for (const row of bucket) {
      const demandScore = round2(readNumber(row.dimensions.whitespace_score_hint) ?? demandStrengthFor(row));
      const coverage = competitiveCoverageScoreFor(row.dimensions.competitive_coverage);
      const permission = brandPermissionScoreFor(row.dimensions.brand_permission);
      const whitespaceScore = round2(demandScore * (1 - coverage) * permission);
      const sharePct = total > 0 ? round2((row.frequency / total) * 100) : 0;
      const classification = whitespaceClassification(coverage, permission);
      output.push({
        findingKey: row.findingKey,
        entityId: row.entityId,
        sharePct,
        dimensions: {
          demand_score: demandScore,
          competitive_coverage_score: coverage,
          brand_permission_score: permission,
          whitespace_score: whitespaceScore,
          whitespace_classification: classification,
          absence_evidence_status: coverage <= 0.35
            ? "directional_from_competitive_corpus"
            : coverage >= 0.49 && coverage <= 0.51
              ? "missing_absence_evidence"
              : "not_absence"
        }
      });
    }
  }
  return output;
}

export function scoreBrandPositioningMap(rows: BrandPositioningInput[]): BrandPositioningScore[] {
  const byEntity = new Map<string, BrandPositioningInput[]>();
  for (const row of rows) {
    const key = row.entityId ?? "";
    const bucket = byEntity.get(key) ?? [];
    bucket.push(row);
    byEntity.set(key, bucket);
  }

  const centers = new Map<string, { x: number; y: number; total: number; count: number }>();
  for (const [entityKey, bucket] of byEntity) {
    const weightedX = weightedAverage(bucket.map((row) => ({ value: axisX(row.dimensions), weight: positioningWeight(row) })));
    const weightedY = weightedAverage(bucket.map((row) => ({ value: axisY(row.dimensions), weight: positioningWeight(row) })));
    centers.set(entityKey, {
      x: round3(weightedX),
      y: round3(weightedY),
      total: bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0),
      count: bucket.length
    });
  }

  return rows.map((row) => {
    const key = row.entityId ?? "";
    const center = centers.get(key) ?? { x: 0, y: 0, total: 0, count: 0 };
    const axisPosition = axisPositionFor(row.dimensions);
    const nearest = nearestEntityDistance(key, center, centers);
    return {
      findingKey: row.findingKey,
      entityId: row.entityId,
      sharePct: center.total > 0 ? round2((row.frequency / center.total) * 100) : 0,
      dimensions: {
        axis_position: axisPosition,
        attribute_score: round2(positioningWeight(row) * Math.max(0.25, Math.abs(axisPosition))),
        perceptual_x: center.x,
        perceptual_y: center.y,
        nearest_entity_distance: nearest,
        entity_attribute_count: center.count,
        axis_defined: stringValue(row.dimensions.axis_pole).toLowerCase() !== "unclear",
        position_basis: "perceived_corpus_not_declared_positioning"
      }
    };
  });
}

export function scoreCulturalCodesDecoding(rows: CulturalCodesInput[]): CulturalCodesScore[] {
  const byCode = new Map<string, CulturalCodesInput[]>();
  for (const row of rows) {
    const key = row.findingKey || "uncategorized_code";
    const bucket = byCode.get(key) ?? [];
    bucket.push(row);
    byCode.set(key, bucket);
  }

  const oppositionTotals = new Map<string, number>();
  for (const row of rows) {
    const opposition = stringValue(row.dimensions.binary_opposition);
    if (!opposition) continue;
    oppositionTotals.set(opposition, (oppositionTotals.get(opposition) ?? 0) + row.frequency);
  }

  const output: CulturalCodesScore[] = [];
  for (const [, bucket] of byCode) {
    const total = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    const shares = bucket
      .map((row) => ({ row, sharePct: total > 0 ? round2((row.frequency / total) * 100) : 0 }))
      .sort((a, b) => b.sharePct - a.sharePct || b.row.frequency - a.row.frequency);
    const dominant = shares[0] ?? null;
    const runnerUp = shares[1] ?? null;
    const dominantShare = dominant?.sharePct ?? 0;
    const sharedByTie = Boolean(runnerUp && dominantShare - runnerUp.sharePct <= 5);
    const insufficient = total < 2 || dominantShare < 35;

    for (const item of shares) {
      const maxOtherShare = shares
        .filter((peer) => peer.row.entityId !== item.row.entityId)
        .reduce((max, peer) => Math.max(max, peer.sharePct), 0);
      const isDominant = dominant?.row.entityId === item.row.entityId && dominant?.row.entityKind === item.row.entityKind;
      const ownership: Ownership = insufficient
        ? "insufficient_evidence"
        : sharedByTie
          ? "shared"
          : isDominant
            ? ownershipFromEntityKind(item.row.entityKind)
            : "shared";
      const maturity = culturalMaturityWeight(item.row.dimensions.maturity);
      const culturalIntensity = round2(item.row.frequency * Math.max(0.5, item.row.intensity ?? 1) * maturity);
      const opposition = stringValue(item.row.dimensions.binary_opposition);
      const oppositionTotal = opposition ? oppositionTotals.get(opposition) ?? total : total;

      output.push({
        findingKey: item.row.findingKey,
        entityId: item.row.entityId,
        sharePct: item.sharePct,
        ownership,
        differentiationIndex: round3(item.sharePct / 100 - maxOtherShare / 100),
        dimensions: {
          code_total: total,
          entity_code_share_pct: item.sharePct,
          cultural_intensity: culturalIntensity,
          maturity_weight: maturity,
          tension_score: round2((oppositionTotal / Math.max(1, rows.length)) * maturity),
          cultural_level_present: Boolean(stringValue(item.row.dimensions.code_level) || stringValue(item.row.dimensions.signification_level)),
          opposition_present: Boolean(opposition),
          long_text_evidence_status: culturalCodeRequiresLongText(item.row.dimensions)
            ? "requires_source_validation"
            : "not_required_for_surface"
        }
      });
    }
  }
  return output;
}

export function scoreCompetitiveWave(rows: CompetitiveWaveInput[]): CompetitiveWaveScore[] {
  const byEntity = new Map<string, CompetitiveWaveInput[]>();
  for (const row of rows) {
    const key = row.entityId ?? "";
    const bucket = byEntity.get(key) ?? [];
    bucket.push(row);
    byEntity.set(key, bucket);
  }

  const rawAxis = new Map<string, CompetitiveWaveAxisScores>();
  const entityTotals = new Map<string, number>();
  for (const [entityKey, bucket] of byEntity) {
    const totals: CompetitiveWaveAxisScores = {
      resonance: 0,
      cultural_ownership: 0,
      sentiment: 0,
      decision_velocity: 0,
      differentiation: 0
    };
    for (const row of bucket) {
      const axis = waveAxis(row.dimensions.axis);
      totals[axis] += row.frequency * Math.max(0.5, row.intensity ?? 1) * directionWeight(row.dimensions.direction);
      if (row.sentiment !== null) totals.sentiment += row.frequency * Math.max(0, 1 + row.sentiment);
    }
    rawAxis.set(entityKey, totals);
    entityTotals.set(entityKey, bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0));
  }

  const normalized = new Map<string, CompetitiveWaveAxisScores>();
  for (const entityKey of rawAxis.keys()) {
    normalized.set(entityKey, {
      resonance: normalizeAxis(entityKey, "resonance", rawAxis),
      cultural_ownership: normalizeAxis(entityKey, "cultural_ownership", rawAxis),
      sentiment: normalizeAxis(entityKey, "sentiment", rawAxis),
      decision_velocity: normalizeAxis(entityKey, "decision_velocity", rawAxis),
      differentiation: normalizeAxis(entityKey, "differentiation", rawAxis)
    });
  }

  const entityCount = Array.from(byEntity.keys()).filter((key) => key).length;
  return rows.map((row) => {
    const entityKey = row.entityId ?? "";
    const scores: CompetitiveWaveAxisScores = normalized.get(entityKey) ?? {
      resonance: 50,
      cultural_ownership: 50,
      sentiment: 50,
      decision_velocity: 50,
      differentiation: 50
    };
    const x = round2((scores.resonance + scores.sentiment) / 2);
    const y = round2((scores.cultural_ownership + scores.differentiation + scores.decision_velocity) / 3);
    const total = entityTotals.get(entityKey) ?? 0;
    return {
      findingKey: row.findingKey,
      entityId: row.entityId,
      sharePct: total > 0 ? round2((row.frequency / total) * 100) : 0,
      dimensions: {
        axis_score: scores[waveAxis(row.dimensions.axis)],
        resonance_score: scores.resonance,
        cultural_ownership_score: scores.cultural_ownership,
        sentiment_score: scores.sentiment,
        decision_velocity_score: scores.decision_velocity,
        differentiation_score: scores.differentiation,
        wave_x: x,
        wave_y: y,
        wave_zone: entityCount >= 3 ? waveZone(x, y) : "directional",
        entity_volume: total,
        wave_entity_count: entityCount,
        wave_publishable: entityCount >= 3
      }
    };
  });
}

export function scoreAudienceSegmentLens(rows: AudienceSegmentInput[]): AudienceSegmentScore[] {
  const bySegment = new Map<string, AudienceSegmentInput[]>();
  const byEntity = new Map<string, number>();
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
  for (const row of rows) {
    const segment = stringValue(row.dimensions.segment) || "unsegmented";
    const bucket = bySegment.get(segment) ?? [];
    bucket.push(row);
    bySegment.set(segment, bucket);
    const entityKey = row.entityId ?? "";
    byEntity.set(entityKey, (byEntity.get(entityKey) ?? 0) + row.frequency);
  }

  const output: AudienceSegmentScore[] = [];
  for (const [, bucket] of bySegment) {
    const segmentTotal = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    for (const row of bucket) {
      const entityKey = row.entityId ?? "";
      const segmentEntityShare = segmentTotal > 0 ? round2((row.frequency / segmentTotal) * 100) : 0;
      const overallEntityShare = total > 0 ? round2(((byEntity.get(entityKey) ?? 0) / total) * 100) : 0;
      const metricValue = round2(row.frequency * Math.max(0.5, row.intensity ?? 1) * sentimentDirection(row));
      output.push({
        findingKey: row.findingKey,
        entityId: row.entityId,
        sharePct: segmentEntityShare,
        dimensions: {
          segment_cell_total: segmentTotal,
          segment_entity_share_pct: segmentEntityShare,
          segment_skew: round2(segmentEntityShare - overallEntityShare),
          segment_metric_value: metricValue,
          segment_source: stringValue(row.dimensions.segment) ? "declared_or_metadata_or_coded" : "missing",
          sensitive_inference_used: Boolean(row.dimensions.sensitive_inference_used)
        }
      });
    }
  }
  return output;
}

export function scoreInfluenceArchitecture(rows: InfluenceArchitectureInput[]): InfluenceArchitectureScore[] {
  const byCommunity = new Map<string, InfluenceArchitectureInput[]>();
  for (const row of rows) {
    const community = stringValue(row.dimensions.community) || stringValue(row.dimensions.community_cluster) || "unmapped_community";
    const bucket = byCommunity.get(community) ?? [];
    bucket.push(row);
    byCommunity.set(community, bucket);
  }

  const output: InfluenceArchitectureScore[] = [];
  for (const [, bucket] of byCommunity) {
    const communityTotal = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    for (const row of bucket) {
      const roleWeight = influenceRoleWeight(row.dimensions.node_role ?? row.dimensions.node_type);
      output.push({
        findingKey: row.findingKey,
        entityId: row.entityId,
        sharePct: communityTotal > 0 ? round2((row.frequency / communityTotal) * 100) : 0,
        dimensions: {
          influence_score: round2(row.frequency * Math.max(0.5, row.intensity ?? 1) * roleWeight),
          role_weight: roleWeight,
          community_total: communityTotal,
          graph_centrality_available: false,
          author_metadata_status: "required_for_real_graph",
          influence_basis: "coded_mentions_not_network_graph"
        }
      });
    }
  }
  return output;
}

export function scoreDecisionVelocity(rows: DecisionVelocityInput[]): DecisionVelocityScore[] {
  const byPhaseEntity = new Map<string, DecisionVelocityInput[]>();
  for (const row of rows) {
    const key = decisionPhaseEntityKey(row);
    const bucket = byPhaseEntity.get(key) ?? [];
    bucket.push(row);
    byPhaseEntity.set(key, bucket);
  }

  const output: DecisionVelocityScore[] = [];
  for (const [, bucket] of byPhaseEntity) {
    const phaseBlockers = bucket
      .filter((row) => stringValue(row.dimensions.polarity) === "blocker")
      .reduce((sum, row) => sum + decisionFactorScore(row), 0);
    const phaseAccelerators = bucket
      .filter((row) => stringValue(row.dimensions.polarity) === "accelerator")
      .reduce((sum, row) => sum + decisionFactorScore(row), 0);
    const phaseTotal = phaseBlockers + phaseAccelerators;
    const velocityIndex = phaseTotal > 0 ? round2(((phaseAccelerators - phaseBlockers) / phaseTotal) * 100) : 0;

    for (const row of bucket) {
      const score = decisionFactorScore(row);
      const isAccelerator = stringValue(row.dimensions.polarity) === "accelerator";
      output.push({
        findingKey: row.findingKey,
        entityId: row.entityId,
        sharePct: phaseTotal > 0 ? round2((score / phaseTotal) * 100) : 0,
        dimensions: {
          blocker_score: isAccelerator ? 0 : score,
          accelerator_score: isAccelerator ? score : 0,
          phase_blocker_score: round2(phaseBlockers),
          phase_accelerator_score: round2(phaseAccelerators),
          velocity_index: velocityIndex,
          measured_vs_inferred: "inferred_from_corpus",
          benchmark_status: "benchmark_required_for_publication",
          ab_hypothesis_status: "requires_experiment"
        }
      });
    }
  }
  return output;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const totalWeight = values.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (totalWeight <= 0) return 0;
  return values.reduce((sum, item) => sum + item.value * Math.max(0, item.weight), 0) / totalWeight;
}

function ownershipFromEntityKind(entityKind: string | null): Ownership {
  if (entityKind === "primary_brand" || entityKind === "brand") return "brand_owned";
  if (entityKind === "competitor" || entityKind === "competitor_pool") return "competitor_owned";
  if (entityKind === "category" || entityKind === "industry") return "category_wide";
  return "shared";
}

function advocacyClass(row: SentimentAdvocacyInput): "promoter" | "passive" | "detractor" {
  const explicit = stringValue(row.dimensions.advocacy_class).toLowerCase();
  if (explicit === "promoter" || explicit === "passive" || explicit === "detractor") return explicit;
  const sentimentLabel = stringValue(row.dimensions.sentiment).toLowerCase();
  if (sentimentLabel === "positive" || sentimentLabel === "positiva") return "promoter";
  if (sentimentLabel === "negative" || sentimentLabel === "negativa") return "detractor";
  if (row.sentiment !== null) {
    if (row.sentiment >= 0.35) return "promoter";
    if (row.sentiment <= -0.25) return "detractor";
  }
  return "passive";
}

function buildRiskThemeShares(rows: TrustRiskInput[]) {
  const byTheme = new Map<string, TrustRiskInput[]>();
  for (const row of rows) {
    const theme = stringValue(row.dimensions.risk_theme);
    if (!theme) continue;
    const bucket = byTheme.get(theme) ?? [];
    bucket.push(row);
    byTheme.set(theme, bucket);
  }

  const output = new Map<string, {
    sharePct: number;
    ownership: Ownership;
    differentiationIndex: number;
  }>();
  for (const [theme, bucket] of byTheme) {
    const total = bucket.reduce((sum, row) => sum + Math.max(0, row.frequency), 0);
    const shares = bucket
      .map((row) => ({ row, sharePct: total > 0 ? round2((row.frequency / total) * 100) : 0 }))
      .sort((a, b) => b.sharePct - a.sharePct || b.row.frequency - a.row.frequency);
    const dominant = shares[0] ?? null;
    const runnerUp = shares[1] ?? null;
    const dominantShare = dominant?.sharePct ?? 0;
    const sharedByTie = Boolean(runnerUp && dominantShare - runnerUp.sharePct <= 5);
    const insufficient = total < 2 || dominantShare < 35;

    for (const item of shares) {
      const maxOtherShare = shares
        .filter((peer) => peer.row.entityId !== item.row.entityId)
        .reduce((max, peer) => Math.max(max, peer.sharePct), 0);
      const isDominant = dominant?.row.entityId === item.row.entityId && dominant?.row.entityKind === item.row.entityKind;
      const ownership: Ownership = insufficient
        ? "insufficient_evidence"
        : sharedByTie
          ? "shared"
          : isDominant
            ? ownershipFromEntityKind(item.row.entityKind)
            : "shared";
      output.set(trustRiskShareKey({ ...item.row, dimensions: { ...item.row.dimensions, risk_theme: theme } }), {
        sharePct: item.sharePct,
        ownership,
        differentiationIndex: round3(item.sharePct / 100 - maxOtherShare / 100)
      });
    }
  }
  return output;
}

function trustRiskShareKey(row: Pick<TrustRiskInput, "entityId" | "dimensions">) {
  return `${stringValue(row.dimensions.risk_theme)}::${row.entityId ?? ""}`;
}

function severityWeightFor(value: unknown) {
  const severity = stringValue(value).toLowerCase();
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function valueCellKey(dimensions: Record<string, unknown>) {
  const benefit = stringValue(dimensions.value_benefit) || "unclear_benefit";
  const cost = stringValue(dimensions.value_cost) || "unclear_cost";
  return `${benefit}::${cost}`;
}

function journeyCellKey(dimensions: Record<string, unknown>, entityId: string | null) {
  const phase = stringValue(dimensions.journey_phase) || "unmapped_phase";
  const frictionType = stringValue(dimensions.friction_type) || "unmapped_friction";
  return `${entityId ?? ""}::${phase}::${frictionType}`;
}

function removabilityEffort(value: unknown): "low" | "medium" | "high" {
  const friction = stringValue(value).toLowerCase();
  if (friction === "informational" || friction === "access") return "low";
  if (friction === "effort" || friction === "economic" || friction === "trust") return "high";
  return "medium";
}

function removabilityImpact(chokeScore: number, acceleratorScore: number, intensity: number): "low" | "medium" | "high" {
  const score = Math.max(chokeScore, acceleratorScore);
  if (score >= 120 || intensity >= 4) return "high";
  if (score >= 40 || intensity >= 2.5) return "medium";
  return "low";
}

function perceivedValueWeight(value: unknown) {
  const perceived = stringValue(value).toLowerCase();
  if (perceived === "high") return 3;
  if (perceived === "medium") return 2;
  if (perceived === "low") return 1;
  return 0.5;
}

function demandStrengthFor(row: { frequency: number; intensity: number | null; dimensions: Record<string, unknown> }) {
  return readNumber(row.dimensions.demand_strength) ?? row.frequency * Math.max(0.5, row.intensity ?? 1);
}

function coverageScoreFor(value: unknown) {
  const coverage = stringValue(value).toLowerCase();
  if (coverage === "unserved") return 0.05;
  if (coverage === "underserved") return 0.25;
  if (coverage === "served") return 0.65;
  if (coverage === "overcrowded") return 0.9;
  return 0.5;
}

function urgencyWeightFor(value: unknown) {
  const urgency = stringValue(value).toLowerCase();
  if (urgency === "high") return 1.5;
  if (urgency === "medium") return 1;
  if (urgency === "low") return 0.65;
  return 0.8;
}

function competitiveCoverageScoreFor(value: unknown) {
  const coverage = stringValue(value).toLowerCase();
  if (coverage === "low") return 0.15;
  if (coverage === "medium") return 0.45;
  if (coverage === "high") return 0.85;
  return 0.5;
}

function brandPermissionScoreFor(value: unknown) {
  const permission = stringValue(value).toLowerCase();
  if (permission === "strong") return 1;
  if (permission === "moderate") return 0.65;
  if (permission === "weak") return 0.25;
  if (permission === "none") return 0.05;
  return 0.2;
}

function whitespaceClassification(coverage: number, permission: number): "capturable" | "aspirational" | "defend" | "not_whitespace" {
  if (coverage <= 0.35 && permission >= 0.6) return "capturable";
  if (coverage <= 0.35 && permission < 0.6) return "aspirational";
  if (coverage >= 0.75 && permission >= 0.8) return "defend";
  return "not_whitespace";
}

function positioningWeight(row: BrandPositioningInput) {
  const sentimentLift = row.sentiment === null ? 1 : Math.max(0.25, 1 + row.sentiment);
  return row.frequency * Math.max(0.5, row.intensity ?? 1) * sentimentLift;
}

function axisPositionFor(dimensions: Record<string, unknown>) {
  const explicit = readNumber(dimensions.axis_value);
  if (explicit !== null) {
    if (Math.abs(explicit) <= 1) return round3(explicit);
    return round3(Math.max(-1, Math.min(1, explicit / 100)));
  }
  return round3(axisX(dimensions) || axisY(dimensions));
}

function axisX(dimensions: Record<string, unknown>) {
  const pole = stringValue(dimensions.axis_pole).toLowerCase();
  if (pole === "premium" || pole === "technical") return 1;
  if (pole === "accessible" || pole === "human") return -1;
  return 0;
}

function axisY(dimensions: Record<string, unknown>) {
  const pole = stringValue(dimensions.axis_pole).toLowerCase();
  if (pole === "innovative" || pole === "human") return 1;
  if (pole === "traditional" || pole === "technical") return -1;
  return 0;
}

function nearestEntityDistance(
  entityKey: string,
  center: { x: number; y: number },
  centers: Map<string, { x: number; y: number }>
) {
  const distances = Array.from(centers.entries())
    .filter(([key]) => key !== entityKey)
    .map(([, other]) => Math.sqrt((center.x - other.x) ** 2 + (center.y - other.y) ** 2))
    .sort((a, b) => a - b);
  return distances[0] === undefined ? null : round3(distances[0]);
}

function culturalMaturityWeight(value: unknown) {
  const maturity = stringValue(value).toLowerCase();
  if (maturity === "dominant" || maturity === "mainstreaming") return 1.35;
  if (maturity === "active" || maturity === "acelerando") return 1.15;
  if (maturity === "nascent" || maturity === "emergente") return 1;
  if (maturity === "declining") return 0.65;
  return 0.85;
}

function culturalCodeRequiresLongText(dimensions: Record<string, unknown>) {
  const level = stringValue(dimensions.code_level || dimensions.signification_level).toLowerCase();
  return level === "deep" || level === "mitico" || level === "estructural";
}

function waveAxis(value: unknown): CompetitiveWaveAxis {
  const axis = stringValue(value).toLowerCase();
  if (axis === "cultural_ownership" || axis === "sentiment" || axis === "decision_velocity" || axis === "differentiation") return axis;
  return "resonance";
}

function directionWeight(value: unknown) {
  const direction = stringValue(value).toLowerCase();
  if (direction === "negative") return 0.35;
  if (direction === "mixed") return 0.7;
  return 1;
}

function normalizeAxis(entityKey: string, axis: CompetitiveWaveAxis, rawAxis: Map<string, CompetitiveWaveAxisScores>) {
  const values = Array.from(rawAxis.values()).map((record) => record[axis] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const value = rawAxis.get(entityKey)?.[axis] ?? 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return 50;
  return round2(((value - min) / (max - min)) * 100);
}

function waveZone(x: number, y: number): "leader" | "challenger" | "niche" | "emerging" {
  if (x >= 60 && y >= 60) return "leader";
  if (x >= 60 && y < 60) return "challenger";
  if (x < 60 && y >= 60) return "niche";
  return "emerging";
}

function sentimentDirection(row: { sentiment: number | null; dimensions: Record<string, unknown> }) {
  const polarity = stringValue(row.dimensions.polarity).toLowerCase();
  if (polarity === "negative") return -1;
  if (polarity === "positive") return 1;
  return row.sentiment ?? 0.5;
}

function influenceRoleWeight(value: unknown) {
  const role = stringValue(value).toLowerCase();
  if (role === "architect" || role === "originator" || role === "authority") return 1.5;
  if (role === "translator" || role === "bridge") return 1.35;
  if (role === "validator" || role === "amplifier") return 1.15;
  if (role === "critic" || role === "skeptic") return 1.1;
  return 1;
}

function decisionPhaseEntityKey(row: Pick<DecisionVelocityInput, "entityId" | "dimensions">) {
  const phase = stringValue(row.dimensions.decision_phase) || "unmapped_phase";
  return `${row.entityId ?? ""}::${phase}`;
}

function decisionFactorScore(row: DecisionVelocityInput) {
  return round2(row.frequency * Math.max(0.5, row.intensity ?? 1) * cognitiveSystemWeight(row.dimensions.cognitive_system));
}

function cognitiveSystemWeight(value: unknown) {
  const system = stringValue(value).toLowerCase();
  if (system === "system_1" || system === "sistema_1" || system === "habit" || system === "social_proof") return 1.15;
  if (system === "system_2" || system === "sistema_2") return 1;
  return 0.85;
}

function escalatingWeightFor(value: unknown) {
  const escalating = stringValue(value).toLowerCase();
  if (escalating === "yes" || escalating === "true") return 1.5;
  if (escalating === "unclear" || escalating === "unknown") return 1.1;
  return 1;
}

function clamp100(value: number) {
  if (!Number.isFinite(value)) return 50;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function variance01(values: number[]) {
  if (values.length <= 1) return 0;
  const avg = average(values);
  const variance = average(values.map((value) => (value - avg) ** 2));
  return Math.max(0, Math.min(1, variance));
}

function newestAgeMonths(values: Array<Date | string | null>) {
  const newest = values
    .map((value) => value ? new Date(value).getTime() : 0)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)[0];
  if (!newest) return 99;
  return Math.max(0, (Date.now() - newest) / (1000 * 60 * 60 * 24 * 30));
}

function minDate(values: Array<Date | string | null>) {
  const timestamp = values.map((value) => value ? new Date(value).getTime() : 0).filter((value) => value > 0).sort((a, b) => a - b)[0];
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function maxDate(values: Array<Date | string | null>) {
  const timestamp = values.map((value) => value ? new Date(value).getTime() : 0).filter((value) => value > 0).sort((a, b) => b - a)[0];
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
