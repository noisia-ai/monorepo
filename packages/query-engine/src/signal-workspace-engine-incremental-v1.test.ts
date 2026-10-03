import test from "node:test";
import assert from "node:assert/strict";
import { buildSignalWorkspaceIncrementalRootDeltaV1 as delta, signalWorkspaceIncrementalDigestV1 as hash,
  parseSignalWorkspaceIncrementalInputV1 as parseInput, parseSignalWorkspaceIncrementalOutputV1 as parseOutput,
  signalWorkspaceIncrementalMembershipSchemaV1, signalWorkspaceIncrementalMembershipDigestV1 as membershipHash } from "./signal-workspace-engine-incremental-v1";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const root = (n: number) => ({ root_id: id(n), root_fingerprint: hash([n]), asset_sha256: hash(["text", n]),
  expected_chunks: 133, chunk_coverage_digest: hash(["chunks", n]), correction_digest: hash([]) });
test("incremental join partitions the complete universe and separates authority from changed content", () => {
  const previous = [1, 2, 3, 4, 5].map(root);
  const current = [root(1), { ...root(2), correction_digest: hash(["human correction"]) },
    { ...root(3), root_fingerprint: hash(["new provenance"]) },
    { ...root(4), asset_sha256: hash(["edited final chunk"]), chunk_coverage_digest: hash(["new partition"]) }, root(6)];
  const rows = delta(previous, current);
  assert.deepEqual(rows.map(row => row.transition), ["unchanged", "metadata_changed", "metadata_changed",
    "content_changed", "removed_or_ineligible", "added"]);
  assert.equal(rows.filter(row => row.current).length, current.length);
  assert.equal(rows.filter(row => row.prior).length, previous.length);
  assert.equal(rows[4]!.current, null);
  assert.deepEqual(delta(current, current).map(row => row.transition), Array(5).fill("unchanged"));
});
test("same text with another chunk partition must be recomputed; duplicate roots never silently collapse", () => {
  assert.equal(delta([root(1)], [{ ...root(1), chunk_coverage_digest: hash(["different boundaries"]) }])[0]!.transition, "content_changed");
  assert.throws(() => delta([root(1)], [root(1), root(1)]), /root_order_invalid/u);
  assert.throws(() => delta([root(2), root(1)], []), /root_order_invalid/u);
});
test("incremental admission is pinned and contains no alias, budget or provider controls", () => {
  const file = { file: "manifest.json", sha256: hash([]), bytes: 100 };
  const input = { contract_version: "workspace-topic-incremental-input-v1", workspace_id: id(1), execution_id: id(2),
    mode: "frozen-model-delta", policy_version: "workspace-frozen-model-cohort-v1", current_input_manifest: file,
    current_roots: { ...file, file: "roots.jsonl", rows: 1 }, parent: { execution_id: id(3), manifest_sha256: hash(["parent"]) },
    compatibility: { embedding_config_digest: hash(["profile"]), chunk_policy_version: "corpus-text-chunks-v1",
      context_digest: hash(["context"]), input_interest_catalog_digest: hash(["interest"]), guides_digest: hash(["guides"]),
      fit_config_digest: hash(["fit"]), runtime_digest: hash(["runtime"]) },
    discovery: { cohort_key: hash(["whole cohort"]), close_requested: true } };
  assert.deepEqual(parseInput(input), input);
  for (const changed of [{ ...input, approval_policy: "automatic" }, { ...input, mode: "full-refit" },
    { ...input, current_input_manifest: { ...file, file: "../model.joblib" } },
    { ...input, discovery: { ...input.discovery, top_k: 32 } }]) assert.throws(() => parseInput(changed));
});
test("model and evaluation origins remain distinct; copy carries an evidence reference", () => {
  const componentKey = hash([id(2), hash(["binary"]), "open"]);
  const row = { root_id: id(1), root_fingerprint: hash([1]), chunk_index: 132, start: 184800, end: 184820,
    chunk_sha256: hash(["last"]), lane: "open", unit_key: `open:${id(4)}`, model_component_key: componentKey,
    strength: 0.8, model_origin: { execution_id: id(2), model_artifact_sha256: hash(["binary"]) },
    evaluation_origin: { execution_id: id(3), input_population_digest: hash(["child"]),
      evaluation_key: hash([id(3), componentKey, hash(["child"]), "predicted_member"]), basis: "predicted_member" },
    carried_from: { output_manifest_sha256: hash(["prior result"]), membership_digest: hash(["row"]) } };
  assert.deepEqual(signalWorkspaceIncrementalMembershipSchemaV1.parse(row), row);
  assert.notEqual(row.model_origin.execution_id, row.evaluation_origin.execution_id);
  assert.throws(() => signalWorkspaceIncrementalMembershipSchemaV1.parse({ ...row, strength: NaN }));
  assert.throws(() => signalWorkspaceIncrementalMembershipSchemaV1.parse({ ...row, end: row.start }));
  assert.throws(() => signalWorkspaceIncrementalMembershipSchemaV1.parse({ ...row, approval: true }));
  assert.throws(() => signalWorkspaceIncrementalMembershipSchemaV1.parse({ ...row,
    evaluation_origin: { ...row.evaluation_origin, execution_id: id(9) } }));
  assert.throws(() => signalWorkspaceIncrementalMembershipSchemaV1.parse({ ...row,
    model_origin: { ...row.model_origin, execution_id: id(9) } }));
  const metadata = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "strength"));
  // Python emits 1e-05, while JSON.stringify emits 0.00001; both seal these bits.
  assert.equal(membershipHash({ ...row, strength: 0.00001 }),
    hash({ ...metadata, strength_ieee754_be: "3ee4f8b588e368f1" }));
  assert.notEqual(membershipHash({ ...row, strength: 0 }), membershipHash({ ...row, strength: -0 }));
});
test("output cannot hide component coverage, model bytes, pending population or malformed unit identities", () => {
  const model = { file: "model.joblib", sha256: hash(["binary"]), bytes: 12 };
  const component = { component_key: hash([id(1), model.sha256, "open"]), lane: "open", model,
    model_origin: { execution_id: id(1), model_artifact_sha256: model.sha256 }, center: null,
    units: [{ local_label: 0, unit_key: `open:${id(4)}`, birth_membership_digest: hash(["birth"]) }] };
  const population = hash(["complete population"]);
  const output = { contract_version: "workspace-topic-incremental-output-v1", workspace_id: id(1), execution_id: id(2),
    request_digest: hash(["request"]), previous_manifest_sha256: hash(["parent"]),
    compatibility: { embedding_config_digest: hash(["profile"]), chunk_policy_version: "corpus-text-chunks-v1",
      context_digest: hash(["context"]), input_interest_catalog_digest: hash(["interests"]), guides_digest: hash(["guides"]),
      fit_config_digest: hash(["fit"]), runtime_digest: hash(["runtime"]) },
    policy_version: "workspace-frozen-model-cohort-v1", status: "completed", quality: "uncalibrated", approval_policy: "none",
    discovery_status: "pending_insufficient_population", relations_status: "none", population_digest: population,
    counts: { roots: 1, occurrences: 133, added_roots: 1, content_changed_roots: 0, metadata_changed_roots: 0,
      unchanged_roots: 0, removed_roots: 0, delta_occurrences: 133, cohort_occurrences: 133, pending_occurrences: 133,
      memberships: 133, components: 1, new_components: 0, model_bank_bytes: 12 }, components: [component],
    coverage: [{ component_key: component.component_key, population_digest: population, expected_occurrences: 133,
      copied_occurrences: 0, transformed_occurrences: 133, fitted_occurrences: 0 }],
    operations: { fit: [], transform: [{ component_key: component.component_key, occurrences: 133, pages: 2, maximum_page_rows: 128 }] },
    artifacts: [...["roots.jsonl", "population.jsonl", "root-transitions.jsonl", "memberships.jsonl", "model-components.json",
      "candidate-groups.json", "relations.json", "pending-cohort.jsonl", "guides.jsonl", "guide-vectors.npy"]
      .map(file => ({ file, sha256: hash([file]), bytes: 10 })), model],
    metrics: { resident_bytes: 1000, elapsed_seconds: 1 }, limitations: ["No semantic approval"] };
  assert.deepEqual(parseOutput(output), output);
  for (const changed of [
    { ...output, coverage: [{ ...output.coverage[0], transformed_occurrences: 132 }] },
    { ...output, discovery_status: "complete" },
    { ...output, counts: { ...output.counts, model_bank_bytes: 1 } },
    { ...output, artifacts: output.artifacts.filter(row => row.file !== "population.jsonl") },
    { ...output, components: [{ ...component, units: [{ ...component.units[0], unit_key: "open:unbound" }] }] },
    { ...output, top_k: 32 },
  ]) assert.throws(() => parseOutput(changed));
});
