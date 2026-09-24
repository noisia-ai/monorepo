import type { Job } from "bullmq";
import {
  signalTopicDefinitionDigestV1, signalTopicDefinitionSchemaV1, signalTopicEditorialDigestV1,
  signalWorkspaceClassificationDecisionSchemaV1,
  signalWorkspaceClassificationIdentitySchemaV1, signalWorkspaceClassificationResolutionV1,
  signalWorkspaceClassificationReuseKeyV1, signalWorkspaceEmbeddingDigestV1,
  type SignalTopicDefinitionV1, type SignalTopicInterestEvidenceCandidatesV1,
  type SignalWorkspaceClassificationDecisionV1, type SignalWorkspaceClassificationIdentityV1
} from "@noisia/query-engine";
import type { SignalWorkspaceClassificationRootV1 } from "@noisia/db";
import { projectWorkspaceClassificationPagesV1, type WorkspaceProjectionPageStoresV1 } from "./signal-workspace-projection-pages";
import type { SignalWorkspaceClassificationChunkV1, SignalWorkspaceClassificationEngineV1,
  SignalWorkspaceClassificationLeaseV1 } from "./signal-workspace-classification";

type Fragment = Pick<SignalWorkspaceClassificationChunkV1, "chunk_index" | "start" | "end" | "chunk_sha256">;
export type SignalTopicInterestRootRelationV1 = {
  term_key: string; relation: "supports" | "mixed" | "unrelated" | "insufficient";
  cited_chunks: Fragment[];
};
export type SignalTopicInterestRootInferenceTopicV1 = { taxonomy_term_id: string; definition: SignalTopicDefinitionV1 };
export type SignalTopicInterestLocalInferenceV1 = (input: {
  root: SignalWorkspaceClassificationRootV1;
  chunks: AsyncIterable<ReadonlyArray<SignalWorkspaceClassificationChunkV1>>;
  topics: ReadonlyArray<SignalTopicInterestRootInferenceTopicV1>;
  /** Representative citations are hints, never membership or rejection authority. */
  candidate: SignalTopicInterestEvidenceCandidatesV1["candidates"][number][];
}) => Promise<SignalTopicInterestRootRelationV1[]>;

const digest = signalWorkspaceEmbeddingDigestV1;
const fail = (suffix: string): never => { throw new Error(`workspace_classification_interest_${suffix}`); };
const ascii = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const fragmentKey = (value: Fragment) => JSON.stringify([value.chunk_index, value.start, value.end, value.chunk_sha256]);
const rootIdentity = (root: SignalWorkspaceClassificationRootV1) => ({ root_id: root.root_id,
  fingerprint: root.fingerprint, correction_digest: root.correction_digest });

/** Versioned policy identity. Changes to the review or local scorer invalidate
 * reuse even when the root text itself is unchanged. */
export function signalTopicInterestRootPolicyDigestV1(args: {
  review_digest: string; evidence_binding_digest: string; scorer_artifact_digest: string;
}) {
  return digest({ contract_version: "signal-topic-interest-root-inference-policy-v1", ...args });
}

/** Local composition only. The injected inference must inspect the complete
 * root; no provider transport, product dispatcher or publication is installed. */
