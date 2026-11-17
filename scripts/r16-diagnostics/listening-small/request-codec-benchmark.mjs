import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {dirname, join, resolve} from 'node:path';

export const REQUEST_CODEC_BASE_SHA = 'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1';
export const REQUEST_CODEC_SOURCE_RELATIVE_PATH = 'packages/query-engine/src/signal-listening-contracts.ts';
export const REQUEST_CODEC_TRIAL_ORDER = Object.freeze(['old', 'new', 'new', 'old']);
export const REQUEST_CODEC_CALLS_PER_TRIAL = 1000;
export const REQUEST_CODEC_ARTIFACT_LIMIT_BYTES = 1_048_576;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH_RE = /^[0-9a-f]{64}$/u;
const SHA_RE = /^[0-9a-f]{40}$/u;

export class BenchmarkError extends Error {
  constructor(code, secondaryFailureCodes = []) {
    super(code);
    this.code = code;
    this.secondaryFailureCodes = secondaryFailureCodes;
  }
}

function fail(code) {
  throw new BenchmarkError(code);
}

function safeFailureCode(error, fallback = 'benchmark_failed') {
  return error instanceof BenchmarkError && /^[a-z][a-z0-9_]{1,80}$/u.test(error.code) ? error.code : fallback;
}

export async function runOwnedTempLifecycleV1({create, body, cleanup, postcheck}) {
  let result;
  let primaryFailureCode;
  const secondaryFailureCodes = [];
  try {
    await create();
    result = await body();
  } catch (error) {
    primaryFailureCode = safeFailureCode(error);
  }
  try {
    await cleanup();
  } catch (error) {
    secondaryFailureCodes.push(safeFailureCode(error, 'baseline_temp_cleanup_failed'));
  }
  try {
    const postcheckCodes = await postcheck();
    if (Array.isArray(postcheckCodes)) {
      for (const code of postcheckCodes) {
        if (typeof code === 'string' && /^[a-z][a-z0-9_]{1,80}$/u.test(code)) secondaryFailureCodes.push(code);
      }
    }
  } catch (error) {
    secondaryFailureCodes.push(safeFailureCode(error, 'source_postcheck_failed'));
  }
  const uniqueSecondary = [...new Set(secondaryFailureCodes)].slice(0, 3);
  if (primaryFailureCode || uniqueSecondary.length) {
    const [reasonCode, ...remaining] = primaryFailureCode ? [primaryFailureCode, ...uniqueSecondary] : uniqueSecondary;
    throw new BenchmarkError(reasonCode, remaining);
  }
  return result;
}

function git(targetRoot, args) {
  try {
    return execFileSync('git', args, {cwd: targetRoot, encoding: 'utf8', timeout: 10_000, maxBuffer: 1_048_576}).trim();
  } catch {
    fail('git_read_failed');
  }
}

function assertClean(root, code) {
  if (git(root, ['status', '--porcelain', '--untracked-files=all']) !== '') fail(code);
}

function assertExactHead(root, expected, code) {
  if (git(root, ['rev-parse', 'HEAD']) !== expected) fail(code);
  assertClean(root, code);
}

function assertCandidateDelta(root) {
  const changed = git(root, ['diff', '--name-only', '--no-renames', REQUEST_CODEC_BASE_SHA, 'HEAD']).split('\n').filter(Boolean).sort();
  const expected = ['packages/query-engine/src/signal-listening-contracts.ts',
    'packages/query-engine/src/signal-listening-request-codec.test.ts'].sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) fail('candidate_delta_invalid');
}

function deterministicHex(label) {
  return sha256(Buffer.from(label, 'utf8'));
}

