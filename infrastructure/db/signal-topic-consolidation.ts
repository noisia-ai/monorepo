import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";

export const SIGNAL_TOPIC_CONSOLIDATION_CONTRACT_V1 = "signal-topic-consolidation-v1" as const;
export const SIGNAL_TOPIC_CONSOLIDATION_DISPOSITIONS_V1 = ["topic", "narrative", "noise", "unresolved"] as const;
export type SignalTopicConsolidationDispositionV1 = typeof SIGNAL_TOPIC_CONSOLIDATION_DISPOSITIONS_V1[number];
export type SignalTopicConsolidationLaneV1 = "open" | "guided";
export type SignalTopicConsolidationConfigurationV1 = {
  contract_version: "signal-topic-consolidation-config-v1";
  dossier_version: "signal-topic-group-dossier-v1";
  representative_limit: 10; neighbor_limit: number;
  community_algorithm: "centroid-knn-v1"; neighbor_k: number; min_similarity_ppm: number;
  assignment_policy: "partition-all-groups-v1";
};

export type SignalTopicConsolidationEvidenceRefV1 = {
  ref_id: string; root_id: string; chunk_index: number; start: number; end: number;
  chunk_sha256: string; locale: string | null; platform: string | null; occurred_at: string | null;
};
export type SignalTopicConsolidationRootV1 = {
  root_id: string; chunk_count: number; strength: number | null; assignment_digest: string;
};
export type SignalTopicConsolidationDossierV1 = {
  contract_version: "signal-topic-group-dossier-v1";
  scope_counts: { brand: number; competitor: number; category: number; unknown: number };
  locale_counts: Array<{ key: string; count: number }>;
  platform_counts: Array<{ key: string; count: number }>;
  month_counts: Array<{ key: string; count: number }>;
  brand_affinity: {
    positive: Array<{ guide_key: string; score: number }>;
    negative: Array<{ guide_key: string; score: number }>;
    abstention: Array<{ guide_key: string; score: number }>;
  };
  neighbors: Array<{ group_key: string; similarity: number }>;
  metrics: { cohesion: number | null; outlier_ratio: number | null };
  evidence: SignalTopicConsolidationEvidenceRefV1[];
};
export type SignalTopicAtomicGroupV1 = {
  group_key: string; lane: SignalTopicConsolidationLaneV1; stable_cluster_id: string; local_label: number;
  group_digest: string; root_count: number; chunk_count: number; terms: string[];
  dossier: SignalTopicConsolidationDossierV1; dossier_digest: string;
  centroid: null | { artifact_id: string; artifact_sha256: string; centroid_key: string; centroid_digest: string };
  roots: SignalTopicConsolidationRootV1[];
};
export type SignalTopicAtomicCensusV1 = {
  contract_version: typeof SIGNAL_TOPIC_CONSOLIDATION_CONTRACT_V1;
  workspace_id: string; source_execution_id: string; source_checkpoint_digest: string;
  output_artifact_id: string; output_artifact_sha256: string;
  model_artifact_id: string; model_artifact_sha256: string;
  centroid_artifact_id: string | null; centroid_artifact_sha256: string | null;
  context_digest: string; configuration: SignalTopicConsolidationConfigurationV1;
  configuration_digest: string; expected_group_count: number;
  groups: SignalTopicAtomicGroupV1[];
};
export type SignalTopicConsolidationCommunityPlanV1 = {
  contract_version: "signal-topic-centroid-community-plan-v1"; configuration_digest: string;
  communities: Array<{ community_key: string; community_digest: string;
    members: Array<{ group_key: string; rank: number; similarity: number }> }>;
};
export type SignalTopicEditorialConceptV1 = {
  concept_key: string; kind: "topic" | "narrative"; label: string; definition: string;
  locale: string; source: "numeric" | "model" | "human";
};
export type SignalTopicConsolidationDecisionV1 = {
  group_key: string; disposition: SignalTopicConsolidationDispositionV1; concept_key: string | null;
  source: "numeric" | "model" | "human"; confidence: number | null; rationale: string | null;
};
export type SignalTopicConsolidationRevisionV1 = {
  contract_version: "signal-topic-consolidation-revision-v1"; revision: number;
  concepts: SignalTopicEditorialConceptV1[]; decisions: SignalTopicConsolidationDecisionV1[];
  revision_digest: string;
};

