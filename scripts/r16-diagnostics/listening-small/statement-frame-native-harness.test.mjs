import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseStatementFrameNativeTAPV1, parseStatementFramePureTAPV1, STATEMENT_FRAME_NATIVE_TITLES_V1,
  STATEMENT_FRAME_PURE_TITLES_V1} from './statement-frame-native-harness.mjs';

const targetSha = 'a'.repeat(40);
const probeSha = 'b'.repeat(40);
const counts = '# tests 4\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n';
function report(overrides = {}) {
  const cpu = {scope:'leader_backend_cpu_between_proc_read_points',includes_probes:true,worker_cpu:'unknown',control_subtracted:false,
    user_ticks:'1',system_ticks:'0',total_ticks:'1',user_ns:'1000000',system_ns:'0',total_ns:'1000000',clk_tck:'100',
    tick_resolution_ns:'10000000',zero_interpretation:null};
  const paired = (scenario, configuredQuestions, distinctShapes) => ({
    scenario, configured_questions: configuredQuestions,
    dimensions: {calls: 1000, selected_question_counts: configuredQuestions === 4 ? [2] : [2,3,4,5,6,7,8,9,10,11,12],
      distinct_exact_shapes: distinctShapes, client_text_recorded: false},
    order: ['C','D','D','C'], SELECT: ['C','D','D','C'].map(arm => ({arm,stage:`validator_${arm}`,validated_calls:1000,
      result_sha256:'d'.repeat(64),flags:{invalid_questions:false,invalid_request:false,invalid_prior:false},cpu})),
    DML: ['C','D','D','C'].map(arm => ({arm,result_count:1000,committed:false,constraints_forced_before_rollback:true,
      result_sha256:'d'.repeat(64),baseline_sha256:'e'.repeat(64),exposure_micro_usd:distinctShapes===1000?'500000':'506012',
      stages:[{stage:'insert',cpu},{stage:'mark',cpu},{stage:'constraints',cpu}]})),
    controls:[{phase:'select_before',cpu},{phase:'select_after',cpu},...['C','D','D','C'].flatMap(()=>[
      {phase:'dml_before',cpu},{phase:'dml_after',cpu}])], same_select_snapshot:true, fresh_dml_transactions:true, dml_same_snapshot:false,
  });
  const allAttempts = [
    ...['C','D'].flatMap(arm => ['text','digest','question_digest','duplicate','input','map','configuration','basis','empty']
      .map(defect => ({arm,defect,rejected:true}))),
    {arm:'C',defect:'physical_lease_expired',rejected:true},{arm:'D',defect:'physical_lease_expired',rejected:true},
  ];
  const before = {runtime_kind:'C',metadata:{synthetic:true}};
  const ownership = {marker_sha256:'a'.repeat(64),container_id_sha256:'b'.repeat(64),
    postgres_system_identifier_sha256:'c'.repeat(64),image_id:'sha256:'+'d'.repeat(64),started_at:'2026-11-16T00:00:00.000Z'};
  const owned = {clk_tck:'100',ownership,postmaster:{pid:1,starttime_ticks:'2'},interval_ms:0,stopped_before_queries:true,
    collector:{docker_endpoint:'unix:///var/run/docker.sock',os_script_sha256:'e'.repeat(64),inspect_format_sha256:'f'.repeat(64)},
    brackets:[{label:'collector_start',bracket:{start_ns:'1',end_ns:'2'}},{label:'collector_stop',bracket:{start_ns:'3',end_ns:'4'}}]};
  return {
    contract: 'r16-statement-frame-native-oracle-v1', status: 'observed', test_only: true,
    h1_accepted: false, gain_claim: false, migration_created: false,
    source: targetSha, probe: probeSha, base_source:'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1',
    inverse_restores_C: true, source6: Array.from({length: 6}, () => ({sha256: 'a'})),
    new_files: ['signal-listening-statement-frame.oracle.ts','signal-listening-statement-frame.test.ts','signal-listening-statement-frame.postgres.test.ts']
      .map(file => ({file,sha256:'c'.repeat(64)})),
    source_c_sha256:'cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5',
    source_d_sha256:'da02dc85af77662ac1c352490a4078f45bd5c69e688227b076081557863fb500',
    failures: [], paired: [paired('main_defined_consumer_4_configured_2_selected',4,1),
      paired('1000_distinct_fresh_subsets_12_configured',12,1000)],
    defaults:Array.from({length:6},()=>({before,after:before})),
    all_attempts:allAttempts,prior:{real_unknown:true,invalid_prior_equal:true,new_request_rejected:true},
    byte_oracle:{native_rows:35,subsets:32,maximum_question_keys:256,representation_rows:19,fast_path_rows:8,fallback_rows:11,
      every_shape_distinct_rows:1000,every_shape_distinct_fallback_rows:1000,bytes_equal:true,full_sha_equal:true,
      eight_typed_fields_equal:true,multiplicity_equal:true,independent_complete_validator_bag_rows:36,
      representation_ids_unique_enforced:true,dynamic_run_context_rebound_equal:true},
    concurrent:['C','D'].map(arm=>({arm,calls:1000,reserve_attempts:2,same_durable_ids:true,mark_successes:1,
      second_mark_rejected:true,no_provider_attempts:true})),
    hz_before:owned,hz_after:structuredClone(owned),proc_reads_observed:88,
    cpu_scope:'leader_backend_brackets_include_probes',workers_cpu:'unknown',sql_function_cpu:'unknown',control_subtracted:false,
    memory_claim:false,capacity_claim:false,physical_http_attempts:0,
    ...overrides,
  };
}
function nativeTap(result = report(), {prefix = '# # statement frame RESULT ', titleLines = STATEMENT_FRAME_NATIVE_TITLES_V1,
  summary = counts} = {}) {
  const resultLine = `${prefix}${JSON.stringify(result)}`;
  const titleLinesText = titleLines.map((title, index) => `ok ${index + 1} - ${title}`).join('\n');
  return Buffer.from(`TAP version 13\n${titleLinesText}\n${resultLine}\n${summary}`);
}

