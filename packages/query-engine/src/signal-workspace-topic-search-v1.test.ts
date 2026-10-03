import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertSignalWorkspaceTopicSearchProfileV1,
  createSignalWorkspaceTopicSearchAccumulatorV1,
  createSignalWorkspaceTopicSearchShortlistV1,
  signalWorkspaceTopicPrototypeDigestV1,
  SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1,
  type SignalWorkspaceSearchChunkV1,
  type SignalWorkspaceSearchTopicV1,
  type SignalWorkspaceTopicPrototypeV1
} from "./signal-workspace-topic-search-v1";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1 } from "./signal-workspace-embeddings-v1";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const vector = (x = 1, y = 0) => [x, y, ...Array<number>(1022).fill(0)];
function prototype(term: string, role: SignalWorkspaceTopicPrototypeV1["role"], embedding = vector(), suffix = "") {
  return { term_key: term, role, input_digest: hash(`${term}:${role}:${suffix}`),
    embedding_config_digest: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1, vector: embedding };
}
function topic(term: string, inputs: SignalWorkspaceTopicPrototypeV1[]): SignalWorkspaceSearchTopicV1 {
  return { taxonomy_term_id: term, term_key: term, scope: "primary_brand", definition_digest: hash(term),
    compiler_digest: hash(`compiler:${term}`), prototype_count: inputs.length,
    prototype_digest: signalWorkspaceTopicPrototypeDigestV1(inputs) };
}
function chunk(index: number, embedding = vector()): SignalWorkspaceSearchChunkV1 {
  return { chunk_index: index, start: index * 1400, end: (index + 1) * 1400,
    chunk_sha256: hash(`chunk:${index}`), vector: embedding };
}
function order(inputs: SignalWorkspaceTopicPrototypeV1[]) {
  return [...inputs].sort((a, b) => `${a.term_key}:${a.input_digest}` < `${b.term_key}:${b.input_digest}` ? -1 : 1);
}
function run(inputs: SignalWorkspaceTopicPrototypeV1[], chunks: SignalWorkspaceSearchChunkV1[], term = "topic_a") {
  const acc = createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: hash("asset"),
    expected_chunks: chunks.length, topics: [topic(term, inputs)] });
  for (let offset = 0; offset < chunks.length; offset += 128) {
    acc.beginChunkPage(chunks.slice(offset, offset + 128));
    const sorted = order(inputs);
    for (let position = 0; position < sorted.length; position += 128) acc.addPrototypePage(sorted.slice(position, position + 128));
    acc.finishChunkPage();
  }
  return acc.finish()[0]!;
}

test("semantic evidence after fragment 128 is retained with complete coverage", () => {
  const chunks = Array.from({ length: 130 }, (_, index) => chunk(index, index === 129 ? vector() : vector(0, 1)));
  const result = run([prototype("topic_a", "topic_positive")], chunks);
  assert.equal(result.evidence.best_chunk.chunk_index, 129);
  assert.equal(result.evidence.evaluated_chunk_count, 130);
  assert.equal(result.semantic_score, 1);
  assert.equal(result.disposition, "doubt");
  assert.equal(result.evidence.quality, "uncalibrated");
  assert.equal(result.evidence.approval_policy, "none");
});

test("a negative passage does not erase a different positive passage", () => {
  const result = run([prototype("topic_a", "topic_positive"), prototype("topic_a", "topic_negative", vector(0, 1))],
    [chunk(0, vector(0, 1)), chunk(1)]);
  assert.equal(result.evidence.best_chunk.chunk_index, 1);
  assert.equal(result.negative_semantic_score, 0);
  assert.equal(result.evidence.ranking_score, 1);
  assert.equal(result.excluded_by_negative, false);
});

test("full scope context is separate and cannot inflate a generic topic score", () => {
  const result = run([prototype("topic_a", "topic_positive", vector(0, 1)),
    prototype("topic_a", "scope_positive"), prototype("topic_a", "scope_negative")], [chunk(0)]);
  assert.equal(result.semantic_score, 0);
  assert.equal(result.evidence.ranking_score, 0);
  assert.equal(result.evidence.scope_positive_score, 1);
  assert.equal(result.evidence.scope_negative_score, 1);
  assert.equal(result.excluded_by_rule, false);
});

test("all prototype pages are consumed and last page can determine the result", () => {
  const inputs = Array.from({ length: 260 }, (_, index) => prototype("topic_a", "topic_positive", vector(0, 1), String(index)));
  const sorted = order(inputs);
  sorted[259]!.vector = vector();
  const result = run(sorted, [chunk(0)]);
  assert.equal(result.evidence.best_chunk.positive_input_digest, sorted[259]!.input_digest);
  assert.equal(result.semantic_score, 1);
});

test("ranking keeps negative cosine and never interprets it as a calibrated decision", () => {
  const result = run([prototype("topic_a", "topic_positive", vector(-1))], [chunk(0)]);
  assert.equal(result.semantic_score, -1);
  assert.equal(result.evidence.ranking_score, -1);
  assert.equal(result.disposition, "doubt");
});