function makeInput(index, caseId, selectedKeys) {
  const keyDigests = Object.fromEntries(selectedKeys.map(key => [key, `sha256:${deterministicHex(`${caseId}:question:${index}:${key}`)}`]));
  const scopeBasis = Object.fromEntries(selectedKeys.filter(key => key !== 'voice' && key !== 'promotion')
    .map(key => [key, `basis:${deterministicHex(`${caseId}:basis:${index}:${key}`)}`]));
  return {
    root_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    input_digest: `sha256:${deterministicHex(`${caseId}:input:${index}`)}`,
    text: `synthetic ${caseId} root ${index} café é 😀`,
    map_id: `synthetic-map-${caseId}`,
    configuration_digest: `sha256:${deterministicHex(`${caseId}:configuration`)}`,
    question_keys: [...selectedKeys],
    question_digests: keyDigests,
    scope_basis: scopeBasis,
  };
}

function candidateQuestion(key, topicSource) {
  return {
    key,
    type: 'noul',
    text: `Synthetic ${topicSource} question ${key}`,
    positive: `Synthetic positive ${key}`,
    negative: `Synthetic negative ${key}`,
    scope: 'consumer_category',
    origin: 'brand_os',
    human_locked: false,
    topic_source: topicSource,
  };
}

export function createRequestCodecWorkloadsV1(codecModule, workloadModule, callsPerWorkload = REQUEST_CODEC_CALLS_PER_TRIAL) {
  if (typeof workloadModule?.r16ListeningWorkloadV2 !== 'function'
    || typeof codecModule?.selectSignalListeningQuestionsV1 !== 'function') fail('workload_module_invalid');
  if (!Number.isSafeInteger(callsPerWorkload) || callsPerWorkload < 1 || callsPerWorkload > REQUEST_CODEC_CALLS_PER_TRIAL) fail('workload_call_count_invalid');
  const base = codecModule.signalListeningBaseTemplateV1({category: 'synthetic-category', lexicon_terms: ['synthetic', 'café']});
  const candidateKeys = ['defined_a', 'defined_b', 'defined_c', 'defined_d'];
  const mainWorkload = workloadModule.r16ListeningWorkloadV2('defined_consumer_second_pass');
  const mainConfiguration = mainWorkload?.configuration;
  if (mainWorkload?.arm !== 'defined_consumer_second_pass' || mainConfiguration?.questions?.length !== 4
    || !Array.isArray(mainWorkload.question_keys) || mainWorkload.question_keys.length !== 4
    || JSON.stringify([...mainWorkload.question_keys].sort()) !== JSON.stringify(mainConfiguration.questions.map(question => question.key).sort())) {
    fail('main_workload_shape_invalid');
  }
  const mainSelectedKeys = codecModule.selectSignalListeningQuestionsV1(mainConfiguration, [])
    .filter(question => question.scope === 'consumer_category' && question.type === 'noul' && question.topic_source === 'defined')
    .map(question => question.key).sort();
  if (mainSelectedKeys?.length !== 2
    || mainSelectedKeys.some(key => !mainWorkload.question_keys.includes(key))) {
    fail('main_workload_shape_invalid');
  }
  const configuredDiscovered = codecModule.validateSignalListeningConfigurationV1(
    {...base, questions: [...base.questions, ...candidateKeys.map(key => candidateQuestion(key, 'discovered'))]});
  const selectedDiscovered = codecModule.selectSignalListeningQuestionsV1(configuredDiscovered,
    candidateKeys.map((key, index) => ({key, similarity: 1 - index / 10}))).map(question => question.key).sort();
  if (configuredDiscovered.questions.length !== 6 || selectedDiscovered.length !== 6) fail('stress_workload_shape_invalid');
  return [
    {
      case_id: 'defined_consumer_4_configured_2_selected',
      configuration: mainConfiguration,
      selected_keys: mainSelectedKeys,
      product_configuration_digest: mainWorkload.configuration_digest,
      selected_consumer_keys_sha256: sha256(Buffer.from(JSON.stringify(mainSelectedKeys), 'utf8')),
    },
    {
      case_id: 'base_2_plus_4_noul_candidates',
      configuration: configuredDiscovered,
      selected_keys: selectedDiscovered,
    },
  ].map(item => ({...item, inputs: Array.from({length: callsPerWorkload}, (_, index) => makeInput(index, item.case_id, item.selected_keys))}));
}

