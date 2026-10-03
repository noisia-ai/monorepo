import { createHash } from "node:crypto";
import type { SignalTopicScopeV1 } from "./signal-topic-catalog-v1";
import {
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1,
  signalWorkspaceEmbeddingDigestV1
} from "./signal-workspace-embeddings-v1";

/** Ranking evidence only. Neither cosine nor this shortlist authorizes membership. */
export const SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1 = Object.freeze({
  contract_version: "signal-workspace-topic-search-v1",
  scoring_policy: "chunk-local-contrast-ranking-v1",
  candidate_limit: 32,
  approval_policy: "none",
  embedding_config_digest: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1
} as const);
export const SIGNAL_WORKSPACE_TOPIC_SEARCH_JOB_NAME_V1 = "signal-workspace-topic-search-v1";
export type SignalWorkspaceTopicSearchProfileV1 = typeof SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1;
export type SignalWorkspaceTopicPrototypeRoleV1 =
  | "topic_positive" | "topic_negative" | "scope_positive" | "scope_negative";
export type SignalWorkspaceTopicPrototypeV1 = {
  term_key: string;
  role: SignalWorkspaceTopicPrototypeRoleV1;
  input_digest: string;
  embedding_config_digest: string;
  vector: number[];
};
export type SignalWorkspaceSearchTopicV1 = {
  taxonomy_term_id: string;
  term_key: string;
  scope: SignalTopicScopeV1;
  definition_digest: string;
  compiler_digest: string;
  prototype_count: number;
  prototype_digest: string;
};
export type SignalWorkspaceSearchChunkV1 = {
  chunk_index: number;
  start: number;
  end: number;
  chunk_sha256: string;
  vector: number[];
};
export type SignalWorkspaceTopicSearchEvidenceV1 = {
  contract_version: "signal-workspace-topic-search-v1";
  scoring_policy: "chunk-local-contrast-ranking-v1";
  quality: "uncalibrated";
  approval_policy: "none";
  embedding_config_digest: string;
  definition_digest: string;
  compiler_digest: string;
  asset_sha256: string;
  evaluated_chunk_count: number;
  evaluated_chunks_digest: string;
  ranking_score: number;
  positive_score: number;
  negative_score: number | null;
  scope_positive_score: number | null;
  scope_negative_score: number | null;
  best_chunk: { chunk_index: number; start: number; end: number; chunk_sha256: string;
    positive_input_digest: string; negative_input_digest: string | null };
};
export type SignalWorkspaceTopicSearchCandidateV1 = {
  taxonomy_term_id: string;
  term_key: string;
  scope: SignalTopicScopeV1;
  disposition: "doubt";
  method: "semantic";
  semantic_score: number;
  negative_semantic_score: number | null;
  lexical_match: false;
  excluded_by_rule: false;
  excluded_by_negative: false;
  evidence: SignalWorkspaceTopicSearchEvidenceV1;
  evidence_digest: string;
};

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const roles = new Set<SignalWorkspaceTopicPrototypeRoleV1>([
  "topic_positive", "topic_negative", "scope_positive", "scope_negative"
]);
function fail(code: string): never { throw new Error(`workspace_topic_${code}`); }
function digest(value: string) { if (!digestPattern.test(value)) fail("digest_invalid"); }
function natural(value: number) { if (!Number.isSafeInteger(value) || value < 0) fail("count_invalid"); }

export function assertSignalWorkspaceTopicSearchProfileV1(profile: unknown): asserts profile is SignalWorkspaceTopicSearchProfileV1 {
  if (signalWorkspaceEmbeddingDigestV1(profile) !== signalWorkspaceEmbeddingDigestV1(SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1)) {
    fail("search_profile_unsupported");
  }
}

function unitVector(vector: number[]): Float64Array {
  if (!Array.isArray(vector) || vector.length !== 1024) fail("vector_dimensions_invalid");
  let norm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) fail("vector_invalid");
    norm += value * value;
  }
  if (!Number.isFinite(norm) || norm <= 0) fail("vector_invalid");
  const scale = Math.sqrt(norm);
  return Float64Array.from(vector, value => value / scale);
}
function similarity(left: Float64Array, right: Float64Array) {
  let score = 0;
  for (let index = 0; index < 1024; index++) score += left[index]! * right[index]!;
  // Correct floating point drift only; negative cosine is meaningful evidence.
  return Math.max(-1, Math.min(1, score));
}
type RoleScore = { score: number; input_digest: string } | null;
type ChunkScores = Record<SignalWorkspaceTopicPrototypeRoleV1, RoleScore>;
type LocalBest = Omit<SignalWorkspaceTopicSearchEvidenceV1,
  "contract_version" | "scoring_policy" | "quality" | "approval_policy" | "embedding_config_digest"
  | "definition_digest" | "compiler_digest" | "asset_sha256" | "evaluated_chunk_count" | "evaluated_chunks_digest">;

