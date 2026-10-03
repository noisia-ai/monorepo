import assert from "node:assert/strict";
import test from "node:test";

import {
  applyComposerEditorialCut,
  buildComposerModules,
  buildComposerDraft,
  buildComposerEditorialDraft,
  dedupeComposerSignals,
  filterComposerSignals,
  isComposerOpportunity,
  isComposerRisk,
  normalizeComposerRow,
  reusableComposerEngineAnalysisSql,
  type ComposerRow
} from "./composer";

function row(overrides: Partial<ComposerRow>): ComposerRow {
  return {
    canonical_signal_id: "signal-1",
    methodology_slug: "triggers-barriers",
    signal_type: "trigger",
    semantic_key: "trigger-social-promesa-de-datos",
    canonical_title: "Promesa de datos que sí alcanzan",
    signal_status: "active",
    dimensions: {},
    observation_id: "observation-1",
    frequency: 10,
    share_pct: "12.5",
    intensity: "0.7",
    sentiment: "0.2",
    composite_score: "0.81",
    confidence: "media",
    delta_vs_previous: "3",
    evidence_count: 4,
    evidence_examples: [],
    ...overrides
  };
}

test("composer normalizes numeric fields without losing dimensions", () => {
  const normalized = normalizeComposerRow(row({
    dimensions: { layer: "social" },
    frequency: null,
    share_pct: "",
    sentiment: "-0.35",
    composite_score: null,
    evidence_examples: [
      {
        observation_id: "observation-1",
        mention_id: "mention-1",
        quote: "La promesa de datos se entiende sin letras chiquitas.",
        platform: "twitter",
        published_at: "2026-05-01T00:00:00.000Z",
        is_protagonist: true
      },
      { quote: "" }
    ]
  }));

  assert.equal(normalized.frequency, 0);
  assert.equal(normalized.share_pct, null);
  assert.equal(normalized.sentiment, -0.35);
  assert.equal(normalized.composite_score, null);
  assert.deepEqual(normalized.dimensions, { layer: "social" });
  assert.equal(normalized.evidence_examples.length, 1);
  assert.equal(normalized.evidence_examples[0]?.mention_id, "mention-1");
  assert.equal(normalized.evidence_examples[0]?.is_protagonist, true);
});

test("composer reusable analysis SQL admits gated Signal Pulse without per-mention coding", () => {
  const predicate = reusableComposerEngineAnalysisSql("live_ea");

  assert.match(predicate, /live_ea\.methodology_slug = 'signal-pulse'/);
  assert.match(predicate, /source_presence/);
  assert.match(predicate, /signal_min_evidence/);
  assert.match(predicate, /no_invented_numbers/);
  assert.match(predicate, /live_ea\.meta_json->'engine_coding'->>'provider' = 'anthropic'/);
  assert.match(predicate, /live_ea\.methodology_slug <> 'signal-pulse'/);
});

test("composer dedupes repeated semantic signals across methodologies", () => {
  const rows = [
    row({
      canonical_signal_id: "tb-1",
      observation_id: "tb-observation-1",
      methodology_slug: "triggers-barriers",
      semantic_key: "precio-sin-trucos",
      canonical_title: "Precio sin trucos",
      composite_score: "0.72",
      frequency: 20,
      evidence_count: 3,
      evidence_examples: [
        { observation_id: "tb-observation-1", mention_id: "mention-1", quote: "El precio se entiende claro.", platform: "twitter" }
      ]
    }),
    row({
      canonical_signal_id: "vpm-1",
      observation_id: "vpm-observation-1",
      methodology_slug: "value-perception-matrix",
      signal_type: "value_signal",
      semantic_key: "precio-sin-trucos",
      canonical_title: "Precio sin trucos",
      composite_score: "0.88",
      frequency: 15,
      evidence_count: 8,
      evidence_examples: [
        { observation_id: "vpm-observation-1", mention_id: "mention-1", quote: "El precio se entiende claro.", platform: "twitter" },
        { observation_id: "vpm-observation-1", mention_id: "mention-2", quote: "Siento que pago lo justo por lo que recibo.", platform: "reviews" }
      ]
    }),
    row({
      canonical_signal_id: "jfm-1",
      methodology_slug: "journey-friction-mapping",
      signal_type: "journey_friction",
      semantic_key: "checkout-confuso",
      canonical_title: "Checkout confuso",
      composite_score: "0.7",
      frequency: 18
    })
  ].map(normalizeComposerRow);

  const deduped = dedupeComposerSignals(rows);

  assert.equal(deduped.length, 2);
  const price = deduped.find((signal) => signal.semantic_key === "precio-sin-trucos");
  assert.equal(price?.canonical_signal_id, "vpm-1");
  assert.deepEqual(price?.supporting_methodologies.sort(), ["triggers-barriers", "value-perception-matrix"]);
  assert.deepEqual(price?.supporting_signal_types.sort(), ["trigger", "value_signal"]);
  assert.deepEqual(price?.supporting_signal_ids.sort(), ["tb-1", "vpm-1"]);
  assert.deepEqual(price?.supporting_observation_ids.sort(), ["tb-observation-1", "vpm-observation-1"]);
  assert.equal(price?.supporting_signal_count, 2);
  assert.equal(price?.supporting_evidence_count, 11);
  assert.deepEqual(price?.evidence_examples.map((item) => item.mention_id), ["mention-1", "mention-2"]);
});

