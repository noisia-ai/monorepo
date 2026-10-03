import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { signalWorkspaceIncrementalDigestV1 as numericalDigest } from "./signal-workspace-engine-incremental-v1";
import { SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as sonnet,
  SIGNAL_WORKSPACE_INTERPRETATION_LEGACY_OPUS_CONFIGURATION_V1 as opus,
  buildSignalWorkspaceInterpretationBatchV1, buildSignalWorkspaceInterpretationRepairBatchV1,
  signalWorkspaceInterpretationReferenceIdV1, type SignalWorkspaceInterpretationClusterV1,
  type SignalWorkspaceInterpretationConfigurationV1 } from "./signal-workspace-interpretation-v1";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "./signal-workspace-embeddings-v1";
import { mergeSignalWorkspaceTopicMaterializationV1 } from "./signal-workspace-topic-materialization-v1";
import { signalWorkspaceClassificationDecisionSchemaV1, type SignalWorkspaceClassificationIdentityV1 } from "./signal-workspace-classification-v1";
import { projectSignalWorkspaceIncrementalRootV1, resolveSignalWorkspaceIncrementalBindingsV1,
  signalWorkspaceIncrementalProjectionSourceSchemaV1, type SignalWorkspaceIncrementalProjectionCorrectionV1,
  type SignalWorkspaceIncrementalProposalSourceV1, type SignalWorkspaceIncrementalProjectionProposalV1,
  type SignalWorkspaceIncrementalProjectionSourceV1 } from "./signal-workspace-incremental-projection-v1";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const context = { workspace_id: id(1), execution_id: id(2), context_digest: sha("context"), data: { brand: "Fixture" } };
