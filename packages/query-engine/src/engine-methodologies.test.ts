import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  ENGINE_METHODOLOGY_SLUGS,
  ENGINE_READ_ONLY_OUTPUT_SLUGS,
  aggregateEngineCodings,
  buildEngineCodingPrompt,
  buildEngineMethodologyBlock,
  buildEngineFixtureCodings,
  engineMethodologyRegistry,
  engineMethodologySpecs,
  isEngineFixtureCodingEnabled,
  isEngineLlmEnabled,
  isEngineModelAllowed,
  isEngineReadOnlyOutputSlug,
  isEngineRunnableMethodologySlug,
  isEngineRuntimeEnabled,
  parseEngineCodingResponse,
  scoreAudienceSegmentLens,
  scoreBrandPositioningMap,
  scoreCategoryOpportunityMap,
  scoreCompetitiveWave,
  scoreCulturalCodesDecoding,
  scoreDecisionVelocity,
  scoreInfluenceArchitecture,
  scoreJourneyFrictionMapping,
  scoreNarrativeOwnership,
  scoreSentimentAdvocacy,
  scoreTrustRiskBenchmark,
  scoreValuePerceptionMatrix,
  scoreWhiteSpaceAnalysis
} from "./index";

test("engine registry covers every declared methodology slug", () => {
  assert.equal(engineMethodologySpecs.length, ENGINE_METHODOLOGY_SLUGS.length);

  for (const slug of ENGINE_METHODOLOGY_SLUGS) {
    const spec = engineMethodologyRegistry[slug];
    assert.equal(spec.slug, slug);
    assert.ok(spec.unitKind.length > 0);
    assert.ok(Object.keys(spec.dimensionSchema).length > 0);
    assert.ok(spec.charts.length > 0);
    assert.ok(spec.qualityGates.length > 0);
    assert.ok(spec.minMentionsPerEntity >= 1);
  }
});

