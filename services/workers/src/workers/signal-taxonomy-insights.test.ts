import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./signal-taxonomy-insights.ts", import.meta.url),
  "utf8"
);

test("taxonomy insights remain evidence-bound and use bounded web research", () => {
  assert.match(source, /supporting_mention_ids/u);
  assert.match(source, /counterevidence_mention_ids/u);
  assert.match(source, /webSearch_20250305/u);
  assert.match(source, /SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SEARCHES/u);
  assert.match(source, /External context never proves causality/u);
  assert.match(source, /Do not assume a country or market/u);
  assert.doesNotMatch(source, /country:\s*"MX"/u);
  assert.match(source, /causal_claims = '\[\]'::jsonb/u);
});

test("every sampled mention has a durable ledger and completed results are transactional", () => {
  assert.match(source, /upsertSampleAnalysisLedger/u);
  assert.match(source, /submitted_for_analysis/u);
  assert.match(source, /analysis_failed/u);
  assert.match(source, /analysis_status: "completed"/u);
  assert.match(source, /BEGIN/u);
  assert.match(source, /record_feature_values/u);
  assert.match(source, /analyzed_not_cited/u);
  assert.match(source, /metric_interpretation/u);
  assert.match(source, /anthropic:web_search/u);
  assert.match(source, /COMMIT/u);
});
