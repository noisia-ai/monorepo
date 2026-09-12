import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeSignalTopicConsolidationCentroidsV1,
  parseSignalTopicAtomicCensusV1,
  parseSignalTopicCommunityPlanV1,
  parseSignalTopicConsolidationRevisionV1,
  signalTopicConsolidationDigestV1,
  SignalTopicConsolidationContractError,
} from "../signal-topic-consolidation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value: unknown) => signalTopicConsolidationDigestV1(value);

function group(n: number, lane: "open" | "guided", neighbor: string) {
  const root = { root_id: id(100 + n), chunk_count: n + 1, strength: 0.8, assignment_digest: sha(["assignment", n]) };
  const evidenceIdentity = { root_id: root.root_id, chunk_index: 0, start: 0, end: 12, chunk_sha256: sha(["chunk", n]) };
  const dossier = {
    contract_version: "signal-topic-group-dossier-v1",
    scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 },
    locale_counts: [{ key: "es-MX", count: 1 }], platform_counts: [{ key: "reddit", count: 1 }],
    month_counts: [{ key: "2026-08", count: 1 }],
    brand_affinity: { positive: [{ guide_key: "voice", score: 0.9 }], negative: [], abstention: [] },
    neighbors: [{ group_key: neighbor, similarity: 0.7 }], metrics: { cohesion: 0.6, outlier_ratio: 0.1 },
    evidence: [{ ref_id: sha(evidenceIdentity), ...evidenceIdentity,
      locale: "es-MX", platform: "reddit", occurred_at: "2026-08-01T00:00:00.000Z" }],
  };
  return { group_key: `${lane}:cluster-${n}`, lane, stable_cluster_id: `cluster-${n}`, local_label: n,
    group_digest: sha(["group", n]), root_count: 1, chunk_count: root.chunk_count, terms: n === 1 ? ["alexa", "voz"] : ["rutina"],
    dossier, dossier_digest: sha(dossier), centroid: { artifact_id: id(30), artifact_sha256: sha("centroids"),
      centroid_key: `centroid-${n}`, centroid_digest: sha(["centroid", n]) }, roots: [root] };
}

function census() {
  const first = group(1, "open", "guided:cluster-2"), second = group(2, "guided", "open:cluster-1");
  const configuration = { contract_version: "signal-topic-consolidation-config-v1", dossier_version: "signal-topic-group-dossier-v1",
    representative_limit: 10, neighbor_limit: 16, community_algorithm: "centroid-knn-v1", neighbor_k: 12,
    min_similarity_ppm: 700_000, assignment_policy: "partition-all-groups-v1" };
  return { contract_version: "signal-topic-consolidation-v1", workspace_id: id(1), source_execution_id: id(2),
    source_checkpoint_digest: sha("checkpoint"), output_artifact_id: id(10), output_artifact_sha256: sha("output"),
    model_artifact_id: id(20), model_artifact_sha256: sha("model"), context_digest: sha("context"),
    centroid_artifact_id: id(30), centroid_artifact_sha256: sha("centroids"),
    configuration, configuration_digest: sha(configuration), expected_group_count: 2, groups: [second, first] };
}

const error = (code: string) => (caught: unknown) => caught instanceof SignalTopicConsolidationContractError && caught.code === code;

test("atomic census canonicalizes a complete, reference-only lineage", () => {
  const parsed = parseSignalTopicAtomicCensusV1(census());
  assert.deepEqual(parsed.groups.map(item => item.group_key), ["guided:cluster-2", "open:cluster-1"]);
  assert.equal(parsed.groups[0]!.dossier.evidence[0]!.root_id, id(102));
  assert.equal("text" in parsed.groups[0]!.dossier.evidence[0]!, false);
  assert.equal(sha(parsed), sha(parseSignalTopicAtomicCensusV1(parsed)));
});

test("atomic census rejects omission, unbounded evidence bodies and broken lineage counts", () => {
  const omitted = census(); omitted.groups.pop();
  assert.throws(() => parseSignalTopicAtomicCensusV1(omitted), error("topic_consolidation_census_incomplete"));
  const raw = census() as ReturnType<typeof census> & { groups: Array<Record<string, unknown>> };
  (raw.groups[0]!.dossier as { evidence: Array<Record<string, unknown>> }).evidence[0]!.text = "raw corpus must not be copied";
  assert.throws(() => parseSignalTopicAtomicCensusV1(raw), error("topic_consolidation_evidence_invalid"));
  const broken = census(); broken.groups[0]!.chunk_count += 1;
  assert.throws(() => parseSignalTopicAtomicCensusV1(broken), error("topic_consolidation_group_counts_invalid"));
});

