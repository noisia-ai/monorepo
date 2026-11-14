import Redis from 'ioredis';
import { createJevAccountRateLimiter, type JevRedisEval } from './jev-account-rate-limit';
import { createTypesafeJevClientV1, type JevProviderV1, type JevRawResponseV1, JevProviderErrorV1 } from './typesafe-jev';
import type { JevStreamingExecutionV2 } from '../workers/signal-jev-streaming-window';

const positive = (value: string | undefined, fallback?: number) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number! < 1) throw Error('jev_stream_runtime_configuration_invalid');
  return number!;
};
export function jevStreamingExecutionFromEnvV2(env: NodeJS.ProcessEnv = process.env): JevStreamingExecutionV2 | undefined {
  if (env.NOISIA_JEV_STREAMING_V2_ENABLED !== 'true') return undefined;
  return { max_in_flight:positive(env.NOISIA_JEV_STREAM_MAX_IN_FLIGHT,1024),
    flush_size:positive(env.NOISIA_JEV_STREAM_FLUSH_SIZE,1024), max_flushes:positive(env.NOISIA_JEV_STREAM_MAX_FLUSHES,2),
    max_buffered_bytes:positive(env.NOISIA_JEV_STREAM_BUFFER_BYTES,256*1024*1024),
    flush_interval_ms:positive(env.NOISIA_JEV_STREAM_FLUSH_INTERVAL_MS,250),
    window_size:positive(env.NOISIA_JEV_STREAM_WINDOW_SIZE,4096) };
}
// Calibration is explicit per frozen labeler configuration, shared between all API keys.
// The adaptive bound can only increase from verified usage. It never changes money reserves.
const CALIBRATION_LUA = `
local old=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0')
if ARGV[2]=='observe' then
 local actual=tonumber(ARGV[3])
 if actual>old then redis.call('HSET',KEYS[1],ARGV[1],actual);old=actual end
end
return tostring(old)
`;
type Calibration = { source: string; fixed_input_tokens:number; input_tokens_per_utf8_byte:number; max_request_bytes:number };
export function createCalibratedJevRuntimeProviderV2(args: {
  labeler_digest:string; execution:JevStreamingExecutionV2; env?:NodeJS.ProcessEnv;
  evaluateRedis?:JevRedisEval; fetch?:typeof fetch;
}): JevProviderV1 {
  const env = args.env ?? process.env;
  const account = env.NOISIA_TYPESAFE_ACCOUNT_ID?.trim();
  const redisUrl = env.NOISIA_TYPESAFE_ACCOUNT_REDIS_URL;
  if (!account || !/^sha256:[0-9a-f]{64}$/.test(args.labeler_digest) || (!args.evaluateRedis && !redisUrl))
    throw Error('jev_stream_account_configuration_missing');
  let configurations: Record<string,Calibration>;
  try { configurations=JSON.parse(env.NOISIA_JEV_TOKEN_CALIBRATIONS_JSON ?? 'null'); }
  catch { throw Error('jev_stream_token_calibration_invalid'); }
  const calibration = configurations?.[args.labeler_digest];
  if (!calibration || !calibration.source?.trim() || !Number.isSafeInteger(calibration.fixed_input_tokens)
    || calibration.fixed_input_tokens < 0 || !Number.isFinite(calibration.input_tokens_per_utf8_byte)
    || calibration.input_tokens_per_utf8_byte < 0 || !Number.isSafeInteger(calibration.max_request_bytes)
    || calibration.max_request_bytes < 1 || calibration.fixed_input_tokens + calibration.input_tokens_per_utf8_byte <= 0)
    throw Error('jev_stream_token_calibration_missing');
  let client: Redis | undefined;
  const evaluate: JevRedisEval = args.evaluateRedis ?? (async (script,keys,values) => {
    if(!client){ client=new Redis(redisUrl!,{lazyConnect:true,maxRetriesPerRequest:1,connectTimeout:3000,
      enableOfflineQueue:false,retryStrategy:()=>null});client.on('error',()=>undefined); }
    if(client.status==='wait')await client.connect();
    return client.eval(script,keys.length,...keys,...values);
  });
  // Account identity is explicitly configured across environments, never inferred
  // from an app organization or API key. All clients learn the same calibration.
  const limiter = createJevAccountRateLimiter({account_id:account,
    requests_per_second:positive(env.NOISIA_TYPESAFE_ACCOUNT_RPS),
    input_tokens_per_second:positive(env.NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS)},evaluate);
  const calibrationKey=`noisia:jev-calibration:${account}`;
  const inner = createTypesafeJevClientV1({ enabled:env.NOISIA_JEV_PROVIDER_ENABLED!=='false',
    api_key:env.TYPESAFE_API_KEY, fetch:args.fetch, concurrency:args.execution.max_in_flight,
    max_response_bytes:positive(env.NOISIA_JEV_MAX_RESPONSE_BYTES,16384), rate_limiter:limiter,
    // evaluate wrapper reads the latest shared adaptive bound before admitting this request.
    estimate_input_tokens:request=>estimates.get(request) ?? (()=>{throw Error('jev_stream_calibration_not_loaded');})() });
  const estimates = new WeakMap<object,number>();
  return { max_concurrency:inner.max_concurrency,max_response_bytes:inner.max_response_bytes,
    async evaluate(request,options) {
      const bytes=Buffer.byteLength(JSON.stringify(request));
      try {
        if(bytes>calibration.max_request_bytes)throw Error('jev_stream_request_exceeds_calibration');
        const learned=Number(await evaluate(CALIBRATION_LUA,[calibrationKey],[args.labeler_digest,'read']));
        if(!Number.isFinite(learned)||learned<0)throw Error('jev_stream_calibration_unavailable');
        estimates.set(request,Math.max(1,Math.ceil(Math.max(calibration.fixed_input_tokens+bytes*calibration.input_tokens_per_utf8_byte,learned*bytes))));
      } catch { throw new JevProviderErrorV1('jev_stream_calibration_unavailable','definitely_not_sent'); }
      const raw=await inner.evaluate(request,options);
      return {...raw,rate_calibration:{labeler_digest:args.labeler_digest,input_bytes:bytes}};
    },
    async observeUsage(raw:JevRawResponseV1,tokens:number) {
      await inner.observeUsage?.(raw,tokens);
      const receipt=raw.rate_calibration;
      // Historical durable receipts predate rate reservations/calibration metadata.
      // They can be recovered without manufacturing a fresh quota event.
      if(!receipt&&!raw.rate_reservation)return;
      if(!receipt||receipt.labeler_digest!==args.labeler_digest||!Number.isSafeInteger(receipt.input_bytes)||receipt.input_bytes<1)
        throw Error('jev_stream_calibration_receipt_invalid');
      await evaluate(CALIBRATION_LUA,[calibrationKey],[args.labeler_digest,'observe',String(tokens/receipt.input_bytes)]);
    },
  };
}
