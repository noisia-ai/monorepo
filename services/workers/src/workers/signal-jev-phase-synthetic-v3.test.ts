import assert from 'node:assert/strict';
import test from 'node:test';
import {createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {isJevPhaseProviderV3,isJevPhaseSyntheticFactoryV3} from '../providers/jev-phase-provider-v3';
import {jevLegacyCaptureProfileV3} from './signal-jev-phase-profile-v3';
import {createR16FirstpartySyntheticJevRuntimeV3} from '../../../../scripts/r16/synthetic-jev';

test('Full first-party synthetic constructor uses identical P/R/F/G geometry to native with no provider or Redis call',async()=>{
 const execution={max_in_flight:1024,window_size:4096,flush_size:1024,max_flushes:2,flush_interval_ms:250,max_buffered_bytes:512*1024*1024};
 const labeler_digest='sha256:'+'a'.repeat(64),env={NOISIA_TYPESAFE_ACCOUNT_ID:'closed-resource-fixture',NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:'redis://127.0.0.1:1',
  NOISIA_TYPESAFE_ACCOUNT_RPS:'2000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'400000000',NOISIA_JEV_MAX_RESPONSE_BYTES:'16384',
  NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({[labeler_digest]:{kind:'official_context_bound',source:'fixture only',source_url:'https://docs.typesafe.ai/models',model:'jev-1.13.0',fixed_input_tokens:65536,input_tokens_per_utf8_byte:0,max_request_bytes:32*1024*1024}})};
 const native=createCalibratedJevRuntimeProviderV2({labeler_digest,execution,env});
 const synthetic=createR16FirstpartySyntheticJevRuntimeV3({redis_url:env.NOISIA_TYPESAFE_ACCOUNT_REDIS_URL,account_id:env.NOISIA_TYPESAFE_ACCOUNT_ID,requests_per_second:2000,input_tokens_per_second:400000000});
 const closed=synthetic.factory({labeler_digest,execution,env});
 const arbitrary=createCalibratedJevRuntimeProviderV2({labeler_digest,execution,env,fetch:(async()=>{throw Error('must never dispatch');})as typeof fetch});
 try{
  assert.equal(isJevPhaseProviderV3(native),true);assert.equal(isJevPhaseProviderV3(closed),true);assert.equal(isJevPhaseProviderV3(arbitrary),false);
  assert.equal(isJevPhaseSyntheticFactoryV3(synthetic.factory),true);
  assert.deepEqual(jevLegacyCaptureProfileV3(closed,execution),jevLegacyCaptureProfileV3(native,execution));
  assert.equal(synthetic.requests(),0);assert.equal(synthetic.latency_ms.length,0);
  assert.equal(native.max_response_bytes,16384);assert.equal(closed.max_response_bytes,16384);
 }finally{await native.close?.();await closed.close?.();await arbitrary.close?.();}
});
