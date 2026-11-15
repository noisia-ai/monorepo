import assert from "node:assert/strict";
import test from "node:test";
import { loadNativeReceiptEvidenceV1, nativeListeningRoundPathV1, nativeWallSpanV1 } from "./native-audit-export-receipts.js";

const round = (ordinal: number, input: string, output: string | null, status = "completed") => ({
  id: `round-${ordinal}`, ordinal, input_generation_id: input, output_generation_id: output, status,
});

test("receipt ancestry includes initial rounds before an intermediate BEFORE and reaches exact AFTER", () => {
  const path = nativeListeningRoundPathV1({ initial_generation_id: "g0", before_generation_id: "g2", after_generation_id: "g3",
    after_round_id: "round-3", rounds: [round(1, "g0", "g1"), round(2, "g1", "g2"), round(3, "g2", "g3")] });
  assert.deepEqual(path?.generation_ids, ["g0", "g1", "g2", "g3"]);
  assert.deepEqual(path?.rounds.map(item => item.id), ["round-1", "round-2", "round-3"]);
});

test("missing, forged, or incomplete ancestry cannot produce a complete receipt path", () => {
  const base = { initial_generation_id: "g0", before_generation_id: "g2", after_generation_id: "g3", after_round_id: "round-3" };
  assert.equal(nativeListeningRoundPathV1({ ...base, rounds: [round(2, "g1", "g2"), round(3, "g2", "g3")] }), null,
    "a path beginning at BEFORE's predecessor omits initial costs and is rejected");
  assert.equal(nativeListeningRoundPathV1({ ...base, rounds: [round(1, "g0", "g1"), round(2, "g1", "gx"), round(3, "g2", "g3")] }), null,
    "BEFORE must occur on the same chained ancestry");
  assert.equal(nativeListeningRoundPathV1({ ...base, rounds: [round(1, "g0", "g1"), round(2, "g1", "g2"), round(3, "g2", null, "active")] }), null,
    "AFTER must be reached by completed rounds");
});

test("receipt ancestry uses the Study's exact terminal round when generations converge or remain unchanged", () => {
  const path = nativeListeningRoundPathV1({ initial_generation_id: "g0", before_generation_id: "g1", after_generation_id: "g1",
    after_round_id: "round-2", rounds: [round(1, "g0", "g1"), round(2, "g1", "g1")] });
  assert.deepEqual(path?.rounds.map(item => item.id), ["round-1", "round-2"], "the paid no-op review remains in the census");
  assert.equal(path?.before_generation_index, 1);
  assert.equal(path?.after_generation_index, 2);
  assert.equal(nativeListeningRoundPathV1({ initial_generation_id: "g1", before_generation_id: "g1", after_generation_id: "g1",
    after_round_id: "wrong-round", rounds: [round(1, "g1", "g1")] }), null, "no-op requires the exact frozen round binding");
});

test("receipt adapter marks missing initial ancestry incomplete and withholds totals", async () => {
  const parent = { id: "parent", workspace_id: "workspace", map_id: "map", initial_configuration_id: "cfg",
    initial_generation_id: "g0", initial_classification_run_id: "initial-run", initial_preparation_id: null,
    configuration_digest: "sha256:config", root_census_digest: "sha256:census", root_count: 1, status: "completed" };
  const rowsByQuery = [
    { match: "FROM signal_listening_discovery_executions", rows: [parent] },
    { match: "FROM signal_listening_discovery_rounds", rows: [
      { ...round(2, "g1", "g2"), configuration_id: "cfg", configuration_digest: "sha256:config", source_digest: "sha256:g1",
        output_configuration_id: "cfg", output_digest: "sha256:config", classification_run_id: null, classification_preparation_id: null },
      { ...round(3, "g2", "g3"), configuration_id: "cfg", configuration_digest: "sha256:config", source_digest: "sha256:g2",
        output_configuration_id: "cfg", output_digest: "sha256:config", classification_run_id: null, classification_preparation_id: null },
    ] },
  ];
  const client = { async query(sql: string) {
    const matched = rowsByQuery.find(item => sql.includes(item.match));
    return { rows: matched?.rows ?? [] };
  } };
  const evidence = await loadNativeReceiptEvidenceV1(client as never,
    { id: "g2", workspace_id: "workspace", map_id: "map", configuration_id: "cfg", preparation_run_id: "prep-before" },
    { id: "g3", workspace_id: "workspace", map_id: "map", configuration_id: "cfg", preparation_run_id: "prep-after" },
    { id: "study", workspace_id: "workspace", listening_source_round_id: "round-3" });
  assert.equal(evidence.complete, false);
  assert.equal(evidence.total_cost_usd, null);
  assert.equal(evidence.total_elapsed_ms, null);
  assert.equal(evidence.total_reserved_usd, null);
  assert.ok(evidence.limitations.includes("listening_generation_path_incomplete"));
});

test("wall span scans 200,000 intervals without spread limits or duration summation", () => {
  function* intervals() {
    for (let i = 0; i < 200_000; i++) yield { started_at: i, ended_at: i + 2 };
  }
  assert.equal(nativeWallSpanV1(intervals()), 200_001);
  assert.equal(nativeWallSpanV1([{ started_at: 1, ended_at: 2 }, { started_at: null, ended_at: 3 }]), null);
});
