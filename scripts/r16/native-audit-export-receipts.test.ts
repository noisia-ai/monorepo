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

test("human edit receipts verify a two-edit source-digest chain and anchor money only to base serving round", () => {
  const baseConfig = { contract_version: "base-config" }, baseConfigDigest = digest(baseConfig);
  const base = { id: "snapshot", workspace_id: "workspace", map_id: "map", configuration_id: "base-config", generation_id: "base-generation",
    round_id: "base-round", snapshot_digest: sha("a"), actual_snapshot_digest: sha("a"), generation_configuration_id: "base-config",
    generation_snapshot_digest: sha("b"), generation_actual_digest: sha("b"), generation_source_current: true,
    generation_configuration_digest: baseConfigDigest, generation_configuration: baseConfig, generation_configuration_state: "published",
    generation_status: "ready", generation_kind: "confirmed_members" };
  const config1 = { contract_version: "human-config-1" }, config2 = { contract_version: "human-config-2" };
  const configDigest1 = digest(config1), configDigest2 = digest(config2);
  const edit = (args: { id: string; revision: number; previous_edit_id: string | null; source_configuration_id: string;
    source_generation_id: string; source_generation_digest: string; configuration_id: string; configuration: Record<string, string>;
    configuration_digest: string; generation_id: string; generation_digest: string }) => {
    const operation = "move", payload = { root_id: "synthetic", from_question_key: "a", to_question_key: "b" };
    const snapshot_digest = digest({ contract_version: "signal-listening-human-snapshot-v1", workspace_id: "workspace", base_snapshot_id: "snapshot",
      configuration_id: args.configuration_id, configuration_digest: args.configuration_digest, generation_id: args.generation_id,
      revision: args.revision, operation, payload, source_digest: sha("a") });
    return { id: args.id, workspace_id: "workspace", base_snapshot_id: "snapshot", source_configuration_id: args.source_configuration_id,
      configuration_id: args.configuration_id, source_generation_id: args.source_generation_id, generation_id: args.generation_id, map_id: "map",
      source_digest: sha("a"), source_generation_digest: args.source_generation_digest, snapshot_digest, actual_snapshot_digest: snapshot_digest,
      generation_human_edit_id: args.id, generation_status: "ready", generation_snapshot_digest: args.generation_digest,
      generation_actual_digest: args.generation_digest, generation_source_current: true, generation_configuration_id: args.configuration_id,
      configuration_digest: args.configuration_digest, configuration: args.configuration, configuration_state: "published",
      revision: args.revision, expected_revision: args.revision - 1, previous_edit_id: args.previous_edit_id,
      depth: 0, cycle: false, operation, payload };
  };
  const first = edit({ id: "edit-1", revision: 1, previous_edit_id: null, source_configuration_id: "base-config",
    source_generation_id: "base-generation", source_generation_digest: sha("b"), configuration_id: "human-config-1",
    configuration: config1, configuration_digest: configDigest1, generation_id: "human-generation-1", generation_digest: sha("c") });
  const second = { ...edit({ id: "edit-2", revision: 2, previous_edit_id: "edit-1", source_configuration_id: "human-config-1",
    source_generation_id: "human-generation-1", source_generation_digest: sha("c"), configuration_id: "human-config-2",
    configuration: config2, configuration_digest: configDigest2, generation_id: "human-generation-2", generation_digest: sha("d") }), depth: 0 };
  const firstInChain = { ...first, depth: 1 };
  const source = { id: "study", workspace_id: "workspace", listening_source_kind: "human_edit", listening_source_id: "edit-2",
    listening_base_snapshot_id: "snapshot", listening_configuration_id: "human-config-2", listening_source_generation_id: "human-generation-2",
    listening_source_round_id: "base-round", listening_source_digest: second.snapshot_digest };
  const after = { id: "human-generation-2", workspace_id: "workspace", map_id: "map", configuration_id: "human-config-2",
    preparation_run_id: "prep", snapshot_digest: sha("d") };
  const chain = [second, firstInChain];
  assert.deepEqual(nativeListeningFinancialAnchorV1({ source, base, after, human_edits: chain }), {
    generation_id: "base-generation", round_id: "base-round", base_snapshot_id: "snapshot", source_kind: "human_edit",
  });
  const priorBaseEdit = { ...firstInChain, id: "edit-prior-base", base_snapshot_id: "older-snapshot", revision: 4,
    expected_revision: 3, previous_edit_id: null, source_configuration_id: "older-config", source_generation_id: "older-generation",
    source_generation_digest: sha("x"), source_digest: sha("y"), depth: 2 };
  const withProducerSnapshot = (row: typeof firstInChain) => {
    const actual = digest({ contract_version: "signal-listening-human-snapshot-v1", workspace_id: row.workspace_id,
      base_snapshot_id: row.base_snapshot_id, configuration_id: row.configuration_id,
      configuration_digest: row.configuration_digest, generation_id: row.generation_id, revision: row.revision,
      operation: row.operation, payload: row.payload, source_digest: row.source_digest });
    return { ...row, snapshot_digest: actual, actual_snapshot_digest: actual };
  };
  const firstOnCurrentBase = withProducerSnapshot({ ...firstInChain, revision: 5, expected_revision: 4,
    previous_edit_id: priorBaseEdit.id, depth: 1 });
  const secondOnCurrentBase = withProducerSnapshot({ ...second, revision: 6, expected_revision: 5,
    previous_edit_id: firstOnCurrentBase.id });
  const currentBaseSource = { ...source, listening_source_digest: secondOnCurrentBase.snapshot_digest };
  const currentBaseAfter = { ...after, id: "human-generation-2", configuration_id: "human-config-2" };
  assert.deepEqual(nativeListeningFinancialAnchorV1({ source: currentBaseSource, base, after: currentBaseAfter,
    human_edits: [secondOnCurrentBase, firstOnCurrentBase, priorBaseEdit] }), {
    generation_id: "base-generation", round_id: "base-round", base_snapshot_id: "snapshot", source_kind: "human_edit",
  }, "the first edit on a new base anchors to that serving snapshot while retaining its workspace-global predecessor");
  assert.equal(nativeListeningFinancialAnchorV1({ source: currentBaseSource, base, after: currentBaseAfter,
    human_edits: [secondOnCurrentBase, { ...firstOnCurrentBase, previous_edit_id: "forged" }, priorBaseEdit] }), null,
  "the global predecessor ID and revision must still be present and consecutive at the base boundary");
  assert.equal(nativeListeningFinancialAnchorV1({ source, base, after,
    human_edits: [{ ...second, previous_edit_id: "foreign" }, firstInChain] }), null, "a forged hop cannot be skipped");
  assert.equal(nativeListeningFinancialAnchorV1({ source, base, after,
    human_edits: [second, { ...firstInChain, actual_snapshot_digest: sha("f") }] }), null, "producer snapshot hash mismatch fails closed");
  assert.equal(nativeListeningFinancialAnchorV1({ source, base, after,
    human_edits: [second, { ...firstInChain, previous_edit_id: "edit-2", cycle: true }] }), null, "a cyclic history fails closed");
  assert.equal(nativeListeningFinancialAnchorV1({ source, base, after: { ...after, id: "forged-generation" }, human_edits: chain }), null);
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
