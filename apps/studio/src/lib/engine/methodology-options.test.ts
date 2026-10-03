import assert from "node:assert/strict";
import test from "node:test";

import { ENGINE_METHODOLOGY_SLUGS, ENGINE_READ_ONLY_OUTPUT_SLUGS } from "@noisia/query-engine";
import {
  ACTIVE_ENGINE_RUNTIME_SLUGS,
  ENGINE_BETA_METHODOLOGY_OPTIONS,
  ENGINE_SHADOW_METHODOLOGY_OPTIONS,
  buildEngineOutputManifestForMethodology,
  buildEngineMethodologyOptions,
  engineModuleKeyForMethodology,
  getDefaultEngineMethodologySlug,
  isEngineBetaPanelEnabled
} from "./methodology-options";

test("engine beta methodology UI exposes every runnable engine lens plus cheap outputs", () => {
  assert.deepEqual(
    ENGINE_BETA_METHODOLOGY_OPTIONS.map((option) => option.slug),
    [
      "competitive-wave",
      "value-perception-matrix",
      "journey-friction-mapping",
      "cultural-codes-decoding",
      "influence-architecture",
      "decision-velocity",
      "sentiment-advocacy-proxy",
      "brand-positioning-map",
      "category-opportunity-map",
      "competitive-tb-matrix",
      "narrative-ownership",
      "white-space-analysis",
      "audience-segment-lens",
      "trust-risk-benchmark",
      "evidence-confidence-layer"
    ]
  );
});

test("all engine specs are accounted for and no runnable lens stays in shadow", () => {
  const activeSlugs = new Set<string>(ENGINE_BETA_METHODOLOGY_OPTIONS.map((option) => option.slug));
  const shadowSlugs = new Set<string>((ENGINE_SHADOW_METHODOLOGY_OPTIONS as readonly { slug: string }[]).map((option) => option.slug));

  assert.deepEqual(
    [...activeSlugs, ...shadowSlugs].sort(),
    [...ENGINE_METHODOLOGY_SLUGS].sort()
  );
  assert.deepEqual([...shadowSlugs], []);
  assert.equal([...ENGINE_METHODOLOGY_SLUGS].every((slug) => activeSlugs.has(slug)), true);
});

test("technical beta defaults to the first runnable methodology, not Narrative Ownership", () => {
  const options = buildEngineMethodologyOptions([
    { slug: "narrative-ownership", status: "beta", version: "0.1" },
    { slug: "sentiment-advocacy-proxy", status: "beta", version: "0.1" },
    { slug: "competitive-tb-matrix", status: "beta", version: "0.1" }
  ]);

  assert.equal(getDefaultEngineMethodologySlug(options), "sentiment-advocacy-proxy");
  assert.equal(options.find((option) => option.slug === "narrative-ownership")?.runnable, true);
});

test("technical beta panel stays unavailable in production even when its flag is set", () => {
  assert.equal(isEngineBetaPanelEnabled({ NODE_ENV: "production", NOISIA_SHOW_ENGINE_BETA_PANEL: "true" }), false);
  assert.equal(isEngineBetaPanelEnabled({ NODE_ENV: "development", NOISIA_SHOW_ENGINE_BETA_PANEL: "false" }), false);
  assert.equal(isEngineBetaPanelEnabled({ NODE_ENV: "development", NOISIA_SHOW_ENGINE_BETA_PANEL: "true" }), true);
});

test("read-only T&B outputs and unseeded methods are not runnable from engine beta", () => {
  const options = buildEngineMethodologyOptions([
    { slug: "competitive-tb-matrix", status: "beta", version: "0.1" }
  ]);
  const matrix = options.find((option) => option.slug === ENGINE_READ_ONLY_OUTPUT_SLUGS[0]);
  const narrative = options.find((option) => option.slug === "narrative-ownership");

  assert.equal(matrix?.runtimeKind, "output_only");
  assert.equal(matrix?.runnable, false);
  assert.equal(narrative?.status, "missing");
  assert.equal(narrative?.runnable, false);
});

test("engine output manifest enables the method-specific Signal module for every active lens", () => {
  const expectedModules = {
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
  } as const;
  const methodSpecificKeys = [
    "competitive_wave",
    "narrative_ownership",
    "value_perception",
    "brand_positioning",
    "category_opportunity",
    "white_space",
    "journey_friction",
    "decision_velocity",
    "cultural_codes",
    "advocacy_proxy",
    "audience_segment",
    "influence_architecture",
    "trust_risk",
    "evidence_confidence"
  ] as const;
  const contextualKeys = ["opportunities", "competitive_intelligence", "action_studio", "quality_boundaries", "emerging_patterns"] as const;

  assert.equal(ACTIVE_ENGINE_RUNTIME_SLUGS.length, ENGINE_METHODOLOGY_SLUGS.length - ENGINE_READ_ONLY_OUTPUT_SLUGS.length);

  for (const slug of ACTIVE_ENGINE_RUNTIME_SLUGS) {
    const expected = expectedModules[slug as keyof typeof expectedModules];
    const expectedSet = new Set<string>(expected);
    const moduleKey = expected.find((key) => (methodSpecificKeys as readonly string[]).includes(key));
    const manifest = buildEngineOutputManifestForMethodology(slug);

    assert.equal(engineModuleKeyForMethodology(slug), moduleKey);
    assert.notEqual(moduleKey, undefined);
    assert.equal(manifest.engine_methodology, false);
    assert.equal(manifest.overview, true);
    assert.equal(manifest.evidence, true);
    assert.equal(manifest.corpus_view, true);
    assert.equal(manifest.corpus_chat, false);
    assert.equal(manifest.tb_decision_field, false);
    assert.equal(manifest.tb_comparative_dashboard, false);
    assert.equal(manifest.competitive_tb_matrix, false);

    for (const key of methodSpecificKeys) {
      assert.equal(manifest[key], key === moduleKey, `${slug} ${key}`);
    }
    for (const key of contextualKeys) {
      assert.equal(manifest[key], expectedSet.has(key), `${slug} ${key}`);
    }
  }
});
