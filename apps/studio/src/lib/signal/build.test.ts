import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const { buildCompetitiveTbMatrixBlock, buildEngineSignalPayload, buildSignalPayload, buildTbComparativeDashboard } = await import("./build");
const {
  defaultSignalDemoBlurredSections,
  defaultSignalManifest,
  normalizeSignalOutputManifest,
  signalModuleMeta
} = await import("./manifest");

const comparativeBrief = {
  benchmark_available: true,
  entities: [
    { entity_id: "brand", entity_name: "NoisiaTel", entity_kind: "primary_brand", mention_count: 120 },
    { entity_id: "comp", entity_name: "BigTel", entity_kind: "competitor", mention_count: 180 },
    { entity_id: "cat", entity_name: "Telefonía MX", entity_kind: "category", mention_count: 220 }
  ],
  finding_entity_presence: [
    {
      finding_id: "T-01",
      finding_name: "Sentirse cubierto sin pensar en la red",
      polarity: "trigger",
      layer: "personal",
      mobility: "movible_por_marca",
      total_mentions: 90,
      ownership: "competitor_owned",
      dominant_entity_name: "BigTel",
      entities: [
        { entity_id: "brand", entity_name: "NoisiaTel", entity_kind: "primary_brand", mention_count: 20, share_pct: 22, evidence_ids: ["m1"] },
        { entity_id: "comp", entity_name: "BigTel", entity_kind: "competitor", mention_count: 70, share_pct: 78, evidence_ids: ["m2", "m3"] }
      ]
    },
    {
      finding_id: "B-01",
      finding_name: "Miedo a quedar amarrado por contrato",
      polarity: "barrier",
      layer: "psicologico",
      mobility: "parcialmente_movible",
      total_mentions: 60,
      ownership: "brand_owned",
      dominant_entity_name: "NoisiaTel",
      entities: [
        { entity_id: "brand", entity_name: "NoisiaTel", entity_kind: "primary_brand", mention_count: 42, share_pct: 70, evidence_ids: ["m4"] },
        { entity_id: "comp", entity_name: "BigTel", entity_kind: "competitor", mention_count: 18, share_pct: 30, evidence_ids: ["m5"] }
      ]
    },
    {
      finding_id: "T-02",
      finding_name: "Promesa de datos que sí alcanzan",
      polarity: "trigger",
      layer: "social",
      total_mentions: 80,
      ownership: "shared",
      dominant_entity_name: "Telefonía MX",
      entities: [
        { entity_id: "brand", entity_name: "NoisiaTel", entity_kind: "primary_brand", mention_count: 28, share_pct: 35, evidence_ids: ["m6"] },
        { entity_id: "cat", entity_name: "Telefonía MX", entity_kind: "category", mention_count: 52, share_pct: 65, evidence_ids: ["m7"] }
      ]
    }
  ]
};

test("T&B comparative dashboard exposes heatmap, ownership and trigger/barrier split", () => {
  const dashboard = buildTbComparativeDashboard(comparativeBrief);

  assert.ok(dashboard);
  assert.equal(dashboard.summary.benchmark_available, true);
  assert.equal(dashboard.summary.strongest_entity, "Telefonía MX");
  assert.equal(dashboard.summary.brand_mentions, 120);
  assert.equal(dashboard.summary.competitor_mentions, 180);
  assert.equal(dashboard.summary.category_mentions, 220);
  assert.deepEqual(dashboard.charts.map((chart) => chart.chart_id), [
    "tb-comparative-heatmap",
    "tb-comparative-ownership-ranking",
    "tb-comparative-trigger-barrier-split"
  ]);

  const split = dashboard.charts.find((chart) => chart.chart_id === "tb-comparative-trigger-barrier-split");
  const rows = split?.data as Array<{ entity_id: string; triggers: number; barriers: number }>;
  assert.deepEqual(rows.find((row) => row.entity_id === "brand"), { entity_id: "brand", entity_name: "NoisiaTel", triggers: 48, barriers: 42 });
  assert.deepEqual(rows.find((row) => row.entity_id === "comp"), { entity_id: "comp", entity_name: "BigTel", triggers: 70, barriers: 18 });
});

