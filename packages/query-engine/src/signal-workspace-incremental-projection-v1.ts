import { createHash } from "node:crypto";
import { z } from "zod";
import { signalTopicDefinitionSchemaV1, type SignalTopicDefinitionV1 } from "./signal-topic-catalog-v1";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "./signal-workspace-embeddings-v1";
import { signalWorkspaceIncrementalMembershipDigestV1,
  signalWorkspaceIncrementalMembershipSchemaV1, signalWorkspaceIncrementalOutputSchemaV1,
  signalWorkspaceIncrementalRootSchemaV1 } from "./signal-workspace-engine-incremental-v1";
import { buildSignalWorkspaceInterpretationBatchV1, buildSignalWorkspaceInterpretationRepairBatchV1,
  parseSignalWorkspaceInterpretationConfigurationV1, parseSignalWorkspaceInterpretationEditorialRepairV1,
  signalWorkspaceInterpretationUniverseDigestV1, validateSignalWorkspaceInterpretationResultV1,
  type SignalWorkspaceInterpretationClusterV1, type SignalWorkspaceInterpretationContextV1 } from "./signal-workspace-interpretation-v1";
import { mergeSignalWorkspaceTopicMaterializationV1 } from "./signal-workspace-topic-materialization-v1";
import { parseSignalWorkspaceClassificationOutcomeV1, signalWorkspaceClassificationDecisionSchemaV1,
  signalWorkspaceClassificationIdentitySchemaV1, signalWorkspaceClassificationResolutionV1,
  signalWorkspaceClassificationReuseKeyV1, signalWorkspaceClassificationTopicSemanticsDigestV1,
  type SignalWorkspaceClassificationDecisionV1, type SignalWorkspaceClassificationIdentityV1,
  type SignalWorkspaceClassificationRootIdentityV1 } from "./signal-workspace-classification-v1";

const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u), uuid = z.string().uuid();
const natural = z.number().int().nonnegative().safe();
const unitKey = z.string().regex(/^(open|guided):[0-9a-f-]{36}$/u);
const fail = (reason: string): never => { throw new Error(`workspace_incremental_projection_${reason}`); };
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
const ordered = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const coverageSchema = z.object({ interpreted_unit_count: natural, expected_unit_count: natural,
  unit_digest: hash, expected_unit_digest: hash, complete: z.boolean() }).strict().superRefine((v, ctx) => {
  if (v.interpreted_unit_count > v.expected_unit_count || v.complete !== (v.interpreted_unit_count === v.expected_unit_count)
    || v.complete && v.unit_digest !== v.expected_unit_digest) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "coverage_invalid" });
});
export const signalWorkspaceIncrementalProjectionSourceSchemaV1 = z.object({
  contract_version: z.literal("workspace-topic-incremental-projection-v1"), workspace_id: uuid,
  engine_execution_id: uuid, numeric_checkpoint_digest: hash, population_digest: hash,
  output_artifact_id: uuid, output_manifest_sha256: hash, memberships_artifact_id: uuid, roots_artifact_id: uuid,
  model_bank_artifact_id: uuid.nullable(), model_version_id: uuid.nullable(),
  binding_artifact_id: uuid, binding_digest: hash, editorial_cut_digest: hash, policy_digest: hash,
  interpretation_coverage: coverageSchema,
  discovery_coverage: z.object({ state: z.enum(["complete", "pending_insufficient_population", "pending_cohort_close"]),
    pending_roots: natural }).strict()
}).strict().superRefine((v, ctx) => {
  if ((v.model_bank_artifact_id === null) !== (v.model_version_id === null)
    || (v.discovery_coverage.state === "complete") !== (v.discovery_coverage.pending_roots === 0))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source_invalid" });
});
export type SignalWorkspaceIncrementalProjectionSourceV1 = z.infer<typeof signalWorkspaceIncrementalProjectionSourceSchemaV1>;
export const signalWorkspaceIncrementalProjectionRootSchemaV1 = signalWorkspaceIncrementalRootSchemaV1.extend({
  unit_keys: z.array(unitKey), state: z.enum(["computed", "outlier", "discovery_pending"]), discovery_pending: z.boolean()
}).strict().superRefine((v, ctx) => {
  if (v.unit_keys.some((key, index) => index > 0 && key <= v.unit_keys[index - 1]!)
    || v.state !== (v.unit_keys.length ? "computed" : v.discovery_pending ? "discovery_pending" : "outlier"))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "root_state_invalid" });
});
export type SignalWorkspaceIncrementalProjectionRootV1 = z.infer<typeof signalWorkspaceIncrementalProjectionRootSchemaV1>;
const componentSchema = signalWorkspaceIncrementalOutputSchemaV1.innerType().shape.components.element;
type Component = z.infer<typeof componentSchema>;
type Unit = { unit_key: string; component_key: string; birth_membership_digest: string; model_origin: Component["model_origin"] };
export type SignalWorkspaceIncrementalProjectionTopicV1 = { taxonomy_term_id: string; definition: SignalTopicDefinitionV1 };
/** The caller obtains the receipt in workspace/actor scope and verifies settled
 * state, response hash, original fit/config authority and retention in the DB.
 * These values bind bytes; this pure function cannot grant that authority. */
