import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { signalWorkspaceEmbeddingDigestV1 } from "./signal-workspace-embeddings-v1.js";
import {
  SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as configuration,
  SIGNAL_WORKSPACE_INTERPRETATION_SCHEMA_V1,
  SIGNAL_WORKSPACE_INTERPRETATION_LEGACY_OPUS_CONFIGURATION_V1 as legacyOpus,
  parseSignalWorkspaceInterpretationConfigurationV1,
  batchSignalWorkspaceInterpretationV1, buildSignalWorkspaceInterpretationBatchV1,
  buildSignalWorkspaceInterpretationRepairBatchV1, parseSignalWorkspaceInterpretationEditorialRepairV1,
  parseSignalWorkspaceInterpretationClusterV1, signalWorkspaceInterpretationCostV1,
  signalWorkspaceInterpretationReferenceIdV1, signalWorkspaceInterpretationUniverseDigestV1,
  validateSignalWorkspaceInterpretationResultV1, decodeSignalWorkspaceInterpretationProviderResultV1,
  type SignalWorkspaceInterpretationClusterV1,
} from "./signal-workspace-interpretation-v1.js";
const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const context = { workspace_id: "00000000-0000-4000-8000-000000000001", execution_id: "00000000-0000-4000-8000-000000000002",
  context_digest: sha("complete source context"), data: { interests: [], brand: "A brand" } };
