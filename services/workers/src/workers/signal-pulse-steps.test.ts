import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmbeddingNeighborhoodClusters,
  selectPeriodFirstSignalPulseClusters,
  selectSignalPulseClusterPhrase,
  type EmbeddingNeighborhoodRow
} from "./signal-pulse-clustering";
import {
  estimateSignalPulseNamingCostUsd,
  estimateSignalPulseRunCostUsd,
  SIGNAL_PULSE_INTERPRETATION_COST_USD,
  SIGNAL_PULSE_RAG_CONTEXT_COST_USD,
  shouldSkipSignalPulseLlmForBudget
} from "./signal-pulse-budget";
import { buildClaudeSignalNamingPrompt } from "./signal-pulse-prompts";
import { buildSignalPulseDeterministicRead, buildSignalPulseMarketingMove } from "./signal-pulse-copy";
import { splitSignalPulseMetaForMerge } from "./signal-pulse-meta";
import { isActionableSignalPulseTerm, isRawKeywordSignalPhrase } from "./signal-pulse-actionability";
import { chooseSignalPulseWindowEnd } from "./signal-pulse-window";

test("Signal Pulse embedding clusters group semantic neighborhoods without reusing mentions", () => {
  const rows: EmbeddingNeighborhoodRow[] = [
    row("a", "a", "Crujiente intenso para botanear viendo futbol", "tiktok", "0.42", "18", "1"),
    row("a", "b", "La botana crujiente queda perfecta con limon y chile", "tiktok", "0.31", "9", "0.86"),
    row("a", "c", "Ese crunch con chile se antoja para una tarde con amigos", "instagram", "0.28", "12", "0.82"),
    row("a", "d", "Me gusta el snack crujiente para compartir", "instagram", "0.22", "5", "0.79"),
    row("b", "b", "La botana crujiente queda perfecta con limon y chile", "tiktok", "0.31", "9", "1"),
    row("b", "e", "El empaque nuevo se ve mas premium en anaquel", "facebook", "0.18", "7", "0.81"),
    row("b", "f", "La bolsa roja destaca mucho en la tienda", "facebook", "0.16", "4", "0.8"),
    row("b", "g", "El diseno del empaque llama la atencion", "instagram", "0.19", "6", "0.78")
  ];

  const clusters = buildEmbeddingNeighborhoodClusters(rows);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.algorithm, "semantic_embedding_neighborhood_v1");
  assert.deepEqual(clusters[0]?.member_mention_ids, ["a", "b", "c", "d"]);
  assert.deepEqual(clusters[0]?.platforms, ["tiktok", "instagram"]);
  assert.equal(clusters[0]?.mention_count, 4);
  assert.equal(clusters[0]?.sentiment_avg, 0.308);
});

test("Signal Pulse semantic phrase selection prefers repeated marketing language", () => {
  const phrase = selectSignalPulseClusterPhrase([
    "Quiero una botana crujiente con chile para ver el partido.",
    "La botana crujiente con limon funciona perfecto en reuniones.",
    "Ese snack crujiente con chile se siente mas antojable.",
    "Botana crujiente para compartir con amigos."
  ]);

  assert.match(phrase, /crujiente/);
  assert.doesNotMatch(phrase, /para/);
});

test("Signal Pulse period-first selection keeps a month-specific signal outside the global top", () => {
  const globalClusters = Array.from({ length: 6 }, (_, index) => cluster({
    term: `global ${index}`,
    mentionCount: 100 - index,
    memberIds: [`g${index}-1`, `g${index}-2`, `g${index}-3`, `g${index}-4`],
    source: "global"
  }));
  const januarySpike = cluster({
    term: "renovacion enero urgente",
    mentionCount: 9,
    memberIds: ["jan-1", "jan-2", "jan-3", "jan-4", "jan-5", "jan-6", "jan-7", "jan-8", "jan-9"],
    source: "period_first",
    periods: ["2025-01"]
  });

  const selected = selectPeriodFirstSignalPulseClusters({
    globalClusters,
    periodClusters: [januarySpike],
    maxClusters: 4,
    perPeriod: 1
  });

  assert.equal(selected.some((item) => item.term === "renovacion enero urgente"), true);
  assert.equal(selected.length, 4);
  assert.deepEqual(selected.find((item) => item.term === "renovacion enero urgente")?.discovery_periods, ["2025-01"]);
});

