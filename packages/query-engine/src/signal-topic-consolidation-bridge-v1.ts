import { createHash } from "node:crypto";
import {
  buildSignalTopicEditorialGlobalReviewV1, buildSignalTopicEditorialScreeningPlanV1, signalTopicEditorialDigestV1 as digest,
  validateSignalTopicEditorialGlobalResultV1, validateSignalTopicEditorialScreeningCoverageV1,
  validateSignalTopicEditorialScreeningOutputV1,
  type SignalTopicEditorialBrandContextV1, type SignalTopicEditorialEvidenceV1,
  type SignalTopicEditorialGlobalReviewV1, type SignalTopicEditorialScreeningGroupV1,
  type SignalTopicEditorialScreeningPlanV1, type SignalTopicEditorialScreeningResultV1,
} from "./signal-topic-consolidation-editorial-v1";

/** Structural seam for SQL0174's census, avoiding query-engine -> DB dependencies. */
export type SignalTopicEditorialNumericCensusV1 = {
  contract_version: "signal-topic-consolidation-v1";
  workspace_id: string; source_execution_id: string; source_checkpoint_digest: string;
  output_artifact_id: string; output_artifact_sha256: string; model_artifact_id: string; model_artifact_sha256: string;
  centroid_artifact_id: string | null; centroid_artifact_sha256: string | null;
  context_digest: string; configuration: object; configuration_digest: string; expected_group_count: number;
  groups: Array<{
    group_key: string; lane: "open" | "guided"; stable_cluster_id: string; local_label: number;
    group_digest: string; root_count: number; chunk_count: number; terms: string[];
    dossier_digest: string;
    dossier: Omit<SignalTopicEditorialScreeningGroupV1, "group_key" | "lane" | "group_digest" | "source_dossier_digest" | "dossier_digest" | "community_key" | "root_count" | "chunk_count" | "terms" | "evidence"> & {
      contract_version: "signal-topic-group-dossier-v1"; evidence: Array<Omit<SignalTopicEditorialEvidenceV1, "text">>;
    };
    centroid: { artifact_id: string; artifact_sha256: string; centroid_key: string; centroid_digest: string } | null;
    roots: Array<{ root_id: string; chunk_count: number; strength: number | null; assignment_digest: string }>;
  }>;
};
export type SignalTopicEditorialNumericCommunitiesV1 = {
  contract_version: "signal-topic-centroid-community-plan-v1"; configuration_digest: string;
  communities: Array<{ community_key: string; community_digest: string;
    members: Array<{ group_key: string; rank: number; similarity: number }> }>;
};
export type SignalTopicEditorialEvidenceLoadV1 = Pick<SignalTopicEditorialEvidenceV1,
  "ref_id" | "root_id" | "chunk_index" | "start" | "end" | "chunk_sha256"> & { root_text: string };
