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
  assert.equal(decodeSignalWorkspaceInterpretationProviderResultV1(batch, missing)[0]!.warnings?.[0]?.code, "references_missing");
  const duplicate = structuredClone(wire); duplicate.interpretations[0]!.citations = ["r1", "r1"];
  assert.equal(decodeSignalWorkspaceInterpretationProviderResultV1(batch, duplicate)[0]!.warnings?.[0]?.code, "references_repeated");
  const extra = { interpretations: [{ ...wire.interpretations[0], approved: true }, wire.interpretations[1]] };
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch, extra), /output_invalid/u);
  const historical = buildSignalWorkspaceInterpretationBatchV1(context, [a], legacyOpus);
  assert.deepEqual(decodeSignalWorkspaceInterpretationProviderResultV1(historical, { interpretations: [answer(a)] })[0]!.citations,
    a.representatives.map(ref => ref.ref_id));
});

test("pilot and historical reference counts are advisory while sealed membership stays exact", async () => {
  const { SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1: pilot,
    parseSignalWorkspaceInterpretationV1 } = await import("./signal-workspace-interpretation-v1.js");
  const group = cluster(1, "guided");
  group.representatives = Array.from({ length: 30 }, (_, index) => cluster(index + 10, "guided").representatives[0]!);
  const batch = buildSignalWorkspaceInterpretationBatchV1(context, [group], pilot);
  const labels = group.representatives.map((_, index) => `r${index + 1}`);
  const wire = { interpretations: [{ ...answer(group), citations: labels,
    inclusion: [{ text: "Discussion represented by all supplied roots", citations: labels }],
    exclusion: [{ text: "Boundary supported by the supplied roots", citations: labels }] }] };
  const requestDigest = batch.request_digest, raw = JSON.stringify(wire);
  const decoded = decodeSignalWorkspaceInterpretationProviderResultV1(batch, wire);
  assert.equal(decoded[0]!.citations.length, 30);
  assert.equal(decoded[0]!.inclusion[0]!.citations.length, 30);
  assert.equal(decoded[0]!.exclusion[0]!.citations.length, 30);
  assert.deepEqual(validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: decoded }), decoded);
  assert.deepEqual(parseSignalWorkspaceInterpretationV1(decoded[0], pilot), decoded[0]);
  const {mergeSignalWorkspaceTopicMaterializationV1}=await import("./signal-workspace-topic-materialization-v1.js");
  const materialization={prior:[],interpretations:[{result:decoded[0]!,artifact_id:context.workspace_id}],
    execution_id:context.execution_id,now:"2026-11-07T00:00:00.000Z",locale:"pt-BR"};
  assert.equal(mergeSignalWorkspaceTopicMaterializationV1({...materialization,interpretation_configuration:pilot}).topic_count,1);
  assert.equal(mergeSignalWorkspaceTopicMaterializationV1(materialization).topic_count, 1);
  assert.equal(parseSignalWorkspaceInterpretationV1(decoded[0]).warnings?.[0]?.code, "references_excess");
  assert.equal(JSON.stringify(wire), raw);
  assert.equal(batch.request_digest, requestDigest);
  for (const change of [
    { citations: [...labels, "r31"] },
    { citations: ["r31"] },
    { cluster_digest: sha("another sealed group") },
  ]) assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch,
    { interpretations: [{ ...wire.interpretations[0], ...change }] }), /output|citation|evidence/u);
  const shorter = { ...group, representatives: group.representatives.slice(0, 20) };
  const shorterBatch = buildSignalWorkspaceInterpretationBatchV1(context, [shorter], pilot);
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(shorterBatch,
    { interpretations: [{ ...wire.interpretations[0], citations: ["r21"], inclusion: [], exclusion: [] }] }), /citation_invalid/u);
});