test("composer dedupes scoped engine semantic keys by canonical title", () => {
  const rows = [
    row({
      canonical_signal_id: "narrative-1",
      observation_id: "obs-1",
      methodology_slug: "narrative-ownership",
      signal_type: "narrative",
      semantic_key: "narrative-ownership-narrative-letra-chica-cargos-ocultos",
      canonical_title: "Letra chica y cargos ocultos",
      evidence_examples: [{ observation_id: "obs-1", mention_id: "mention-1", quote: "Siempre hay cargos que no explican.", platform: "x" }]
    }),
    row({
      canonical_signal_id: "trust-1",
      observation_id: "obs-2",
      methodology_slug: "trust-risk-benchmark",
      signal_type: "risk",
      semantic_key: "trust-risk-benchmark-risk-letra-chica-cargos-ocultos",
      canonical_title: "Letra chica y cargos ocultos",
      evidence_examples: [{ observation_id: "obs-2", mention_id: "mention-2", quote: "El plan trae letras chiquitas.", platform: "reviews" }]
    })
  ].map(normalizeComposerRow);

  const deduped = dedupeComposerSignals(rows);

  assert.equal(deduped.length, 1);
  assert.deepEqual(deduped[0]?.supporting_methodologies.sort(), ["narrative-ownership", "trust-risk-benchmark"]);
  assert.deepEqual(deduped[0]?.supporting_signal_ids.sort(), ["narrative-1", "trust-1"]);
  assert.deepEqual(deduped[0]?.evidence_examples.map((example) => example.mention_id).sort(), ["mention-1", "mention-2"]);
});

test("composer builds methodology modules and top signals across lenses", () => {
  const rows = [
    row({ canonical_signal_id: "tb-1", methodology_slug: "triggers-barriers", signal_type: "trigger", composite_score: "0.8", frequency: 10, evidence_count: 3 }),
    row({ canonical_signal_id: "tb-2", methodology_slug: "triggers-barriers", signal_type: "barrier", canonical_title: "Contrato que amarra", composite_score: "0.9", frequency: 7, evidence_count: 5 }),
    row({ canonical_signal_id: "no-1", methodology_slug: "narrative-ownership", signal_type: "narrative", canonical_title: "La narrativa de cobertura confiable", composite_score: "0.7", frequency: 20, evidence_count: 8 })
  ].map(normalizeComposerRow);

  const modules = buildComposerModules(rows);

  assert.equal(modules.length, 2);
  assert.equal(modules[0]?.methodology_slug, "narrative-ownership");
  assert.equal(modules[0]?.total_frequency, 20);
  assert.equal(modules[1]?.methodology_slug, "triggers-barriers");
  assert.deepEqual(modules[1]?.signal_types, { trigger: 1, barrier: 1 });
  assert.deepEqual(modules[1]?.top_signals.map((signal) => signal.canonical_signal_id), ["tb-2", "tb-1"]);
});

