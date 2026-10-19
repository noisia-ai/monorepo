import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Signal materialization is deterministic, bounded and behind the disabled Data OS worker", async () => {
  const [materializer, invalidator, queue, entrypoint] = await Promise.all([
    readFile(new URL("./signal-materialization.ts", import.meta.url), "utf8"),
    readFile(new URL("./signal-refresh.ts", import.meta.url), "utf8"),
    readFile(new URL("../queues/data-os.ts", import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8")
  ]);
  assert.match(materializer, /pg_try_advisory_lock/);
  assert.match(materializer, /SIGNAL_MATERIALIZATION_MAX_PRECOMPUTED_FILTERS|buildSignalPrecomputedFiltersV1/);
  assert.match(materializer, /ON CONFLICT \(materialization_key\)/);
  assert.match(materializer, /CASE WHEN item\.cache_scope = 'ad_hoc' THEN now\(\) \+ interval '15 minutes'/);
  assert.match(materializer, /evaluateSignalMetricQualityV1/);
  assert.match(materializer, /signalDefaultWorkspaceHomeFilterV1/);
  assert.match(materializer, /homeFilter\?\.date_range/);
  assert.match(materializer, /const coverageResult/);
  assert.match(materializer, /prioritizeSignalMaterializationFiltersV1/);
  assert.doesNotMatch(materializer, /24 \* 60 \* 60/);
  assert.match(invalidator, /signal-materialize-\$\{invalidation\.id\}/);
  assert.match(queue, /SIGNAL_MATERIALIZE_JOB_NAME/);
  assert.match(entrypoint, /isDataOsWorkerEnabled\(\)/);
  assert.doesNotMatch(materializer, /published_outputs|chart_aggregates|@ai-sdk\/anthropic|generateObject/iu);
  assert.match(materializer, /SIGNAL_INTERPRETATION_JOB_NAME/);
  assert.doesNotMatch(materializer, /import \{ getSignalRefreshQueue \} from "\.\.\/queues\/signal-refresh"/);
  assert.match(materializer, /await import\("\.\.\/queues\/signal-refresh"\)/);
  assert.match(materializer, /FROM \(\s+SELECT DISTINCT normalized_filter[\s\S]+?\) cached\s+ORDER BY cached\.normalized_filter::text/);
  assert.match(materializer, /MATERIALIZATION_WRITE_BATCH_SIZE = 100/);
  assert.match(materializer, /FROM jsonb_to_recordset\(\$1::jsonb\) AS item/);
  assert.doesNotMatch(materializer, /for \(const row of result\.rows\)/);
  assert.match(materializer, /signal_materialization_plan_failed:\$\{metric\.key\}:\$\{granularity\}:\$\{plan\.predicate\.filters_hash\}/);
  assert.match(materializer, /'materialization_watermark_hash', \$4::text/);
});
