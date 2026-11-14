import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

export type R16PhaseV1 = "csv_import" | "voyage" | "discovery" | "jev" | "raw_storage" | "postgres" | "signal";

export interface R16PhaseSpanV1 {
  phase: R16PhaseV1;
  start_ms: number;
  end_ms: number;
  roots: number;
}

export interface R16RawPageReceiptV1 {
  page_id: string;
  storage_key: string;
  bytes_written: number;
  bytes_read_back: number;
  sha256: string;
  read_back_sha256: string;
  members: number;
  durable: boolean;
}

export interface R16BenchmarkEvidenceV1 {
  contract_version: "r16-benchmark-evidence-v1";
  run_id: string;
  started_at: string;
  ended_at: string;
  wall_elapsed_ms: number;
  sustained_start_ms: number;
  provider: { kind: "synthetic"; requests: number; latency_ms: number[]; retry_after_ms: number[];
    input_tokens: number; output_tokens: number };
  raw_storage: { backend: "http_filesystem"; pages: R16RawPageReceiptV1[] };
  postgres: { verified_version: string; database_name: string; container_name: string; system_identifier: string;
    loopback_binding: true; pgvector: true; committed_root_rows: number; apply_batches: number };
  signal: { materialized_root_rows: number; incremental: true };
  guards: { policy_admissions: number; budget_admissions: number; policy_denials: number;
    budget_denials: number; denied_requests_not_sent: number };
  invariants: { duplicate_settlements: number; missing_durable_receipts: number; unsettled_provider_responses: number;
    denied_provider_requests: number; lost_materialized_rows: number };
  max_buffered_bytes_allowed: number;
  max_in_flight_allowed: number;
  phases: R16PhaseSpanV1[];
  samples: Array<{ at_ms: number; in_flight: number; buffered_bytes: number; buffered_responses: number;
    active_flushes: number; leased_runs: number; rss_bytes: number }>;
  failures: Array<{ stage: string; kind: string; outcome: "recovered" | "contained_unknown";
    retry_after_ms?: number; physical_replays: number; raw_page_durable?: boolean;
    technical_result_applied?: boolean; settlement_absent?: boolean; reservation_preserved?: boolean }>;
}

export interface R16BenchmarkSummaryV1 {
  root_count: number;
  wall_ms: number;
  roots_per_second: number;
  minimum_full_window_roots_per_second: number;
  window_ms: number;
  provider_p50_ms: number;
  provider_p95_ms: number;
  input_tokens_per_root: number;
  provider_request_count: number;
  raw_page_count: number;
  postgres_apply_batches: number;
  max_in_flight: number;
  max_in_flight_allowed: number;
  max_buffered_bytes: number;
  failure_count: number;
  recovered_failure_count: number;
  contained_unknown_failure_count: number;
  accepted: boolean;
  rejected_reasons: string[];
  phase_durations_ms: Record<R16PhaseV1, number>;
  phase_latency_ms: Record<R16PhaseV1, { p50_ms: number; p95_ms: number; span_count: number }>;
  sustained_measurement_ms: number;
  sustained_window_count: number;
  phase_durations_overlap: true;
}

export function sha256HexV1(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function percentileV1(values: number[], percentile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)]!;
}

/**
 * Evaluates captured evidence from the production page transport. The evidence
 * contract intentionally requires filesystem-backed HTTP storage readback and
 * PostgreSQL commits; synthetic rows or memory adapters cannot satisfy it.
 */