export class SignalTopicConsolidationContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SignalTopicConsolidationContractError"; }
}
export type SignalTopicConsolidationDatabaseV1 = Pick<Pool, "connect">;
export type SignalTopicConsolidationQueryableV1 = Pick<Pool, "query">;
export type SignalTopicConsolidationControlLeaseRefV1 = {
  execution_id: string; execution_token: string; workspace_id: string; actor_user_id: string;
};
const fail = (code: string): never => { throw new SignalTopicConsolidationContractError(code); };
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const object = (value: unknown, code: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail(code);
const exact = (value: Record<string, unknown>, keys: readonly string[], code: string) => {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(code);
};
const string = (value: unknown, code: string, max = 512) =>
  typeof value === "string" && value.trim() === value && value.length > 0 && Buffer.byteLength(value, "utf8") <= max ? value : fail(code);
const nullableString = (value: unknown, code: string, max = 512) => value === null ? null : string(value, code, max);
const uuid = (value: unknown, code: string) => { const parsed = string(value, code, 36); return uuidPattern.test(parsed) ? parsed.toLowerCase() : fail(code); };
const digest = (value: unknown, code: string) => { const parsed = string(value, code, 71); return digestPattern.test(parsed) ? parsed : fail(code); };
const natural = (value: unknown, code: string, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max ? value as number : fail(code);
const unit = (value: unknown, code: string) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fail(code);
const optionalUnit = (value: unknown, code: string) => value === null ? null : unit(value, code);
const array = (value: unknown, code: string, max: number) => Array.isArray(value) && value.length <= max ? value : fail(code);
const unique = (values: readonly string[], code: string) => { if (new Set(values).size !== values.length) fail(code); };
const asciiCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const lexical = <T>(values: T[], key: (value: T) => string) => values.sort((a, b) => asciiCompare(key(a), key(b)));

export function stableSignalTopicConsolidationJsonV1(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSignalTopicConsolidationJsonV1).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => asciiCompare(a, b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableSignalTopicConsolidationJsonV1(child)}`).join(",")}}`;
}
export function signalTopicConsolidationDigestV1(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableSignalTopicConsolidationJsonV1(value), "utf8").digest("hex")}`;
}

function parseCountEntries(value: unknown, code: string, max: number) {
  const result = array(value, code, max).map((item) => { const row = object(item, code); exact(row, ["key", "count"], code);
    return { key: string(row.key, code, 100), count: natural(row.count, code) }; });
  unique(result.map(item => item.key), code); return lexical(result, item => item.key);
}
function parseAffinities(value: unknown, code: string) {
  const result = array(value, code, 32).map((item) => { const row = object(item, code); exact(row, ["guide_key", "score"], code);
    return { guide_key: string(row.guide_key, code, 200), score: unit(row.score, code) }; });
  unique(result.map(item => item.guide_key), code);
  return result.sort((a, b) => b.score - a.score || asciiCompare(a.guide_key, b.guide_key));
}
function parseDossier(value: unknown, knownRoots: ReadonlyMap<string, SignalTopicConsolidationRootV1>, groupKey: string): SignalTopicConsolidationDossierV1 {
  const row = object(value, "topic_consolidation_dossier_invalid");
  exact(row, ["contract_version", "scope_counts", "locale_counts", "platform_counts", "month_counts", "brand_affinity", "neighbors", "metrics", "evidence"], "topic_consolidation_dossier_invalid");
  if (row.contract_version !== "signal-topic-group-dossier-v1") fail("topic_consolidation_dossier_invalid");
  const scope = object(row.scope_counts, "topic_consolidation_scope_invalid"); exact(scope, ["brand", "competitor", "category", "unknown"], "topic_consolidation_scope_invalid");
  const affinity = object(row.brand_affinity, "topic_consolidation_affinity_invalid"); exact(affinity, ["positive", "negative", "abstention"], "topic_consolidation_affinity_invalid");
  const metrics = object(row.metrics, "topic_consolidation_metrics_invalid"); exact(metrics, ["cohesion", "outlier_ratio"], "topic_consolidation_metrics_invalid");
  const neighbors = array(row.neighbors, "topic_consolidation_neighbors_invalid", 32).map(item => { const neighbor = object(item, "topic_consolidation_neighbors_invalid"); exact(neighbor, ["group_key", "similarity"], "topic_consolidation_neighbors_invalid");
    return { group_key: string(neighbor.group_key, "topic_consolidation_neighbors_invalid", 256), similarity: unit(neighbor.similarity, "topic_consolidation_neighbors_invalid") }; });
  unique(neighbors.map(item => item.group_key), "topic_consolidation_neighbors_invalid"); if (neighbors.some(item => item.group_key === groupKey)) fail("topic_consolidation_neighbors_invalid");
  const evidence = array(row.evidence, "topic_consolidation_evidence_invalid", 10).map(item => { const ref = object(item, "topic_consolidation_evidence_invalid");
    exact(ref, ["ref_id", "root_id", "chunk_index", "start", "end", "chunk_sha256", "locale", "platform", "occurred_at"], "topic_consolidation_evidence_invalid");
    const rootId = uuid(ref.root_id, "topic_consolidation_evidence_invalid"), root = knownRoots.get(rootId);
    const chunkIndex = natural(ref.chunk_index, "topic_consolidation_evidence_invalid");
    const start = natural(ref.start, "topic_consolidation_evidence_invalid"), end = natural(ref.end, "topic_consolidation_evidence_invalid");
    // chunk_index is the immutable index inside the canonical root, while the
    // stored root chunk_count is the number of that root's chunks assigned to
    // this atomic group. A root may span several groups, so these values are
    // intentionally not compared.
    if (!root || chunkIndex > 1_000_000 || end <= start) fail("topic_consolidation_evidence_invalid");
    const occurredAt = nullableString(ref.occurred_at, "topic_consolidation_evidence_invalid", 40);
    if (occurredAt !== null && !Number.isFinite(Date.parse(occurredAt))) fail("topic_consolidation_evidence_invalid");
    const chunkSha256 = digest(ref.chunk_sha256, "topic_consolidation_evidence_invalid"), refId = digest(ref.ref_id, "topic_consolidation_evidence_invalid");
    if (signalTopicConsolidationDigestV1({ root_id: rootId, chunk_index: chunkIndex, start, end, chunk_sha256: chunkSha256 }) !== refId)
      fail("topic_consolidation_evidence_invalid");
    return { ref_id: refId, root_id: rootId, chunk_index: chunkIndex, start, end,
      chunk_sha256: chunkSha256, locale: nullableString(ref.locale, "topic_consolidation_evidence_invalid", 35),
      platform: nullableString(ref.platform, "topic_consolidation_evidence_invalid", 100), occurred_at: occurredAt }; });
  unique(evidence.map(item => item.ref_id), "topic_consolidation_evidence_invalid");
  return { contract_version: "signal-topic-group-dossier-v1",
    scope_counts: { brand: natural(scope.brand, "topic_consolidation_scope_invalid"), competitor: natural(scope.competitor, "topic_consolidation_scope_invalid"),
      category: natural(scope.category, "topic_consolidation_scope_invalid"), unknown: natural(scope.unknown, "topic_consolidation_scope_invalid") },
    locale_counts: parseCountEntries(row.locale_counts, "topic_consolidation_locale_invalid", 64),
    platform_counts: parseCountEntries(row.platform_counts, "topic_consolidation_platform_invalid", 128),
    month_counts: parseCountEntries(row.month_counts, "topic_consolidation_month_invalid", 240),
    brand_affinity: { positive: parseAffinities(affinity.positive, "topic_consolidation_affinity_invalid"),
      negative: parseAffinities(affinity.negative, "topic_consolidation_affinity_invalid"), abstention: parseAffinities(affinity.abstention, "topic_consolidation_affinity_invalid") },
    neighbors: neighbors.sort((a,b) => b.similarity-a.similarity || asciiCompare(a.group_key,b.group_key)),
    metrics: { cohesion: optionalUnit(metrics.cohesion, "topic_consolidation_metrics_invalid"), outlier_ratio: optionalUnit(metrics.outlier_ratio, "topic_consolidation_metrics_invalid") },
    evidence };
}

function parseGroup(value: unknown): SignalTopicAtomicGroupV1 {
  const row = object(value, "topic_consolidation_group_invalid");
  exact(row, ["group_key", "lane", "stable_cluster_id", "local_label", "group_digest", "root_count", "chunk_count", "terms", "dossier", "dossier_digest", "centroid", "roots"], "topic_consolidation_group_invalid");
  const groupKey = string(row.group_key, "topic_consolidation_group_invalid", 256), lane = row.lane,
    stableClusterId = string(row.stable_cluster_id, "topic_consolidation_group_invalid", 180);
  if ((lane !== "open" && lane !== "guided") || !/^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u.test(groupKey)
    || groupKey !== `${lane}:${stableClusterId}`) fail("topic_consolidation_group_invalid");
  const roots = array(row.roots, "topic_consolidation_roots_invalid", 1_000_000).map(item => { const root = object(item, "topic_consolidation_roots_invalid");
    exact(root, ["root_id", "chunk_count", "strength", "assignment_digest"], "topic_consolidation_roots_invalid");
    return { root_id: uuid(root.root_id, "topic_consolidation_roots_invalid"), chunk_count: natural(root.chunk_count, "topic_consolidation_roots_invalid"),
      strength: optionalUnit(root.strength, "topic_consolidation_roots_invalid"), assignment_digest: digest(root.assignment_digest, "topic_consolidation_roots_invalid") }; });
  unique(roots.map(item => item.root_id), "topic_consolidation_roots_invalid"); lexical(roots, item => item.root_id);
  const rootCount = natural(row.root_count, "topic_consolidation_group_invalid"), chunkCount = natural(row.chunk_count, "topic_consolidation_group_invalid");
  if (roots.length !== rootCount || roots.reduce((sum, root) => sum + root.chunk_count, 0) !== chunkCount) fail("topic_consolidation_group_counts_invalid");
  const terms = array(row.terms, "topic_consolidation_terms_invalid", 64).map(term => string(term, "topic_consolidation_terms_invalid", 200)); unique(terms, "topic_consolidation_terms_invalid");
  const dossier = parseDossier(row.dossier, new Map(roots.map(root => [root.root_id, root])), groupKey);
  if (Object.values(dossier.scope_counts).reduce((sum, count) => sum + count, 0) !== rootCount) fail("topic_consolidation_scope_invalid");
  const dossierDigest = digest(row.dossier_digest, "topic_consolidation_dossier_digest_invalid");
  if (signalTopicConsolidationDigestV1(dossier) !== dossierDigest || Buffer.byteLength(stableSignalTopicConsolidationJsonV1(dossier), "utf8") > 131_072) fail("topic_consolidation_dossier_digest_invalid");
  let centroid: SignalTopicAtomicGroupV1["centroid"] = null;
  if (row.centroid !== null) { const ref = object(row.centroid, "topic_consolidation_centroid_invalid"); exact(ref, ["artifact_id", "artifact_sha256", "centroid_key", "centroid_digest"], "topic_consolidation_centroid_invalid");
    centroid = { artifact_id: uuid(ref.artifact_id, "topic_consolidation_centroid_invalid"), artifact_sha256: digest(ref.artifact_sha256, "topic_consolidation_centroid_invalid"),
      centroid_key: string(ref.centroid_key, "topic_consolidation_centroid_invalid", 256), centroid_digest: digest(ref.centroid_digest, "topic_consolidation_centroid_invalid") }; }
  return { group_key: groupKey, lane: lane as SignalTopicConsolidationLaneV1, stable_cluster_id: stableClusterId,
    local_label: natural(row.local_label, "topic_consolidation_group_invalid"), group_digest: digest(row.group_digest, "topic_consolidation_group_invalid"),
    root_count: rootCount, chunk_count: chunkCount, terms, dossier, dossier_digest: dossierDigest, centroid, roots };
}

export function parseSignalTopicAtomicCensusV1(value: unknown): SignalTopicAtomicCensusV1 {
  const row = object(value, "topic_consolidation_census_invalid");
  exact(row, ["contract_version", "workspace_id", "source_execution_id", "source_checkpoint_digest", "output_artifact_id", "output_artifact_sha256", "model_artifact_id", "model_artifact_sha256", "centroid_artifact_id", "centroid_artifact_sha256", "context_digest", "configuration", "configuration_digest", "expected_group_count", "groups"], "topic_consolidation_census_invalid");
  if (row.contract_version !== SIGNAL_TOPIC_CONSOLIDATION_CONTRACT_V1) fail("topic_consolidation_census_invalid");
  const configurationRow = object(row.configuration, "topic_consolidation_configuration_invalid");
  exact(configurationRow, ["contract_version", "dossier_version", "representative_limit", "neighbor_limit", "community_algorithm", "neighbor_k", "min_similarity_ppm", "assignment_policy"], "topic_consolidation_configuration_invalid");
  if (configurationRow.contract_version !== "signal-topic-consolidation-config-v1"
    || configurationRow.dossier_version !== "signal-topic-group-dossier-v1" || configurationRow.representative_limit !== 10
    || configurationRow.community_algorithm !== "centroid-knn-v1" || configurationRow.assignment_policy !== "partition-all-groups-v1") fail("topic_consolidation_configuration_invalid");
  const configuration: SignalTopicConsolidationConfigurationV1 = { contract_version: "signal-topic-consolidation-config-v1",
    dossier_version: "signal-topic-group-dossier-v1", representative_limit: 10,
    neighbor_limit: natural(configurationRow.neighbor_limit, "topic_consolidation_configuration_invalid", 32),
    community_algorithm: "centroid-knn-v1", neighbor_k: natural(configurationRow.neighbor_k, "topic_consolidation_configuration_invalid", 64),
    min_similarity_ppm: natural(configurationRow.min_similarity_ppm, "topic_consolidation_configuration_invalid", 1_000_000), assignment_policy: "partition-all-groups-v1" };
  if (configuration.neighbor_limit < 1 || configuration.neighbor_k < 1 || configuration.min_similarity_ppm < 1)
    fail("topic_consolidation_configuration_invalid");
  const configurationDigest = digest(row.configuration_digest, "topic_consolidation_census_invalid");
  if (signalTopicConsolidationDigestV1(configuration) !== configurationDigest) fail("topic_consolidation_configuration_digest_invalid");
  const groups = array(row.groups, "topic_consolidation_census_invalid", 100_000).map(parseGroup); lexical(groups, group => group.group_key);
  unique(groups.map(group => group.group_key), "topic_consolidation_groups_duplicate");
  const expected = natural(row.expected_group_count, "topic_consolidation_census_invalid"); if (groups.length !== expected) fail("topic_consolidation_census_incomplete");
  const keys = new Set(groups.map(group => group.group_key));
  if (groups.some(group => group.dossier.neighbors.some(neighbor => !keys.has(neighbor.group_key)))) fail("topic_consolidation_neighbor_unknown");
  const outputArtifactId = uuid(row.output_artifact_id, "topic_consolidation_census_invalid"), outputArtifactSha256 = digest(row.output_artifact_sha256, "topic_consolidation_census_invalid"),
    modelArtifactId = uuid(row.model_artifact_id, "topic_consolidation_census_invalid"), modelArtifactSha256 = digest(row.model_artifact_sha256, "topic_consolidation_census_invalid");
  const centroidArtifactId = row.centroid_artifact_id === null ? null : uuid(row.centroid_artifact_id, "topic_consolidation_census_invalid");
  const centroidArtifactSha256 = row.centroid_artifact_sha256 === null ? null : digest(row.centroid_artifact_sha256, "topic_consolidation_census_invalid");
  if ((centroidArtifactId === null) !== (centroidArtifactSha256 === null)) fail("topic_consolidation_centroid_lineage_invalid");
  if (groups.some(group => group.centroid !== null && !(
    group.centroid.artifact_id === centroidArtifactId && group.centroid.artifact_sha256 === centroidArtifactSha256)))
    fail("topic_consolidation_centroid_lineage_invalid");
  return { contract_version: SIGNAL_TOPIC_CONSOLIDATION_CONTRACT_V1, workspace_id: uuid(row.workspace_id, "topic_consolidation_census_invalid"),
    source_execution_id: uuid(row.source_execution_id, "topic_consolidation_census_invalid"), source_checkpoint_digest: digest(row.source_checkpoint_digest, "topic_consolidation_census_invalid"),
    output_artifact_id: outputArtifactId, output_artifact_sha256: outputArtifactSha256,
    model_artifact_id: modelArtifactId, model_artifact_sha256: modelArtifactSha256,
    centroid_artifact_id: centroidArtifactId, centroid_artifact_sha256: centroidArtifactSha256,
    context_digest: digest(row.context_digest, "topic_consolidation_census_invalid"), configuration,
    configuration_digest: configurationDigest,
    expected_group_count: expected, groups };
}

export function parseSignalTopicCommunityPlanV1(value: unknown, groupKeys: readonly string[]): SignalTopicConsolidationCommunityPlanV1 {
  const row = object(value, "topic_consolidation_communities_invalid"); exact(row, ["contract_version", "configuration_digest", "communities"], "topic_consolidation_communities_invalid");
  if (row.contract_version !== "signal-topic-centroid-community-plan-v1") fail("topic_consolidation_communities_invalid");
  const known = new Set(groupKeys), communities = array(row.communities, "topic_consolidation_communities_invalid", 100_000).map(item => { const community = object(item, "topic_consolidation_communities_invalid");
    exact(community, ["community_key", "community_digest", "members"], "topic_consolidation_communities_invalid");
    const members = array(community.members, "topic_consolidation_communities_invalid", 100_000).map(memberValue => { const member = object(memberValue, "topic_consolidation_communities_invalid");
      exact(member, ["group_key", "rank", "similarity"], "topic_consolidation_communities_invalid"); return { group_key: string(member.group_key, "topic_consolidation_communities_invalid", 256), rank: natural(member.rank, "topic_consolidation_communities_invalid"), similarity: unit(member.similarity, "topic_consolidation_communities_invalid") }; });
    unique(members.map(member => member.group_key), "topic_consolidation_communities_invalid");
    unique(members.map(member => String(member.rank)), "topic_consolidation_communities_invalid");
    const ordered = members.sort((a, b) => a.rank - b.rank || asciiCompare(a.group_key, b.group_key));
    const communityDigest = digest(community.community_digest, "topic_consolidation_communities_invalid");
    if (signalTopicConsolidationDigestV1({ members: ordered }) !== communityDigest) fail("topic_consolidation_community_digest_invalid");
    return { community_key: string(community.community_key, "topic_consolidation_communities_invalid", 256), community_digest: communityDigest, members: ordered }; });
  unique(communities.map(community => community.community_key), "topic_consolidation_communities_invalid");
  const assigned = communities.flatMap(community => community.members.map(member => member.group_key)); unique(assigned, "topic_consolidation_community_overlap");
  if (assigned.length !== known.size || assigned.some(key => !known.has(key))) fail("topic_consolidation_community_coverage_invalid");
  return { contract_version: "signal-topic-centroid-community-plan-v1", configuration_digest: digest(row.configuration_digest, "topic_consolidation_communities_invalid"),
    communities: lexical(communities, community => community.community_key) };
}

export function parseSignalTopicConsolidationRevisionV1(value: unknown, groupKeys: readonly string[]): SignalTopicConsolidationRevisionV1 {
  const row = object(value, "topic_consolidation_revision_invalid"); exact(row, ["contract_version", "revision", "concepts", "decisions", "revision_digest"], "topic_consolidation_revision_invalid");
  if (row.contract_version !== "signal-topic-consolidation-revision-v1") fail("topic_consolidation_revision_invalid");
  const concepts = array(row.concepts, "topic_consolidation_concepts_invalid", 100_000).map(item => { const concept = object(item, "topic_consolidation_concepts_invalid"); exact(concept, ["concept_key", "kind", "label", "definition", "locale", "source"], "topic_consolidation_concepts_invalid");
    if (concept.kind !== "topic" && concept.kind !== "narrative" || !["numeric", "model", "human"].includes(String(concept.source))) fail("topic_consolidation_concepts_invalid");
    return { concept_key: string(concept.concept_key, "topic_consolidation_concepts_invalid", 256), kind: concept.kind as SignalTopicEditorialConceptV1["kind"],
      label: string(concept.label, "topic_consolidation_concepts_invalid", 500), definition: string(concept.definition, "topic_consolidation_concepts_invalid", 4000),
      locale: string(concept.locale, "topic_consolidation_concepts_invalid", 35), source: concept.source as SignalTopicEditorialConceptV1["source"] }; });
  unique(concepts.map(concept => concept.concept_key), "topic_consolidation_concepts_invalid"); lexical(concepts, concept => concept.concept_key);
  const conceptMap = new Map(concepts.map(concept => [concept.concept_key, concept])), known = new Set(groupKeys);
  const decisions = array(row.decisions, "topic_consolidation_decisions_invalid", 100_000).map(item => { const decision = object(item, "topic_consolidation_decisions_invalid");
    exact(decision, ["group_key", "disposition", "concept_key", "source", "confidence", "rationale"], "topic_consolidation_decisions_invalid");
    const disposition = decision.disposition as SignalTopicConsolidationDispositionV1;
    if (!(SIGNAL_TOPIC_CONSOLIDATION_DISPOSITIONS_V1 as readonly unknown[]).includes(disposition) || !["numeric", "model", "human"].includes(String(decision.source))) fail("topic_consolidation_decisions_invalid");
    const conceptKey = nullableString(decision.concept_key, "topic_consolidation_decisions_invalid", 256), concept = conceptKey === null ? null : conceptMap.get(conceptKey);
    if ((disposition === "topic" || disposition === "narrative") ? concept?.kind !== disposition : conceptKey !== null) fail("topic_consolidation_decision_target_invalid");
    return { group_key: string(decision.group_key, "topic_consolidation_decisions_invalid", 256), disposition, concept_key: conceptKey,
      source: decision.source as SignalTopicConsolidationDecisionV1["source"], confidence: optionalUnit(decision.confidence, "topic_consolidation_decisions_invalid"),
      rationale: nullableString(decision.rationale, "topic_consolidation_decisions_invalid", 4000) }; });
  unique(decisions.map(decision => decision.group_key), "topic_consolidation_decisions_duplicate"); lexical(decisions, decision => decision.group_key);
  if (decisions.length !== known.size || decisions.some(decision => !known.has(decision.group_key))) fail("topic_consolidation_decisions_incomplete");
  const revision = natural(row.revision, "topic_consolidation_revision_invalid"); if (revision < 1) fail("topic_consolidation_revision_invalid");
  const revisionDigest = digest(row.revision_digest, "topic_consolidation_revision_digest_invalid");
  const body = { contract_version: "signal-topic-consolidation-revision-v1" as const, revision, concepts, decisions };
  if (signalTopicConsolidationDigestV1(body) !== revisionDigest) fail("topic_consolidation_revision_digest_invalid");
  return { ...body, revision_digest: revisionDigest };
}



export type SignalTopicConsolidationStoredArtifactV1 = {
  name: string; storage_key: string; sha256: string; size_bytes: number; media_type: string;
};
export type SignalTopicConsolidationSourceV1 = {
  workspace_id: string; source_execution_id: string; actor_user_id: string;
  embedding_run_id: string; embedding_config_digest: string;
  source_checkpoint_digest: string; context_digest: string; expected_group_count: number;
  output_artifact_id: string; output_artifact_sha256: string;
  model_artifact_id: string; model_artifact_sha256: string;
  bundle: SignalTopicConsolidationStoredArtifactV1[];
};
export type SignalTopicConsolidationRootMetadataV1 = {
  root_id: string; scope: "brand" | "competitor" | "category" | "unknown";
  locale: string | null; platform: string | null; occurred_at: string | null;
};

const artifactNamePattern = /^[a-z][a-z0-9_.-]{0,100}$/u;
const mediaTypePattern = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;
function parseStoredArtifact(value: unknown): SignalTopicConsolidationStoredArtifactV1 {
  const row = object(value, "topic_consolidation_bundle_invalid");
  exact(row, ["name", "storage_key", "sha256", "size_bytes", "media_type"], "topic_consolidation_bundle_invalid");
  const name = string(row.name, "topic_consolidation_bundle_invalid", 101);
  const mediaType = string(row.media_type, "topic_consolidation_bundle_invalid", 120);
  if (!artifactNamePattern.test(name) || name.includes("..") || !mediaTypePattern.test(mediaType))
    fail("topic_consolidation_bundle_invalid");
  return { name, storage_key: string(row.storage_key, "topic_consolidation_bundle_invalid", 1024),
    sha256: digest(row.sha256, "topic_consolidation_bundle_invalid"),
    size_bytes: natural(row.size_bytes, "topic_consolidation_bundle_invalid", 2 ** 40), media_type: mediaType };
}

/** Resolves only the immutable numerical receipts of an existing fit. A failed
 * editorial phase remains eligible because it does not invalidate the sealed
 * BERTopic output; no provider admission or cost authority is consulted. */
export async function loadSignalTopicConsolidationSourceV1(args: {
  queryable: SignalTopicConsolidationQueryableV1; source_execution_id: string;
  control_execution?: SignalTopicConsolidationControlLeaseRefV1;
}): Promise<SignalTopicConsolidationSourceV1> {
  const executionId = uuid(args.source_execution_id, "topic_consolidation_execution_invalid");
  const control = args.control_execution ? {
    execution_id: uuid(args.control_execution.execution_id,"topic_consolidation_control_invalid"),
    execution_token: uuid(args.control_execution.execution_token,"topic_consolidation_control_invalid"),
    workspace_id: uuid(args.control_execution.workspace_id,"topic_consolidation_control_invalid"),
    actor_user_id: uuid(args.control_execution.actor_user_id,"topic_consolidation_control_invalid"),
  } : null;
  const row = (await args.queryable.query<{
    workspace_id: string; actor_user_id: string; embedding_run_id: string; embedding_config_digest: string;
    input_snapshot: Record<string, unknown>;
    result_summary: Record<string, unknown>; output_artifact_id: string; output_content: Record<string, unknown>;
    output_metadata: Record<string, unknown>; model_artifact_id: string; model_content: Record<string, unknown>;
  }>(`SELECT execution.workspace_id,execution.actor_user_id,execution.embedding_run_id,execution.embedding_config_digest,
      execution.input_snapshot,execution.result_summary,
      output.id output_artifact_id,output.content output_content,output.metadata output_metadata,
      model.id model_artifact_id,model.content model_content
    FROM signal_topic_catalog_executions execution
    JOIN signal_workspace_embedding_runs embedding ON embedding.id=execution.embedding_run_id
      AND embedding.workspace_id=execution.workspace_id AND embedding.config_digest=execution.embedding_config_digest
      AND embedding.status='completed'
    JOIN analysis_artifacts output ON output.id=NULLIF(execution.result_summary->'fit_checkpoint'->>'output_artifact_id','')::uuid
      AND output.engine_execution_id=execution.id AND output.workspace_id=execution.workspace_id
      AND output.artifact_type='engine_output' AND output.artifact_key='manifest.json'
    JOIN analysis_artifacts model ON model.id=NULLIF(execution.result_summary->'fit_checkpoint'->>'model_artifact_id','')::uuid
      AND model.engine_execution_id=execution.id AND model.workspace_id=execution.workspace_id
      AND model.artifact_type='engine_model' AND model.artifact_key='model-manifest.json'
    WHERE execution.id=$1::uuid AND execution.input_contract='workspace-topic-engine-v1'`, [executionId])).rows[0];
  const source = row ?? fail("topic_consolidation_source_unavailable");
  if (control && control.workspace_id !== source.workspace_id) fail("topic_consolidation_control_invalid");
  const authorityActor = control?.actor_user_id ?? source.actor_user_id;
  await requireConsolidationAuthority(args.queryable,source.workspace_id,authorityActor,executionId,control ?? undefined);
  const summary = object(source.result_summary, "topic_consolidation_source_invalid");
  const checkpoint = object(summary.fit_checkpoint, "topic_consolidation_source_invalid");
  const manifest = object(checkpoint.interpretation_manifest, "topic_consolidation_source_invalid");
  const input = object(source.input_snapshot, "topic_consolidation_source_invalid");
  const output = object(source.output_content, "topic_consolidation_source_invalid");
  const model = object(source.model_content, "topic_consolidation_source_invalid");
  if (output.contract_version !== "workspace-engine-private-artifact-v1"
    || model.contract_version !== "workspace-engine-private-artifact-v1") fail("topic_consolidation_source_invalid");
  const bundleRaw = object(source.output_metadata, "topic_consolidation_source_invalid").bundle;
  const bundle = array(bundleRaw, "topic_consolidation_bundle_invalid", 34).map(parseStoredArtifact);
  unique(bundle.map(item => item.name), "topic_consolidation_bundle_invalid");
  for (const required of ["manifest.json", "model-manifest.json", "population.jsonl", "assignments.open.jsonl", "clusters.open.json"])
    if (!bundle.some(item => item.name === required)) fail("topic_consolidation_bundle_incomplete");
  const outputRef = bundle.find(item => item.name === "manifest.json")!;
  const modelRef = bundle.find(item => item.name === "model-manifest.json")!;
  if (output.sha256 !== outputRef.sha256 || output.storage_key !== outputRef.storage_key
    || output.size_bytes !== outputRef.size_bytes || output.media_type !== outputRef.media_type
    || model.sha256 !== modelRef.sha256 || model.storage_key !== modelRef.storage_key
    || model.size_bytes !== modelRef.size_bytes || model.media_type !== modelRef.media_type)
    fail("topic_consolidation_artifact_receipt_mismatch");
  return { workspace_id: uuid(source.workspace_id, "topic_consolidation_source_invalid"), source_execution_id: executionId,
    actor_user_id: uuid(authorityActor, "topic_consolidation_source_invalid"),
    embedding_run_id: uuid(source.embedding_run_id, "topic_consolidation_source_invalid"),
    embedding_config_digest: digest(source.embedding_config_digest, "topic_consolidation_source_invalid"),
    source_checkpoint_digest: digest(checkpoint.checkpoint_digest, "topic_consolidation_source_invalid"),
    context_digest: digest(input.context_digest, "topic_consolidation_source_invalid"),
    expected_group_count: natural(manifest.unit_count, "topic_consolidation_source_invalid", 100_000),
    output_artifact_id: uuid(source.output_artifact_id, "topic_consolidation_source_invalid"),
    output_artifact_sha256: digest(output.sha256, "topic_consolidation_source_invalid"),
    model_artifact_id: uuid(source.model_artifact_id, "topic_consolidation_source_invalid"),
    model_artifact_sha256: digest(model.sha256, "topic_consolidation_source_invalid"), bundle };
}

/** Reads presentation metadata for exact canonical roots. Multiple conflicting
 * acquisition scopes are reported as unknown so a dossier never fabricates a
 * dominant scope. */
export async function loadSignalTopicConsolidationRootMetadataV1(args: {
  queryable: SignalTopicConsolidationQueryableV1; workspace_id: string; root_ids: readonly string[];
}): Promise<SignalTopicConsolidationRootMetadataV1[]> {
  const workspace = uuid(args.workspace_id, "topic_consolidation_workspace_invalid");
  if (args.root_ids.length < 1 || args.root_ids.length > 2_000) fail("topic_consolidation_root_page_invalid");
  const roots = args.root_ids.map(value => uuid(value, "topic_consolidation_root_invalid"));
  unique(roots, "topic_consolidation_root_page_invalid");
  const rows = (await args.queryable.query<{ root_id: string; locale: string | null; platform: string | null;
    occurred_at: string; scopes: string[] }>(`WITH requested AS (SELECT unnest($2::uuid[]) root_id), metadata AS (
      SELECT requested.root_id,mention.language::text locale,COALESCE(mention.resolved_platform,mention.platform) platform,
        mention.published_at occurred_at,
        array_remove(array_agg(DISTINCT COALESCE(slot.scope,
          CASE WHEN batch.entity_kind='primary_brand' OR batch.mention_type='brand' THEN 'primary_brand'
            WHEN batch.entity_kind IN('competitor','competitor_pool') OR batch.mention_type='competitor' THEN 'competitor'
            WHEN batch.entity_kind='category' OR batch.mention_type='industry' THEN 'category' END)),NULL) scopes
      FROM requested JOIN mentions mention ON mention.id=requested.root_id AND mention.workspace_id=$1::uuid
        AND mention.canonical_mention_id=mention.id
      LEFT JOIN signal_mention_import_memberships membership ON membership.workspace_id=mention.workspace_id
        AND membership.mention_id=mention.id
      LEFT JOIN import_batches batch ON batch.id=membership.import_batch_id AND batch.workspace_id=mention.workspace_id
      LEFT JOIN signal_acquisition_slots slot ON slot.id=batch.acquisition_slot_id AND slot.workspace_id=batch.workspace_id
      GROUP BY requested.root_id,mention.language,COALESCE(mention.resolved_platform,mention.platform),mention.published_at)
    SELECT root_id,locale,platform,occurred_at,scopes FROM metadata ORDER BY root_id`, [workspace, roots])).rows;
  if (rows.length !== roots.length || rows.some(row => !roots.includes(row.root_id))) fail("topic_consolidation_root_metadata_incomplete");
  return rows.map(row => { const scopes = [...new Set(row.scopes ?? [])].sort(asciiCompare);
    return { root_id: uuid(row.root_id, "topic_consolidation_root_invalid"),
      scope: scopes.length === 1 ? scopes[0] === "primary_brand" ? "brand" : scopes[0] === "competitor" ? "competitor"
        : scopes[0] === "category" ? "category" : "unknown" : "unknown",
      locale: row.locale === null ? null : string(row.locale, "topic_consolidation_root_metadata_invalid", 35),
      platform: row.platform === null ? null : string(row.platform, "topic_consolidation_root_metadata_invalid", 100),
      occurred_at: new Date(row.occurred_at).toISOString() } as SignalTopicConsolidationRootMetadataV1; });
}

export type SignalTopicConsolidationCentroidMembershipV1 = {
  group_key: string; ordinal: number; chunk_sha256: string;
};
export type SignalTopicConsolidationCentroidV1 = {
  group_key: string; vector: number[]; centroid_digest: string;
  neighbors: Array<{ group_key: string; similarity: number }>;
  brand_affinity: SignalTopicConsolidationDossierV1["brand_affinity"];
};

const parseVectorText = (value: string): number[] => {
  if (value.length > 32_000 || value[0] !== "[" || value.at(-1) !== "]") fail("topic_consolidation_centroid_invalid");
  const vector = value.slice(1, -1).split(",").map(Number);
  if (vector.length !== 1024 || vector.some(item => !Number.isFinite(item))) fail("topic_consolidation_centroid_invalid");
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!(norm > 0) || !Number.isFinite(norm)) fail("topic_consolidation_centroid_invalid");
  return vector.map(item => item / norm);
};

/** Reuses the exact cached document embeddings sealed by the source execution.
 * Each occurrence remains weighted exactly as it was in the fit, including
 * duplicate chunk hashes from different roots. PostgreSQL performs the bounded
 * vector aggregation and exact kNN; no provider transport is reachable here. */
export async function computeSignalTopicConsolidationCentroidsV1(args: {
  database: SignalTopicConsolidationDatabaseV1; workspace_id: string; actor_user_id: string;
  source_execution_id: string; embedding_run_id: string; embedding_config_digest: string;
  memberships: readonly SignalTopicConsolidationCentroidMembershipV1[]; neighbor_k: number;
  control_execution?: SignalTopicConsolidationControlLeaseRefV1;
}): Promise<SignalTopicConsolidationCentroidV1[]> {
  const workspace = uuid(args.workspace_id, "topic_consolidation_workspace_invalid");
  const actor = uuid(args.actor_user_id, "topic_consolidation_actor_invalid");
  const execution = uuid(args.source_execution_id, "topic_consolidation_execution_invalid");
  const embeddingRun = uuid(args.embedding_run_id, "topic_consolidation_embedding_run_invalid");
  const config = digest(args.embedding_config_digest, "topic_consolidation_embedding_config_invalid");
  const neighborK = natural(args.neighbor_k, "topic_consolidation_neighbor_invalid", 64);
  if (neighborK < 1 || args.memberships.length < 1 || args.memberships.length > 2_000_000)
    fail("topic_consolidation_centroid_memberships_invalid");
  const seen = new Set<string>();
  const memberships = args.memberships.map(item => {
    const group_key = string(item.group_key, "topic_consolidation_centroid_memberships_invalid", 256);
    const ordinal = natural(item.ordinal, "topic_consolidation_centroid_memberships_invalid", 10_000_000);
    const chunk_sha256 = digest(item.chunk_sha256, "topic_consolidation_centroid_memberships_invalid");
    const key = `${group_key}\0${ordinal}`; if (seen.has(key)) fail("topic_consolidation_centroid_memberships_invalid"); seen.add(key);
    return { group_key, ordinal, chunk_sha256 };
  });
  if (new Set(memberships.map(item => item.group_key)).size > 5_000)
    fail("topic_consolidation_exact_knn_capacity_exceeded");
  return transaction(args.database, async client => {
    if (args.control_execution) {
      await requireConsolidationReadLease(client, workspace, actor, execution, args.control_execution);
    } else {
      await requireConsolidationAuthority(client, workspace, actor, execution);
    }
    await client.query("SET LOCAL statement_timeout='120s'");
    const valid = (await client.query<{ valid: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM signal_topic_catalog_executions execution
      JOIN signal_workspace_embedding_runs embedding ON embedding.id=$4::uuid AND embedding.workspace_id=execution.workspace_id
        AND embedding.config_digest=$5 AND embedding.status='completed'
      WHERE execution.id=$2::uuid AND execution.workspace_id=$1::uuid
        AND ($6::boolean OR execution.actor_user_id=$3::uuid)
        AND execution.embedding_run_id=embedding.id AND execution.embedding_config_digest=embedding.config_digest
        AND execution.result_summary ? 'fit_checkpoint') valid`, [workspace,execution,actor,embeddingRun,config,Boolean(args.control_execution)])).rows[0]?.valid;
    if (valid !== true) fail("topic_consolidation_embedding_source_invalid");
    await client.query(`CREATE TEMP TABLE signal_topic_centroid_memberships_tmp(
      group_key text NOT NULL,ordinal integer NOT NULL,chunk_sha256 text NOT NULL,PRIMARY KEY(group_key,ordinal)) ON COMMIT DROP`);
    for (const page of chunks(memberships, 2_000)) await client.query(`INSERT INTO signal_topic_centroid_memberships_tmp(group_key,ordinal,chunk_sha256)
      SELECT body.group_key,body.ordinal,body.chunk_sha256 FROM jsonb_to_recordset($1::jsonb)
        body(group_key text,ordinal integer,chunk_sha256 text)`, [JSON.stringify(page)]);
    await client.query(`CREATE TEMP TABLE signal_topic_centroids_tmp ON COMMIT DROP AS
      SELECT member.group_key,count(*)::integer assignment_count,count(cache.embedding)::integer embedding_count,
        avg(cache.embedding)::vector(1024) centroid
      FROM signal_topic_centroid_memberships_tmp member
      LEFT JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=$1::uuid AND cache.config_digest=$2
        AND cache.chunk_sha256=member.chunk_sha256 GROUP BY member.group_key`, [workspace,config]);
    const missing = (await client.query<{ missing: string }>(`SELECT COALESCE(sum(assignment_count-embedding_count),0)::text missing
      FROM signal_topic_centroids_tmp`)).rows[0]?.missing;
    if (missing !== "0") fail("topic_consolidation_embedding_coverage_incomplete");
    const centroids = (await client.query<{ group_key: string; centroid: string }>(`
      SELECT group_key,centroid::text FROM signal_topic_centroids_tmp ORDER BY group_key COLLATE "C"`)).rows;
    const neighbors = (await client.query<{ group_key: string; neighbor_key: string; similarity: number }>(`
      SELECT source.group_key,target.group_key neighbor_key,GREATEST(0,LEAST(1,1-(target.centroid <=> source.centroid)))::double precision similarity
      FROM signal_topic_centroids_tmp source CROSS JOIN LATERAL (
        SELECT candidate.group_key,candidate.centroid FROM signal_topic_centroids_tmp candidate
        WHERE candidate.group_key<>source.group_key ORDER BY candidate.centroid <=> source.centroid,candidate.group_key COLLATE "C"
      LIMIT $1) target ORDER BY source.group_key COLLATE "C",similarity DESC,target.group_key COLLATE "C"`, [neighborK])).rows;
    const guides = (await client.query<{ group_key: string; guide_key: string; role: string; similarity: number }>(`
      WITH guide_vectors AS MATERIALIZED (
        SELECT guide.guide_key,guide.role,cache.embedding
        FROM signal_topic_catalog_executions execution
        CROSS JOIN LATERAL jsonb_to_recordset(execution.input_snapshot->'guides')
          guide(guide_key text,role text,input_digest text,text_sha256 text)
        JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=execution.workspace_id
          AND cache.config_digest=execution.embedding_config_digest AND cache.chunk_sha256=guide.text_sha256
        WHERE execution.id=$1::uuid AND guide.role IN('topic_positive','topic_negative','scope_positive','scope_negative')
      )
      SELECT source.group_key,guide.guide_key,guide.role,
        GREATEST(0,LEAST(1,1-(guide.embedding <=> source.centroid)))::double precision similarity
      FROM signal_topic_centroids_tmp source CROSS JOIN guide_vectors guide
      ORDER BY source.group_key COLLATE "C",guide.guide_key COLLATE "C",guide.role COLLATE "C"`,[execution])).rows;
    const byGroup = new Map<string, Array<{ group_key: string; similarity: number }>>();
    for (const row of neighbors) { const list = byGroup.get(row.group_key) ?? [];
      list.push({ group_key: row.neighbor_key, similarity: Number(row.similarity) }); byGroup.set(row.group_key,list); }
    type AffinityLane = keyof SignalTopicConsolidationDossierV1["brand_affinity"];
    const affinityByGroup = new Map<string,Record<AffinityLane,Map<string,number>>>();
    const lane = (role: string): AffinityLane => role === "scope_negative" ? "abstention"
      : role === "topic_negative" ? "negative" : "positive";
    for (const row of guides) {
      const buckets = affinityByGroup.get(row.group_key) ?? { positive:new Map(),negative:new Map(),abstention:new Map() };
      const bucket = buckets[lane(row.role)], score = unit(Number(row.similarity),"topic_consolidation_affinity_invalid");
      bucket.set(row.guide_key,Math.max(bucket.get(row.guide_key) ?? 0,score));
      affinityByGroup.set(row.group_key,buckets);
    }
    const ranked = (values: Map<string,number> | undefined) => [...(values ?? new Map())]
      .map(([guide_key,score])=>({guide_key,score})).sort((a,b)=>b.score-a.score||asciiCompare(a.guide_key,b.guide_key)).slice(0,8);
    return centroids.map(row => { const vector = parseVectorText(row.centroid);
      const affinity=affinityByGroup.get(row.group_key);
      return { group_key: row.group_key, vector, centroid_digest: signalTopicConsolidationDigestV1(vector),
        neighbors: byGroup.get(row.group_key) ?? [],brand_affinity:{positive:ranked(affinity?.positive),
          negative:ranked(affinity?.negative),abstention:ranked(affinity?.abstention)} }; });
  });
}