/** Use the same ordered reference seal when constructing a topic's immutable snapshot. */
export function signalWorkspaceTopicPrototypeDigestV1(inputs: Array<{ input_digest: string; role: SignalWorkspaceTopicPrototypeRoleV1 }>) {
  const hash = createHash("sha256");
  let previous: string | null = null;
  for (const input of [...inputs].sort((a, b) => a.input_digest < b.input_digest ? -1 : a.input_digest > b.input_digest ? 1 : 0)) {
    digest(input.input_digest);
    if (previous === input.input_digest || !roles.has(input.role)) fail("prototype_invalid");
    previous = input.input_digest;
    hash.update(JSON.stringify([input.input_digest, input.role]) + "\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** All chunks and all prototypes, paged on both axes. No context-size assumption. */
export function createSignalWorkspaceTopicSearchAccumulatorV1(args: {
  asset_sha256: string;
  expected_chunks: number;
  topics: SignalWorkspaceSearchTopicV1[];
}) {
  digest(args.asset_sha256); natural(args.expected_chunks);
  if (args.expected_chunks < 1 || args.topics.length > 32) fail("search_block_invalid");
  const seenTerms = new Set<string>();
  const topics = args.topics.map(topic => {
    if (seenTerms.has(topic.term_key)) fail("duplicate_topic");
    seenTerms.add(topic.term_key);
    digest(topic.definition_digest); digest(topic.compiler_digest);
    if (!topic.taxonomy_term_id || !topic.term_key) fail("topic_invalid");
    natural(topic.prototype_count); digest(topic.prototype_digest);
    if (topic.prototype_count < 1) fail("positive_prototype_missing");
    return { topic, best: null as LocalBest | null };
  });
  let processed = 0;
  let nextStart = 0;
  let closed = false;
  const coverage = createHash("sha256");
  let page: {
    chunks: Array<{ ref: Omit<SignalWorkspaceSearchChunkV1, "vector">; vector: Float64Array }>;
    topics: Map<string, { scores: ChunkScores[]; count: number; positive_count: number;
      digest: ReturnType<typeof createHash> }>;
    previous_input: string | null;
  } | null = null;
  return {
    beginChunkPage(chunks: SignalWorkspaceSearchChunkV1[]) {
      if (closed) fail("accumulator_closed");
      if (page !== null || chunks.length < 1 || chunks.length > 128) fail("chunk_page_invalid");
      let offset = nextStart;
      const prepared = chunks.map((chunk, index) => {
        natural(chunk.chunk_index); natural(chunk.start); natural(chunk.end); digest(chunk.chunk_sha256);
        if (chunk.chunk_index !== processed + index || chunk.start !== offset || chunk.end <= chunk.start
          || processed + index >= args.expected_chunks || chunk.end - chunk.start > 1400) fail("chunk_sequence_invalid");
        offset = chunk.end;
        const ref = { chunk_index: chunk.chunk_index, start: chunk.start, end: chunk.end, chunk_sha256: chunk.chunk_sha256 };
        return { ref, vector: unitVector(chunk.vector) };
      });
      page = { chunks: prepared, previous_input: null, topics: new Map(topics.map(({ topic }) => [topic.term_key, {
        scores: chunks.map(() => ({ topic_positive: null, topic_negative: null, scope_positive: null, scope_negative: null })),
        count: 0, positive_count: 0, digest: createHash("sha256")
      }])) };
    },
    addPrototypePage(prototypes: SignalWorkspaceTopicPrototypeV1[]) {
      if (closed) fail("accumulator_closed");
      if (page === null || prototypes.length < 1 || prototypes.length > 128) fail("prototype_page_invalid");
      for (const prototype of prototypes) {
        digest(prototype.input_digest);
        const key = `${prototype.term_key}:${prototype.input_digest}`;
        if (!roles.has(prototype.role) || page.previous_input !== null && key <= page.previous_input) fail("prototype_sequence_invalid");
        const target = page.topics.get(prototype.term_key);
        if (!target) fail("prototype_topic_mismatch");
        if (prototype.embedding_config_digest !== SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1) fail("prototype_profile_mismatch");
        const vector = unitVector(prototype.vector);
        for (let index = 0; index < page.chunks.length; index++) {
          const score = similarity(page.chunks[index]!.vector, vector);
          const scores = target.scores[index]!;
          const prior = scores[prototype.role];
          if (prior === null || score > prior.score || score === prior.score && prototype.input_digest < prior.input_digest) {
            scores[prototype.role] = { score, input_digest: prototype.input_digest };
          }
        }
        target.count++;
        if (prototype.role === "topic_positive") target.positive_count++;
        target.digest.update(JSON.stringify([prototype.input_digest, prototype.role]) + "\n");
        page.previous_input = key;
      }
    },
    finishChunkPage() {
      if (closed) fail("accumulator_closed");
      if (page === null) fail("chunk_page_invalid");
      for (const entry of topics) {
        const target = page.topics.get(entry.topic.term_key)!;
        if (target.count !== entry.topic.prototype_count || target.positive_count < 1
          || `sha256:${target.digest.digest("hex")}` !== entry.topic.prototype_digest) fail("prototype_coverage_incomplete");
      }
      for (let index = 0; index < page.chunks.length; index++) {
        const chunk = page.chunks[index]!.ref;
        for (const entry of topics) {
          const scores = page.topics.get(entry.topic.term_key)!.scores[index]!;
          const positive = scores.topic_positive!;
          const negative = scores.topic_negative;
          // Contrast is local: a negative passage elsewhere cannot veto this passage.
          const ranking = positive.score - Math.max(negative?.score ?? 0, 0);
          if (entry.best !== null && ranking <= entry.best.ranking_score) continue;
          entry.best = {
            ranking_score: ranking, positive_score: positive.score, negative_score: negative?.score ?? null,
            scope_positive_score: scores.scope_positive?.score ?? null,
            scope_negative_score: scores.scope_negative?.score ?? null,
            best_chunk: { ...chunk, positive_input_digest: positive.input_digest,
              negative_input_digest: negative?.input_digest ?? null }
          };
        }
        coverage.update(JSON.stringify([chunk.chunk_index, chunk.start, chunk.end, chunk.chunk_sha256]) + "\n");
        nextStart = chunk.end;
        processed++;
      }
      page = null;
    },
    finish(): SignalWorkspaceTopicSearchCandidateV1[] {
      if (closed) fail("accumulator_closed");
      if (page !== null || processed !== args.expected_chunks) fail("chunk_coverage_incomplete");
      closed = true;
      const coverageDigest = `sha256:${coverage.digest("hex")}`;
      return topics.map(({ topic, best }) => {
        if (best === null) return fail("chunk_coverage_incomplete");
        const evidence: SignalWorkspaceTopicSearchEvidenceV1 = {
          contract_version: "signal-workspace-topic-search-v1", scoring_policy: "chunk-local-contrast-ranking-v1",
          quality: "uncalibrated", approval_policy: "none",
          embedding_config_digest: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_DIGEST_V1,
          definition_digest: topic.definition_digest, compiler_digest: topic.compiler_digest,
          asset_sha256: args.asset_sha256, evaluated_chunk_count: processed, evaluated_chunks_digest: coverageDigest,
          ...best
        };
        return { taxonomy_term_id: topic.taxonomy_term_id, term_key: topic.term_key, scope: topic.scope,
          disposition: "doubt", method: "semantic", semantic_score: best.positive_score,
          negative_semantic_score: best.negative_score, lexical_match: false, excluded_by_rule: false,
          excluded_by_negative: false, evidence, evidence_digest: signalWorkspaceEmbeddingDigestV1(evidence) };
      });
    }
  };
}

function compareCandidates(left: SignalWorkspaceTopicSearchCandidateV1, right: SignalWorkspaceTopicSearchCandidateV1) {
  const score = right.evidence.ranking_score - left.evidence.ranking_score;
  if (score !== 0) return score;
  return left.term_key < right.term_key ? -1 : left.term_key > right.term_key ? 1 : 0;
}

/** Bounded retrieval output, not a cap on evaluated topics or a complete set of memberships. */
export function createSignalWorkspaceTopicSearchShortlistV1() {
  const retained: SignalWorkspaceTopicSearchCandidateV1[] = [];
  let evaluated = 0;
  let previousTerm: string | null = null;
  return {
    addBlock(candidates: SignalWorkspaceTopicSearchCandidateV1[]) {
      if (candidates.length > 32) fail("search_block_invalid");
      for (const candidate of candidates) {
        // Stable keyset ordering also prevents duplicate topic evaluations across pages.
        if (previousTerm !== null && candidate.term_key <= previousTerm) fail("topic_sequence_invalid");
        previousTerm = candidate.term_key;
        evaluated++;
        retained.push(candidate);
        retained.sort(compareCandidates);
        if (retained.length > SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1.candidate_limit) retained.pop();
      }
    },
    finish() {
      return {
        candidates: [...retained], evaluated_topic_count: evaluated,
        retained_candidate_count: retained.length, omitted_candidate_count: evaluated - retained.length,
        candidate_limit: SIGNAL_WORKSPACE_TOPIC_SEARCH_PROFILE_V1.candidate_limit,
        quality: "uncalibrated" as const, approval_policy: "none" as const,
        result_kind: "retrieval_shortlist" as const
      };
    }
  };
}