export type SignalWorkspaceIncrementalProjectionProposalV1 = {
  artifact_id: string; owner_execution_id: string; artifact_sha256: string; body: string;
  call_id: string; request_digest: string; call_configuration: unknown; context_digest: string;
};
export type SignalWorkspaceIncrementalUnitBindingV1 = Unit & {
  term_key: string | null; definition_revision: number | null; definition_digest: string | null;
  proposal: { owner_execution_id: string; artifact_id: string; artifact_sha256: string; call_id: string;
    request_digest: string; configuration_digest: string; cluster_digest: string; proposal_semantics_digest: string;
    status: "coherent" | "mixed" | "insufficient" };
};
export type SignalWorkspaceIncrementalBindingsV1 = {
  workspace_id: string; binding_digest: string; editorial_cut_digest: string;
  interpretation_coverage: SignalWorkspaceIncrementalProjectionSourceV1["interpretation_coverage"];
  bindings: readonly SignalWorkspaceIncrementalUnitBindingV1[];
  units: ReadonlyMap<string, Unit>;
  topics: ReadonlyMap<string, SignalWorkspaceIncrementalProjectionTopicV1>;
  by_unit: ReadonlyMap<string, { binding: SignalWorkspaceIncrementalUnitBindingV1;
    topic: SignalWorkspaceIncrementalProjectionTopicV1 | null; archived: boolean; semantic_current: boolean }>;
};

/** Resolve once per generation. Roots use maps; no root×catalog scan. Existing
 * definitions (including archived ones) are never rewritten or auto-selected. */