export type SignalTopicEditorialPreparedInputV1 = {
  contract_version: "signal-topic-editorial-prepared-input-v1";
  workspace_id: string; source_execution_id: string; census_digest: string; source_census_digest: string; community_plan_digest: string;
  source_context_digest: string; editorial_context_digest: string; context: SignalTopicEditorialBrandContextV1;
  expected_group_count: number; groups: SignalTopicEditorialScreeningGroupV1[];
  root_lineage: Array<{ group_key: string; group_digest: string;
    roots: SignalTopicEditorialNumericCensusV1["groups"][number]["roots"] }>;
  plan: SignalTopicEditorialScreeningPlanV1; input_digest: string;
};
const fail = (code: string): never => { throw new Error(`topic_editorial_bridge_${code}`); };
const shaPattern = /^sha256:[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const unique = (values: string[], code: string) => { if (new Set(values).size !== values.length) fail(code); };
const natural = (value: number) => Number.isSafeInteger(value) && value >= 0;
/** A high-affiliation representative plus the boundary representative lets the
 * editorial pass distinguish a coherent group from a mixed one. The complete
 * ten-reference dossier remains sealed in the numeric source for drill-down. */
export const SIGNAL_TOPIC_EDITORIAL_EVIDENCE_PER_GROUP_V1 = 2;
const coordinates = ({ ref_id, root_id, chunk_index, start, end, chunk_sha256 }: SignalTopicEditorialEvidenceLoadV1 | Omit<SignalTopicEditorialEvidenceV1, "text">) =>
  ({ ref_id, root_id, chunk_index, start, end, chunk_sha256 });

/** No provider calls, sampling or embedding. Every numeric group enters screening once.
 * The injected loader must enforce access/source ownership; this bridge verifies the bytes. */
export async function prepareSignalTopicEditorialInputV1(args: {
  census: SignalTopicEditorialNumericCensusV1; expected_census_digest: string;
  source_census_digest?: string;
  communities: SignalTopicEditorialNumericCommunitiesV1; expected_community_plan_digest: string;
  context: SignalTopicEditorialBrandContextV1; expected_source_context_digest: string; expected_editorial_context_digest: string;
  load_evidence: (request: { workspace_id: string; source_execution_id: string; census_digest: string;
    refs: Array<ReturnType<typeof coordinates>> }) => Promise<SignalTopicEditorialEvidenceLoadV1[]>;
}): Promise<SignalTopicEditorialPreparedInputV1> {
  const seals = { census: args.expected_census_digest, source_census: args.source_census_digest ?? args.expected_census_digest,
    communities: args.expected_community_plan_digest,
    source_context: args.expected_source_context_digest, editorial_context: args.expected_editorial_context_digest };
  const census = structuredClone(args.census), communities = structuredClone(args.communities), context = structuredClone(args.context);
  if (census.contract_version !== "signal-topic-consolidation-v1" || !uuidPattern.test(census.workspace_id) || !uuidPattern.test(census.source_execution_id)
    || digest(census) !== seals.census || digest(communities) !== seals.communities
    || digest(census.configuration) !== census.configuration_digest || census.context_digest !== seals.source_context
    || digest(context) !== seals.editorial_context) fail("source_digest_invalid");
  if (!natural(census.expected_group_count) || census.expected_group_count < 1 || census.expected_group_count > 5_000
    || census.groups.length !== census.expected_group_count) fail("census_incomplete");
  unique(census.groups.map(group => group.group_key), "groups_duplicate");
  const groupKeys = new Set(census.groups.map(group => group.group_key)), byCommunity = new Map<string, string>();
  if (communities.contract_version !== "signal-topic-centroid-community-plan-v1" || communities.configuration_digest !== census.configuration_digest)
    fail("community_configuration_invalid");
  unique(communities.communities.map(item => item.community_key), "communities_duplicate");
  for (const community of communities.communities) {
    const members = [...community.members].sort((a, b) => a.rank - b.rank || compare(a.group_key, b.group_key));
    if (!members.length || digest({ members }) !== community.community_digest) fail("community_digest_invalid");
    unique(members.map(item => String(item.rank)), "community_rank_duplicate");
    for (const member of members) {
      if (!natural(member.rank) || !Number.isFinite(member.similarity) || member.similarity < 0 || member.similarity > 1
        || !groupKeys.has(member.group_key) || byCommunity.has(member.group_key)) fail("community_coverage_invalid");
      byCommunity.set(member.group_key, community.community_key);
    }
  }
  if (byCommunity.size !== groupKeys.size) fail("community_coverage_invalid");
  const refs = new Map<string, ReturnType<typeof coordinates>>();
  for (const group of census.groups) {
    if (group.roots.length !== group.root_count || group.roots.reduce((total, root) => total + root.chunk_count, 0) !== group.chunk_count)
      fail("root_coverage_invalid");
    unique(group.roots.map(root => root.root_id), "roots_duplicate");
    for (const root of group.roots) if (!uuidPattern.test(root.root_id) || !natural(root.chunk_count) || root.chunk_count < 1
      || !shaPattern.test(root.assignment_digest)) fail("root_lineage_invalid");
    if (digest(group.dossier) !== group.dossier_digest) fail("dossier_digest_invalid");
    const rootIds = new Set(group.roots.map(root => root.root_id));
    if (group.dossier.neighbors.some(item => !groupKeys.has(item.group_key))) fail("neighbor_unknown");
    for (const ref of group.dossier.evidence.slice(0,SIGNAL_TOPIC_EDITORIAL_EVIDENCE_PER_GROUP_V1)) {
      if (!rootIds.has(ref.root_id)) fail("evidence_root_foreign");
      if (!natural(ref.chunk_index) || !natural(ref.start) || !natural(ref.end) || ref.end <= ref.start || !shaPattern.test(ref.chunk_sha256)
        || digest({ root_id: ref.root_id, chunk_index: ref.chunk_index, start: ref.start, end: ref.end, chunk_sha256: ref.chunk_sha256 }) !== ref.ref_id)
        fail("evidence_ref_invalid");
      const locator = coordinates(ref), prior = refs.get(ref.ref_id);
      if (prior && digest(prior) !== digest(locator)) fail("evidence_ref_conflict");
      refs.set(ref.ref_id, locator);
    }
  }
  const requestedRefs = [...refs.values()].sort((a, b) => compare(a.ref_id, b.ref_id));
  const loaded = await args.load_evidence({ workspace_id: census.workspace_id, source_execution_id: census.source_execution_id,
    census_digest: seals.census, refs: structuredClone(requestedRefs) });
  unique(loaded.map(item => item.ref_id), "loaded_evidence_duplicate");
  if (loaded.length !== refs.size) fail("loaded_evidence_incomplete");
  const texts = new Map<string, string>();
  for (const item of loaded) {
    const requested = refs.get(item.ref_id);
    if (!requested || digest(coordinates(item)) !== digest(requested) || typeof item.root_text !== "string"
      || !natural(item.start) || !natural(item.end) || item.start >= item.end || item.end > item.root_text.length)
      fail("loaded_evidence_range_invalid");
    const text = item.root_text.slice(item.start, item.end);
    if (sha(text) !== item.chunk_sha256) fail("loaded_evidence_hash_invalid");
    texts.set(item.ref_id, text);
  }
  const groups = census.groups.map(group => {const evidence=group.dossier.evidence.slice(0,SIGNAL_TOPIC_EDITORIAL_EVIDENCE_PER_GROUP_V1),
    editorialDossier={...group.dossier,evidence};return ({ group_key: group.group_key, lane: group.lane, group_digest: group.group_digest,
    source_dossier_digest:group.dossier_digest,dossier_digest:digest(editorialDossier), community_key: byCommunity.get(group.group_key)!, root_count: group.root_count,
    chunk_count: group.chunk_count, terms: group.terms, scope_counts: group.dossier.scope_counts,
    locale_counts: group.dossier.locale_counts, platform_counts: group.dossier.platform_counts, month_counts: group.dossier.month_counts,
    brand_affinity: group.dossier.brand_affinity, neighbors: group.dossier.neighbors, metrics: group.dossier.metrics,
    evidence: evidence.map(ref => ({ ...ref, text: texts.get(ref.ref_id)! }))
  });}).sort((a, b) => compare(a.group_key, b.group_key));
  const plan = buildSignalTopicEditorialScreeningPlanV1({ source_context_digest: census.context_digest,
    editorial_context_digest: seals.editorial_context, context, expected_group_count: census.expected_group_count, groups });
  const header = { contract_version: "signal-topic-editorial-prepared-input-v1" as const, workspace_id: census.workspace_id,
    source_execution_id: census.source_execution_id, census_digest: seals.census, source_census_digest: seals.source_census,
    community_plan_digest: seals.communities, source_context_digest: census.context_digest,
    editorial_context_digest: seals.editorial_context, context, expected_group_count: census.expected_group_count, groups,
    root_lineage: census.groups.map(group => ({ group_key: group.group_key, group_digest: group.group_digest,
      roots: [...group.roots].sort((a, b) => compare(a.root_id, b.root_id)) })).sort((a, b) => compare(a.group_key, b.group_key)), plan };
  return { ...header, input_digest: digest(header) };
}

export type SignalTopicSuccessorConceptV1 = {
  concept_key: string; kind: "topic" | "narrative"; label: string; definition: string; locale: string;
  priority_rank: number; priority_rationale: string;
  semantic_identity_digest: string; definition_revision: number; selected: boolean; source: "model" | "human";
};
export type SignalTopicSuccessorGroupV1 = { group_key: string; group_digest: string;
  disposition: "topic" | "narrative" | "noise" | "unresolved"; concept_key: string | null; source: "model" | "human" };
export type SignalTopicPriorSelectionV1 = { term_key: string; selected: boolean;
  identity_contract_version: "signal-topic-successor-semantic-identity-v1" | null; semantic_identity_digest: string | null };
export type SignalTopicSuccessorCatalogV1 = {
  contract_version: "signal-topic-successor-catalog-v1"; revision: number; previous_revision_digest: string | null;
  input_digest: string; source_context_digest: string; global_result_digest: string;
  concepts: SignalTopicSuccessorConceptV1[]; groups: SignalTopicSuccessorGroupV1[];
  roots: Array<{ root_id: string; group_keys: string[]; concept_keys: string[]; noise_group_keys: string[];
    unresolved_group_keys: string[]; disposition: "assigned" | "noise" | "unresolved" }>;
  selection_mapping: Array<{ previous_term_key: string; concept_key: string; semantic_identity_digest: string; selected: boolean }>;
  unmapped_previous_selection: string[]; activation: "not_activated"; revision_digest: string;
};
/** Includes full group identities/context, excludes cosmetic label and model confidence.
 * Legacy rules lacking this identity contract are deliberately not auto-mapped. */
export function signalTopicSuccessorSemanticIdentityV1(concept: Pick<SignalTopicSuccessorConceptV1, "kind" | "definition" | "locale">,
  groups: Array<Pick<SignalTopicSuccessorGroupV1, "group_key" | "group_digest">>, source_context_digest: string): string {
  return digest({ contract_version: "signal-topic-successor-semantic-identity-v1", source_context_digest,
    kind: concept.kind, definition: concept.definition, locale: concept.locale,
    groups: [...groups].sort((a, b) => compare(a.group_key, b.group_key)).map(({ group_key, group_digest }) => ({ group_key, group_digest })) });
}
function inputValid(input: SignalTopicEditorialPreparedInputV1) {
  const { input_digest, ...body } = input;
  if (digest(body) !== input_digest) fail("prepared_input_digest_invalid");
}
function buildRoots(input: SignalTopicEditorialPreparedInputV1, groups: SignalTopicSuccessorGroupV1[]): SignalTopicSuccessorCatalogV1["roots"] {
  const decisions = new Map(groups.map(group => [group.group_key, group]));
  const roots = new Map<string, SignalTopicSuccessorCatalogV1["roots"][number]>();
  for (const group of input.root_lineage) for (const member of group.roots) {
    const root = roots.get(member.root_id) ?? { root_id: member.root_id, group_keys: [], concept_keys: [], noise_group_keys: [], unresolved_group_keys: [], disposition: "unresolved" as const };
    const decision = decisions.get(group.group_key)!;
    root.group_keys.push(group.group_key);
    if (decision.concept_key) root.concept_keys.push(decision.concept_key);
    else if (decision.disposition === "noise") root.noise_group_keys.push(group.group_key);
    else root.unresolved_group_keys.push(group.group_key);
    roots.set(root.root_id, root);
  }
  return [...roots.values()].map(root => ({ ...root, group_keys: root.group_keys.sort(compare),
    concept_keys: [...new Set(root.concept_keys)].sort(compare), noise_group_keys: root.noise_group_keys.sort(compare),
    unresolved_group_keys: root.unresolved_group_keys.sort(compare),
    disposition: root.concept_keys.length ? "assigned" as const : root.unresolved_group_keys.length ? "unresolved" as const : "noise" as const,
  })).sort((a, b) => compare(a.root_id, b.root_id));
}
function selection(concepts: SignalTopicSuccessorConceptV1[], previous: SignalTopicPriorSelectionV1[], mappings: Array<{ previous_term_key: string; concept_key: string }>) {
  if (previous.some(item => !item.term_key || typeof item.selected !== "boolean"
    || (item.identity_contract_version === null ? item.semantic_identity_digest !== null
      : item.identity_contract_version !== "signal-topic-successor-semantic-identity-v1" || !shaPattern.test(item.semantic_identity_digest ?? ""))))
    fail("previous_selection_invalid");
  unique(previous.map(item => item.term_key), "previous_selection_duplicate");
  unique(mappings.map(item => item.previous_term_key), "selection_mapping_duplicate");
  unique(mappings.map(item => item.concept_key), "selection_mapping_ambiguous");
  const receipt = mappings.map(mapping => {
    const prior = previous.find(item => item.term_key === mapping.previous_term_key), concept = concepts.find(item => item.concept_key === mapping.concept_key);
    if (!prior || !concept || prior.identity_contract_version !== "signal-topic-successor-semantic-identity-v1"
      || prior.semantic_identity_digest !== concept.semantic_identity_digest) return fail("selection_identity_changed");
    concept.selected = prior.selected;
    return { ...mapping, semantic_identity_digest: concept.semantic_identity_digest, selected: prior.selected };
  }).sort((a, b) => compare(a.previous_term_key, b.previous_term_key));
  return { selection_mapping: receipt, unmapped_previous_selection: previous.filter(prior => prior.selected && !mappings.some(mapping => mapping.previous_term_key === prior.term_key))
    .map(item => item.term_key).sort(compare) };
}
export function buildSignalTopicSuccessorCatalogV1(args: {
  input: SignalTopicEditorialPreparedInputV1; screening: SignalTopicEditorialScreeningResultV1; review: SignalTopicEditorialGlobalReviewV1;
  global_result: unknown; previous_selection: SignalTopicPriorSelectionV1[]; selection_mapping: Array<{ previous_term_key: string; concept_key: string }>;
}): SignalTopicSuccessorCatalogV1 {
  inputValid(args.input);
  const verifiedScreening = validateSignalTopicEditorialScreeningCoverageV1(args.input.plan, args.input.plan.batches.map(batch =>
    validateSignalTopicEditorialScreeningOutputV1(batch, { contract_version: "signal-topic-editorial-screening-output-v1", batch_index: batch.batch_index,
      decisions: args.screening.decisions.filter(item => batch.group_keys.includes(item.group_key)) })));
  if (digest(verifiedScreening) !== digest(args.screening)) fail("screening_invalid");
  const review = buildSignalTopicEditorialGlobalReviewV1({ plan: args.input.plan, screening: verifiedScreening, groups: args.input.groups });
  if (digest(review) !== digest(args.review)) fail("global_review_invalid");
  const result = validateSignalTopicEditorialGlobalResultV1({ review, screening: verifiedScreening, value: args.global_result });
  const groupDefinitions = new Map(args.input.groups.map(group => [group.group_key, group]));
  const groups: SignalTopicSuccessorGroupV1[] = [
    ...result.concepts.flatMap(concept => concept.member_group_keys.map(group_key => ({ group_key,
      group_digest: groupDefinitions.get(group_key)!.group_digest, disposition: concept.kind, concept_key: concept.concept_key, source: "model" as const }))),
    ...result.noise_group_keys.map(group_key => ({ group_key, group_digest: groupDefinitions.get(group_key)!.group_digest, disposition: "noise" as const, concept_key: null, source: "model" as const })),
    ...result.unresolved_group_keys.map(group_key => ({ group_key, group_digest: groupDefinitions.get(group_key)!.group_digest, disposition: "unresolved" as const, concept_key: null, source: "model" as const })),
  ].sort((a, b) => compare(a.group_key, b.group_key));
  const concepts: SignalTopicSuccessorConceptV1[] = result.concepts.map(concept => ({ concept_key: concept.concept_key, kind: concept.kind,
    label: concept.label, definition: concept.definition, locale: concept.locale, priority_rank: concept.priority_rank,
    priority_rationale: concept.priority_rationale, definition_revision: 1, source: "model", selected: false,
    semantic_identity_digest: signalTopicSuccessorSemanticIdentityV1(concept, groups.filter(group => group.concept_key === concept.concept_key), args.input.source_context_digest) }));
  const header = { contract_version: "signal-topic-successor-catalog-v1" as const, revision: 1, previous_revision_digest: null,
    input_digest: args.input.input_digest, source_context_digest: args.input.source_context_digest, global_result_digest: digest(result),
    concepts, groups, roots: buildRoots(args.input, groups), ...selection(concepts, args.previous_selection, args.selection_mapping), activation: "not_activated" as const };
  return { ...header, revision_digest: digest(header) };
}

/** One explicit full revision; deletion/reassignment never erases atomic evidence.
 * Selection survives cosmetic edits only; semantic/membership changes clear it. */
export function reviseSignalTopicSuccessorCatalogV1(args: { input: SignalTopicEditorialPreparedInputV1; prior: SignalTopicSuccessorCatalogV1;
  expected_revision_digest: string; concepts: Array<Pick<SignalTopicSuccessorConceptV1, "concept_key" | "kind" | "label" | "definition" | "locale" | "priority_rank" | "priority_rationale">>;
  groups: Array<Pick<SignalTopicSuccessorGroupV1, "group_key" | "disposition" | "concept_key">>;
}): SignalTopicSuccessorCatalogV1 {
  inputValid(args.input);
  const { revision_digest, ...priorBody } = args.prior;
  if (revision_digest !== args.expected_revision_digest || digest(priorBody) !== revision_digest || args.prior.input_digest !== args.input.input_digest)
    fail("revision_conflict");
  unique(args.concepts.map(item => item.concept_key), "concept_duplicate"); unique(args.groups.map(item => item.group_key), "groups_duplicate");
  const sourceGroups = new Map(args.input.groups.map(group => [group.group_key, group]));
  if (args.groups.length !== args.input.expected_group_count || args.groups.some(group => !sourceGroups.has(group.group_key))) fail("revision_incomplete");
  const groups: SignalTopicSuccessorGroupV1[] = args.groups.map(group => {
    const concept = args.concepts.find(item => item.concept_key === group.concept_key);
    if (!["topic", "narrative", "noise", "unresolved"].includes(group.disposition)
      || ((group.disposition === "topic" || group.disposition === "narrative") ? !concept || concept.kind !== group.disposition : group.concept_key !== null))
      fail("revision_disposition_invalid");
    return { ...group, group_digest: sourceGroups.get(group.group_key)!.group_digest, source: "human" as const };
  }).sort((a, b) => compare(a.group_key, b.group_key));
  const concepts: SignalTopicSuccessorConceptV1[] = args.concepts.map(concept => {
    const memberGroups = groups.filter(group => group.concept_key === concept.concept_key), prior = args.prior.concepts.find(item => item.concept_key === concept.concept_key);
    if (!memberGroups.length || !/^(topic|narrative)-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(concept.concept_key) || !concept.concept_key.startsWith(`${concept.kind}-`)
      || !["topic", "narrative"].includes(concept.kind) || !concept.label.trim() || concept.label.length > 160
      || !concept.definition.trim() || concept.definition.length > 500 || Intl.getCanonicalLocales(concept.locale)[0] !== concept.locale
      || !Number.isSafeInteger(concept.priority_rank) || concept.priority_rank < 1 || concept.priority_rank > 120
      || !concept.priority_rationale.trim() || concept.priority_rationale.length > 280)
      fail("revision_concept_invalid");
    const semantic_identity_digest = signalTopicSuccessorSemanticIdentityV1(concept, memberGroups, args.input.source_context_digest);
    return { ...concept, semantic_identity_digest, definition_revision: (prior?.definition_revision ?? 0) + 1, source: "human" as const,
      selected: prior?.semantic_identity_digest === semantic_identity_digest && prior.selected === true };
  }).sort((a, b) => a.priority_rank-b.priority_rank || compare(a.concept_key, b.concept_key));
  if(concepts.some((item,index)=>item.priority_rank!==index+1)) fail("revision_priority_invalid");
  const header = { ...priorBody, revision: args.prior.revision + 1, previous_revision_digest: revision_digest, concepts, groups,
    roots: buildRoots(args.input, groups), selection_mapping: args.prior.selection_mapping.filter(mapping =>
      concepts.some(concept => concept.concept_key === mapping.concept_key && concept.semantic_identity_digest === mapping.semantic_identity_digest)),
    unmapped_previous_selection: [...new Set([...args.prior.unmapped_previous_selection,
      ...args.prior.selection_mapping.filter(mapping => mapping.selected && !concepts.some(concept => concept.concept_key === mapping.concept_key
        && concept.semantic_identity_digest === mapping.semantic_identity_digest)).map(mapping => mapping.previous_term_key)])].sort(compare) };
  return { ...header, revision_digest: digest(header) };
}
