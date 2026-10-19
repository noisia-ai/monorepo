import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { buildSignalWorkspaceInterestDecisionRequestV1 } from "./signal-workspace-interest-decision-v1";
import {
  buildSignalWorkspaceInterestDecisionProviderInputV2,
  parseSignalWorkspaceInterestDecisionProviderOutputV2,
  SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_OUTPUT_V2,
} from "./signal-workspace-interest-decision-v2";

const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const texts = ["a".repeat(319) + "😀" + " Caso específico de interés. ".repeat(8),
  "Un contexto ajeno. Un contexto ajeno."];
const request = buildSignalWorkspaceInterestDecisionRequestV1({
  contract_version: "signal-workspace-interest-decision-v1", workspace_id: randomUUID(),
  context_digest: sha("context"), decision_policy_digest: sha("policy"),
  interest: { taxonomy_term_id: randomUUID(), term_key: "interest", definition_revision: 1,
    definition_digest: sha("definition"), definition: "Caso específico de interés",
    inclusion: ["Caso específico"], exclusion: ["Contexto ajeno"] },
  roots: texts.map((text, index) => ({ root_id: randomUUID(), fingerprint: sha(`fingerprint-${index}`),
    correction_digest: sha(`correction-${index}`), asset_sha256: sha(text),
    chunks: [{ chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text), text }] })),
});
const built = buildSignalWorkspaceInterestDecisionProviderInputV2(request);
function output() {
  return { contract_version: SIGNAL_WORKSPACE_INTEREST_DECISION_PROVIDER_OUTPUT_V2,
    decisions: [
      { root_ordinal: 0, verdict: "belongs", rationale: "El caso específico está presente.",
        citations: [{ span_id: built.input.roots[0]!.chunks[0]!.spans[1]!.span_id, role: "supports" }] },
      { root_ordinal: 1, verdict: "not_belongs", rationale: "El contexto es ajeno.",
        citations: [{ span_id: built.input.roots[1]!.chunks[0]!.spans[0]!.span_id, role: "context" }] },
    ] } as const;
}

test("provider spans partition source exactly and canonical citations use literal UTF-16 offsets", () => {
  for (const [index, root] of built.input.roots.entries()) {
    assert.equal(root.root_ordinal, index);
    assert.equal(root.chunks[0]!.spans.map(span => span.text).join(""), texts[index]);
    assert.ok(root.chunks[0]!.spans.every(span => span.text.length <= 320));
  }
  const emoji = texts[0]!.indexOf("😀");
  assert.ok(built.spans.some(span => span.quote_start <= emoji && span.quote_end >= emoji + 2));
  assert.ok(built.spans.every(span => !(/^[\uDC00-\uDFFF]/u.test(span.quote))
    && !(/[\uD800-\uDBFF]$/u.test(span.quote))));
  const parsed = parseSignalWorkspaceInterestDecisionProviderOutputV2({ request, output: output() });
  assert.equal(parsed.output.contract_version, "signal-workspace-interest-decision-v1");
  assert.equal(parsed.output.request_digest, request.request_digest);
  assert.equal(parsed.output.decisions[0]!.root_id, request.roots[0]!.root_id);
  const citation = parsed.output.decisions[0]!.citations[0]!;
  assert.equal(citation.quote, request.roots[0]!.chunks[0]!.text.slice(citation.quote_start, citation.quote_end));
  const reordered = parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: { ...output(), decisions: [...output().decisions].reverse() } });
  assert.deepEqual(reordered.output, parsed.output);
  assert.equal(reordered.output_digest, parsed.output_digest);
  assert.notEqual(reordered.provider_output_digest, parsed.provider_output_digest);
});

test("untrusted output cannot supply identities or cite unknown, duplicate or cross-root spans", () => {
  const base = output();
  const first = base.decisions[0]!;
  const changed = (decision: object) => ({ ...base, decisions: [decision, base.decisions[1]] });
  assert.throws(() => parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: { ...base, request_digest: request.request_digest } }));
  assert.throws(() => parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: changed({ ...first, citations: [{ span_id: "r0c0s999", role: "supports" }] }) }), /span_id_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: changed({ ...first, citations: base.decisions[1]!.citations }) }), /span_id_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: changed({ ...first, citations: [first.citations[0], first.citations[0]] }) }), /span_id_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: changed({ ...first, root_ordinal: 1 }) }), /span_id_invalid|root_ordinal_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: { ...base, decisions: [first, first] } }), /root_ordinal_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: { ...base, decisions: [first] } }), /root_coverage_invalid/u);
  assert.throws(() => parseSignalWorkspaceInterestDecisionProviderOutputV2({ request,
    output: changed({ ...first, citations: [] }) }), /support_required/u);
});

test("a mutated sealed source is rejected before generating spans", () => {
  assert.throws(() => buildSignalWorkspaceInterestDecisionProviderInputV2({ ...request,
    roots: [{ ...request.roots[0]!, asset_sha256: sha("other") }, request.roots[1]!] }), /request_digest_invalid/u);
  const { request_digest: _digest, ...body } = request;
  const noncontiguous = buildSignalWorkspaceInterestDecisionRequestV1({ ...body,
    roots: [{ ...body.roots[0]!, chunks: [{ ...body.roots[0]!.chunks[0]!, start: 1, end: texts[0]!.length + 1 }] }, body.roots[1]!] });
  assert.throws(() => buildSignalWorkspaceInterestDecisionProviderInputV2(noncontiguous), /source_chunk_coverage_invalid/u);
});