function fixture(count = 1, configuration: SignalWorkspaceInterpretationConfigurationV1 = sonnet, repair = false) {
  const components = [], topics = [], proposals = [];
  for (let index = 0; index < count; index++) {
    const lane = index % 2 ? "guided" as const : "open" as const, unit = `${lane}:${id(100 + index)}`;
    const model_origin = { execution_id: id(2), model_artifact_sha256: sha(`model${index}`) };
    const component_key = numericalDigest([model_origin.execution_id, model_origin.model_artifact_sha256, lane]);
    components.push({ component_key, lane, model_origin,
      model: { file: `model${index}.pkl`, sha256: model_origin.model_artifact_sha256, bytes: 12 },
      center: lane === "guided" ? { file: `center${index}.npy`, sha256: sha(`center${index}`), bytes: 12 } : null,
      units: [{ local_label: 0, unit_key: unit, birth_membership_digest: sha(`birth${index}`) }] });
    const text = `Análisis 🌞 ${index}`;
    const fragment = { root_id: id(500 + index), chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text) };
    const ref = signalWorkspaceInterpretationReferenceIdV1(fragment);
    const cluster: SignalWorkspaceInterpretationClusterV1 = { cluster_id: unit, lane, cluster_digest: sha(`cluster${index}`), root_count: 1,
      chunk_count: 1, terms: ["experiencia"], representatives: [{ ...fragment, ref_id: ref, text, strength: 0.9, selection_reason: "high_affiliation" }] };
    const result = { cluster_id: unit, cluster_digest: cluster.cluster_digest, status: "coherent" as const,
      name: `Conversación ${index}`, definition: `Opiniones sobre experiencia ${index}.`, inclusion: [{ text: "Experiencias", citations: [ref] }],
      exclusion: [], citations: [ref] };
    let batch = buildSignalWorkspaceInterpretationBatchV1(context, [cluster], configuration);
    if (repair) batch = buildSignalWorkspaceInterpretationRepairBatchV1(batch, { source_call_id: id(800 + index),
      source_response_sha256: sha("raw invalid response"), diagnostic: "output_invalid" });
    const body = JSON.stringify({ contract_version: "workspace-engine-interpretation-result-v1", execution_id: id(2), context,
      clusters: [cluster], interpretations: [result], ...(batch.editorial_repair ? { editorial_repair: batch.editorial_repair } : {}) });
    proposals.push({ artifact_id: id(1000 + index), owner_execution_id: id(2), artifact_sha256: sha(body), body,
      call_id: id(2000 + index), request_digest: batch.request_digest, call_configuration: configuration, context_digest: context.context_digest });
    const definition = mergeSignalWorkspaceTopicMaterializationV1({ prior: [], interpretations: [{ result, artifact_id: id(1000 + index) }],
      execution_id: id(2), now: "2026-09-09T00:00:00.000Z", locale: "es-MX" }).definitions[0]!;
    topics.push({ taxonomy_term_id: id(3000 + index), definition });
  }
  return { workspace_id: id(1), components, topics, proposals };
}
function scenario(options: { count?: number; chunks?: number; pending?: boolean; unpaid?: boolean } = {}) {
  const fixtureInput = fixture(options.count ?? 1);
  const resolved = resolveSignalWorkspaceIncrementalBindingsV1({ ...fixtureInput, proposals: options.unpaid ? [] : fixtureInput.proposals });
  const source: SignalWorkspaceIncrementalProjectionSourceV1 = {
    contract_version: "workspace-topic-incremental-projection-v1", workspace_id: id(1), engine_execution_id: id(3),
    numeric_checkpoint_digest: sha("checkpoint"), population_digest: sha("population"), output_artifact_id: id(4),
    output_manifest_sha256: sha("output"), memberships_artifact_id: id(5), roots_artifact_id: id(6), model_bank_artifact_id: id(7),
    model_version_id: id(8), binding_artifact_id: id(9), binding_digest: resolved.binding_digest,
    editorial_cut_digest: resolved.editorial_cut_digest, policy_digest: sha("policy"), interpretation_coverage: resolved.interpretation_coverage,
    discovery_coverage: { state: options.pending ? "pending_insufficient_population" : "complete", pending_roots: options.pending ? 1 : 0 }
  };
  const identity: SignalWorkspaceClassificationIdentityV1 = { contract_version: "signal-workspace-classification-v1", workspace_id: id(1),
    engine_key: "incremental-projection", engine_version: 1, engine_artifact_digest: sha("bank"), embedding_config_digest: sha("embeddings"),
    catalog_digest: sha("catalog"), compiler_digest: sha("compiler"), context_digest: context.context_digest, decision_policy_digest: sha("policy") };
  const chunks = Array.from({ length: options.chunks ?? 1 }, (_, index) => ({ chunk_index: index, start: index * 1400,
    end: (index + 1) * 1400, chunk_sha256: sha(`text${index}`) }));
  const root = { root_id: id(4000), root_fingerprint: sha("root"), asset_sha256: sha("asset"), expected_chunks: chunks.length,
    chunk_coverage_digest: sha(chunks.map(c => JSON.stringify([c.chunk_index, c.start, c.end, c.chunk_sha256]) + "\n").join("")),
    correction_digest: sha("corrections"), unit_keys: fixtureInput.components.flatMap(c => c.units.map(u => u.unit_key)).sort(),
    state: fixtureInput.components.length ? "computed" as const : options.pending ? "discovery_pending" as const : "outlier" as const,
    discovery_pending: options.pending ?? false };
  const memberships = chunks.flatMap(chunk => fixtureInput.components.map(component => {
    const evaluation_origin = { execution_id: id(3), input_population_digest: source.population_digest,
      evaluation_key: numericalDigest([id(3), component.component_key, source.population_digest, "predicted_member"]), basis: "predicted_member" as const };
    return { root_id: root.root_id, root_fingerprint: root.root_fingerprint, ...chunk, lane: component.lane,
      unit_key: component.units[0]!.unit_key, model_component_key: component.component_key, strength: 0.999999999,
      model_origin: component.model_origin, evaluation_origin, carried_from: null };
  }).sort((a, b) => a.model_component_key.localeCompare(b.model_component_key)));
  return { fixtureInput, source, identity, root, chunks, memberships, bindings: resolved };
}
function rebind(value: ReturnType<typeof scenario>, inputs = value.fixtureInput) {
  const bindings = resolveSignalWorkspaceIncrementalBindingsV1(inputs);
  return { ...value, bindings, source: { ...value.source, binding_digest: bindings.binding_digest,
    editorial_cut_digest: bindings.editorial_cut_digest, interpretation_coverage: bindings.interpretation_coverage } };
}

