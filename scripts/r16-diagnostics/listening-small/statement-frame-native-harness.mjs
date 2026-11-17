import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const STATEMENT_FRAME_NATIVE_CONTRACT_V1 = 'r16-statement-frame-native-oracle-v1';
export const STATEMENT_FRAME_NATIVE_RECEIPT_V1 = 'r16-diagnostic-statement-frame-native-v1';
export const STATEMENT_FRAME_NATIVE_RESULT_LIMIT_V1 = 256 * 1024;
export const STATEMENT_FRAME_NATIVE_TAP_LIMIT_V1 = 2_000_000;
export const STATEMENT_FRAME_NATIVE_TITLES_V1 = Object.freeze([
  'D frame native bytes preserve every shape and malformed mixed all-attempt guards',
  'D frame native prior unknown and freshness remain authoritative',
  'D frame native CDDC compares 1000 consumer calls with complete CPU brackets',
  'D frame native concurrent same-key reservations remain idempotent',
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readTAPCount(tap, name) {
  const matches = [...tap.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gmu'))];
  assert.equal(matches.length, 1, 'statement_frame_tap_summary_invalid');
  const value = Number(matches[0][1]);
  assert.ok(Number.isSafeInteger(value), 'statement_frame_tap_summary_invalid');
  return value;
}

export function parseStatementFrameNativeTAPV1(input, {exitStatus, targetSha, probeSha, targetBefore = targetSha, targetAfter = targetSha,
  probeBefore = probeSha, probeAfter = probeSha, sourceDeclarations, sourceFiles}) {
  const tapBytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assert.ok(tapBytes.byteLength <= STATEMENT_FRAME_NATIVE_TAP_LIMIT_V1, 'statement_frame_tap_too_large');
  const tap = tapBytes.toString('utf8');
  assert.equal(exitStatus, 0, 'statement_frame_native_exit_invalid');
  assert.match(targetSha ?? '', /^[0-9a-f]{40}$/u, 'statement_frame_target_sha_invalid');
  assert.match(probeSha ?? '', /^[0-9a-f]{40}$/u, 'statement_frame_probe_sha_invalid');
  assert.equal(targetBefore, targetSha, 'statement_frame_target_before_mismatch');
  assert.equal(targetAfter, targetSha, 'statement_frame_target_after_mismatch');
  assert.equal(probeBefore, probeSha, 'statement_frame_probe_before_mismatch');
  assert.equal(probeAfter, probeSha, 'statement_frame_probe_after_mismatch');

  const tests = [...tap.matchAll(/^ok (\d+) - (.+)$/gmu)].map(match => ({
    number: Number(match[1]),
    title: match[2].replace(/ # (?:SKIP|TODO)(?: .*)?$/u, ''),
    skipped: / # SKIP(?: |$)/u.test(match[2]),
    todo: / # TODO(?: |$)/u.test(match[2]),
  }));
  assert.equal(tests.length, STATEMENT_FRAME_NATIVE_TITLES_V1.length, 'statement_frame_native_test_count_invalid');
  assert.deepEqual(tests.map(test => test.number), [1, 2, 3, 4], 'statement_frame_native_test_numbers_invalid');
  assert.deepEqual(tests.map(test => test.title), [...STATEMENT_FRAME_NATIVE_TITLES_V1], 'statement_frame_native_titles_invalid');
  assert.ok(tests.every(test => !test.skipped && !test.todo), 'statement_frame_native_test_not_run');

  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(name => [name, readTAPCount(tap, name)]));
  assert.deepEqual(counts, {tests: 4, pass: 4, fail: 0, cancelled: 0, skipped: 0}, 'statement_frame_native_counts_invalid');

  const prefixes = [
    '# statement frame RESULT ',
    '# # statement frame RESULT ',
    '# \\# statement frame RESULT ',
  ];
  const lines = tap.split(/\r?\n/u);
  const resultLines = lines.flatMap((line, index) => {
    const prefix = prefixes.find(candidate => line.startsWith(candidate));
    return prefix ? [{line, prefix, index}] : [];
  });
  assert.equal(resultLines.length, 1, 'statement_frame_result_line_count_invalid');
  let resultText = resultLines[0].line.slice(resultLines[0].prefix.length);
  let result;
  for (let index = resultLines[0].index; index < lines.length; index++) {
    const candidateBytes = Buffer.from(resultText);
    assert.ok(candidateBytes.byteLength > 0 && candidateBytes.byteLength <= STATEMENT_FRAME_NATIVE_RESULT_LIMIT_V1,
      'statement_frame_result_size_invalid');
    try {
      result = JSON.parse(resultText);
      break;
    } catch {
      const continuation = lines[index + 1];
      if (typeof continuation !== 'string' || !continuation.startsWith('# ')
        || continuation.startsWith('# Subtest:') || /^# (?:duration_ms|tests|pass|fail|cancelled|skipped|todo)\b/u.test(continuation)) {
        throw new Error('statement_frame_result_json_invalid');
      }
      resultText += continuation.slice(2);
    }
  }
  assert.ok(result && typeof result === 'object', 'statement_frame_result_json_invalid');
  const resultBytes = Buffer.from(resultText);
  assert.ok(result && typeof result === 'object' && !Array.isArray(result), 'statement_frame_result_invalid');
  assert.equal(result.contract, STATEMENT_FRAME_NATIVE_CONTRACT_V1, 'statement_frame_result_contract_invalid');
  assert.equal(result.status, 'observed', 'statement_frame_result_status_invalid');
  assert.equal(result.test_only, true, 'statement_frame_result_test_only_invalid');
  assert.equal(result.h1_accepted, false, 'statement_frame_result_h1_invalid');
  assert.equal(result.gain_claim, false, 'statement_frame_result_gain_claim_invalid');
  assert.equal(result.migration_created, false, 'statement_frame_result_migration_invalid');
  assert.equal(result.source, targetSha, 'statement_frame_result_target_mismatch');
  assert.equal(result.probe, probeSha, 'statement_frame_result_probe_mismatch');
  assert.equal(result.base_source, 'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1', 'statement_frame_base_source_invalid');
  assert.ok(Array.isArray(result.failures) && result.failures.length === 0, 'statement_frame_result_failures_present');
  assert.ok(Array.isArray(result.paired) && result.paired.length === 2, 'statement_frame_paired_scenarios_invalid');
  assert.ok(Array.isArray(result.source6) && result.source6.length === 6, 'statement_frame_source_seal_invalid');
  assert.ok(Array.isArray(result.new_files) && result.new_files.length === 3, 'statement_frame_new_source_seal_invalid');
  if (sourceDeclarations) assert.deepEqual(result.source6, sourceDeclarations, 'statement_frame_source6_mismatch');
  const expectedNewFiles = [
    'signal-listening-statement-frame.oracle.ts',
    'signal-listening-statement-frame.test.ts',
    'signal-listening-statement-frame.postgres.test.ts',
  ];
  assert.deepEqual(result.new_files.map(item => item.file), expectedNewFiles, 'statement_frame_new_source_paths_invalid');
  assert.ok(result.new_files.every(item => /^sha256:[0-9a-f]{64}$/.test(`sha256:${item.sha256}`)),
    'statement_frame_new_source_hash_invalid');
  if (sourceFiles) {
    assert.deepEqual(Object.keys(sourceFiles).sort(), [...expectedNewFiles].sort(), 'statement_frame_actual_source_paths_invalid');
    for (const item of result.new_files) assert.equal(item.sha256, sha256(sourceFiles[item.file]), 'statement_frame_actual_source_hash_mismatch');
  }
  assert.equal(result.source_c_sha256, 'cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5', 'statement_frame_C_hash_invalid');
  assert.equal(result.source_d_sha256, 'da02dc85af77662ac1c352490a4078f45bd5c69e688227b076081557863fb500', 'statement_frame_D_hash_invalid');
  assert.deepEqual(result.byte_oracle, {
    native_rows: 35,
    subsets: 32,
    maximum_question_keys: 256,
    representation_rows: 19,
    fast_path_rows: result.byte_oracle?.fast_path_rows,
    fallback_rows: result.byte_oracle?.fallback_rows,
    every_shape_distinct_rows: 1000,
    every_shape_distinct_fallback_rows: 1000,
    bytes_equal: true,
    full_sha_equal: true,
    eight_typed_fields_equal: true,
    multiplicity_equal: true,
    independent_complete_validator_bag_rows: 36,
    representation_ids_unique_enforced: true,
    dynamic_run_context_rebound_equal: true,
  }, 'statement_frame_byte_oracle_invalid');
  assert.ok(Number.isSafeInteger(result.byte_oracle.fast_path_rows) && result.byte_oracle.fast_path_rows > 0
    && Number.isSafeInteger(result.byte_oracle.fallback_rows) && result.byte_oracle.fallback_rows > 0,
    'statement_frame_byte_oracle_coverage_invalid');
  assert.equal(result.inverse_restores_C, true, 'statement_frame_inverse_invalid');
  assert.equal(result.control_subtracted, false, 'statement_frame_control_subtracted_invalid');
  assert.equal(result.memory_claim, false, 'statement_frame_memory_claim_invalid');
  assert.equal(result.capacity_claim, false, 'statement_frame_capacity_claim_invalid');
  assert.equal(result.physical_http_attempts, 0, 'statement_frame_physical_http_attempts_invalid');
  assert.equal(result.workers_cpu, 'unknown', 'statement_frame_worker_cpu_claim_invalid');
  assert.equal(result.sql_function_cpu, 'unknown', 'statement_frame_function_cpu_claim_invalid');
  assert.equal(result.cpu_scope, 'leader_backend_brackets_include_probes', 'statement_frame_cpu_scope_invalid');
  assert.equal(result.proc_reads_observed, 88, 'statement_frame_cpu_read_count_invalid');
  const validCpu = sample => sample?.scope === 'leader_backend_cpu_between_proc_read_points'
    && sample.includes_probes === true && sample.control_subtracted === false && sample.worker_cpu === 'unknown'
    && ['user_ticks','system_ticks','total_ticks','user_ns','system_ns','total_ns','clk_tck','tick_resolution_ns'].every(key =>
      typeof sample[key] === 'string' && /^[0-9]+$/.test(sample[key]))
    && (sample.zero_interpretation === null || sample.zero_interpretation === 'no_observed_tick_increment');
  assert.deepEqual(result.all_attempts.map(item => [item.arm, item.defect, item.rejected]), [
    ...['C', 'D'].flatMap(arm => ['text', 'digest', 'question_digest', 'duplicate', 'input', 'map', 'configuration', 'basis', 'empty']
      .map(defect => [arm, defect, true])),
    ['C', 'physical_lease_expired', true], ['D', 'physical_lease_expired', true],
  ], 'statement_frame_all_attempts_invalid');
  assert.deepEqual(result.prior, {real_unknown: true, invalid_prior_equal: true, new_request_rejected: true}, 'statement_frame_prior_invalid');
  assert.equal(result.defaults.length, 6, 'statement_frame_default_receipt_count_invalid');
  for (const pair of result.defaults) {
    assert.equal(pair.before?.runtime_kind, 'C', 'statement_frame_default_before_not_C');
    assert.equal(pair.after?.runtime_kind, 'C', 'statement_frame_default_after_not_C');
    assert.deepEqual(pair.after, pair.before, 'statement_frame_default_changed');
  }
  const expectedScenarios = ['main_defined_consumer_4_configured_2_selected', '1000_distinct_fresh_subsets_12_configured'];
  assert.deepEqual(result.paired.map(item => item.scenario), expectedScenarios, 'statement_frame_scenarios_invalid');
  for (const [index, pair] of result.paired.entries()) {
    const distinct = index === 1;
    assert.equal(pair.configured_questions, distinct ? 12 : 4, 'statement_frame_configured_questions_invalid');
    assert.equal(pair.dimensions?.calls, 1000, 'statement_frame_call_count_invalid');
    assert.equal(pair.dimensions?.distinct_exact_shapes, distinct ? 1000 : 1, 'statement_frame_distinct_shapes_invalid');
    assert.equal(pair.dimensions?.client_text_recorded, false, 'statement_frame_client_text_recorded');
    assert.deepEqual(pair.order, ['C', 'D', 'D', 'C'], 'statement_frame_order_invalid');
    assert.equal(pair.SELECT?.length, 4, 'statement_frame_select_count_invalid');
    assert.deepEqual(pair.SELECT.map(item => item.arm), ['C', 'D', 'D', 'C'], 'statement_frame_select_order_invalid');
    assert.ok(pair.SELECT.every(item => item.validated_calls === 1000 && item.cpu?.worker_cpu === 'unknown'
      && item.cpu?.control_subtracted === false && item.stage === `validator_${item.arm}` && validCpu(item.cpu)
      && /^([0-9a-f]{64})$/.test(item.result_sha256 ?? '')
      && item.flags?.invalid_questions === false && item.flags?.invalid_request === false && item.flags?.invalid_prior === false),
      'statement_frame_select_measurement_invalid');
    assert.equal(new Set(pair.SELECT.map(item => item.result_sha256)).size, 1, 'statement_frame_select_result_hash_changed');
    assert.equal(pair.DML?.length, 4, 'statement_frame_dml_count_invalid');
    assert.deepEqual(pair.DML.map(item => item.arm), ['C', 'D', 'D', 'C'], 'statement_frame_dml_order_invalid');
    assert.ok(pair.DML.every(item => item.result_count === 1000 && item.committed === false
      && item.constraints_forced_before_rollback === true && item.stages?.length === 3
      && item.stages.map(stage => stage.stage).join(',') === 'insert,mark,constraints'
      && item.stages.every(stage => validCpu(stage.cpu))),
      'statement_frame_dml_measurement_invalid');
    assert.equal(new Set(pair.DML.map(item => item.result_sha256)).size, 1, 'statement_frame_dml_result_hash_changed');
    assert.equal(new Set(pair.DML.map(item => item.baseline_sha256)).size, 1, 'statement_frame_dml_baseline_changed');
    assert.ok(pair.DML.every(item => item.exposure_micro_usd === (distinct ? '500000' : '506012')),
      'statement_frame_dml_exposure_invalid');
    assert.equal(pair.controls?.length, 10, 'statement_frame_control_count_invalid');
    assert.deepEqual(pair.controls.map(item => item.phase), ['select_before','select_after',
      'dml_before','dml_after','dml_before','dml_after','dml_before','dml_after','dml_before','dml_after'],
      'statement_frame_control_phases_invalid');
    assert.ok(pair.controls.every(item => validCpu(item.cpu)), 'statement_frame_controls_invalid');
    assert.equal(pair.same_select_snapshot, true, 'statement_frame_select_snapshot_invalid');
    assert.equal(pair.fresh_dml_transactions, true, 'statement_frame_dml_transaction_invalid');
    assert.equal(pair.dml_same_snapshot, false, 'statement_frame_dml_snapshot_claim_invalid');
  }
  assert.deepEqual(result.concurrent.map(item => item.arm), ['C', 'D'], 'statement_frame_concurrency_arms_invalid');
  assert.ok(result.concurrent.every(item => item.calls === 1000 && item.reserve_attempts === 2
    && item.same_durable_ids === true && item.mark_successes === 1 && item.second_mark_rejected === true
    && item.no_provider_attempts === true), 'statement_frame_concurrency_invalid');
  const validHz = sample => {
    assert.ok(typeof sample?.clk_tck === 'string' && /^[1-9][0-9]{0,9}$/.test(sample.clk_tck), 'statement_frame_clock_tick_rate_invalid');
    assert.equal(sample.interval_ms, 0, 'statement_frame_cpu_interval_invalid');
    assert.equal(sample.stopped_before_queries, true, 'statement_frame_cpu_sampling_overlap_invalid');
    assert.ok(sample.collector && sample.collector.docker_endpoint === 'unix:///var/run/docker.sock'
      && /^sha256:[0-9a-f]{64}$/.test(sample.collector.os_script_sha256 ?? '')
      && /^sha256:[0-9a-f]{64}$/.test(sample.collector.inspect_format_sha256 ?? ''), 'statement_frame_collector_seal_invalid');
    assert.ok(sample.ownership && /^sha256:[0-9a-f]{64}$/.test(sample.ownership.marker_sha256 ?? '')
      && /^sha256:[0-9a-f]{64}$/.test(sample.ownership.container_id_sha256 ?? '')
      && /^sha256:[0-9a-f]{64}$/.test(sample.ownership.postgres_system_identifier_sha256 ?? '')
      && /^sha256:[0-9a-f]{64}$/.test(sample.ownership.image_id ?? '')
      && typeof sample.ownership.started_at === 'string' && !Number.isNaN(Date.parse(sample.ownership.started_at)),
      'statement_frame_lab_ownership_invalid');
    assert.ok(sample.postmaster && Number.isSafeInteger(sample.postmaster.pid) && sample.postmaster.pid > 0
      && typeof sample.postmaster.starttime_ticks === 'string' && /^[0-9]+$/.test(sample.postmaster.starttime_ticks),
      'statement_frame_postmaster_identity_invalid');
    assert.ok(Array.isArray(sample.brackets) && sample.brackets.length === 2
      && sample.brackets.every(item => typeof item.label === 'string'
        && /^[0-9]{1,30}$/.test(item.bracket?.start_ns ?? '') && /^[0-9]{1,30}$/.test(item.bracket?.end_ns ?? '')
        && BigInt(item.bracket.end_ns) >= BigInt(item.bracket.start_ns)), 'statement_frame_cpu_brackets_invalid');
  };
  validHz(result.hz_before);
  validHz(result.hz_after);
  assert.equal(result.hz_before.clk_tck, result.hz_after.clk_tck, 'statement_frame_clock_tick_rate_invalid');
  assert.deepEqual(result.hz_after?.ownership, result.hz_before?.ownership, 'statement_frame_owned_lab_changed');
  assert.deepEqual(result.hz_after?.postmaster, result.hz_before?.postmaster, 'statement_frame_postmaster_changed');

  const resultSha256 = sha256(resultBytes);
  return {
    contract: STATEMENT_FRAME_NATIVE_RECEIPT_V1,
    status: 'verified',
    diagnostic_only: true,
    h1_accepted: false,
    requested_target_sha: targetSha,
    target_git_sha_before: targetBefore,
    target_git_sha_after: targetAfter,
    requested_probe_sha: probeSha,
    probe_git_sha_before: probeBefore,
    probe_git_sha_after: probeAfter,
    test_file: 'infrastructure/db/migrations/signal-listening-statement-frame.postgres.test.ts',
    exit_status: exitStatus,
    counts,
    titles: tests.map(test => test.title),
    tap_file: 'statement-frame.native.tap',
    tap_sha256: sha256(tapBytes),
    result_sha256: resultSha256,
    native_result: result,
  };
}

export function parseStatementFramePureTAPV1(input, {exitStatus, targetSha, probeSha}) {
  const tapBytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assert.ok(tapBytes.byteLength <= STATEMENT_FRAME_NATIVE_TAP_LIMIT_V1, 'statement_frame_pure_tap_too_large');
  const tap = tapBytes.toString('utf8');
  assert.equal(exitStatus, 0, 'statement_frame_pure_exit_invalid');
  assert.match(targetSha ?? '', /^[0-9a-f]{40}$/u, 'statement_frame_target_sha_invalid');
  assert.match(probeSha ?? '', /^[0-9a-f]{40}$/u, 'statement_frame_probe_sha_invalid');
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(name => [name, readTAPCount(tap, name)]));
  assert.deepEqual(counts, {tests: 9, pass: 9, fail: 0, cancelled: 0, skipped: 0}, 'statement_frame_pure_counts_invalid');
  const titles = [...tap.matchAll(/^ok \d+ - (.+)$/gmu)].map(match => match[1].replace(/ # (?:SKIP|TODO)(?: .*)?$/u, ''));
  assert.equal(new Set(titles).size, 9, 'statement_frame_pure_titles_invalid');
  assert.ok(!/^not ok /mu.test(tap) && !/^ok \d+ - .+ # (?:SKIP|TODO)(?: |$)/mu.test(tap), 'statement_frame_pure_test_not_run');
  return {
    contract: 'r16-diagnostic-pure-suite-v1',
    status: 'verified',
    diagnostic_only: true,
    h1_accepted: false,
    requested_target_sha: targetSha,
    target_git_sha_before: targetSha,
    target_git_sha_after: targetSha,
    requested_probe_sha: probeSha,
    probe_git_sha_before: probeSha,
    probe_git_sha_after: probeSha,
    test_file: 'infrastructure/db/migrations/signal-listening-statement-frame.test.ts',
    exit_status: exitStatus,
    counts,
    tap_file: 'statement-frame.pure.tap',
    tap_sha256: sha256(tapBytes),
  };
}