test("signal manifest treats Live Composer and cheap T&B outputs as publishable and demo-blurrable modules", () => {
  assert.equal(defaultSignalManifest.live_composer, true);
  assert.equal(defaultSignalManifest.engine_methodology, false);
  assert.equal(defaultSignalManifest.tb_comparative_dashboard, true);
  assert.equal(defaultSignalManifest.competitive_tb_matrix, true);
  assert.equal(defaultSignalDemoBlurredSections.includes("live_composer"), true);
  assert.equal(defaultSignalDemoBlurredSections.includes("engine_methodology"), true);
  assert.equal(defaultSignalDemoBlurredSections.includes("tb_comparative_dashboard"), true);
  assert.equal(defaultSignalDemoBlurredSections.includes("competitive_tb_matrix"), true);
  assert.equal(signalModuleMeta.some((module) => module.key === "live_composer" && module.status === "partial"), true);
  assert.equal(signalModuleMeta.some((module) => module.key === "engine_methodology" && module.status === "partial"), true);
  assert.equal(signalModuleMeta.some((module) => module.key === "tb_comparative_dashboard" && module.status === "ready"), true);
  assert.equal(signalModuleMeta.some((module) => module.key === "competitive_tb_matrix" && module.status === "ready"), true);

  const manifest = normalizeSignalOutputManifest({
    live_composer: false,
    engine_methodology: true,
    tb_comparative_dashboard: false,
    demo_mode: {
      enabled: true,
      blurred_sections: ["live_composer", "tb_comparative_dashboard", "corpus_view", "unknown"]
    }
  });

  assert.equal(manifest.live_composer, false);
  assert.equal(manifest.engine_methodology, true);
  assert.equal(manifest.tb_comparative_dashboard, false);
  assert.deepEqual(manifest.demo_mode.blurred_sections, ["live_composer", "tb_comparative_dashboard", "corpus_view"]);
});

test("Competitive T&B Matrix highlights do-not-copy, disputable and exclusive barriers", () => {
  const matrix = buildCompetitiveTbMatrixBlock(comparativeBrief);

  assert.equal(matrix.kind, "competitive_tb_matrix");
  assert.equal(matrix.findings.length, 3);
  assert.equal(matrix.rankings[0]?.entity_name, "NoisiaTel");
  assert.equal(matrix.do_not_copy.length, 1);
  assert.equal((matrix.do_not_copy[0] as Record<string, unknown>).finding_id, "T-01");
  assert.equal(matrix.exclusive_barriers.length, 1);
  assert.equal((matrix.exclusive_barriers[0] as Record<string, unknown>).finding_id, "B-01");
  assert.equal(matrix.disputable.length, 1);
  assert.equal((matrix.disputable[0] as Record<string, unknown>).finding_id, "T-02");

  const competitorOwned = matrix.findings.find((finding) => finding.finding_id === "T-01");
  assert.equal(competitorOwned?.dominant_entity_name, "BigTel");
  assert.equal(competitorOwned?.by_entity[0]?.entity_name, "BigTel");
  assert.equal(competitorOwned?.by_entity[0]?.differentiation_index, 0.56);
});

test("engine signal payload uses the engine lens name instead of the corpus methodology", () => {
  const payload = buildEngineSignalPayload({
    corpus: {
      id: "corpus-1",
      brandName: "NoisiaTel",
      themeName: null,
      methodologyName: "Triggers & Barriers",
      methodologySlug: "triggers-barriers",
      businessQuestion: "Quien posee la narrativa de telefonia movil?"
    },
    analysis: {
      id: "engine-1",
      methodologySlug: "narrative-ownership",
      methodologyVersion: "1.0",
      businessQuestion: null,
      metaJson: { synthesis: { headline: "Narrativas listas" } },
      limitations: []
    },
    findings: [
      {
        id: "finding-1",
        findingKey: "red_sin_letras_chiquitas",
        name: "Red sin letras chiquitas",
        dimensions: { narrative: "red sin letras chiquitas" },
        frequency: 42,
        intensity: 0.8,
        sentiment: 0.7,
        sharePct: 62,
        compositeScore: 0.91,
        ownership: "brand_owned",
        confidence: "media",
        evidenceCount: 5,
        mentionIds: ["mention-1", "mention-2"],
        quote: "La red se entiende sin letras chiquitas"
      }
    ]
  });

  assert.equal(payload.report.methodology_name, "Narrative Ownership");
  assert.equal(payload.report.methodology_slug, "narrative-ownership");
  assert.equal(payload.engine_block?.methodology_slug, "narrative-ownership");
  assert.equal(payload.engine_block?.charts.length > 0, true);
  assert.equal(payload.engine_block?.methodology_view?.kind, "narrative-ownership");
  assert.equal(payload.engine_block?.methodology_view?.rows[0]?.finding_id, "red_sin_letras_chiquitas");
  assert.equal(payload.engine_block?.methodology_view?.rows[0]?.label, "red sin letras chiquitas");
  assert.equal(payload.engine_block?.methodology_view?.cards.length, 4);
  assert.deepEqual(payload.engine_block?.methodology_view?.readiness.missing, ["diversidad de senales"]);
});