function functionsFor(codecModule) {
  const names = ['compileSignalListeningSnapshotV1', 'readSignalListeningSnapshotV1',
    'buildSignalListeningCompiledRequestV1', 'signalListeningRequestDigestV1', 'validateSignalListeningConfigurationV1'];
  if (names.some(name => typeof codecModule[name] !== 'function')) fail('codec_exports_invalid');
  return {
    compile: codecModule.compileSignalListeningSnapshotV1,
    readSnapshot: codecModule.readSignalListeningSnapshotV1,
    build: codecModule.buildSignalListeningCompiledRequestV1,
    digest: codecModule.signalListeningRequestDigestV1,
  };
}

export function prepareComparisonModules(modulePair, workloads) {
  return workloads.map(workload => {
    const oldConfig = structuredClone(workload.configuration);
    const newConfig = structuredClone(workload.configuration);
    const oldSnapshot = modulePair.oldFns.compile(oldConfig);
    const newSnapshot = modulePair.newFns.compile(newConfig);
    const oldSnapshotRead = modulePair.oldFns.readSnapshot(oldSnapshot);
    const newSnapshotRead = modulePair.newFns.readSnapshot(newSnapshot);
    if (!isDeepStrictEqual(oldSnapshotRead.configuration, workload.configuration)
      || !isDeepStrictEqual(newSnapshotRead.configuration, workload.configuration)) fail('compiled_configuration_wire_mismatch');
    if (oldSnapshotRead.configuration_digest !== newSnapshotRead.configuration_digest
      || (workload.product_configuration_digest && oldSnapshotRead.configuration_digest !== workload.product_configuration_digest)) {
      fail('compiled_configuration_digest_mismatch');
    }
    return {...workload, oldConfig, newConfig, oldSnapshot, newSnapshot,
      oldSnapshotConfigurationDigest: oldSnapshotRead.configuration_digest,
      newSnapshotConfigurationDigest: newSnapshotRead.configuration_digest,
      run: {id: `synthetic-run-${workload.case_id}`, entity_context_digest: `sha256:${deterministicHex(`${workload.case_id}:entity-context`)}`}};
  });
}

function parity(modulePair, preparedWorkloads) {
  const parityCases = [];
  for (const workload of preparedWorkloads) {
    const oldHash = createHash('sha256');
    const newHash = createHash('sha256');
    let oldTimingChecksum = 0;
    let newTimingChecksum = 0;
    let requestBytes = 0;
    for (const input of workload.inputs) {
      const oldRequest = modulePair.oldFns.build(input, workload.oldSnapshot);
      const newRequest = modulePair.newFns.build(input, workload.newSnapshot);
      const oldWire = JSON.stringify(oldRequest);
      const newWire = JSON.stringify(newRequest);
      const oldDigest = modulePair.oldFns.digest(workload.run, input, oldRequest);
      const newDigest = modulePair.newFns.digest(workload.run, input, newRequest);
      if (oldWire !== newWire || oldDigest !== newDigest) fail('wire_or_digest_mismatch');
      oldHash.update(oldWire).update('\0').update(oldDigest).update('\n');
      newHash.update(newWire).update('\0').update(newDigest).update('\n');
      const byteLength = Buffer.byteLength(oldWire, 'utf8');
      oldTimingChecksum = ((oldTimingChecksum * 33) ^ oldDigest.charCodeAt(7) ^ byteLength) >>> 0;
      newTimingChecksum = ((newTimingChecksum * 33) ^ newDigest.charCodeAt(7) ^ byteLength) >>> 0;
      requestBytes += byteLength;
    }
    const oldChecksum = oldHash.digest('hex');
    const newChecksum = newHash.digest('hex');
    if (oldChecksum !== newChecksum || oldTimingChecksum !== newTimingChecksum) fail('parity_checksum_mismatch');
    parityCases.push({case_id: workload.case_id, verified_calls: workload.inputs.length, request_bytes: requestBytes,
      paired_output_sha256: oldChecksum, timing_checksum: oldTimingChecksum});
  }
  return parityCases;
}