test("exact historical bindings preserve Topic IDs, labels, guidance and selection-owned definitions", () => {
  const input = fixture(2), before = structuredClone(input);
  const baseline = resolveSignalWorkspaceIncrementalBindingsV1(input);
  input.topics[0]!.definition.label = "Nombre editado por la marca";
  input.topics[0]!.definition.discovery_guidance = true;
  const renamed = resolveSignalWorkspaceIncrementalBindingsV1(input);
  assert.equal(renamed.binding_digest, baseline.binding_digest);
  assert.equal(renamed.by_unit.get(input.components[0]!.units[0]!.unit_key)?.semantic_current, true);
  assert.equal(renamed.bindings[0]!.proposal.owner_execution_id, id(2));
  assert.deepEqual(input.proposals, before.proposals);
  assert.equal(input.topics[0]!.definition.label, "Nombre editado por la marca");
  assert.equal(renamed.topics.get(input.topics[0]!.definition.term_key)?.taxonomy_term_id, input.topics[0]!.taxonomy_term_id);
});
test("known membership and discovery_pending coexist without approval or a fake completed cohort", () => {
  const value = scenario({ pending: true });
  const result = projectSignalWorkspaceIncrementalRootV1(value);
  assert.equal(result.has_unresolved_topics, true); assert.equal(result.reason_code, "computed_cluster_discovery_pending");
  assert.equal(result.decisions.length, 1); assert.equal(result.decisions[0]!.disposition, "pending");
  assert.equal(result.decisions[0]!.approval_policy_id, null); assert.equal(result.decisions[0]!.score, null);
  const metadata = result.decisions[0]!.membership_metadata;
  assert.equal(metadata?.contract_version, "workspace-computed-incremental-membership-v1");
  if (metadata?.contract_version !== "workspace-computed-incremental-membership-v1") assert.fail();
  assert.equal(metadata.model_origin.execution_id, id(2)); assert.equal(metadata.engine_execution_id, id(3));
  assert.equal(metadata.proposal_owner_execution_id, id(2)); assert.equal("materialization_artifact_id" in metadata, false);
});
test("global inherited coverage does not become complete when a new wave has no new proposals", () => {
  const input = fixture(3);
  const result = resolveSignalWorkspaceIncrementalBindingsV1({ ...input, proposals: input.proposals.slice(0, 1) });
  assert.equal(result.interpretation_coverage.expected_unit_count, 3);
  assert.equal(result.interpretation_coverage.interpreted_unit_count, 1); assert.equal(result.interpretation_coverage.complete, false);
  assert.equal(result.units.size, 3); assert.equal(result.bindings.length, 1);
});
test("uninterpreted or not-yet-materialized units stay pending without invented Topics", () => {
  const unpaid = scenario({ unpaid: true });
  assert.equal(projectSignalWorkspaceIncrementalRootV1(unpaid).decisions.length, 0);
  assert.equal(projectSignalWorkspaceIncrementalRootV1(unpaid).reason_code, "computed_cluster_interpretation_pending");
  const paid = scenario(), noTopic = rebind(paid, { ...paid.fixtureInput, topics: [] });
  assert.equal(noTopic.bindings.interpretation_coverage.complete, true);
  assert.equal(noTopic.bindings.bindings[0]!.term_key, null);
  assert.equal(projectSignalWorkspaceIncrementalRootV1(noTopic).has_unresolved_topics, true);
});
test("archive suppresses only its Topic; a semantic edit becomes unresolved, never reinterpreted", () => {
  const value = scenario({ count: 2 });
  const edited = structuredClone(value.fixtureInput); edited.topics[0]!.definition.definition = "Different actual meaning";
  edited.topics[0]!.definition.definition_revision++; edited.topics[0]!.definition.definition_digest = sha("changed");
  const changed = projectSignalWorkspaceIncrementalRootV1(rebind(value, edited));
  assert.equal(changed.decisions.length, 1); assert.equal(changed.has_unresolved_topics, true);
  edited.topics[0]!.definition.lifecycle = "archived";
  const archived = projectSignalWorkspaceIncrementalRootV1(rebind(value, edited));
  assert.equal(archived.decisions.length, 1); assert.equal(archived.has_unresolved_topics, false);
});
test("whole roots retain multilabel beyond32 and the final chunk beyond128", () => {
  const value = scenario({ count: 40, chunks: 134 });
  const outcome = projectSignalWorkspaceIncrementalRootV1(value);
  assert.equal(outcome.decisions.length, 40); assert.equal(outcome.coverage.processed_chunks, 134);
  assert.ok(outcome.decisions.every(row => row.membership_metadata?.matched_chunks === 134));
  const lastOnly = { ...value, root: { ...value.root, unit_keys: [value.root.unit_keys[0]!] },
    memberships: value.memberships.filter(row => row.chunk_index === 133 && row.unit_key === value.root.unit_keys[0]) };
  assert.equal(projectSignalWorkspaceIncrementalRootV1(lastOnly).decisions[0]!.membership_metadata?.evidence_fragment.chunk_index, 133);
});
test("empty sparse membership is abstention only without an unresolved cohort", () => {
  const empty = scenario({ count: 0 });
  assert.equal(projectSignalWorkspaceIncrementalRootV1(empty).resolution_state, "abstained");
  assert.equal(projectSignalWorkspaceIncrementalRootV1(scenario({ count: 0, pending: true })).resolution_state, "pending");
});
test("human corrections require exact root, context and current Topic and preserve unrelated uncertainty", () => {
  const value = scenario({ pending: true }), original = projectSignalWorkspaceIncrementalRootV1(value).decisions[0]!;
  const rest = { ...original }; delete rest.membership_basis; delete rest.membership_metadata;
  const correction: SignalWorkspaceIncrementalProjectionCorrectionV1 = {
    root: { root_id: value.root.root_id, fingerprint: value.root.root_fingerprint, correction_digest: value.root.correction_digest },
    context_digest: value.identity.context_digest, decision: { ...rest, disposition: "approved", resolution_method: "human",
      model_version_id: null, decided_by_user_id: id(5000), correction_operation_id: id(5001) }
  };
  const result = projectSignalWorkspaceIncrementalRootV1({ ...value, corrections: [correction] });
  assert.equal(result.decisions[0]!.disposition, "approved"); assert.equal(result.has_unresolved_topics, true);
  for (const invalid of [ { ...correction, root: { ...correction.root, fingerprint: sha("new content") } },
    { ...correction, context_digest: sha("other context") }, { ...correction, decision: { ...correction.decision, definition_revision: 2 } } ])
    assert.throws(() => projectSignalWorkspaceIncrementalRootV1({ ...value, corrections: [invalid] }), /correction_identity_invalid/);
  assert.throws(() => projectSignalWorkspaceIncrementalRootV1({ ...value, corrections: [correction, correction] }), /correction_identity_invalid/);
});
test("missing, duplicate, reordered, foreign and changed chunks or memberships fail before outcome", () => {
  const value = scenario({ count: 2, chunks: 3 });
  for (const changed of [ { chunks: value.chunks.slice(0, 2) }, { chunks: [value.chunks[1]!, value.chunks[0]!, value.chunks[2]!] },
    { memberships: [value.memberships[0]!, ...value.memberships] },
    { memberships: [{ ...value.memberships[0]!, root_fingerprint: sha("other") }, ...value.memberships.slice(1)] },
    { memberships: [{ ...value.memberships[0]!, chunk_sha256: sha("other") }, ...value.memberships.slice(1)] },
    { memberships: [...value.memberships, { ...value.memberships.at(-1)!, chunk_index: 5 }] } ]) {
    assert.throws(() => projectSignalWorkspaceIncrementalRootV1({ ...value, ...changed }));
  }
  // A missing sparse row inside a still-present unit requires the whole file
  // hash/census checked by the caller; no negative decisions are invented here.
  assert.throws(() => projectSignalWorkspaceIncrementalRootV1({ ...value,
    memberships: value.memberships.filter(row => row.unit_key !== value.root.unit_keys[0]) }), /root_census_invalid/);
});
test("wrong source cut, coverage, actor workspace or policy cannot be relabelled as current", () => {
  const value = scenario();
  for (const source of [ { ...value.source, workspace_id: id(999) }, { ...value.source, binding_digest: sha("other") },
    { ...value.source, editorial_cut_digest: sha("other") }, { ...value.source, policy_digest: sha("other") } ])
    assert.throws(() => projectSignalWorkspaceIncrementalRootV1({ ...value, source }));
  assert.throws(() => signalWorkspaceIncrementalProjectionSourceSchemaV1.parse({ ...value.source,
    interpretation_coverage: { ...value.source.interpretation_coverage, expected_unit_count: 2 } }));
  assert.throws(() => signalWorkspaceIncrementalProjectionSourceSchemaV1.parse({ ...value.source, fit_checkpoint: {} }));
});
test("a child evaluation can bind a verified cohort subset without pretending it is the whole corpus", () => {
  const value = scenario();
  const member = value.memberships[0]!;
  const population = sha("verified subset from numerical operations");
  const evaluation_origin = { ...member.evaluation_origin, input_population_digest: population,
    evaluation_key: numericalDigest([member.evaluation_origin.execution_id, member.model_component_key, population, member.evaluation_origin.basis]) };
  const result = projectSignalWorkspaceIncrementalRootV1({ ...value, memberships: [{ ...member, evaluation_origin }] });
  assert.equal(result.decisions.length, 1);
  assert.throws(() => projectSignalWorkspaceIncrementalRootV1({ ...value,
    memberships: [{ ...member, evaluation_origin: { ...evaluation_origin, evaluation_key: sha("forged") } }] }));
});
test("packet bytes, canonical citations, exact configuration and origin are verified, with legacy receipts read-only", () => {
  for (const configuration of [sonnet, opus]) for (const repair of [false, true]) {
    const input = fixture(1, configuration, repair);
    assert.equal(resolveSignalWorkspaceIncrementalBindingsV1(input).bindings.length, 1);
  }
  const input = fixture(), proposal = input.proposals[0]!;
  for (const change of [ { artifact_sha256: sha("forged") }, { owner_execution_id: id(999) }, { request_digest: sha("wrong") },
    { context_digest: sha("other context") }, { call_configuration: opus }, { body: proposal.body + " " } ])
    assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input, proposals: [{ ...proposal, ...change }] }));
  const packet = JSON.parse(proposal.body); packet.interpretations[0].citations = [sha("foreign citation")];
  const body = JSON.stringify(packet);
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input,
    proposals: [{ ...proposal, body, artifact_sha256: sha(body) }] }), /citation_invalid/);
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input, workspace_id: id(999) }), /proposal_origin_invalid/);
});
test("duplicate and mismatched unit/Topic provenance cannot invent an alias", () => {
  const input = fixture(2);
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input, proposals: [...input.proposals, input.proposals[0]!] }));
  const changed = structuredClone(input); changed.topics[0]!.definition.source!.run_key = `workspace-engine:${id(999)}`;
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1(changed), /topic_source_invalid/);
  const duplicate = structuredClone(input); duplicate.components[1]!.units[0]!.unit_key = duplicate.components[0]!.units[0]!.unit_key;
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1(duplicate));
});
test("birth identity is distinct from editorial cluster identity and cannot change under a sealed binding", () => {
  const value = scenario(), changed = structuredClone(value.fixtureInput);
  assert.notEqual(value.bindings.bindings[0]!.birth_membership_digest, value.bindings.bindings[0]!.proposal.cluster_digest);
  changed.components[0]!.units[0]!.birth_membership_digest = sha("a different birth census");
  const bindings = resolveSignalWorkspaceIncrementalBindingsV1(changed);
  assert.notEqual(bindings.binding_digest, value.bindings.binding_digest);
  assert.throws(() => projectSignalWorkspaceIncrementalRootV1({ ...value, bindings }), /source_binding_invalid/);
  const many = fixture(3), forward = resolveSignalWorkspaceIncrementalBindingsV1(many);
  const reversed = resolveSignalWorkspaceIncrementalBindingsV1({ ...many, components: [...many.components].reverse(),
    topics: [...many.topics].reverse(), proposals: [...many.proposals].reverse() });
  assert.equal(forward.binding_digest, reversed.binding_digest); assert.equal(forward.editorial_cut_digest, reversed.editorial_cut_digest);
});
test("an insufficient paid interpretation counts as read but creates no computed semantic authority", () => {
  const value = scenario(), input = structuredClone(value.fixtureInput), proposal = input.proposals[0]!;
  const packet = JSON.parse(proposal.body);
  packet.interpretations[0] = { ...packet.interpretations[0], status: "insufficient", name: null, definition: null,
    inclusion: [], exclusion: [], citations: [] };
  proposal.body = JSON.stringify(packet); proposal.artifact_sha256 = sha(proposal.body);
  const rebound = rebind(value, input), result = projectSignalWorkspaceIncrementalRootV1(rebound);
  assert.equal(rebound.bindings.interpretation_coverage.complete, true);
  assert.equal(result.has_unresolved_topics, true); assert.equal(result.decisions.length, 0);
});
test("incremental metadata remains computed pending and does not make legacy metadata permissive", () => {
  const decision = projectSignalWorkspaceIncrementalRootV1(scenario()).decisions[0]!;
  for (const change of [ { disposition: "approved", approval_policy_id: id(987) }, { disposition: "rejected" },
    { membership_metadata: { ...decision.membership_metadata, materialization_artifact_id: id(986) } },
    { membership_metadata: { ...decision.membership_metadata, unit_keys: [] } },
    { membership_metadata: { ...decision.membership_metadata, evidence_fragment: { chunk_index: 0, start: 0, end: 1401, chunk_sha256: sha("text") } } } ])
    assert.throws(() => signalWorkspaceClassificationDecisionSchemaV1.parse({ ...decision, ...change }));
});