export async function persistSignalTopicConsolidationCentroidArtifactV1(args: {
  database: SignalTopicConsolidationDatabaseV1; workspace_id: string; actor_user_id: string; source_execution_id: string;
  source_checkpoint_digest: string; artifact: SignalTopicConsolidationStoredArtifactV1;
  centroid_count: number; centroid_set_digest: string;
  control_execution?: SignalTopicConsolidationControlLeaseRefV1;
}): Promise<{ artifact_id: string; replayed: boolean }> {
  const workspace = uuid(args.workspace_id, "topic_consolidation_workspace_invalid"), actor = uuid(args.actor_user_id, "topic_consolidation_actor_invalid"),
    execution = uuid(args.source_execution_id, "topic_consolidation_execution_invalid"), checkpoint = digest(args.source_checkpoint_digest, "topic_consolidation_source_invalid"),
    count = natural(args.centroid_count, "topic_consolidation_centroid_invalid", 100_000), setDigest = digest(args.centroid_set_digest, "topic_consolidation_centroid_invalid");
  const artifact = parseStoredArtifact(args.artifact);
  if (artifact.name !== `centroids.consolidation.${setDigest.slice(7,23)}.json` || artifact.media_type !== "application/json")
    fail("topic_consolidation_centroid_artifact_invalid");
  return transaction(args.database, async client => {
    await requireConsolidationAuthority(client,workspace,actor,execution,args.control_execution);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`topic-consolidation-artifact:${workspace}:${execution}:${artifact.name}`]);
    const metadata = { contract_version: "signal-topic-centroid-artifact-v1", source_checkpoint_digest: checkpoint,
      centroid_count: count, centroid_set_digest: setDigest, dimensions: 1024, aggregation: "normalized-mean-document-embeddings-v1" };
    const prior = (await client.query<{ id: string; storage_key: string; sha256: string; size_bytes: string; media_type: string; metadata: unknown }>(
      `SELECT id,storage_key,sha256,size_bytes::text,media_type,metadata FROM signal_topic_consolidation_artifacts
      WHERE source_engine_execution_id=$1::uuid AND workspace_id=$2::uuid AND artifact_key=$3`,[execution,workspace,artifact.name])).rows[0];
    if (prior) {
      if (prior.storage_key !== artifact.storage_key || prior.sha256 !== artifact.sha256
        || prior.size_bytes !== String(artifact.size_bytes) || prior.media_type !== artifact.media_type
        || signalTopicConsolidationDigestV1(prior.metadata) !== signalTopicConsolidationDigestV1(metadata))
        fail("topic_consolidation_centroid_artifact_conflict");
      return { artifact_id: prior.id, replayed: true };
    }
    const inserted = (await client.query<{ id: string }>(`INSERT INTO signal_topic_consolidation_artifacts(workspace_id,
      source_engine_execution_id,source_checkpoint_digest,artifact_key,storage_key,sha256,size_bytes,media_type,metadata)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id`,
    [workspace,execution,checkpoint,artifact.name,artifact.storage_key,artifact.sha256,artifact.size_bytes,artifact.media_type,JSON.stringify(metadata)])).rows[0];
    const saved = inserted ?? fail("topic_consolidation_centroid_artifact_invalid");
    return { artifact_id: saved.id, replayed: false };
  });
}

