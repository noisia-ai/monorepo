import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { signalWorkspaceEmbeddingDigestV1, type SignalWorkspaceInterestDecisionRequestBodyV1 } from "@noisia/query-engine";
import { AnthropicBatchTransportError, type AnthropicBatchItem } from "../providers/anthropic-message-batches";
import {
  buildSignalWorkspaceInterestDecisionPageManifestV1,
  parseSignalWorkspaceInterestDecisionBatchItemV1,
  reconcileSignalWorkspaceInterestDecisionPageItemsV1,
  signalWorkspaceInterestDecisionTransportRecoveryV1,
  validateSignalWorkspaceInterestDecisionPageManifestV1,
} from "./signal-workspace-interest-decision-batch-v1";

const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const values = ["Alexa+ se activó sin mi permiso.", "Pedí activar Alexa+ y acepté.",
  "Se activó Alexa+; no sé quién aceptó.", "El clima está soleado.", "Alexa+ pidió consentimiento y lo rechacé."];
const roots = values.map((text, index) => ({ root_id: randomUUID(), fingerprint: sha(`root-${index}`),
  correction_digest: sha(`correction-${index}`), asset_sha256: sha(text),
  chunks: [{ chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text), text }] }));
const page: SignalWorkspaceInterestDecisionRequestBodyV1 = {
  contract_version: "signal-workspace-interest-decision-v1", workspace_id: randomUUID(),
  context_digest: sha("context"), decision_policy_digest: sha("policy"),
  interest: { taxonomy_term_id: randomUUID(), term_key: "alexa_consent", definition_revision: 2,
    definition_digest: sha("definition"), definition: "Activación no solicitada y consentimiento de Alexa+",
    inclusion: ["Activación sin permiso"], exclusion: ["Activación solicitada"] }, roots,
};
const expected_root_ids = roots.map(root => root.root_id);
const build = (changes: Partial<Parameters<typeof buildSignalWorkspaceInterestDecisionPageManifestV1>[0]> = {}) =>
  buildSignalWorkspaceInterestDecisionPageManifestV1({ page, expected_root_ids, ...changes });
type Request = ReturnType<typeof build>["requests"][number];
function output(request: Request) {
  return { contract_version: "signal-workspace-interest-decision-v1", request_digest: request.request.request_digest,
    interest_identity_digest: signalWorkspaceEmbeddingDigestV1(request.request.interest),
    decisions: request.request.roots.map((root, index) => ({
      root_id: root.root_id, root_fingerprint: root.fingerprint, asset_sha256: root.asset_sha256,
      verdict: (index % 3 === 0 ? "belongs" : index % 3 === 1 ? "not_belongs" : "insufficient") as
        "belongs" | "not_belongs" | "insufficient",
      rationale: "La cita permite decidir o muestra incertidumbre.",
      citations: index % 3 === 2 ? [] : [{ chunk_index: 0, chunk_sha256: root.chunks[0]!.chunk_sha256,
        quote_start: 0, quote_end: 2, quote: root.chunks[0]!.text.slice(0, 2),
        role: index % 3 === 0 ? "supports" : "context" }],
    })) };
}
function success(request: Request, changedOutput?: unknown): { item: AnthropicBatchItem; rawText: string } {
  const item: AnthropicBatchItem = { custom_id: request.provider_request.custom_id,
    result: { type: "succeeded", message: { id: "msg_test", type: "message", role: "assistant",
      model: "claude-sonnet-4-6", stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(changedOutput ?? output(request)) }],
      usage: { input_tokens: 100, output_tokens: 40 } } } };
  return { item, rawText: JSON.stringify(item) };
}

