import assert from "node:assert/strict";
import test from "node:test";
import { loadNativeReceiptEvidenceV1, nativeListeningFinancialAnchorV1, nativeListeningRoundPathV1, nativeWallSpanV1 } from "./native-audit-export-receipts.js";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "../../packages/query-engine/src/signal-workspace-embeddings-v1.js";

const round = (ordinal: number, input: string, output: string | null, status = "completed") => ({
  id: `round-${ordinal}`, ordinal, input_generation_id: input, output_generation_id: output, status,
});
const sha = (character: string) => `sha256:${character.repeat(64)}`;

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

test("human edit receipts anchor money to the immutable serving base, with frozen human tuple checked separately", () => {
  const config = { contract_version: "synthetic-config" }, configuration_digest = digest(config);
  const base = { id: "snapshot", workspace_id: "workspace", map_id: "map", configuration_id: "base-config", generation_id: "base-generation",
    round_id: "base-round", snapshot_digest: sha("a"), actual_snapshot_digest: sha("a"), generation_configuration_id: "base-config", generation_snapshot_digest: sha("b"),
    generation_actual_digest: sha("b"), generation_source_current: true, generation_configuration_digest: configuration_digest,
    generation_configuration: config, generation_configuration_state: "published", generation_status: "ready", generation_kind: "confirmed_members" };
  const source = { id: "study", workspace_id: "workspace", listening_source_kind: "human_edit", listening_source_id: "edit",
    listening_base_snapshot_id: "snapshot", listening_configuration_id: "human-config", listening_source_generation_id: "human-generation",
    listening_source_round_id: "base-round", listening_source_digest: sha("c") };
  const after = { id: "human-generation", workspace_id: "workspace", map_id: "map", configuration_id: "human-config",
    preparation_run_id: "prep", snapshot_digest: sha("d") };
  const edit = { id: "edit", workspace_id: "workspace", base_snapshot_id: "snapshot", source_configuration_id: "base-config",
    configuration_id: "human-config", source_generation_id: "base-generation", generation_id: "human-generation", map_id: "map",
    source_digest: sha("a"), source_generation_digest: sha("b"), snapshot_digest: sha("c"), actual_snapshot_digest: sha("c"),
    generation_human_edit_id: "edit", generation_status: "ready", generation_snapshot_digest: sha("d"), generation_actual_digest: sha("d"),
    generation_source_current: true, configuration_digest, configuration: config, configuration_state: "published" };
  assert.deepEqual(nativeListeningFinancialAnchorV1({ source, base, after, human_edit: edit }), {
    generation_id: "base-generation", round_id: "base-round", base_snapshot_id: "snapshot", source_kind: "human_edit",
  });
  assert.equal(nativeListeningFinancialAnchorV1({ source, base, after, human_edit: { ...edit, source_generation_id: "forged" } }), null);
  assert.equal(nativeListeningFinancialAnchorV1({ source: { ...source, listening_source_round_id: "forged-round" }, base, after, human_edit: edit }), null);
  assert.equal(nativeListeningFinancialAnchorV1({ source, base, after: { ...after, id: "forged-generation" }, human_edit: edit }), null);
});

test("receipt adapter marks missing initial ancestry incomplete and withholds totals", async () => {
  const parent = { id: "parent", workspace_id: "workspace", map_id: "map", initial_configuration_id: "cfg",
    initial_generation_id: "g0", initial_classification_run_id: "initial-run", initial_preparation_id: null,
    configuration_digest: "sha256:config", root_census_digest: "sha256:census", root_count: 1, status: "completed" };
  const rowsByQuery = [
    { match: "FROM signal_listening_serving_snapshots", rows: [{ id: "snapshot", workspace_id: "workspace", map_id: "map",
      configuration_id: "cfg", generation_id: "g3", round_id: "round-3", snapshot_digest: sha("d"), actual_snapshot_digest: sha("d"), generation_configuration_id: "cfg",
      generation_snapshot_digest: sha("e"), generation_actual_digest: sha("e"), generation_source_current: true,
      generation_configuration_digest: digest({}), generation_configuration: {}, generation_configuration_state: "published",
      generation_status: "ready", generation_kind: "confirmed_members" }] },
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
    { id: "g3", workspace_id: "workspace", map_id: "map", configuration_id: "cfg", preparation_run_id: "prep-after", snapshot_digest: sha("e") },
    { id: "study", workspace_id: "workspace", listening_source_kind: "serving", listening_source_id: "snapshot", listening_base_snapshot_id: "snapshot",
      listening_configuration_id: "cfg", listening_source_generation_id: "g3", listening_source_round_id: "round-3", listening_source_digest: sha("d") });
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
