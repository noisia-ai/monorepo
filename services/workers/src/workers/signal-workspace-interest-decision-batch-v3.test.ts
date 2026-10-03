import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildSignalWorkspaceInterestDecisionRequestV1,
  parseSignalWorkspaceInterestDecisionProviderOutputV2,
  signalWorkspaceEmbeddingDigestV1,
  type SignalWorkspaceInterestDecisionRequestBodyV1,
} from "@noisia/query-engine";
import { buildSignalWorkspaceInterestDecisionPageManifestV2 } from "./signal-workspace-interest-decision-batch-v2";
import {
  buildSignalWorkspaceInterestDecisionProviderRequestV3,
  SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_CONFIGURATION_V3,
} from "./signal-workspace-interest-decision-batch-v3";

const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const text = "La actualización mejoró el sonido y acepté la invitación.";
const root = { root_id: "00000000-0000-4000-8000-000000000003", fingerprint: sha("root"),
  correction_digest: sha("correction"), asset_sha256: sha(text),
  chunks: [{ chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text), text }] };
const page: SignalWorkspaceInterestDecisionRequestBodyV1 = {
  contract_version: "signal-workspace-interest-decision-v1",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  context_digest: sha("context"), decision_policy_digest: sha("policy"),
  interest: { taxonomy_term_id: "00000000-0000-4000-8000-000000000002",
    term_key: "consent", definition_revision: 1, definition_digest: sha("definition"),
    definition: "Activación no solicitada y consentimiento de Alexa+",
    inclusion: ["Activación impuesta"], exclusion: ["Activación voluntaria"] },
  roots: [root],
};
const v2Manifest = () => buildSignalWorkspaceInterestDecisionPageManifestV2({
  page, expected_root_ids: [root.root_id],
});

test("V3 prompt and identity are distinct while sealed V2 bytes remain unchanged", () => {
  // Captured before V3 existed; guards the exact V2 request serialization.
  const expectedV2BytesDigest = "sha256:c83b18fd5a03efb296ea4781bd301dd25dbf3ee1d10a3eed4911e760a3fc4f1f";
  const before = v2Manifest();
  assert.equal(sha(JSON.stringify(before)), expectedV2BytesDigest);
  const request = buildSignalWorkspaceInterestDecisionRequestV1(page);
  const v3 = buildSignalWorkspaceInterestDecisionProviderRequestV3(request);
  assert.equal(sha(JSON.stringify(v2Manifest())), expectedV2BytesDigest);
  assert.equal(v3.contract_version, "signal-workspace-interest-decision-batch-request-v3");
  assert.equal(v3.request_digest, request.request_digest);
  assert.equal(v3.configuration, SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_CONFIGURATION_V3);
  assert.notEqual(v3.configuration.prompt_digest, before.configuration.prompt_digest);
  assert.notEqual(v3.provider_request_digest, before.requests[0]!.provider_request_digest);
  assert.match(v3.provider_request.custom_id, /^id3_[a-f0-9]{60}$/u);
  assert.equal(v3.provider_request.custom_id,
    `id3_${v3.provider_request_digest.slice(7, 67)}`);
  assert.equal(v3.provider_request_bytes, Buffer.byteLength(JSON.stringify(v3.provider_request), "utf8"));
  assert.equal(v3.provider_request_digest, signalWorkspaceEmbeddingDigestV1({
    request_digest: request.request_digest, configuration: v3.configuration,
    params: v3.provider_request.params,
  }));
  const v2Params = before.requests[0]!.provider_request.params;
  const v3Params = v3.provider_request.params;
  assert.deepEqual(v3Params, { ...v2Params, system: v3Params.system });
  assert.equal(v3.configuration.prompt_digest, sha(v3Params.system as string));
  assert.match(v3Params.system as string, /No infieras esa falta/u);
  assert.match(v3Params.system as string, /reactivación tras optar por salir/u);
  assert.match(v3Params.system as string, /solicitud expresa de desactivar o revertir el producto/u);
  assert.match(v3Params.system as string, /Una conversación mixta pertenece sólo si/u);
});

test("V3 keeps V2 input and output shapes with server-derived literal citations", () => {
  const request = buildSignalWorkspaceInterestDecisionRequestV1(page);
  const v3 = buildSignalWorkspaceInterestDecisionProviderRequestV3(request);
  const v2 = v2Manifest().requests[0]!.provider_request;
  const v3Input = JSON.parse((v3.provider_request.params.messages as { content: string }[])[0]!.content);
  const v2Input = JSON.parse((v2.params.messages as { content: string }[])[0]!.content);
  assert.deepEqual(v3Input, v2Input);
  assert.deepEqual(v3.provider_request.params.output_config, v2.params.output_config);
  const spanId = v3Input.roots[0].chunks[0].spans[0].span_id as string;
  const parsed = parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: { contract_version: "signal-workspace-interest-decision-provider-output-v2",
      decisions: [{ root_ordinal: 0, verdict: "not_belongs",
        rationale: "Activación voluntaria, sin falta de consentimiento.",
        citations: [{ span_id: spanId, role: "context" }] }] } });
  assert.equal(parsed.output.decisions[0]!.verdict, "not_belongs");
  assert.equal(parsed.output.decisions[0]!.citations[0]!.quote, text);
  assert.equal(parsed.output.decisions[0]!.citations[0]!.chunk_sha256, sha(text));
});

test("V3 rejects a changed V1 source digest before producing provider bytes", () => {
  const request = buildSignalWorkspaceInterestDecisionRequestV1(page);
  assert.throws(() => buildSignalWorkspaceInterestDecisionProviderRequestV3({
    ...request, request_digest: sha("other"),
  }), /source_request_invalid_or_too_large/u);
});