const transaction = async <T>(database: SignalTopicConsolidationDatabaseV1, work: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await database.connect();
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const result = await work(client); await client.query("COMMIT"); return result;
  } catch (caught) { await client.query("ROLLBACK"); throw caught; } finally { client.release(); }
};
const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const pages: T[][] = []; for (let offset = 0; offset < items.length; offset += size) pages.push(items.slice(offset, offset + size)); return pages;
};
async function requireConsolidationAuthority(client: SignalTopicConsolidationQueryableV1, workspace_id: string, actor_user_id: string,
  source_execution_id?: string, control_execution?: SignalTopicConsolidationControlLeaseRefV1) {
  if (!control_execution) {
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id, actor_user_id });
    if (!capabilities.can_execute_topics) fail("topic_consolidation_forbidden");
    return;
  }
  const control = { execution_id: uuid(control_execution.execution_id,"topic_consolidation_control_invalid"),
    execution_token: uuid(control_execution.execution_token,"topic_consolidation_control_invalid"),
    workspace_id: uuid(control_execution.workspace_id,"topic_consolidation_control_invalid"),
    actor_user_id: uuid(control_execution.actor_user_id,"topic_consolidation_control_invalid") };
  const sourceExecution = source_execution_id ? uuid(source_execution_id,"topic_consolidation_control_invalid") : null;
  if (!sourceExecution || control.workspace_id !== workspace_id || control.actor_user_id !== actor_user_id
  ) fail("topic_consolidation_control_invalid");
  await client.query(`SELECT assert_signal_topic_consolidation_worker_scope_v1(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid
  )`,[control.execution_id,control.execution_token,workspace_id,actor_user_id,sourceExecution]);
}