test("centroid community proposals are a total non-overlapping partition", () => {
  const keys = parseSignalTopicAtomicCensusV1(census()).groups.map(item => item.group_key);
  const valid = { contract_version: "signal-topic-centroid-community-plan-v1", configuration_digest: sha("knn-v1"), communities: [
    { community_key: "voice-control", community_digest: "", members: [
      { group_key: keys[0], rank: 0, similarity: 1 }, { group_key: keys[1], rank: 1, similarity: 0.7 },
    ] },
  ] };
  valid.communities[0]!.community_digest = sha({ members: valid.communities[0]!.members });
  assert.equal(parseSignalTopicCommunityPlanV1(valid, keys).communities[0]!.members.length, 2);
  const overlap = structuredClone(valid); const duplicateMembers = [{ group_key: keys[0], rank: 0, similarity: 1 }];
  overlap.communities.push({ community_key: "duplicate", community_digest: sha({ members: duplicateMembers }), members: duplicateMembers });
  assert.throws(() => parseSignalTopicCommunityPlanV1(overlap, keys), error("topic_consolidation_community_overlap"));
});

test("editorial revision requires one typed disposition for every atomic group", () => {
  const keys = parseSignalTopicAtomicCensusV1(census()).groups.map(item => item.group_key);
  const body = { contract_version: "signal-topic-consolidation-revision-v1" as const, revision: 1,
    concepts: [{ concept_key: "voice-control", kind: "topic" as const, label: "Control por voz",
      definition: "Uso y fallas de comandos de voz.", locale: "es-MX", source: "model" as const }],
    decisions: [{ group_key: keys[0], disposition: "topic" as const, concept_key: "voice-control", source: "model" as const, confidence: 0.9, rationale: null },
      { group_key: keys[1], disposition: "noise" as const, concept_key: null, source: "model" as const, confidence: 0.8, rationale: "Sin relación con Alexa+." }] };
  const valid = { ...body, revision_digest: sha(body) };
  assert.equal(parseSignalTopicConsolidationRevisionV1(valid, keys).decisions.length, 2);
  const mistyped = structuredClone(valid); mistyped.decisions[0]!.concept_key = null;
  assert.throws(() => parseSignalTopicConsolidationRevisionV1(mistyped, keys), error("topic_consolidation_decision_target_invalid"));
  const incomplete = structuredClone(valid); incomplete.decisions.pop();
  assert.throws(() => parseSignalTopicConsolidationRevisionV1(incomplete, keys), error("topic_consolidation_decisions_incomplete"));
});

