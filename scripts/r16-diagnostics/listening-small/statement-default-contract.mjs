import assert from 'node:assert/strict';
import {appendFileSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const PREFIX = 'statement shared wire DEFAULT ';
const RECEIPT_IDS = Array.from({length: 6}, (_, index) => index + 1)
  .flatMap((ordinal) => [`shared-wire-default-${ordinal}-before`, `shared-wire-default-${ordinal}-after`]);
const METADATA = {
  proconfig: ['search_path=public, extensions, pg_temp'],
  lanname: 'plpgsql',
  prosecdef: false,
  return_type: 'trigger',
  pronargs: 0,
  proretset: false,
  provolatile: 'v',
  proisstrict: false,
  proparallel: 'u',
  proleakproof: false,
  prokind: 'f',
};
const DEFAULTS = {
  C: {
    default_arm: 'C',
    migration: '0331_signal_listening_statement_payload.sql',
    source_sha256: 'cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5',
    prosrc_sha256: '5ed4fa353803122208408b1f66a29b9fdea8599b86d0d0b8de3bb18d5b2155fa',
  },
  B: {
    default_arm: 'B',
    migration: '0330_signal_listening_statement_shared_wire.sql',
    source_sha256: '94fb81156f9ba8aa8faf3dc3502195998e701dc76e12a636418d8ef0df502305',
    prosrc_sha256: 'f35aa0ec10632a191f0197e7f89f8ac56089c5814d1be340631e9a8dabf948e7',
  },
};
const RUNTIME_KEYS = [
  'contract', 'target', 'runtime_kind', 'observed_via', 'default_arm', 'migration',
  'source_sha256', 'prosrc_sha256', 'actual_prosrc_sha256', 'metadata', 'actual_pg_proc_checked',
];
const NATIVE_KEYS = [...RUNTIME_KEYS, 'receipt_id', 'fixture_ordinal', 'phase'];

export function validateDefaultRuntimeV1(receipt, expectedKind) {
  assert.ok(expectedKind === 'B' || expectedKind === 'C', 'statement_default_runtime_kind_invalid');
  assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'statement_default_receipt_invalid');
  const nativeEnvelope = Object.hasOwn(receipt, 'receipt_id') || Object.hasOwn(receipt, 'fixture_ordinal');
  const expectedKeys = nativeEnvelope ? NATIVE_KEYS : [...RUNTIME_KEYS, 'phase'];
  assert.deepEqual(Object.keys(receipt).sort(), [...expectedKeys].sort(), 'statement_default_receipt_fields_invalid');
  assert.equal(receipt.contract, 'r16-statement-shared-wire-default-runtime-v1', 'statement_default_contract_invalid');
  assert.equal(receipt.target, 'public.signal_listening_statement_money_v1()', 'statement_default_target_invalid');
  assert.equal(receipt.runtime_kind, expectedKind, 'statement_default_runtime_kind_mismatch');
  assert.equal(receipt.observed_via, 'pg_proc', 'statement_default_not_read_from_pg_proc');
  assert.equal(receipt.default_arm, DEFAULTS[expectedKind].default_arm, 'statement_default_arm_mismatch');
  assert.equal(receipt.migration, DEFAULTS[expectedKind].migration, 'statement_default_migration_mismatch');
  assert.equal(receipt.source_sha256, DEFAULTS[expectedKind].source_sha256, 'statement_default_source_sha_mismatch');
  assert.equal(receipt.prosrc_sha256, DEFAULTS[expectedKind].prosrc_sha256, 'statement_default_prosrc_sha_mismatch');
  assert.equal(receipt.actual_prosrc_sha256, DEFAULTS[expectedKind].prosrc_sha256, 'statement_default_actual_prosrc_sha_mismatch');
  assert.deepEqual(receipt.metadata, METADATA, 'statement_default_pg_proc_metadata_mismatch');
  assert.equal(receipt.actual_pg_proc_checked, true, 'statement_default_pg_proc_not_checked');
  assert.ok(receipt.phase === 'before' || receipt.phase === 'after', 'statement_default_phase_invalid');
}

