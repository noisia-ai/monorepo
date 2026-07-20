import assert from "node:assert/strict";
import test from "node:test";

import { buildPreflightPrompt, renderTbRagContext } from "./tb";

test("T&B prompts carry governed structured observations alongside listening", () => {
  const prompt = buildPreflightPrompt({
    brandName: "Laika",
    businessQuestion: "What moves repeat purchase?",
    totalMentions: 1200,
    sources: [{ name: "instagram", count: 1200, pct: 100 }],
    windowMonths: 12,
    languageDistribution: [{ lang: "es", pct: 100 }],
    ragContext: {
      structured_observations: {
        source: "data_observations_sql",
        contract: "noisia_data_os_cut_1",
        monthly_series: [
          { month: "2026-01", metric_key: "sales_monthly", value: 100 },
          { month: "2026-01", metric_key: "mentions_monthly", value: 40 }
        ]
      }
    }
  });

  assert.match(prompt, /structured_observations/);
  assert.match(prompt, /sales_monthly/);
  assert.match(prompt, /mentions_monthly/);
  assert.match(prompt, /noisia_data_os_cut_1/);
});

test("T&B RAG compaction keeps valid JSON and every governed source inventory item", () => {
  const sourceInventory = Array.from({ length: 24 }, (_, index) => ({
    file_name: `source-${index + 1}.csv`,
    status: "ready",
    canonical_record_store: "data_asset_records",
    rows: { expected_source: 5_000, canonical: 5_000, accepted: 5_000 },
    observations: { accepted: 2_000, review_required: 0, rejected: 0 },
    semantic: {
      dataset_roles: ["ecommerce_sales"],
      metric_keys: Array.from({ length: 30 }, (_, metric) => `metric-${metric + 1}`),
      entity_labels_sample: Array.from({ length: 12 }, (_, entity) => `entity-${entity + 1}`)
    },
    quality: { status: "passed", blockers: [], warnings: [] },
    lineage: { complete: true }
  }));
  const rendered = renderTbRagContext({
    query_strategy_brief: { summary: "Q".repeat(20_000) },
    knowledge_sources: Array.from({ length: 8 }, (_, index) => ({
      type: "source",
      content: { summary: `${index}-${"K".repeat(10_000)}` }
    })),
    corpus_intelligence: { narrative: "C".repeat(40_000) },
    structured_observations: {
      contract: "noisia_data_os_cut_1",
      source_inventory: sourceInventory,
      monthly_series: Array.from({ length: 200 }, (_, index) => ({
        month: `2026-${String((index % 12) + 1).padStart(2, "0")}`,
        metric_key: `metric-${index}`,
        value: index
      }))
    }
  });
  const parsed = JSON.parse(rendered) as {
    structured_observations: { source_inventory: Array<{ file_name: string }> };
  };

  assert.ok(rendered.length <= 36_000);
  assert.equal(parsed.structured_observations.source_inventory.length, 24);
  assert.equal(parsed.structured_observations.source_inventory[23]?.file_name, "source-24.csv");
});
