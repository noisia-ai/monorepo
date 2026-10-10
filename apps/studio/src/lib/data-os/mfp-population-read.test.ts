import assert from 'node:assert/strict';
import test from 'node:test';
import {createMfpPopulationReader} from './mfp-population-read';

test('two tabs and different workspaces share a population slot while metadata remains free', async () => {
  const read = createMfpPopulationReader();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [];
  const tabA = read(async () => { started.push('A'); await held; return 'A'; });
  const tabB = read(async () => { started.push('B'); return 'B'; });
  await Promise.resolve();
  assert.deepEqual(started, ['A']);
  assert.equal(await Promise.resolve('metadata'), 'metadata');
  release();
  assert.deepEqual(await Promise.all([tabA, tabB]), ['A', 'B']);
  assert.deepEqual(started, ['A', 'B']);
});

test('aborted and excess queued requests never acquire a connection; failures release the slot', async () => {
  const read = createMfpPopulationReader(1);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = read(async () => { await held; throw Error('query failed'); });
  const abort = new AbortController();
  let calls = 0;
  const cancelled = read(async () => { calls++; }, abort.signal);
  await assert.rejects(read(async () => { calls++; }), /population_read_busy/);
  abort.abort();
  await assert.rejects(cancelled, {name: 'AbortError'});
  const successor = read(async () => { calls++; return 'recovered'; });
  release();
  await assert.rejects(first, /query failed/);
  assert.equal(await successor, 'recovered');
  assert.equal(calls, 1);
});

test('a waiting request expires without running its query', async () => {
  const read = createMfpPopulationReader(1, 10);
  let release!: () => void;
  const first = read(() => new Promise<void>(resolve => { release = resolve; }));
  let called = false;
  await assert.rejects(read(async () => { called = true; }), /population_read_busy/);
  release(); await first;
  assert.equal(called, false);
});
