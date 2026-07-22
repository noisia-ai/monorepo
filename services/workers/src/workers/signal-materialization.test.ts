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
  assert.match(materializer, /CASE WHEN \$23 = 'ad_hoc' THEN now\(\) \+ interval '15 minutes'/);
  assert.match(invalidator, /signal-materialize-\$\{invalidation\.id\}/);
  assert.match(queue, /SIGNAL_MATERIALIZE_JOB_NAME/);
  assert.match(entrypoint, /isDataOsWorkerEnabled\(\)/);
  assert.doesNotMatch(materializer, /published_outputs|chart_aggregates|anthropic|claude/iu);
});