export function resolveSignalWorkspaceIncrementalBindingsV1(args: {
  workspace_id: string; components: Iterable<Component>;
  topics: Iterable<SignalWorkspaceIncrementalProjectionTopicV1>;
  proposals: Iterable<SignalWorkspaceIncrementalProjectionProposalV1>;
}): SignalWorkspaceIncrementalBindingsV1 {
  uuid.parse(args.workspace_id);
  const units = new Map<string, Unit>(), componentKeys = new Set<string>();
  for (const raw of args.components) {
    const component = componentSchema.parse(raw);
    if (componentKeys.has(component.component_key)) fail("component_duplicate"); componentKeys.add(component.component_key);
    for (const unit of component.units) {
      if (units.has(unit.unit_key)) fail("unit_duplicate");
      units.set(unit.unit_key, { unit_key: unit.unit_key, component_key: component.component_key,
        birth_membership_digest: unit.birth_membership_digest, model_origin: component.model_origin });
    }
  }
  const topics = new Map<string, SignalWorkspaceIncrementalProjectionTopicV1>(), bySource = new Map<string, SignalWorkspaceIncrementalProjectionTopicV1>();
  const topicIds = new Set<string>();
  for (const raw of args.topics) {
    const topic = { taxonomy_term_id: uuid.parse(raw.taxonomy_term_id), definition: signalTopicDefinitionSchemaV1.parse(raw.definition) };
    if (topics.has(topic.definition.term_key) || topicIds.has(topic.taxonomy_term_id)) fail("topic_duplicate");
    topics.set(topic.definition.term_key, topic); topicIds.add(topic.taxonomy_term_id);
    if (topic.definition.origin === "workspace_discovery" && topic.definition.source) {
      const key = topic.definition.source.candidate_key;
      if (bySource.has(key)) fail("topic_source_ambiguous"); bySource.set(key, topic);
    }
  }
  const byUnit = new Map<string, SignalWorkspaceIncrementalBindingsV1["by_unit"] extends ReadonlyMap<string, infer V> ? V : never>();
  const receipts: Array<Record<string, string>> = [], artifacts = new Set<string>();
  for (const proposal of args.proposals) {
    uuid.parse(proposal.artifact_id); uuid.parse(proposal.owner_execution_id); uuid.parse(proposal.call_id);
    hash.parse(proposal.artifact_sha256); hash.parse(proposal.request_digest); hash.parse(proposal.context_digest);
    if (artifacts.has(proposal.artifact_id) || Buffer.byteLength(proposal.body) > 2 * 1024 * 1024
      || sha(proposal.body) !== proposal.artifact_sha256) fail("proposal_bytes_invalid");
    artifacts.add(proposal.artifact_id);
    const packet = z.object({ contract_version: z.literal("workspace-engine-interpretation-result-v1"), execution_id: uuid,
      context: z.unknown(), clusters: z.array(z.unknown()), interpretations: z.array(z.unknown()), editorial_repair: z.unknown().optional()
    }).strict().parse(JSON.parse(proposal.body));
    let batch = buildSignalWorkspaceInterpretationBatchV1(packet.context as SignalWorkspaceInterpretationContextV1,
      packet.clusters as SignalWorkspaceInterpretationClusterV1[], parseSignalWorkspaceInterpretationConfigurationV1(proposal.call_configuration));
    if (packet.editorial_repair !== undefined) {
      const repair = parseSignalWorkspaceInterpretationEditorialRepairV1(packet.editorial_repair);
      batch = buildSignalWorkspaceInterpretationRepairBatchV1(batch, { source_call_id: repair.source_call_id,
        source_response_sha256: repair.source_response_sha256, diagnostic: repair.diagnostic });
      if (!same(batch.editorial_repair, repair)) fail("proposal_repair_invalid");
    }
    if (packet.execution_id !== proposal.owner_execution_id || batch.context.execution_id !== proposal.owner_execution_id
      || batch.context.workspace_id !== args.workspace_id || batch.context.context_digest !== proposal.context_digest
      || batch.request_digest !== proposal.request_digest) fail("proposal_origin_invalid");
    const results = validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: packet.interpretations });
    receipts.push({ artifact_id: proposal.artifact_id, owner_execution_id: proposal.owner_execution_id,
      artifact_sha256: proposal.artifact_sha256, call_id: proposal.call_id, request_digest: proposal.request_digest });
    for (const result of results) {
      const unit = units.get(result.cluster_id);
      // A verified history packet may also contain units no longer in this bank.
      if (!unit) continue;
      if (byUnit.has(unit.unit_key) || unit.model_origin.execution_id !== proposal.owner_execution_id) fail("proposal_unit_origin_invalid");
      const topic = bySource.get(unit.unit_key) ?? null;
      if (topic && (topic.definition.source!.run_key !== `workspace-engine:${proposal.owner_execution_id}`
        || topic.definition.source!.candidate_digest !== result.cluster_digest)) fail("topic_source_invalid");
      const original = mergeSignalWorkspaceTopicMaterializationV1({ prior: [], interpretations: [{ result, artifact_id: proposal.artifact_id }],
        execution_id: proposal.owner_execution_id, now: "2000-01-01T00:00:00.000Z", locale: "es-MX" }).definitions[0]!;
      const semantics = signalWorkspaceClassificationTopicSemanticsDigestV1(original);
      // birth_membership_digest seals numerical birth tuples; cluster_digest
      // seals the interpretation evidence census. They use different formats
      // and are never equated. The DB binds the paid packet to its original fit.
      const binding: SignalWorkspaceIncrementalUnitBindingV1 = { ...unit,
        term_key: topic?.definition.term_key ?? null, definition_revision: topic?.definition.definition_revision ?? null,
        definition_digest: topic?.definition.definition_digest ?? null,
        proposal: { owner_execution_id: proposal.owner_execution_id, artifact_id: proposal.artifact_id,
          artifact_sha256: proposal.artifact_sha256, call_id: proposal.call_id, request_digest: proposal.request_digest,
          configuration_digest: digest(batch.configuration), cluster_digest: result.cluster_digest,
          proposal_semantics_digest: semantics, status: result.status } };
      byUnit.set(unit.unit_key, { binding, topic, archived: topic?.definition.lifecycle === "archived",
        semantic_current: topic !== null && result.status !== "insufficient"
          && semantics === signalWorkspaceClassificationTopicSemanticsDigestV1(topic.definition) });
    }
  }
  const bindings = [...byUnit.values()].map(row => row.binding).sort((a, b) => ordered(a.unit_key, b.unit_key));
  const expected = [...units.keys()].sort(), interpreted = bindings.map(row => row.unit_key);
  const interpretation_coverage = { interpreted_unit_count: interpreted.length, expected_unit_count: expected.length,
    unit_digest: signalWorkspaceInterpretationUniverseDigestV1(interpreted),
    expected_unit_digest: signalWorkspaceInterpretationUniverseDigestV1(expected), complete: interpreted.length === expected.length };
  const editorial_cut_digest = digest(receipts.sort((a, b) => ordered(a.artifact_id!, b.artifact_id!)));
  return { workspace_id: args.workspace_id, binding_digest: digest({ bindings, editorial_cut_digest, interpretation_coverage }),
    editorial_cut_digest, interpretation_coverage, bindings, units, topics, by_unit: byUnit };
}

