import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import Redis from 'ioredis';
import { createJevAccountRateLimiter } from './jev-account-rate-limit';
const url = process.env.R16BENCH_REDIS_URL;
test('Redis atomically shares provider-account request/token windows, usage debt and cooldown', { skip: !url }, async () => {
  const parsed = new URL(url!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'synthetic loopback Redis only');
  const a = new Redis(url!, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  const b = new Redis(url!, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  const ids: string[] = [];
  const make = (redis: Redis, account: string, rps: number, tps: number) => createJevAccountRateLimiter(
    { account_id: account, requests_per_second: rps, input_tokens_per_second: tps },
    (script, keys, args) => redis.eval(script, keys.length, ...keys, ...args));
  try {
    const account = randomUUID(); ids.push(account);
    const first = make(a, account, 2, 100), second = make(b, account, 2, 100);
    const t = Date.now();
    await Promise.all([first.acquire(1), second.acquire(1)]);
    await second.acquire(1);
    await assert.rejects(make(b, account, 1000, 100).acquire(1), /jev_rate_limiter_unavailable/);
    assert.ok(Date.now() - t >= 900, 'both clients must share the two-request window');
    const tokensAccount = randomUUID(); ids.push(tokensAccount);
    const tokens = make(a, tokensAccount, 100, 10), tokensOther = make(b, tokensAccount, 100, 10);
    const reservation = await tokens.acquire(4);
    await tokens.observe(reservation, 8); await tokensOther.observe(reservation, 8);
    const t2 = Date.now(); await tokensOther.acquire(3);
    assert.ok(Date.now() - t2 >= 900, 'actual token usage debt must be shared and applied once');
    const throttleAccount = randomUUID(); ids.push(throttleAccount);
    const throttled = make(a, throttleAccount, 100, 100), other = make(b, throttleAccount, 100, 100);
    await throttled.throttle(200); await other.throttle(10);
    const t3 = Date.now(); await other.acquire(1);
    assert.ok(Date.now() - t3 >= 140, 'another client cannot shorten account cooldown');
  } finally {
    for (const id of ids) {
      const prefix = `noisia:jev-account:{${createHash('sha256').update(id).digest('hex')}}`;
      await a.del(...['events', 'tokens', 'total', 'cooldown', 'limits'].map(k => `${prefix}:${k}`));
    }
    await Promise.all([a.quit(), b.quit()]);
  }
});