test("all page roots and complete chunks enter deterministic Sonnet JSON requests", () => {
  const manifest = build();
  validateSignalWorkspaceInterestDecisionPageManifestV1(manifest);
  assert.deepEqual(build(), manifest);
  assert.deepEqual(manifest.requests.flatMap(request => request.root_ids), expected_root_ids);
  assert.equal(manifest.requests.every(request => request.provider_request.params.model === "claude-sonnet-4-6"), true);
  assert.equal(manifest.requests.every(request => request.provider_request.custom_id.length === 64), true);
  assert.equal(manifest.requests.every(request => request.provider_request.params.stream !== true), true);
  const source = manifest.requests.flatMap(request => request.request.roots.flatMap(root => root.chunks.map(chunk => chunk.text)));
  assert.deepEqual(source, values);
  const params = manifest.requests[0]!.provider_request.params as unknown as {
    output_config: { format: { type: string; schema: object } } };
  assert.equal(params.output_config.format.type, "json_schema");
  assert.equal(JSON.stringify(params.output_config.format.schema).includes('"maxItems"'), false);
  assert.equal(JSON.stringify(params.output_config.format.schema).includes('"interest_identity_digest"'), true);
  assert.equal(JSON.stringify(params.output_config.format.schema).includes('"definition_revision"'), false);
  const changed = build({ page: { ...page, roots: [...roots.slice(0, 1), { ...roots[1]!, fingerprint: sha("changed") }, ...roots.slice(2)] } });
  const changedParams = changed.requests[0]!.provider_request.params as unknown as typeof params;
  assert.deepEqual(changedParams.output_config.format.schema, params.output_config.format.schema);
  assert.notEqual(changed.manifest_digest, manifest.manifest_digest);
  assert.notEqual(changed.requests[0]!.provider_request.custom_id, manifest.requests[0]!.provider_request.custom_id);
});

test("byte packing creates requests without dropping roots; oversized single root fails closed", () => {
  const singleSizes = roots.map(root => build({ page: { ...page, roots: [root] }, expected_root_ids: [root.root_id] })
    .requests[0]!.provider_request_bytes);
  const limit = Math.max(...singleSizes);
  const manifest = build({ max_request_bytes: limit });
  assert.equal(manifest.requests.length, roots.length);
  assert.deepEqual(manifest.requests.flatMap(request => request.root_ids), expected_root_ids);
  assert.ok(manifest.requests.every(request => request.provider_request_bytes <= limit));
  validateSignalWorkspaceInterestDecisionPageManifestV1(manifest);
  assert.throws(() => build({ max_request_bytes: Math.min(...singleSizes) - 1 }), /single_root_request_too_large/u);
  assert.throws(() => build({ expected_root_ids: expected_root_ids.slice(1) }), /page_coverage_invalid/u);
  assert.throws(() => build({ expected_root_ids: [...expected_root_ids].reverse() }), /page_coverage_invalid/u);
});

test("a page larger than one QE request is partitioned and reconciled in any result order", () => {
  const many = Array.from({ length: 65 }, (_, index) => ({ ...roots[0]!, root_id: randomUUID(),
    fingerprint: sha(`many-${index}`) }));
  const manifest = build({ page: { ...page, roots: many }, expected_root_ids: many.map(root => root.root_id) });
  assert.equal(manifest.requests.length, 2);
  assert.deepEqual(manifest.requests.map(request => request.root_ids.length), [64, 1]);
  assert.deepEqual(manifest.requests.flatMap(request => request.root_ids), many.map(root => root.root_id));
  const items = manifest.requests.map(request => success(request)).reverse();
  const reconciled = reconcileSignalWorkspaceInterestDecisionPageItemsV1({ manifest, items });
  assert.equal(reconciled.status, "accepted");
  assert.deepEqual(reconciled.results.map(result => result.custom_id),
    manifest.requests.map(request => request.provider_request.custom_id));
  assert.throws(() => reconcileSignalWorkspaceInterestDecisionPageItemsV1({ manifest, items: items.slice(1) }),
    /result_coverage_incomplete/u);
});

test("invalid source coverage and tampered manifest fail before any send", () => {
  assert.throws(() => build({ page: { ...page, roots: [{ ...roots[0]!, asset_sha256: sha("other") }, ...roots.slice(1)] } }),
    /source_asset_invalid/u);
  assert.throws(() => build({ page: { ...page, roots: [{ ...roots[0]!, chunks: [{ ...roots[0]!.chunks[0]!, start: 1 }] }, ...roots.slice(1)] } }),
    /source_chunk_coverage_invalid/u);
  const manifest = build();
  assert.throws(() => validateSignalWorkspaceInterestDecisionPageManifestV1({ ...manifest, manifest_digest: sha("tampered") }),
    /manifest_digest_invalid/u);
  const changed = structuredClone(manifest);
  changed.requests[0]!.provider_request.custom_id = "foreign";
  assert.throws(() => validateSignalWorkspaceInterestDecisionPageManifestV1(changed), /manifest_digest_invalid/u);
});

