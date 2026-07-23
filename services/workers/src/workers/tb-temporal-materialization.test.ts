import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";

import { materializeTbTemporalAnalysis } from "./tb-temporal-materialization";

test("materializes a frozen T&B scope without reading current operational ingestion", async () => {
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      const normalized = text.replace(/\s+/gu, " ").trim();
      queries.push(normalized);
      if (normalized.includes("analysis.methodology_slug") && normalized.includes("WHERE analysis.id = $1")) {
        return {
          rows: [{
            id: "analysis-current",
            workspace_subject_key: "brand:1",
            study_corpus_id: "corpus-1",
            corpus_revision: 3,
            snapshot_id: "snapshot-1",
            snapshot_digest: "md5:frozen",
            snapshot_mention_count: 100,
            period_start: "2026-02-01",
            period_end: "2026-02-28",
            methodology_slug: "triggers-barriers",
            methodology_version: "1.0",
            pipeline_version: "pipeline-1",
            prompt_version: "prompt-1",
            model_version: "model-1"
          }]
        };
      }
      if (normalized.includes("WITH current_scope AS")) return { rows: [] };
      if (normalized.includes("INSERT INTO tb_temporal_metrics")) return { rows: [], rowCount: 12 };
      if (normalized.includes("FROM tb_findings finding")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    }
  } as unknown as PoolClient;

  const result = await materializeTbTemporalAnalysis(client, "analysis-current");
  assert.equal(result.metrics, 12);
  assert.equal(result.comparisonBaseAnalysisId, null);
  assert.equal(result.compatibilityState, "not_evaluated");
  const materialization = queries.find((query) => query.includes("INSERT INTO tb_temporal_metrics")) ?? "";
  assert.match(materialization, /JOIN corpus_snapshot_mentions/);
  assert.match(materialization, /snapshot_mention\.snapshot_id = analysis_scope\.snapshot_id/);
  assert.match(materialization, /dimension_kind = grouped\.dimension_kind/);
  assert.match(materialization, /WHEN 'finding\.share' THEN denominator_count::numeric/);
  assert.ok(queries.some((query) => query.includes("metric.dimensions ->> 'grain' = 'default'")));
  assert.doesNotMatch(materialization, /inclusion_status = 'included'/);
  assert.ok(queries.some((query) => query.includes("comparison_compatibility_state")));
});
