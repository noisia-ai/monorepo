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
    const lateAccount=randomUUID();ids.push(lateAccount);
    const late=make(a,lateAccount,100,10),lateOther=make(b,lateAccount,100,10);
    const lateReservation=await late.acquire(1);
    await new Promise(resolve=>setTimeout(resolve,1100));
    await late.observe(lateReservation,9);
    const tLate=Date.now();await lateOther.acquire(3);
    assert.ok(Date.now()-tLate>=900,'late underestimated paid usage must charge current global token window');
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

test('native runtime factory cold-admits parallel requests on local Redis and closes its owned connection', {skip:!url,timeout:10000},async()=>{
  const parsed=new URL(url!);assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname),'synthetic loopback Redis only');
  const {createCalibratedJevRuntimeProviderV2}=await import('./jev-streaming-runtime');
  const account=randomUUID(),digest=`sha256:${'b'.repeat(64)}`;
  const execution={max_in_flight:32,flush_size:32,max_flushes:1,max_buffered_bytes:16*1024*1024,flush_interval_ms:5,window_size:32};
  let sent=0;
  const provider=createCalibratedJevRuntimeProviderV2({labeler_digest:digest,execution,env:{
    TYPESAFE_API_KEY:'synthetic-test-key',NOISIA_TYPESAFE_ACCOUNT_ID:account,NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:url,
    NOISIA_TYPESAFE_ACCOUNT_RPS:'1000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'1000000',
    NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({[digest]:{source:'synthetic verified fixture',fixed_input_tokens:100,input_tokens_per_utf8_byte:0,max_request_bytes:10000}})},
    fetch:async()=>{sent++;return Response.json({model:'jev-1.13.0',usage:{input_tokens:100,output_tokens:0},answers:{q:{type:'noul',noul:.8}}});}});
  const cleanup=new Redis(url!,{maxRetriesPerRequest:1,connectTimeout:2000});
  try{
    const request={model:'jev-1.13.0',state:'Synthetic source',questions:{q:{type:'noul' as const,instructions:'Configured question'}}};
    const raw=await Promise.all(Array.from({length:32},()=>provider.evaluate(request)));
    assert.equal(sent,32);assert.ok(raw.every(item=>item.rate_reservation));
    await Promise.all(raw.map(item=>provider.observeUsage!(item,100)));
    await provider.close!();await provider.close!();
    assert.equal(await cleanup.ping(),'PONG','closing the owned client must not close other clients or clear quota keys');
  }finally{
    await provider.close?.();
    const prefix=`noisia:jev-account:{${createHash('sha256').update(account).digest('hex')}}`;
    await cleanup.del(...['events','tokens','total','cooldown','limits','backoff'].map(key=>`${prefix}:${key}`),`noisia:jev-calibration:${account}`);
    await cleanup.quit();
  }
});