// Local receipts only: the future DB reader must certify these references.
function editorialFixture(count = 1, repair = false) {
  const original = fixture(count, sonnet, repair), owner = id(70000);
  const proposals = original.proposals.map((prior, index) => {
    const packet = JSON.parse(prior.body);
    delete packet.execution_id;
    packet.contract_version = "workspace-incremental-editorial-result-v1";
    packet.context.execution_id = owner;
    let batch = buildSignalWorkspaceInterpretationBatchV1(packet.context, packet.clusters, sonnet);
    if (repair) {
      batch = buildSignalWorkspaceInterpretationRepairBatchV1(batch, { source_call_id: id(800 + index),
        source_response_sha256: sha("raw invalid response"), diagnostic: "output_invalid" });
      packet.editorial_repair = batch.editorial_repair;
    }
    const body = JSON.stringify(packet), component = original.components[index]!;
    const source: Extract<SignalWorkspaceIncrementalProposalSourceV1, { kind: "incremental_editorial" }> = {
      kind: "incremental_editorial", numeric_execution_id: id(3), numeric_checkpoint_digest: sha("numeric checkpoint"),
      evidence_plan_artifact_id: id(71000), evidence_digest: sha("evidence"), target_binding_digest: sha("target bindings"),
      request_plan_artifact_id: id(72000), request_plan_digest: sha("request plan"), response_sha256: sha(`raw response${index}`),
      claims: [{ claim_artifact_id: id(73000 + index), owner_execution_id: owner,
        component_key: component.component_key, unit: structuredClone(component.units[0]!), model_origin: structuredClone(component.model_origin) }],
    };
    return { ...prior, body, artifact_sha256: sha(body), owner_execution_id: owner, request_digest: batch.request_digest, source };
  });
  const merged = mergeSignalWorkspaceTopicMaterializationV1({ prior: [], execution_id: owner,
    now: "2026-09-09T00:00:00.000Z", locale: "es-MX", interpretations: proposals.map(proposal => ({
      artifact_id: proposal.artifact_id, result: JSON.parse(proposal.body).interpretations[0],
    })) });
  return { ...original, proposals, topics: merged.definitions.map((definition, index) => ({ taxonomy_term_id: id(74000 + index), definition })) };
}

