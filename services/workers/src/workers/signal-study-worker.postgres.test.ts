import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {withSignalStudyFixtureV1} from '../../../../infrastructure/db/migrations/signal-study.synthetic.fixture';
import {withStudyNativeRuntimeV1} from '../../../../infrastructure/db/migrations/signal-study-runtime.synthetic.fixture';
import {readSignalStudyOutputV1} from '../../../../infrastructure/db/signal-study-serving';
import {createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {signalStudyWorkerJobV1} from './signal-study-worker';

test('registered Study worker uses native owners, real custody and cached vectors without global provider fallback',{
 skip:process.env.NOISIA_R16_STUDY_WORKER_PG!=='true',timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async fixture=>{
 assert.ok(process.env.R16BENCH_REDIS_URL,'native Redis is required');
 assert.ok(process.env.NOISIA_WORKSPACE_ENGINE_PYTHON,'real numerical Python is required');
 assert.ok(process.env.NOISIA_WORKSPACE_ENGINE_MODULE_ROOT,'exact numerical source is required');
 const env:NodeJS.ProcessEnv={NOISIA_SIGNAL_STUDY_ENABLED:'false',NOISIA_SIGNAL_LISTENING_ENABLED:'true',
  NOISIA_JEV_PROVIDER_ENABLED:'true',NOISIA_JEV_STREAMING_V2_ENABLED:'true',
  NOISIA_STUDY_ANTHROPIC_API_KEY:'synthetic-study-only',TYPESAFE_API_KEY:'synthetic-native-jev',
  NOISIA_TYPESAFE_ACCOUNT_ID:'r16-study-wire-'+randomUUID(),NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:process.env.R16BENCH_REDIS_URL,
  NOISIA_TYPESAFE_ACCOUNT_RPS:'10000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000'};
 let jevCalls=0,sonnetCalls=0;
 const options={database:f.database,storage:fixture.httpStorage,env,
  python:process.env.NOISIA_WORKSPACE_ENGINE_PYTHON,module_root:process.env.NOISIA_WORKSPACE_ENGINE_MODULE_ROOT,
  jev_provider_factory:(args:Parameters<typeof createCalibratedJevRuntimeProviderV2>[0])=>createCalibratedJevRuntimeProviderV2({...args,
   fetch:async(_url,init)=>{jevCalls++;const request=JSON.parse(String(init?.body));
    const answers=Object.fromEntries(Object.entries(request.questions as Record<string,{type:string;criteria?:Record<string,unknown>}>).map(([key,q])=>{
     assert.equal(q.type,'choice');const choices=Object.keys(q.criteria!),choice=['trigger','category','literal'].find(c=>choices.includes(c));
     assert.ok(choice,'only configured Study axes may be sent');
     return[key,{type:'choice',choice,confidence:.9,probabilities:Object.fromEntries(choices.map(c=>[c,c===choice?.9:.1/(choices.length-1)]))}];
    }));
    return new Response(JSON.stringify({model:request.model,usage:{input_tokens:100,output_tokens:20},answers}),{status:200});
   }}),
  sonnet_fetch:(async()=>{sonnetCalls++;throw Error('small native cohort must not send Sonnet');})as typeof fetch,
 };
 const first=await f.request();assert.equal((await signalStudyWorkerJobV1(first.id,options)).status,'not_claimed');
 assert.equal(jevCalls,0);assert.equal(sonnetCalls,0);
 env.NOISIA_SIGNAL_STUDY_ENABLED='true';
 async function run(id:string){
  for(let n=0;n<10;n++){const result=await signalStudyWorkerJobV1(id,options);if(result.status==='completed')return result;
   assert.equal(result.status,'waiting_batch','a native partial H1 batch must remain explicit');}
  throw Error('native Study worker did not complete');
 }
 await run(first.id);assert.equal(jevCalls,3);assert.equal(sonnetCalls,0);
 const output=await readSignalStudyOutputV1({...f,execution_id:first.id});assert.ok(output);assert.equal(output.output.status,'directional');
 const rows=(await f.database.query(`SELECT c.status,c.results_applied,c.raw_storage_key,c.raw_storage_verified_key
  FROM signal_study_jev_batches b JOIN signal_labeling_calls c ON c.run_id=b.run_id WHERE b.execution_id=$1`,[first.id])).rows;
 assert.equal(rows.length,3);assert.ok(rows.every(row=>row.status==='settled'&&row.results_applied&&row.raw_storage_key===row.raw_storage_verified_key));
 const second=await f.request();await run(second.id);assert.equal(jevCalls,3,'the registered worker must reuse individual verified answers');
 assert.equal(sonnetCalls,0);env.NOISIA_SIGNAL_STUDY_ENABLED='false';
 assert.equal((await signalStudyWorkerJobV1(second.id,options)).status,'not_claimed');assert.equal(jevCalls,3);
})));