test("Signal Pulse deterministic copy marks clusters as synthesis backlog, not client-ready insights", () => {
  const copy = buildSignalPulseDeterministicRead({
    canonicalTitle: "Territorio botana crujiente con chile",
    term: "botana crujiente con chile",
    signalType: "opportunity",
    mentionCount: 64,
    sentimentAvg: 0.31,
    platforms: ["tiktok", "instagram"],
    rank: 1
  });

  assert.equal(copy.title, "Cluster pendiente de síntesis: Botana Crujiente Con Chile");
  assert.match(copy.description, /64 menciones/);
  assert.match(copy.description, /todavía no hay una lectura editorial publicable/);
  assert.match(copy.marketingRead, /no debe entrar al Pulse/);
  assert.match(copy.actionHint, /sintetizar el porqué/);
  assert.doesNotMatch(copy.description, /La conversacion esta agrupando/i);
  assert.doesNotMatch(copy.description, /senal|conclusion|esta empujando/i);
  assert.doesNotMatch(copy.marketingRead, /Probar contenido o pauta alrededor/i);
});

test("Signal Pulse deterministic copy never turns risk clusters into publishable frictions by itself", () => {
  const risk = buildSignalPulseDeterministicRead({
    canonicalTitle: "Territorio empaque roto",
    term: "empaque roto",
    signalType: "risk",
    mentionCount: 18,
    sentimentAvg: -0.34,
    platforms: ["facebook"],
    rank: 2
  });
  const directional = buildSignalPulseDeterministicRead({
    canonicalTitle: "Territorio merch especial",
    term: "merch especial",
    signalType: "marketing_signal",
    mentionCount: 6,
    sentimentAvg: 0.02,
    platforms: [],
    rank: 5
  });

  assert.equal(risk.title, "Cluster pendiente de síntesis: Empaque Roto");
  assert.match(risk.marketingRead, /Pendiente de síntesis/);
  assert.match(risk.actionHint, /Revisar muestras/);
  assert.equal(directional.title, "Cluster pendiente de síntesis: Merch Especial");
  assert.match(directional.description, /apenas alcanzan para monitoreo/);
  assert.match(directional.actionHint, /sintetizar/);
});

test("Signal Pulse accepts raw cluster anchors but still identifies raw output phrases", () => {
  for (const term of ["seguro", "aseguradora", "choque", "seguro auto"]) {
    assert.equal(isActionableSignalPulseTerm(term), true, term);
    assert.equal(isRawKeywordSignalPhrase(term), true, term);
  }

  assert.equal(isActionableSignalPulseTerm("renovacion enero urgente"), true);
  assert.equal(isRawKeywordSignalPhrase("renovacion enero urgente"), false);
  assert.equal(isActionableSignalPulseTerm("morena"), false);
});

test("Signal Pulse marketing moves reuse the signal action hint and define measurement", () => {
  const move = buildSignalPulseMarketingMove({
    title: "Oportunidad: Botana Crujiente Con Chile",
    moveType: "amplify",
    lifecycle: "rising",
    confidence: "alta",
    impact: 72,
    volume: 96,
    marketingRead: "La señal trae energía positiva suficiente para probarla como ángulo creativo.",
    actionHint: "Testear botana crujiente con chile como hook principal en una celda pequeña de pauta"
  });

  assert.match(move.actionText, /Testear botana crujiente con chile/);
  assert.match(move.actionText, /distribución controlada/);
  assert.equal(move.ownerSuggestion, "Paid media + Brand");
  assert.equal(move.timing, "este mes");
  assert.match(move.measurementSuggestion, /CTR/);
  assert.equal(move.noGoNotes, null);
  assert.doesNotMatch(move.actionText, /Amplificar .* en pauta y comparar contra el territorio actual/);
});

test("Signal Pulse marketing moves keep weak signals as bounded experiments", () => {
  const move = buildSignalPulseMarketingMove({
    title: "Merch Especial",
    moveType: "create_content",
    lifecycle: "stable",
    confidence: "baja",
    impact: 28,
    volume: 7,
    marketingRead: "",
    actionHint: ""
  });

  assert.match(move.actionText, /experimento de contenido/);
  assert.doesNotMatch(move.actionText, /Bajarlo a una serie corta de contenido/);
  assert.equal(move.ownerSuggestion, "Social + Content");
  assert.equal(move.timing, "siguiente sprint");
  assert.match(move.measurementSuggestion, /7 menciones/);
  assert.match(move.noGoNotes ?? "", /No convertirlo en promesa fuerte/);
});

