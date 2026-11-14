import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as accountRate from './jev-account-rate-limit';
import * as transport from './typesafe-jev';
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


test('official context bootstrap stays at65536 despite a learned Redis ratio and still observes physical usage debt',async()=>{
  const calibration={kind:'official_context_bound',source:'Official default context, not a tokenizer or measured profile',
    source_url:'https://docs.typesafe.ai/models',model:'jev-1.13.0',fixed_input_tokens:65536,input_tokens_per_utf8_byte:0,max_request_bytes:32*1024*1024};
  const calls:string[][]=[];let fetched=0;
  const officialEnv={...env,NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'100000',NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({[digest]:calibration})};
  const provider=createCalibratedJevRuntimeProviderV2({labeler_digest:digest,execution,env:officialEnv,
    evaluateRedis:async(_script,_keys,args)=>{calls.push(args);if(args[0]==='acquire'||args[0]==='observe')return[1,0];return '999999';},
    fetch:async(_url,options)=>{fetched++;assert.equal((options?.headers as Record<string,string>)['TypeSafe-Danger-Zone-Long-Context'],undefined);
      return Response.json({model:request.model,usage:{input_tokens:1200,output_tokens:0},answers:{topic:{type:'choice',choice:'a',confidence:.8,probabilities:{a:.8,b:.2}}}});}});
  const raw=await provider.evaluate(request);assert.equal(fetched,1);
  assert.equal(calls.find(args=>args[0]==='acquire')?.[2],'65536');
  assert.equal(calls.some(args=>args[1]==='read'),false,'an observed ratio must not raise the official bootstrap bound');
  await provider.observeUsage!(raw,1200);
  assert.ok(calls.some(args=>args[0]==='observe'&&args[2]==='1200'));
  assert.equal(calls.some(args=>args[1]==='observe'),false,'bootstrap metadata is never published as a measured profile');
  assert.equal((raw.rate_calibration as unknown as {kind:string}).kind,'official_context_bound');
  assert.throws(()=>createCalibratedJevRuntimeProviderV2({labeler_digest:digest,execution,env:{...officialEnv,NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'1000'},evaluateRedis:async()=>[1,0]}),/warmup_account_limit/);
  const unavailable=createCalibratedJevRuntimeProviderV2({labeler_digest:digest,execution,env:officialEnv,evaluateRedis:async()=>{throw Error('offline');},fetch:async()=>{throw Error('must not send');}});
  await assert.rejects(unavailable.evaluate(request),(error:unknown)=>error instanceof JevProviderErrorV1&&error.outcome==='definitely_not_sent');
});


test('runtime shares one pending Redis connection before parallel admissions instead of failing definitely-unsent work',async()=>{
  let connects=0,sends=0,quits=0;
  class LocalRedis{
    status='wait';on(){return this;}async quit(){quits++;this.status='end';}disconnect(){this.status='end';}
    async connect(){connects++;this.status='connecting';await new Promise(resolve=>setTimeout(resolve,5));this.status='ready';}
    async eval(_script:string,_count:number,...values:string[]){
      if(this.status!=='ready')throw Error('offline queue disabled');
      const operation=values[5];return operation==='acquire'||operation==='observe'||operation==='throttle'?[1,0]:'0';
    }
  }
  const source=readFileSync(new URL('./jev-streaming-runtime.ts',import.meta.url),'utf8'),exports:Record<string,unknown>={};
  new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(
    (name:string)=>name==='ioredis'?LocalRedis:name==='./jev-account-rate-limit'?accountRate:name==='./typesafe-jev'?transport:(()=>{throw Error('unexpected module');})(),exports);
  const create=exports.createCalibratedJevRuntimeProviderV2 as typeof createCalibratedJevRuntimeProviderV2;
  const provider=create({labeler_digest:digest,execution,env:{...env,NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:'redis://127.0.0.1:1'},
    fetch:async()=>{sends++;return Response.json({model:request.model,usage:{input_tokens:200,output_tokens:0},answers:{topic:{type:'choice',choice:'a',confidence:.8,probabilities:{a:.8,b:.2}}}});}});
  await Promise.all(Array.from({length:8},()=>provider.evaluate(request)));
  assert.equal(connects,1);assert.equal(sends,8);
  await provider.close!();await provider.close!();assert.equal(quits,1);
  const injected=create({labeler_digest:digest,execution,env,evaluateRedis:async(_script,_keys,args)=>args[0]==='acquire'?[1,0]:'0'});
  await injected.close!();assert.equal(quits,1,'injected Redis evaluation is externally owned');
});
