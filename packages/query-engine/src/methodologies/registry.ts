import type { EngineMethodologySlug, EngineMethodologySpec } from "../engine";
import { audienceSegmentLens } from "./audience-segment-lens";
import { brandPositioningMap } from "./brand-positioning-map";
import { categoryOpportunityMap } from "./category-opportunity-map";
import { competitiveTbMatrix } from "./competitive-tb-matrix";
import { competitiveWave } from "./competitive-wave";
import { culturalCodesDecoding } from "./cultural-codes-decoding";
import { decisionVelocity } from "./decision-velocity";
import { evidenceConfidenceLayer } from "./evidence-confidence-layer";
import { influenceArchitecture } from "./influence-architecture";
import { journeyFrictionMapping } from "./journey-friction-mapping";
import { narrativeOwnership } from "./narrative-ownership";
import { sentimentAdvocacyProxy } from "./sentiment-advocacy-proxy";
import { trustRiskBenchmark } from "./trust-risk-benchmark";
import { valuePerceptionMatrix } from "./value-perception-matrix";
import { whiteSpaceAnalysis } from "./white-space-analysis";

export const engineMethodologySpecs = [
  competitiveWave,
  valuePerceptionMatrix,
  journeyFrictionMapping,
  culturalCodesDecoding,
  influenceArchitecture,
  decisionVelocity,
  sentimentAdvocacyProxy,
  brandPositioningMap,
  categoryOpportunityMap,
  competitiveTbMatrix,
  narrativeOwnership,
  whiteSpaceAnalysis,
  audienceSegmentLens,
  trustRiskBenchmark,
  evidenceConfidenceLayer
] satisfies EngineMethodologySpec[];

export const engineMethodologyRegistry: Record<EngineMethodologySlug, EngineMethodologySpec> =
  Object.fromEntries(engineMethodologySpecs.map((spec) => [spec.slug, spec])) as Record<EngineMethodologySlug, EngineMethodologySpec>;

export function getEngineMethodologySpec(slug: EngineMethodologySlug): EngineMethodologySpec {
  return engineMethodologyRegistry[slug];
}
