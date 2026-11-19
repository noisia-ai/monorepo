import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  CURRENT_KIND, resolveStatementDefaultCliKindV1, verifyStatementDefaultCliV1,
  validateDefaultRuntimeV1, validateDefaultRuntimePairV1, parseStatementDefaultTapV1,
} from './statement-default-contract.mjs';

// Fabricated parser fixtures only: no PostgreSQL, process spawn, environment or
// GITHUB_OUTPUT access. Expected source/prosrc pins are independently checked.
const PREFIX = 'statement shared wire DEFAULT ';
const profiles = {
  B: {fixtures: 6, migration: '0330_signal_listening_statement_shared_wire.sql', source: '94fb81156f9ba8aa8faf3dc3502195998e701dc76e12a636418d8ef0df502305', prosrc: 'f35aa0ec10632a191f0197e7f89f8ac56089c5814d1be340631e9a8dabf948e7'},
  C: {fixtures: 6, migration: '0331_signal_listening_statement_payload.sql', source: 'cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5', prosrc: '5ed4fa353803122208408b1f66a29b9fdea8599b86d0d0b8de3bb18d5b2155fa'},
  D: {fixtures: 7, migration: '0336_signal_listening_statement_native_projection.sql', source: '64cb14b3ce2bb47d984f5984bd20980f9d2233a51d90c053a6cc7201c05f0a07', prosrc: '314f138b69045a730efc9f306cc49fd19afed02d5aac276d07f78ac8c9d19b10'},
};
const metadata = {proconfig: ['search_path=public, extensions, pg_temp'], lanname: 'plpgsql', prosecdef: false, return_type: 'trigger', pronargs: 0, proretset: false, provolatile: 'v', proisstrict: false, proparallel: 'u', proleakproof: false, prokind: 'f'};
function receipt(kind, ordinal, phase) {
  const p = profiles[kind];
  return {contract: 'r16-statement-shared-wire-default-runtime-v1', target: 'public.signal_listening_statement_money_v1()', runtime_kind: kind, observed_via: 'pg_proc', default_arm: kind, migration: p.migration, source_sha256: p.source, prosrc_sha256: p.prosrc, actual_prosrc_sha256: p.prosrc, metadata: structuredClone(metadata), actual_pg_proc_checked: true, receipt_id: `shared-wire-default-${ordinal}-${phase}`, fixture_ordinal: ordinal, phase};
}
function rows(kind) {return Array.from({length: profiles[kind].fixtures}, (_, i) => ['before', 'after'].map(phase => receipt(kind, i + 1, phase))).flat();}
function tap(receipts, prefix = '# # ' + PREFIX) {return receipts.map(r => prefix + JSON.stringify(r)).join('\n') + '\n';}
function runtime(kind, phase) {const {receipt_id, fixture_ordinal, ...r} = receipt(kind, 1, phase); return r;}
const rejectTap = (receipts, kind = 'D') => assert.throws(() => parseStatementDefaultTapV1(tap(receipts), kind));