test('D native harness accepts exact four titles, nested RESULT, and sealed C/D receipt', () => {
  for (const prefix of ['# statement frame RESULT ', '# # statement frame RESULT ', '# \\# statement frame RESULT ']) {
    const receipt = parseStatementFrameNativeTAPV1(nativeTap(report(), {prefix}), {exitStatus: 0, targetSha, probeSha});
    assert.equal(receipt.status, 'verified');
    assert.equal(receipt.native_result.contract, 'r16-statement-frame-native-oracle-v1');
    assert.equal(receipt.native_result.source, targetSha);
    assert.equal(receipt.counts.tests, 4);
    assert.equal(receipt.result_sha256, createHash('sha256').update(JSON.stringify(report())).digest('hex'));
  }
});

test('D native harness accepts the actual Node test-runner TAP encoding', () => {
  const directory = mkdtempSync(join(tmpdir(), 'r16-frame-tap-'));
  try {
    const fixturePath = join(directory, 'native-output.test.mjs');
    const source = [
      "import test from 'node:test';",
      `console.log('# statement frame RESULT '+${JSON.stringify(JSON.stringify(report()))});`,
      ...STATEMENT_FRAME_NATIVE_TITLES_V1.map(title => `test(${JSON.stringify(title)},()=>{});`),
    ].join('\n');
    writeFileSync(fixturePath, source, {mode: 0o600, flag: 'wx'});
    const childEnv = {...process.env, NODE_OPTIONS: '--max-old-space-size=384'};
    delete childEnv.NODE_TEST_CONTEXT;
    const emitted = spawnSync(process.execPath, ['--test', '--test-reporter=tap', fixturePath], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024, env: childEnv,
    });
    assert.equal(emitted.error, undefined);
    assert.equal(emitted.status, 0, 'native TAP emitter fixture must pass');
    const receipt = parseStatementFrameNativeTAPV1(Buffer.from(emitted.stdout), {exitStatus: emitted.status, targetSha, probeSha});
    assert.equal(receipt.counts.pass, 4);
    assert.equal(receipt.result_sha256, createHash('sha256').update(JSON.stringify(report())).digest('hex'));
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('D native harness rejects missing, duplicated, malformed, or synthetic-altered RESULT lines', () => {
  const good = nativeTap();
  assert.throws(() => parseStatementFrameNativeTAPV1(good, {exitStatus: 1, targetSha, probeSha}), /statement_frame_native_exit_invalid/u);
  assert.throws(() => parseStatementFrameNativeTAPV1(Buffer.from(good.toString().replace(/# # statement frame RESULT .*\n/u, '')),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_result_line_count_invalid/u);
  assert.throws(() => parseStatementFrameNativeTAPV1(Buffer.from(`${good.toString()}# # statement frame RESULT {}\n`),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_result_line_count_invalid/u);
  assert.throws(() => parseStatementFrameNativeTAPV1(Buffer.from(good.toString().replace(/\{[^\n]*\}/u, '{invalid}')),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_result_json_invalid/u);
  assert.throws(() => parseStatementFrameNativeTAPV1(nativeTap(report({source: probeSha})),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_result_target_mismatch/u);
});

test('D native harness rejects skips, extra titles, and nonzero TAP summary even with RESULT present', () => {
  const skippedTitle = [...STATEMENT_FRAME_NATIVE_TITLES_V1];
  skippedTitle[0] += ' # SKIP not run';
  assert.throws(() => parseStatementFrameNativeTAPV1(nativeTap(report(), {titleLines: skippedTitle}),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_native_titles_invalid|statement_frame_native_test_not_run/u);
  assert.throws(() => parseStatementFrameNativeTAPV1(nativeTap(report(), {titleLines: [...STATEMENT_FRAME_NATIVE_TITLES_V1, 'extra']}),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_native_test_count_invalid/u);
  assert.throws(() => parseStatementFrameNativeTAPV1(nativeTap(report(), {summary: '# tests 4\n# pass 3\n# fail 1\n# cancelled 0\n# skipped 0\n'}),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_native_counts_invalid/u);
});

test('D pure receipt binds exact nine-case TAP to target and probe SHA without skip or TODO', () => {
  const tap = pureTap();
  const receipt = parseStatementFramePureTAPV1(tap, {exitStatus: 0, targetSha, probeSha});
  assert.equal(receipt.contract, 'r16-diagnostic-pure-suite-v1');
  assert.equal(receipt.counts.tests, 9);
  assert.equal(receipt.target_git_sha_after, targetSha);
  assert.deepEqual(receipt.titles, [...STATEMENT_FRAME_PURE_TITLES_V1]);
  assert.throws(() => parseStatementFramePureTAPV1(Buffer.from(tap.toString().replace('# skipped 0', '# skipped 1')),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_pure_counts_invalid/u);
  assert.throws(() => parseStatementFramePureTAPV1(Buffer.from(tap.toString().replace(STATEMENT_FRAME_PURE_TITLES_V1[0], 'wrong title')),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_pure_titles_invalid/u);
  assert.throws(() => parseStatementFramePureTAPV1(Buffer.from(tap.toString().replace('ok 1 -', 'ok 2 -')),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_pure_test_numbers_invalid/u);
  assert.throws(() => parseStatementFramePureTAPV1(Buffer.from(tap.toString().replace('1..9', '1..8')),
    {exitStatus: 0, targetSha, probeSha}), /statement_frame_pure_plan_invalid/u);
});

function pureTap() {
  return Buffer.from(`TAP version 13\n${STATEMENT_FRAME_PURE_TITLES_V1.map((title, i) => `ok ${i + 1} - ${title}`).join('\n')}\n1..9\n# tests 9\n# pass 9\n# fail 0\n# cancelled 0\n# skipped 0\n`);
}

test('D native profile collector accepts producer hash formats and rejects prefixed non-image hashes', () => {
  const result = report();
  const tap = nativeTap(result);
  const receipt = parseStatementFrameNativeTAPV1(tap, {exitStatus: 0, targetSha, probeSha});
  assert.equal(receipt.status, 'verified');
  for (const [path, value] of [
    ['hz_before.collector.os_script_sha256', 'sha256:' + 'e'.repeat(64)],
    ['hz_before.collector.inspect_format_sha256', 'sha256:' + 'f'.repeat(64)],
    ['hz_before.ownership.marker_sha256', 'sha256:' + 'a'.repeat(64)],
    ['hz_before.ownership.container_id_sha256', 'sha256:' + 'b'.repeat(64)],
    ['hz_before.ownership.postgres_system_identifier_sha256', 'sha256:' + 'c'.repeat(64)],
  ]) {
    const changed = structuredClone(result);
    const [root, child, field] = path.split('.');
    changed[root][child][field] = value;
    assert.throws(() => parseStatementFrameNativeTAPV1(nativeTap(changed), {exitStatus: 0, targetSha, probeSha}),
      /statement_frame_(collector_seal|lab_ownership)_invalid/u, path);
  }
  assert.deepEqual([receipt.requested_target_sha, receipt.target_git_sha_before, receipt.target_git_sha_after,
    receipt.requested_probe_sha, receipt.probe_git_sha_before, receipt.probe_git_sha_after],
  [targetSha, targetSha, targetSha, probeSha, probeSha, probeSha]);
});