async function requireConsolidationReadLease(client: SignalTopicConsolidationQueryableV1, workspace_id: string, actor_user_id: string,
  source_execution_id: string, control_execution: SignalTopicConsolidationControlLeaseRefV1) {
  const control = { execution_id: uuid(control_execution.execution_id,"topic_consolidation_control_invalid"),
    execution_token: uuid(control_execution.execution_token,"topic_consolidation_control_invalid"),
    workspace_id: uuid(control_execution.workspace_id,"topic_consolidation_control_invalid"),
    actor_user_id: uuid(control_execution.actor_user_id,"topic_consolidation_control_invalid") };
  const sourceExecution = uuid(source_execution_id,"topic_consolidation_control_invalid");
  if (control.workspace_id !== workspace_id || control.actor_user_id !== actor_user_id)
    fail("topic_consolidation_control_invalid");
  await client.query(`SELECT assert_signal_topic_consolidation_worker_lease_v1(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid
  )`,[control.execution_id,control.execution_token,workspace_id,actor_user_id,sourceExecution]);
}

/**
 * Atomically normalizes a sealed fit census. Raw text and vectors are never
 * accepted by the contract; the stored rows retain governed locators and
 * references to the existing fit artifacts.
 */
export async function materializeSignalTopicAtomicCensusV1(args: {
  database: SignalTopicConsolidationDatabaseV1; actor_user_id: string; census: unknown;
  control_execution?: SignalTopicConsolidationControlLeaseRefV1;
}): Promise<{ consolidation_run_id: string; group_count: number; root_count: number; evidence_count: number; replayed: boolean }> {
  const census = parseSignalTopicAtomicCensusV1(args.census), actor = uuid(args.actor_user_id, "topic_consolidation_actor_invalid");
  const censusDigest = signalTopicConsolidationDigestV1(census);
  return transaction(args.database, async client => {
    await requireConsolidationAuthority(client,census.workspace_id,actor,census.source_execution_id,args.control_execution);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`topic-consolidation:${census.workspace_id}:${census.source_execution_id}`]);
    const inserted = (await client.query<{ id: string }>(`INSERT INTO signal_topic_consolidation_runs(
      workspace_id,source_engine_execution_id,actor_user_id,source_checkpoint_digest,output_artifact_id,output_artifact_sha256,
      model_artifact_id,model_artifact_sha256,centroid_artifact_id,centroid_artifact_sha256,context_digest,census_digest,configuration,configuration_digest,expected_group_count)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8,$9::uuid,$10,$11,$12,$13::jsonb,$14,$15)
      ON CONFLICT(workspace_id,source_engine_execution_id,configuration_digest) DO NOTHING RETURNING id`,
    [census.workspace_id,census.source_execution_id,actor,census.source_checkpoint_digest,census.output_artifact_id,census.output_artifact_sha256,
      census.model_artifact_id,census.model_artifact_sha256,census.centroid_artifact_id,census.centroid_artifact_sha256,
      census.context_digest,censusDigest,JSON.stringify(census.configuration),census.configuration_digest,census.expected_group_count])).rows[0];
    if (!inserted) {
      const prior = (await client.query<{ id: string; status: string; source_checkpoint_digest: string; output_artifact_sha256: string;
        model_artifact_sha256: string; context_digest: string; census_digest: string; expected_group_count: number; group_count: number; root_count: number; evidence_count: number }>(`
        SELECT run.id,run.status,run.source_checkpoint_digest,run.output_artifact_sha256,run.model_artifact_sha256,run.context_digest,run.census_digest,
          run.expected_group_count,(SELECT count(*)::integer FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=run.id) group_count,
          (SELECT count(*)::integer FROM signal_topic_atomic_group_roots r WHERE r.consolidation_run_id=run.id) root_count,
          (SELECT count(*)::integer FROM signal_topic_atomic_group_evidence e WHERE e.consolidation_run_id=run.id) evidence_count
        FROM signal_topic_consolidation_runs run WHERE run.workspace_id=$1::uuid AND run.source_engine_execution_id=$2::uuid
          AND run.configuration_digest=$3 FOR UPDATE`,[census.workspace_id,census.source_execution_id,census.configuration_digest])).rows[0];
      if (!prior) throw new SignalTopicConsolidationContractError("topic_consolidation_replay_conflict");
      if (prior.status === "building" || prior.source_checkpoint_digest !== census.source_checkpoint_digest
        || prior.output_artifact_sha256 !== census.output_artifact_sha256 || prior.model_artifact_sha256 !== census.model_artifact_sha256
        || prior.context_digest !== census.context_digest || prior.census_digest !== censusDigest || prior.expected_group_count !== census.expected_group_count
        || prior.group_count !== census.expected_group_count) fail("topic_consolidation_replay_conflict");
      return { consolidation_run_id: prior.id, group_count: prior.group_count, root_count: prior.root_count,
        evidence_count: prior.evidence_count, replayed: true };
    }
    const groupIds = new Map(census.groups.map(group => [group.group_key, randomUUID()]));
    for (const page of chunks(census.groups, 128)) {
      const records = page.map(group => ({ id: groupIds.get(group.group_key), group_key: group.group_key, lane: group.lane,
        stable_cluster_id: group.stable_cluster_id, local_label: group.local_label, group_digest: group.group_digest,
        root_count: group.root_count, chunk_count: group.chunk_count, terms: group.terms, dossier: group.dossier,
        dossier_digest: group.dossier_digest, centroid_artifact_id: group.centroid?.artifact_id ?? null,
        centroid_key: group.centroid?.centroid_key ?? null, centroid_digest: group.centroid?.centroid_digest ?? null }));
      await client.query(`INSERT INTO signal_topic_atomic_groups(id,consolidation_run_id,workspace_id,source_engine_execution_id,
        group_key,lane,stable_cluster_id,local_label,group_digest,root_count,chunk_count,terms,dossier,dossier_digest,
        centroid_artifact_id,centroid_key,centroid_digest)
        SELECT (body->>'id')::uuid,$1::uuid,$2::uuid,$3::uuid,body->>'group_key',body->>'lane',body->>'stable_cluster_id',
          (body->>'local_label')::integer,body->>'group_digest',(body->>'root_count')::integer,(body->>'chunk_count')::integer,
          ARRAY(SELECT jsonb_array_elements_text(body->'terms')),body->'dossier',body->>'dossier_digest',
          NULLIF(body->>'centroid_artifact_id','')::uuid,body->>'centroid_key',body->>'centroid_digest'
        FROM jsonb_array_elements($4::jsonb) body`,[inserted.id,census.workspace_id,census.source_execution_id,JSON.stringify(records)]);
    }
    const roots = census.groups.flatMap(group => group.roots.map(root => ({ atomic_group_id: groupIds.get(group.group_key), ...root })));
    for (const page of chunks(roots, 2_000)) await client.query(`INSERT INTO signal_topic_atomic_group_roots(
      atomic_group_id,consolidation_run_id,workspace_id,canonical_root_id,chunk_count,strength,assignment_digest)
      SELECT (body->>'atomic_group_id')::uuid,$1::uuid,$2::uuid,(body->>'root_id')::uuid,(body->>'chunk_count')::integer,
        NULLIF(body->>'strength','')::double precision,body->>'assignment_digest' FROM jsonb_array_elements($3::jsonb) body`,
    [inserted.id,census.workspace_id,JSON.stringify(page)]);
    const evidence = census.groups.flatMap(group => group.dossier.evidence.map((item, evidence_ordinal) =>
      ({ atomic_group_id: groupIds.get(group.group_key), evidence_ordinal, ...item })));
    for (const page of chunks(evidence, 2_000)) await client.query(`INSERT INTO signal_topic_atomic_group_evidence(
      atomic_group_id,canonical_root_id,consolidation_run_id,workspace_id,evidence_ordinal,ref_id,chunk_index,start_offset,
      end_offset,chunk_sha256,locale,platform,occurred_at)
      SELECT (body->>'atomic_group_id')::uuid,(body->>'root_id')::uuid,$1::uuid,$2::uuid,(body->>'evidence_ordinal')::smallint,
        body->>'ref_id',(body->>'chunk_index')::integer,(body->>'start')::integer,(body->>'end')::integer,body->>'chunk_sha256',
        body->>'locale',body->>'platform',NULLIF(body->>'occurred_at','')::timestamptz FROM jsonb_array_elements($3::jsonb) body`,
    [inserted.id,census.workspace_id,JSON.stringify(page)]);
    await client.query("UPDATE signal_topic_consolidation_runs SET status='census_ready',updated_at=clock_timestamp() WHERE id=$1::uuid",[inserted.id]);
    return { consolidation_run_id: inserted.id, group_count: census.groups.length, root_count: roots.length,
      evidence_count: evidence.length, replayed: false };
  });
}