test("missing or substituted prototype references cannot complete a chunk page", () => {
  const a = prototype("topic_a", "topic_positive");
  const b = prototype("topic_a", "topic_negative");
  const acc = createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: hash("asset"), expected_chunks: 1, topics: [topic("topic_a", [a, b])] });
  acc.beginChunkPage([chunk(0)]);
  acc.addPrototypePage([a]);
  assert.throws(() => acc.finishChunkPage(), /prototype_coverage_incomplete/);
  const substituted = createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: hash("asset"), expected_chunks: 1, topics: [topic("topic_a", [a])] });
  substituted.beginChunkPage([chunk(0)]);
  substituted.addPrototypePage([{ ...a, input_digest: hash("substitute") }]);
  assert.throws(() => substituted.finishChunkPage(), /prototype_coverage_incomplete/);
});

test("missing, overlapping or reordered fragments cannot be presented as complete", () => {
  const a = prototype("topic_a", "topic_positive");
  const acc = createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: hash("asset"), expected_chunks: 2, topics: [topic("topic_a", [a])] });
  acc.beginChunkPage([chunk(0)]); acc.addPrototypePage([a]); acc.finishChunkPage();
  assert.throws(() => acc.finish(), /chunk_coverage_incomplete/);
  assert.throws(() => acc.beginChunkPage([{ ...chunk(1), start: 1399 }]), /chunk_sequence_invalid/);
  assert.throws(() => acc.beginChunkPage([chunk(0)]), /chunk_sequence_invalid/);
});

test("missing prototype role, duplicate input and incompatible embedding spaces reject", () => {
  const a = prototype("topic_a", "topic_positive");
  const create = () => createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: hash("asset"), expected_chunks: 1, topics: [topic("topic_a", [a])] });
  const acc = create(); acc.beginChunkPage([chunk(0)]);
  assert.throws(() => acc.addPrototypePage([{ ...a, embedding_config_digest: hash("query") }]), /profile_mismatch/);
  assert.throws(() => run([prototype("topic_a", "scope_positive")], [chunk(0)]), /prototype_coverage_incomplete/);
  assert.throws(() => signalWorkspaceTopicPrototypeDigestV1([a, a]), /prototype_invalid/);
  assert.throws(() => run([{ ...a, vector: [1, 0] }], [chunk(0)]), /vector_dimensions_invalid/);
  assert.throws(() => run([{ ...a, vector: vector(Number.NaN) }], [chunk(0)]), /vector_invalid/);
  assert.throws(() => run([{ ...a, vector: vector(0, 0) }], [chunk(0)]), /vector_invalid/);
});

test("shortlist processes more than 64 topics and declares omitted retrieval evidence", () => {
  const shortlist = createSignalWorkspaceTopicSearchShortlistV1();
  for (let start = 0; start < 1000; start += 32) {
    const inputs = Array.from({ length: Math.min(32, 1000 - start) }, (_, offset) => {
      const term = `topic_${String(start + offset).padStart(4, "0")}`;
      return prototype(term, "topic_positive", start + offset === 999 ? vector() : vector(0, 1));
    });
    const acc = createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: hash("asset"), expected_chunks: 1,
      topics: inputs.map(input => topic(input.term_key, [input])) });
    acc.beginChunkPage([chunk(0)]); acc.addPrototypePage(order(inputs)); acc.finishChunkPage();
    shortlist.addBlock(acc.finish());
  }
  const result = shortlist.finish();
  assert.equal(result.evaluated_topic_count, 1000);
  assert.equal(result.retained_candidate_count, 32);
  assert.equal(result.omitted_candidate_count, 968);
  assert.equal(result.candidates[0]!.term_key, "topic_0999");
  assert.equal(result.result_kind, "retrieval_shortlist");
});

test("chunk and prototype page sizes do not change ranking or evidence", () => {
  const a = prototype("topic_a", "topic_positive");
  const b = prototype("topic_a", "topic_negative", vector(0, 1));
  const chunks = [chunk(0, vector(0, 1)), chunk(1)];
  const combined = run([a, b], chunks);
  const split = createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: hash("asset"), expected_chunks: 2, topics: [topic("topic_a", [a, b])] });
  for (const value of chunks) {
    split.beginChunkPage([value]);
    for (const input of order([a, b])) split.addPrototypePage([input]);
    split.finishChunkPage();
  }
  assert.deepEqual(split.finish()[0], combined);
});

test("an empty catalog still validates every chunk and yields no membership assertion", () => {
  const acc = createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: hash("asset"), expected_chunks: 1, topics: [] });
  acc.beginChunkPage([chunk(0)]); acc.finishChunkPage();
  assert.deepEqual(acc.finish(), []);
  assert.equal(createSignalWorkspaceTopicSearchShortlistV1().finish().approval_policy, "none");
});

test("profile cannot silently enable automatic approval or change representation", () => {
  assertSignalWorkspaceTopicSearchProfileV1(SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1);
  assert.throws(() => assertSignalWorkspaceTopicSearchProfileV1({ ...SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1, approval_policy: "automatic" }), /profile_unsupported/);
});

test("unexpected runtime fields cannot enter durable evidence or alter its digest", () => {
  const inputs = [prototype("topic_a", "topic_positive")];
  const clean = run(inputs, [chunk(0)]);
  const withExtra = { ...chunk(0), text: "private source text", provider_key: "not an evidence field" };
  const result = run(inputs, [withExtra]);
  assert.deepEqual(result, clean);
  assert.equal("text" in result.evidence.best_chunk, false);
  assert.equal("provider_key" in result.evidence.best_chunk, false);
});