test("operator insufficiency applies only to one pilot mixed group with missing general evidence", async () => {
  const { SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1: pilot,
    decodeSignalWorkspaceInterpretationInsufficiencyDecisionV1: decide } = await import("./signal-workspace-interpretation-v1.js");
  const groups = [cluster(1, "guided"), cluster(2, "guided")].map(group => ({ ...group,
    representatives: Array.from({ length: 30 }, (_, index) => cluster(index + 10, "guided").representatives[0]!) }));
  const batch = buildSignalWorkspaceInterpretationBatchV1(context, groups, pilot);
  const wire = { interpretations: groups.map((group, index) => ({ ...answer(group), status: "mixed",
    citations: index === 0 ? [] as string[] : ["r2"],
    inclusion: [{ text: "Represented experience", citations: ["r1", "r3"] }],
    exclusion: [{ text: "Boundary experience", citations: ["r4"] }] })) };
  const bytes = JSON.stringify(wire), digest = batch.request_digest;
  const result = decide(batch, wire, groups[0]!.cluster_id);
  assert.deepEqual(result[0], { cluster_id: groups[0]!.cluster_id, cluster_digest: groups[0]!.cluster_digest,
    status: "insufficient", name: null, definition: null, inclusion: [], exclusion: [], citations: [] });
  const siblingBatch = buildSignalWorkspaceInterpretationBatchV1(context, [groups[1]!], pilot);
  assert.deepEqual(result[1], decodeSignalWorkspaceInterpretationProviderResultV1(siblingBatch,
    { interpretations: [wire.interpretations[1]] })[0]);
  assert.equal(JSON.stringify(wire), bytes);
  assert.equal(batch.request_digest, digest);
  assert.equal(decodeSignalWorkspaceInterpretationProviderResultV1(batch, wire)[0]!.warnings?.[0]?.code, "references_missing");
  assert.throws(() => decide(batch, wire, groups[1]!.cluster_id), /insufficiency_decision_invalid/u);
  assert.throws(() => decide(batch, wire, "guided:unknown"), /insufficiency_decision_invalid/u);
  const historical = buildSignalWorkspaceInterpretationBatchV1(context, [cluster(1)]);
  assert.throws(() => decide(historical, wire, groups[0]!.cluster_id), /insufficiency_decision_invalid/u);
  for (const change of [
    { status: "coherent" }, { status: "insufficient" }, { citations: ["r1"] },
    { cluster_digest: sha("another group") }, { inclusion: [{ text: "Foreign", citations: ["r31"] }] },
    { name: null }, { definition: null },
    { extra: true },
  ]) {
    const invalid = structuredClone(wire);
    Object.assign(invalid.interpretations[0]!, change);
    assert.throws(() => decide(batch, invalid, groups[0]!.cluster_id));
  }
  const invalidSibling = structuredClone(wire); invalidSibling.interpretations[1]!.citations = [];
  assert.equal(decide(batch, invalidSibling, groups[0]!.cluster_id)[1]!.warnings?.[0]?.code, "references_missing");
});

