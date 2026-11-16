import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import test from 'node:test';
import {buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {buildLabelingRawPageV1,parseLabelingRawPageV1} from '../signal-labeling-raw-pages';
import {assertRawAttachOracleV1,assertRawAttachDeniedV1,rawAttachBeforeSqlV1,type RawAttachPlanV1} from './signal-labeling-raw-attach.oracle';

// ROOT registers this large native oracle explicitly in the owned PG17 gate.
// It is not a local acceptance and is never opened by the ordinary pure suite.
const enabled=process.env.NOISIA_R16_RAW_ATTACH_ORACLE_PG==='true';
for(const count of [720,4096])test(`RAW attach layout${count} original and page map preserve native rows among 4128 calls`,{
 skip:!enabled,timeout:600000,
},async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','large RAW attach oracle is CI-only');
 await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:4128,execution_cap_micro_usd:10000000,
  import_batch_size:256,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async f=>{
  const canceled=await f.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1) RETURNING id",[f.run_id]);
  assert.equal(canceled.rows.length,1,'only the exact unsent source run is canceled');
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const config=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',
   configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
  const requested=await requestSignalListeningV1({...access,configuration_id:config.id,map_id:f.map_id,
   idempotency_key:randomUUID(),cap_micro_usd:10000000,provider_available:true});
  const store=createSignalListeningStoreV1({database:f.database,page_size:4096,
   storeRaw:async()=>{throw Error('no transport or individual RAW storage in attach oracle');}});
  const run=await store.claim(requested.run_id);assert.ok(run);
  const calls:Awaited<ReturnType<typeof store.reserve>>=[];
  while(calls.length<4128){
   const inputs=await store.inputs(run);assert.ok(inputs.length>0);
   const proposed=inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,config.configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
    return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000};});
   const page=await store.reserve(run,proposed);await store.markSubmitting(run,page);calls.push(...page);
  }
  assert.equal(calls.length,4128);calls.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const c=await f.database.connect(),plans:RawAttachPlanV1[]=[];
  try{
   assert.equal((await c.query("SELECT current_setting('session_replication_role') value")).rows[0].value,'origin');
   assert.equal((await c.query(`SELECT bool_and(tgenabled IN('O','A')) enabled FROM pg_trigger WHERE tgrelid=ANY(
    ARRAY['signal_labeling_calls'::regclass,'signal_labeling_raw_pages'::regclass,'signal_labeling_raw_page_members'::regclass])`)).rows[0].enabled,true,
   'all native row/statement/foreign-key triggers remain enabled');
   // The raw-only UPDATE never enters reserved→submitting authority. All native
   // guards still execute. REPEATABLE READ is for this rollback oracle's one
   // snapshot only, not a runtime isolation or planner change.
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
   const fence=await c.query(`WITH raw_run_fence AS MATERIALIZED(
    SELECT id,lease_until FROM signal_labeling_runs WHERE id=$1 AND lease_token=$2 AND workspace_id=$3 FOR SHARE)
    SELECT id FROM raw_run_fence WHERE lease_until>clock_timestamp()`,[run.id,run.lease_token,run.workspace_id]);assert.equal(fence.rows.length,1);
    await c.query('SAVEPOINT raw_attach_layout');
    try{
     const selected=calls.slice(0,count),ids=selected.map(call=>call.id),built=buildLabelingRawPageV1({workspace_id:run.workspace_id,run_id:run.id,
      receipts:selected.map((call,i)=>({call_id:call.id,request_digest:call.request_digest,raw:`Synthetic exact receipt ${i}: café 😀 \\ "quote"\n`}))});
     // Authenticate the exact synthetic bytes before the native verified-page
     // transition; this fixture performs no provider or external Storage call.
     assert.equal('sha256:'+createHash('sha256').update(built.raw_text).digest('hex'),built.raw_sha256);
     assert.equal(parseLabelingRawPageV1({workspace_id:run.workspace_id,run_id:run.id,raw_text:built.raw_text,
      raw_sha256:built.raw_sha256,size_bytes:built.size_bytes,members:built.members}).size,count);
     const locked=await c.query('SELECT id FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',[run.workspace_id,run.id,ids]);
     assert.deepEqual(locked.rows.map(row=>row.id),ids,'real call-id locks precede the page lock');
     const key=`private/${run.workspace_id}/${run.id}/${built.name}`;
     await c.query(`INSERT INTO signal_labeling_raw_pages(id,workspace_id,run_id,name,storage_key,sha256,size_bytes,member_count)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[built.page_id,run.workspace_id,run.id,built.name,key,built.raw_sha256,built.size_bytes,count]);
     await c.query('SELECT id FROM signal_labeling_raw_pages WHERE id=$1 FOR UPDATE',[built.page_id]);
     await c.query(`INSERT INTO signal_labeling_raw_page_members(call_id,workspace_id,run_id,page_id,request_digest,raw_sha256,raw_size_bytes,byte_offset,byte_length)
      SELECT x.call_id,$1,$2,$3,x.request_digest,x.raw_sha256,x.raw_size_bytes,x.byte_offset,x.byte_length
      FROM jsonb_to_recordset($4::jsonb)x(call_id uuid,request_digest text,raw_sha256 text,raw_size_bytes bigint,byte_offset bigint,byte_length bigint)
      ORDER BY x.call_id`,[run.workspace_id,run.id,built.page_id,JSON.stringify(built.members)]);
     const args:[string,string,string]=[built.page_id,run.workspace_id,run.id];
     await assertRawAttachDeniedV1(c,args,run.id); // planned page cannot attach
     await c.query("UPDATE signal_labeling_raw_pages SET status='verified',verified_at=clock_timestamp() WHERE id=$1",[built.page_id]);
     for(const wrong of [[randomUUID(),run.workspace_id,run.id],[built.page_id,randomUUID(),run.id],[built.page_id,run.workspace_id,randomUUID()]]as [string,string,string][])
      await assertRawAttachDeniedV1(c,wrong,run.id);
     await assertRawAttachOracleV1(c,args,ids,plans);
     if(count===720){
      // Genuine partial reentry: one call already has the exact native page
      // reference, all other siblings are untouched before BOTH compared arms.
      const partial=rawAttachBeforeSqlV1.replace('RETURNING c.id','AND c.id=$4::uuid RETURNING c.id');
      assert.equal((await c.query(partial,[...args,ids[0]])).rows.length,1);
      await assertRawAttachOracleV1(c,args,ids,plans);
     }
    }finally{await c.query('ROLLBACK TO SAVEPOINT raw_attach_layout');await c.query('RELEASE SAVEPOINT raw_attach_layout');}
  }finally{await c.query('ROLLBACK');c.release();await store.release(run);}
  assert.equal(plans.length,count===720?4:2);
  for(const {plan,...safe}of plans)console.log('# raw attach original/candidate native plan '+JSON.stringify(safe));
 }}});
});
