import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { SignalWorkspaceInterestDecisionRequestBodyV1 } from "@noisia/query-engine";
import { AnthropicBatchTransportError, type AnthropicBatchItem } from "../providers/anthropic-message-batches";
import {
  buildSignalWorkspaceInterestDecisionPageManifestV2,
  parseSignalWorkspaceInterestDecisionBatchItemV2,
  reconcileSignalWorkspaceInterestDecisionPageItemsV2,
  signalWorkspaceInterestDecisionTransportRecoveryV2,
  validateSignalWorkspaceInterestDecisionPageManifestV2,
  type SignalWorkspaceInterestDecisionBatchRequestV2,
} from "./signal-workspace-interest-decision-batch-v2";

const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const texts = ["Un caso específico de interés.", "Un contexto claramente ajeno.", "Contexto ambiguo."];
const roots = texts.map((text, index) => ({ root_id: randomUUID(), fingerprint: sha(`root-${index}`),
  correction_digest: sha(`correction-${index}`), asset_sha256: sha(text),
  chunks: [{ chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text), text }] }));
const page: SignalWorkspaceInterestDecisionRequestBodyV1 = {
  contract_version: "signal-workspace-interest-decision-v1", workspace_id: randomUUID(),
  context_digest: sha("context"), decision_policy_digest: sha("policy"),
  interest: { taxonomy_term_id: randomUUID(), term_key: "interest", definition_revision: 1,
    definition_digest: sha("definition"), definition: "Caso específico de interés",
    inclusion: ["Caso específico"], exclusion: ["Contexto ajeno"] }, roots,
};
const build = (changes: Partial<Parameters<typeof buildSignalWorkspaceInterestDecisionPageManifestV2>[0]> = {}) =>
  buildSignalWorkspaceInterestDecisionPageManifestV2({ page, expected_root_ids: roots.map(root => root.root_id), ...changes });
function providerInput(request: SignalWorkspaceInterestDecisionBatchRequestV2) {
  const params = request.provider_request.params as unknown as { messages: { content: string }[] };
  return JSON.parse(params.messages[0]!.content) as { roots: { chunks: { spans: { span_id: string; text: string }[] }[] }[] };
}
function output(request: SignalWorkspaceInterestDecisionBatchRequestV2) {
  const input = providerInput(request);
  return { contract_version: "signal-workspace-interest-decision-provider-output-v2",
    decisions: input.roots.map((root, index) => ({ root_ordinal: index,
      verdict: index % 3 === 0 ? "belongs" : index % 3 === 1 ? "not_belongs" : "insufficient",
      rationale: "Razón basada en el contexto.",
      citations: index % 3 === 2 ? [] : [{ span_id: root.chunks[0]!.spans[0]!.span_id,
        role: index % 3 === 0 ? "supports" : "context" }] })) };
}
function success(request: SignalWorkspaceInterestDecisionBatchRequestV2, changed?: unknown) {
  const item: AnthropicBatchItem = { custom_id: request.provider_request.custom_id,
    result: { type: "succeeded", message: { id: "msg_test", type: "message", role: "assistant",
      model: "claude-sonnet-4-6", stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(changed ?? output(request)) }],
      usage: { input_tokens: 100, output_tokens: 40 } } } };
  return { item, rawText: JSON.stringify(item) };
}

test("V2 manifest binds V1 source to compact span input, fixed schema and id2 transport", () => {
  const manifest = build();
  validateSignalWorkspaceInterestDecisionPageManifestV2(manifest);
  assert.deepEqual(manifest, build());
  assert.deepEqual(manifest.requests.flatMap(item => item.root_ids), roots.map(root => root.root_id));
  assert.ok(manifest.requests.every(item => /^id2_[a-f0-9]{60}$/u.test(item.provider_request.custom_id)));
  const request = manifest.requests[0]!;
  const input = providerInput(request);
  assert.deepEqual(input.roots.map(root => root.chunks[0]!.spans.map(span => span.text).join("")), texts);
  const params = request.provider_request.params as unknown as { output_config: { format: { schema: object } } };
  const schema = JSON.stringify(params.output_config.format.schema);
  assert.ok(schema.includes("root_ordinal") && schema.includes("span_id"));
  assert.ok(!schema.includes("request_digest") && !schema.includes("quote_start") && !schema.includes("root_id"));
  assert.ok(!JSON.stringify(input).includes(request.request.request_digest));
  assert.throws(() => validateSignalWorkspaceInterestDecisionPageManifestV2({ ...manifest,
    manifest_digest: sha("changed") }), /manifest_digest_invalid/u);
});

test("byte packing preserves every source root; oversized single root fails before submission", () => {
  const sizes = roots.map(root => build({ page: { ...page, roots: [root] }, expected_root_ids: [root.root_id] })
    .requests[0]!.provider_request_bytes);
  const packed = build({ max_request_bytes: Math.max(...sizes) });
  assert.equal(packed.requests.length, roots.length);
  validateSignalWorkspaceInterestDecisionPageManifestV2(packed);
  assert.throws(() => build({ max_request_bytes: Math.min(...sizes) - 1 }), /single_root_request_too_large/u);
  assert.throws(() => build({ expected_root_ids: [...roots.map(root => root.root_id)].reverse() }), /page_coverage_invalid/u);
});

test("successful V2 raw result yields canonical V1-shaped proposal with server-derived citations", () => {
  const manifest = build();
  const entry = success(manifest.requests[0]!);
  const result = parseSignalWorkspaceInterestDecisionBatchItemV2({ manifest, ...entry });
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("test_invalid_status");
  assert.equal(result.parsed.output.contract_version, "signal-workspace-interest-decision-v1");
  assert.deepEqual(result.parsed.output.decisions.map(decision => decision.root_id), roots.map(root => root.root_id));
  assert.equal(result.parsed.output.decisions[0]!.citations[0]!.quote, texts[0]);
  assert.deepEqual(reconcileSignalWorkspaceInterestDecisionPageItemsV2({ manifest, items: [entry, entry] }),
    { status: "accepted", results: [result] });
});

test("unknown spans, crossed roots and missed ordinal coverage are terminal invalid_output, never negatives", () => {
  const manifest = build(), request = manifest.requests[0]!, base = output(request);
  for (const changed of [
    { ...base, decisions: [{ ...base.decisions[0]!, citations: [{ span_id: "r0c0s999", role: "supports" }] }, ...base.decisions.slice(1)] },
    { ...base, decisions: [{ ...base.decisions[0]!, citations: base.decisions[1]!.citations }, ...base.decisions.slice(1)] },
    { ...base, decisions: [base.decisions[0], base.decisions[0], base.decisions[2]] },
    { ...base, decisions: base.decisions.slice(0, 2) },
  ]) assert.equal(parseSignalWorkspaceInterestDecisionBatchItemV2({ manifest, ...success(request, changed) }).status, "invalid_output");
  const refusal = success(request);
  (refusal.item.result as { message: { stop_reason: string } }).message.stop_reason = "refusal";
  refusal.rawText = JSON.stringify(refusal.item);
  assert.equal(parseSignalWorkspaceInterestDecisionBatchItemV2({ manifest, ...refusal }).status, "refusal");
  assert.throws(() => parseSignalWorkspaceInterestDecisionBatchItemV2({ manifest, item: success(request).item,
    rawText: JSON.stringify({ ...success(request).item, custom_id: "foreign" }) }), /result_envelope_mismatch/u);
  assert.equal(signalWorkspaceInterestDecisionTransportRecoveryV2(new AnthropicBatchTransportError("timeout", "submission_unknown")),
    "submission_unknown");
});