test("insufficiency recovery binds both source envelopes and uses the repaired sibling", async () => {
  const { SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1: pilot,
    recoverSignalWorkspaceInterpretationInsufficiencyV1: recover } = await import("./signal-workspace-interpretation-v1.js");
  const groups = [cluster(1, "guided"), cluster(2, "guided")].map(group => ({ ...group,
    representatives: Array.from({ length: 30 }, (_, index) => cluster(index + 10, "guided").representatives[0]!) }));
  const original = buildSignalWorkspaceInterpretationBatchV1(context, groups, pilot);
  const output = { interpretations: groups.map((group, index) => ({ ...answer(group), status: "mixed",
    citations: index === 0 ? [] as string[] : ["r2"], inclusion: [{ text: "Condition", citations: ["r1"] }], exclusion: [] })) };
  const envelope = (value: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({
    model: pilot.model, type: "message", role: "assistant", stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(value) }], ...extra });
  const original_response = envelope(output);
  const batch = buildSignalWorkspaceInterpretationRepairBatchV1(original, {
    source_call_id: context.workspace_id, source_response_sha256: sha(original_response), diagnostic: "output_invalid" });
  const repaired = structuredClone(output); repaired.interpretations[1]!.definition = "Repaired sibling definition";
  const repair_response = envelope(repaired);
  const args = { batch, original_response, repair_response, unit_key: groups[0]!.cluster_id };
  const result = recover(args);
  assert.equal(result[0]!.status, "insufficient");
  assert.equal(result[1]!.definition, "Repaired sibling definition");
  assert.throws(() => recover({ ...args, original_response: original_response + " " }), /insufficiency_decision_invalid/u);
  assert.throws(() => recover({ ...args, batch: original }), /insufficiency_decision_invalid/u);
  for (const change of [
    { model: "another-model" }, { stop_reason: "max_tokens" }, { type: "error" },
    { usage: { input_tokens: -1, output_tokens: 10 } },
    { usage: { input_tokens: 100, output_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 1 } } },
    { content: [{ type: "text", text: JSON.stringify(repaired) }, { type: "text", text: "{}" }] },
    { content: [{ type: "tool_use" }] },
  ]) assert.throws(() => recover({ ...args, repair_response: envelope(repaired, change) }));
  const different = structuredClone(output); different.interpretations[0]!.citations = ["r1"];
  assert.throws(() => recover({ ...args, repair_response: envelope(different) }), /insufficiency_decision_invalid/u);
});


test("a recorded insufficiency decision accepts mixed/coherent receipts and rejects other status pairs", async () => {
  const { SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1: pilot,
    recoverSignalWorkspaceInterpretationInsufficiencyV1: recover } = await import("./signal-workspace-interpretation-v1.js");
  const groups = [cluster(1, "guided"), cluster(2, "guided")].map(group => ({ ...group,
    representatives: Array.from({ length: 30 }, (_, index) => cluster(index + 10, "guided").representatives[0]!) }));
  const original = buildSignalWorkspaceInterpretationBatchV1(context, groups, pilot);
  const output = { interpretations: groups.map((group, index) => ({ ...answer(group), status: "mixed",
    citations: index === 0 ? [] as string[] : ["r2"], inclusion: [{ text: "Condition", citations: ["r1", "r30"] }], exclusion: [] })) };
  const envelope = (value: unknown) => JSON.stringify({ model: pilot.model, type: "message", role: "assistant",
    stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 },
    content: [{ type: "text", text: JSON.stringify(value) }] });
  for (const [sourceStatus, repairStatus, accepted] of [
    ["mixed", "mixed", true], ["mixed", "coherent", true],
    ["coherent", "mixed", false], ["coherent", "coherent", false],
    ["insufficient", "mixed", false], ["mixed", "insufficient", false],
  ] as const) {
    const sourceOutput = structuredClone(output), repairedOutput = structuredClone(output);
    sourceOutput.interpretations[0]!.status = sourceStatus;
    repairedOutput.interpretations[0]!.status = repairStatus;
    repairedOutput.interpretations[1]!.definition = "Definition from the sealed repair";
    const original_response = envelope(sourceOutput), repair_response = envelope(repairedOutput);
    const batch = buildSignalWorkspaceInterpretationRepairBatchV1(original, {
      source_call_id: context.workspace_id, source_response_sha256: sha(original_response), diagnostic: "output_invalid" });
    const args = { batch, original_response, repair_response, unit_key: groups[0]!.cluster_id };
    if (!accepted) {
      assert.throws(() => recover(args), /insufficiency_decision_invalid/u);
      continue;
    }
    assert.equal(decodeSignalWorkspaceInterpretationProviderResultV1(original, sourceOutput)[0]!.warnings?.[0]?.code, "references_missing");
    assert.equal(decodeSignalWorkspaceInterpretationProviderResultV1(batch, repairedOutput)[0]!.warnings?.[0]?.code, "references_missing");
    const recovered = recover(args);
    assert.deepEqual(recovered[0], { cluster_id: groups[0]!.cluster_id, cluster_digest: groups[0]!.cluster_digest,
      status: "insufficient", name: null, definition: null, inclusion: [], exclusion: [], citations: [] });
    const sibling = buildSignalWorkspaceInterpretationBatchV1(context, [groups[1]!], pilot);
    assert.deepEqual(recovered[1], decodeSignalWorkspaceInterpretationProviderResultV1(sibling,
      { interpretations: [repairedOutput.interpretations[1]] })[0]);
    const changed = structuredClone(repairedOutput); changed.interpretations[0]!.inclusion[0]!.citations = ["r31"];
    assert.throws(() => recover({ ...args, repair_response: envelope(changed) }), /citation_invalid/u);
    const supported = structuredClone(repairedOutput); supported.interpretations[0]!.citations = ["r1"];
    assert.throws(() => recover({ ...args, repair_response: envelope(supported) }), /insufficiency_decision_invalid/u);
  }
});