test("composer filters selected methodologies and signal types without mutating rows", () => {
  const rows = [
    row({ canonical_signal_id: "tb-1", methodology_slug: "triggers-barriers", signal_type: "trigger" }),
    row({ canonical_signal_id: "vpm-1", methodology_slug: "value-perception-matrix", signal_type: "value_signal" }),
    row({ canonical_signal_id: "jfm-1", methodology_slug: "journey-friction-mapping", signal_type: "journey_friction" })
  ].map(normalizeComposerRow);

  const vpmOnly = filterComposerSignals(rows, { methodologies: [" VALUE-PERCEPTION-MATRIX "] });
  const triggerOnly = filterComposerSignals(rows, { signalTypes: ["trigger"] });
  const none = filterComposerSignals(rows, { methodologies: ["narrative-ownership"], signalTypes: ["trigger"] });

  assert.deepEqual(vpmOnly.map((signal) => signal.canonical_signal_id), ["vpm-1"]);
  assert.deepEqual(triggerOnly.map((signal) => signal.canonical_signal_id), ["tb-1"]);
  assert.deepEqual(none, []);
  assert.equal(rows.length, 3);
});

test("composer separates opportunities from risks", () => {
  const trigger = normalizeComposerRow(row({ signal_type: "trigger", sentiment: "0.1" }));
  const rising = normalizeComposerRow(row({ signal_type: "white_space", delta_vs_previous: "2", sentiment: "0.0" }));
  const barrier = normalizeComposerRow(row({ signal_type: "barrier", sentiment: "0.1" }));
  const negative = normalizeComposerRow(row({ signal_type: "narrative", sentiment: "-0.4" }));
  const categoryNeed = normalizeComposerRow(row({
    signal_type: "category_need",
    sentiment: "0.0",
    delta_vs_previous: "0",
    dimensions: { opportunity_score: 120, coverage_score: 0.2 }
  }));
  const whitespace = normalizeComposerRow(row({
    signal_type: "whitespace_signal",
    sentiment: "0.0",
    delta_vs_previous: "0",
    dimensions: { whitespace_score: 75, whitespace_classification: "capturable" }
  }));
  const decisionBlocker = normalizeComposerRow(row({
    signal_type: "decision_factor",
    sentiment: "0.0",
    dimensions: { blocker_score: 120, accelerator_score: 20, velocity_index: -71.4 }
  }));
  const decisionAccelerator = normalizeComposerRow(row({
    signal_type: "decision_factor",
    sentiment: "0.0",
    dimensions: { blocker_score: 10, accelerator_score: 55, velocity_index: 69.2 }
  }));

  assert.equal(isComposerOpportunity(trigger), true);
  assert.equal(isComposerOpportunity(rising), true);
  assert.equal(isComposerOpportunity(categoryNeed), true);
  assert.equal(isComposerOpportunity(whitespace), true);
  assert.equal(isComposerOpportunity(decisionAccelerator), true);
  assert.equal(isComposerRisk(barrier), true);
  assert.equal(isComposerRisk(negative), true);
  assert.equal(isComposerRisk(decisionBlocker), true);
  assert.equal(isComposerOpportunity(barrier), false);
  assert.equal(isComposerOpportunity(negative), false);
  assert.equal(isComposerOpportunity(decisionBlocker), false);
});

test("composer builds deterministic draft manifest for future editorial save", () => {
  const rows = [
    row({
      canonical_signal_id: "tb-1",
      observation_id: "obs-1",
      methodology_slug: "triggers-barriers",
      signal_type: "trigger",
      semantic_key: "precio-claro",
      canonical_title: "Precio claro",
      evidence_examples: [{ observation_id: "obs-1", mention_id: "mention-1", quote: "El precio claro ayuda.", platform: "reviews" }]
    }),
    row({
      canonical_signal_id: "vpm-1",
      observation_id: "obs-2",
      methodology_slug: "value-perception-matrix",
      signal_type: "value_signal",
      semantic_key: "precio-claro",
      canonical_title: "Precio claro",
      composite_score: "0.9",
      evidence_examples: [{ observation_id: "obs-2", mention_id: "mention-2", quote: "Pago lo justo.", platform: "twitter" }]
    }),
    row({
      canonical_signal_id: "risk-1",
      observation_id: "obs-3",
      methodology_slug: "trust-risk-benchmark",
      signal_type: "risk_theme",
      semantic_key: "cobro-indebido",
      canonical_title: "Cobro indebido",
      sentiment: "-0.6",
      evidence_examples: [{ observation_id: "obs-3", mention_id: "mention-3", quote: "Me cobraron doble.", platform: "reviews" }]
    })
  ].map(normalizeComposerRow);
  const dedupedRows = dedupeComposerSignals(rows);
  const modules = buildComposerModules(rows);
  const opportunities = dedupedRows.filter(isComposerOpportunity);
  const risks = dedupedRows.filter(isComposerRisk);

  const draft = buildComposerDraft({
    rows,
    dedupedRows,
    modules,
    opportunities,
    risks,
    selection: { methodologies: ["triggers-barriers", "value-perception-matrix"] }
  });

  assert.equal(draft.kind, "live_composer_draft");
  assert.deepEqual(draft.module_slugs, ["triggers-barriers", "value-perception-matrix", "trust-risk-benchmark"]);
  assert.deepEqual(draft.selected_canonical_signal_ids.sort(), ["risk-1", "vpm-1"]);
  assert.deepEqual(draft.supporting_signal_ids.sort(), ["risk-1", "tb-1", "vpm-1"]);
  assert.deepEqual(draft.supporting_observation_ids.sort(), ["obs-1", "obs-2", "obs-3"]);
  assert.deepEqual(draft.evidence_mention_ids.sort(), ["mention-1", "mention-2", "mention-3"]);
  assert.equal(draft.totals.raw_signals, 3);
  assert.equal(draft.totals.deduped_signals, 2);
});