function cluster(index: number, lane: "open" | "guided" = "open"): SignalWorkspaceInterpretationClusterV1 {
  const text = `Delivery 🌞 experience ${index}`;
  const identity = { root_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, chunk_index: 0,
    start: 0, end: text.length, chunk_sha256: sha(text) };
  return { cluster_id: `${lane}:${String(index).padStart(6, "0")}`, lane, cluster_digest: sha(`complete membership ${index}`),
    root_count: 100, chunk_count: 250, terms: ["delivery"], representatives: [
      { ...identity, text, ref_id: signalWorkspaceInterpretationReferenceIdV1(identity), strength: 0.9, selection_reason: "high_affiliation" },
    ] };
}
function answer(row: SignalWorkspaceInterpretationClusterV1) {
  const citations = row.representatives.map(ref => ref.ref_id);
  return { cluster_id: row.cluster_id, cluster_digest: row.cluster_digest, status: "coherent", name: "Delivery experience",
    definition: "Discussion of delivery experiences.", inclusion: [{ text: "Delivery experiences", citations }], exclusion: [], citations };
}
test("all1001groups and both lanes survive deterministic bounded batching", () => {
  const groups = [...Array.from({ length: 501 }, (_, i) => cluster(i, "guided")), ...Array.from({ length: 500 }, (_, i) => cluster(i, "open"))];
  const batches = [...batchSignalWorkspaceInterpretationV1(context, groups)];
  assert.equal(batches.length, 251);
  assert.deepEqual(batches.flatMap(batch => batch.clusters.map(row => row.cluster_id)), groups.map(row => row.cluster_id));
  assert.ok(batches.every(batch => batch.clusters.length <= 4));
  assert.equal(new Set(batches.map(batch => batch.batch_key)).size, batches.length);
  const encoded = groups.map(row => JSON.stringify(row.cluster_id) + "\n").join("");
  assert.equal(signalWorkspaceInterpretationUniverseDigestV1(groups.map(row => row.cluster_id)), sha(encoded));
  assert.equal(signalWorkspaceInterpretationUniverseDigestV1([]), sha(""));
  assert.deepEqual([...batchSignalWorkspaceInterpretationV1(context, [])], []);
  assert.throws(() => [...batchSignalWorkspaceInterpretationV1(context, [groups[1]!, groups[0]!])], /unit_order_invalid/u);
  assert.throws(() => signalWorkspaceInterpretationUniverseDigestV1([groups[0]!.cluster_id, groups[0]!.cluster_id]), /unit_order_invalid/u);
});
test("request identities are stable across JSON property order, and seal membership/context changes", () => {
  const value = cluster(1), batch = buildSignalWorkspaceInterpretationBatchV1(context, [value]);
  const reordered = { ...context, data: { brand: "A brand", interests: [] } };
  assert.equal(buildSignalWorkspaceInterpretationBatchV1(reordered, [value]).batch_key, batch.batch_key);
  assert.notEqual(buildSignalWorkspaceInterpretationBatchV1(context, [{ ...value, cluster_digest: sha("different full membership") }]).batch_key, batch.batch_key);
  assert.notEqual(buildSignalWorkspaceInterpretationBatchV1({ ...context, context_digest: sha("changed") }, [value]).batch_key, batch.batch_key);
  const request = JSON.parse(batch.request_body);
  assert.equal(request.model, "claude-sonnet-4-6"); assert.deepEqual(request.thinking, { type: "disabled" });
  assert.equal(request.output_config.effort, "high"); assert.equal(request.max_tokens, 8192);
  assert.equal(request.tools, undefined); assert.equal(request.cache_control, undefined);
  assert.equal(request.system.includes("untrusted data"), true);
  assert.equal(configuration.schema_digest, signalWorkspaceEmbeddingDigestV1(SIGNAL_WORKSPACE_INTERPRETATION_SCHEMA_V1));
  assert.ok(Object.isFrozen(SIGNAL_WORKSPACE_INTERPRETATION_SCHEMA_V1.properties));
});
test("exact Unicode fragments and unique evidence roots are mandatory", () => {
  const value = cluster(1), reference = value.representatives[0]!;
  assert.equal(parseSignalWorkspaceInterpretationClusterV1(value).representatives[0]!.text, reference.text);
  for (const changed of [ { text: reference.text + " invented" }, { end: reference.end - 1 }, { ref_id: sha("foreign") }, { chunk_sha256: sha("wrong") } ]) {
    assert.throws(() => parseSignalWorkspaceInterpretationClusterV1({ ...value, representatives: [{ ...reference, ...changed }] }), /evidence_identity_invalid/u);
  }
  assert.throws(() => parseSignalWorkspaceInterpretationClusterV1({ ...value, representatives: [reference, reference] }), /evidence_identity_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterpretationClusterV1({ ...value, lane: "guided" }), /cluster_identity_invalid/u);
});
test("oversized inputs fail explicitly without clipping groups or context", () => {
  assert.throws(() => [...batchSignalWorkspaceInterpretationV1({ ...context, data: { complete: "x".repeat(100_000) } }, [cluster(1)])], /batch_capacity_exceeded/u);
  assert.throws(() => buildSignalWorkspaceInterpretationBatchV1({ ...context, data: { notJson: Number.NaN } }, [cluster(1)]), /context_invalid/u);
});
test("output must account for every cluster exactly once and cite only its own evidence", () => {
  const a = cluster(1), b = cluster(2), batch = buildSignalWorkspaceInterpretationBatchV1(context, [a, b]);
  const good = [answer(a), answer(b)];
  assert.equal(validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: good }).length, 2);
  for (const invalid of [
    [good[0]], [good[0], good[0]], [good[0], { ...good[1], cluster_digest: sha("wrong") }],
    [good[0], { ...good[1], citations: good[0]!.citations }],
    [good[0], { ...good[1], inclusion: [{ text: "Unsupported", citations: [] }] }],
    [good[0], { ...good[1], percentage: 99 }], [good[0], { ...good[1], approved: true }],
  ]) assert.throws(() => validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: invalid }), /output|citation/u);
});
test("mixed remains explicit; insufficient may be empty with no invented evidence", () => {
  const value = cluster(1), batch = buildSignalWorkspaceInterpretationBatchV1(context, [value]);
  assert.equal(validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: [{ ...answer(value), status: "mixed" }] })[0]!.status, "mixed");
  const empty = { ...value, representatives: [] }, noEvidence = buildSignalWorkspaceInterpretationBatchV1(context, [empty]);
  const insufficient = { cluster_id: value.cluster_id, cluster_digest: value.cluster_digest, status: "insufficient", name: null, definition: null, inclusion: [], exclusion: [], citations: [] };
  assert.equal(validateSignalWorkspaceInterpretationResultV1(noEvidence, { interpretations: [insufficient] })[0]!.name, null);
  assert.throws(() => validateSignalWorkspaceInterpretationResultV1(noEvidence, { interpretations: [{ ...insufficient, name: "invented" }] }), /evidence_missing/u);
});
test("conservative reserve includes entire serialized input and output cap; actual usage has exact integer pricing", () => {
  const batch = buildSignalWorkspaceInterpretationBatchV1(context, [cluster(1)]);
  assert.equal(batch.input_token_upper_bound, Buffer.byteLength(batch.request_body) * 4 + 8192);
  assert.equal(batch.reserved_micro_usd, batch.input_token_upper_bound * 3 + 8192 * 15);
  assert.equal(signalWorkspaceInterpretationCostV1({ input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 }), 455);
  assert.throws(() => signalWorkspaceInterpretationCostV1({ input_tokens: -1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), /usage_invalid/u);
});
test("editorial repair preserves the entire packet and evidence authority with a distinct bounded request", () => {
  const groups = [cluster(1), cluster(2)], original = buildSignalWorkspaceInterpretationBatchV1(context, groups);
  const snapshot = structuredClone(original);
  const source = { source_call_id: "00000000-0000-4000-8000-000000000090", source_response_sha256: sha("invalid raw receipt"), diagnostic: "output_invalid" as const };
  const repair = buildSignalWorkspaceInterpretationRepairBatchV1(original, source);
  const body = JSON.parse(repair.request_body), before = JSON.parse(original.request_body);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(body.messages[0], before.messages[0]);
  assert.deepEqual(repair.clusters, original.clusters);
  assert.deepEqual(repair.configuration, original.configuration);
  assert.deepEqual(body.output_config, before.output_config);
  assert.ok(body.system.startsWith(before.system));
  assert.equal(body.messages.length, 2);
  assert.notEqual(repair.request_digest, original.request_digest);
  assert.deepEqual(buildSignalWorkspaceInterpretationRepairBatchV1(original, source), repair);
  assert.ok(Buffer.byteLength(repair.request_body) <= 102_400);
  assert.ok(repair.reserved_micro_usd > original.reserved_micro_usd);
  assert.equal(repair.reserved_micro_usd, (Buffer.byteLength(repair.request_body) * 4 + 8192) * 3 + 8192 * 15);
  assert.equal(validateSignalWorkspaceInterpretationResultV1(repair, { interpretations: groups.map(answer) }).length, 2);
  assert.throws(() => validateSignalWorkspaceInterpretationResultV1(repair, { interpretations: [{ ...answer(groups[0]!), citations: ["x"] }] }), /output_invalid/u);
  assert.throws(() => validateSignalWorkspaceInterpretationResultV1(repair, { interpretations: [answer(groups[0]!), { ...answer(groups[1]!), citations: answer(groups[0]!).citations }] }), /citation_invalid/u);
  assert.throws(() => buildSignalWorkspaceInterpretationRepairBatchV1(repair, source), /repair_invalid/u);
  assert.throws(() => buildSignalWorkspaceInterpretationRepairBatchV1({ ...original, reserved_micro_usd: 1 }, source), /repair_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterpretationEditorialRepairV1({ ...repair.editorial_repair, protocol_digest: sha("unapproved protocol") }), /repair_invalid/u);
  assert.notEqual(buildSignalWorkspaceInterpretationRepairBatchV1(original, { ...source, source_response_sha256: sha("different receipt") }).request_digest, repair.request_digest);
});

test("Sonnet defaults do not change immutable Opus receipts or repair identities", () => {
  const groups = [cluster(1)], sonnet = buildSignalWorkspaceInterpretationBatchV1(context, groups);
  const old = buildSignalWorkspaceInterpretationBatchV1(context, groups, legacyOpus);
  assert.equal(JSON.parse(old.request_body).model, "claude-opus-5");
  assert.equal(JSON.parse(sonnet.request_body).model, "claude-sonnet-4-6");
  assert.notEqual(old.request_digest, sonnet.request_digest);
  assert.deepEqual(old.clusters, sonnet.clusters);
  assert.deepEqual(old.context, sonnet.context);
  assert.equal(old.reserved_micro_usd, old.input_token_upper_bound * 5 + 8192 * 25);
  const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 };
  assert.equal(signalWorkspaceInterpretationCostV1(usage, legacyOpus), 757);
  assert.equal(signalWorkspaceInterpretationCostV1(usage, configuration), 455);
  assert.deepEqual([...batchSignalWorkspaceInterpretationV1(context, groups, legacyOpus)], [old]);
  const repair = buildSignalWorkspaceInterpretationRepairBatchV1(old, {
    source_call_id: "00000000-0000-4000-8000-000000000090", source_response_sha256: sha("old reply"), diagnostic: "output_invalid" });
  assert.equal(repair.configuration, legacyOpus);
  assert.equal(JSON.parse(repair.request_body).model, "claude-opus-5");
  assert.equal(repair.reserved_micro_usd, repair.input_token_upper_bound * 5 + 8192 * 25);
  assert.deepEqual(parseSignalWorkspaceInterpretationConfigurationV1(structuredClone(legacyOpus)), legacyOpus);
  for (const invalid of [{ ...configuration, model: "claude-opus-5" }, { ...legacyOpus, output_micro_usd_per_million_tokens: 1 },
    { ...configuration, pricing_version: "unverified" }, { ...configuration, extra: true }]) {
    assert.throws(() => parseSignalWorkspaceInterpretationConfigurationV1(invalid), /config_mismatch/u);
  }
});