test("offline exact-copy recovery retains four complete original interpretations and preserves ordinary rejection", async () => {
  const { SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1: pilot,
    decodeSignalWorkspaceInterpretationExactDuplicateV1: recover } = await import("./signal-workspace-interpretation-v1.js");
  const groups = Array.from({ length: 4 }, (_, index) => cluster(index + 1, "guided")).map(group => ({ ...group,
    representatives: Array.from({ length: 30 }, (_, index) => cluster(index + 10, "guided").representatives[0]!) }));
  const batch = buildSignalWorkspaceInterpretationBatchV1(context, groups, pilot);
  const rows = groups.map(group => ({ ...answer(group), citations: ["r1", "r30"],
    inclusion: [{ text: "Supplied condition", citations: ["r2"] }] }));
  const output = { interpretations: [...rows, structuredClone(rows[1]!)] };
  const before = JSON.stringify(output), request = batch.request_digest;
  const expected = decodeSignalWorkspaceInterpretationProviderResultV1(batch, { interpretations: rows });
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch, output), /output_invalid/u);
  assert.deepEqual(recover(batch, output), expected);
  assert.deepEqual(recover(batch, output), expected);
  assert.equal(JSON.stringify(output), before);
  assert.equal(batch.request_digest, request);
  const repair = buildSignalWorkspaceInterpretationRepairBatchV1(batch, {
    source_call_id: context.workspace_id, source_response_sha256: sha("raw"), diagnostic: "output_invalid" });
  assert.throws(() => recover(repair, output), /exact_duplicate_recovery_invalid/u);
  const historical = buildSignalWorkspaceInterpretationBatchV1(context, groups.map(group => ({ ...group, representatives: group.representatives.slice(0, 10) })));
  assert.throws(() => recover(historical, output), /exact_duplicate_recovery_invalid/u);
  for (const change of [
    { definition: "Different duplicate definition" }, { citations: ["r30", "r1"] },
    { inclusion: [{ text: "Changed condition", citations: ["r2"] }] }, { extra: "different" },
  ]) {
    const invalid = structuredClone(output); Object.assign(invalid.interpretations[4]!, change);
    assert.throws(() => recover(batch, invalid), /exact_duplicate_recovery_invalid/u);
  }
  for (const invalid of [
    { interpretations: rows },
    { interpretations: [...rows.slice(0, 3), rows[0], rows[0]] },
    { interpretations: [...rows, rows[0], rows[0]] },
    { interpretations: [...rows, { ...rows[0], cluster_id: "guided:foreign" }] },
    { ...output, extra: true },
  ]) assert.throws(() => recover(batch, invalid), /exact_duplicate_recovery_invalid/u);
  for (const change of [{ citations: ["r31"] }, { cluster_digest: sha("different group") }]) {
    const invalid = structuredClone(output); Object.assign(invalid.interpretations[0]!, change);
    assert.throws(() => recover(batch, invalid), /evidence|citation|identity/u);
  }
});