const chunkSchema = z.object({ chunk_index: natural, start: natural, end: natural, chunk_sha256: hash }).strict();
export type SignalWorkspaceIncrementalProjectionChunkV1 = z.infer<typeof chunkSchema>;
type Membership = z.infer<typeof signalWorkspaceIncrementalMembershipSchemaV1>;
export type SignalWorkspaceIncrementalProjectionCorrectionV1 = { root: SignalWorkspaceClassificationRootIdentityV1;
  context_digest: string; decision: SignalWorkspaceClassificationDecisionV1 };

/** Caller has verified complete artifact hashes/census/model authority. This
 * additionally reconciles this WHOLE current root and every chunk, including
 * sparse outliers, before returning a ledger-compatible outcome. No truncation. */
export function projectSignalWorkspaceIncrementalRootV1(args: {
  source: SignalWorkspaceIncrementalProjectionSourceV1; identity: SignalWorkspaceClassificationIdentityV1;
  root: SignalWorkspaceIncrementalProjectionRootV1; chunks: Iterable<SignalWorkspaceIncrementalProjectionChunkV1>;
  memberships: Iterable<Membership>; bindings: SignalWorkspaceIncrementalBindingsV1;
  corrections?: Iterable<SignalWorkspaceIncrementalProjectionCorrectionV1>;
}) {
  const source = signalWorkspaceIncrementalProjectionSourceSchemaV1.parse(args.source);
  const identity = signalWorkspaceClassificationIdentitySchemaV1.parse(args.identity);
  const root = signalWorkspaceIncrementalProjectionRootSchemaV1.parse(args.root), resolved = args.bindings;
  if (source.workspace_id !== identity.workspace_id || resolved.workspace_id !== identity.workspace_id
    || source.binding_digest !== resolved.binding_digest || source.editorial_cut_digest !== resolved.editorial_cut_digest
    || source.policy_digest !== identity.decision_policy_digest || !same(source.interpretation_coverage, resolved.interpretation_coverage)
    || root.discovery_pending && source.discovery_coverage.pending_roots === 0) fail("source_binding_invalid");
  const rootIdentity = { root_id: root.root_id, fingerprint: root.root_fingerprint, correction_digest: root.correction_digest };
  const stream = args.memberships[Symbol.iterator](); let next = stream.next(), processed = 0, end = 0;
  const coverageHash = createHash("sha256");
  const groups = new Map<string, { count: number; evidence: ReturnType<typeof createHash>; evaluation: ReturnType<typeof createHash>;
    first: SignalWorkspaceIncrementalProjectionChunkV1 }>();
  for (const raw of args.chunks) {
    const chunk = chunkSchema.parse(raw);
    if (chunk.chunk_index !== processed || chunk.start !== end || chunk.end <= chunk.start || chunk.end - chunk.start > 1400) fail("chunk_coverage_invalid");
    coverageHash.update(JSON.stringify([chunk.chunk_index, chunk.start, chunk.end, chunk.chunk_sha256]) + "\n");
    let previousComponent = "";
    while (!next.done) {
      const member = signalWorkspaceIncrementalMembershipSchemaV1.parse(next.value);
      if (member.root_id !== root.root_id || member.root_fingerprint !== root.root_fingerprint || member.chunk_index < processed) fail("membership_root_invalid");
      if (member.chunk_index > processed) break;
      const unit = resolved.units.get(member.unit_key);
      if (!unit || member.model_component_key <= previousComponent || unit.component_key !== member.model_component_key
        || !same(unit.model_origin, member.model_origin) || member.start !== chunk.start || member.end !== chunk.end
        || member.chunk_sha256 !== chunk.chunk_sha256) fail("membership_identity_invalid");
      // Evaluation population can be the cohort or the remaining historical
      // subset. The file validator checks that scope against actual operations;
      // equating it with the complete output population would reject valid fits.
      previousComponent = member.model_component_key;
      const group = groups.get(member.unit_key) ?? { count: 0, evidence: createHash("sha256"), evaluation: createHash("sha256"), first: chunk };
      group.count++; group.evidence.update(signalWorkspaceIncrementalMembershipDigestV1(member) + "\n");
      group.evaluation.update(JSON.stringify(member.evaluation_origin) + "\n"); groups.set(member.unit_key, group);
      next = stream.next();
    }
    processed++; end = chunk.end;
  }
  if (!next.done || processed !== root.expected_chunks || `sha256:${coverageHash.digest("hex")}` !== root.chunk_coverage_digest
    || !same([...groups.keys()].sort(), root.unit_keys)) fail("root_census_invalid");
  const decisions = new Map<string, SignalWorkspaceClassificationDecisionV1>();
  let unresolved = root.discovery_pending, interpretationPending = false;
  const computedEvidence: Array<Record<string, unknown>> = [];
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => ordered(a, b))) {
    const row = resolved.by_unit.get(key), evidence_digest = `sha256:${group.evidence.digest("hex")}`;
    const evaluation_digest = `sha256:${group.evaluation.digest("hex")}`;
    computedEvidence.push({ unit_key: key, evidence_digest, evaluation_digest, matched_chunks: group.count });
    if (!row || !row.topic) { unresolved = true; interpretationPending = true; continue; }
    if (row.archived) continue;
    if (!row.semantic_current) { unresolved = true; continue; }
    const { binding, topic } = row;
    if (!source.model_version_id || decisions.has(topic.definition.term_key)) fail("mapping_invalid");
    decisions.set(topic.definition.term_key, signalWorkspaceClassificationDecisionSchemaV1.parse({
      taxonomy_term_id: topic.taxonomy_term_id, term_key: topic.definition.term_key,
      definition_revision: topic.definition.definition_revision, definition_digest: topic.definition.definition_digest,
      disposition: "pending", resolution_method: "model", model_version_id: source.model_version_id,
      labeling_function_version_id: null, approval_policy_id: null, decided_by_user_id: null, correction_operation_id: null,
      score: null, evidence_digest, lineage_digest: digest({ binding, evaluation_digest, evidence_digest, source }),
      membership_basis: "computed_cluster", membership_metadata: {
        contract_version: "workspace-computed-incremental-membership-v1", engine_execution_id: source.engine_execution_id,
        output_artifact_id: source.output_artifact_id, memberships_artifact_id: source.memberships_artifact_id,
        binding_artifact_id: source.binding_artifact_id, binding_digest: source.binding_digest, unit_keys: [key],
        model_component_key: binding.component_key, birth_membership_digest: binding.birth_membership_digest,
        model_origin: binding.model_origin, proposal_artifact_id: binding.proposal.artifact_id,
        proposal_owner_execution_id: binding.proposal.owner_execution_id,
        proposal_semantics_digest: binding.proposal.proposal_semantics_digest,
        materialized_definition_digest: topic.definition.definition_digest, evaluation_digest,
        evidence_fragment: group.first, matched_chunks: group.count
      }
    }));
  }
  const corrected = new Set<string>();
  for (const correction of args.corrections ?? []) {
    const decision = signalWorkspaceClassificationDecisionSchemaV1.parse(correction.decision), topic = resolved.topics.get(decision.term_key);
    if (!same(correction.root, rootIdentity) || correction.context_digest !== identity.context_digest || decision.resolution_method !== "human"
      || decision.membership_basis || !topic || corrected.has(decision.term_key) || topic.definition.lifecycle === "archived"
      || decision.taxonomy_term_id !== topic.taxonomy_term_id || decision.definition_digest !== topic.definition.definition_digest
      || decision.definition_revision !== topic.definition.definition_revision) fail("correction_identity_invalid");
    corrected.add(decision.term_key); decisions.set(decision.term_key, decision);
  }
  const values = [...decisions.values()].sort((a, b) => ordered(a.term_key, b.term_key));
  return parseSignalWorkspaceClassificationOutcomeV1({ identity, root: rootIdentity, outcome: {
    contract_version: "signal-workspace-classification-v1", root: rootIdentity,
    reuse_key: signalWorkspaceClassificationReuseKeyV1(identity, rootIdentity),
    resolution_state: signalWorkspaceClassificationResolutionV1(values, unresolved), has_unresolved_topics: unresolved,
    reason_code: root.discovery_pending ? "computed_cluster_discovery_pending" : interpretationPending ? "computed_cluster_interpretation_pending"
      : unresolved ? "computed_cluster_semantics_stale" : groups.size ? "computed_cluster_membership" : "computed_cluster_outlier",
    technical_error_code: null, evidence_digest: digest({ root: rootIdentity, computedEvidence,
      corrections: values.filter(value => value.resolution_method === "human").map(value => value.evidence_digest) }),
    coverage: { expected_chunks: root.expected_chunks, processed_chunks: processed, chunk_coverage_digest: root.chunk_coverage_digest }, decisions: values
  } });
}