test("0174 keeps vectors in artifacts and enforces census, disposition, lineage and private access", () => {
  const sql = readFileSync(new URL("./0174_signal_topic_consolidation_foundation.sql", import.meta.url), "utf8");
  for (const table of ["signal_topic_consolidation_artifacts", "signal_topic_consolidation_runs", "signal_topic_atomic_groups", "signal_topic_atomic_group_roots",
    "signal_topic_atomic_group_evidence", "signal_topic_consolidation_communities", "signal_topic_consolidation_community_members",
    "signal_topic_consolidation_revisions", "signal_topic_editorial_concepts", "signal_topic_consolidation_decisions"]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /disposition IN\('topic','narrative','noise','unresolved'\)/);
  assert.match(sql, /REFERENCES mentions\(workspace_id,id\) ON DELETE RESTRICT/);
  assert.match(sql, /evidence_ordinal BETWEEN 0 AND 9/);
  assert.match(sql, /validate_signal_topic_consolidation_revision_v1/);
  assert.match(sql, /community_member_count=expected_group_count/);
  assert.match(sql, /census_digest text NOT NULL/);
  assert.match(sql, /signal_topic_consolidation_numeric_content_frozen/);
  assert.match(sql, /signal_topic_consolidation_run_transition_invalid/);
  assert.match(sql, /OLD\.consolidation_run_id IS DISTINCT FROM NEW\.consolidation_run_id/);
  assert.match(sql, /OLD\.revision_id IS DISTINCT FROM NEW\.revision_id/);
  assert.match(sql, /BEFORE INSERT OR UPDATE ON signal_topic_consolidation_revisions/);
  assert.match(sql, /signal_topic_consolidation_history_retained/);
  assert.match(sql, /normalized-mean-document-embeddings-v1/);
  assert.match(sql, /security_invoker=true/);
  assert.match(sql, /REVOKE ALL ON signal_topic_consolidation_artifacts,signal_topic_consolidation_runs/);
  assert.doesNotMatch(sql, /vector\s*\(/i);
  assert.doesNotMatch(sql, /engine_cost_events|Voyage|Claude/i);
});

test("0177 keeps the shared numeric trigger from reading sibling-table columns", () => {
  const sql = readFileSync(new URL("./0177_signal_topic_consolidation_numeric_guard.sql", import.meta.url), "utf8");
  assert.match(sql, /IF TG_TABLE_NAME='signal_topic_atomic_groups' THEN\s+IF NEW\.centroid_artifact_id IS NOT NULL/u);
  assert.doesNotMatch(sql, /TG_TABLE_NAME='signal_topic_atomic_groups' AND NEW\.centroid_artifact_id/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION signal_topic_consolidation_numeric_content_guard_v1\(\) FROM PUBLIC/u);
});

test("0178 upgrades the editorial prompt/schema and explicit cap before the paid ledger is used", () => {
  const sql = readFileSync(new URL("./0178_signal_topic_editorial_catalog_contract.sql", import.meta.url), "utf8");
  assert.match(sql,/topic_editorial_contract_upgrade_requires_empty_ledger/u);
  assert.match(sql,/CREATE OR REPLACE FUNCTION signal_topic_editorial_configuration_v1\(\)/u);
  assert.match(sql,/sha256:08f97c1229f3a2603a69d5224c97492b7d0cb32bb2c65c868233fae06a551f2e/u);
  assert.match(sql,/sha256:c411a17c3d93c2fa73f7d81cdd755a97de45a379f9513ca0f17075681cdd3503/u);
  assert.match(sql,/sha256:13996f4e96d9aeac84712100447d6c0a1ab289bee242f187cf434ef8ddc2121d/u);
  assert.match(sql,/sha256:12ad951109d4713e94cffb61def501a1987035b15eb485362117dc88b5c559c2/u);
  assert.match(sql,/REVOKE ALL ON FUNCTION signal_topic_editorial_configuration_v1\(\) FROM PUBLIC/u);
  // The original all-requests slot is replaced by two scoped partial unique indexes.
  assert.match(sql, /pg_get_constraintdef\(oid\)='UNIQUE \(execution_id, phase, batch_index\)'/u);
  assert.match(sql, /CREATE UNIQUE INDEX topic_editorial_original_request_slot/u);
  assert.match(sql, /CREATE UNIQUE INDEX topic_editorial_one_repair_per_parent/u);
  const allowed = "ALTER TABLE signal_topic_editorial_requests DROP CONSTRAINT %I";
  assert.equal(sql.split(allowed).length, 2);
  const capConstraints = [
    "DROP CONSTRAINT signal_topic_editorial_executions_hard_cap_micro_usd_check",
    "DROP CONSTRAINT signal_processing_consolidation_action",
  ];
  for (const constraint of capConstraints) assert.equal(sql.split(constraint).length, 2);
  assert.doesNotMatch(capConstraints.reduce((body,constraint) => body.replace(constraint,''),sql.replace(allowed, '')), /\b(?:DROP|TRUNCATE)\b/iu);
});

test("exact kNN rejects an unbounded group census before opening PostgreSQL", async () => {
  let connected = false;
  await assert.rejects(computeSignalTopicConsolidationCentroidsV1({
    database: { connect: async () => { connected = true; throw new Error("unexpected_connection"); } } as never,
    workspace_id: id(1), actor_user_id: id(2), source_execution_id: id(3), embedding_run_id: id(4),
    embedding_config_digest: sha("embedding"), neighbor_k: 10,
    memberships: Array.from({ length: 5_001 },(_,index) => ({ group_key: `open:cluster-${index}`,
      ordinal: 0, chunk_sha256: sha(["chunk",index]) })),
  }), (caught: unknown) => caught instanceof SignalTopicConsolidationContractError
    && caught.code === "topic_consolidation_exact_knn_capacity_exceeded");
  assert.equal(connected,false);
});