test("engine methodology view maps VPM benefit and cost axes", () => {
  const payload = buildEngineSignalPayload({
    corpus: {
      id: "corpus-vpm",
      brandName: "NoisiaTel",
      themeName: null,
      methodologyName: "Triggers & Barriers",
      methodologySlug: "triggers-barriers",
      businessQuestion: "Que valor percibido ocupa cada telco?"
    },
    analysis: {
      id: "engine-vpm",
      methodologySlug: "value-perception-matrix",
      methodologyVersion: "1.0",
      businessQuestion: null,
      metaJson: {},
      limitations: []
    },
    findings: [
      {
        id: "vpm-1",
        findingKey: "value_funcional_monetario",
        name: "Valor funcional con costo monetario",
        dimensions: { value_benefit: "funcional", value_cost: "monetario", perceived_value: "high" },
        frequency: 24,
        intensity: 0.8,
        sentiment: 0.6,
        sharePct: 42,
        compositeScore: 0.86,
        ownership: "brand_owned",
        confidence: "media",
        evidenceCount: 3,
        mentionIds: ["mention-1", "mention-2", "mention-3"],
        quote: "Funciona bien aunque se siente caro"
      },
      {
        id: "vpm-2",
        findingKey: "value_emocional_cognitivo",
        name: "Tranquilidad simple",
        dimensions: { value_benefit: "emocional", value_cost: "cognitivo", perceived_value: "high" },
        frequency: 18,
        intensity: 0.7,
        sentiment: 0.5,
        sharePct: 35,
        compositeScore: 0.72,
        ownership: "shared",
        confidence: "media",
        evidenceCount: 2,
        mentionIds: ["mention-4", "mention-5"],
        quote: "Me da confianza porque es simple"
      }
    ]
  });

  assert.equal(payload.engine_block?.methodology_view?.title, "Value perception matrix");
  assert.equal(payload.engine_block?.methodology_view?.rows[0]?.label, "funcional");
  assert.equal(payload.engine_block?.methodology_view?.rows[0]?.axis, "monetario");
  assert.equal(payload.engine_block?.methodology_view?.conclusions.some((item) => item.kind === "protect"), true);
});

test("engine signal payload publishes every active methodology lens with method-specific charts", () => {
  const cases = [
    {
      slug: "narrative-ownership",
      kind: "narrative_ownership",
      expectedChart: "stacked_share",
      dimensions: { narrative: "red sin letras chiquitas", valence: "negativa", entity_share_pct: 64 },
      findingKey: "narrative_hidden_fees"
    },
    {
      slug: "value-perception-matrix",
      kind: "value_perception_matrix",
      expectedChart: "heatmap",
      dimensions: { value_benefit: "funcional", value_cost: "monetario", perceived_value: "high", value_score: 82 },
      findingKey: "vpm_functional_value"
    },
    {
      slug: "journey-friction-mapping",
      kind: "journey_friction_mapping",
      expectedChart: "waterfall",
      dimensions: { journey_phase: "portabilidad", friction_type: "effort", polarity: "blocker", choke_score: 120, accelerator_score: 0, quick_win_candidate: true },
      findingKey: "jfm_portability_effort"
    },
    {
      slug: "sentiment-advocacy-proxy",
      kind: "sentiment_advocacy_proxy",
      expectedChart: "diverging_bar",
      dimensions: { theme: "soporte", advocacy_class: "detractor", advocacy_proxy: -18, pct_promoter: 24, pct_passive: 34, pct_detractor: 42, is_survey_nps: false },
      findingKey: "advocacy_support_detractor"
    },
    {
      slug: "trust-risk-benchmark",
      kind: "trust_risk_benchmark",
      expectedChart: "gauge",
      dimensions: { trust_driver: "transparencia", risk_theme: "cargos ocultos", severity: "high", escalating: "yes", trust_score: 62, risk_score: 88, sensitive_risk_requires_evidence: true },
      findingKey: "trust_hidden_fees"
    }
  ] as const;

  for (const item of cases) {
    const payload = buildEngineSignalPayload({
      corpus: {
        id: `corpus-${item.slug}`,
        brandName: "NoisiaTel",
        themeName: null,
        methodologyName: "Triggers & Barriers",
        methodologySlug: "triggers-barriers",
        businessQuestion: "Probar publicacion engine end-to-end"
      },
      analysis: {
        id: `engine-${item.slug}`,
        methodologySlug: item.slug,
        methodologyVersion: "1.0",
        businessQuestion: null,
        metaJson: {},
        limitations: []
      },
      findings: [
        {
          id: `${item.slug}-finding`,
          findingKey: item.findingKey,
          name: "Señal prioritaria",
          dimensions: item.dimensions,
          frequency: 32,
          intensity: 0.74,
          sentiment: 0.21,
          sharePct: 48,
          compositeScore: 0.82,
          ownership: "brand_owned",
          confidence: "media",
          evidenceCount: 3,
          mentionIds: ["mention-1", "mention-2", "mention-3"],
          quote: "La evidencia real sostiene esta señal."
        }
      ]
    });

    assert.equal(payload.engine_block?.kind, item.kind, item.slug);
    assert.equal(payload.engine_block?.methodology_slug, item.slug, item.slug);
    assert.equal(payload.engine_block?.charts.some((chart) => chart.type === item.expectedChart), true, item.slug);
    assert.equal(payload.engine_block?.charts.some((chart) => chart.type === "confidence_badge"), true, item.slug);
    assert.equal(payload.engine_block?.findings[0]?.finding_id, item.findingKey, item.slug);
    assert.equal(payload.engine_block?.evidence_index[0]?.mention_ids.length, 3, item.slug);
    assert.equal(payload.client_boundaries.some((boundary) => boundary.includes("engine")), true, item.slug);
  }
});

