import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_INTEREST_DECISION_CONTRACT_V1 as contract,
  buildSignalWorkspaceInterestDecisionRequestV1,
  parseSignalWorkspaceInterestDecisionOutputV1,
  signalWorkspaceInterestDecisionClassificationIntentV1,
  type SignalWorkspaceInterestDecisionOutputV1
} from "./signal-workspace-interest-decision-v1";
import { signalWorkspaceEmbeddingDigestV1 } from "./signal-workspace-embeddings-v1";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const text = [
  "Alexa+ se activó sin mi permiso y no acepté el cambio.",
  "Pedí activar Alexa+ y confirmé el consentimiento.",
  "Alexa+ se activó, pero no sé si alguien aceptó la opción."
];
const interest = { taxonomy_term_id: randomUUID(), term_key: "alexa_consent", definition_revision: 3,
  definition_digest: sha("definition-v3"), definition: "Activación no solicitada y consentimiento de Alexa+",
  inclusion: ["Activación sin consentimiento"], exclusion: ["Activación solicitada"] };
const roots = text.map((value, index) => ({ root_id: randomUUID(), fingerprint: sha(`root-${index}`),
  correction_digest: sha(`correction-${index}`), asset_sha256: sha(value),
  chunks: [{ chunk_index: 0, start: 0, end: value.length, chunk_sha256: sha(value), text: value }] }));
const request = buildSignalWorkspaceInterestDecisionRequestV1({ contract_version: contract,
  workspace_id: randomUUID(), context_digest: sha("context"), decision_policy_digest: sha("policy"), interest, roots });

function output(): SignalWorkspaceInterestDecisionOutputV1 {
  return { contract_version: contract, request_digest: request.request_digest,
    interest_identity_digest: signalWorkspaceEmbeddingDigestV1(interest),
    decisions: roots.map((root, index) => ({ root_id: root.root_id, root_fingerprint: root.fingerprint,
      asset_sha256: root.asset_sha256, verdict: (["belongs", "not_belongs", "insufficient"] as const)[index]!,
      rationale: ["Reporta ausencia de permiso.", "Reporta aceptación expresa.", "Falta contexto sobre la aceptación."][index]!,
      citations: index === 2 ? [] : [{ chunk_index: 0, chunk_sha256: root.chunks[0]!.chunk_sha256,
        quote_start: 0, quote_end: index === 0 ? 6 : 4, quote: index === 0 ? "Alexa+" : "Pedí",
        role: index === 0 ? "supports" as const : "contradicts" as const }] })) };
}

test("one interest yields exact, cited decisions for positive, negative and insufficient roots", () => {
  const parsed = parseSignalWorkspaceInterestDecisionOutputV1({ request, output: output() });
  assert.deepEqual(parsed.output.decisions.map(item => item.verdict), ["belongs", "not_belongs", "insufficient"]);
  assert.match(parsed.output_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(signalWorkspaceInterestDecisionClassificationIntentV1("belongs"), {
    disposition: "pending", resolution_method: "model", requires_model_receipt: true, approval_policy_id: null });
  assert.equal(signalWorkspaceInterestDecisionClassificationIntentV1("not_belongs").disposition, "rejected");
  assert.equal(signalWorkspaceInterestDecisionClassificationIntentV1("insufficient").disposition, null);
});

test("output identity must match the exact request, interest and every source root", () => {
  const base = output();
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, request_digest: sha("other") } }), /interest_identity_mismatch/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, interest_identity_digest: sha("changed") } }), /interest_identity_mismatch/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, interest } }), /unrecognized_keys/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, decisions: [{ ...base.decisions[0]!, root_fingerprint: sha("changed") }, ...base.decisions.slice(1)] } }),
  /root_identity_mismatch/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, decisions: [base.decisions[0], base.decisions[0], base.decisions[2]] } }), /root_identity_mismatch/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, decisions: base.decisions.slice(0, 2) } }), /root_coverage_mismatch/u);
});

