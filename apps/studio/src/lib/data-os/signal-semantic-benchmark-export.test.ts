import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSignalSemanticBenchmarkArtifactsV1 } from
  "./signal-semantic-benchmark-export";

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