test("incremental editorial keeps the actual model, numeric source and paid owner distinct", () => {
  for (const repair of [false, true]) {
    const input = editorialFixture(2, repair), before = structuredClone(input);
    const result = resolveSignalWorkspaceIncrementalBindingsV1(input);
    assert.equal(result.bindings.length, 2);
    for (const binding of result.bindings) {
      assert.equal(binding.model_origin.execution_id, id(2));
      assert.equal(binding.proposal.owner_execution_id, id(70000));
      assert.equal(binding.proposal.source?.kind, "incremental_editorial");
      assert.ok(binding.proposal.source?.source_digest.startsWith("sha256:"));
      assert.equal(result.by_unit.get(binding.unit_key)?.semantic_current, true);
      assert.notEqual(binding.birth_membership_digest, binding.proposal.cluster_digest);
    }
    assert.deepEqual(input, before, "raw packets, claims and operator definitions stay unchanged");
  }
});

test("explicit full_fit and omitted provenance retain the exact historical receipt and binding hashes", () => {
  for (const configuration of [sonnet, opus]) {
    const input = fixture(2, configuration), old = resolveSignalWorkspaceIncrementalBindingsV1(input);
    const explicit = resolveSignalWorkspaceIncrementalBindingsV1({ ...input,
      proposals: input.proposals.map(proposal => ({ ...proposal, source: { kind: "full_fit" } as const })) });
    const historicalReceipts = input.proposals.map(proposal => ({ artifact_id: proposal.artifact_id,
      owner_execution_id: proposal.owner_execution_id, artifact_sha256: proposal.artifact_sha256,
      call_id: proposal.call_id, request_digest: proposal.request_digest })).sort((a, b) => a.artifact_id < b.artifact_id ? -1 : 1);
    // Recorded by executing the unmodified f35d78c resolver against this fixture.
    const pinned = configuration.model === "claude-sonnet-4-6"
      ? { binding: "sha256:6b9644ffe2f523ea0e2cfd074b4422679319b9875b6be35ec5caa5c006bc753c",
        cut: "sha256:463c444317245836162a96abab6173920d80f42bcf253f507c0fbec73d7856eb" }
      : { binding: "sha256:38522e87631f08516cbef5be47d45011ad674733ed487042a7d9602fa4faeec2",
        cut: "sha256:ffe8c33b758d5d60fe3bb40766862925cc390fd3d678c8f23f923a5892cde3e7" };
    assert.equal(old.binding_digest, pinned.binding); assert.equal(old.editorial_cut_digest, pinned.cut);
    assert.equal(old.editorial_cut_digest, digest(historicalReceipts));
    assert.equal(old.binding_digest, digest({ bindings: old.bindings, editorial_cut_digest: old.editorial_cut_digest,
      interpretation_coverage: old.interpretation_coverage }));
    assert.equal(explicit.binding_digest, old.binding_digest);
    assert.ok(old.bindings.every(binding => !Object.hasOwn(binding.proposal, "source")));
  }
});

