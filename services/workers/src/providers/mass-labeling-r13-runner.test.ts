import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runR13JevStage, exportR13JevStage, type R13Input } from './mass-labeling-r13-runner';
import { JevProviderErrorV1, type JevProviderV1 } from './typesafe-jev';
const item: R13Input = { root_id: 'root', input_digest: 'input', text: 'Uma conversa comum.', title: null, platform: null, content_type: null, author: null, published_at: '', language: 'pt', map_id: 'map', map_digest: 'digest', chunk_index: 0, candidates: [], probabilities: { voice: { type: 'choice', choice: 'individual', confidence: 1, probabilities: { individual: 1 } }, promotion: { type: 'noul', noul: 0 } } };
const raw = { body: JSON.stringify({ model: 'jev-1.13.0', usage: { input_tokens: 300, output_tokens: 0 }, answers: { trigger_barrier: { type: 'choice', choice: 'none', confidence: 0.8, probabilities: { trigger: 0.1, barrier: 0.1, none: 0.8 } } } }), http_status: 200, latency_ms: 2 };
async function withDir(fn: (directory: string) => Promise<void>) { const dir = await mkdtemp(join(tmpdir(), 'r13-test-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
test('settled roots resume without a second provider call and retain complete raw usage', async () => withDir(async directory => {
  let calls = 0;
  const provider: JevProviderV1 = { async evaluate() { calls++; return raw; } };
  const args = { stage: 'repair' as const, items: [item], directory, provider, category: { pt: 'cerveja', en: 'beer' } };
  const first = await runR13JevStage(args); const second = await runR13JevStage(args);
  assert.deepEqual(first, second); assert.equal(calls, 1); assert.equal(first.settled, 1); assert.equal(first.input_tokens, 300); assert.equal(first.micro_usd, 13);
  const files = await readdir(directory); assert.equal(files.filter(f => f.endsWith('.raw.json')).length, 1);
}));
test('unknown outcomes and submitted-without-receipt crashes are not resubmitted', async () => withDir(async directory => {
  let calls = 0;
  const provider: JevProviderV1 = { async evaluate() { calls++; throw new JevProviderErrorV1('timeout', 'outcome_unknown'); } };
  const args = { stage: 'repair' as const, items: [item], directory, provider, category: { pt: 'cerveja', en: 'beer' } };
  await assert.rejects(runR13JevStage(args), /outcome_unknown/);
  await assert.rejects(runR13JevStage(args), /reconciliation/); assert.equal(calls, 1);
}));
test('a persisted raw response can recover decoding after a crash without provider access', async () => withDir(async directory => {
  const args = { stage: 'repair' as const, items: [item], directory, provider: { async evaluate() { return raw; } }, category: { pt: 'cerveja', en: 'beer' } };
  await runR13JevStage(args);
  const file = (await readdir(directory)).find(f => /^[a-f0-9]{64}\.json$/.test(f))!;
  const state = JSON.parse(await readFile(join(directory, file), 'utf8')); state.status = 'submitting'; await writeFile(join(directory, file), JSON.stringify(state));
  const out = await runR13JevStage({ ...args, provider: { async evaluate() { throw new Error('must not send'); } } }); assert.equal(out.settled, 1);
}));
test('resume rejects changed category and roots before sending', async () => withDir(async directory => {
  let calls = 0;
  const args = { stage: 'repair' as const, items: [item], directory, provider: { async evaluate() { calls++; return raw; } }, category: { pt: 'cerveja', en: 'beer' } };
  await runR13JevStage(args);
  await assert.rejects(runR13JevStage({ ...args, category: { pt: 'café', en: 'coffee' } }), /binding_changed|request_changed/);
  await assert.rejects(runR13JevStage({ ...args, items: [{ ...item, root_id: 'different' }] }), /binding_changed/); assert.equal(calls, 1);
}));

test('concurrent callers preserve a stale lock and send no requests', async () => withDir(async directory => {
  const lock = join(directory, 'active.lock');
  const original = JSON.stringify({ pid: 2147483647 });
  await writeFile(lock, original);
  let calls = 0;
  const args = { stage: 'repair' as const, items: [item], directory, provider: { async evaluate() { calls++; return raw; } }, category: { pt: 'cerveja', en: 'beer' } };
  const attempts = await Promise.allSettled([runR13JevStage(args), runR13JevStage(args)]);
  assert.equal(calls, 0);
  assert.equal(await readFile(lock, 'utf8'), original);
  for (const result of attempts) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.match(result.reason.message, /lock_exists_requires_operator_reconciliation/);
  }
}));

test('exclusive lock allows exactly one concurrent fresh runner to submit', async () => withDir(async directory => {
  let providerStarted!: () => void;
  let releaseProvider!: () => void;
  const started = new Promise<void>(resolve => { providerStarted = resolve; });
  const release = new Promise<void>(resolve => { releaseProvider = resolve; });
  let calls = 0;
  const args = { stage: 'repair' as const, items: [item], directory, provider: { async evaluate() { calls++; providerStarted(); await release; return raw; } }, category: { pt: 'cerveja', en: 'beer' } };
  const first = runR13JevStage(args);
  await started;
  await assert.rejects(runR13JevStage(args), /lock_exists_requires_operator_reconciliation/);
  assert.equal(calls, 1);
  releaseProvider();
  assert.equal((await first).settled, 1);
  assert.equal(calls, 1);
}));

test('export verifies config, expected roots, source digests and raw receipts', async () => withDir(async directory => {
  const args = { stage: 'repair' as const, items: [item], directory, provider: { async evaluate() { return raw; } }, category: { pt: 'cerveja', en: 'beer' } };
  await runR13JevStage(args);
  assert.equal(await exportR13JevStage(args), 1);
  const exported = await readFile(join(directory, 'results.jsonl'), 'utf8');
  assert.equal(JSON.parse(exported).root_id, item.root_id);
  await assert.rejects(exportR13JevStage({ ...args, category: { pt: 'café', en: 'coffee' } }), /binding_mismatch/);
  await assert.rejects(exportR13JevStage({ ...args, items: [{ ...item, input_digest: 'changed' }] }), /binding_mismatch/);
  await assert.rejects(exportR13JevStage({ ...args, items: [item, item] }), /stage_invalid/);
  const file = (await readdir(directory)).find(name => /^[a-f0-9]{64}\.json$/.test(name))!;
  const original = await readFile(join(directory, file), 'utf8');
  const replaced = JSON.parse(original);
  replaced.root_id = 'different-root';
  await writeFile(join(directory, file), JSON.stringify(replaced));
  await assert.rejects(exportR13JevStage(args), /settled_receipt_mismatch/);
  assert.equal(await readFile(join(directory, 'results.jsonl'), 'utf8'), exported);
  await writeFile(join(directory, file), original);
  const rawFile = (await readdir(directory)).find(name => name.endsWith('.raw.json'))!;
  const rawData = JSON.parse(await readFile(join(directory, rawFile), 'utf8'));
  rawData.body = rawData.body.replace('300', '301');
  await writeFile(join(directory, rawFile), JSON.stringify(rawData));
  await assert.rejects(exportR13JevStage(args), /settled_receipt_mismatch/);
}));

test('HTTP 429 receipt is retained and never automatically resent', async () => withDir(async directory => {
  let calls = 0;
  const args = { stage: 'repair' as const, items: [item], directory, provider: { async evaluate() { calls++; return { body: '{"error":"rate_limit"}', http_status: 429, latency_ms: 1 }; } }, category: { pt: 'cerveja', en: 'beer' } };
  await assert.rejects(runR13JevStage(args), /jev_response_invalid/);
  await assert.rejects(runR13JevStage(args), /jev_response_invalid/);
  assert.equal(calls, 1);
  const name = (await readdir(directory)).find(file => file.endsWith('.raw.json'))!;
  assert.equal(JSON.parse(await readFile(join(directory, name), 'utf8')).http_status, 429);
}));
