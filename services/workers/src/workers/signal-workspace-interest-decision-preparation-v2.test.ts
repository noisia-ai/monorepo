import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { SignalWorkspaceInterestDecisionSourcePageV1 } from "@noisia/db";
import { signalWorkspaceEmbeddingDigestV1,
  type SignalTopicDefinitionV1 } from "@noisia/query-engine";
import { sealSignalWorkspaceInterestDecisionSourcePageV2 } from "./signal-workspace-interest-decision-preparation-v2";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sourceText = "Alexa+ se activó sin permiso 😀.";
const definition: SignalTopicDefinitionV1 = { term_key: "alexa_consent", label: "Consentimiento Alexa+",
  definition: "Activación de Alexa+ y consentimiento", scope: "all_conversations",
  inclusion: ["Sin permiso"], exclusion: ["Con consentimiento"],
  positive_examples: [], negative_examples: [], lifecycle: "draft", origin: "manual", source: null,
  definition_revision: 1, definition_digest: sha("definition"),
  created_at: "2026-10-02T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z" };
const sourcePage: SignalWorkspaceInterestDecisionSourcePageV1 = {
  contract_version: "workspace-interest-decision-source-v1",
  source: { workspace_id: randomUUID(), execution_id: randomUUID(), input_digest: sha("input"),
    input_revision: randomUUID(), taxonomy_profile_id: randomUUID(), preparation_run_id: randomUUID(),
    embedding_run_id: randomUUID(), embedding_config_digest: sha("embedding"),
    context_digest: sha("context"), definition_digest: sha("definitions"),
    correction_digest: sha("correction"), current: true },
  interest: { taxonomy_term_id: randomUUID(), definition, compiler_digest: sha("compiler") },
  roots: [{ root_id: randomUUID(), root_fingerprint: sha("fingerprint"),
    root_correction_digest: sha("root correction"), asset_sha256: sha(sourceText),
    full_text: sourceText, chunks: [{ chunk_index: 0, start: 0, end: sourceText.length,
      chunk_sha256: sha(sourceText), text: sourceText }], chunk_coverage_digest: sha("coverage"),
    suggestion: null, suggestion_state: "not_retained" }], next_root_id: null, done: true,
};

test("V2 page seal preserves source digest and binds exact id2 provider bytes", () => {
  const sealed = sealSignalWorkspaceInterestDecisionSourcePageV2({ page: sourcePage,
    decision_policy_digest: sha("policy") });
  assert.equal(sealed.manifest.contract_version, "signal-workspace-interest-decision-page-manifest-v2");
  assert.deepEqual(sealed.manifest.expected_root_ids, [sourcePage.roots[0]!.root_id]);
  assert.equal(signalWorkspaceEmbeddingDigestV1(JSON.parse(sealed.canonical_manifest_body)),
    sealed.manifest.manifest_digest);
  assert.equal(signalWorkspaceEmbeddingDigestV1(JSON.parse(sealed.canonical_page_body)),
    sealed.manifest.page_digest);
  const item = sealed.manifest.requests[0]!, body = sealed.request_bodies[0]!;
  assert.match(item.provider_request.custom_id, /^id2_[0-9a-f]{60}$/u);
  assert.equal(signalWorkspaceEmbeddingDigestV1(JSON.parse(body.provider_core_body)),
    item.provider_request_digest);
  assert.equal(body.provider_body, JSON.stringify(item.provider_request));
  assert.equal(Buffer.byteLength(body.provider_body), item.provider_request_bytes);
  assert.equal(item.request.roots[0]!.chunks[0]!.text, sourceText);
});