function invoke(moduleFns, workload, snapshot, run, input) {
  const request = moduleFns.build(input, snapshot);
  const requestDigest = moduleFns.digest(run, input, request);
  const httpWire = JSON.stringify(request);
  return {requestDigest, httpWire};
}

function warm(moduleFns, workload, snapshot, run) {
  let checksum = 0;
  for (let index = 0; index < 100; index++) {
    const result = invoke(moduleFns, workload, snapshot, run, workload.inputs[index]);
    checksum = ((checksum * 33) ^ result.requestDigest.charCodeAt(7) ^ Buffer.byteLength(result.httpWire, 'utf8')) >>> 0;
  }
  return checksum;
}

function measureTrial(moduleFns, workload, snapshot, run, arm, orderIndex) {
  const rssBefore = process.memoryUsage().rss;
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const wallStart = process.hrtime.bigint();
  let checksum = 0;
  let httpBytes = 0;
  for (const input of workload.inputs) {
    const {requestDigest, httpWire} = invoke(moduleFns, workload, snapshot, run, input);
    const byteLength = Buffer.byteLength(httpWire, 'utf8');
    httpBytes += byteLength;
    checksum = ((checksum * 33) ^ requestDigest.charCodeAt(7) ^ byteLength) >>> 0;
  }
  const wallEnd = process.hrtime.bigint();
  const cpu = process.cpuUsage(cpuBefore);
  const rssAfter = process.memoryUsage().rss;
  const heapAfter = process.memoryUsage().heapUsed;
  return {case_id: workload.case_id, arm, order_index: orderIndex, calls: workload.inputs.length,
    wall_ns: (wallEnd - wallStart).toString(), cpu_user_us: cpu.user, cpu_system_us: cpu.system,
    rss_before_bytes: rssBefore, rss_after_bytes: rssAfter, heap_before_bytes: heapBefore, heap_after_bytes: heapAfter,
    http_bytes: httpBytes, checksum};
}

function trialPair(modulePair, preparedWorkloads) {
  const trials = [];
  for (const workload of preparedWorkloads) {
    const warmChecksums = {old: warm(modulePair.oldFns, workload, workload.oldSnapshot, workload.run),
      new: warm(modulePair.newFns, workload, workload.newSnapshot, workload.run)};
    if (warmChecksums.old !== warmChecksums.new) fail('warmup_checksum_mismatch');
    REQUEST_CODEC_TRIAL_ORDER.forEach((arm, orderIndex) => {
      trials.push(measureTrial(arm === 'old' ? modulePair.oldFns : modulePair.newFns, workload,
        arm === 'old' ? workload.oldSnapshot : workload.newSnapshot, workload.run, arm, orderIndex + 1));
    });
  }
  return trials;
}

export function parseRequestCodecBenchmarkArgsV1(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--run') {
      if (values.has('run')) fail('cli_arguments_invalid');
      values.set('run', 'true');
      continue;
    }
    if (!key.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--') || values.has(key.slice(2))) fail('cli_arguments_invalid');
    values.set(key.slice(2), argv[++index]);
  }
  if (values.size !== 6 || values.get('run') !== 'true' || !values.get('target-root') || !values.get('probe-root') || !values.get('artifact')) fail('cli_arguments_invalid');
  const targetRoot = resolve(values.get('target-root'));
  const probeRoot = resolve(values.get('probe-root'));
  const targetSha = values.get('target-sha');
  const probeSha = values.get('probe-sha');
  const artifactValue = values.get('artifact');
  const artifactPath = resolve(artifactValue ?? '');
  if (!SHA_RE.test(targetSha ?? '') || !SHA_RE.test(probeSha ?? '') || !targetRoot || !probeRoot || !artifactPath
    || !artifactPath.endsWith('/request-codec-benchmark.json')) fail('cli_arguments_invalid');
  return {targetRoot, probeRoot, targetSha, probeSha, artifactPath};
}