test("a valid provider item remains a cited proposal, with a stable replay digest", () => {
  const manifest = build();
  const item = success(manifest.requests[0]!);
  const result = parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, ...item });
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("test_invalid_status");
  assert.equal(result.parsed.output.decisions.length, roots.length);
  assert.equal(result.parsed.output.decisions[0]!.verdict, "belongs");
  assert.equal(result.parsed.output.decisions[1]!.verdict, "not_belongs");
  assert.equal(result.parsed.output.decisions[2]!.verdict, "insufficient");
  assert.deepEqual(parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, ...item }), result);
  assert.deepEqual(reconcileSignalWorkspaceInterestDecisionPageItemsV1({ manifest, items: [item, item] }),
    { status: "accepted", results: [result] });
});

test("provider failures, refusal and invalid citations are never semantic negatives", () => {
  const manifest = build(), request = manifest.requests[0]!;
  const errored: AnthropicBatchItem = { custom_id: request.provider_request.custom_id, result: { type: "errored", error: { type: "api_error" } } };
  const failed = parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, item: errored, rawText: JSON.stringify(errored) });
  assert.equal(failed.status, "provider_error");
  assert.equal(reconcileSignalWorkspaceInterestDecisionPageItemsV1({ manifest,
    items: [{ item: errored, rawText: JSON.stringify(errored) }] }).status, "needs_recovery");
  const refused = success(request);
  (refused.item.result as { message: { stop_reason: string } }).message.stop_reason = "refusal";
  refused.rawText = JSON.stringify(refused.item);
  assert.equal(parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, ...refused }).status, "refusal");
  const invalid = output(request);
  invalid.decisions[0]!.citations[0]!.quote = "fabricated";
  assert.equal(parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, ...success(request, invalid) }).status, "invalid_output");
  const wrongRequest = output(request);
  wrongRequest.request_digest = sha("another request");
  assert.equal(parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, ...success(request, wrongRequest) }).status, "invalid_output");
  const wrongRoot = output(request);
  wrongRoot.decisions[0]!.root_id = randomUUID();
  assert.equal(parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, ...success(request, wrongRoot) }).status, "invalid_output");
});

test("foreign, missing and conflicting results require recovery; POST ambiguity never retries", () => {
  const manifest = build(), request = manifest.requests[0]!;
  assert.throws(() => parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, ...success({ ...request,
    provider_request: { ...request.provider_request, custom_id: "foreign" } }) }), /foreign_custom_id/u);
  assert.throws(() => reconcileSignalWorkspaceInterestDecisionPageItemsV1({ manifest, items: [] }), /result_coverage_incomplete/u);
  const item = success(request);
  const changed = success(request);
  (changed.item.result as { message: { id: string } }).message.id = "msg_other";
  changed.rawText = JSON.stringify(changed.item);
  assert.throws(() => reconcileSignalWorkspaceInterestDecisionPageItemsV1({ manifest, items: [item, changed] }),
    /duplicate_result_conflict/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionBatchItemV1({ manifest, item: item.item,
    rawText: JSON.stringify({ ...item.item, custom_id: "foreign" }) }), /result_envelope_mismatch/u);
  assert.equal(signalWorkspaceInterestDecisionTransportRecoveryV1(new AnthropicBatchTransportError("timeout", "submission_unknown")),
    "submission_unknown");
  assert.equal(signalWorkspaceInterestDecisionTransportRecoveryV1(new AnthropicBatchTransportError("400", "not_submitted")),
    "known_rejection");
  assert.equal(signalWorkspaceInterestDecisionTransportRecoveryV1(new AnthropicBatchTransportError("read", "read_failed")),
    "retry_read");
});
