import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildSignalWorkspaceInterestDecisionRequestV1,
  parseSignalWorkspaceInterestDecisionOutputV1,
  signalWorkspaceEmbeddingDigestV1,
  type SignalWorkspaceClassificationIdentityV1,
  type SignalWorkspaceInterestDecisionOutputV1
} from "@noisia/query-engine";
import { buildSignalWorkspaceInterestDecisionOutcomesV1 } from "./signal-workspace-interest-decision-outcome";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const values = ["Alexa+ se activó sin mi permiso.", "Pedí activar Alexa+ y acepté.", "Se activó Alexa+; falta contexto."];
const interest = { taxonomy_term_id: randomUUID(), term_key: "alexa_consent", definition_revision: 2,
  definition_digest: sha("definition"), definition: "Activación no solicitada de Alexa+",
  inclusion: ["Sin permiso"], exclusion: ["Con consentimiento"] };
const compiler_digest = sha("compiler");
const roots = values.map((value, index) => ({ root_id: randomUUID(), fingerprint: sha(`root${index}`),
  correction_digest: sha(`correction${index}`), asset_sha256: sha(value),
  chunks: [{ chunk_index: 0, start: 0, end: value.length, chunk_sha256: sha(value), text: value }] }));
const request = buildSignalWorkspaceInterestDecisionRequestV1({
  contract_version: "signal-workspace-interest-decision-v1", workspace_id: randomUUID(),
  context_digest: sha("context"), decision_policy_digest: sha("policy"), interest, roots
});
const identity: SignalWorkspaceClassificationIdentityV1 = {
  contract_version: "signal-workspace-classification-v1", workspace_id: request.workspace_id,
  engine_key: "interest_model", engine_version: 1, engine_artifact_digest: sha("engine"),
  embedding_config_digest: sha("embedding"),
  catalog_digest: signalWorkspaceEmbeddingDigestV1([{ term_key: interest.term_key,
    definition_digest: interest.definition_digest, definition_revision: interest.definition_revision }]),
  compiler_digest: signalWorkspaceEmbeddingDigestV1([{ term_key: interest.term_key, compiler_digest }]),
  context_digest: request.context_digest, decision_policy_digest: request.decision_policy_digest
};
function output(): SignalWorkspaceInterestDecisionOutputV1 {
  return { contract_version: "signal-workspace-interest-decision-v1", request_digest: request.request_digest,
    interest, decisions: roots.map((root, index) => ({ root_id: root.root_id, root_fingerprint: root.fingerprint,
      asset_sha256: root.asset_sha256, verdict: (["belongs", "not_belongs", "insufficient"] as const)[index]!,
      rationale: ["Sin permiso.", "Consentimiento explícito.", "Falta contexto."][index]!,
      citations: index === 2 ? [] : [{ chunk_index: 0, chunk_sha256: root.chunks[0]!.chunk_sha256,
        quote_start: 0, quote_end: index === 0 ? 6 : 4, quote: index === 0 ? "Alexa+" : "Pedí",
        role: index === 0 ? "supports" as const : "context" as const }] })) };
}
const parsed = parseSignalWorkspaceInterestDecisionOutputV1({ request, output: output() });
const authority = { model_version_id: randomUUID(), approval_policy_id: randomUUID(),
  model_receipt_digest: sha("settled-claude-receipt"), model_receipt_output_digest: parsed.output_digest };
const build = (changes: Partial<Parameters<typeof buildSignalWorkspaceInterestDecisionOutcomesV1>[0]> = {}) =>
  buildSignalWorkspaceInterestDecisionOutcomesV1({ request, parsed, identity, compiler_digest, authority, ...changes });

test("valid receipt and policy produce one complete classified outcome per root", () => {
  const outcomes = build();
  assert.deepEqual(outcomes.map(item => item.resolution_state), ["approved", "rejected", "abstained"]);
  assert.deepEqual(outcomes.map(item => item.decisions.length), [1, 1, 0]);
  assert.equal(outcomes[0]!.decisions[0]!.model_version_id, authority.model_version_id);
  assert.equal(outcomes[0]!.decisions[0]!.approval_policy_id, authority.approval_policy_id);
  assert.equal(outcomes[1]!.decisions[0]!.approval_policy_id, null);
  assert.ok(outcomes.every(item => item.coverage.expected_chunks === 1 && item.coverage.processed_chunks === 1));
  assert.ok(outcomes.every(item => item.decisions.every(decision => decision.score === null)));
});

