import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseRequestCodecBenchmarkArgsV1,
  validateRequestCodecArtifactV1,
  REQUEST_CODEC_BASE_SHA,
  REQUEST_CODEC_TRIAL_ORDER,
} from './request-codec-benchmark.mjs';

const targetSha = 'a'.repeat(40);
const probeSha = 'b'.repeat(40);
const digest = 'c'.repeat(64);
const args = ['--run', '--target-root', '/tmp/target', '--target-sha', targetSha,
  '--probe-root', '/tmp/probe', '--probe-sha', probeSha, '--artifact', '/tmp/run/request-codec-benchmark.json'];

function positive() {
  const workloads = [
    {case_id: 'defined_consumer_4_configured_2_selected', base_questions: 2, candidate_questions_configured: 4,
      candidate_questions_selected: 2, request_questions: 4, calls: 1000},
    {case_id: 'base_2_plus_4_noul_candidates', base_questions: 2, candidate_questions_configured: 4,
      candidate_questions_selected: 4, request_questions: 6, calls: 1000},
  ];
  const parity = workloads.map(item => ({case_id: item.case_id, verified_calls: 1000, request_bytes: 100_000,
    paired_output_sha256: digest, timing_checksum: 7}));
  const trials = workloads.flatMap(item => REQUEST_CODEC_TRIAL_ORDER.map((arm, index) => ({case_id: item.case_id,
    arm, order_index: index + 1, calls: 1000, wall_ns: '1000000', cpu_user_us: 500, cpu_system_us: 0,
    rss_before_bytes: 1000, rss_after_bytes: 2000, heap_before_bytes: 500, heap_after_bytes: 600,
    http_bytes: 100_000, checksum: 7})));
  return {
    contract: 'r16-request-codec-microbenchmark-v1', status: 'verified', diagnostic_only: true,
    h1_accepted: false, gain_claim: false, base_source_sha: REQUEST_CODEC_BASE_SHA,
    baseline_module_sha256: digest, baseline_module_bytes: 100, candidate_module_sha256: digest, candidate_module_bytes: 110,
    requested_target_sha: targetSha, target_git_sha_before: targetSha, target_git_sha_after: targetSha,
    requested_probe_sha: probeSha, probe_git_sha_before: probeSha, probe_git_sha_after: probeSha,
    node_version: 'v22.0.0', pnpm_version: '10.33.2', lockfile_sha256: digest,
    environment_fingerprint_sha256: digest, process_cpu_scope: 'process_cpu_usage_includes_all_threads',
    timing: {wall_clock: 'process.hrtime.bigint', cpu_clock: 'process.cpuUsage delta',
      timing_includes_sink_and_byte_count_bookkeeping: true, overhead_subtracted: false},
    snapshot_preparation: {function: 'compileSignalListeningSnapshotV1', calls_per_arm_case: 1, included_in_trials: false},
    workloads, parity, trials, trial_order: [...REQUEST_CODEC_TRIAL_ORDER], warmup_calls_per_arm_case: 100,
    interpretation: {whole_pipeline_gain: false, cpu_function_attribution: false, causality_claim: false},
  };
}

test('request codec benchmark CLI accepts exact manual arguments and rejects duplicates or malformed refs', () => {
  const parsed = parseRequestCodecBenchmarkArgsV1(args);
  assert.equal(parsed.targetSha, targetSha);
  assert.equal(parsed.probeSha, probeSha);
  assert.equal(parsed.artifactPath, '/tmp/run/request-codec-benchmark.json');
  assert.throws(() => parseRequestCodecBenchmarkArgsV1(args.filter((_, index) => index !== 0)), /cli_arguments_invalid/u);
  assert.throws(() => parseRequestCodecBenchmarkArgsV1([...args, '--target-sha', targetSha]), /cli_arguments_invalid/u);
  assert.throws(() => parseRequestCodecBenchmarkArgsV1(args.map(value => value === targetSha ? 'bad-sha' : value)), /cli_arguments_invalid/u);
});

test('request codec benchmark artifact validates two workloads, parity and ABBA trial order', () => {
  const value = positive();
  assert.equal(validateRequestCodecArtifactV1(value), true);
  const wrongOrder = structuredClone(value);
  wrongOrder.trials[0].arm = 'new';
  assert.throws(() => validateRequestCodecArtifactV1(wrongOrder));
  const wrongCalls = structuredClone(value);
  wrongCalls.trials[0].calls = 999;
  assert.throws(() => validateRequestCodecArtifactV1(wrongCalls));
  const wrongWorkload = structuredClone(value);
  wrongWorkload.workloads[1].candidate_questions_selected = 3;
  assert.throws(() => validateRequestCodecArtifactV1(wrongWorkload));
  const wrongTarget = structuredClone(value);
  wrongTarget.target_git_sha_after = 'd'.repeat(40);
  assert.throws(() => validateRequestCodecArtifactV1(wrongTarget));
});

test('request codec failure receipt is bounded and cannot contain positive timings', () => {
  assert.equal(validateRequestCodecArtifactV1({contract: 'r16-request-codec-microbenchmark-v1', status: 'rejected',
    diagnostic_only: true, h1_accepted: false, gain_claim: false, reason_code: 'source_seal_failed'}), true);
  assert.throws(() => validateRequestCodecArtifactV1({contract: 'r16-request-codec-microbenchmark-v1', status: 'rejected',
    diagnostic_only: true, h1_accepted: false, gain_claim: false, reason_code: 'source_seal_failed', trials: []}));
  assert.throws(() => validateRequestCodecArtifactV1({contract: 'r16-request-codec-microbenchmark-v1', status: 'verified',
    diagnostic_only: true, h1_accepted: true, gain_claim: false}));
});