test("new packet never falls through full_fit and a source cannot substitute the other packet contract", () => {
  const modern = editorialFixture(), prior = fixture(), proposal = modern.proposals[0]!;
  const { source: _source, ...withoutProof } = proposal;
  for (const candidate of [withoutProof, { ...proposal, source: { kind: "full_fit" } },
    { ...proposal, source: { kind: "unexpected" } }, { ...proposal, source: null },
    { ...proposal, source: { ...proposal.source, verified: true } },
    { ...prior.proposals[0]!, source: proposal.source }])
    assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...modern,
      proposals: [candidate as SignalWorkspaceIncrementalProjectionProposalV1] }));
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...prior,
    proposals: [{ ...prior.proposals[0]!, owner_execution_id: id(70000) }] }), /proposal_origin_invalid/);
  const packet = JSON.parse(proposal.body); packet.execution_id = proposal.owner_execution_id;
  const body = JSON.stringify(packet);
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...modern,
    proposals: [{ ...proposal, body, artifact_sha256: sha(body) }] }));
});

test("editorial claims reject foreign owner, self-owned numeric execution, mismatched birth and model identity", () => {
  const input = editorialFixture();
  const changes: Array<(source: typeof input.proposals[number]["source"]) => void> = [
    source => { source.numeric_execution_id = input.proposals[0]!.owner_execution_id; },
    source => { source.claims[0]!.owner_execution_id = id(999); },
    source => { source.claims[0]!.component_key = sha("wrong component"); },
    source => { source.claims[0]!.unit.birth_membership_digest = sha("wrong birth"); },
    source => { source.claims[0]!.unit.local_label = 99; },
    source => { source.claims[0]!.model_origin.execution_id = id(999); },
    source => { source.claims[0]!.model_origin.model_artifact_sha256 = sha("wrong model"); },
    source => { source.claims[0]!.unit.unit_key = `open:${id(999)}`; },
    source => { source.claims = []; },
    source => { source.claims.push(structuredClone(source.claims[0]!)); },
  ];
  for (const mutate of changes) {
    const changed = structuredClone(input); mutate(changed.proposals[0]!.source);
    assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1(changed));
  }
  const duplicate = editorialFixture(2);
  duplicate.proposals[1]!.source.claims[0]!.claim_artifact_id = duplicate.proposals[0]!.source.claims[0]!.claim_artifact_id;
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1(duplicate), /editorial_claim_invalid/);
});