/** Persists a total centroid partition and advances the run to editorial review. */
export async function materializeSignalTopicCommunityPlanV1(args: {
  database: SignalTopicConsolidationDatabaseV1; workspace_id: string; actor_user_id: string;
  consolidation_run_id: string; plan: unknown; source_execution_id?: string;
  control_execution?: SignalTopicConsolidationControlLeaseRefV1;
}): Promise<{ consolidation_run_id: string; community_count: number; member_count: number; replayed: boolean }> {
  const workspace = uuid(args.workspace_id, "topic_consolidation_workspace_invalid"), actor = uuid(args.actor_user_id, "topic_consolidation_actor_invalid"),
    runId = uuid(args.consolidation_run_id, "topic_consolidation_run_invalid"),
    sourceExecution = args.source_execution_id ? uuid(args.source_execution_id,"topic_consolidation_control_invalid") : undefined;
  return transaction(args.database, async client => {
    await requireConsolidationAuthority(client,workspace,actor,sourceExecution,args.control_execution);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`topic-consolidation:${workspace}:${runId}`]);
    const run = (await client.query<{ status: string; source_engine_execution_id: string;
      configuration_digest: string; community_plan_digest: string | null }>(`
      SELECT status,source_engine_execution_id,configuration_digest,community_plan_digest FROM signal_topic_consolidation_runs
      WHERE id=$1::uuid AND workspace_id=$2::uuid FOR UPDATE`,[runId,workspace])).rows[0];
    if (!run) throw new SignalTopicConsolidationContractError("topic_consolidation_run_unavailable");
    if (sourceExecution && run.source_engine_execution_id !== sourceExecution)
      fail("topic_consolidation_control_invalid");
    const groupRows = (await client.query<{ id: string; group_key: string }>(`SELECT id,group_key FROM signal_topic_atomic_groups
      WHERE consolidation_run_id=$1::uuid AND workspace_id=$2::uuid ORDER BY group_key COLLATE "C"`,[runId,workspace])).rows;
    const plan = parseSignalTopicCommunityPlanV1(args.plan, groupRows.map(row => row.group_key));
    if (plan.configuration_digest !== run.configuration_digest) fail("topic_consolidation_community_configuration_stale");
    const planDigest = signalTopicConsolidationDigestV1(plan);
    if (run.community_plan_digest !== null) {
      if (run.community_plan_digest !== planDigest) fail("topic_consolidation_community_replay_conflict");
      return { consolidation_run_id: runId, community_count: plan.communities.length,
        member_count: plan.communities.reduce((sum, community) => sum + community.members.length, 0), replayed: true };
    }
    if (!["census_ready","ready_for_review"].includes(run.status)) fail("topic_consolidation_run_unavailable");
    const groupIds = new Map(groupRows.map(row => [row.group_key,row.id])), communityIds = new Map(plan.communities.map(item => [item.community_key,randomUUID()]));
    for (const page of chunks(plan.communities, 256)) await client.query(`INSERT INTO signal_topic_consolidation_communities(
      id,consolidation_run_id,workspace_id,source_engine_execution_id,community_key,community_digest,configuration_digest)
      SELECT (body->>'id')::uuid,$1::uuid,$2::uuid,run.source_engine_execution_id,body->>'community_key',body->>'community_digest',body->>'configuration_digest'
      FROM signal_topic_consolidation_runs run,jsonb_array_elements($3::jsonb) body WHERE run.id=$1::uuid AND run.workspace_id=$2::uuid`,
    [runId,workspace,JSON.stringify(page.map(item => ({ id: communityIds.get(item.community_key), community_key: item.community_key,
      community_digest: item.community_digest, configuration_digest: plan.configuration_digest }))) ]);
    const members = plan.communities.flatMap(community => community.members.map(member => ({ community_id: communityIds.get(community.community_key),
      atomic_group_id: groupIds.get(member.group_key), rank: member.rank, similarity: member.similarity })));
    for (const page of chunks(members, 2_000)) await client.query(`INSERT INTO signal_topic_consolidation_community_members(
      community_id,atomic_group_id,consolidation_run_id,workspace_id,rank,similarity)
      SELECT (body->>'community_id')::uuid,(body->>'atomic_group_id')::uuid,$1::uuid,$2::uuid,(body->>'rank')::integer,
        (body->>'similarity')::double precision FROM jsonb_array_elements($3::jsonb) body`,[runId,workspace,JSON.stringify(page)]);
    await client.query(`UPDATE signal_topic_consolidation_runs SET status='ready_for_review',community_plan_digest=$2,
      updated_at=clock_timestamp() WHERE id=$1::uuid`,[runId,planDigest]);
    return { consolidation_run_id: runId, community_count: plan.communities.length, member_count: members.length, replayed: false };
  });
}

