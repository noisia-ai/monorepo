import type { EngineRunnableMethodologySlug } from "@noisia/query-engine";
import type { SignalModuleKey } from "@/lib/signal/manifest";

export type EngineMethodologySeedRow = {
  slug: string;
  status: string | null;
  version: string | null;
};

export type EngineMethodologyOption = {
  slug: string;
  label: string;
  shortLabel: string;
  priority: string;
  runtimeKind: "engine" | "output_only";
  seeded: boolean;
  status: string;
  version: string | null;
  runnable: boolean;
};

export const ENGINE_BETA_METHODOLOGY_OPTIONS = [
  { slug: "competitive-wave", label: "#02 Competitive Wave", shortLabel: "Competitive Wave", priority: "#02", runtimeKind: "engine" },
  { slug: "value-perception-matrix", label: "#03 VPM", shortLabel: "VPM", priority: "#03", runtimeKind: "engine" },
  { slug: "journey-friction-mapping", label: "#04 JFM", shortLabel: "JFM", priority: "#04", runtimeKind: "engine" },
  { slug: "cultural-codes-decoding", label: "#05 Cultural Codes", shortLabel: "Cultural Codes", priority: "#05", runtimeKind: "engine" },
  { slug: "influence-architecture", label: "#06 Influence Architecture", shortLabel: "Influence Architecture", priority: "#06", runtimeKind: "engine" },
  { slug: "decision-velocity", label: "#07 Decision Velocity", shortLabel: "Decision Velocity", priority: "#07", runtimeKind: "engine" },
  { slug: "sentiment-advocacy-proxy", label: "#08 Sentiment / Advocacy Proxy", shortLabel: "Sentiment / Advocacy", priority: "#08", runtimeKind: "engine" },
  { slug: "brand-positioning-map", label: "#09 Brand Positioning", shortLabel: "Brand Positioning", priority: "#09", runtimeKind: "engine" },
  { slug: "category-opportunity-map", label: "#10 Category Opportunity", shortLabel: "Category Opportunity", priority: "#10", runtimeKind: "engine" },
  { slug: "competitive-tb-matrix", label: "#11 Competitive T/B Matrix", shortLabel: "Competitive T/B Matrix", priority: "#11", runtimeKind: "output_only" },
  { slug: "narrative-ownership", label: "#12 Narrative Ownership", shortLabel: "Narrative Ownership", priority: "#12", runtimeKind: "engine" },
  { slug: "white-space-analysis", label: "#13 White Space", shortLabel: "White Space", priority: "#13", runtimeKind: "engine" },
  { slug: "audience-segment-lens", label: "#14 Audience Segment Lens", shortLabel: "Audience Segment", priority: "#14", runtimeKind: "engine" },
  { slug: "trust-risk-benchmark", label: "#15 Trust & Risk Benchmark", shortLabel: "Trust & Risk", priority: "#15", runtimeKind: "engine" },
  { slug: "evidence-confidence-layer", label: "#16 Confidence Layer", shortLabel: "Confidence Layer", priority: "#16", runtimeKind: "engine" }
] as const;

export const ENGINE_SHADOW_METHODOLOGY_OPTIONS = [] as const;

export const ACTIVE_ENGINE_RUNTIME_SLUGS = ENGINE_BETA_METHODOLOGY_OPTIONS
  .filter((option) => option.runtimeKind === "engine")
  .map((option) => option.slug) as EngineRunnableMethodologySlug[];

const activeEngineRuntimeSlugSet = new Set<string>(ACTIVE_ENGINE_RUNTIME_SLUGS);

const engineMethodologyModuleKeyMap: Record<EngineRunnableMethodologySlug, SignalModuleKey> = {
  "competitive-wave": "competitive_wave",
  "narrative-ownership": "narrative_ownership",
  "value-perception-matrix": "value_perception",
  "brand-positioning-map": "brand_positioning",
  "category-opportunity-map": "category_opportunity",
  "white-space-analysis": "white_space",
  "journey-friction-mapping": "journey_friction",
  "decision-velocity": "decision_velocity",
  "cultural-codes-decoding": "cultural_codes",
  "sentiment-advocacy-proxy": "advocacy_proxy",
  "audience-segment-lens": "audience_segment",
  "influence-architecture": "influence_architecture",
  "trust-risk-benchmark": "trust_risk",
  "evidence-confidence-layer": "evidence_confidence"
};