export async function projectSignalTopicInterestRootInferenceV1<Database>(args: {
  job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">;
  database: Database; lease: SignalWorkspaceClassificationLeaseV1;
  stores: WorkspaceProjectionPageStoresV1<Database>;
  taxonomy_profile_id: string; topics: SignalTopicInterestRootInferenceTopicV1[];
  evidence_candidates: SignalTopicInterestEvidenceCandidatesV1;
  model_version_id: string; inferRoot: SignalTopicInterestLocalInferenceV1;
  root_page_size?: number; chunk_page_size?: number;
}) {
  const identity = signalWorkspaceClassificationIdentitySchemaV1.parse(args.lease.identity);
  const source = args.evidence_candidates;
  const { binding_digest, ...sourceBody } = source;
  if (source.contract_version !== "signal-topic-interest-evidence-candidates-v1"
    || source.membership_effect !== "none" || source.approval_policy !== "none"
    || source.workspace_id !== identity.workspace_id || source.taxonomy_profile_id !== args.taxonomy_profile_id
    || signalTopicEditorialDigestV1(sourceBody) !== binding_digest
    || identity.decision_policy_digest !== signalTopicInterestRootPolicyDigestV1({
      review_digest: source.review_digest, evidence_binding_digest: binding_digest,
      scorer_artifact_digest: identity.engine_artifact_digest
    })) return fail("source_invalid");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(args.model_version_id))
    return fail("model_invalid");
  const topics = [...args.topics].sort((a, b) => ascii(a.definition.term_key, b.definition.term_key));
  const topicByKey = new Map(topics.map(topic => [topic.definition.term_key, topic]));
  if (!topics.length || topicByKey.size !== topics.length
    || new Set(topics.map(topic => topic.taxonomy_term_id)).size !== topics.length) return fail("topics_invalid");
  for (const topic of topics) {
    const parsed = signalTopicDefinitionSchemaV1.safeParse(topic.definition);
    if (!parsed.success || signalTopicDefinitionDigestV1(topic.definition) !== topic.definition.definition_digest)
      return fail("topics_invalid");
  }
  if (digest(topics.map(topic => ({ term_key: topic.definition.term_key,
    definition_digest: topic.definition.definition_digest,
    definition_revision: topic.definition.definition_revision }))) !== identity.catalog_digest) return fail("catalog_changed");
  const candidatesByRoot = new Map<string, SignalTopicInterestEvidenceCandidatesV1["candidates"]>();
  for (const candidate of source.candidates) {
    const topic = topicByKey.get(candidate.term_key);
    if (!topic || topic.definition.definition_digest !== candidate.definition_digest
      || topic.definition.definition_revision !== candidate.definition_revision) return fail("definition_changed");
    const list = candidatesByRoot.get(candidate.root_id) ?? [];
    list.push(candidate); candidatesByRoot.set(candidate.root_id, list);
  }
  let corrections = new Map<string, SignalWorkspaceClassificationDecisionV1[]>();
  const stores: WorkspaceProjectionPageStoresV1<Database> = { ...args.stores,
    readPage: async input => {
      const page = await args.stores.readPage(input);
      corrections = new Map(page.items.map(item => [item.root.root_id, item.corrections]));
      return page;
    } };
  const engine: SignalWorkspaceClassificationEngineV1 = { engine_key: identity.engine_key,
    engine_version: identity.engine_version, engine_artifact_digest: identity.engine_artifact_digest,
    classifyRoot: async ({ root, chunks }) => {
      const seen = new Map<number, Fragment>(); let processed = 0;
      const observed: AsyncIterable<ReadonlyArray<SignalWorkspaceClassificationChunkV1>> = {
        [Symbol.asyncIterator]: async function* () {
          for await (const page of chunks) {
            for (const chunk of page) { seen.set(chunk.chunk_index, { chunk_index: chunk.chunk_index,
              start: chunk.start, end: chunk.end, chunk_sha256: chunk.chunk_sha256 }); processed++; }
            yield page;
          }
        }
      };
      // A complete relation is required for every interest, including interests
      // absent from retrieval. Missing is unknown, never an implicit rejection.
      const relations = await args.inferRoot({ root, chunks: observed, topics,
        candidate: candidatesByRoot.get(root.root_id) ?? [] });
      if (!Array.isArray(relations) || processed !== root.expected_chunks || seen.size !== root.expected_chunks
        || relations.length !== topics.length) return fail("coverage_incomplete");
      const byKey = new Map<string, SignalTopicInterestRootRelationV1>();
      const decisions = new Map<string, SignalWorkspaceClassificationDecisionV1>();
      const unresolved = new Set<string>();
      for (const relation of relations) {
        const topic = topicByKey.get(relation.term_key);
        if (!topic || byKey.has(relation.term_key) || !Array.isArray(relation.cited_chunks)
          || !["supports", "mixed", "unrelated", "insufficient"].includes(relation.relation)) return fail("relation_invalid");
        byKey.set(relation.term_key, relation);
        const cited = new Set<string>();
        for (const fragment of relation.cited_chunks) {
          const key = fragmentKey(fragment);
          if (cited.has(key) || fragmentKey(seen.get(fragment.chunk_index) ?? {} as Fragment) !== key)
            return fail("citation_invalid");
          cited.add(key);
        }
        if (relation.relation === "supports") {
          if (!cited.size) return fail("citation_required");
          decisions.set(topic.definition.term_key, { taxonomy_term_id: topic.taxonomy_term_id,
            term_key: topic.definition.term_key, definition_revision: topic.definition.definition_revision,
            definition_digest: topic.definition.definition_digest, disposition: "pending", resolution_method: "model",
            model_version_id: args.model_version_id, labeling_function_version_id: null, approval_policy_id: null,
            decided_by_user_id: null, correction_operation_id: null, score: null,
            evidence_digest: digest(relation.cited_chunks), lineage_digest: digest({
              root: rootIdentity(root), term_key: relation.term_key, review_digest: source.review_digest,
              binding_digest, scorer_artifact_digest: identity.engine_artifact_digest
            }) });
        } else if (relation.relation === "mixed" || relation.relation === "insufficient") unresolved.add(relation.term_key);
      }
      for (const raw of corrections.get(root.root_id) ?? fail("corrections_missing")) {
        const correction = signalWorkspaceClassificationDecisionSchemaV1.parse(raw);
        const topic = topicByKey.get(correction.term_key);
        if (!topic || correction.resolution_method !== "human" || correction.membership_basis
          || correction.taxonomy_term_id !== topic.taxonomy_term_id
          || correction.definition_digest !== topic.definition.definition_digest
          || correction.definition_revision !== topic.definition.definition_revision) return fail("correction_invalid");
        decisions.set(correction.term_key, correction);
        unresolved.delete(correction.term_key);
      }
      const values = [...decisions.values()].sort((a, b) => ascii(a.term_key, b.term_key));
      const has_unresolved_topics = unresolved.size > 0 || values.some(value => value.disposition === "pending");
      const rootId = rootIdentity(root);
      return { contract_version: "signal-workspace-classification-v1", root: rootId,
        reuse_key: signalWorkspaceClassificationReuseKeyV1(identity, rootId),
        resolution_state: signalWorkspaceClassificationResolutionV1(values, has_unresolved_topics), has_unresolved_topics,
        reason_code: has_unresolved_topics ? "interest_root_pending" : values.length ? "interest_root_corrected" : "interest_root_abstained",
        technical_error_code: null, evidence_digest: digest({ root: rootId, relations }),
        coverage: { expected_chunks: root.expected_chunks, processed_chunks: processed,
          chunk_coverage_digest: root.chunk_coverage_digest }, decisions: values };
    }
  };
  return projectWorkspaceClassificationPagesV1({ job: args.job, database: args.database, lease: args.lease, stores, engine,
    root_page_size: args.root_page_size, chunk_page_size: args.chunk_page_size });
}