/**
 * Materializes and validates one complete editorial revision. Editing is
 * represented by a successor revision, so every visible state has an explicit
 * digest and prior versions remain auditable.
 */
export async function materializeSignalTopicConsolidationRevisionV1(args: {
  database: SignalTopicConsolidationDatabaseV1; workspace_id: string; actor_user_id: string;
  consolidation_run_id: string; revision: unknown;
}): Promise<{ consolidation_run_id: string; revision_id: string; revision: number; revision_digest: string; replayed: boolean }> {
  const workspace = uuid(args.workspace_id, "topic_consolidation_workspace_invalid"), actor = uuid(args.actor_user_id, "topic_consolidation_actor_invalid"),
    runId = uuid(args.consolidation_run_id, "topic_consolidation_run_invalid");
  return transaction(args.database, async client => {
    await requireConsolidationAuthority(client, workspace, actor);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`topic-consolidation:${workspace}:${runId}:editorial`]);
    const run = (await client.query<{ status: string; source_engine_execution_id: string }>(`SELECT status,source_engine_execution_id
      FROM signal_topic_consolidation_runs WHERE id=$1::uuid AND workspace_id=$2::uuid FOR UPDATE`,[runId,workspace])).rows[0];
    if (!run || !["ready_for_review","reviewing","validated"].includes(run.status))
      throw new SignalTopicConsolidationContractError("topic_consolidation_run_unavailable");
    const groups = (await client.query<{ id: string; group_key: string }>(`SELECT id,group_key FROM signal_topic_atomic_groups
      WHERE consolidation_run_id=$1::uuid AND workspace_id=$2::uuid ORDER BY group_key COLLATE "C"`,[runId,workspace])).rows;
    const revision = parseSignalTopicConsolidationRevisionV1(args.revision,groups.map(group => group.group_key));
    const existing = (await client.query<{ id: string; status: string; revision_digest: string | null }>(`SELECT id,status,revision_digest
      FROM signal_topic_consolidation_revisions WHERE consolidation_run_id=$1::uuid AND workspace_id=$2::uuid AND revision=$3 FOR UPDATE`,
    [runId,workspace,revision.revision])).rows[0];
    if (existing) {
      if (existing.status !== "validated" || existing.revision_digest !== revision.revision_digest)
        throw new SignalTopicConsolidationContractError("topic_consolidation_revision_replay_conflict");
      return { consolidation_run_id: runId, revision_id: existing.id, revision: revision.revision,
        revision_digest: revision.revision_digest, replayed: true };
    }
    const previous = (await client.query<{ id: string; revision: number; status: string }>(`SELECT id,revision,status FROM signal_topic_consolidation_revisions
      WHERE consolidation_run_id=$1::uuid AND workspace_id=$2::uuid ORDER BY revision DESC LIMIT 1 FOR UPDATE`,[runId,workspace])).rows[0];
    if (revision.revision !== (previous?.revision ?? 0) + 1)
      throw new SignalTopicConsolidationContractError("topic_consolidation_revision_sequence_invalid");
    if (previous && previous.status !== "validated")
      throw new SignalTopicConsolidationContractError("topic_consolidation_prior_revision_invalid");
    const revisionId = randomUUID();
    await client.query(`INSERT INTO signal_topic_consolidation_revisions(id,consolidation_run_id,workspace_id,source_engine_execution_id,
      revision,status,parent_revision_id,created_by_user_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'draft',$6::uuid,$7::uuid)`,
    [revisionId,runId,workspace,run.source_engine_execution_id,revision.revision,previous?.id ?? null,actor]);
    const conceptIds = new Map(revision.concepts.map(concept => [concept.concept_key,randomUUID()]));
    for (const page of chunks(revision.concepts, 500)) await client.query(`INSERT INTO signal_topic_editorial_concepts(
      id,revision_id,consolidation_run_id,workspace_id,concept_key,kind,label,definition,locale,source)
      SELECT (body->>'id')::uuid,$1::uuid,$2::uuid,$3::uuid,body->>'concept_key',body->>'kind',body->>'label',
        body->>'definition',body->>'locale',body->>'source' FROM jsonb_array_elements($4::jsonb) body`,
    [revisionId,runId,workspace,JSON.stringify(page.map(concept => ({ id: conceptIds.get(concept.concept_key),...concept })))]);
    const groupIds = new Map(groups.map(group => [group.group_key,group.id]));
    for (const page of chunks(revision.decisions, 2_000)) await client.query(`INSERT INTO signal_topic_consolidation_decisions(
      revision_id,atomic_group_id,consolidation_run_id,workspace_id,disposition,concept_id,source,confidence,rationale,decision_digest)
      SELECT $1::uuid,(body->>'atomic_group_id')::uuid,$2::uuid,$3::uuid,body->>'disposition',NULLIF(body->>'concept_id','')::uuid,
        body->>'source',NULLIF(body->>'confidence','')::double precision,body->>'rationale',body->>'decision_digest'
      FROM jsonb_array_elements($4::jsonb) body`,[revisionId,runId,workspace,JSON.stringify(page.map(decision => ({ ...decision,
        atomic_group_id: groupIds.get(decision.group_key), concept_id: decision.concept_key === null ? null : conceptIds.get(decision.concept_key),
        decision_digest: signalTopicConsolidationDigestV1(decision) }))) ]);
    const validation = (await client.query<{ validation: { complete?: boolean } }>(
      "SELECT validate_signal_topic_consolidation_revision_v1($1::uuid) validation",[revisionId])).rows[0]?.validation;
    if (validation?.complete !== true) throw new SignalTopicConsolidationContractError("topic_consolidation_revision_incomplete");
    if (previous) await client.query("UPDATE signal_topic_consolidation_revisions SET status='superseded' WHERE id=$1::uuid",[previous.id]);
    await client.query(`UPDATE signal_topic_consolidation_revisions SET status='validated',revision_digest=$2,validated_at=clock_timestamp()
      WHERE id=$1::uuid`,[revisionId,revision.revision_digest]);
    await client.query(`UPDATE signal_topic_consolidation_runs SET status='validated',completed_at=COALESCE(completed_at,clock_timestamp()),
      updated_at=clock_timestamp() WHERE id=$1::uuid`,[runId]);
    return { consolidation_run_id: runId, revision_id: revisionId, revision: revision.revision,
      revision_digest: revision.revision_digest, replayed: false };
  });
}