function comparableRuntimeV1(receipt) {
  const {phase: _phase, receipt_id: _receiptId, fixture_ordinal: _ordinal, ...runtime} = receipt;
  return runtime;
}

export function validateDefaultRuntimePairV1(before, after, expectedKind = 'C') {
  validateDefaultRuntimeV1(before, expectedKind);
  validateDefaultRuntimeV1(after, expectedKind);
  assert.equal(before.phase, 'before', 'statement_default_before_phase_invalid');
  assert.equal(after.phase, 'after', 'statement_default_after_phase_invalid');
  assert.deepEqual(comparableRuntimeV1(after), comparableRuntimeV1(before), 'statement_default_runtime_changed');
  return {runtime_kind: expectedKind, before_after_equal: true};
}

export function parseStatementDefaultTapV1(tap, expectedKind = 'C') {
  assert.equal(typeof tap, 'string', 'statement_default_tap_invalid');
  const receipts = [];
  for (const line of tap.split(/\r?\n/u)) {
    const comment = line.trimStart();
    const acceptedPrefixes = [PREFIX, `# # ${PREFIX}`, `# \\# ${PREFIX}`];
    const matchedPrefix = acceptedPrefixes.find((prefix) => comment.startsWith(prefix));
    if (!matchedPrefix) {
      if (comment.includes(PREFIX) || comment.includes(`\\# ${PREFIX}`)) {
        assert.fail('statement_default_tap_prefix_invalid');
      }
      continue;
    }
    const payload = JSON.parse(comment.slice(matchedPrefix.length));
    assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload), 'statement_default_tap_payload_invalid');
    assert.deepEqual(Object.keys(payload).sort(), [...NATIVE_KEYS].sort(), 'statement_default_tap_fields_invalid');
    validateDefaultRuntimeV1(payload, expectedKind);
    assert.ok(Number.isSafeInteger(payload.fixture_ordinal) && payload.fixture_ordinal >= 1 && payload.fixture_ordinal <= 6,
      'statement_default_fixture_ordinal_invalid');
    assert.equal(payload.receipt_id, `shared-wire-default-${payload.fixture_ordinal}-${payload.phase}`,
      'statement_default_receipt_id_invalid');
    receipts.push(payload);
  }
  assert.equal(receipts.length, RECEIPT_IDS.length, 'statement_default_receipt_count_invalid');
  const byId = new Map();
  for (const receipt of receipts) {
    assert.ok(!byId.has(receipt.receipt_id), 'statement_default_receipt_id_duplicate');
    byId.set(receipt.receipt_id, receipt);
  }
  assert.deepEqual([...byId.keys()].sort(), [...RECEIPT_IDS].sort(), 'statement_default_receipt_ids_incomplete');
  for (let ordinal = 1; ordinal <= 6; ordinal++) {
    validateDefaultRuntimePairV1(byId.get(`shared-wire-default-${ordinal}-before`),
      byId.get(`shared-wire-default-${ordinal}-after`), expectedKind);
  }
  return {runtime_kind: expectedKind, receipt_count: receipts.length, receipt_ids: [...RECEIPT_IDS]};
}

function main() {
  const [command, tapPath, kind] = process.argv.slice(2);
  assert.equal(command, 'verify-tap', 'statement_default_command_invalid');
  assert.ok(tapPath, 'statement_default_tap_path_required');
  assert.ok(kind === 'B' || kind === 'C', 'statement_default_runtime_kind_invalid');
  const result = parseStatementDefaultTapV1(readFileSync(tapPath, 'utf8'), kind);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `default_runtime_kind=${result.runtime_kind}\ndefault_receipt_count=${result.receipt_count}\n`);
  }
  process.stdout.write(`statement default runtime: kind=${result.runtime_kind} receipts=${result.receipt_count}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
