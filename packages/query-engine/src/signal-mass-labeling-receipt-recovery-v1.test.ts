import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMassLabelingConsolidationResponseV1,
  recoverMassLabelingConsolidationResponseV1,
  validateMassLabelingConsolidationOutputV1,
} from "./signal-mass-labeling-consolidation-v1";
import { massLabelingReceiptRecoveryFixtureV1, syntheticReceiptShaV1 } from "./signal-mass-labeling-receipt-recovery.synthetic.fixture";

const recover = recoverMassLabelingConsolidationResponseV1;

test("one bound global decision only normalizes three keys and removes the evidenced duplicate membership", () => {
  const f = massLabelingReceiptRecoveryFixtureV1();
  const before = JSON.stringify(f);
  assert.throws(() => parseMassLabelingConsolidationResponseV1(f.batch, f.raw), /contract_invalid/u);
  const first = recover(f.batch, f.raw, f.decision), second = recover(f.batch, f.raw, f.decision);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(f), before);
  assert.equal(first.output.topics.length, 98);
  assert.equal(first.output.excluded_groups.length, 28);
  assert.deepEqual(first.usage, { input_tokens: 100, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const allGroups = [...first.output.topics.flatMap(topic => topic.group_ids), ...first.output.excluded_groups.map(group => group.group_id)];
  assert.equal(allGroups.length, 144);
  assert.equal(new Set(allGroups).size, 144);
  for (const original of f.output.topics) {
    const key = f.decision.topic_key_changes.find(change => change.from === original.topic_key)?.to ?? original.topic_key;
    const normalized = first.output.topics.find(topic => topic.topic_key === key)!;
    assert.equal(normalized.name, original.name);
    assert.equal(normalized.definition, original.definition);
    assert.deepEqual(normalized.group_ids, original.group_ids.filter(group =>
      original.topic_key !== f.decision.assignment_resolution.remove_topic_key || group !== f.decision.assignment_resolution.group_id).sort());
  }
  assert.deepEqual(first.output.excluded_groups, [...f.output.excluded_groups].sort((a, b) => a.group_id.localeCompare(b.group_id)));
  assert.deepEqual(validateMassLabelingConsolidationOutputV1(f.batch.source_groups, first.output), first.output);
  assert.throws(() => parseMassLabelingConsolidationResponseV1(f.batch, f.raw), /contract_invalid/u);
});

test("global recovery fails without the exact decision and sealed request, response and sources", () => {
  const f = massLabelingReceiptRecoveryFixtureV1();
  for (const decision of [undefined, {}, { ...f.decision, approved: true },
    { ...f.decision, request_digest: syntheticReceiptShaV1("foreign request") },
    { ...f.decision, response_sha256: syntheticReceiptShaV1("foreign response") },
    { ...f.decision, source_groups_digest: syntheticReceiptShaV1("foreign groups") },
    { ...f.decision, workspace_id: f.decision.execution_id },
    { ...f.decision, execution_id: f.decision.workspace_id },
    { ...f.decision, call_id: "invalid" },
    { ...f.decision, topic_key_changes: f.decision.topic_key_changes.slice(0, 2) },
    { ...f.decision, topic_key_changes: [...f.decision.topic_key_changes, f.decision.topic_key_changes[0]] },
  ]) assert.throws(() => recover(f.batch, f.raw, decision), /contract_invalid/u);
  assert.throws(() => recover(f.batch, f.raw + " ", f.decision), /contract_invalid/u);
  const changedBatch = structuredClone(f.batch); changedBatch.source_groups[0]!.definition += " changed";
  assert.throws(() => recover(changedBatch, f.raw, f.decision), /contract_invalid/u);
});

test("global recovery requires the declared exact source segments and the exact remaining pair summary", () => {
  const f = massLabelingReceiptRecoveryFixtureV1();
  for (const change of [
    { method: "operator_selection" }, { keep_topic_key: "topico_2" }, { remove_topic_key: "topico_2" },
    { group_id: f.batch.source_groups[10]!.group_id },
    { definition_omission: { ...f.decision.assignment_resolution.definition_omission, prefix_length: 99, suffix_length: 206 } },
    { definition_omission: { ...f.decision.assignment_resolution.definition_omission, removed_length: 0 } },
    { definition_omission: { ...f.decision.assignment_resolution.definition_omission, prefix_length: 0 } },
    { definition_omission: { ...f.decision.assignment_resolution.definition_omission, suffix_length: 0 } },
  ]) assert.throws(() => recover(f.batch, f.raw, { ...f.decision, assignment_resolution: { ...f.decision.assignment_resolution, ...change } }), /contract_invalid/u);
  for (const index of [0, 1]) for (const field of ["name", "definition"] as const) {
    const output = structuredClone(f.output); output.topics[index]![field] += " changed";
    const raw = JSON.stringify({ ...f.envelope, content: [{ type: "text", text: JSON.stringify(output) }] });
    assert.throws(() => recover(f.batch, raw, { ...f.decision, response_sha256: syntheticReceiptShaV1(raw) }), /contract_invalid/u);
  }
});

test("key collisions, unrelated changes, missing groups and additional duplicates remain invalid", () => {
  const f = massLabelingReceiptRecoveryFixtureV1();
  for (const mutation of [
    (output: typeof f.output) => { output.topics[3]!.topic_key = "cafe"; },
    (output: typeof f.output) => { output.topics[3]!.topic_key = "outro_é"; },
    (output: typeof f.output) => { output.topics[3]!.group_ids.push(output.topics[4]!.group_ids[0]!); },
    (output: typeof f.output) => { output.topics[3]!.group_ids = []; },
    (output: typeof f.output) => { output.excluded_groups.pop(); },
    (output: typeof f.output) => { output.topics[3]!.group_ids.push("guided:foreign"); },
    (output: typeof f.output) => { output.topics[3]!.group_ids.push(output.excluded_groups.at(-1)!.group_id); output.excluded_groups.pop(); },
  ]) {
    const output = structuredClone(f.output); mutation(output);
    const raw = JSON.stringify({ ...f.envelope, content: [{ type: "text", text: JSON.stringify(output) }] });
    assert.throws(() => recover(f.batch, raw, { ...f.decision, response_sha256: syntheticReceiptShaV1(raw) }), /contract_invalid/u);
  }
  for (const change of [{ from: "topico_3", to: "topico_3" }, { from: "café", to: "outro" },
    f.decision.topic_key_changes[1]!]) {
    const decision = structuredClone(f.decision); decision.topic_key_changes[0] = change;
    assert.throws(() => recover(f.batch, f.raw, decision), /contract_invalid/u);
  }
});