function writeArtifact(path, object) {
  const bytes = Buffer.from(`${JSON.stringify(object, null, 2)}\n`, 'utf8');
  if (bytes.byteLength > REQUEST_CODEC_ARTIFACT_LIMIT_BYTES) fail('artifact_size_limit');
  const directory = dirname(path);
  if (!existsSync(directory)) mkdirSync(directory, {recursive: false, mode: 0o700});
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) fail('artifact_directory_invalid');
  if (existsSync(path)) fail('artifact_path_exists');
  writeFileSync(path, bytes, {mode: 0o600, flag: 'wx'});
  return bytes.byteLength;
}

export function validateRequestCodecArtifactV1(value) {
  assert.equal(value?.contract, 'r16-request-codec-microbenchmark-v1');
  assert.equal(value?.diagnostic_only, true);
  assert.equal(value?.h1_accepted, false);
  assert.equal(value?.gain_claim, false);
  if (value.status === 'verified') {
    assert.equal(value.base_source_sha, REQUEST_CODEC_BASE_SHA);
    assert.match(value.baseline_module_sha256 ?? '', HASH_RE);
    assert.match(value.candidate_module_sha256 ?? '', HASH_RE);
    assert.ok(Number.isSafeInteger(value.baseline_module_bytes) && value.baseline_module_bytes > 0);
    assert.ok(Number.isSafeInteger(value.candidate_module_bytes) && value.candidate_module_bytes > 0);
    assert.match(value.lockfile_sha256 ?? '', HASH_RE);
    assert.match(value.environment_fingerprint_sha256 ?? '', HASH_RE);
    assert.match(value.node_version ?? '', /^v22\./u);
    assert.ok(typeof value.pnpm_version === 'string' && value.pnpm_version.length < 32);
    assert.equal(value.process_cpu_scope, 'process_cpu_usage_includes_all_threads');
    assert.deepEqual(value.timing, {wall_clock: 'process.hrtime.bigint', cpu_clock: 'process.cpuUsage delta',
      timing_includes_sink_and_byte_count_bookkeeping: true, overhead_subtracted: false});
    assert.deepEqual(value.snapshot_preparation, {function: 'compileSignalListeningSnapshotV1', calls_per_arm_case: 1, included_in_trials: false});
    assert.equal(value.target_git_sha_before, value.requested_target_sha);
    assert.equal(value.target_git_sha_after, value.requested_target_sha);
    assert.equal(value.probe_git_sha_before, value.requested_probe_sha);
    assert.equal(value.probe_git_sha_after, value.requested_probe_sha);
    assert.deepEqual(value.workloads?.map(item => item.case_id), ['defined_consumer_4_configured_2_selected', 'base_2_plus_4_noul_candidates']);
    assert.deepEqual(value.workloads?.map(item => [item.configured_questions, item.base_questions,
      item.candidate_questions_configured, item.candidate_questions_selected, item.request_questions, item.calls]),
    [[4, 2, 2, 2, 2, 1000], [6, 2, 4, 4, 6, 1000]]);
    assert.deepEqual(value.main_workload, {source_function: 'r16ListeningWorkloadV2', arm: 'defined_consumer_second_pass',
      configured_questions: 4, selected_consumer_questions: 2,
      configuration_digest: value.workloads[0].product_configuration_digest,
      selected_consumer_keys_sha256: value.workloads[0].selected_consumer_keys_sha256});
    assert.match(value.main_workload.configuration_digest ?? '', /^sha256:[0-9a-f]{64}$/u);
    assert.match(value.main_workload.selected_consumer_keys_sha256 ?? '', HASH_RE);
    assert.ok(value.workloads.every(item => /^sha256:[0-9a-f]{64}$/u.test(item.snapshot_configuration_digest_old ?? '')
      && item.snapshot_configuration_digest_old === item.snapshot_configuration_digest_new));
    assert.equal(value.workloads[0].snapshot_configuration_digest_old, value.main_workload.configuration_digest);
    assert.equal(value.parity?.length, 2);
    assert.ok(value.parity.every(item => Number.isSafeInteger(item.verified_calls) && item.verified_calls === 1000
      && Number.isSafeInteger(item.request_bytes) && item.request_bytes > 0 && HASH_RE.test(item.paired_output_sha256 ?? '')));
    assert.equal(value.trials?.length, 8);
    for (let caseIndex = 0; caseIndex < 2; caseIndex += 1) {
      const caseTrials = value.trials.slice(caseIndex * 4, (caseIndex + 1) * 4);
      assert.deepEqual(caseTrials.map(trial => trial.arm), [...REQUEST_CODEC_TRIAL_ORDER]);
      assert.ok(caseTrials.every((trial, orderIndex) => trial.case_id === value.workloads[caseIndex].case_id
        && trial.order_index === orderIndex + 1 && trial.calls === 1000
        && typeof trial.wall_ns === 'string' && /^[1-9][0-9]*$/.test(trial.wall_ns)
        && Number.isSafeInteger(trial.cpu_user_us) && trial.cpu_user_us >= 0
        && Number.isSafeInteger(trial.cpu_system_us) && trial.cpu_system_us >= 0
        && Number.isSafeInteger(trial.http_bytes) && trial.http_bytes === value.parity[caseIndex].request_bytes
        && Number.isSafeInteger(trial.checksum) && trial.checksum === value.parity[caseIndex].timing_checksum));
      assert.equal(new Set(caseTrials.map(trial => trial.http_bytes)).size, 1);
      assert.equal(new Set(caseTrials.map(trial => trial.checksum)).size, 1);
    }
    assert.deepEqual(value.trials.map(trial => trial.arm), [...REQUEST_CODEC_TRIAL_ORDER, ...REQUEST_CODEC_TRIAL_ORDER]);
    assert.deepEqual(value.parity.map(item => item.case_id), value.workloads.map(item => item.case_id));
    assert.equal(value.trial_order?.join(','), REQUEST_CODEC_TRIAL_ORDER.join(','));
    assert.equal(value.warmup_calls_per_arm_case, 100);
    assert.equal(value.interpretation?.whole_pipeline_gain, false);
    assert.equal(value.interpretation?.cpu_function_attribution, false);
    assert.equal(value.interpretation?.causality_claim, false);
  } else {
    assert.equal(value.status, 'rejected');
    assert.match(value.reason_code ?? '', /^[a-z][a-z0-9_]{1,80}$/u);
    if (Object.hasOwn(value, 'secondary_failure_codes')) {
      assert.ok(Array.isArray(value.secondary_failure_codes) && value.secondary_failure_codes.length <= 3
        && value.secondary_failure_codes.every(code => /^[a-z][a-z0-9_]{1,80}$/u.test(code)));
    }
    assert.ok(!Object.hasOwn(value, 'trials') && !Object.hasOwn(value, 'parity'));
  }
  return true;
}