test("every editorial receipt reference enters the new serving digest, without rewriting admission history", () => {
  const input = editorialFixture(), baseline = resolveSignalWorkspaceIncrementalBindingsV1(input);
  const changes: Array<(source: typeof input.proposals[number]["source"]) => void> = [
    source => { source.numeric_execution_id = id(4); },
    source => { source.numeric_checkpoint_digest = sha("another checkpoint"); },
    source => { source.evidence_plan_artifact_id = id(71001); },
    source => { source.evidence_digest = sha("another evidence"); },
    source => { source.target_binding_digest = sha("another target"); },
    source => { source.request_plan_artifact_id = id(72001); },
    source => { source.request_plan_digest = sha("another request plan"); },
    source => { source.response_sha256 = sha("another raw response"); },
    source => { source.claims[0]!.claim_artifact_id = id(73999); },
  ];
  for (const mutate of changes) {
    const changed = structuredClone(input); mutate(changed.proposals[0]!.source);
    const result = resolveSignalWorkspaceIncrementalBindingsV1(changed);
    // Authenticity of changed refs is a DB obligation; the pure layer must seal them, never ignore them.
    assert.notEqual(result.editorial_cut_digest, baseline.editorial_cut_digest);
    assert.notEqual(result.binding_digest, baseline.binding_digest);
  }
  assert.equal(Object.hasOwn(input.proposals[0]!.source, "history_cut_digest"), false);
});

test("new editorial results use the existing draft catalog merge and retain edits, archive and stable Topic identity", () => {
  const input = editorialFixture(3), before = structuredClone(input.topics);
  input.topics[0]!.definition.label = "Edited by the brand";
  input.topics[0]!.definition.discovery_guidance = true;
  input.topics[1]!.definition.definition = "Different semantic meaning";
  input.topics[1]!.definition.definition_revision++;
  input.topics[1]!.definition.definition_digest = sha("edited semantics");
  input.topics[2]!.definition.lifecycle = "archived";
  const existing = structuredClone(input.topics.map(topic => topic.definition));
  const merged = mergeSignalWorkspaceTopicMaterializationV1({ prior: existing, execution_id: id(70000),
    now: "2026-09-09T02:00:00.000Z", locale: "en-US", interpretations: input.proposals.map(proposal => ({
      artifact_id: proposal.artifact_id, result: JSON.parse(proposal.body).interpretations[0],
    })) });
  assert.deepEqual(merged.definitions, existing);
  assert.equal(merged.definitions.length, 3);
  const result = resolveSignalWorkspaceIncrementalBindingsV1(input);
  assert.equal(result.by_unit.get(input.components[0]!.units[0]!.unit_key)?.semantic_current, true);
  assert.equal(result.by_unit.get(input.components[1]!.units[0]!.unit_key)?.semantic_current, false);
  assert.equal(result.by_unit.get(input.components[2]!.units[0]!.unit_key)?.archived, true);
  assert.deepEqual(input.topics.map(topic => topic.definition.term_key), before.map(topic => topic.definition.term_key));
  assert.ok(before.every(topic => topic.definition.lifecycle === "draft" && topic.definition.discovery_guidance === false
    && topic.definition.scope === "all_conversations" && !Object.hasOwn(topic.definition, "selected")));
});

