import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { signalWorkspaceEmbeddingDigestV1 } from "@noisia/query-engine";
import {
  buildSignalWorkspaceInterestDecisionRequestFromSourcePageV1,
  readSignalWorkspaceInterestDecisionSourcePageV1,
  verifySignalWorkspaceInterestDecisionRootV1
} from "./signal-workspace-interest-decision-source";

const id = (digit: string) => `00000000-0000-4000-8000-00000000000${digit}`;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const text = "Alexa se activó sin mi consentimiento 😊";
const asset = sha(text);
const root = id("3");
const fingerprint = sha("root");
const compiler = sha("compiler");
const embedding = sha("embedding");
const definitionDigest = sha("definition");
const chunk = { start: 0, end: text.length, sha256: asset };
const coverage = sha(JSON.stringify([0, chunk.start, chunk.end, chunk.sha256]) + "\n");
const definition = {
  term_key: "alexa_consent", label: "Activación no solicitada de Alexa+",
  definition: "Activación de Alexa+ sin consentimiento", scope: "primary_brand" as const,
  inclusion: [], exclusion: [], positive_examples: [], negative_examples: [], lifecycle: "draft" as const,
  origin: "manual" as const, source: null, definition_revision: 1, definition_digest: definitionDigest,
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z"
};
const interest = { taxonomy_term_id: id("4"), definition, compiler_digest: compiler };
const source = { embedding_config_digest: embedding } as Parameters<typeof verifySignalWorkspaceInterestDecisionRootV1>[1];
const base = {
  root_id: root, fingerprint, root_correction_digest: sha(""), asset_sha256: asset, full_text: text,
  chunks: { contract_version: "corpus-text-chunks-v1", text_sha256: asset, offset_unit: "utf16",
    chunks: [chunk] },
  item_evidence: { root_fingerprint: fingerprint, asset_sha256: asset, processed_chunks: 1,
    chunk_coverage_digest: coverage },
  item_state: "doubt", rights_ok: true, text_current: true,
  suggestion_term_key: null, suggestion_taxonomy_term_id: null,
  semantic_score: null, negative_semantic_score: null, evidence_digest: null,
  suggestion_evidence: null
} satisfies Parameters<typeof verifySignalWorkspaceInterestDecisionRootV1>[0];

test("a complete root without a retained suggestion remains undecided", () => {
  const result = verifySignalWorkspaceInterestDecisionRootV1(base, source, interest);
  assert.equal(result.suggestion_state, "not_retained");
  assert.equal(result.root_correction_digest, sha(""));
  assert.equal(result.suggestion, null);
  assert.equal(result.full_text, text);
  assert.deepEqual(result.chunks, [{ chunk_index: 0, start: 0, end: text.length,
    chunk_sha256: asset, text }]);
});

test("the decision request includes roots without search suggestions and their correction identity", () => {
  const sourceRoot = verifySignalWorkspaceInterestDecisionRootV1(base, source, interest);
  const request = buildSignalWorkspaceInterestDecisionRequestFromSourcePageV1({
    contract_version: "workspace-interest-decision-source-v1",
    source: {workspace_id:id("1"),execution_id:id("5"),input_digest:sha("input"),
      input_revision:"1",taxonomy_profile_id:id("6"),preparation_run_id:id("7"),embedding_run_id:id("8"),
      embedding_config_digest:embedding,context_digest:sha("context"),definition_digest:sha("defs"),
      correction_digest:sha("corrections"),current:true},
    interest,roots:[sourceRoot],next_root_id:null,done:true
  },sha("decision-policy"));
  assert.equal(request.roots.length,1);
  assert.equal(request.roots[0]?.correction_digest,sha(""));
  assert.equal(request.roots[0]?.chunks[0]?.text,text);
  assert.match(request.request_digest,/^sha256:[0-9a-f]{64}$/u);
});

test("verified suggestion is evidence, never approval", () => {
  const evidence = {
    contract_version: "signal-workspace-topic-search-v1" as const,
    scoring_policy: "chunk-local-contrast-ranking-v1" as const,
    quality: "uncalibrated" as const, approval_policy: "none" as const,
    embedding_config_digest: embedding, definition_digest: definitionDigest,
    compiler_digest: compiler, asset_sha256: asset, evaluated_chunk_count: 1,
    evaluated_chunks_digest: coverage, ranking_score: 0.4, positive_score: 0.4,
    negative_score: null, scope_positive_score: null, scope_negative_score: null,
    best_chunk: { chunk_index: 0, start: 0, end: text.length, chunk_sha256: asset,
      positive_input_digest: sha("positive"), negative_input_digest: null }
  };
  const row = { ...base, suggestion_term_key: definition.term_key,
    suggestion_taxonomy_term_id: interest.taxonomy_term_id, semantic_score: "0.4",
    negative_semantic_score: null, evidence_digest: signalWorkspaceEmbeddingDigestV1(evidence),
    suggestion_evidence: evidence };
  const result = verifySignalWorkspaceInterestDecisionRootV1(row, source, interest);
  assert.equal(result.suggestion_state, "retained");
  assert.equal(result.suggestion?.evidence.quality, "uncalibrated");
  assert.throws(() => verifySignalWorkspaceInterestDecisionRootV1({ ...row,
    suggestion_evidence: { ...evidence, asset_sha256: sha("other") } }, source, interest), /suggestion_invalid/);
});

test("text, coverage and current rights fail closed", () => {
  assert.throws(() => verifySignalWorkspaceInterestDecisionRootV1({ ...base, rights_ok: false }, source, interest), /integrity_invalid/);
  assert.throws(() => verifySignalWorkspaceInterestDecisionRootV1({ ...base, full_text: `${text}!` }, source, interest), /integrity_invalid/);
  assert.throws(() => verifySignalWorkspaceInterestDecisionRootV1({ ...base,
    chunks: { ...base.chunks, chunks: [{ ...chunk, end: chunk.end - 1 }] } }, source, interest), /chunks_invalid/);
});

test("malformed source request never touches the database", async () => {
  const database = { connect: async () => { throw new Error("unexpected connection"); } };
  await assert.rejects(readSignalWorkspaceInterestDecisionSourcePageV1({ database: database as never,
    workspace_id: id("1"), actor_user_id: id("2"), execution_id: id("5"), term_key: "alexa_consent",
    limit: 65 }), /request_invalid/);
});
