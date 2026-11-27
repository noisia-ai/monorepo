import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

/** Must identify the provider account, shared across app tenants, environments and API keys. */
export type JevAccountRateLimits = { account_id: string; requests_per_second: number; input_tokens_per_second: number };
export type JevRateReservation = { id: string; estimated_input_tokens: number };
export interface JevAccountRateLimiter {
  acquire(input_tokens: number, signal?: AbortSignal): Promise<JevRateReservation>;
  throttle(delay_ms: number): Promise<void>;
  observe(reservation: JevRateReservation, actual_input_tokens: number): Promise<void>;
}
export type JevRedisEval = (script: string, keys: string[], args: string[]) => Promise<unknown>;

// Redis TIME is authoritative. A sliding window, rather than independent local buckets,
// prevents two API keys or processes from each consuming the whole account allowance.
export const JEV_ACCOUNT_RATE_LUA = `
local tm=redis.call('TIME')
local now=tonumber(tm[1])*1000+math.floor(tonumber(tm[2])/1000)
local events=KEYS[1]
local tokens=KEYS[2]
local total=KEYS[3]
local cooldown=KEYS[4]
local cutoff=now-1000
local expired=redis.call('ZRANGEBYSCORE',events,'-inf',cutoff)
local used=tonumber(redis.call('GET',total) or '0')
for _,id in ipairs(expired) do
 used=used-tonumber(redis.call('HGET',tokens,id) or '0')
 redis.call('HDEL',tokens,id,id..':observed')
 if string.sub(id,1,5)=='debt:' then redis.call('HDEL',tokens,string.sub(id,6)..':observed') end
end
redis.call('ZREMRANGEBYSCORE',events,'-inf',cutoff)
used=math.max(0,used)
-- An empty window holds no tokens. Without this, events that expired by TTL
-- during a quiet gap would leave their tokens counted forever.
if redis.call('ZCARD',events)==0 then used=0 end
redis.call('SET',total,used,'PX',2000)
local operation=ARGV[1]
if operation=='throttle' then
 local deadline=math.max(tonumber(redis.call('GET',cooldown) or '0'),now+tonumber(ARGV[2]))
 redis.call('SET',cooldown,deadline,'PX',math.max(1,deadline-now))
 return {0,deadline-now}
end
if operation=='observe' then
 local id=ARGV[2]
 local previous=redis.call('HGET',tokens,id)
 if redis.call('HSETNX',tokens,id..':observed','1')==1 then
  if previous then
   local delta=tonumber(ARGV[3])-tonumber(previous)
   redis.call('HSET',tokens,id,ARGV[3])
   redis.call('SET',total,math.max(0,used+delta),'PX',2000)
  else
   -- Late durable observations still charge any underestimated usage to the
   -- current window. Expired reservations cannot refund unrelated requests.
   local debt=math.max(0,tonumber(ARGV[3])-tonumber(ARGV[4]))
   if debt>0 then
    local debtId='debt:'..id
    redis.call('ZADD',events,now,debtId)
    redis.call('HSET',tokens,debtId,debt)
    redis.call('SET',total,used+debt,'PX',2000)
    redis.call('PEXPIRE',events,2000)
   else
    redis.call('HDEL',tokens,id..':observed')
   end
  end
  redis.call('PEXPIRE',tokens,2000)
 end
 return {1,0}
end
local deadline=tonumber(redis.call('GET',cooldown) or '0')
if deadline>now then return {0,deadline-now} end
local cost=tonumber(ARGV[3])
local maxRequests=tonumber(ARGV[4])
local maxTokens=tonumber(ARGV[5])
local config=ARGV[4]..':'..ARGV[5]
local configured=redis.call('GET',KEYS[5])
if configured and configured~=config then return {-1,0} end
-- The agreed limits expire with the window, so a raised account limit takes effect
-- once every process restarts with the same values.
redis.call('SET',KEYS[5],config,'PX',5000)
if redis.call('ZCARD',events)>=maxRequests or used+cost>maxTokens then
 local oldest=redis.call('ZRANGE',events,0,0,'WITHSCORES')
 return {0,math.max(1,tonumber(oldest[2] or now)+1000-now)}
end
redis.call('ZADD',events,now,ARGV[2])
redis.call('HSET',tokens,ARGV[2],cost)
redis.call('SET',total,used+cost,'PX',2000)
redis.call('PEXPIRE',events,2000)
redis.call('PEXPIRE',tokens,2000)
return {1,0}
`;

export function createJevAccountRateLimiter(limits: JevAccountRateLimits, evaluate: JevRedisEval): JevAccountRateLimiter {
  if (!limits.account_id.trim() || limits.account_id.length > 256
    || !Number.isSafeInteger(limits.requests_per_second) || limits.requests_per_second < 1
    || !Number.isSafeInteger(limits.input_tokens_per_second) || limits.input_tokens_per_second < 1) throw new Error('jev_account_limits_invalid');
  // Hash tags keep all keys in one cluster slot. This is not derived from an API credential.
  const prefix = `noisia:jev-account:{${createHash('sha256').update(limits.account_id).digest('hex')}}`;
  const keys = ['events', 'tokens', 'total', 'cooldown', 'limits'].map(suffix => `${prefix}:${suffix}`);
  async function command(args: string[]) {
    const result = await evaluate(JEV_ACCOUNT_RATE_LUA, keys, args);
    if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(Number(result[0]))
      || !Number.isFinite(Number(result[1])) || Number(result[1]) < 0) throw new Error('jev_rate_limiter_unavailable');
    return { admitted: Number(result[0]) === 1, wait_ms: Number(result[1]) };
  }
  return {
    async acquire(tokens, signal) {
      if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > limits.input_tokens_per_second) throw new Error('jev_rate_token_estimate_invalid');
      const id = randomUUID();
      for (;;) {
        signal?.throwIfAborted();
        const result = await command(['acquire', id, String(tokens), String(limits.requests_per_second), String(limits.input_tokens_per_second)]);
        signal?.throwIfAborted();
        if (result.admitted) return { id, estimated_input_tokens: tokens };
        await sleep(result.wait_ms, undefined, { signal });
      }
    },
    async throttle(delay) {
      if (!Number.isSafeInteger(delay) || delay < 0) throw new Error('jev_rate_retry_after_invalid');
      await command(['throttle', String(delay)]);
    },
    async observe(reservation, tokens) {
      if (!/^[0-9a-f-]{36}$/.test(reservation.id) || !Number.isSafeInteger(tokens) || tokens < 0) throw new Error('jev_rate_usage_invalid');
      await command(['observe', reservation.id, String(tokens), String(reservation.estimated_input_tokens)]);
    },
  };
}
