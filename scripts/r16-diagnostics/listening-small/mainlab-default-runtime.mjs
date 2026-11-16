import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateDefaultRuntimePairV1, validateDefaultRuntimeV1} from './statement-default-contract.mjs';

const SOURCE_PATHS = [
  'infrastructure/db/migrations/0330_signal_listening_statement_shared_wire.sql',
  'infrastructure/db/migrations/0331_signal_listening_statement_payload.sql',
  'infrastructure/db/migrations/signal-listening-statement-shared-wire.fixture.ts',
  'infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle.ts',
  'infrastructure/db/migrations/signal-listening-statement-shared-wire.postgres.test.ts',
  'infrastructure/db/migrations/signal-listening-statement-shared-wire.test.ts',
];
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

function gitHead(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
}

function assertClean(root) {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd: root, encoding: 'utf8'});
  assert.equal(status, '', 'mainlab_target_tree_dirty');
}

function sourceFiles(root) {
  const files = SOURCE_PATHS.map((path) => {
    const fullPath = join(root, path);
    assert.ok(existsSync(fullPath), 'mainlab_source_six_incomplete');
    return {path, sha256: hash(readFileSync(fullPath))};
  });
  return files;
}

function writePrivateJson(path, value) {
  const resolved = resolve(path);
  const temp = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600, flag: 'wx'});
  renameSync(temp, resolved);
}

async function capture(phase, requestedSha, outputPath) {
  assert.ok(phase === 'before' || phase === 'after', 'mainlab_default_phase_invalid');
  assert.ok(/^[0-9a-f]{40}$/u.test(requestedSha), 'mainlab_default_requested_sha_invalid');
  const root = resolve(process.env.R16_DIAGNOSTIC_TARGET_ROOT ?? process.cwd());
  const headBefore = gitHead(root);
  assert.equal(headBefore, requestedSha, 'mainlab_default_target_sha_before_mismatch');
  assertClean(root);
  const sourceBefore = sourceFiles(root);
  const localPgUrl = pathToFileURL(join(root, 'infrastructure/db/migrations/signal-r16-local-pg.fixture.ts')).href;
  const oracleUrl = pathToFileURL(join(root, 'infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle.ts')).href;
  const [localPg, oracle] = await Promise.all([import(localPgUrl), import(oracleUrl)]);
  let pool;
  let client;
  let receipt;
  let primaryError;
  try {
    pool = await localPg.openR16CiPostgresV1();
    client = await pool.connect();
    receipt = await oracle.assertSharedWireDefaultRuntimeV1(client);
  } catch (error) {
    primaryError = error;
  }
  let cleanupError;
  try {
    client?.release();
    if (pool) await pool.end();
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], 'mainlab_default_read_and_connection_cleanup_failed');
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  const headAfter = gitHead(root);
  assert.equal(headAfter, requestedSha, 'mainlab_default_target_sha_after_mismatch');
  assert.equal(headAfter, headBefore, 'mainlab_default_target_sha_changed_during_read');
  assertClean(root);
  const sourceAfter = sourceFiles(root);
  assert.deepEqual(sourceAfter, sourceBefore, 'mainlab_default_source_six_changed_during_read');
  const runtime = {...receipt, phase};
  validateDefaultRuntimeV1(runtime, 'C');
  writePrivateJson(outputPath, {
    phase,
    requested_target_sha: requestedSha,
    target_git_sha_before: headBefore,
    target_git_sha_after: headAfter,
    source_set: 'six',
    source_files: sourceAfter,
    runtime,
  });
}

export function buildMainlabDefaultRuntimeV1(requestedSha, beforeCapture, afterCapture) {
  assert.ok(/^[0-9a-f]{40}$/u.test(requestedSha), 'mainlab_default_requested_sha_invalid');
  for (const capture of [beforeCapture, afterCapture]) {
    assert.equal(capture.requested_target_sha, requestedSha, 'mainlab_default_capture_requested_sha_mismatch');
    assert.equal(capture.target_git_sha_before, requestedSha, 'mainlab_default_capture_head_before_mismatch');
    assert.equal(capture.target_git_sha_after, requestedSha, 'mainlab_default_capture_head_after_mismatch');
    assert.equal(capture.source_set, 'six', 'mainlab_default_source_set_invalid');
    assert.equal(capture.source_files.length, SOURCE_PATHS.length, 'mainlab_default_source_file_count_invalid');
    assert.deepEqual(capture.source_files.map((entry) => entry.path), SOURCE_PATHS, 'mainlab_default_source_paths_invalid');
    for (const entry of capture.source_files) {
      assert.deepEqual(Object.keys(entry).sort(), ['path', 'sha256'], 'mainlab_default_source_entry_fields_invalid');
      assert.ok(/^[0-9a-f]{64}$/u.test(entry.sha256), 'mainlab_default_source_sha_invalid');
    }
    assert.equal(capture.runtime.phase, capture.phase, 'mainlab_default_capture_phase_mismatch');
    validateDefaultRuntimeV1(capture.runtime, 'C');
  }
  assert.equal(beforeCapture.phase, 'before', 'mainlab_default_before_capture_invalid');
  assert.equal(afterCapture.phase, 'after', 'mainlab_default_after_capture_invalid');
  assert.deepEqual(afterCapture.source_files, beforeCapture.source_files, 'mainlab_default_source_six_changed');
  validateDefaultRuntimePairV1(beforeCapture.runtime, afterCapture.runtime, 'C');
  return {
    contract: 'r16-statement-shared-wire-mainlab-default-v1',
    status: 'verified_c_default',
    diagnostic_only: true,
    h1_accepted: false,
    requested_target_sha: requestedSha,
    target_git_sha_before: beforeCapture.target_git_sha_before,
    target_git_sha_after: afterCapture.target_git_sha_after,
    source_set: 'six',
    source_files: beforeCapture.source_files,
    before: beforeCapture.runtime,
    after: afterCapture.runtime,
    before_after_equal: true,
  };
}

function assemble(requestedSha, beforePath, afterPath, outputPath) {
  const beforeCapture = JSON.parse(readFileSync(beforePath, 'utf8'));
  const afterCapture = JSON.parse(readFileSync(afterPath, 'utf8'));
  writePrivateJson(outputPath, buildMainlabDefaultRuntimeV1(requestedSha, beforeCapture, afterCapture));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'capture') {
    assert.equal(args.length, 3, 'mainlab_default_capture_args_invalid');
    await capture(args[0], args[1], args[2]);
    return;
  }
  if (command === 'assemble') {
    assert.equal(args.length, 4, 'mainlab_default_assemble_args_invalid');
    assemble(args[0], args[1], args[2], args[3]);
    return;
  }
  throw new Error('mainlab_default_command_invalid');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'mainlab_default_failed'}\n`);
    process.exitCode = 1;
  });
}