test("missing and more than thirty valid references persist advisory warnings without modifying provider bytes", async () => {
  const { SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1: pilot } = await import("./signal-workspace-interpretation-v1.js");
  const group = cluster(1), batch = buildSignalWorkspaceInterpretationBatchV1(context, [group], pilot);
  const output = { interpretations: [{ ...answer(group), citations: Array.from({ length: 61 }, () => "r1"),
    inclusion: [{ text: "Observed experience", citations: [] }], exclusion: [] }] };
  const bytes = JSON.stringify(output);
  const result = decodeSignalWorkspaceInterpretationProviderResultV1(batch, output)[0]!;
  assert.equal(result.citations.length, 61);
  assert.ok(result.warnings?.some(warning => warning.code === "references_excess" && warning.count === 61));
  assert.ok(result.warnings?.some(warning => warning.code === "references_missing" && warning.field === "inclusion.0.citations"));
  assert.equal(JSON.stringify(output), bytes);
  const missing = { interpretations: [{ ...answer(group), citations: undefined, inclusion: [{ text: "Observed experience" }], exclusion: [] }] };
  assert.equal(decodeSignalWorkspaceInterpretationProviderResultV1(batch, missing)[0]!.warnings?.length, 2);
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch,
    { interpretations: [{ ...output.interpretations[0], citations: ["r2"] }] }), /citation_invalid/);
});

test("multilingual editorial profiles validate English canonical wording and retain corpus originals through materialization", async () => {
  const { SIGNAL_WORKSPACE_INTERPRETATION_MULTILINGUAL_CONFIGURATION_V1: multilingual } = await import("./signal-workspace-interpretation-v1.js");
  const { mergeSignalWorkspaceTopicMaterializationV1 } = await import("./signal-workspace-topic-materialization-v1.js");
  const group = cluster(1), historical = buildSignalWorkspaceInterpretationBatchV1(context, [group]);
  const batch = buildSignalWorkspaceInterpretationBatchV1(context, [group], multilingual);
  const localization = { original_language: "pt-BR", original: { name: "Experiências de entrega", definition: "Pessoas descrevem experiências de entrega." },
    en: { name: "Delivery experiences", definition: "People describe delivery experiences." },
    es: { name: "Experiencias de entrega", definition: "Personas describen experiencias de entrega." } };
  const wire = { interpretations: [{ ...answer(group), name: localization.en.name, definition: localization.en.definition,
    localization, citations: [], inclusion: [] }] };
  const parsed = decodeSignalWorkspaceInterpretationProviderResultV1(batch, wire);
  assert.deepEqual(parsed[0]!.localization, localization);
  const materialized = mergeSignalWorkspaceTopicMaterializationV1({ prior: [], interpretations: [{ result: parsed[0]!, artifact_id: context.workspace_id }],
    execution_id: context.execution_id, now: "2026-11-08T00:00:00.000Z", locale: "pt-BR", interpretation_configuration: multilingual });
  assert.equal(materialized.definitions[0]!.label, localization.en.name);
  assert.deepEqual(materialized.definitions[0]!.localization, localization);
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch,
    { interpretations: [{ ...wire.interpretations[0], localization: undefined }] }), /localization_missing/);
  assert.throws(() => decodeSignalWorkspaceInterpretationProviderResultV1(batch,
    { interpretations: [{ ...wire.interpretations[0], name: localization.original.name }] }), /localization_invalid/);
  assert.equal(JSON.parse(historical.request_body).output_config.format.schema.properties.interpretations.items.properties.localization, undefined);
  assert.ok(JSON.parse(batch.request_body).output_config.format.schema.properties.interpretations.items.required.includes("localization"));
  assert.deepEqual(buildSignalWorkspaceInterpretationBatchV1(context, [group]).request_body, historical.request_body);
});