test("citations must use known chunks and exact UTF-16 quote offsets", () => {
  const base = output();
  const changed = (citation: object) => ({ ...base, decisions: [{ ...base.decisions[0]!, citations: [citation] }, ...base.decisions.slice(1)] });
  const citation = base.decisions[0]!.citations[0]!;
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request, output: changed({ ...citation, quote: "Alexis" }) }),
    /citation_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request, output: changed({ ...citation, chunk_sha256: sha("other") }) }),
    /citation_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request, output: changed({ ...citation, chunk_index: 1 }) }),
    /citation_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request, output: changed({ ...citation, quote_end: 7 }) }),
    /citation_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request, output: changed({ ...citation, quote_start: 99 }) }),
    /citation_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, decisions: [{ ...base.decisions[0]!, citations: [citation, citation] }, ...base.decisions.slice(1)] } }),
  /citation_invalid/u);
});

test("source chunks are bound to their exact text, offsets and unique root/chunk ids", () => {
  const body = (({ request_digest: _ignored, ...value }) => value)(request);
  assert.throws(() => buildSignalWorkspaceInterestDecisionRequestV1({ ...body, roots: [roots[0]!, roots[0]!] }),
    /duplicate_root/u);
  assert.throws(() => buildSignalWorkspaceInterestDecisionRequestV1({ ...body, roots: [{ ...roots[0]!, chunks: [roots[0]!.chunks[0]!, roots[0]!.chunks[0]!] }] }),
    /duplicate_chunk/u);
  assert.throws(() => buildSignalWorkspaceInterestDecisionRequestV1({ ...body, roots: [{ ...roots[0]!, chunks: [{ ...roots[0]!.chunks[0]!, text: "tampered" }] }] }),
    /source_chunk_invalid/u);
  const whitespace = "   ";
  assert.equal(buildSignalWorkspaceInterestDecisionRequestV1({ ...body, roots: [{ ...roots[0]!,
    asset_sha256: sha(whitespace), chunks: [{ chunk_index: 0, start: 0, end: whitespace.length,
      chunk_sha256: sha(whitespace), text: whitespace }] }] }).roots[0]?.chunks[0]?.text, whitespace);
});

test("mixed evidence remains insufficient and cannot become approval by adding a score", () => {
  const base = output();
  const first = base.decisions[0]!;
  const mixed = { ...first, verdict: "insufficient" as const, rationale: "Hay evidencia en ambas direcciones.",
    citations: [first.citations[0]!, { ...first.citations[0]!, quote_start: 7, quote_end: 9,
      quote: "se", role: "contradicts" as const }] };
  const parsed = parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, decisions: [mixed, ...base.decisions.slice(1)] } });
  assert.equal(parsed.output.decisions[0]?.verdict, "insufficient");
  assert.equal(signalWorkspaceInterestDecisionClassificationIntentV1("insufficient").disposition, null);
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, decisions: [{ ...first, score: 0.99 }, ...base.decisions.slice(1)] } }));
});

test("a negative decision may cite unrelated context rather than a literal contradiction", () => {
  const base = output();
  const negative = base.decisions[1]!;
  const contextual = { ...negative, citations: negative.citations.map(citation => ({ ...citation, role: "context" as const })) };
  const parsed = parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, decisions: [base.decisions[0]!, contextual, base.decisions[2]!] } });
  assert.equal(parsed.output.decisions[1]?.verdict, "not_belongs");
  assert.throws(() => parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...base, decisions: [base.decisions[0]!, { ...negative, citations: [] }, base.decisions[2]!] } }),
  /exclusion_evidence_required/u);
});

test("canonical output digest supports exact replay despite response ordering", () => {
  const first = parseSignalWorkspaceInterestDecisionOutputV1({ request, output: output() });
  const reordered = parseSignalWorkspaceInterestDecisionOutputV1({ request,
    output: { ...output(), decisions: [...output().decisions].reverse() } });
  assert.deepEqual(first, reordered);
  const changed = output(); changed.decisions[0] = { ...changed.decisions[0]!, rationale: "Otra conclusión." };
  assert.notEqual(parseSignalWorkspaceInterestDecisionOutputV1({ request, output: changed }).output_digest, first.output_digest);
});

test("a verbose but structured rationale is accepted without an arbitrary short text gate", () => {
  const long = output();
  long.decisions[0] = { ...long.decisions[0]!, rationale: "Evidencia: ".repeat(800) };
  assert.equal(parseSignalWorkspaceInterestDecisionOutputV1({ request, output: long }).output.decisions[0]?.verdict, "belongs");
});
