import assert from "node:assert/strict";
import test from "node:test";

import { compactKnowledgeContent } from "./rag-context-compaction";

test("compacts source context without forwarding tabular payloads", () => {
  const compacted = compactKnowledgeContent(
    "Sales archive",
    {
      summary: "Revenue and orders by month.",
      fields: ["month", "revenue", "orders"],
      rows: Array.from({ length: 10_000 }, (_, index) => ({ month: index, revenue: index * 10 })),
      recommended_use: ["query_evaluation", "signal_render"]
    },
    "Monthly sales source"
  );
  const serialized = JSON.stringify(compacted);

  assert.ok(serialized.length < 8_000);
  assert.equal(serialized.includes("\"rows\""), false);
  assert.match(serialized, /Revenue and orders by month/);
  assert.match(serialized, /revenue/);
});

test("normalizes a query strategy brief to its bounded contract", () => {
  const compacted = compactKnowledgeContent(
    "Query Strategy Brief",
    {
      source: "query_strategy_brief",
      summary: "x".repeat(5_000),
      priority_topics: Array.from({ length: 30 }, (_, index) => `topic-${index}`),
      audience_clues: [],
      competitor_hypotheses: [],
      query_language: [],
      exclusions_or_noise: [],
      brand_query_role: "brand",
      competitor_query_role: "competitor",
      industry_query_role: "industry",
      must_answer: [],
      limitations: [],
      rows: Array.from({ length: 1_000 }, () => "never forward")
    },
    null
  ) as { summary: string; priority_topics: string[] };

  assert.equal(compacted.summary.length, 1_200);
  assert.equal(compacted.priority_topics.length, 12);
  assert.equal(JSON.stringify(compacted).includes("never forward"), false);
});