test("Signal Pulse budget estimate stays cluster-first and bounded before running", () => {
  assert.equal(estimateSignalPulseNamingCostUsd(0), 0.015);
  assert.equal(estimateSignalPulseNamingCostUsd(100), 0.36);
  assert.equal(SIGNAL_PULSE_RAG_CONTEXT_COST_USD, 0.02);
  assert.equal(estimateSignalPulseRunCostUsd(1), 0.185);
  assert.equal(SIGNAL_PULSE_INTERPRETATION_COST_USD, 0.15);
  assert.equal(estimateSignalPulseRunCostUsd(6000), 0.53);
});

test("Signal Pulse Claude naming prompt uses marketing-first RAG context, not T&B labels", () => {
  const prompt = buildClaudeSignalNamingPrompt([
    {
      id: "00000000-0000-4000-8000-000000000001",
      current_title: "Territorio seguro",
      signal_type: "risk",
      term: "seguro",
      rank: 1,
      mention_count: 134,
      sentiment_avg: -0.22,
      platforms: ["facebook", "tiktok"],
      discovery_periods: ["2026-05"],
      max_period_mention_count: 134,
      samples: [
        { text: "No queda claro quien responde en un choque en cadena.", platform: "facebook", published_at: "2026-05-18" }
      ],
      context: {
        period_series: [
          {
            granularity: "month",
            label: "2026-04",
            period_start: "2026-04-01",
            period_end: "2026-04-30",
            volume: 44,
            delta_prev: null,
            engagement: 20,
            sentiment_avg: -0.12,
            source_mix: { facebook: 44 },
            lifecycle_state: "stable"
          },
          {
            granularity: "month",
            label: "2026-05",
            period_start: "2026-05-01",
            period_end: "2026-05-31",
            volume: 134,
            delta_prev: 90,
            engagement: 72,
            sentiment_avg: -0.22,
            source_mix: { facebook: 90, tiktok: 44 },
            lifecycle_state: "rising"
          }
        ],
        weekly_series: [
          {
            granularity: "week",
            label: "2026-W20",
            period_start: "2026-05-11",
            period_end: "2026-05-17",
            volume: 28,
            delta_prev: null,
            engagement: 19,
            sentiment_avg: -0.2,
            source_mix: { facebook: 20, tiktok: 8 },
            lifecycle_state: "new"
          },
          {
            granularity: "week",
            label: "2026-W21",
            period_start: "2026-05-18",
            period_end: "2026-05-24",
            volume: 84,
            delta_prev: 56,
            engagement: 45,
            sentiment_avg: -0.27,
            source_mix: { facebook: 52, tiktok: 32 },
            lifecycle_state: "accelerating"
          }
        ],
        window_pattern: {
          current_period: "2026-05",
          current_volume: 134,
          previous_volume: 44,
          delta_prev: 90,
          active_periods: 2,
          first_active_period: "2026-04",
          last_active_period: "2026-05",
          peak_period: "2026-05",
          peak_volume: 134,
          lifecycle_state: "rising"
        },
        weekly_pattern: {
          current_period: "2026-W21",
          current_volume: 84,
          previous_volume: 28,
          delta_prev: 56,
          active_periods: 2,
          first_active_period: "2026-W20",
          last_active_period: "2026-W21",
          peak_period: "2026-W21",
          peak_volume: 84,
          lifecycle_state: "accelerating"
        },
        performance_context: {
          active_months: [
            {
              month: "2026-05",
              records: 42,
              spend: 1200,
              impressions: 88000,
              clicks: 940,
              engagement: 1800,
              avg_ctr: 0.012,
              platforms: ["meta"],
              channels: ["paid"]
            }
          ],
          matching_creatives: [
            {
              record_date: "2026-05-10",
              platform: "meta",
              channel: "paid",
              entity_kind: "ad",
              entity_name: "Confianza auto",
              objective: "traffic",
              spend: 300,
              impressions: 18000,
              clicks: 210,
              engagement: 330,
              creative_text: "Seguro de auto con respuesta rapida"
            }
          ]
        },
        knowledge_matches: [
          {
            title: "Brief mayo",
            source_kind: "brand_document",
            text: "La campaña de mayo empuja confianza y respuesta rapida.",
            similarity: 0.82
          }
        ]
      }
    }
  ], {
    marketing_brief: {
      active_campaigns: ["Confianza auto"],
      allowed_claims: ["respuesta clara"],
      prohibited_claims: ["resolver todo al instante"]
    },
    knowledge_sources: [
      { type: "brand_document", content: { summary: "Marca regional de seguros con foco en cercania." } }
    ],
    source_inventory: [
      { source_type: "performance", provider: "meta", name: "Meta 12m", status: "active", visibility: "internal" }
    ],
    performance_window: [
      {
        month: "2026-05",
        records: 42,
        spend: 1200,
        impressions: 88000,
        clicks: 940,
        engagement: 1800,
        avg_ctr: 0.012,
        platforms: ["meta"],
        channels: ["paid"]
      }
    ],
    rag: {
      semantic_available: true,
      embedding_model: "voyage-4-large",
      retrieval_scope: "brand_knowledge_sources + structured performance_records"
    }
  });

  assert.match(prompt, /12 meses/);
  assert.match(prompt, /serie semanal/);
  assert.match(prompt, /performance_records/);
  assert.match(prompt, /Riesgo creativo/);
  assert.match(prompt, /Gap de pauta/);
  assert.match(prompt, /Brief mayo/);
  assert.match(prompt, /2026-05/);
  assert.match(prompt, /no_connection/);
  assert.doesNotMatch(prompt, /Triggers & Barriers/);
  assert.doesNotMatch(prompt, /"Barrera:/);
  assert.doesNotMatch(prompt, /"Trigger:/);
});

test("Signal Pulse LLM budget guard reserves the next cluster-level call", () => {
  assert.deepEqual(
    shouldSkipSignalPulseLlmForBudget({
      currentCostUsd: 0.2,
      budgetCapUsd: 0.5,
      estimatedNextCostUsd: 0.15
    }),
    { skip: false, reason: null }
  );
  assert.deepEqual(
    shouldSkipSignalPulseLlmForBudget({
      currentCostUsd: 0.42,
      budgetCapUsd: 0.5,
      estimatedNextCostUsd: 0.15
    }),
    { skip: true, reason: "budget_would_exceed:0.42+0.15/0.5" }
  );
  assert.deepEqual(
    shouldSkipSignalPulseLlmForBudget({
      currentCostUsd: 0.5,
      budgetCapUsd: 0.5,
      estimatedNextCostUsd: 0.015
    }),
    { skip: true, reason: "budget_exhausted:0.5/0.5" }
  );
});

test("Signal Pulse meta merge keeps root quality gates next to nested signal pulse data", () => {
  const qualityGates = [{ id: "source_presence", passed: true, detail: "24 señales." }];
  const { signalPulseMeta, rootMeta } = splitSignalPulseMetaForMerge({
    signal_pulse: { gates: { failed_gates: 0 } },
    quality_gates: qualityGates
  });

  assert.deepEqual(signalPulseMeta, { gates: { failed_gates: 0 } });
  assert.deepEqual(rootMeta, { quality_gates: qualityGates });
});

test("Signal Pulse window closes on structured performance when conversation has a partial newer month", () => {
  assert.equal(
    chooseSignalPulseWindowEnd({
      maxMentionDate: "2026-06-13",
      maxPerformanceDate: "2026-05-31",
      fallbackDate: "2026-06-14"
    }),
    "2026-05-31"
  );
  assert.equal(
    chooseSignalPulseWindowEnd({
      maxMentionDate: "2026-05-29",
      maxPerformanceDate: "2026-05-31",
      fallbackDate: "2026-06-14"
    }),
    "2026-05-29"
  );
});

function row(
  anchor_id: string,
  mention_id: string,
  text_clean: string,
  platform: string,
  sentiment_score: string,
  engagement_score: string,
  similarity: string
): EmbeddingNeighborhoodRow {
  return { anchor_id, mention_id, text_clean, platform, sentiment_score, engagement_score, similarity };
}

function cluster(args: {
  term: string;
  mentionCount: number;
  memberIds: string[];
  source: "global" | "period_first";
  periods?: string[];
}) {
  return {
    term: args.term,
    mention_count: args.mentionCount,
    platforms: ["tiktok"],
    member_mention_ids: args.memberIds,
    sample_mention_ids: args.memberIds.slice(0, 4),
    sentiment_avg: 0.1,
    engagement_sum: args.mentionCount * 2,
    algorithm: "term_cluster_v2" as const,
    discovery_source: args.source,
    discovery_periods: args.periods ?? [],
    max_period_mention_count: args.periods?.length ? args.mentionCount : undefined
  };
}
