import assert from "node:assert/strict";
import test from "node:test";
import { sha256HexV1, summarizeR16BenchmarkV1, type R16BenchmarkEvidenceV1 } from "./benchmark-contract";

function completeEvidence(): R16BenchmarkEvidenceV1 {
  const fileManifest = [{ path: "scripts/r16/benchmark-contract.ts", sha256: `sha256:${"e".repeat(64)}` }];
  return {
    contract_version: "r16-benchmark-evidence-v1", run_id: "synthetic-run-01",
    source_provenance: { head_sha: "a".repeat(40), source_tree_sha256: `sha256:${sha256HexV1(JSON.stringify(fileManifest.map(file => [file.path, file.sha256])))}`,
      tree_status_sha256: `sha256:${"c".repeat(64)}`, file_count: fileManifest.length, file_manifest: fileManifest },
    policy_configuration_digest: `sha256:${"d".repeat(64)}`,
    started_at: "2026-11-14T10:00:00.000Z", ended_at: "2026-11-14T10:00:20.000Z",
    wall_elapsed_ms: 20_000, sustained_start_ms: 0,
    provider: { kind: "synthetic", requests: 20_000, latency_ms: Array.from({ length: 20_000 }, (_, index) => [100, 250, 500][index % 3]!),
      retry_after_ms: [], input_tokens: 20_000_000, output_tokens: 0 },
    raw_storage: { backend: "http_filesystem", pages: [{ page_id: "page-1", storage_key: "r16bench/page-1.jsonl",
      bytes_written: 128, bytes_read_back: 128, sha256: "abc", read_back_sha256: "abc", members: 20_000, durable: true }] },
    // One raw page line per root is mandatory; a missing page cannot be hidden by DB counts.
    postgres: { verified_version: "PostgreSQL 17.1", database_name: "noisia_mfp_ci", container_name: "r16-benchmark-pg17",
      system_identifier: "synthetic-system-id", loopback_binding: true, pgvector: true, committed_root_rows: 20_000, apply_batches: 80 },
    signal: { materialized_root_rows: 20_000, incremental: true },
    guards: { policy_admissions: 1, budget_admissions: 1, policy_denials: 1, budget_denials: 1, denied_requests_not_sent: 2 },
    invariants: { duplicate_settlements: 0, missing_durable_receipts: 0, unsettled_provider_responses: 0,
      denied_provider_requests: 0, lost_materialized_rows: 0 },
    max_buffered_bytes_allowed: 8_388_608,
    max_in_flight_allowed: 1_000,
    max_flushes_allowed: 1,
    stream_peaks: { in_flight: 1_000, reserved_working_bytes: 4_096, buffered_responses: 3, active_flushes: 1 },
    phases: Array.from({ length: 20 }, (_, index) => ({ phase: "signal", start_ms: index * 1_000, end_ms: (index + 1) * 1_000 - 1, roots: 1_000 })),
    samples: [{ at_ms: 200, in_flight: 1_000, buffered_bytes: 4_096, buffered_responses: 3,
      active_flushes: 1, leased_runs: 1, rss_bytes: 10_000_000 }],
    failures: [
      { stage: "provider", kind: "429", outcome: "contained_unknown", retry_after_ms: 250, physical_replays: 0,
        raw_page_durable: true, technical_result_applied: true, settlement_absent: true, reservation_preserved: true },
      { stage: "provider", kind: "529", outcome: "contained_unknown", retry_after_ms: 500, physical_replays: 0,
        raw_page_durable: true, technical_result_applied: true, settlement_absent: true, reservation_preserved: true },
      { stage: "storage", kind: "raw_page_write", outcome: "recovered", physical_replays: 0 },
      { stage: "database", kind: "postgres_commit", outcome: "recovered", physical_replays: 0 },
      { stage: "database", kind: "settlement_ack_lost", outcome: "recovered", physical_replays: 0 },
      { stage: "worker", kind: "worker_restart_after_page", outcome: "recovered", physical_replays: 0 },
      { stage: "worker", kind: "lease_expiry", outcome: "contained_unknown", physical_replays: 0,
        raw_page_durable: false, technical_result_applied: false, settlement_absent: true, reservation_preserved: true },
      { stage: "worker", kind: "lease_expiry_after_durable", outcome: "recovered", physical_replays: 0 },
    ],
  };
}

test("R16 harness accepts only end-to-end durable PG evidence meeting every sustained window", () => {
  const result = summarizeR16BenchmarkV1(completeEvidence());
  assert.equal(result.accepted, true, result.rejected_reasons.join(","));
  assert.equal(result.roots_per_second, 1_000);
  assert.equal(result.minimum_full_window_roots_per_second, 1_000);
  assert.equal(result.sustained_window_count, 20);
  assert.equal(result.input_tokens_per_root, 1_000);
  assert.equal(result.phase_durations_overlap, true);
});