export function summarizeR16BenchmarkV1(evidence: R16BenchmarkEvidenceV1, options: {
  target_roots_per_second?: number;
  sustained_window_ms?: number;
  max_provider_p95_ms?: number;
} = {}): R16BenchmarkSummaryV1 {
  const target = options.target_roots_per_second ?? 1_000;
  const windowMs = options.sustained_window_ms ?? 1_000;
  const providerP95Limit = options.max_provider_p95_ms ?? 500;
  const startMs = Date.parse(evidence.started_at);
  const endMs = Date.parse(evidence.ended_at);
  const wallMs = evidence.wall_elapsed_ms;
  const roots = evidence.postgres.committed_root_rows;
  const reasons: string[] = [];

  if (evidence.contract_version !== "r16-benchmark-evidence-v1") reasons.push("evidence_contract_missing");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(wallMs) || wallMs <= 0) reasons.push("invalid_wall_clock");
  if (evidence.provider.kind !== "synthetic" || evidence.provider.requests !== roots) reasons.push("synthetic_provider_request_count_mismatch");
  if (evidence.provider.latency_ms.length < evidence.provider.requests) reasons.push("provider_latency_missing");
  if (evidence.provider.latency_ms.some(ms => !Number.isFinite(ms) || ms < 100 || ms > 500)) reasons.push("provider_latency_outside_100_500ms");
  if (percentileV1(evidence.provider.latency_ms, 0.95) > providerP95Limit) reasons.push("provider_p95_exceeds_limit");
  if (evidence.raw_storage.backend !== "http_filesystem" || !evidence.raw_storage.pages.length) reasons.push("durable_page_storage_missing");
  if (evidence.raw_storage.pages.some(page => !page.durable || page.bytes_written <= 0
    || page.bytes_written !== page.bytes_read_back || page.sha256 !== page.read_back_sha256
    || !page.storage_key || !page.page_id || !Number.isSafeInteger(page.members) || page.members < 1)) reasons.push("raw_page_durability_or_checksum_failed");
  if (!evidence.postgres.verified_version.toLowerCase().includes("postgresql")) reasons.push("postgres_not_verified");
  if (evidence.postgres.container_name !== "r16-benchmark-pg17" || evidence.postgres.database_name !== "noisia_mfp_ci"
    || !evidence.postgres.system_identifier || evidence.postgres.loopback_binding !== true || evidence.postgres.pgvector !== true) {
    reasons.push("postgres_isolation_or_extension_not_verified");
  }
  if (roots <= 0 || evidence.signal.materialized_root_rows !== roots || !evidence.signal.incremental) reasons.push("signal_materialization_incomplete");
  if (evidence.raw_storage.pages.reduce((sum, page) => sum + page.members, 0) < roots) reasons.push("durable_raw_receipt_count_incomplete");
  if (evidence.postgres.apply_batches < 1) reasons.push("bulk_database_write_missing");
  if (evidence.guards.policy_admissions <= 0 || evidence.guards.budget_admissions <= 0
    || evidence.guards.policy_denials <= 0 || evidence.guards.budget_denials <= 0
    || evidence.guards.denied_requests_not_sent < evidence.guards.policy_denials + evidence.guards.budget_denials) {
    reasons.push("policy_or_budget_guard_evidence_missing");
  }
  if (Object.values(evidence.invariants).some(value => value !== 0)) reasons.push("pipeline_integrity_invariant_failed");
  if (evidence.failures.some(failure => {
    if (["429", "529"].includes(failure.kind)) return failure.outcome !== "contained_unknown"
      || failure.physical_replays !== 0 || !(failure.retry_after_ms! > 0) || failure.raw_page_durable !== true
      || failure.technical_result_applied !== true || failure.settlement_absent !== true
      || failure.reservation_preserved !== true;
    if (failure.kind === "lease_expiry") return failure.outcome !== "contained_unknown"
      || failure.physical_replays !== 0 || failure.raw_page_durable !== false
      || failure.technical_result_applied !== false || failure.settlement_absent !== true
      || failure.reservation_preserved !== true;
    return failure.outcome !== "recovered" || failure.physical_replays < 0;
  })) reasons.push("failure_recovery_incomplete");
  if (evidence.failures.some(failure => ["429", "529"].includes(failure.kind) && !(failure.retry_after_ms! > 0))) reasons.push("retry_after_not_observed");
  const injectedFailures = new Set(evidence.failures.map(failure => failure.kind));
  for (const required of ["429", "529", "raw_page_write", "postgres_commit", "settlement_ack_lost", "worker_restart_after_page",
    "lease_expiry", "lease_expiry_after_durable"]) {
    if (!injectedFailures.has(required)) reasons.push(`failure_case_missing_${required}`);
  }
  if (!evidence.samples.length) reasons.push("backpressure_samples_missing");
  if (!Number.isSafeInteger(evidence.max_in_flight_allowed) || evidence.max_in_flight_allowed < 1
    || evidence.max_in_flight_allowed > 4_096 || evidence.samples.some(sample => sample.in_flight > evidence.max_in_flight_allowed)) {
    reasons.push("in_flight_limit_exceeded");
  }
  if (evidence.max_buffered_bytes_allowed <= 0 || evidence.samples.some(sample => sample.buffered_bytes > evidence.max_buffered_bytes_allowed)) reasons.push("memory_backpressure_limit_exceeded");
  if (!evidence.samples.some(sample => sample.leased_runs > 0)) reasons.push("lease_samples_missing");

  const sustainedStart = Math.min(wallMs, Math.max(0, evidence.sustained_start_ms));
  if (wallMs - sustainedStart < 20_000) reasons.push("sustained_measurement_too_short");
  const completeWindowCount = Math.floor(Math.max(0, wallMs - sustainedStart) / windowMs);
  let minimumFullWindowRate = 0;
  if (completeWindowCount > 0) {
    const windowCounts = Array.from({ length: completeWindowCount }, (_, index) => {
      const from = sustainedStart + index * windowMs;
      const to = from + windowMs;
      return evidence.phases.filter(span => span.phase === "signal" && span.end_ms >= from && span.end_ms < to)
        .reduce((total, span) => total + span.roots, 0);
    });
    minimumFullWindowRate = Math.min(...windowCounts) * 1_000 / windowMs;
  }
  const throughput = roots * 1_000 / wallMs;
  if (minimumFullWindowRate < target) reasons.push("sustained_window_throughput_below_target");
  if (throughput < target) reasons.push("end_to_end_throughput_below_target");

  const durations = Object.fromEntries(([
    "csv_import", "voyage", "discovery", "jev", "raw_storage", "postgres", "signal",
  ] as const).map(phase => [phase, evidence.phases.filter(span => span.phase === phase)
    .reduce((total, span) => total + Math.max(0, span.end_ms - span.start_ms), 0)])) as Record<R16PhaseV1, number>;
  const phaseLatency = Object.fromEntries(([
    "csv_import", "voyage", "discovery", "jev", "raw_storage", "postgres", "signal",
  ] as const).map(phase => {
    const spans = evidence.phases.filter(span => span.phase === phase).map(span => Math.max(0, span.end_ms - span.start_ms));
    return [phase, { p50_ms: percentileV1(spans, 0.5), p95_ms: percentileV1(spans, 0.95), span_count: spans.length }];
  })) as Record<R16PhaseV1, { p50_ms: number; p95_ms: number; span_count: number }>;
  return {
    root_count: roots, wall_ms: wallMs, roots_per_second: throughput,
    minimum_full_window_roots_per_second: minimumFullWindowRate, window_ms: windowMs,
    provider_p50_ms: percentileV1(evidence.provider.latency_ms, 0.5),
    provider_p95_ms: percentileV1(evidence.provider.latency_ms, 0.95),
    input_tokens_per_root: roots > 0 ? evidence.provider.input_tokens / roots : 0,
    provider_request_count: evidence.provider.requests,
    raw_page_count: evidence.raw_storage.pages.length,
    postgres_apply_batches: evidence.postgres.apply_batches,
    max_in_flight: Math.max(0, ...evidence.samples.map(sample => sample.in_flight)),
    max_in_flight_allowed: evidence.max_in_flight_allowed,
    max_buffered_bytes: Math.max(0, ...evidence.samples.map(sample => sample.buffered_bytes)),
    failure_count: evidence.failures.length,
    recovered_failure_count: evidence.failures.filter(failure => failure.outcome === "recovered").length,
    contained_unknown_failure_count: evidence.failures.filter(failure => failure.outcome === "contained_unknown").length,
    accepted: reasons.length === 0, rejected_reasons: [...new Set(reasons)],
    phase_durations_ms: durations, phase_latency_ms: phaseLatency,
    sustained_measurement_ms: Math.max(0, wallMs - sustainedStart), sustained_window_count: completeWindowCount,
    phase_durations_overlap: true,
  };
}

/** Monotonic span helper; the caller stores offsets from benchmark start. */
export function monotonicNowR16V1(): number {
  return performance.now();
}

export function makeR16PhaseSpanV1(phase: R16PhaseV1, roots: number, start_ms: number, end_ms = performance.now()): R16PhaseSpanV1 {
  return { phase, roots, start_ms, end_ms };
}
