import assert from 'node:assert/strict';
import test from 'node:test';
import {createSignalLabelingStoreV1} from './signal-labeling-runs';
test('paid raw recovery claim is opt-in and requires a listening owner, unmaterialized raw and no active sibling',async()=>{
 for(const enabled of [false,true]){
  const statements:string[]=[];
  const client={async query(sql:string){statements.push(sql);return{rows:[]};},release(){}};
  type Options=Parameters<typeof createSignalLabelingStoreV1>[0];
  const store=createSignalLabelingStoreV1({database:{query:client.query,connect:async()=>client}as Options['database'],
   storeRaw:async()=>'unused',
   adapter:{kind:'mass_labeling',recover_failed_raw:enabled,inputs:async()=>[],pending:async()=>0,write:async()=>{}}});
  assert.equal(await store.claim('00000000-0000-4000-8000-000000000001'),null);
  const claim=statements.find(sql=>sql.startsWith('UPDATE signal_labeling_runs'))!;
  assert.ok(claim);assert.equal(claim.includes('JOIN signal_listening_runs owner'),enabled);
  if(enabled){assert.match(claim,/owner.workspace_id=signal_labeling_runs.workspace_id/);
   assert.match(claim,/listening-jev-v1/);assert.match(claim,/raw_storage_key IS NOT NULL AND NOT c.results_applied/);
   assert.match(claim,/active.id<>signal_labeling_runs.id/);}
 }
});
