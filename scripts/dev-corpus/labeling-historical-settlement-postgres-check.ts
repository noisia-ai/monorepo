/** Replaying a receipt uses its booked historical cost, never the current price. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {llmCostMicroUsdV1,llmPriceV1} from '@noisia/query-engine';
import {createSignalLabelingStoreV1,type LabelingRunV1,type LabelingCallV1} from '../../infrastructure/db/signal-labeling-runs';
import {createMigratedLabelingFixture} from './migrated-labeling-fixture';
import {main,openDatabase} from './guard.mjs';

await main(async()=>{
 const pool=await openDatabase(),client=await pool.connect();
 try{
  await client.query('BEGIN');const f=await createMigratedLabelingFixture(pool,client);
  const store=createSignalLabelingStoreV1({database:client as never,storeRaw:async()=>''});
  const usage={input_tokens:10,output_tokens:10,cache_read_input_tokens:1000,cache_creation_input_tokens:0,
   cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}};
  const price=llmPriceV1('anthropic','claude-sonnet-5-5','batch'),current=llmCostMicroUsdV1(usage,price),
   historical=llmCostMicroUsdV1(usage,{...price,cache_read:price.cache_read*2});
  assert.notEqual(current,historical);
  const run={id:f.runId,workspace_id:f.workspaceId,lease_token:f.lease} as LabelingRunV1;
  for(const mode of ['single','page'] as const){
   const id=randomUUID();
   await client.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,
    custom_id,request_digest,request,inputs,status,reserved_micro_usd,settled_micro_usd,usage,
    raw_sha256,raw_storage_key,raw_size_bytes,budget_date,budget_timezone,results_applied)
    VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}','[]','settled',$6,$6,$7,
      $5,$4,2,current_date,'UTC',false)`,[id,f.runId,f.workspaceId,`historical-${id}`,`sha256:${'8'.repeat(64)}`,historical,JSON.stringify(usage)]);
   const before=(await client.query('SELECT to_jsonb(call) receipt FROM signal_labeling_calls call WHERE id=$1',[id])).rows[0].receipt;
   const call={id} as LabelingCallV1;
   if(mode==='single')await store.settle(run,call,{usage,settled_micro_usd:current});
   else await store.settlePage(run,[{call,usage,settled_micro_usd:current}]);
   assert.deepEqual((await client.query('SELECT to_jsonb(call) receipt FROM signal_labeling_calls call WHERE id=$1',[id])).rows[0].receipt,before,
    'historical amount and entire stored receipt are immutable during replay');
   await assert.rejects(mode==='single'?store.settle(run,call,{usage:{...usage,input_tokens:11},settled_micro_usd:current})
    :store.settlePage(run,[{call,usage:{...usage,input_tokens:11},settled_micro_usd:current}]),/labeling_settlement_conflict/);
  }
  console.log(JSON.stringify({status:'passed',gate:'historical_settlement_replay',cases:4,provider_calls:0,cost_micro_usd:0}));
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
