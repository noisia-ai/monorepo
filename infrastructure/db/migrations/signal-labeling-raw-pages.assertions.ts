import assert from 'node:assert/strict';
import type {Pool,QueryResult} from 'pg';
import {createMassLabelingStoreV1} from '../signal-mass-labeling';
import {readLabelingRawCallPageV1} from '../signal-labeling-raw-page-store';
import type {LabelingCallV1,LabelingRunV1} from '../signal-labeling-runs';
import type {MassLabelingInputV1} from '@noisia/query-engine';

/** Uses the existing fully authorized synthetic owner. The savepoint proves
 * compatibility without changing the historical fixture's receipts or budget. */
export async function assertLabelingRawPagesV1(args:{database:Pool;query:(sql:string,values?:unknown[])=>Promise<QueryResult>;run:LabelingRunV1;
  calls:LabelingCallV1<MassLabelingInputV1>[]}):Promise<void>{
  const {database,run,calls}=args,query=args.query;
  await query('SAVEPOINT raw_pages_acceptance');
  try{
    assert.ok((await query("SELECT to_regclass('signal_labeling_raw_pages') relation")).rows[0].relation,
      'raw-page schema must exist on the fully migrated database');
    const before=(await query('SELECT to_jsonb(c) row FROM signal_labeling_calls c WHERE run_id=$1 ORDER BY id',[run.id])).rows;
    for(const page_size of [0,4097,1.5])assert.throws(()=>createMassLabelingStoreV1({database,page_size,
      storeRaw:async()=>''}),/labeling_page_size_invalid/);
    const bodies=new Map<string,string>();let writes=0,loads=0,failAfterWrite=true;
    const store=createMassLabelingStoreV1({database,
      storeRaw:async()=>{throw Error('page transport must not write individual raw objects');},
      rawPages:{
        reference:a=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
        store:async a=>{
          writes++;const key=`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`;
          bodies.set(key,a.raw_text);if(failAfterWrite){failAfterWrite=false;throw Error('synthetic_after_durable_upload');}
          return {storage_key:key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true};
        },
        load:async a=>{loads++;const body=bodies.get(a.storage_key);if(body===undefined)throw Error('workspace_engine_storage_object_missing');return body;},
      }});
    const rows=calls.map((call,index)=>({call:{...call},raw:JSON.stringify({http_status:200,latency_ms:80,body:`Exact raw ${index} — 🍵\n`})}));
    await assert.rejects(store.persistRawPage(run,rows),/synthetic_after_durable_upload/);
    assert.equal(writes,1,'all responses share one immutable JSONL object');
    const planned=(await query('SELECT id,status FROM signal_labeling_raw_pages WHERE run_id=$1',[run.id])).rows;
    assert.equal(planned.length,1);assert.equal(planned[0].status,'planned');
    assert.equal((await query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND raw_storage_key IS NOT NULL',[run.id])).rows[0].n,0,
      'upload alone does not attach receipts or release exposure');
    await assert.rejects(store.settlePage(run,[{call:rows[0]!.call,usage:{input_tokens:100,output_tokens:0,
      cache_read_input_tokens:0,cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}},settled_micro_usd:5}]),/labeling_settlement_conflict/);
    const saved=[...bodies.entries()];bodies.clear();
    await query("UPDATE signal_labeling_calls SET status='unknown' WHERE run_id=$1",[run.id]);
    const missing=await store.calls(run);
    assert.ok(missing.every(c=>c.status==='unknown'&&c.raw_body===null),
      'missing planned bytes stay unknown and do not authorize provider resend');
    assert.equal((await query('SELECT status FROM signal_labeling_raw_pages WHERE run_id=$1',[run.id])).rows[0].status,'planned');
    for(const [key,body] of saved)bodies.set(key,body);
    const read=await readLabelingRawCallPageV1({database,...run,run_id:run.id,call_id:rows[0]!.call.id,
      request_digest:rows[0]!.call.request_digest,loadPage:async r=>bodies.get(r.storage_key)!});
    assert.equal(read?.raw_text,rows[0]!.raw);assert.equal(read?.page_status,'planned');
    assert.equal((await query('SELECT status FROM signal_labeling_raw_pages WHERE run_id=$1',[run.id])).rows[0].status,'planned',
      'read-only recovery authenticates bytes without attaching or settling');
    const recovered=await store.calls(run);
    assert.equal(loads,2,'each recovery attempt fetches a page once for all its members');
    for(const row of rows)assert.equal(recovered.find(c=>c.id===row.call.id)?.raw_body,row.raw);
    assert.equal((await query('SELECT status FROM signal_labeling_raw_pages WHERE run_id=$1',[run.id])).rows[0].status,'verified');
    assert.equal((await query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND status=\'settled\'',[run.id])).rows[0].n,0,
      'recovery attaches durable evidence without inventing usage/settlement');
    await store.persistRawPage(run,rows);assert.equal(writes,1,'replaying a verified page does not upload or bill again');
    await assert.rejects(store.persistRawPage({...run,lease_token:'00000000-0000-4000-8000-000000000000'},rows),/labeling_lease_lost/);
    assert.equal(writes,1,'a stale lease cannot upload or attach a receipt');
    await assert.rejects(store.persistRawPage(run,[{...rows[0]!,call:{...rows[0]!.call,request_digest:'sha256:'+'0'.repeat(64)}}]),
      /labeling_raw_receipt_invalid/);
    await assert.rejects(store.persistRawPage(run,[{...rows[0]!,raw:'replacement receipt'}]),/labeling_raw_receipt_invalid/);
    assert.equal(writes,1,'neither a different request nor new body may replace a sealed call');
    for(const sql of [
      "UPDATE signal_labeling_raw_pages SET sha256='sha256:'||repeat('0',64) WHERE run_id=$1",
      'DELETE FROM signal_labeling_raw_page_members WHERE run_id=$1',
      'UPDATE signal_labeling_raw_page_members SET byte_offset=byte_offset+1 WHERE run_id=$1',
      "UPDATE signal_labeling_calls SET raw_sha256='sha256:'||repeat('0',64) WHERE run_id=$1",
    ]){
      await query('SAVEPOINT invalid_page_change');
      await assert.rejects(query(sql,[run.id]),/raw_page|receipt|immutable/);
      await query('ROLLBACK TO SAVEPOINT invalid_page_change');await query('RELEASE SAVEPOINT invalid_page_change');
    }
    bodies.set([...bodies.keys()][0]!, 'corrupted');
    await assert.rejects(store.calls(run),/labeling_raw_receipt_invalid/);
    await query('ROLLBACK TO SAVEPOINT raw_pages_acceptance');
    assert.deepEqual((await query('SELECT to_jsonb(c) row FROM signal_labeling_calls c WHERE run_id=$1 ORDER BY id',[run.id])).rows,before);
  }finally{
    await query('ROLLBACK TO SAVEPOINT raw_pages_acceptance');await query('RELEASE SAVEPOINT raw_pages_acceptance');
  }
}