async function runBenchmark(args) {
  const {targetRoot, probeRoot, targetSha, probeSha, artifactPath} = args;
  if (process.versions.node.split('.')[0] !== '22') fail('node_major_version_invalid');
  assertExactHead(targetRoot, targetSha, 'target_source_seal_failed');
  assertExactHead(probeRoot, probeSha, 'probe_source_seal_failed');
  assertCandidateDelta(targetRoot);
  const runnerTemp = realpathSync(process.env.RUNNER_TEMP ?? '');
  const artifactParent = realpathSync(dirname(artifactPath));
  if (!artifactParent.startsWith(`${runnerTemp}/`)) fail('artifact_path_outside_runner_temp');
  const targetSourcePath = join(targetRoot, REQUEST_CODEC_SOURCE_RELATIVE_PATH);
  const sourceInfo = lstatSync(targetSourcePath);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) fail('candidate_source_path_invalid');
  const candidateBytes = readFileSync(targetSourcePath);
  const baselineBytes = execFileSync('git', ['show', `${REQUEST_CODEC_BASE_SHA}:${REQUEST_CODEC_SOURCE_RELATIVE_PATH}`], {
    cwd: targetRoot, timeout: 10_000, maxBuffer: 1_048_576,
  });
  const baselineHash = sha256(baselineBytes);
  const candidateHash = sha256(candidateBytes);
  const lockfileSha256 = sha256(readFileSync(join(targetRoot, 'pnpm-lock.yaml')));
  let pnpmVersion;
  try {
    pnpmVersion = execFileSync('pnpm', ['--version'], {cwd: targetRoot, encoding: 'utf8', timeout: 5000, maxBuffer: 4096}).trim();
  } catch {
    fail('pnpm_runtime_unavailable');
  }
  const baselinePath = join(dirname(targetSourcePath), `signal-listening-contracts.benchmark-old-${process.pid}.ts`);
  if (existsSync(baselinePath)) fail('baseline_temp_path_exists');
  let baselineCreated = false;
  const benchmarkResult = await runOwnedTempLifecycleV1({
    create: async () => { writeFileSync(baselinePath, baselineBytes, {flag: 'wx', mode: 0o600}); baselineCreated = true; },
    body: async () => {
    const oldModule = await import(pathToFileURL(baselinePath).href);
    const newModule = await import(pathToFileURL(targetSourcePath).href);
    const modulePair = {old: oldModule, new: newModule, oldFns: functionsFor(oldModule), newFns: functionsFor(newModule)};
    const workloadModule = await import(pathToFileURL(join(targetRoot, 'scripts/r16/listening-workload.ts')).href);
    const oldWorkloads = createRequestCodecWorkloadsV1(oldModule, workloadModule);
    const newWorkloads = createRequestCodecWorkloadsV1(newModule, workloadModule);
    const workloadShape = items => items.map(item => ({case_id: item.case_id, configuration: item.configuration,
      selected_keys: item.selected_keys, inputs: item.inputs}));
    if (JSON.stringify(workloadShape(oldWorkloads)) !== JSON.stringify(workloadShape(newWorkloads))) fail('workload_input_mismatch');
    const preparedWorkloads = prepareComparisonModules(modulePair, oldWorkloads);
    const parityResults = parity(modulePair, preparedWorkloads);
    const trials = trialPair(modulePair, preparedWorkloads);
    if (trials.some(trial => trial.http_bytes !== parityResults.find(item => item.case_id === trial.case_id)?.request_bytes)) {
      // Each trial repeats the same 1000 request wires, so the byte totals must match parity.
      fail('trial_byte_total_mismatch');
    }
    if (sha256(readFileSync(targetSourcePath)) !== candidateHash) fail('candidate_source_changed');
    const environment = {platform: process.platform, arch: process.arch, os_release: os.release(),
      ci: process.env.CI === 'true', github_actions: process.env.GITHUB_ACTIONS === 'true',
      runner_os: process.env.RUNNER_OS ?? '', event_name: process.env.GITHUB_EVENT_NAME ?? ''};
    const environmentFingerprint = sha256(Buffer.from(JSON.stringify({node: process.version, pnpm: pnpmVersion,
      lockfile: lockfileSha256, runtime_flags: process.execArgv, node_options: process.env.NODE_OPTIONS ?? '', environment})));
    const benchmarkResult = {
      contract: 'r16-request-codec-microbenchmark-v1', status: 'verified', diagnostic_only: true,
      h1_accepted: false, gain_claim: false, comparison_scope: 'request_codec_cpu_wall_only',
      base_source_sha: REQUEST_CODEC_BASE_SHA, baseline_module_sha256: baselineHash, baseline_module_bytes: baselineBytes.byteLength,
      candidate_module_sha256: candidateHash, candidate_module_bytes: candidateBytes.byteLength, requested_target_sha: targetSha,
      target_git_sha_before: targetSha, target_git_sha_after: targetSha,
      requested_probe_sha: probeSha, probe_git_sha_before: probeSha, probe_git_sha_after: probeSha,
      node_version: process.version, pnpm_version: pnpmVersion, lockfile_sha256: lockfileSha256,
      runtime_flags: process.execArgv, node_options: process.env.NODE_OPTIONS ?? '',
      environment, environment_fingerprint_sha256: environmentFingerprint,
      process_cpu_scope: 'process_cpu_usage_includes_all_threads', process_memory_scope: 'rss_and_heap_observations_before_after_each_trial',
      timing: {wall_clock: 'process.hrtime.bigint', cpu_clock: 'process.cpuUsage delta',
        timing_includes_sink_and_byte_count_bookkeeping: true, overhead_subtracted: false},
      snapshot_preparation: {function: 'compileSignalListeningSnapshotV1', calls_per_arm_case: 1, included_in_trials: false},
      trial_order: [...REQUEST_CODEC_TRIAL_ORDER], warmup_calls_per_arm_case: 100,
      main_workload: {source_function: 'r16ListeningWorkloadV2', arm: 'defined_consumer_second_pass',
        configured_questions: 4, selected_consumer_questions: 2,
        configuration_digest: oldWorkloads[0].product_configuration_digest,
        selected_consumer_keys_sha256: oldWorkloads[0].selected_consumer_keys_sha256},
      workloads: oldWorkloads.map(item => ({case_id: item.case_id, base_questions: 2,
        configured_questions: item.configuration.questions.length,
        candidate_questions_configured: item.configuration.questions.length - 2,
        candidate_questions_selected: item.selected_keys.filter(key => key !== 'voice' && key !== 'promotion').length,
        request_questions: item.selected_keys.length, calls: item.inputs.length,
        snapshot_configuration_digest_old: item.oldSnapshotConfigurationDigest,
        snapshot_configuration_digest_new: item.newSnapshotConfigurationDigest})), parity: parityResults, trials,
      interpretation: {whole_pipeline_gain: false, cpu_function_attribution: false, causality_claim: false,
        json_stringify_included: true, compile_snapshot_included_in_trials: false, all_inputs_synthetic: true},
    };
    validateRequestCodecArtifactV1(benchmarkResult);
    return benchmarkResult;
    },
    cleanup: async () => { if (baselineCreated) rmSync(baselinePath); },
    postcheck: async () => {
      const failures = [];
      const check = (root, expected, headCode, cleanCode) => {
        try { if (git(root, ['rev-parse', 'HEAD']) !== expected) failures.push(headCode); }
        catch { failures.push(headCode); }
        try { if (git(root, ['status', '--porcelain', '--untracked-files=all']) !== '') failures.push(cleanCode); }
        catch { failures.push(cleanCode); }
      };
      check(targetRoot, targetSha, 'target_source_head_changed', 'target_source_cleanup_failed');
      try {
        if (sha256(readFileSync(targetSourcePath)) !== candidateHash) failures.push('candidate_source_changed_after_run');
      } catch { failures.push('candidate_source_unreadable_after_run'); }
      check(probeRoot, probeSha, 'probe_source_head_changed', 'probe_source_cleanup_failed');
      return failures;
    },
  });
  const artifactBytes = writeArtifact(artifactPath, benchmarkResult);
  return {artifactBytes, result: benchmarkResult};
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseRequestCodecBenchmarkArgsV1(argv);
    const {artifactBytes, result} = await runBenchmark(args);
    process.stdout.write(`request_codec_benchmark_verified:${artifactBytes}\n`);
    return result;
  } catch (error) {
    const reasonCode = error instanceof BenchmarkError ? error.code : 'benchmark_failed';
    if (args?.artifactPath && !existsSync(args.artifactPath)) {
      try {
        writeArtifact(args.artifactPath, {contract: 'r16-request-codec-microbenchmark-v1', status: 'rejected',
          diagnostic_only: true, h1_accepted: false, gain_claim: false, reason_code: reasonCode,
          ...(error instanceof BenchmarkError && error.secondaryFailureCodes.length
            ? {secondary_failure_codes: error.secondaryFailureCodes} : {})});
      } catch {
        // A bounded rejection is best effort; never expose raw exception details.
      }
    }
    process.stderr.write(`request_codec_benchmark_rejected:${reasonCode}\n`);
    process.exitCode = 1;
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