test("engine signal payload prefers persisted synthesized engine block", () => {
  const payload = buildEngineSignalPayload({
    corpus: {
      id: "corpus-engine",
      brandName: "NoisiaTel",
      themeName: null,
      methodologyName: "Triggers & Barriers",
      methodologySlug: "triggers-barriers",
      businessQuestion: "Quien posee la narrativa?"
    },
    analysis: {
      id: "engine-synth",
      methodologySlug: "narrative-ownership",
      methodologyVersion: "1.0",
      businessQuestion: null,
      metaJson: {
        engine_block: {
          kind: "narrative_ownership",
          title: "Narrative Ownership Synthesized",
          subtitle: "1.0 · engine lens",
          methodology_slug: "narrative-ownership",
          summary: "Bloque persistido por synthesize.",
          methodology_view: {
            kind: "narrative-ownership",
            title: "Narrative Ownership Synthesized",
            primary_question: "Pregunta persistida",
            readiness: { status: "beta_ready", reason: "ok", missing: [] },
            cards: [],
            rows: [],
            conclusions: []
          },
          charts: [
            {
              chart_id: "persisted-chart",
              type: "stacked_share",
              title: "Chart persistido",
              data: [{ narrative: "red clara", share_pct: 80 }],
              evidence_ids: ["mention-1"],
              confidence: "media"
            }
          ],
          findings: [],
          evidence_index: [],
          limitations: ["persisted limitation"]
        }
      },
      limitations: []
    },
    findings: []
  });

  assert.equal(payload.engine_block?.title, "Narrative Ownership Synthesized");
  assert.equal(payload.engine_block?.charts[0]?.chart_id, "persisted-chart");
  assert.equal(payload.engine_block?.limitations[0], "persisted limitation");
});

test("signal payload uses theme name when a study has no brand", () => {
  const payload = buildSignalPayload({
    corpus: {
      id: "corpus-theme-1",
      brandName: null,
      themeName: "Telefonía Móvil México",
      methodologyName: "Triggers & Barriers",
      methodologySlug: "triggers-barriers",
      businessQuestion: "Comparar telefonía móvil en México"
    },
    state: {
      analysis: {
        id: "analysis-1",
        status: "approved_by_im",
        metaJson: {},
        comparativeBrief: null
      },
      recommendations: [],
      gates: [],
      findingSummary: { total: 0, barriers: 0, triggers: 0, movable: 0 },
      findings: [],
      aggregates: null,
      knowledgeSources: []
    } as never,
    manifest: {}
  });

  assert.equal(payload.report.brand_name, "Telefonía Móvil México");
  assert.match(payload.report.headline, /Telefonía Móvil México/);
});