const engineMethodologyComposerModuleMap: Record<EngineRunnableMethodologySlug, SignalModuleKey[]> = {
  "competitive-wave": ["live_composer", "competitive_wave", "competitive_intelligence"],
  "narrative-ownership": ["live_composer", "narrative_ownership", "competitive_intelligence"],
  "value-perception-matrix": ["live_composer", "value_perception", "opportunities"],
  "brand-positioning-map": ["live_composer", "brand_positioning", "competitive_intelligence"],
  "category-opportunity-map": ["live_composer", "category_opportunity", "opportunities"],
  "white-space-analysis": ["live_composer", "white_space", "opportunities"],
  "journey-friction-mapping": ["live_composer", "journey_friction", "action_studio"],
  "decision-velocity": ["live_composer", "decision_velocity", "action_studio"],
  "cultural-codes-decoding": ["live_composer", "cultural_codes", "emerging_patterns"],
  "sentiment-advocacy-proxy": ["live_composer", "advocacy_proxy", "quality_boundaries"],
  "audience-segment-lens": ["live_composer", "audience_segment", "quality_boundaries"],
  "influence-architecture": ["live_composer", "influence_architecture", "competitive_intelligence"],
  "trust-risk-benchmark": ["live_composer", "trust_risk", "competitive_intelligence"],
  "evidence-confidence-layer": ["live_composer", "evidence_confidence", "evidence", "quality_boundaries"]
};

const baseEngineOutputManifest: Record<SignalModuleKey, boolean> = {
  overview: true,
  live_composer: true,
  engine_methodology: false,
  competitive_wave: false,
  narrative_ownership: false,
  value_perception: false,
  brand_positioning: false,
  category_opportunity: false,
  white_space: false,
  journey_friction: false,
  decision_velocity: false,
  cultural_codes: false,
  advocacy_proxy: false,
  audience_segment: false,
  influence_architecture: false,
  trust_risk: false,
  evidence_confidence: false,
  tb_decision_field: false,
  opportunities: false,
  competitive_intelligence: false,
  tb_comparative_dashboard: false,
  competitive_tb_matrix: false,
  action_studio: false,
  evidence: true,
  quality_boundaries: false,
  emerging_patterns: false,
  corpus_view: true,
  corpus_chat: false
};

export function isActiveEngineRuntimeSlug(slug: string): slug is EngineRunnableMethodologySlug {
  return activeEngineRuntimeSlugSet.has(slug);
}

export function engineModuleKeyForMethodology(slug: string): SignalModuleKey | null {
  return isActiveEngineRuntimeSlug(slug) ? engineMethodologyModuleKeyMap[slug] : null;
}

export function buildEngineOutputManifestForMethodology(slug: string): Partial<Record<SignalModuleKey, boolean>> {
  if (!isActiveEngineRuntimeSlug(slug)) {
    return { ...baseEngineOutputManifest, engine_methodology: false };
  }
  const manifest = { ...baseEngineOutputManifest };
  for (const moduleKey of engineMethodologyComposerModuleMap[slug]) {
    manifest[moduleKey] = true;
  }
  return manifest;
}

export function buildEngineMethodologyOptions(rows: EngineMethodologySeedRow[] = []): EngineMethodologyOption[] {
  const rowsBySlug = new Map(rows.map((row) => [row.slug, row]));

  return ENGINE_BETA_METHODOLOGY_OPTIONS.map((option) => {
    const row = rowsBySlug.get(option.slug);
    const status = row?.status ?? "missing";
    return {
      ...option,
      runtimeKind: option.runtimeKind,
      seeded: Boolean(row),
      status,
      version: row?.version ?? null,
      runnable: option.runtimeKind === "engine" && status === "beta"
    };
  });
}

export function getDefaultEngineMethodologySlug(options: EngineMethodologyOption[] = buildEngineMethodologyOptions()) {
  return options.find((option) => option.runnable)?.slug ?? "competitive-wave";
}

export function isEngineBetaPanelEnabled(env: {
  NODE_ENV?: string;
  NOISIA_SHOW_ENGINE_BETA_PANEL?: string;
} = process.env): boolean {
  return env.NODE_ENV !== "production" && env.NOISIA_SHOW_ENGINE_BETA_PANEL === "true";
}
