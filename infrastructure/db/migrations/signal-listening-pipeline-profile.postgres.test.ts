import assert from 'node:assert/strict';
import test from 'node:test';
import {runListeningPipelineProfileV1,R16_LISTENING_PIPELINE_PROFILE_TIMEOUT_MS} from './signal-listening-pipeline-profile.synthetic.fixture';

const native=process.env.NOISIA_R16_LISTENING_PIPELINE_PROFILE_PG==='true';

test('native consumer pipeline 4096 records a bounded correlated diagnostic profile',
 {skip:!native,timeout:R16_LISTENING_PIPELINE_PROFILE_TIMEOUT_MS},async()=>{
  const result=await runListeningPipelineProfileV1();
  assert.equal(result.contract,'r16-listening-pipeline-profile-v1');
  assert.equal(result.status,'observed');
  assert.equal(result.diagnostic_only,true);
  assert.equal(result.h1_accepted,false);
  assert.equal(result.cpu,'UNKNOWN');
 });