test("R16 harness rejects memory-only storage, non-Postgres, missing materialization, and a high peak with a slow window", () => {
  const evidence = completeEvidence();
  evidence.raw_storage.backend = "memory" as "http_filesystem";
  evidence.postgres.container_name = "shared_dev";
  evidence.signal.materialized_root_rows = 2_900;
  evidence.phases[1]!.roots = 999;
  const result = summarizeR16BenchmarkV1(evidence);
  assert.equal(result.accepted, false);
  assert.ok(result.rejected_reasons.includes("durable_page_storage_missing"));
  assert.ok(result.rejected_reasons.includes("postgres_isolation_or_extension_not_verified"));
  assert.ok(result.rejected_reasons.includes("signal_materialization_incomplete"));
  assert.ok(result.rejected_reasons.includes("sustained_window_throughput_below_target"));
});

test("R16 harness rejects corrupt readback and unrecovered transport failures", () => {
  const evidence = completeEvidence();
  evidence.raw_storage.pages[0]!.read_back_sha256 = "tampered";
  evidence.failures.push({ stage: "provider", kind: "429", outcome: "contained_unknown", retry_after_ms: 250,
    physical_replays: 0, raw_page_durable: false, technical_result_applied: true, settlement_absent: true, reservation_preserved: true });
  const result = summarizeR16BenchmarkV1(evidence);
  assert.ok(result.rejected_reasons.includes("raw_page_durability_or_checksum_failed"));
  assert.ok(result.rejected_reasons.includes("failure_recovery_incomplete"));
});

test("R16 harness requires Retry-After, policy and budget guards, and bounded memory samples", () => {
  const evidence = completeEvidence();
  evidence.failures[0]!.retry_after_ms = undefined;
  evidence.guards.budget_admissions = 0;
  evidence.guards.policy_denials = 0;
  evidence.samples[0]!.buffered_bytes = evidence.max_buffered_bytes_allowed + 1;
  const result = summarizeR16BenchmarkV1(evidence);
  assert.ok(result.rejected_reasons.includes("retry_after_not_observed"));
  assert.ok(result.rejected_reasons.includes("policy_or_budget_guard_evidence_missing"));
  assert.ok(result.rejected_reasons.includes("memory_backpressure_limit_exceeded"));
});

test("R16 harness checks the observed concurrency against the configured bound", () => {
  const evidence = completeEvidence();
  evidence.max_in_flight_allowed = 1_024;
  evidence.samples[0]!.in_flight = 1_024;
  assert.equal(summarizeR16BenchmarkV1(evidence).rejected_reasons.includes("in_flight_limit_exceeded"), false);
  evidence.samples[0]!.in_flight = 1_025;
  assert.equal(summarizeR16BenchmarkV1(evidence).rejected_reasons.includes("in_flight_limit_exceeded"), true);
});

test("R16 harness rejects missing raw receipts and financial/data integrity regressions", () => {
  const evidence = completeEvidence();
  evidence.raw_storage.pages[0]!.members = 2_999;
  evidence.invariants.duplicate_settlements = 1;
  evidence.invariants.lost_materialized_rows = 1;
  const result = summarizeR16BenchmarkV1(evidence);
  assert.ok(result.rejected_reasons.includes("durable_raw_receipt_count_incomplete"));
  assert.ok(result.rejected_reasons.includes("pipeline_integrity_invariant_failed"));
});

test("R16 harness rejects duplicate or missing physical provider requests", () => {
  const evidence = completeEvidence();
  evidence.provider.requests++;
  const result = summarizeR16BenchmarkV1(evidence);
  assert.ok(result.rejected_reasons.includes("synthetic_provider_request_count_mismatch"));
});

test("R16 lease expiry evidence distinguishes unresolved RAM-only responses from durable recovery", () => {
  const evidence = completeEvidence();
  const beforeDurability = evidence.failures.find(failure => failure.kind === "lease_expiry")!;
  beforeDurability.raw_page_durable = true;
  assert.ok(summarizeR16BenchmarkV1(evidence).rejected_reasons.includes("failure_recovery_incomplete"));
  beforeDurability.raw_page_durable = false;
  evidence.failures.splice(evidence.failures.findIndex(failure => failure.kind === "lease_expiry_after_durable"), 1);
  assert.ok(summarizeR16BenchmarkV1(evidence).rejected_reasons.includes("failure_case_missing_lease_expiry_after_durable"));
});

test("R16 acceptance rejects replayed recovery and callback-observed peaks between samples", () => {
  const evidence = completeEvidence();
  evidence.failures.find(failure => failure.kind === "raw_page_write")!.physical_replays = 1;
  evidence.stream_peaks.in_flight = 1_001;
  evidence.stream_peaks.reserved_working_bytes = evidence.max_buffered_bytes_allowed + 1;
  evidence.stream_peaks.active_flushes = evidence.max_flushes_allowed + 1;
  const result = summarizeR16BenchmarkV1(evidence);
  assert.ok(result.rejected_reasons.includes("failure_recovery_incomplete"));
  assert.ok(result.rejected_reasons.includes("in_flight_limit_exceeded"));
  assert.ok(result.rejected_reasons.includes("memory_backpressure_limit_exceeded"));
  assert.ok(result.rejected_reasons.includes("active_flush_limit_exceeded"));
});