test("editorial bindings mix with inherited full-fit coverage and root projection without precision approval", () => {
  const value = scenario({ count: 3, pending: true }), modern = editorialFixture(3);
  const input = { ...value.fixtureInput, topics: [value.fixtureInput.topics[0]!, modern.topics[1]!, modern.topics[2]!],
    proposals: [value.fixtureInput.proposals[0]!, modern.proposals[1]!] };
  const bindings = resolveSignalWorkspaceIncrementalBindingsV1(input);
  assert.equal(bindings.interpretation_coverage.interpreted_unit_count, 2);
  assert.equal(bindings.interpretation_coverage.expected_unit_count, 3);
  assert.equal(bindings.interpretation_coverage.complete, false);
  const outcome = projectSignalWorkspaceIncrementalRootV1({ ...value, bindings,
    source: { ...value.source, binding_digest: bindings.binding_digest, editorial_cut_digest: bindings.editorial_cut_digest,
      interpretation_coverage: bindings.interpretation_coverage } });
  assert.equal(outcome.decisions.length, 2); assert.equal(outcome.has_unresolved_topics, true);
  assert.ok(outcome.decisions.every(decision => decision.disposition === "pending" && decision.approval_policy_id === null));
  assert.ok(outcome.decisions.some(decision => decision.membership_metadata?.contract_version === "workspace-computed-incremental-membership-v1"
    && decision.membership_metadata.proposal_owner_execution_id === id(70000)
    && decision.membership_metadata.model_origin.execution_id === id(2)));
});


test("incremental editorial cannot claim a model created by its own owner or relabel an Opus receipt", () => {
  const input = editorialFixture(), changed = structuredClone(input);
  const component = changed.components[0]!, claim = changed.proposals[0]!.source.claims[0]!;
  component.model_origin.execution_id = changed.proposals[0]!.owner_execution_id;
  component.component_key = numericalDigest([component.model_origin.execution_id, component.model_origin.model_artifact_sha256, component.lane]);
  claim.model_origin = structuredClone(component.model_origin); claim.component_key = component.component_key;
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1(changed), /editorial_claim_invalid/);
  const prior = structuredClone(input), proposal = prior.proposals[0]!, packet = JSON.parse(proposal.body);
  const batch = buildSignalWorkspaceInterpretationBatchV1(packet.context, packet.clusters, opus);
  const legacyConfiguration = { ...proposal, call_configuration: opus, request_digest: batch.request_digest };
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...prior, proposals: [legacyConfiguration] }), /editorial_configuration_invalid/);
  assert.equal(resolveSignalWorkspaceIncrementalBindingsV1(fixture(1, opus)).bindings.length, 1);
});

test("new editorial packet retains strict bytes, owner, request, context and citation checks", () => {
  const input = editorialFixture(), proposal = input.proposals[0]!;
  for (const change of [{ artifact_sha256: sha("wrong bytes") }, { owner_execution_id: id(999) },
    { request_digest: sha("wrong request") }, { context_digest: sha("wrong context") }, { body: proposal.body + "\n" }])
    assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input, proposals: [{ ...proposal, ...change }] }));
  const packet = JSON.parse(proposal.body); packet.interpretations[0].citations = [sha("unrelated citation")];
  const body = JSON.stringify(packet);
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input,
    proposals: [{ ...proposal, body, artifact_sha256: sha(body) }] }), /citation_invalid/);
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input, workspace_id: id(999) }), /proposal_origin_invalid/);
});

test("multi-unit claim order is canonical but missing or repeated units cannot close a packet", () => {
  const input = editorialFixture(2), first = input.proposals[0]!, second = input.proposals[1]!;
  const a = JSON.parse(first.body), b = JSON.parse(second.body);
  const clusters: SignalWorkspaceInterpretationClusterV1[] = [...a.clusters, ...b.clusters];
  clusters.sort((left, right) => left.cluster_id < right.cluster_id ? -1 : 1);
  const batch = buildSignalWorkspaceInterpretationBatchV1(a.context, clusters, sonnet);
  const byUnit = new Map([...a.interpretations, ...b.interpretations].map(result => [result.cluster_id, result]));
  const body = JSON.stringify({ ...a, clusters, interpretations: clusters.map(cluster => byUnit.get(cluster.cluster_id)) });
  const proposal = { ...first, body, artifact_sha256: sha(body), request_digest: batch.request_digest,
    source: { ...first.source, claims: [...first.source.claims, ...second.source.claims] } };
  const expected = resolveSignalWorkspaceIncrementalBindingsV1({ ...input, proposals: [proposal] });
  const reversed = { ...proposal, source: { ...proposal.source, claims: [...proposal.source.claims].reverse() } };
  assert.equal(resolveSignalWorkspaceIncrementalBindingsV1({ ...input, proposals: [reversed] }).binding_digest, expected.binding_digest);
  const duplicate = { ...proposal, source: { ...proposal.source, claims: [proposal.source.claims[0]!, proposal.source.claims[0]!] } };
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input, proposals: [duplicate] }), /editorial_claim_invalid/);
  const foreign = structuredClone(proposal); foreign.source.claims[1]!.unit.unit_key = `guided:${id(999)}`;
  assert.throws(() => resolveSignalWorkspaceIncrementalBindingsV1({ ...input, proposals: [foreign] }), /editorial_claim_coverage_invalid/);
});
