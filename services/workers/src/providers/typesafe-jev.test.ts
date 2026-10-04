import test from 'node:test';
import assert from 'node:assert/strict';
import { createTypesafeJevClientV1, validateJevResponseV1, JevProviderErrorV1, type JevRequestV1 } from './typesafe-jev';
const request: JevRequestV1 = { model: 'jev-1.13.0', state: 'synthetic', questions: { yes: { type: 'noul', instructions: 'yes?' }, select: { type: 'choice', instructions: 'choose', criteria: { a: 'A', b: 'B' } } } };
const response = () => ({ model: request.model, usage: { input_tokens: 100, output_tokens: 5 }, answers: { yes: { type: 'noul', noul: 0.9 }, select: { type: 'choice', choice: 'a', confidence: 0.8, probabilities: { a: 0.9, b: 0.1 } } } });
test('one request, disabled by default and no credential/error leakage', async () => {
  let calls = 0;
  const fake = (async (_url, init) => { calls++; assert.equal(init?.redirect, 'error'); assert.ok(init?.signal); return new Response(JSON.stringify(response())); }) as typeof fetch;
  await assert.rejects(createTypesafeJevClientV1({ enabled: false, fetch: fake }).evaluate(request), (e: unknown) => e instanceof JevProviderErrorV1 && e.outcome === 'definitely_not_sent');
  assert.equal(calls, 0);
  const raw = await createTypesafeJevClientV1({ enabled: true, api_key: 'test', fetch: fake }).evaluate(request);
  assert.equal(calls, 1); assert.equal(validateJevResponseV1(request, raw).usage.input_tokens, 100);
  await assert.rejects(createTypesafeJevClientV1({ enabled: true, api_key: 'test', fetch: async () => { throw new Error('secret and source text'); } }).evaluate(request), (e: unknown) => e instanceof JevProviderErrorV1 && e.message === 'jev_transport_unknown' && e.outcome === 'outcome_unknown');
});
test('timeout aborts and never retries', async () => {
  let calls = 0;
  const fake = (async (_url, init) => { calls++; return await new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('abort'))); }); }) as typeof fetch;
  const keepAlive = setTimeout(() => undefined, 200);
  try { await assert.rejects(createTypesafeJevClientV1({ enabled: true, api_key: 'test', timeout_ms: 10, fetch: fake }).evaluate(request), (e: unknown) => e instanceof JevProviderErrorV1 && e.outcome === 'outcome_unknown'); }
  finally { clearTimeout(keepAlive); }
  assert.equal(calls, 1);
});
test('bounded streaming response and complete validation preserve known usage', async () => {
  const client = createTypesafeJevClientV1({ enabled: true, api_key: 'test', fetch: async () => new Response('x', { headers: { 'content-length': '99999999' } }) });
  await assert.rejects(client.evaluate(request), (e: unknown) => e instanceof JevProviderErrorV1 && e.outcome === 'outcome_unknown');
  for (const mutate of [
    (r: any) => { delete r.answers.yes; }, (r: any) => { r.answers.yes.noul = 1.1; },
    (r: any) => { r.answers.select.probabilities = { a: 0.5, c: 0.5 }; },
    (r: any) => { r.model = 'unexpected'; }, (r: any) => { r.answers.extra = r.answers.yes; }
  ]) {
    const json = response(); mutate(json);
    assert.throws(() => validateJevResponseV1(request, { body: JSON.stringify(json), http_status: 200, latency_ms: 1 }), (e: unknown) => e instanceof JevProviderErrorV1 && e.outcome === 'known_response_invalid' && e.evidence.usage?.input_tokens === 100);
  }
});
test('concurrency limiter survives failures and bounds actual in-flight calls', async () => {
  let active = 0, peak = 0, calls = 0;
  const fake = (async () => { active++; const ordinal = ++calls; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; if (ordinal === 1) throw new Error(); return new Response(JSON.stringify(response())); }) as typeof fetch;
  const client = createTypesafeJevClientV1({ enabled: true, api_key: 'test', concurrency: 2, fetch: fake });
  await Promise.allSettled(Array.from({ length: 9 }, () => client.evaluate(request)));
  assert.equal(peak, 2); assert.equal(calls, 9);
});
test('lease cancellation fences queued requests while preserving already sent responses', async () => {
  let sends = 0; let release!: () => void;
  const inFlight = new Promise<void>(resolve => { release = resolve; });
  const client = createTypesafeJevClientV1({ enabled: true, api_key: 'test', concurrency: 1,
    fetch: async () => { sends++; await inFlight; return new Response(JSON.stringify(response())); } });
  const controller = new AbortController();
  const first = client.evaluate(request, { signal: controller.signal });
  const queued = client.evaluate(request, { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, (error: unknown) => error instanceof JevProviderErrorV1 && error.outcome === 'definitely_not_sent');
  release(); assert.equal((await first).http_status, 200); assert.equal(sends, 1);
  await assert.rejects(client.evaluate(request, { signal: controller.signal }), (error: unknown) => error instanceof JevProviderErrorV1 && error.outcome === 'definitely_not_sent');
  assert.equal(sends, 1);
});
test('streaming size bound works without content-length and cancels the reader', async () => {
  let canceled = false;
  const client = createTypesafeJevClientV1({ enabled: true, api_key: 'test', fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
    cancel() { canceled = true; }
  })) });
  await assert.rejects(client.evaluate(request), (error: unknown) => error instanceof JevProviderErrorV1 && error.code === 'jev_response_too_large' && error.outcome === 'outcome_unknown');
  assert.equal(canceled, true);
});
