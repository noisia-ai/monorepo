import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  BenchmarkError,
  createRequestCodecWorkloadsV1,
  parseRequestCodecBenchmarkArgsV1,
  runOwnedTempLifecycleV1,
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
    {case_id: 'defined_consumer_4_configured_2_selected', configured_questions: 4, base_questions: 2,
      candidate_questions_configured: 2, candidate_questions_selected: 2, request_questions: 2, calls: 1000,
      product_configuration_digest: `sha256:${digest}`, selected_consumer_keys_sha256: digest},
    {case_id: 'base_2_plus_4_noul_candidates', configured_questions: 6, base_questions: 2,
      candidate_questions_configured: 4, candidate_questions_selected: 4, request_questions: 6, calls: 1000},
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
    main_workload: {source_function: 'r16ListeningWorkloadV2', arm: 'defined_consumer_second_pass',
      configured_questions: 4, selected_consumer_questions: 2,
      configuration_digest: `sha256:${digest}`, selected_consumer_keys_sha256: digest},
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
  assert.equal(validateRequestCodecArtifactV1({contract: 'r16-request-codec-microbenchmark-v1', status: 'rejected',
    diagnostic_only: true, h1_accepted: false, gain_claim: false, reason_code: 'parity_failed',
    secondary_failure_codes: ['baseline_temp_cleanup_failed']}), true);
  assert.throws(() => validateRequestCodecArtifactV1({contract: 'r16-request-codec-microbenchmark-v1', status: 'rejected',
    diagnostic_only: true, h1_accepted: false, gain_claim: false, reason_code: 'parity_failed',
    secondary_failure_codes: ['/private/path']}));
  assert.throws(() => validateRequestCodecArtifactV1({contract: 'r16-request-codec-microbenchmark-v1', status: 'rejected',
    diagnostic_only: true, h1_accepted: false, gain_claim: false, reason_code: 'source_seal_failed', trials: []}));
  assert.throws(() => validateRequestCodecArtifactV1({contract: 'r16-request-codec-microbenchmark-v1', status: 'verified',
    diagnostic_only: true, h1_accepted: true, gain_claim: false}));
});

test('Main fixture is derived from the target product workload and the selection is its two consumer questions', async () => {
  const targetRoot = process.env.R16_REQUEST_CODEC_TARGET_ROOT;
  assert.ok(targetRoot, 'target root is required for the product workload contract');
  const codec = await import(pathToFileURL(join(targetRoot, 'packages/query-engine/src/signal-listening-contracts.ts')).href);
  const workloadModule = await import(pathToFileURL(join(targetRoot, 'scripts/r16/listening-workload.ts')).href);
  const productWorkload = workloadModule.r16ListeningWorkloadV2('defined_consumer_second_pass');
  const workloads = createRequestCodecWorkloadsV1(codec, workloadModule, 3);
  const main = workloads[0];
  const expectedSelection = codec.selectSignalListeningQuestionsV1(productWorkload.configuration, [])
    .filter(question => question.scope === 'consumer_category' && question.type === 'noul' && question.topic_source === 'defined')
    .map(question => question.key).sort();
  assert.equal(main.configuration.questions.length, 4);
  assert.deepEqual(main.configuration, productWorkload.configuration);
  assert.deepEqual(main.selected_keys, expectedSelection);
  assert.equal(main.selected_keys.length, 2);
  assert.equal(main.inputs.length, 3);
  assert.deepEqual(workloads.map(item => [item.configuration.questions.length, item.selected_keys.length]), [[4, 2], [6, 6]]);
});

test('owned baseline lifecycle preserves the primary failure, attempts cleanup and postchecks, and rejects any secondary failure', async () => {
  const calls = [];
  await assert.rejects(runOwnedTempLifecycleV1({
    create: async () => calls.push('create'),
    body: async () => { calls.push('body'); throw new BenchmarkError('parity_failed'); },
    cleanup: async () => { calls.push('cleanup'); throw new Error('/private/raw/path'); },
    postcheck: async () => { calls.push('postcheck'); return ['target_source_cleanup_failed']; },
  }), error => {
    assert.equal(error.code, 'parity_failed');
    assert.deepEqual(error.secondaryFailureCodes, ['baseline_temp_cleanup_failed', 'target_source_cleanup_failed']);
    assert.equal(error.message, 'parity_failed');
    assert.equal(JSON.stringify(error).includes('/private/raw/path'), false);
    return true;
  });
  assert.deepEqual(calls, ['create', 'body', 'cleanup', 'postcheck']);
  await assert.rejects(runOwnedTempLifecycleV1({
    create: async () => {}, body: async () => 'result', cleanup: async () => {},
    postcheck: async () => ['probe_source_cleanup_failed'],
  }), error => error.code === 'probe_source_cleanup_failed');
});