test("model and policy receipts are explicit inputs, never inferred from the verdict", () => {
  assert.throws(() => build({ authority: { ...authority, approval_policy_id: null } }), /approval_policy_required/u);
  assert.throws(() => build({ authority: { ...authority, model_version_id: "missing" } }), /authority_invalid/u);
  assert.throws(() => build({ authority: { ...authority, model_receipt_output_digest: sha("different") } }), /model_receipt_mismatch/u);
  assert.throws(() => build({ authority: { ...authority, model_receipt_digest: "not-a-digest" } }), /model_receipt_mismatch/u);
});

test("classification identity must represent precisely this one interest", () => {
  assert.throws(() => build({ identity: { ...identity, workspace_id: randomUUID() } }), /classification_identity_mismatch/u);
  assert.throws(() => build({ identity: { ...identity, catalog_digest: sha("forty-interests") } }), /classification_identity_mismatch/u);
  assert.throws(() => build({ identity: { ...identity, decision_policy_digest: sha("different") } }), /classification_identity_mismatch/u);
  assert.throws(() => build({ compiler_digest: sha("changed") }), /classification_identity_mismatch/u);
});

test("full contiguous chunks must reconstruct the asset before coverage is asserted", () => {
  const { request_digest: _requestDigest, ...requestBody } = request;
  const incomplete = buildSignalWorkspaceInterestDecisionRequestV1({ ...requestBody,
    roots: [{ ...roots[0]!, asset_sha256: sha("unseen text"), chunks: roots[0]!.chunks }]
  });
  const decision = { ...parsed.output.decisions[0]!, asset_sha256: sha("unseen text") };
  const cited = parseSignalWorkspaceInterestDecisionOutputV1({ request: incomplete,
    output: { ...parsed.output, request_digest: incomplete.request_digest, decisions: [decision] } });
  assert.throws(() => build({ request: incomplete, parsed: cited, authority: { ...authority,
    model_receipt_output_digest: cited.output_digest } }), /chunk_coverage_incomplete/u);
  const splitText = "Part onePart two";
  const gap = buildSignalWorkspaceInterestDecisionRequestV1({ ...requestBody, roots: [{ ...roots[0]!,
    asset_sha256: sha(splitText), chunks: [
      { chunk_index: 0, start: 0, end: 8, chunk_sha256: sha("Part one"), text: "Part one" },
      { chunk_index: 1, start: 9, end: 17, chunk_sha256: sha("Part two"), text: "Part two" }
    ] }] });
  const gapOutput = parseSignalWorkspaceInterestDecisionOutputV1({ request: gap, output: {
    ...parsed.output, request_digest: gap.request_digest, decisions: [{ ...decision,
      asset_sha256: sha(splitText), citations: [{ chunk_index: 0, chunk_sha256: sha("Part one"),
        quote_start: 0, quote_end: 4, quote: "Part", role: "supports" }] }] } });
  assert.throws(() => build({ request: gap, parsed: gapOutput, authority: { ...authority,
    model_receipt_output_digest: gapOutput.output_digest } }), /chunk_coverage_incomplete/u);
});

test("tampered parsed output is revalidated and replay hashes stay stable", () => {
  assert.deepEqual(build(), build());
  const bad = { ...parsed, output: { ...parsed.output, decisions: [{ ...parsed.output.decisions[0]!,
    citations: [{ ...parsed.output.decisions[0]!.citations[0]!, quote: "changed" }] }, ...parsed.output.decisions.slice(1)] } };
  assert.throws(() => build({ parsed: bad }), /citation_invalid/u);
  const changed = parseSignalWorkspaceInterestDecisionOutputV1({ request, output: {
    ...output(), decisions: [{ ...output().decisions[0]!, rationale: "Otra explicación." }, ...output().decisions.slice(1)] } });
  assert.notEqual(build({ parsed: changed, authority: { ...authority,
    model_receipt_output_digest: changed.output_digest } })[0]!.evidence_digest, build()[0]!.evidence_digest);
});