test('independent B/C/D source and prosrc pins match their immutable SQL files', () => {
  for (const p of Object.values(profiles)) {
    const source = readFileSync(new URL('../../../infrastructure/db/migrations/' + p.migration, import.meta.url), 'utf8');
    const body = /AS \$\$([\s\S]*?)\$\$;/u.exec(source)?.[1]; assert.ok(body);
    assert.equal(createHash('sha256').update(source).digest('hex'), p.source);
    assert.equal(createHash('sha256').update(body).digest('hex'), p.prosrc);
  }
});
test('legacy B/C remain exactly six fixture pairs/twelve receipts and API default remains C', () => {
  for (const kind of ['B', 'C']) {
    const result = parseStatementDefaultTapV1(tap(rows(kind)), kind);
    assert.equal(result.runtime_kind, kind); assert.equal(result.receipt_count, 12); assert.equal(result.receipt_ids.length, 12);
    validateDefaultRuntimeV1(runtime(kind, 'before'), kind);
    assert.deepEqual(validateDefaultRuntimePairV1(runtime(kind, 'before'), runtime(kind, 'after'), kind), {runtime_kind: kind, before_after_equal: true});
    rejectTap(rows(kind).slice(1), kind); rejectTap([...rows(kind), receipt(kind, 7, 'before')], kind);
  }
  assert.equal(parseStatementDefaultTapV1(tap(rows('C'))).runtime_kind, 'C');
  assert.equal(validateDefaultRuntimePairV1(runtime('C', 'before'), runtime('C', 'after')).runtime_kind, 'C');
});
test('D requires exactly seven complete fixture pairs/fourteen receipts', () => {
  const receipts = rows('D'), result = parseStatementDefaultTapV1(tap(receipts), 'D');
  assert.equal(result.runtime_kind, 'D'); assert.equal(result.receipt_count, 14); assert.equal(new Set(result.receipt_ids).size, 14);
  assert.equal(validateDefaultRuntimePairV1(receipt('D', 7, 'before'), receipt('D', 7, 'after'), 'D').runtime_kind, 'D');
  assert.deepEqual(parseStatementDefaultTapV1(tap([...receipts].reverse()), 'D'), result, 'receipt order is not an inferred profile');
  for (const changed of [receipts.slice(0, 12), receipts.slice(1), [...receipts, receipt('D', 8, 'before')], [...receipts, receipts[0]]]) rejectTap(changed);
});
test('explicit B/C/D expectations reject all cross-profile receipts and have no legacy fallback', () => {
  for (const actual of ['B', 'C', 'D']) for (const expected of ['B', 'C', 'D']) if (actual !== expected) {
    assert.throws(() => validateDefaultRuntimeV1(receipt(actual, 1, 'before'), expected));
    assert.throws(() => validateDefaultRuntimePairV1(runtime(actual, 'before'), runtime(actual, 'after'), expected));
    rejectTap(rows(actual), expected);
  }
  assert.throws(() => parseStatementDefaultTapV1(tap(rows('D'))));
  assert.throws(() => validateDefaultRuntimePairV1(runtime('D', 'before'), runtime('D', 'after')));
});
test('D rejects duplicate, omitted or extra IDs even when counts look plausible', () => {
  const duplicate = rows('D'); duplicate[13] = structuredClone(duplicate[0]); rejectTap(duplicate);
  for (const changed of [rows('D').filter(r => r.receipt_id !== 'shared-wire-default-7-after'), [...rows('D'), receipt('D', 7, 'after')]]) rejectTap(changed);
});
test('every pinned runtime field, phase, ID, ordinal and envelope shape is fail-closed', () => {
  const patches = [{contract: 'other'}, {target: 'public.other()'}, {runtime_kind: 'C'}, {observed_via: 'fixture'}, {default_arm: 'C'}, {migration: profiles.C.migration}, {source_sha256: '0'.repeat(64)}, {prosrc_sha256: profiles.C.prosrc}, {actual_prosrc_sha256: '0'.repeat(64)}, {actual_pg_proc_checked: false}, {phase: 'pending'}, {receipt_id: 'shared-wire-default-1-after'}, {fixture_ordinal: 0}, {fixture_ordinal: 8}, {fixture_ordinal: 1.5}, {fixture_ordinal: '1'}, {fixture_ordinal: null}, {extra: true}];
  for (const patch of patches) {
    const changed = {...receipt('D', 1, 'before'), ...patch}; assert.throws(() => validateDefaultRuntimeV1(changed, 'D'));
    const receipts = rows('D'); receipts[0] = changed; rejectTap(receipts);
  }
  for (const field of Object.keys(receipt('D', 1, 'before'))) {
    const changed = receipt('D', 1, 'before'); delete changed[field]; assert.throws(() => validateDefaultRuntimeV1(changed, 'D'));
    const receipts = rows('D'); receipts[0] = changed; rejectTap(receipts);
  }
});
test('metadata is exact for all profiles, including missing/extra keys and config types', () => {
  const patches = [{proconfig: ['search_path=public']}, {proconfig: null}, {lanname: 'sql'}, {prosecdef: true}, {return_type: 'void'}, {pronargs: 1}, {proretset: true}, {provolatile: 's'}, {proisstrict: true}, {proparallel: 's'}, {proleakproof: true}, {prokind: 'p'}, {extra: false}];
  for (const kind of ['B', 'C', 'D']) for (const patch of patches) {
    const changed = receipt(kind, 1, 'before'); changed.metadata = {...changed.metadata, ...patch}; assert.throws(() => validateDefaultRuntimeV1(changed, kind));
  }
  const missing = receipt('D', 1, 'before'); delete missing.metadata.lanname; assert.throws(() => validateDefaultRuntimeV1(missing, 'D'));
});
test('before/after phases, native ordinal pairing and envelope type cannot be mixed', () => {
  assert.throws(() => validateDefaultRuntimePairV1(receipt('D', 1, 'after'), receipt('D', 1, 'before'), 'D'));
  assert.throws(() => validateDefaultRuntimePairV1(receipt('D', 1, 'before'), receipt('D', 2, 'after'), 'D'));
  assert.throws(() => validateDefaultRuntimePairV1(runtime('D', 'before'), receipt('D', 1, 'after'), 'D'));
});
test('accepted legacy TAP prefixes remain exact and malformed or nonobject payloads reject', () => {
  for (const prefix of [PREFIX, '# # ' + PREFIX, '# \\# ' + PREFIX]) assert.equal(parseStatementDefaultTapV1(tap(rows('D'), prefix), 'D').receipt_count, 14);
  assert.throws(() => parseStatementDefaultTapV1(tap(rows('D'), '# ' + PREFIX), 'D'));
  for (const value of ['null', '[]', 'false', '1', '{invalid']) assert.throws(() => parseStatementDefaultTapV1(PREFIX + value, 'D'));
});
test('CLI current resolves only from source CURRENT_KIND D; explicit APIs never accept current', () => {
  assert.equal(CURRENT_KIND, 'D'); assert.equal(resolveStatementDefaultCliKindV1('current'), 'D');
  for (const kind of ['B', 'C', 'D']) assert.equal(resolveStatementDefaultCliKindV1(kind), kind);
  let reads = 0;
  const result = verifyStatementDefaultCliV1(['verify-tap', 'synthetic.tap', 'current'], path => {assert.equal(path, 'synthetic.tap'); reads++; return tap(rows('D'));});
  assert.equal(reads, 1); assert.equal(result.runtime_kind, 'D'); assert.equal(result.receipt_count, 14);
  for (const kind of ['B', 'C']) {
    assert.equal(verifyStatementDefaultCliV1(['verify-tap', 'synthetic.tap', kind], () => tap(rows(kind))).receipt_count, 12);
    assert.throws(() => verifyStatementDefaultCliV1(['verify-tap', 'synthetic.tap', 'current'], () => tap(rows(kind))));
  }
  assert.throws(() => parseStatementDefaultTapV1(tap(rows('D')), 'current'));
  assert.throws(() => validateDefaultRuntimeV1(receipt('D', 1, 'before'), 'current'));
  assert.throws(() => validateDefaultRuntimePairV1(runtime('D', 'before'), runtime('D', 'after'), 'current'));
});
test('invalid CLI command/path/kind reject before even reading a synthetic TAP', () => {
  for (const args of [['other', 'synthetic.tap', 'current'], ['verify-tap', '', 'current'], ['verify-tap', 'synthetic.tap'], ['verify-tap', 'synthetic.tap', 'unknown']]) {
    let reads = 0; assert.throws(() => verifyStatementDefaultCliV1(args, () => {reads++; return tap(rows('D'));})); assert.equal(reads, 0);
  }
});
