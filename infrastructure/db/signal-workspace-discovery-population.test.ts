import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { discoverySamplingOptionsV1, loadSignalDiscoveryPopulationV1 } from "./signal-workspace-discovery-population";

test("discovery has no default sample cap; explicit caps and recorded seeds validate", () => {
  assert.deepEqual(discoverySamplingOptionsV1(), { sample_cap: null, seed: "discovery-v1" });
  assert.deepEqual(discoverySamplingOptionsV1(200, "run-a"), { sample_cap: 200, seed: "run-a" });
  for (const cap of [0, -1, 1.2, NaN, Infinity]) assert.throws(() => discoverySamplingOptionsV1(cap));
  assert.throws(() => discoverySamplingOptionsV1(null, ""));
});

test("one relevant population supplies snapshot roots and exact chunk count, irrespective of technical label status", async () => {
  const queryable = { async query(sql: string, values: unknown[]) {
    assert.match(sql, /facet.relevance='relevant'/u);
    assert.doesNotMatch(sql, /facet.status|status='labeled'/u);
    assert.match(sql, /facet.preparation_run_id=item.run_id/u);
    assert.match(sql, /PARTITION BY stratum_day,platform/u);
    assert.deepEqual(values, ["workspace", "preparation", null, "discovery-v1"]);
    return { rows: [{root_ids:["r1","r2"],total:"2",chunks:"9"}] };
  }} as unknown as Pick<PoolClient,"query">;
  assert.deepEqual(await loadSignalDiscoveryPopulationV1({queryable,workspace_id:"workspace",preparation_run_id:"preparation"}), {
    population:{root_ids:["r1","r2"],eligible_relevant_roots:2,sample_cap:null,seed:"discovery-v1",stratification:"utc_day_platform"},expected_chunks:9
  });
});