test("composer builds editorial draft from selected modules and signals", () => {
  const rows = [
    row({
      canonical_signal_id: "tb-1",
      observation_id: "obs-1",
      methodology_slug: "triggers-barriers",
      signal_type: "trigger",
      semantic_key: "datos-productividad",
      canonical_title: "Datos para productividad",
      evidence_examples: [{ observation_id: "obs-1", mention_id: "mention-1", quote: "Quiero datos para trabajar.", platform: "x" }]
    }),
    row({
      canonical_signal_id: "vpm-1",
      observation_id: "obs-2",
      methodology_slug: "value-perception-matrix",
      signal_type: "value",
      semantic_key: "valor-precio",
      canonical_title: "Valor por precio",
      evidence_examples: [{ observation_id: "obs-2", mention_id: "mention-2", quote: "Pago por datos que rinden.", platform: "reviews" }]
    }),
    row({
      canonical_signal_id: "risk-1",
      observation_id: "obs-3",
      methodology_slug: "trust-risk-benchmark",
      signal_type: "risk",
      semantic_key: "riesgo-cobro",
      canonical_title: "Riesgo de cobro",
      evidence_examples: [{ observation_id: "obs-3", mention_id: "mention-3", quote: "Me cobraron de mas.", platform: "facebook" }]
    })
  ].map(normalizeComposerRow);
  const modules = buildComposerModules(rows);
  const dedupedRows = dedupeComposerSignals(rows);
  const baseDraft = buildComposerDraft({
    rows,
    dedupedRows,
    modules,
    opportunities: dedupedRows.filter(isComposerOpportunity),
    risks: dedupedRows.filter(isComposerRisk)
  });

  const editorial = buildComposerEditorialDraft({
    baseDraft,
    modules,
    opportunities: [rows[0]!, rows[1]!],
    risks: [rows[2]!],
    selectedModuleSlugs: ["triggers-barriers", "value-perception-matrix"],
    selectedCanonicalSignalIds: ["tb-1", "vpm-1", "risk-1"]
  });

  assert.equal(editorial.kind, "live_composer_editorial_draft");
  assert.deepEqual(editorial.module_slugs, ["triggers-barriers", "value-perception-matrix"]);
  assert.deepEqual(editorial.selected_canonical_signal_ids.sort(), ["tb-1", "vpm-1"]);
  assert.deepEqual(editorial.risk_signal_ids, []);
  assert.deepEqual(editorial.evidence_mention_ids.sort(), ["mention-1", "mention-2"]);
  assert.equal(editorial.totals.selected_modules, 2);
  assert.equal(editorial.totals.selected_signals, 2);
});