test("engine registry matches seedable beta methodology YAMLs", async () => {
  const seedsDir = resolve(process.cwd(), "../../docs/product/10_methodology_seeds");
  const files = (await readdir(seedsDir)).filter((file) => file.endsWith(".yaml")).sort();
  const betaSlugs: string[] = [];
  const nonEngineBetaSlugs = new Set(["signal-pulse"]);

  for (const file of files) {
    const raw = await readFile(resolve(seedsDir, file), "utf8");
    const slug = raw.match(/^slug:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim();
    const status = raw.match(/^status:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim();
    if (status === "beta" && slug && !nonEngineBetaSlugs.has(slug)) betaSlugs.push(slug);
  }

  assert.deepEqual(betaSlugs.sort(), [...ENGINE_METHODOLOGY_SLUGS].sort());
});

test("every engine methodology prompt keeps the same JSON-first contract", () => {
  for (const spec of engineMethodologySpecs) {
    const prompt = buildEngineCodingPrompt(spec, {
      brandName: "Noisia Telecom",
      businessQuestion: "Comparar telefonia movil en Mexico",
      params: { fixture: true },
      units: [
        {
          external_ref: `fixture-${spec.slug}`,
          entity_hint: "Noisia Telecom",
          text: "La marca promete claridad, pero la gente compara cobertura, precio y confianza contra competidores.",
          platform: "fixture",
          published_at: "2026-05-20"
        }
      ]
    });

    assert.match(prompt, /CRITICAL OUTPUT RULE/);
    assert.match(prompt, /Contrato JSON obligatorio/);
    assert.match(prompt, /signal_label/);
    assert.match(prompt, new RegExp(`fixture-${spec.slug}`));
    for (const dimension of Object.keys(spec.dimensionSchema)) {
      assert.match(prompt, new RegExp(dimension));
    }
  }
});

test("narrative ownership prompt is JSON-first and grounded in corpus units", () => {
  const spec = engineMethodologyRegistry["narrative-ownership"];
  const prompt = buildEngineCodingPrompt(spec, {
    brandName: "Noisia Telecom",
    businessQuestion: "Quien posee la narrativa de telefonia movil en Mexico?",
    params: { market: "MX" },
    units: [
      {
        external_ref: "mention-1",
        entity_hint: "Noisia Telecom",
        text: "Noisia Telecom se siente como una red sin letras chiquitas, pero la cobertura todavia falla fuera de CDMX.",
        platform: "x",
        published_at: "2026-05-20"
      }
    ]
  });

  assert.match(prompt, /Narrative Ownership/);
  assert.match(prompt, /PRIMER caracter/);
  assert.match(prompt, /mention-1/);
  assert.match(prompt, /Noisia Telecom se siente/);
});

test("engine coding parser requires signal_label for publishable labels", () => {
  const labels = parseEngineCodingResponse(JSON.stringify({
    codings: [
      {
        external_ref: "mention-1",
        finding_key: "red_sin_letras_chiquitas",
        dimensions: {
          signal_label: "red sin letras chiquitas como promesa de confianza",
          narrative: "red sin letras chiquitas",
          valence: "positiva"
        },
        intensity: 4,
        span: "red sin letras chiquitas",
        ambiguous: false
      }
    ]
  }));

  assert.deepEqual(labels[0], {
    external_ref: "mention-1",
    finding_key: "red_sin_letras_chiquitas",
    dimensions: {
      signal_label: "red sin letras chiquitas como promesa de confianza",
      narrative: "red sin letras chiquitas",
      valence: "positiva"
    },
    intensity: 4,
    span: "red sin letras chiquitas",
    ambiguous: false
  });

  const incomplete = parseEngineCodingResponse(JSON.stringify({
    codings: [
      {
        external_ref: "mention-2",
        finding_key: "value_funcional",
        dimensions: { value_benefit: "funcional", value_cost: "tiempo" },
        intensity: 3,
        span: "funcional",
        ambiguous: false
      }
    ]
  }));

  assert.deepEqual(incomplete[0], {
    external_ref: "mention-2",
    finding_key: "insufficient_signal",
    dimensions: { value_benefit: "funcional", value_cost: "tiempo" },
    intensity: 0,
    span: "funcional",
    ambiguous: true
  });

  // A malformed label (missing finding_key) is skipped rather than throwing, so
  // one bad item never discards the rest of an otherwise-valid coding batch.
  assert.deepEqual(
    parseEngineCodingResponse(JSON.stringify({ codings: [{ external_ref: "mention-1" }] })),
    []
  );
  // Valid labels in the same batch still come through even when a sibling is bad.
  const mixed = parseEngineCodingResponse(JSON.stringify({
    codings: [
      { external_ref: "mention-1" },
      {
        external_ref: "mention-3",
        finding_key: "red_sin_letras_chiquitas",
        dimensions: { signal_label: "red sin letras chiquitas como promesa de confianza" },
        intensity: 9,
        span: "x",
        ambiguous: false
      }
    ]
  }));
  assert.equal(mixed.length, 1);
  const validMixedCoding = mixed[0];
  assert.ok(validMixedCoding);
  assert.equal(validMixedCoding.external_ref, "mention-3");
  // Out-of-range intensity is clamped into [0,5] instead of throwing.
  assert.equal(validMixedCoding.intensity, 5);

  // Structural errors (no JSON object / no codings[] array) still throw so the
  // worker's batch-level guard can retry or skip the whole batch.
  assert.throws(() => parseEngineCodingResponse("no json here"), /did not contain a JSON object/);
  assert.throws(() => parseEngineCodingResponse(JSON.stringify({ notCodings: [] })), /did not include codings/);
});

test("engine runtime, LLM and Opus gates are closed by default", () => {
  const env = {};
  assert.equal(isEngineRuntimeEnabled(env), false);
  assert.equal(isEngineLlmEnabled(env), false);
  assert.equal(isEngineModelAllowed("claude-opus-4-1", env), false);

  assert.equal(isEngineRuntimeEnabled({ FEATURE_ENGINE_LENSES: "true" }), false);

  const runtimeOnly = { NOISIA_ENGINE_RUNTIME_ENABLED: "true" };
  assert.equal(isEngineRuntimeEnabled(runtimeOnly), true);
  assert.equal(isEngineLlmEnabled(runtimeOnly), false);
  assert.equal(isEngineFixtureCodingEnabled(runtimeOnly), false);

  const llmEnabled = { NOISIA_ENGINE_RUNTIME_ENABLED: "true", NOISIA_ENGINE_LLM_ENABLED: "true" };
  assert.equal(isEngineLlmEnabled(llmEnabled), true);
  assert.equal(isEngineFixtureCodingEnabled({ ...runtimeOnly, NOISIA_ENGINE_FIXTURE_CODING_ENABLED: "true" }), true);
  assert.equal(isEngineModelAllowed("claude-sonnet-4-6", llmEnabled), true);
  assert.equal(isEngineModelAllowed("claude-opus-4-1", llmEnabled), false);
  assert.equal(isEngineModelAllowed("claude-opus-4-1", { ...llmEnabled, NOISIA_ENGINE_ALLOW_OPUS: "true" }), true);
});

test("read-only T&B outputs stay seedable but are not runnable engine methodologies", () => {
  assert.deepEqual(ENGINE_READ_ONLY_OUTPUT_SLUGS, ["competitive-tb-matrix"]);
  assert.equal(isEngineReadOnlyOutputSlug("competitive-tb-matrix"), true);
  assert.equal(isEngineRunnableMethodologySlug("competitive-tb-matrix"), false);
  assert.equal(isEngineRunnableMethodologySlug("narrative-ownership"), true);
  assert.equal(isEngineRunnableMethodologySlug("triggers-barriers"), false);
});

const fixtureUnits = [
  {
    external_ref: "mention-coverage",
    entity_hint: "NoisiaTel",
    text: "La cobertura de NoisiaTel es confiable y la red se siente rapida en carretera.",
    platform: "fixture",
    published_at: "2026-05-20"
  },
  {
    external_ref: "mention-price",
    entity_hint: "BigTel",
    text: "BigTel tiene precio caro y demasiadas letras chiquitas en el contrato.",
    platform: "fixture",
    published_at: "2026-05-21"
  },
  {
    external_ref: "mention-journey",
    entity_hint: "NoisiaTel",
    text: "Compare planes, elegi NoisiaTel y comprar fue facil en la app.",
    platform: "fixture",
    published_at: "2026-05-22"
  },
  {
    external_ref: "mention-noise",
    entity_hint: null,
    text: "Vi un anuncio ayer.",
    platform: "fixture",
    published_at: "2026-05-23"
  }
] satisfies Parameters<typeof buildEngineFixtureCodings>[1];

test("Narrative Ownership fixture coding creates no-cost deterministic labels", () => {
  const labels = buildEngineFixtureCodings("narrative-ownership", fixtureUnits);

  assert.deepEqual(labels.map((label) => [label.external_ref, label.finding_key, label.dimensions.valence, label.ambiguous === true]), [
    ["mention-coverage", "cobertura_confiable", "positiva", false],
    ["mention-price", "precio_sin_trucos", "negativa", false],
    ["mention-journey", "control_digital_simple", "positiva", false],
    ["mention-noise", "insufficient_signal", "neutra", true]
  ]);
});

test("priority methodology fixtures create valid labels without LLM calls", () => {
  const sentiment = buildEngineFixtureCodings("sentiment-advocacy-proxy", fixtureUnits);
  const trust = buildEngineFixtureCodings("trust-risk-benchmark", fixtureUnits);
  const vpm = buildEngineFixtureCodings("value-perception-matrix", fixtureUnits);
  const jfm = buildEngineFixtureCodings("journey-friction-mapping", fixtureUnits);

  assert.equal(sentiment.find((label) => label.external_ref === "mention-coverage")?.dimensions.advocacy_class, "promoter");
  assert.equal(sentiment.find((label) => label.external_ref === "mention-price")?.dimensions.advocacy_class, "detractor");
  assert.equal(trust.find((label) => label.external_ref === "mention-price")?.dimensions.risk_theme, "transparencia contractual");
  assert.equal(vpm.find((label) => label.external_ref === "mention-price")?.dimensions.value_cost, "monetario");
  assert.equal(jfm.find((label) => label.external_ref === "mention-journey")?.dimensions.polarity, "accelerator");
  assert.equal(buildEngineFixtureCodings("competitive-wave", fixtureUnits).length, fixtureUnits.length);
});

test("all runnable engine methodologies have a no-cost fixture path", () => {
  const slugs = ENGINE_METHODOLOGY_SLUGS.filter(isEngineRunnableMethodologySlug);

  for (const slug of slugs) {
    const labels = buildEngineFixtureCodings(slug, fixtureUnits);
    assert.equal(labels.length, fixtureUnits.length, `${slug} should produce fixture labels`);
    assert.equal(labels.every((label) => label.external_ref), true, `${slug} should preserve refs`);
  }
});

test("narrative ownership fixture aggregates findings without LLM calls", () => {
  const labels = parseEngineCodingResponse(JSON.stringify({
    codings: [
      {
        external_ref: "mention-1",
        finding_key: "red_sin_letras_chiquitas",
        dimensions: {
          signal_label: "red sin letras chiquitas y precio claro",
          narrative: "red sin letras chiquitas",
          valence: "positiva"
        },
        intensity: 4,
        span: "red sin letras chiquitas y precio claro",
        ambiguous: false
      },
      {
        external_ref: "mention-2",
        finding_key: "red_sin_letras_chiquitas",
        dimensions: {
          signal_label: "red sin letras chiquitas y precio claro",
          narrative: "red sin letras chiquitas",
          valence: "positiva"
        },
        intensity: 5,
        span: "me gusta que la red no tenga letras chiquitas",
        ambiguous: false
      },
      {
        external_ref: "mention-3",
        finding_key: "red_sin_letras_chiquitas",
        dimensions: {
          signal_label: "red sin letras chiquitas y precio claro",
          narrative: "red sin letras chiquitas",
          valence: "positiva"
        },
        intensity: 3,
        span: "la promesa simple de internet sin trucos",
        ambiguous: false
      },
      {
        external_ref: "mention-4",
        finding_key: "cobertura_que_no_llega",
        dimensions: {
          signal_label: "cobertura que no llega fuera de la ciudad",
          narrative: "cobertura que no llega",
          valence: "negativa"
        },
        intensity: 4,
        span: "la cobertura se cae saliendo de la ciudad",
        ambiguous: false
      }
    ]
  }));
  const aggregates = aggregateEngineCodings(labels.map((label, index) => ({
    findingKey: label.finding_key,
    entityId: index < 3 ? "brand:noisia-telecom" : "competitor:legacy-telco",
    dimensions: label.dimensions,
    intensity: label.intensity,
    sentiment: label.dimensions.valence === "negativa" ? -0.6 : 0.7,
    platform: index % 2 === 0 ? "x" : "tiktok",
    publishedAt: `2026-05-${String(index + 10).padStart(2, "0")}`,
    qualityScore: 7 - index,
    mentionId: label.external_ref,
    span: label.span
  })));

  assert.equal(aggregates.length, 2);
  assert.equal(aggregates[0]?.findingKey, "red_sin_letras_chiquitas");
  assert.equal(aggregates[0]?.name, "Red sin letras chiquitas y precio claro");
  assert.equal(aggregates[0]?.frequency, 3);
  assert.equal(aggregates[0]?.sharePct, 75);
  assert.equal(aggregates[0]?.citations.length, 3);
  assert.equal(aggregates[0]?.confidence, "baja_direccional");
  assert.equal(aggregates[1]?.findingKey, "cobertura_que_no_llega");
});

test("Narrative Ownership scoring assigns owner, share and differentiation by narrative", () => {
  const scores = scoreNarrativeOwnership([
    {
      findingKey: "red_sin_letras_chiquitas",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 35,
      dimensions: { valence: "positiva" }
    },
    {
      findingKey: "red_sin_letras_chiquitas",
      entityId: "competitor:bigtel",
      entityKind: "competitor",
      frequency: 65,
      dimensions: { valence: "positiva" }
    },
    {
      findingKey: "atencion_que_resuelve",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 40,
      dimensions: { valence: "positiva" }
    },
    {
      findingKey: "atencion_que_resuelve",
      entityId: "competitor:bigtel",
      entityKind: "competitor",
      frequency: 38,
      dimensions: { valence: "positiva" }
    },
    {
      findingKey: "micro_narrativa",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 1,
      dimensions: { valence: "neutra" }
    }
  ]);

  const competitorOwned = scores.find((score) => score.findingKey === "red_sin_letras_chiquitas" && score.entityId === "competitor:bigtel");
  assert.equal(competitorOwned?.sharePct, 65);
  assert.equal(competitorOwned?.ownership, "competitor_owned");
  assert.equal(competitorOwned?.differentiationIndex, 0.3);
  assert.equal(competitorOwned?.dimensions.narrative_total, 100);

  const tiedBrand = scores.find((score) => score.findingKey === "atencion_que_resuelve" && score.entityId === "brand:noisia");
  assert.equal(tiedBrand?.ownership, "shared");
  assert.equal(tiedBrand?.dimensions.ownership_decision, "shared");

  const insufficient = scores.find((score) => score.findingKey === "micro_narrativa");
  assert.equal(insufficient?.ownership, "insufficient_evidence");
  assert.equal(insufficient?.dimensions.ownership_decision, "insufficient_evidence");
});

test("Sentiment Advocacy scoring creates an honest non-survey proxy by entity", () => {
  const scores = scoreSentimentAdvocacy([
    {
      findingKey: "soporte_que_resuelve",
      entityId: "brand:noisia",
      frequency: 40,
      sentiment: 0.7,
      intensity: 4,
      dimensions: { advocacy_class: "promoter", theme: "soporte" }
    },
    {
      findingKey: "cobros_confusos",
      entityId: "brand:noisia",
      frequency: 20,
      sentiment: -0.8,
      intensity: 5,
      dimensions: { advocacy_class: "detractor", theme: "cobros" }
    },
    {
      findingKey: "cobertura_ok",
      entityId: "brand:noisia",
      frequency: 40,
      sentiment: 0.05,
      intensity: 2,
      dimensions: { advocacy_class: "passive", theme: "cobertura" }
    },
    {
      findingKey: "app_simple",
      entityId: "competitor:bigtel",
      frequency: 10,
      sentiment: 0.6,
      intensity: 3,
      dimensions: { sentiment: "positive", theme: "app" }
    }
  ]);

  const promoterDriver = scores.find((score) => score.findingKey === "soporte_que_resuelve");
  assert.equal(promoterDriver?.sharePct, 40);
  assert.equal(promoterDriver?.dimensions.is_survey_nps, false);
  assert.equal(promoterDriver?.dimensions.pct_promoter, 40);
  assert.equal(promoterDriver?.dimensions.pct_detractor, 20);
  assert.equal(promoterDriver?.dimensions.pct_passive, 40);
  assert.equal(promoterDriver?.dimensions.advocacy_proxy, 20);
  assert.equal(promoterDriver?.dimensions.driver_share_pct, 40);

  const competitorDriver = scores.find((score) => score.entityId === "competitor:bigtel");
  assert.equal(competitorDriver?.dimensions.pct_promoter, 100);
  assert.equal(competitorDriver?.dimensions.advocacy_proxy, 100);
});

test("Trust Risk scoring separates trust score from escalating risk vulnerability", () => {
  const scores = scoreTrustRiskBenchmark([
    {
      findingKey: "atencion_transparente",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 60,
      sentiment: 0.6,
      dimensions: { trust_driver: "transparencia", severity: "low", escalating: "no" }
    },
    {
      findingKey: "cargos_no_autorizados",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 40,
      sentiment: -0.9,
      dimensions: { risk_theme: "cargos no autorizados", severity: "high", escalating: "yes" }
    },
    {
      findingKey: "cargos_no_autorizados",
      entityId: "competitor:bigtel",
      entityKind: "competitor",
      frequency: 10,
      sentiment: -0.5,
      dimensions: { risk_theme: "cargos no autorizados", severity: "medium", escalating: "no" }
    }
  ]);

  const brandRisk = scores.find((score) => score.findingKey === "cargos_no_autorizados" && score.entityId === "brand:noisia");
  assert.equal(brandRisk?.dimensions.risk_score, 180);
  assert.equal(brandRisk?.dimensions.risk_theme_share_pct, 80);
  assert.equal(brandRisk?.ownership, "brand_owned");
  assert.equal(brandRisk?.differentiationIndex, 0.6);
  assert.equal(brandRisk?.dimensions.reputational_vulnerability, true);
  assert.equal(brandRisk?.dimensions.sensitive_risk_requires_evidence, true);

  const trustDriver = scores.find((score) => score.findingKey === "atencion_transparente");
  assert.equal(trustDriver?.dimensions.risk_score, 0);
  assert.equal(trustDriver?.ownership, null);
  assert.ok((trustDriver?.dimensions.trust_score ?? 0) > 45);
});

test("VPM scoring calculates value ownership and keeps whitespace as candidate", () => {
  const scores = scoreValuePerceptionMatrix([
    {
      findingKey: "valor_funcional_monetario",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 70,
      intensity: 4,
      sentiment: 0.5,
      dimensions: { value_benefit: "funcional", value_cost: "monetario", perceived_value: "high" }
    },
    {
      findingKey: "valor_funcional_monetario",
      entityId: "competitor:bigtel",
      entityKind: "competitor",
      frequency: 30,
      intensity: 3,
      sentiment: 0.1,
      dimensions: { value_benefit: "funcional", value_cost: "monetario", perceived_value: "medium" }
    },
    {
      findingKey: "valor_aspiracional_social",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 18,
      intensity: 4,
      sentiment: 0.4,
      dimensions: { value_benefit: "aspiracional", value_cost: "social", perceived_value: "medium" }
    },
    {
      findingKey: "valor_aspiracional_social",
      entityId: "competitor:bigtel",
      entityKind: "competitor",
      frequency: 17,
      intensity: 4,
      sentiment: 0.4,
      dimensions: { value_benefit: "aspiracional", value_cost: "social", perceived_value: "medium" }
    }
  ]);

  const owned = scores.find((score) => score.findingKey === "valor_funcional_monetario" && score.entityId === "brand:noisia");
  assert.equal(owned?.sharePct, 70);
  assert.equal(owned?.ownership, "brand_owned");
  assert.equal(owned?.dimensions.value_cell_total, 100);
  assert.equal(owned?.dimensions.whitespace_candidate, false);
  assert.ok((owned?.dimensions.value_score ?? 0) > 800);

  const whitespace = scores.find((score) => score.findingKey === "valor_aspiracional_social" && score.entityId === "brand:noisia");
  assert.equal(whitespace?.ownership, "shared");
  assert.equal(whitespace?.dimensions.whitespace_candidate, true);
  assert.equal(whitespace?.dimensions.whitespace_status, "candidate_requires_absence_evidence");
});

test("JFM scoring calculates choke points, accelerators and directional quick wins", () => {
  const scores = scoreJourneyFrictionMapping([
    {
      findingKey: "checkout_informacion_confusa",
      entityId: "brand:noisia",
      frequency: 35,
      intensity: 4,
      sentiment: -0.6,
      dimensions: {
        journey_phase: "buy",
        friction_type: "informational",
        visibility: "articulable",
        polarity: "blocker"
      }
    },
    {
      findingKey: "checkout_informacion_clara",
      entityId: "brand:noisia",
      frequency: 15,
      intensity: 3,
      sentiment: 0.5,
      dimensions: {
        journey_phase: "buy",
        friction_type: "informational",
        visibility: "articulable",
        polarity: "accelerator"
      }
    }
  ]);

  const blocker = scores.find((score) => score.findingKey === "checkout_informacion_confusa");
  assert.equal(blocker?.dimensions.choke_score, 140);
  assert.equal(blocker?.dimensions.accelerator_score, 0);
  assert.equal(blocker?.dimensions.journey_cell_total, 50);
  assert.equal(blocker?.dimensions.journey_cell_share_pct, 70);
  assert.equal(blocker?.dimensions.removability_effort, "low");
  assert.equal(blocker?.dimensions.removability_impact, "high");
  assert.equal(blocker?.dimensions.quick_win_candidate, true);

  const accelerator = scores.find((score) => score.findingKey === "checkout_informacion_clara");
  assert.equal(accelerator?.dimensions.choke_score, 0);
  assert.equal(accelerator?.dimensions.accelerator_score, 45);
  assert.equal(accelerator?.dimensions.quick_win_candidate, false);
});

test("priority methodology signal blocks publish method-specific charts and limits", () => {
  const cases = [
    {
      slug: "narrative-ownership",
      kind: "narrative_ownership",
      dimensions: { narrative: "red sin letras chiquitas", valence: "positiva", entity_share_pct: 64 },
      chart: "stacked_share"
    },
    {
      slug: "value-perception-matrix",
      kind: "value_perception_matrix",
      dimensions: { value_benefit: "funcional", value_cost: "monetario", perceived_value: "high", value_score: 82 },
      chart: "heatmap"
    },
    {
      slug: "journey-friction-mapping",
      kind: "journey_friction_mapping",
      dimensions: { journey_phase: "buy", friction_type: "effort", polarity: "blocker", choke_score: 120, quick_win_candidate: true },
      chart: "waterfall"
    },
    {
      slug: "sentiment-advocacy-proxy",
      kind: "sentiment_advocacy_proxy",
      dimensions: { theme: "soporte", advocacy_class: "promoter", advocacy_proxy: 35, pct_promoter: 50, pct_passive: 35, pct_detractor: 15, is_survey_nps: false },
      chart: "diverging_bar"
    },
    {
      slug: "trust-risk-benchmark",
      kind: "trust_risk_benchmark",
      dimensions: { trust_driver: "transparencia", risk_theme: "cargos ocultos", severity: "high", escalating: "yes", trust_score: 62, risk_score: 88, sensitive_risk_requires_evidence: true },
      chart: "gauge"
    }
  ] as const;

  for (const item of cases) {
    const block = buildEngineMethodologyBlock({
      methodologySlug: item.slug,
      methodologyVersion: "1.0",
      findings: [
        {
          id: `${item.slug}-1`,
          findingKey: `${item.slug}-signal`,
          name: "Senal prioritaria",
          dimensions: item.dimensions,
          frequency: 24,
          intensity: 4,
          sentiment: 0.4,
          sharePct: 64,
          compositeScore: 0.82,
          ownership: "brand_owned",
          confidence: "media",
          evidenceCount: 3,
          mentionIds: ["mention-1", "mention-2", "mention-3"],
          quote: "La evidencia conecta la senal con lenguaje real."
        }
      ]
    });

    assert.equal(block.kind, item.kind);
    assert.equal(block.methodology_slug, item.slug);
    assert.equal(block.charts.some((chart) => chart.type === item.chart), true, `${item.slug} should include ${item.chart}`);
    assert.equal(block.charts.some((chart) => chart.type === "confidence_badge"), true, `${item.slug} should include confidence badge`);
    assert.equal(block.methodology_view.rows.length, 1);
    assert.equal(block.evidence_index[0]?.mention_ids.length, 3);
    assert.ok(block.limitations.length > 0);
  }
});

test("Category Opportunity scoring combines demand, coverage and urgency", () => {
  const scores = scoreCategoryOpportunityMap([
    {
      findingKey: "atencion_humana",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 40,
      intensity: 3,
      sentiment: 0.5,
      dimensions: { need: "atencion humana", coverage: "underserved", urgency: "high" }
    },
    {
      findingKey: "atencion_humana",
      entityId: "competitor:bigtel",
      entityKind: "competitor",
      frequency: 20,
      intensity: 2,
      sentiment: -0.1,
      dimensions: { need: "atencion humana", coverage: "underserved", urgency: "medium" }
    }
  ]);

  const brand = scores.find((score) => score.entityId === "brand:noisia");
  assert.equal(brand?.ownership, "brand_owned");
  assert.equal(brand?.dimensions.need_total, 60);
  assert.equal(brand?.dimensions.coverage_score, 0.25);
  assert.equal(brand?.dimensions.urgency_weight, 1.5);
  assert.equal(brand?.dimensions.coverage_evidence_status, "coverage_evidence_present");
  assert.ok((brand?.dimensions.opportunity_score ?? 0) > 170);
});

test("White Space scoring classifies capturable vs aspirational spaces", () => {
  const scores = scoreWhiteSpaceAnalysis([
    {
      findingKey: "humano_sin_bot",
      entityId: "brand:noisia",
      frequency: 50,
      intensity: 4,
      sentiment: 0.4,
      dimensions: { demand: "humano sin bot", competitive_coverage: "low", brand_permission: "moderate" }
    },
    {
      findingKey: "lujo_premium",
      entityId: "brand:noisia",
      frequency: 40,
      intensity: 4,
      sentiment: 0.2,
      dimensions: { demand: "lujo premium", competitive_coverage: "low", brand_permission: "weak" }
    }
  ]);

  const capturable = scores.find((score) => score.findingKey === "humano_sin_bot");
  assert.equal(capturable?.dimensions.whitespace_classification, "capturable");
  assert.equal(capturable?.dimensions.absence_evidence_status, "directional_from_competitive_corpus");
  assert.ok((capturable?.dimensions.whitespace_score ?? 0) > 100);

  const aspirational = scores.find((score) => score.findingKey === "lujo_premium");
  assert.equal(aspirational?.dimensions.whitespace_classification, "aspirational");
});

test("Brand Positioning scoring creates perceived x/y coordinates and distances", () => {
  const scores = scoreBrandPositioningMap([
    {
      findingKey: "premium",
      entityId: "brand:noisia",
      frequency: 40,
      intensity: 3,
      sentiment: 0.5,
      dimensions: { attribute: "premium", axis_pole: "premium" }
    },
    {
      findingKey: "innovador",
      entityId: "brand:noisia",
      frequency: 35,
      intensity: 4,
      sentiment: 0.6,
      dimensions: { attribute: "innovador", axis_pole: "innovative" }
    },
    {
      findingKey: "accesible",
      entityId: "competitor:bigtel",
      frequency: 50,
      intensity: 3,
      sentiment: 0.4,
      dimensions: { attribute: "accesible", axis_pole: "accessible" }
    }
  ]);

  const brand = scores.find((score) => score.entityId === "brand:noisia" && score.findingKey === "premium");
  assert.equal(brand?.dimensions.axis_defined, true);
  assert.ok((brand?.dimensions.perceptual_x ?? 0) > 0);
  assert.ok((brand?.dimensions.perceptual_y ?? 0) > 0);
  assert.ok((brand?.dimensions.nearest_entity_distance ?? 0) > 0);
  assert.equal(brand?.dimensions.position_basis, "perceived_corpus_not_declared_positioning");
});

test("Cultural Codes scoring keeps ownership and long-text validation explicit", () => {
  const scores = scoreCulturalCodesDecoding([
    {
      findingKey: "lujo_silencioso",
      entityId: "brand:noisia",
      entityKind: "primary_brand",
      frequency: 45,
      intensity: 4,
      dimensions: { code_level: "deep", binary_opposition: "lujo ↔ ostentacion", maturity: "active" }
    },
    {
      findingKey: "lujo_silencioso",
      entityId: "competitor:bigtel",
      entityKind: "competitor",
      frequency: 15,
      intensity: 3,
      dimensions: { code_level: "deep", binary_opposition: "lujo ↔ ostentacion", maturity: "nascent" }
    }
  ]);

  const owned = scores.find((score) => score.entityId === "brand:noisia");
  assert.equal(owned?.ownership, "brand_owned");
  assert.equal(owned?.dimensions.cultural_level_present, true);
  assert.equal(owned?.dimensions.opposition_present, true);
  assert.equal(owned?.dimensions.long_text_evidence_status, "requires_source_validation");
  assert.ok((owned?.dimensions.cultural_intensity ?? 0) > 200);
});

test("Competitive Wave scoring creates directional wave coordinates and publishability", () => {
  const scores = scoreCompetitiveWave([
    { findingKey: "resonance_a", entityId: "brand:a", frequency: 100, intensity: 4, sentiment: 0.6, dimensions: { axis: "resonance", direction: "positive" } },
    { findingKey: "ownership_a", entityId: "brand:a", frequency: 90, intensity: 4, sentiment: 0.5, dimensions: { axis: "cultural_ownership", direction: "positive" } },
    { findingKey: "resonance_b", entityId: "brand:b", frequency: 80, intensity: 3, sentiment: 0.2, dimensions: { axis: "resonance", direction: "mixed" } },
    { findingKey: "ownership_b", entityId: "brand:b", frequency: 35, intensity: 3, sentiment: 0.1, dimensions: { axis: "differentiation", direction: "positive" } },
    { findingKey: "resonance_c", entityId: "brand:c", frequency: 20, intensity: 2, sentiment: -0.2, dimensions: { axis: "resonance", direction: "negative" } }
  ]);

  const leader = scores.find((score) => score.entityId === "brand:a");
  assert.equal(leader?.dimensions.wave_publishable, true);
  assert.equal(leader?.dimensions.wave_entity_count, 3);
  assert.ok((leader?.dimensions.wave_x ?? 0) >= 50);
  assert.ok((leader?.dimensions.wave_y ?? 0) >= 50);
});

test("Audience Segment scoring exposes skew and segment source", () => {
  const scores = scoreAudienceSegmentLens([
    { findingKey: "precio", entityId: "brand:a", frequency: 40, intensity: 3, sentiment: -0.4, dimensions: { segment: "jovenes", metric: "barrier", polarity: "negative" } },
    { findingKey: "precio", entityId: "brand:b", frequency: 10, intensity: 2, sentiment: 0.1, dimensions: { segment: "jovenes", metric: "barrier", polarity: "neutral" } },
    { findingKey: "soporte", entityId: "brand:b", frequency: 50, intensity: 4, sentiment: 0.6, dimensions: { segment: "negocios", metric: "trigger", polarity: "positive" } }
  ]);

  const youngBrand = scores.find((score) => score.entityId === "brand:a");
  assert.equal(youngBrand?.dimensions.segment_source, "declared_or_metadata_or_coded");
  assert.equal(youngBrand?.dimensions.segment_entity_share_pct, 80);
  assert.ok((youngBrand?.dimensions.segment_skew ?? 0) > 0);
});

test("Influence Architecture scoring stays directional without graph metadata", () => {
  const scores = scoreInfluenceArchitecture([
    {
      findingKey: "arquitecto_foro",
      entityId: "brand:a",
      frequency: 30,
      intensity: 4,
      dimensions: { node_role: "architect", community: "foro tecnico", tie_type: "translation" }
    }
  ]);

  assert.equal(scores[0]?.dimensions.graph_centrality_available, false);
  assert.equal(scores[0]?.dimensions.author_metadata_status, "required_for_real_graph");
  assert.equal(scores[0]?.dimensions.influence_basis, "coded_mentions_not_network_graph");
  assert.ok((scores[0]?.dimensions.influence_score ?? 0) > 150);
});

test("Decision Velocity scoring separates blockers from accelerators and marks inference", () => {
  const scores = scoreDecisionVelocity([
    {
      findingKey: "comparacion_excesiva",
      entityId: "brand:a",
      frequency: 30,
      intensity: 4,
      dimensions: { decision_phase: "evaluation", cognitive_system: "system_2", factor: "comparison", polarity: "blocker" }
    },
    {
      findingKey: "prueba_social",
      entityId: "brand:a",
      frequency: 20,
      intensity: 3,
      dimensions: { decision_phase: "evaluation", cognitive_system: "social_proof", factor: "reputation", polarity: "accelerator" }
    }
  ]);

  const blocker = scores.find((score) => score.findingKey === "comparacion_excesiva");
  assert.equal(blocker?.dimensions.blocker_score, 120);
  assert.equal(blocker?.dimensions.accelerator_score, 0);
  assert.ok((blocker?.dimensions.velocity_index ?? 0) < 0);
  assert.equal(blocker?.dimensions.measured_vs_inferred, "inferred_from_corpus");
  assert.equal(blocker?.dimensions.benchmark_status, "benchmark_required_for_publication");
});
