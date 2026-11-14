import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevAccountRateLimiter } from './jev-account-rate-limit';
const limits = { account_id: 'synthetic-provider-account', requests_per_second: 80, input_tokens_per_second: 100_000 };
test('account keys are shared across clients and do not depend on API keys or app tenants', async () => {
  const keys: string[][] = [];
  const evaluate = async (_script: string, names: string[]) => { keys.push(names); return [1, 0]; };
  await createJevAccountRateLimiter(limits, evaluate).acquire(1234);
  await createJevAccountRateLimiter(limits, evaluate).acquire(5678);
  assert.deepEqual(keys[0], keys[1]);
  assert.ok(keys[0]!.every(key => !key.includes(limits.account_id)));
  assert.notDeepEqual(keys[0], await (async () => { let result: string[] = [];
    await createJevAccountRateLimiter({ ...limits, account_id: 'other-account' }, async (_s, names) => { result = names; return [1, 0]; }).acquire(1); return result; })());
});
test('cancellation prevents admission and backend uncertainty never admits locally', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const limiter = createJevAccountRateLimiter(limits, async () => { calls++; return [1, 0]; });
  await assert.rejects(limiter.acquire(100, controller.signal)); assert.equal(calls, 0);
  for (const result of [null, [], [2, 0], [0, -1], [1, NaN]]) {
    await assert.rejects(createJevAccountRateLimiter(limits, async () => result).acquire(100), /jev_rate_limiter_unavailable/);
  }
});
test('input token accounting uses an explicit measured estimate, never a monetary reserve', async () => {
  const seen: string[][] = [];
  const limiter = createJevAccountRateLimiter(limits, async (_s, _k, args) => { seen.push(args); return [1, 0]; });
  const reservation = await limiter.acquire(1632);
  assert.equal(reservation.estimated_input_tokens, 1632); assert.equal(seen[0]![2], '1632');
  await limiter.observe(reservation, 1650); assert.deepEqual(seen[1], ['observe', reservation.id, '1650']);
  await limiter.throttle(1200); assert.deepEqual(seen[2], ['throttle', '1200']);
  for (const estimate of [0, -1, NaN, 100_001]) await assert.rejects(limiter.acquire(estimate), /jev_rate_token_estimate_invalid/);
});
