import test from 'node:test';
import assert from 'node:assert/strict';
import { createTypesafeJevClientV1, jevRetryAfterMsV1, validateJevResponseV1, JevProviderErrorV1, type JevRequestV1 } from './typesafe-jev';
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
test('choice sums include 0.99 and 1.01 boundaries but reject values outside tolerance', () => {
  for (const sum of [0.99, 1, 1.01]) {
    const json = response(); json.answers.select.probabilities = { a: 0.9, b: sum - 0.9 };
    const parsed = validateJevResponseV1(request, { body: JSON.stringify(json), http_status: 200, latency_ms: 1 });
    assert.equal(parsed.usage.input_tokens, 100);
  }
  for (const sum of [0.989999, 1.010001, 0.98, 1.02]) {
    const json = response(); json.answers.select.probabilities = { a: 0.9, b: sum - 0.9 };
    assert.throws(() => validateJevResponseV1(request, { body: JSON.stringify(json), http_status: 200, latency_ms: 1 }),
      (error: unknown) => error instanceof JevProviderErrorV1 && error.outcome === 'known_response_invalid' && error.evidence.usage?.input_tokens === 100);
  }
});
test('nonfinite choice probabilities remain invalid', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const json = response(); json.answers.select.probabilities.b = value;
    // JSON serializes nonfinite values as null; neither representation is accepted.
    const encoded = JSON.stringify(json);
    for (const body of [encoded, encoded.replace('"b":null', `"b":${String(value)}`)]) {
      assert.throws(() => validateJevResponseV1(request, { body, http_status: 200, latency_ms: 1 }),
        (error: unknown) => error instanceof JevProviderErrorV1 && error.outcome === 'known_response_invalid');
    }
  }
});

test('physical throttle receipts preserve Retry-After without hiding a retry', async () => {
  for (const status of [429, 529]) {
    let attempts = 0;
    const raw = await createTypesafeJevClientV1({ enabled: true, api_key: 'test', fetch: async () => {
      attempts++; return new Response('provider rejection', { status, headers: { 'retry-after': '1.25' } });
    } }).evaluate(request);
    assert.equal(attempts, 1); assert.equal(raw.http_status, status);
    assert.equal(raw.body, 'provider rejection'); assert.equal(raw.retry_after, '1.25'); assert.equal(raw.retry_after_ms, 1250);
  }
  const now = Date.parse('2026-11-14T12:00:00Z');
  assert.equal(jevRetryAfterMsV1('Sat, 14 Nov 2026 12:00:03 GMT', now), 3000);
  assert.equal(jevRetryAfterMsV1('Sat, 14 Nov 2026 11:59:59 GMT', now), 0);
  assert.equal(jevRetryAfterMsV1('invalid', now), undefined);
});

test('high concurrency requires shared account admission and explicit token estimate', async () => {
  let calls = 0; let observed = 0;
  const fetch = async () => { calls++; return new Response(JSON.stringify(response())); };
  await assert.rejects(createTypesafeJevClientV1({ enabled: true, api_key: 'test', concurrency: 512, fetch }).evaluate(request), /jev_configuration_invalid/);
  assert.equal(calls, 0);
  const limiter = { acquire: async (tokens: number) => { assert.equal(tokens, 123); return { id: 'synthetic', estimated_input_tokens: tokens }; },
    throttle: async () => {}, observe: async () => { observed++; } };
  const client = createTypesafeJevClientV1({ enabled: true, api_key: 'test', concurrency: 512, fetch, rate_limiter: limiter, estimate_input_tokens: () => 123 });
  const raw = await client.evaluate(request); assert.equal(calls, 1); assert.equal(observed, 0);
  assert.equal(raw.rate_reservation?.estimated_input_tokens, 123);
  await client.observeUsage!(raw, 100); assert.equal(observed, 1);
  const unavailable = createTypesafeJevClientV1({ enabled: true, api_key: 'test', fetch, rate_limiter: { ...limiter, acquire: async () => { throw Error('private backend detail'); } }, estimate_input_tokens: () => 123 });
  await assert.rejects(unavailable.evaluate(request), (e: unknown) => e instanceof JevProviderErrorV1 && e.code === 'jev_rate_limiter_unavailable' && e.outcome === 'definitely_not_sent');
  assert.equal(calls, 1);
});

test('throttling always backs off the shared account, including missing or invalid Retry-After', async () => {
  for (const header of [undefined, 'invalid', '0', '3']) {
    const delays: number[] = [];
    const limiter = { acquire: async () => ({ id: 'synthetic', estimated_input_tokens: 100 }),
      throttle: async (delay: number) => { delays.push(delay); }, observe: async () => {} };
    const client = createTypesafeJevClientV1({ enabled: true, api_key: 'test', rate_limiter: limiter,
      estimate_input_tokens: () => 100, fetch: async () => new Response('busy', {
        status: 529, ...(header === undefined ? {} : { headers: { 'retry-after': header } }) }) });
    await client.evaluate(request); await client.evaluate(request);
    assert.deepEqual(delays, header === '3' ? [3000, 3000] : [1000, 2000]);
  }
});

test('a 429/529 usage claim never proves billing or absence of processing', () => {
  for (const http_status of [429, 529]) for (const input_tokens of [0, 100]) {
    const body = JSON.stringify({ error: 'busy', usage: { input_tokens, output_tokens: 0 } });
    assert.throws(() => validateJevResponseV1(request, { body, http_status, latency_ms: 1 }),
      (error: unknown) => error instanceof JevProviderErrorV1 && error.outcome === 'outcome_unknown'
        && error.evidence.http_status === http_status && error.evidence.usage === undefined
        && /^sha256:[0-9a-f]{64}$/.test(error.evidence.response_digest ?? ''));
  }
});

test('failed shared cooldown preserves its receipt and closes subsequent admission', async () => {
  let sends = 0;
  const client = createTypesafeJevClientV1({ enabled: true, api_key: 'test', estimate_input_tokens: () => 100,
    rate_limiter: { acquire: async () => ({ id: 'synthetic', estimated_input_tokens: 100 }),
      throttle: async () => { throw Error('redis_down'); }, observe: async () => {} },
    fetch: async () => { sends++; return new Response('busy', { status: 529 }); } });
  const raw = await client.evaluate(request);
  assert.equal(raw.http_status, 529); assert.equal(raw.body, 'busy'); assert.equal(raw.rate_limit_update_failed, true);
  await assert.rejects(client.evaluate(request), (error: unknown) => error instanceof JevProviderErrorV1
    && error.outcome === 'definitely_not_sent' && error.code === 'jev_rate_limiter_unavailable');
  assert.equal(sends, 1);
});
