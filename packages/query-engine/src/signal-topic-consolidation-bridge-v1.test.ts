import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { prepareSignalTopicEditorialInputV1, buildSignalTopicSuccessorCatalogV1, reviseSignalTopicSuccessorCatalogV1,
  type SignalTopicEditorialNumericCensusV1, type SignalTopicEditorialNumericCommunitiesV1 } from "./signal-topic-consolidation-bridge-v1";
import { signalTopicEditorialDigestV1 as digest, buildSignalTopicEditorialGlobalReviewV1,
  validateSignalTopicEditorialScreeningCoverageV1, validateSignalTopicEditorialScreeningOutputV1 } from "./signal-topic-consolidation-editorial-v1";
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12,"0")}`;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const context = { brand_name: "Alexa+", default_locale: "es-MX", summary: "Asistente de voz con IA.", audiences: ["Hogares"],
  categories: ["Asistentes de voz"], competitors: ["Google"], positive_anchors: ["Rutinas"], negative_anchors: [], abstention_anchors: [] };
function fixture(count = 3) {
  const configuration = { representative_limit: 10, neighbor_k: 8 };
  const census: SignalTopicEditorialNumericCensusV1 = {
    contract_version: "signal-topic-consolidation-v1", workspace_id: id(9001), source_execution_id: id(9002), source_checkpoint_digest: digest("checkpoint"),
    output_artifact_id: id(9003), output_artifact_sha256: digest("output"), model_artifact_id: id(9004), model_artifact_sha256: digest("model"),
    centroid_artifact_id: null, centroid_artifact_sha256: null, context_digest: digest("source_context"), configuration, configuration_digest: digest(configuration),
    expected_group_count: count, groups: Array.from({ length: count }, (_, index) => {
      const text = "Alexa ejecuta mis rutinas", root_id = id(Math.floor(index/2) + 1), start = 5, end = start + text.length, chunk_sha256 = sha(text);
      const ref = { root_id, start, end, chunk_index: 0, chunk_sha256,
        ref_id: digest({ root_id, start, end, chunk_index: 0, chunk_sha256 }), locale: "es-MX", platform: "reddit", occurred_at: null };
      const dossier = { contract_version: "signal-topic-group-dossier-v1" as const, scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 },
        locale_counts: [{ key: "es-MX", count: 1 }], platform_counts: [{ key: "reddit", count: 1 }], month_counts: [],
        brand_affinity: { positive: [{ guide_key: "rutinas", score: 0.7 }], negative: [], abstention: [] }, neighbors: [],
        metrics: { cohesion: null, outlier_ratio: null }, evidence: [ref] };
      return { group_key: `open:cluster-${index}`, lane: "open", stable_cluster_id: `cluster-${index}`, local_label: index,
        group_digest: digest(["group", index]), root_count: 1, chunk_count: 1, terms: ["rutinas"], dossier, dossier_digest: digest(dossier), centroid: null,
        roots: [{ root_id, chunk_count: 1, strength: 0.8, assignment_digest: digest([root_id, index]) }] };
    })
  };
  const members = census.groups.map((group, rank) => ({ group_key: group.group_key, rank, similarity: 0.8 }));
  const communities: SignalTopicEditorialNumericCommunitiesV1 = { contract_version: "signal-topic-centroid-community-plan-v1",
    configuration_digest: census.configuration_digest, communities: [{ community_key: "community-all", members, community_digest: digest({ members }) }] };
  return { census, communities, context, expected_census_digest: digest(census), expected_community_plan_digest: digest(communities),
    expected_source_context_digest: census.context_digest, expected_editorial_context_digest: digest(context),
    load_evidence: async (request: { refs: Array<{ ref_id: string; root_id: string; chunk_index: number; start: number; end: number; chunk_sha256: string }> }) =>
      request.refs.map(ref => ({ ...ref, root_text: "HEAD Alexa ejecuta mis rutinas TAIL" })) };
}
async function resultFixture() {
  const input = await prepareSignalTopicEditorialInputV1(fixture());
  const screening = validateSignalTopicEditorialScreeningCoverageV1(input.plan, input.plan.batches.map(batch => validateSignalTopicEditorialScreeningOutputV1(batch, {
    contract_version: "signal-topic-editorial-screening-output-v1", batch_index: batch.batch_index,
    decisions: batch.group_keys.map((group_key, index) => ({ group_key, disposition: index === 1 ? "noise" : "topic",
      candidate: index === 1 ? null : { candidate_key: `b0000-rutinas-${index}`, label: "Rutinas", definition: "Rutinas con Alexa.", locale: "es-MX" },
      confidence: 0.8, rationale: index === 1 ? "Fuera de alcance." : null,
      cited_ref_ids: index === 1 ? [] : input.groups.find(group => group.group_key === group_key)!.evidence.map(item => item.ref_id) }))
  })));
  const review = buildSignalTopicEditorialGlobalReviewV1({ plan: input.plan, screening, groups: input.groups });
  const global_result = { contract_version: "signal-topic-editorial-global-result-v1", concepts: [{ concept_key: "topic-rutinas", kind: "topic",
    label: "Rutinas inteligentes", definition: "Rutinas con Alexa.", locale: "es-MX", member_group_keys: ["open:cluster-0", "open:cluster-2"] }],
    noise_group_keys: ["open:cluster-1"], unresolved_group_keys: [] };
  return { input, screening, review, global_result, previous_selection: [], selection_mapping: [] };
}
test("all 1652 groups enter once, evidence is loaded once per ref with sealed source/context and absolute ranges", async () => {
  const args = fixture(1652); let refs = 0;
  const input = await prepareSignalTopicEditorialInputV1({ ...args, load_evidence: async request => {
    assert.equal(request.workspace_id, args.census.workspace_id); assert.equal(request.source_execution_id, args.census.source_execution_id);
    assert.equal(request.census_digest, args.expected_census_digest); refs = request.refs.length;
    return args.load_evidence(request);
  } });
  assert.equal(input.groups.length, 1652); assert.equal(input.plan.batches.length, 42); assert.equal(refs, 826);
  assert.equal(new Set(input.plan.batches.flatMap(batch => batch.group_keys)).size, 1652);
  assert.equal(input.groups[0]!.evidence[0]!.text, "Alexa ejecuta mis rutinas");
  assert.equal(input.groups[0]!.brand_affinity.positive[0]!.score, 0.7);
  assert.equal(input.context.default_locale, "es-MX");
  assert.equal(JSON.stringify(input).includes("root_text"), false);
});
test("duplicate/omitted groups, wrong community coverage and stale context fail before evidence loading", async () => {
  for (const scenario of ["duplicate", "omission", "community", "context"] as const) {
    const args = fixture(); let loaded = false;
    if (scenario === "duplicate") args.census.groups[1] = structuredClone(args.census.groups[0]!);
    if (scenario === "omission") args.census.groups.pop();
    if (scenario === "community") { args.communities.communities[0]!.members.pop(); args.communities.communities[0]!.community_digest = digest({ members: args.communities.communities[0]!.members }); }
    if (scenario === "context") args.context.default_locale = "en-US";
    args.expected_census_digest = digest(args.census); args.expected_community_plan_digest = digest(args.communities);
    await assert.rejects(prepareSignalTopicEditorialInputV1({ ...args, load_evidence: async () => { loaded = true; return []; } }), /bridge_/);
    assert.equal(loaded, false);
  }
});
test("loader omission, duplicate, wrong bytes, shifted ranges and foreign refs are rejected", async () => {
  for (const scenario of ["omission", "duplicate", "bytes", "range", "foreign"] as const) {
    const args = fixture();
    await assert.rejects(prepareSignalTopicEditorialInputV1({ ...args, load_evidence: async request => {
      const loaded = await args.load_evidence(request);
      if (scenario === "omission") loaded.pop();
      if (scenario === "duplicate") loaded[1] = loaded[0]!;
      if (scenario === "bytes") loaded[0]!.root_text = loaded[0]!.root_text.replace("Alexa", "Other");
      if (scenario === "range") loaded[0]!.start += 1;
      if (scenario === "foreign") loaded[0]!.ref_id = digest("foreign");
      return loaded;
    } }), /bridge_loaded_evidence_/);
  }
});
test("dossier/ref hashes and root membership cannot be replaced before loading", async () => {
  const args = fixture(); args.census.groups[0]!.dossier.evidence[0]!.root_id = id(999);
  args.census.groups[0]!.dossier_digest = digest(args.census.groups[0]!.dossier); args.expected_census_digest = digest(args.census);
  await assert.rejects(prepareSignalTopicEditorialInputV1(args), /evidence_root_foreign/);
  const stale = fixture(); stale.census.groups[0]!.dossier.metrics.cohesion = 0.5;
  stale.expected_census_digest = digest(stale.census);
  await assert.rejects(prepareSignalTopicEditorialInputV1(stale), /dossier_digest_invalid/);
});
test("successor preserves group lineage and never hides a root merely because one group is Noise", async () => {
  const args = await resultFixture(), catalog = buildSignalTopicSuccessorCatalogV1(args);
  assert.equal(catalog.groups.length, 3); assert.equal(catalog.roots.length, 2);
  assert.deepEqual(catalog.roots[0]!.group_keys, ["open:cluster-0", "open:cluster-1"]);
  assert.deepEqual(catalog.roots[0]!.noise_group_keys, ["open:cluster-1"]);
  assert.deepEqual(catalog.roots[0]!.concept_keys, ["topic-rutinas"]); assert.equal(catalog.roots[0]!.disposition, "assigned");
  assert.equal(catalog.activation, "not_activated"); assert.equal(catalog.concepts[0]!.selected, false);
  assert.throws(() => buildSignalTopicSuccessorCatalogV1({ ...args, global_result: { ...args.global_result, noise_group_keys: [] } }), /coverage|disposition/);
});
test("selection mapping requires exact semantic identity; unknown legacy identities stay explicitly unmapped", async () => {
  const args = await resultFixture(), identity = buildSignalTopicSuccessorCatalogV1(args).concepts[0]!.semantic_identity_digest;
  const prior = { term_key: "old-rutinas", selected: true, identity_contract_version: "signal-topic-successor-semantic-identity-v1" as const,
    semantic_identity_digest: identity };
  const mapped = buildSignalTopicSuccessorCatalogV1({ ...args, previous_selection: [prior], selection_mapping: [{ previous_term_key: prior.term_key, concept_key: "topic-rutinas" }] });
  assert.equal(mapped.concepts[0]!.selected, true); assert.deepEqual(mapped.unmapped_previous_selection, []);
  assert.throws(() => buildSignalTopicSuccessorCatalogV1({ ...args, previous_selection: [{ ...prior, semantic_identity_digest: digest("different") }],
    selection_mapping: [{ previous_term_key: prior.term_key, concept_key: "topic-rutinas" }] }), /selection_identity_changed/);
  assert.throws(() => buildSignalTopicSuccessorCatalogV1({ ...args, previous_selection: [prior],
    global_result: { ...args.global_result, concepts: args.global_result.concepts.map(concept => ({ ...concept, definition: "Privacidad en Alexa." })) },
    selection_mapping: [{ previous_term_key: prior.term_key, concept_key: "topic-rutinas" }] }), /selection_identity_changed/);
  const unmapped = buildSignalTopicSuccessorCatalogV1({ ...args, previous_selection: [{ ...prior, identity_contract_version: null, semantic_identity_digest: null }] });
  assert.deepEqual(unmapped.unmapped_previous_selection, [prior.term_key]); assert.equal(unmapped.concepts[0]!.selected, false);
});
test("human revisions reverse Noise, preserve cosmetic selection and clear semantic changes with a revision chain", async () => {
  const args = await resultFixture(), initial = buildSignalTopicSuccessorCatalogV1(args);
  const prior = buildSignalTopicSuccessorCatalogV1({ ...args, previous_selection: [{ term_key: "old-rutinas", selected: true,
    identity_contract_version: "signal-topic-successor-semantic-identity-v1", semantic_identity_digest: initial.concepts[0]!.semantic_identity_digest }],
    selection_mapping: [{ previous_term_key: "old-rutinas", concept_key: "topic-rutinas" }] });
  const edit = { input: args.input, prior, expected_revision_digest: prior.revision_digest, concepts: prior.concepts.map(item => ({ ...item, label: "Rutinas por voz" })), groups: prior.groups };
  const cosmetic = reviseSignalTopicSuccessorCatalogV1(edit);
  assert.equal(cosmetic.concepts[0]!.selected, true); assert.equal(cosmetic.previous_revision_digest, prior.revision_digest);
  const reversed = reviseSignalTopicSuccessorCatalogV1({ ...edit, groups: prior.groups.map(item => ({ ...item, disposition: "topic", concept_key: "topic-rutinas" })) });
  assert.deepEqual(reversed.roots[0]!.noise_group_keys, []); assert.equal(reversed.concepts[0]!.selected, false);
  assert.deepEqual(reversed.unmapped_previous_selection, ["old-rutinas"]); assert.equal(prior.groups[1]!.disposition, "noise");
  assert.throws(() => reviseSignalTopicSuccessorCatalogV1({ ...edit, groups: prior.groups.slice(1) }), /revision_incomplete/);
  assert.throws(() => reviseSignalTopicSuccessorCatalogV1({ ...edit, expected_revision_digest: digest("old") }), /revision_conflict/);
});
test("roots with only rejected groups become Noise; unresolved evidence stays distinct", async () => {
  const args = await resultFixture();
  const catalog = buildSignalTopicSuccessorCatalogV1({ ...args, global_result: { ...args.global_result, concepts: [],
    noise_group_keys: ["open:cluster-0", "open:cluster-1"], unresolved_group_keys: ["open:cluster-2"] } });
  assert.equal(catalog.roots[0]!.disposition, "noise"); assert.equal(catalog.roots[1]!.disposition, "unresolved");
  assert.equal(catalog.concepts.length, 0); assert.equal(catalog.groups.length, 3);
  assert.throws(() => buildSignalTopicSuccessorCatalogV1({ ...args, input: { ...args.input, source_context_digest: digest("tampered") } }), /prepared_input_digest_invalid/);
});