test("composer persists selected lens readiness into base, editorial and visible drafts", () => {
  const rows = [
    row({
      canonical_signal_id: "tb-1",
      observation_id: "obs-1",
      methodology_slug: "triggers-barriers",
      signal_type: "trigger"
    })
  ].map(normalizeComposerRow);
  const dedupedRows = dedupeComposerSignals(rows);
  const modules = buildComposerModules(rows);
  const opportunities = dedupedRows.filter(isComposerOpportunity);
  const risks = dedupedRows.filter(isComposerRisk);
  const lensStatuses = [
    {
      methodology_slug: "triggers-barriers",
      status: "active",
      engine_analysis_id: null,
      current_step: null,
      signals_in_range: 1,
      evidence_in_range: 4,
      message: "1 señal viva en el rango activo.",
      readiness: {
        status: "ready",
        hard_failures: [],
        warnings: [],
        summary: {
          requiredScopes: ["brand"],
          importedScopes: ["brand"],
          missingScopes: [],
          scopeCoverage: [{ scope: "brand", mentionCount: 12, status: "ready" }]
        }
      },
      quality_gates_failed: []
    },
    {
      methodology_slug: "journey-friction-map",
      status: "blocked",
      engine_analysis_id: null,
      current_step: null,
      signals_in_range: 0,
      evidence_in_range: 0,
      message: "Falta coverage de journey para correr este lente.",
      readiness: {
        status: "blocked",
        hard_failures: ["missing_scope:journey"],
        warnings: [],
        summary: {
          requiredScopes: ["journey"],
          importedScopes: [],
          missingScopes: ["journey"],
          scopeCoverage: [{ scope: "journey", mentionCount: 0, status: "missing" }]
        }
      },
      quality_gates_failed: [{ id: "coverage", detail: "Sin menciones de journey." }]
    }
  ];
  const draft = buildComposerDraft({ rows, dedupedRows, modules, opportunities, risks, lensStatuses });

  assert.equal(draft.lens_statuses.length, 2);
  assert.equal(draft.lens_status_summary.blocked, 1);
  assert.equal(draft.lens_statuses[1]?.message, "Falta coverage de journey para correr este lente.");

  const editorial = buildComposerEditorialDraft({
    baseDraft: draft,
    modules,
    opportunities,
    risks,
    selectedModuleSlugs: ["triggers-barriers"],
    selectedCanonicalSignalIds: ["tb-1"]
  });

  assert.equal(editorial.lens_statuses.length, 2);
  assert.equal(editorial.lens_status_summary.active, 1);

  const visible = applyComposerEditorialCut({
    modules,
    opportunities,
    risks,
    draft,
    editorial: {
      selection: editorial.selection,
      draft: editorial
    }
  });

  assert.equal(visible.draft?.lens_statuses.length, 2);
  assert.equal(visible.draft?.lens_status_summary.blocked, 1);
});

test("composer persists chart-level editorial selection by module", () => {
  const rows = [
    row({
      canonical_signal_id: "vpm-1",
      observation_id: "obs-1",
      methodology_slug: "value-perception-matrix",
      signal_type: "value",
      canonical_title: "Valor por precio"
    }),
    row({
      canonical_signal_id: "jfm-1",
      observation_id: "obs-2",
      methodology_slug: "journey-friction-mapping",
      signal_type: "journey_friction",
      canonical_title: "Activación confusa"
    })
  ].map(normalizeComposerRow);
  const dedupedRows = dedupeComposerSignals(rows);
  const modules = buildComposerModules(rows);
  const opportunities = dedupedRows.filter(isComposerOpportunity);
  const risks = dedupedRows.filter(isComposerRisk);
  const baseDraft = buildComposerDraft({ rows, dedupedRows, modules, opportunities, risks });

  assert.ok(baseDraft.selected_chart_keys.includes("value-perception-matrix:benefit_cost_heatmap"));
  assert.ok(baseDraft.selected_chart_keys.includes("journey-friction-mapping:journey_heatmap"));

  const editorial = buildComposerEditorialDraft({
    baseDraft,
    modules,
    opportunities,
    risks,
    selectedModuleSlugs: ["value-perception-matrix", "journey-friction-mapping"],
    selectedChartKeys: [
      "value-perception-matrix:benefit_cost_heatmap",
      "journey-friction-mapping:blockers_accelerators",
      "unknown:ignored"
    ],
    selectedCanonicalSignalIds: ["vpm-1", "jfm-1"]
  });

  assert.deepEqual(editorial.selected_chart_keys.sort(), [
    "journey-friction-mapping:blockers_accelerators",
    "value-perception-matrix:benefit_cost_heatmap"
  ]);
  assert.deepEqual(editorial.module_chart_keys, {
    "journey-friction-mapping": ["journey-friction-mapping:blockers_accelerators"],
    "value-perception-matrix": ["value-perception-matrix:benefit_cost_heatmap"]
  });
  assert.equal(editorial.totals.available_charts, 8);
  assert.equal(editorial.totals.selected_charts, 2);

  const visible = applyComposerEditorialCut({
    modules,
    opportunities,
    risks,
    draft: baseDraft,
    editorial: {
      selection: editorial.selection,
      draft: editorial
    }
  });

  assert.deepEqual(visible.draft?.selected_chart_keys.sort(), editorial.selected_chart_keys.sort());
  assert.equal((visible.draft?.totals as Record<string, number> | undefined)?.selected_charts, 2);
});

