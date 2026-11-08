import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runR13JevStage, type R13Input } from './mass-labeling-r13-runner';
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
