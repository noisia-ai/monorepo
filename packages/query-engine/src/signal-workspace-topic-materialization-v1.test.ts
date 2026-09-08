import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mergeSignalWorkspaceTopicMaterializationV1 as merge, signalWorkspaceMaterializedTopicKeyV1 } from "./signal-workspace-topic-materialization-v1.js";
import { signalTopicDefinitionDigestV1 } from "./signal-topic-catalog-v1.js";
import type { SignalWorkspaceInterpretationV1 } from "./signal-workspace-interpretation-v1.js";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const args = { execution_id: "00000000-0000-4000-8000-000000000001", now: "2026-09-08T20:00:00.000Z", locale: "es-MX" as const };
const artifact_id = "00000000-0000-4000-8000-000000000002";
const result: SignalWorkspaceInterpretationV1 = { cluster_id: "open:stable", cluster_digest: sha("entire membership"), status: "coherent",
  name: "Delivery", definition: "Delivery experiences", inclusion: [{ text: "Delivery experiences", citations: [sha("evidence")] }], exclusion: [], citations: [sha("evidence")] };
test("one stable Topic per unit; first write and replay mapping match without automatic guidance", () => {
  const first = merge({ ...args, prior: [], interpretations: [{ result, artifact_id }] });
  assert.equal(first.topic_count, 1); assert.equal(first.discovered_topic_count, 1);
  const definition = first.definitions[0]!;
  assert.equal(definition.term_key, signalWorkspaceMaterializedTopicKeyV1(result.cluster_id));
  assert.equal(definition.origin, "workspace_discovery"); assert.equal(definition.discovery_guidance, false);
  assert.equal(definition.scope, "all_conversations"); assert.equal(definition.lifecycle, "draft");
  assert.equal(definition.source?.run_key, `workspace-engine:${args.execution_id}`);
  assert.equal(definition.source?.candidate_digest, result.cluster_digest);
  const replay = merge({ ...args, now: "2026-09-09T00:00:00.000Z", prior: first.definitions, interpretations: [{ result, artifact_id }] });
  assert.deepEqual(replay, first);
});
test("existing generated, manually edited and archived Topics all retain exact definitions and original lineage", () => {
  for (const kind of ["generated", "edited", "archived"] as const) {
    const initial = merge({ ...args, prior: [], interpretations: [{ result, artifact_id }] }).definitions[0]!;
    const old = { ...initial, label: kind === "generated" ? initial.label : "Operator label", definition_revision: kind === "generated" ? 1 : 2,
      lifecycle: kind === "archived" ? "archived" as const : "draft" as const };
    old.definition_digest = signalTopicDefinitionDigestV1(old);
    const priorSnapshot = structuredClone(old);
    const next = merge({ ...args, execution_id: "00000000-0000-4000-8000-000000000003", prior: [old],
      interpretations: [{ result: { ...result, name: "New model label", cluster_digest: sha("changed membership") }, artifact_id }] });
    assert.deepEqual(next.definitions, [priorSnapshot]); assert.deepEqual(old, priorSnapshot);
    assert.equal(next.topic_count, kind === "archived" ? 0 : 1);
    assert.equal(next.discovered_topic_count, kind === "archived" ? 0 : 1);
    assert.equal(next.mapping[0]!.cluster_digest, sha("changed membership"));
    assert.equal(next.mapping[0]!.definition_digest, old.definition_digest);
  }
});
test("manual Topics survive; guided and open units have different keys even for same stable suffix", () => {
  const initial = merge({ ...args, prior: [], interpretations: [{ result, artifact_id }] }).definitions[0]!;
  const manual = { ...initial, term_key: "manual_interest", origin: "manual" as const, source: null, discovery_guidance: true };
  manual.definition_digest = signalTopicDefinitionDigestV1(manual);
  const output = merge({ ...args, prior: [manual], interpretations: [
    { result: { ...result, cluster_id: "guided:stable" }, artifact_id }, { result, artifact_id },
  ] });
  assert.deepEqual(output.definitions[0], manual); assert.equal(output.topic_count, 3); assert.equal(output.discovered_topic_count, 2);
  assert.notEqual(output.mapping[0]!.term_key, output.mapping[1]!.term_key);
  assert.deepEqual(output.mapping.map(row => row.unit_key), ["guided:stable", "open:stable"]);
});
test("insufficient output creates an honest localized placeholder; oversize conditions never truncate", () => {
  const insufficient: SignalWorkspaceInterpretationV1 = { ...result, status: "insufficient", name: null, definition: null, inclusion: [], exclusion: [], citations: [] };
  for (const locale of ["es-MX", "en-US"] as const) {
    const output = merge({ ...args, locale, prior: [], interpretations: [{ result: insufficient, artifact_id }] });
    assert.match(output.definitions[0]!.label, locale === "es-MX" ? /sin interpretación suficiente/u : /insufficient/u);
    assert.equal(output.mapping[0]!.status, "insufficient"); assert.deepEqual(output.definitions[0]!.inclusion, []);
  }
  assert.throws(() => merge({ ...args, prior: [], interpretations: [{ result: { ...result, inclusion: [{ text: "x".repeat(241), citations: result.citations }] }, artifact_id }] }), /output_invalid/u);
});
test("duplicate units and unrelated stable-key collisions fail before returning modified definitions", () => {
  assert.throws(() => merge({ ...args, prior: [], interpretations: [{ result, artifact_id }, { result, artifact_id }] }), /proposal_invalid/u);
  const initial = merge({ ...args, prior: [], interpretations: [{ result, artifact_id }] }).definitions[0]!;
  assert.throws(() => merge({ ...args, prior: [{ ...initial, origin: "manual", source: null }], interpretations: [{ result, artifact_id }] }), /key_conflict/u);
});
