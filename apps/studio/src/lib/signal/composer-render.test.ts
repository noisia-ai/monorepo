import assert from "node:assert/strict";
import test from "node:test";

import { engineChartComposerKey, filterEngineBlocksForComposerSelection } from "./composer-render";
import type { EngineMethodologyBlock } from "./contracts";

const vpmBlock: EngineMethodologyBlock = {
  kind: "value-perception-matrix",
  methodology_slug: "value-perception-matrix",
  title: "VPM",
  subtitle: null,
  summary: "Value perception",
  methodology_view: {
    kind: "value-perception-matrix",
    title: "Value perception",
    primary_question: "Value?",
    readiness: {
      status: "beta_ready",
      reason: "ready",
      missing: []
    },
    cards: [],
    rows: [
      row("value_funcional_tiempo"),
      row("value_social_cognitivo")
    ],
    conclusions: [
      {
        kind: "protect",
        title: "Protect value",
        detail: "Keep the useful value signal.",
        finding_ids: ["value_funcional_tiempo"]
      },
      {
        kind: "watch",
        title: "Watch social cost",
        detail: "Remove this when signal is omitted.",
        finding_ids: ["value_social_cognitivo"]
      }
    ]
  },
  charts: [
    chart("value-perception-matrix-heatmap", "heatmap", [
      { finding_key: "value_funcional_tiempo", name: "Useful and fast" },
      { finding_key: "value_social_cognitivo", name: "Social cost" }
    ]),
    chart("value-perception-matrix-matrix_2x2", "matrix_2x2"),
    chart("value-perception-matrix-bar_ranking", "bar_ranking"),
    chart("value-perception-matrix-evidence_list", "evidence_list"),
    chart("value-perception-matrix-confidence_badge", "confidence_badge")
  ],
  findings: [
    finding("value_funcional_tiempo", "Useful and fast"),
    finding("value_social_cognitivo", "Social cost")
  ],
  evidence_index: [
    { finding_id: "value_funcional_tiempo", mention_ids: ["mention-1"] },
    { finding_id: "value_social_cognitivo", mention_ids: ["mention-2"] }
  ],
  limitations: []
};

const narrativeBlock: EngineMethodologyBlock = {
  ...vpmBlock,
  kind: "narrative-ownership",
  methodology_slug: "narrative-ownership",
  title: "Narrative Ownership",
  charts: [
    chart("narrative-ownership-stacked_share", "stacked_share"),
    chart("narrative-ownership-matrix_2x2", "matrix_2x2")
  ]
};

test("composer render keeps legacy engine blocks when no editorial selection exists", () => {
  const blocks = filterEngineBlocksForComposerSelection([vpmBlock, narrativeBlock], null);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.charts.length, 5);
});

test("composer render filters engine blocks and charts from saved editorial selection", () => {
  const blocks = filterEngineBlocksForComposerSelection([vpmBlock, narrativeBlock], {
    active: true,
    modules: ["value-perception-matrix"],
    chartKeys: ["value-perception-matrix:benefit_cost_heatmap", "value-perception-matrix:evidence"]
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.methodology_slug, "value-perception-matrix");
  assert.deepEqual(blocks[0]?.charts.map((item) => engineChartComposerKey(blocks[0]!, item)), [
    "value-perception-matrix:benefit_cost_heatmap",
    "value-perception-matrix:evidence"
  ]);
});

test("composer render filters engine findings and chart rows from saved signal selection", () => {
  const blocks = filterEngineBlocksForComposerSelection([vpmBlock], {
    active: true,
    modules: ["value-perception-matrix"],
    chartKeys: ["value-perception-matrix:benefit_cost_heatmap"],
    signalFilteringActive: true,
    signalFindingKeys: ["value_funcional_tiempo"]
  });

  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0]?.findings.map((item) => item.finding_id), ["value_funcional_tiempo"]);
  assert.deepEqual(blocks[0]?.evidence_index.map((item) => item.finding_id), ["value_funcional_tiempo"]);
  assert.deepEqual(blocks[0]?.methodology_view?.rows.map((item) => item.finding_id), ["value_funcional_tiempo"]);
  assert.deepEqual(blocks[0]?.methodology_view?.conclusions.map((item) => item.title), ["Protect value"]);
  assert.deepEqual(blocks[0]?.charts[0]?.data, [
    { finding_key: "value_funcional_tiempo", name: "Useful and fast" }
  ]);
});

test("composer render recalculates confidence badge from visible signals", () => {
  const blocks = filterEngineBlocksForComposerSelection([vpmBlock], {
    active: true,
    modules: ["value-perception-matrix"],
    chartKeys: ["value-perception-matrix:confidence_badge"],
    signalFilteringActive: true,
    signalFindingKeys: ["value_funcional_tiempo"]
  });

  assert.deepEqual(blocks[0]?.charts[0]?.data, {
    alta: 0,
    media: 1,
    baja_direccional: 0
  });
});

test("composer render can intentionally hide all engine findings for a selected lens", () => {
  const blocks = filterEngineBlocksForComposerSelection([vpmBlock], {
    active: true,
    modules: ["value-perception-matrix"],
    chartKeys: ["value-perception-matrix:benefit_cost_heatmap"],
    signalFilteringActive: true,
    signalFindingKeys: []
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.findings.length, 0);
  assert.deepEqual(blocks[0]?.charts[0]?.data, []);
});

function chart(chart_id: string, type: EngineMethodologyBlock["charts"][number]["type"], data: unknown = []) {
  return {
    chart_id,
    type,
    title: chart_id,
    data,
    evidence_ids: [],
    confidence: "media" as const
  };
}

function finding(finding_id: string, title: string) {
  return {
    finding_id,
    title,
    dimensions: {},
    score: 1,
    ownership: null,
    evidence_count: 1,
    public_quote: null,
    confidence: "media" as const
  };
}

function row(finding_id: string) {
  return {
    finding_id,
    label: finding_id,
    axis: null,
    entity: null,
    score: 1,
    evidence_count: 1,
    confidence: "media" as const,
    dimensions: {}
  };
}