test("short citation labels resolve only within the exact sealed group and never rewrite raw output", () => {
  const a = cluster(1), b = cluster(2), batch = buildSignalWorkspaceInterpretationBatchV1(context, [a, b]);
  const packet = JSON.parse(JSON.parse(batch.request_body).messages[0].content);
  assert.equal(packet.clusters[0].representatives[0].ref_id, "r1");
  assert.equal(packet.clusters[1].representatives[0].ref_id, "r1");
  assert.equal(batch.clusters[0]!.representatives[0]!.ref_id, a.representatives[0]!.ref_id);
  const wire = { interpretations: [a, b].map(row => ({ ...answer(row), citations: ["r1"],
    inclusion: [{ text: "Delivery experiences", citations: ["r1"] }] })) };
  const unchanged = JSON.stringify(wire);
  const decoded = decodeSignalWorkspaceInterpretationProviderResultV1(batch, wire);
  assert.deepEqual(decoded.map(item => item.citations), [a.representatives.map(ref => ref.ref_id), b.representatives.map(ref => ref.ref_id)]);
  assert.equal(JSON.stringify(wire), unchanged);
  assert.deepEqual(validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: decoded }), decoded);
  for (const invalid of ["r2", "r0", "r01", "R1", "r1 ", a.representatives[0]!.ref_id]) {
    const changed = structuredClone(wire); changed.interpretations[0]!.citations = [invalid];
    assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch, changed), /citation|output_invalid/u);
  }
  const missing = structuredClone(wire); missing.interpretations[0]!.citations = [];
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch, missing), /evidence_missing/u);
  const duplicate = structuredClone(wire); duplicate.interpretations[0]!.citations = ["r1", "r1"];
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch, duplicate), /output_invalid/u);
  const extra = { interpretations: [{ ...wire.interpretations[0], approved: true }, wire.interpretations[1]] };
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch, extra), /output_invalid/u);
  const historical = buildSignalWorkspaceInterpretationBatchV1(context, [a], legacyOpus);
  assert.deepEqual(decodeSignalWorkspaceInterpretationProviderResultV1(historical, { interpretations: [answer(a)] })[0]!.citations,
    a.representatives.map(ref => ref.ref_id));
});