test("composer applies saved editorial cut to visible live modules without losing candidates", () => {
  const rows = [
    row({
      canonical_signal_id: "tb-1",
      observation_id: "obs-1",
      methodology_slug: "triggers-barriers",
      signal_type: "trigger",
      semantic_key: "datos-productividad",
      canonical_title: "Datos para productividad",
      frequency: 8,
      evidence_count: 2,
      evidence_examples: [{ observation_id: "obs-1", mention_id: "mention-1", quote: "Quiero datos para trabajar.", platform: "x" }]
    }),
    row({
      canonical_signal_id: "vpm-1",
      observation_id: "obs-2",
      methodology_slug: "value-perception-matrix",
      signal_type: "value",
      semantic_key: "valor-precio",
      canonical_title: "Valor por precio",
      frequency: 5,
      evidence_count: 3,
      evidence_examples: [{ observation_id: "obs-2", mention_id: "mention-2", quote: "Pago por datos que rinden.", platform: "reviews" }]
    }),
    row({
      canonical_signal_id: "risk-1",
      observation_id: "obs-3",
      methodology_slug: "trust-risk-benchmark",
      signal_type: "risk",
      semantic_key: "riesgo-cobro",
      canonical_title: "Riesgo de cobro",
      frequency: 12,
      evidence_count: 4,
      sentiment: "-0.8",
      evidence_examples: [{ observation_id: "obs-3", mention_id: "mention-3", quote: "Me cobraron de mas.", platform: "facebook" }]
    })
  ].map(normalizeComposerRow);
  const dedupedRows = dedupeComposerSignals(rows);
  const modules = buildComposerModules(rows);
  const opportunities = dedupedRows.filter(isComposerOpportunity);
  const risks = dedupedRows.filter(isComposerRisk);
  const draft = buildComposerDraft({ rows, dedupedRows, modules, opportunities, risks });
  const editorial = buildComposerEditorialDraft({
    baseDraft: draft,
    modules,
    opportunities,
    risks,
    selectedModuleSlugs: ["value-perception-matrix"],
    selectedCanonicalSignalIds: ["vpm-1", "risk-1"]
  });

  const visible = applyComposerEditorialCut({
    modules,
    opportunities,
    risks,
    draft,
    editorial: {
      selection: editorial.selection,
      draft: editorial
    }
  });

  assert.equal(visible.applied, true);
  assert.deepEqual(modules.map((module) => module.methodology_slug).sort(), [
    "triggers-barriers",
    "trust-risk-benchmark",
    "value-perception-matrix"
  ]);
  assert.deepEqual(visible.modules.map((module) => module.methodology_slug), ["value-perception-matrix"]);
  assert.deepEqual(visible.modules[0]?.top_signals.map((signal) => signal.canonical_signal_id), ["vpm-1"]);
  assert.equal(visible.modules[0]?.total_signals, 1);
  assert.equal(visible.modules[0]?.total_frequency, 5);
  assert.equal(visible.modules[0]?.evidence_count, 3);
  assert.deepEqual(visible.opportunities.map((signal) => signal.canonical_signal_id), ["vpm-1"]);
  assert.deepEqual(visible.risks, []);
  assert.equal(visible.draft?.kind, "live_composer_visible_draft");
  assert.deepEqual(visible.draft?.module_slugs, ["value-perception-matrix"]);
  assert.deepEqual(visible.draft?.selected_canonical_signal_ids, ["vpm-1"]);
  const visibleTotals = visible.draft?.totals as Record<string, number> | undefined;
  assert.equal(visibleTotals?.available_modules, 3);
  assert.equal(visibleTotals?.selected_modules, 1);
  assert.equal(visibleTotals?.selected_signals, 1);
});
