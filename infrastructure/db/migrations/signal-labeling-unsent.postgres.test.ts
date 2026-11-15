import assert from 'node:assert/strict';
import test from 'node:test';
import {createMassLabelingStoreV1} from '../signal-mass-labeling';
import {buildMassLabelingJevRequestV2,massLabelingConfigurationV2,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';

type FixtureContext=Parameters<NonNullable<NonNullable<Parameters<typeof runMassLabelingAcceptanceFixtureV1>[1]>['beforeProcessing']>>[0];
async function submitted(fn:(context:FixtureContext,store:ReturnType<typeof createMassLabelingStoreV1>,run:NonNullable<Awaited<ReturnType<ReturnType<typeof createMassLabelingStoreV1>['claim']>>>,calls:Awaited<ReturnType<ReturnType<typeof createMassLabelingStoreV1>['reserve']>>)=>Promise<void>){
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async context=>{
  const {database}=context;
  const store=createMassLabelingStoreV1({database,storeRaw:async()=>{throw Error('unexpected raw');},rawPages:{
   reference:()=>({storage_key:'private/unused'}),store:async()=>{throw Error('unexpected upload');},load:async()=>{throw Error('unexpected load');}}});
  const run=(await store.claim(context.run_id))!;assert.ok(run);assert.ok(store.requeueUnsent);
  const inputs=await store.inputs(run),configuration=massLabelingConfigurationV2(run.identity.params);
  const proposals=inputs.map(input=>{
   const request=buildMassLabelingJevRequestV2(input,run.context,configuration,run.identity.model);
   const request_digest=digest({request_version:run.identity.params.request_version,run_id:run.id,root_id:input.root_id,
    input_digest:input.input_digest,map_digest:input.map_digest,entity_context_digest:run.entity_context_digest,labeler_digest:run.labeler_digest,request});
   return{custom_id:`mass_${request_digest.slice(7,67)}`,request_digest,request,inputs:[input],reserved_micro_usd:1000};
  });
  const calls=await store.reserve(run,proposals);assert.equal(calls.length,3);await store.markSubmitting(run,calls);
  await fn(context,store,run,calls);
 }});
}
const enabled=process.env.NOISIA_R16_UNSENT_PG==='true';
test('never-evaluated reservations commit an idempotent requeue with their full budget',{skip:!enabled,timeout:120000},async()=>{
 await submitted(async({database},store,run,calls)=>{
  await store.requeueUnsent!(run,[calls[2]!]);await store.requeueUnsent!(run,[calls[2]!]);
  assert.deepEqual((await database.query(`SELECT status,reserved_micro_usd::text,settled_micro_usd,usage,results,results_applied,
   terminal_exposure_micro_usd::text FROM signal_labeling_calls WHERE id=$1`,[calls[2]!.id])).rows[0],
   {status:'reserved',reserved_micro_usd:'1000',settled_micro_usd:null,usage:null,results:null,results_applied:false,terminal_exposure_micro_usd:'0'});
 });
});
// Each negative has its own disposable product database. Evidence is committed
// through the same Pool used by the real store; no rollback erases immutable raw,
// financial or physical-attempt facts to prepare a later test case.
for(const scenario of ['submitted','usage','settled','exposure','results','raw','page_member','expired','workspace','digest']as const)
 test(`never-sent requeue rejects committed ${scenario} evidence`,{skip:!enabled,timeout:120000},async()=>{
  await submitted(async({database},store,run,calls)=>{
   const call=calls[2]!;
   if(scenario==='submitted')await database.query("UPDATE signal_labeling_calls SET status='submitted',provider_batch_id='physical-attempt' WHERE id=$1",[call.id]);
   if(scenario==='usage')await database.query('UPDATE signal_labeling_calls SET usage=$2::jsonb WHERE id=$1',[call.id,JSON.stringify({input_tokens:1,output_tokens:0})]);
   if(scenario==='settled')await database.query('UPDATE signal_labeling_calls SET settled_micro_usd=0 WHERE id=$1',[call.id]);
   if(scenario==='exposure')await database.query('UPDATE signal_labeling_calls SET terminal_exposure_micro_usd=1 WHERE id=$1',[call.id]);
   if(scenario==='results')await database.query("UPDATE signal_labeling_calls SET results='[]'::jsonb,results_applied=true WHERE id=$1",[call.id]);
   if(scenario==='raw')await database.query("UPDATE signal_labeling_calls SET raw_sha256=$2,raw_storage_key='private/physical',raw_size_bytes=1 WHERE id=$1",[call.id,digest('raw')]);
   if(scenario==='page_member')await assert.rejects(store.persistRawPage(run,[{call,raw:'synthetic physical receipt'}]),/unexpected upload/);
   if(scenario==='expired')await database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id]);
   const selectedRun=scenario==='workspace'?{...run,workspace_id:'00000000-0000-4000-8000-000000000000'}:run;
   const selectedCall=scenario==='digest'?{...call,request_digest:digest('wrong-request')}:call;
   await assert.rejects(store.requeueUnsent!(selectedRun,[selectedCall]),scenario==='expired'?/labeling_lease_lost/:
    scenario==='workspace'?/labeling_(?:forbidden|unsent_requeue_conflict|context_changed|policy_changed)/:/labeling_unsent_requeue_conflict/);
  });
 });
