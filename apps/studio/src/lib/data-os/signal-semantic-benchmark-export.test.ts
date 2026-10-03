import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSignalSemanticBenchmarkArtifactsV1,
  buildSignalSemanticBenchmarkArtifactsV2,
  buildSignalSemanticBenchmarkExportManifestV2,
  buildSignalSemanticBenchmarkPreflightV2,
  type SignalSemanticBenchmarkFrozenCorpusV2
} from "./signal-semantic-benchmark-export";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const workspace = {
  workspace_id: "00000000-0000-4000-8000-000000000001",
  timezone: "America/Mexico_City",
  current_generation: "7",
  snapshot_digest: digest("1"),
  population_digest: digest("2"),
  governance_digest: digest("3"),
  reconciled_at: "2026-08-16T12:00:00.000Z",
  projected_root_count: 3,
  dirty_root_count: 0,
  full_rebuild_required: false,
  observed_at: "2026-08-16T12:00:00.000Z"
};

test("benchmark export pseudonymizes roots/entities and reconciles exclusive exclusions", () => {
  const result = buildSignalSemanticBenchmarkArtifactsV1({
    workspace,
    auditedEligibleCount: 1,
    liveGovernanceDigest: digest("7"),
    watermarkDigest: digest("4"),
    pseudonymKey: Buffer.alloc(32, 7),
    rows: [
      row({ mention_id: "root-a", live_eligibility: "eligible" }),
      row({ mention_id: "root-b", live_eligibility: "quality_excluded" }),
      row({ mention_id: "root-c", live_eligibility: "licensing_denied" })
    ]
  });
  assert.equal(result.denominator, 3);
  assert.equal(result.exported, 1);
  assert.deepEqual(result.excluded_by_reason, {
    licensing_denied: 1,
    quality_excluded: 1
  });
  assert.match(result.records[0]!.record_key, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(result.records[0]!.record_key, "root-a");
  assert.notEqual(result.records[0]!.provenance_intents[0]!.entity_ref, "entity-a");
  assert.equal(result.records[0]!.text, "Texto normalizado");
});

test("benchmark export fails closed without live authority", () => {
  assert.throws(() => buildSignalSemanticBenchmarkArtifactsV1({
    workspace,
    auditedEligibleCount: 1,
    liveGovernanceDigest: digest("7"),
    watermarkDigest: digest("4"),
    pseudonymKey: Buffer.alloc(32, 7),
    rows: [row({ live_authority_digest: null })]
  }), /signal_benchmark_live_authority_incomplete/u);
});

test("benchmark export rejects duplicate canonical roots", () => {
  assert.throws(() => buildSignalSemanticBenchmarkArtifactsV1({
    workspace,
    auditedEligibleCount: 2,
    liveGovernanceDigest: digest("7"),
    watermarkDigest: digest("4"),
    pseudonymKey: Buffer.alloc(32, 7),
    rows: [row(), row()]
  }), /signal_benchmark_root_duplicate/u);
});

test("acquisition export v2 keeps one physical root with multiple partition memberships", () => {
  const rows = acquisitionRows();
  const preflight = buildSignalSemanticBenchmarkPreflightV2({
    rows,
    frozenCorpus: frozenCorpusV2
  });
  assert.equal(preflight.ready, true);
  assert.equal(preflight.acquisition_denominator, 7);
  assert.equal(preflight.modeling_population, 3);
  assert.equal(preflight.quality_excluded_roots, 4);
  assert.equal(preflight.resource_estimate.partition_memberships, 4);
  assert.equal(preflight.required_usage, "strategic-analysis");
  assert.equal(preflight.provider_calls, 0);
  assert.equal(preflight.writes_performed, false);

  const result = buildSignalSemanticBenchmarkArtifactsV2({
    rows,
    frozenCorpus: frozenCorpusV2,
    workspaceId: "00000000-0000-4000-8000-000000000001",
    pseudonymKey: Buffer.alloc(32, 7)
  });
  assert.equal(result.exported, 3);
  assert.equal(result.shared_root_count, 1);
  const shared = result.records.find((item) => item.partition_memberships.length === 2);
  assert.ok(shared);
  assert.equal(shared.authority_usage, "strategic-analysis");
  assert.notEqual(shared.record_key, "root-a");
  const manifest = buildSignalSemanticBenchmarkExportManifestV2({
    exported: {
      ...result,
      protected_state_digest_before: digest("a"),
      protected_state_digest_after: digest("a")
    },
    frozenCorpus: frozenCorpusV2,
    exportFileSha256: digest("b"),
    exporterSourceDigest: digest("c")
  });
  assert.equal(manifest.schema_version, "signal-semantic-benchmark-record-v2");
  assert.equal(manifest.partitions.category?.entity_ref, frozenCorpusV2.partitions[1]?.entity_ref);
  assert.equal(manifest.exclusion_contract, "acquisition-quality-exclusive-v2");
  assert.equal(manifest.exporter_source_digest, digest("c"));
});

test("acquisition export v2 fails closed on strategic rights or frozen partition drift", () => {
  const denied = acquisitionRows().map((item, index) => index === 0
    ? { ...item, authority_state: "strategic_analysis_denied", authority_digest: null }
    : item);
  const preflight = buildSignalSemanticBenchmarkPreflightV2({
    rows: denied,
    frozenCorpus: frozenCorpusV2
  });
  assert.equal(preflight.ready, false);
  assert.deepEqual(preflight.blockers, [
    "strategic_authority_blocked:strategic_analysis_denied"
  ]);

  const wrongSlot = acquisitionRows().map((item, index) => index === 0
    ? { ...item, slot_digest: digest("f") }
    : item);
  assert.equal(buildSignalSemanticBenchmarkPreflightV2({
    rows: wrongSlot,
    frozenCorpus: frozenCorpusV2
  }).ready, false);
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    mention_id: "root-a",
    published_at: "2026-01-01T12:00:00.000Z",
    language: "ES",
    country: "MX",
    platform: "X",
    text_clean: "  Texto   normalizado  ",
    queue_state: "unresolved",
    context_hash: digest("6"),
    projection_eligibility: "eligible",
    projection_authority_digest: digest("7"),
    live_eligibility: "eligible",
    live_authority_digest: digest("7"),
    authority_valid_until: null,
    source_intents: [{ scope: "primary_brand", entity_type: "brand", entity_id: "entity-a" }],
    ...overrides
  };
}

const frozenCorpusV2: SignalSemanticBenchmarkFrozenCorpusV2 = {
  identity: "generic-multiscope-fixture-v1",
  acquisition_denominator: 7,
  included_modeling_population: 3,
  quality_excluded_roots: 4,
  population_digest: digest("1"),
  content_digest: digest("2"),
  provenance_digest: digest("3"),
  watermark_digest: digest("4"),
  timezone: "UTC",
  observed_period_local: { from: "2026-01-01", to: "2026-01-07" },
  partitions: [
    partition("primary", "primary_brand", "MX", "a", "1"),
    partition("category", "category", "MX", "b", "2"),
    partition("competitor_a", "competitor", "US", "c", "3"),
    partition("competitor_b", "competitor", "US", "d", "4")
  ]
};

function partition(
  key: string,
  scope: "primary_brand" | "category" | "competitor",
  market: string,
  entity: string,
  slot: string
) {
  return {
    key,
    scope,
    entity_ref: digest(entity),
    declared_market: market,
    total: 2,
    included: 1,
    excluded: 1,
    population_digest: digest("5"),
    modeling_digest: digest("6"),
    plan_version: 1,
    plan_digest: digest("7"),
    slot_digest: digest(slot)
  };
}

function acquisitionRows() {
  const rows = [
    acquisitionRow("root-a", "included", frozenCorpusV2.partitions[0]!),
    acquisitionRow("root-a", "included", frozenCorpusV2.partitions[1]!),
    acquisitionRow("root-b", "included", frozenCorpusV2.partitions[2]!),
    acquisitionRow("root-c", "included", frozenCorpusV2.partitions[3]!),
    acquisitionRow("root-d", "excluded", frozenCorpusV2.partitions[0]!),
    acquisitionRow("root-e", "excluded", frozenCorpusV2.partitions[1]!),
    acquisitionRow("root-f", "excluded", frozenCorpusV2.partitions[2]!),
    acquisitionRow("root-g", "excluded", frozenCorpusV2.partitions[3]!)
  ];
  return rows;
}

function acquisitionRow(
  root: string,
  inclusion: "included" | "excluded",
  partitionValue: SignalSemanticBenchmarkFrozenCorpusV2["partitions"][number]
) {
  return {
    mention_id: root,
    inclusion_status: inclusion,
    published_at: "2026-01-01T12:00:00.000Z",
    text_clean: inclusion === "included" ? `Texto ${root}` : null,
    language: "es",
    country: partitionValue.declared_market,
    platform: "x",
    canonical_alias_count: root === "root-a" ? 1 : 0,
    partition_key: partitionValue.key,
    scope: partitionValue.scope,
    entity_ref: partitionValue.entity_ref,
    declared_market: partitionValue.declared_market,
    plan_version: partitionValue.plan_version,
    plan_digest: partitionValue.plan_digest,
    slot_digest: partitionValue.slot_digest,
    slot_key: `slot-${partitionValue.key}`,
    provenance_digest: digest("8"),
    authority_state: "eligible",
    authority_digest: digest("9"),
    authority_valid_until: null
  };
}
