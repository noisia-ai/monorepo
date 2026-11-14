import assert from 'node:assert/strict';
import test from 'node:test';
import {createCalibratedJevRuntimeProviderV2,jevStreamingExecutionFromEnvV2} from './jev-streaming-runtime';
import {JevProviderErrorV1,type JevRequestV1} from './typesafe-jev';
const digest=`sha256:${'a'.repeat(64)}`;
const execution={max_in_flight:1024,flush_size:1024,max_flushes:2,max_buffered_bytes:256*1024*1024,flush_interval_ms:250,window_size:4096};
const env={NOISIA_TYPESAFE_ACCOUNT_ID:'synthetic-account',NOISIA_TYPESAFE_ACCOUNT_RPS:'1000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000',
  TYPESAFE_API_KEY:'test-key',NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({[digest]:{source:'synthetic verified receipts',fixed_input_tokens:100,input_tokens_per_utf8_byte:.2,max_request_bytes:100000}})};
const request:JevRequestV1={model:'jev-1.13.0',state:'Synthetic mention',questions:{topic:{type:'choice',instructions:'Choose',criteria:{a:'A',b:'B'}}}};
test('runtime streaming remains opt-in and requires explicit account and calibrated configuration',()=>{
  assert.equal(jevStreamingExecutionFromEnvV2({}),undefined);
  assert.deepEqual(jevStreamingExecutionFromEnvV2({NOISIA_JEV_STREAMING_V2_ENABLED:'true'}),execution);
  assert.throws(()=>createCalibratedJevRuntimeProviderV2({labeler_digest:digest,execution,env:{}}),/configuration_missing/);
  assert.throws(()=>createCalibratedJevRuntimeProviderV2({labeler_digest:digest,execution,env:{...env,NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:'{}'},evaluateRedis:async()=>0}),/calibration_missing/);
});
test('runtime calibration learns from durable usage only and fails closed before sending on Redis failure',async()=>{
  let sent=0,observations=0;
  const provider=createCalibratedJevRuntimeProviderV2({labeler_digest:digest,execution,env,
    evaluateRedis:async(_script,_keys,args)=>{if(args[0]==='acquire')return [1,0];if(args[0]==='observe')return [1,0];if(args[1]==='observe')observations++;return '0';},
    fetch:async()=>{sent++;return Response.json({model:request.model,usage:{input_tokens:200,output_tokens:0},answers:{topic:{type:'choice',choice:'a',confidence:.8,probabilities:{a:.8,b:.2}}}});}});
  const raw=await provider.evaluate(request);
  assert.equal(sent,1);assert.equal(observations,0);assert.equal(raw.rate_calibration?.labeler_digest,digest);
  await provider.observeUsage!(JSON.parse(JSON.stringify(raw)),200);assert.equal(observations,1);
  await provider.observeUsage!({body:raw.body,http_status:200,latency_ms:1},200);assert.equal(observations,1);
  const broken=createCalibratedJevRuntimeProviderV2({labeler_digest:digest,execution,env,evaluateRedis:async()=>{throw Error('offline');},fetch:async()=>{throw Error('must not send');}});
  await assert.rejects(broken.evaluate(request),(error:unknown)=>error instanceof JevProviderErrorV1&&error.outcome==='definitely_not_sent');
});
