import assert from 'node:assert/strict';
import test from 'node:test';
import {createMassLabelingStoreV1} from '../signal-mass-labeling';
import {buildMassLabelingJevRequestV2,massLabelingConfigurationV2,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';

test('live never-evaluated reservations requeue idempotently with their full budget and reject financial/raw/lease substitutions',{
 skip:process.env.NOISIA_R16_UNSENT_PG!=='true',timeout:120000,
},async()=>{
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
  const row=async()=> (await database.query(`SELECT status,reserved_micro_usd::text,settled_micro_usd,usage,results,results_applied,
   terminal_exposure_micro_usd::text FROM signal_labeling_calls WHERE id=$1`,[calls[2]!.id])).rows[0];
  await store.requeueUnsent!(run,[calls[2]!]);await store.requeueUnsent!(run,[calls[2]!]);
  assert.deepEqual(await row(),{status:'reserved',reserved_micro_usd:'1000',settled_micro_usd:null,usage:null,results:null,results_applied:false,terminal_exposure_micro_usd:'0'});
  await store.markSubmitting(run,[calls[2]!]);
  const denied=async(sql:string,values:unknown[],pattern=/labeling_unsent_requeue_conflict/)=>{
   await database.query('SAVEPOINT unsent_negative');
   try{await database.query(sql,values);await assert.rejects(store.requeueUnsent!(run,[calls[2]!]),pattern);}
   finally{await database.query('ROLLBACK TO SAVEPOINT unsent_negative');await database.query('RELEASE SAVEPOINT unsent_negative');}
  };
  await denied("UPDATE signal_labeling_calls SET status='submitted',provider_batch_id='physical-attempt' WHERE id=$1",[calls[2]!.id]);
  await denied('UPDATE signal_labeling_calls SET usage=$2::jsonb WHERE id=$1',[calls[2]!.id,JSON.stringify({input_tokens:1,output_tokens:0})]);
  await denied('UPDATE signal_labeling_calls SET settled_micro_usd=0 WHERE id=$1',[calls[2]!.id]);
  await denied('UPDATE signal_labeling_calls SET terminal_exposure_micro_usd=1 WHERE id=$1',[calls[2]!.id]);
  await denied('UPDATE signal_labeling_calls SET results=\'[]\'::jsonb,results_applied=true WHERE id=$1',[calls[2]!.id]);
  await denied("UPDATE signal_labeling_calls SET raw_sha256=$2,raw_storage_key='private/physical',raw_size_bytes=1 WHERE id=$1",
    [calls[2]!.id,digest('raw')]);
  await database.query('SAVEPOINT unsent_page_membership');
  try{
   await assert.rejects(store.persistRawPage(run,[{call:calls[2]!,raw:'synthetic physical receipt'}]),/unexpected upload/);
   await assert.rejects(store.requeueUnsent!(run,[calls[2]!]),/labeling_unsent_requeue_conflict/);
  }finally{await database.query('ROLLBACK TO SAVEPOINT unsent_page_membership');await database.query('RELEASE SAVEPOINT unsent_page_membership');}
  await denied("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id],/labeling_lease_lost/);
  await assert.rejects(store.requeueUnsent!({...run,workspace_id:'00000000-0000-4000-8000-000000000000'},[calls[2]!]),/labeling_(?:forbidden|unsent_requeue_conflict|context_changed|policy_changed)/);
  await assert.rejects(store.requeueUnsent!(run,[{...calls[2]!,request_digest:digest('wrong-request')}]),/labeling_unsent_requeue_conflict/);
 }});
});
