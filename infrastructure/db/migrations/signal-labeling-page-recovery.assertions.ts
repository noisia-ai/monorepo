import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {massLabelingConfigurationV2,mapMassLabelingJevResponseV2,llmPriceV1,llmCostMicroUsdV1,type MassLabelingInputV1} from '@noisia/query-engine';
import {buildLabelingRawPageV1} from '../signal-labeling-raw-pages';
import {readLabelingRawCallPageV1} from '../signal-labeling-raw-page-store';
import {reconcileMassLabelingJevReceiptV1} from '../signal-mass-labeling-jev-recovery';
import type {LabelingDatabaseV1} from '../signal-mention-facets';
import type {LabelingRunV1,LabelingCallV1} from '../signal-labeling-runs';
import {validateJevResponseV1,type JevRawResponseV1} from '../../../services/workers/src/providers/typesafe-jev';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import type {JevRequestV1} from '@noisia/query-engine/src/signal-mention-facets-jev-v1';

/** Emulates the sealed page intent left before a provider response upload, then
 * verifies failed-run recovery without changing the legacy fixture outcome. */
export async function assertRawPageFailedRecoveryV1(args:{database:LabelingDatabaseV1;query:PoolClient['query'];
  workspace_id:string;actor_user_id:string;run_id:string;call_id:string;raw_text:string}){
  const q=args.query;
  await q('SAVEPOINT page_failed_recovery');
  try{
    const run=(await q<LabelingRunV1>(`SELECT r.*,l.identity,l.labeler_digest,c.context FROM signal_labeling_runs r
      JOIN signal_labeler_versions l ON l.id=r.labeler_version_id JOIN signal_entity_context_versions c
      ON c.workspace_id=r.workspace_id AND c.version_no=r.entity_context_version_no WHERE r.id=$1`,[args.run_id])).rows[0]!;
    const call=(await q<LabelingCallV1<MassLabelingInputV1>>('SELECT * FROM signal_labeling_calls WHERE id=$1',[args.call_id])).rows[0]!;
    assert.equal(call.status,'unknown');assert.equal(call.results_applied,true);
    const page=buildLabelingRawPageV1({workspace_id:args.workspace_id,run_id:args.run_id,
      receipts:[{call_id:call.id,request_digest:call.request_digest,raw:args.raw_text}]});
    const storage_key=`workspace-engine/${args.workspace_id}/${run.id}/${page.name}.${page.raw_sha256.slice(7)}.parts.json`;
    await q(`INSERT INTO signal_labeling_raw_pages(id,workspace_id,run_id,name,storage_key,sha256,size_bytes,member_count)
      VALUES($1,$2,$3,$4,$5,$6,$7,1)`,[page.page_id,args.workspace_id,run.id,page.name,storage_key,page.raw_sha256,page.size_bytes]);
    const m=page.members[0]!;
    await q(`INSERT INTO signal_labeling_raw_page_members(call_id,workspace_id,run_id,page_id,request_digest,raw_sha256,raw_size_bytes,byte_offset,byte_length)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[call.id,args.workspace_id,run.id,page.page_id,m.request_digest,m.raw_sha256,m.raw_size_bytes,m.byte_offset,m.byte_length]);
    const reading={database:args.database,workspace_id:args.workspace_id,run_id:run.id,call_id:call.id,request_digest:call.request_digest,
      loadPage:async()=>page.raw_text};
    const loaded=await readLabelingRawCallPageV1(reading);assert.equal(loaded?.raw_text,args.raw_text);
    await assert.rejects(readLabelingRawCallPageV1({...reading,loadPage:async()=>page.raw_text+' '}),/raw_page_invalid/);
    await assert.rejects(readLabelingRawCallPageV1({...reading,request_digest:'sha256:'+'f'.repeat(64)}),/raw_receipt_invalid/);
    const response=validateJevResponseV1(call.request as unknown as JevRequestV1,JSON.parse(args.raw_text) as JevRawResponseV1);
    const result=mapMassLabelingJevResponseV2(call.inputs[0]!,run.context,massLabelingConfigurationV2(run.identity.params),response);
    const usage=jevUsageV1(response.usage);
    const input={...args,request_digest:call.request_digest,raw_page_id:page.page_id,raw_sha256:m.raw_sha256,
      raw_storage_key:storage_key,raw_size_bytes:m.raw_size_bytes,usage,result,
      settled_micro_usd:llmCostMicroUsdV1(usage,llmPriceV1('typesafe',run.identity.model,'sync',Number(run.identity.params.input_usd_per_mtok)))};
    for(const patch of [{raw_page_id:randomUUID()},{call_id:randomUUID()},
      {raw_sha256:'sha256:'+'f'.repeat(64)},{result:{...result,entity_context_digest:'sha256:'+'f'.repeat(64)}}])
      await assert.rejects(reconcileMassLabelingJevReceiptV1({...input,...patch}),/recovery_conflict/);
    await q('SAVEPOINT page_active_lease');
    await q("UPDATE signal_labeling_runs SET lease_token=$2,lease_until=clock_timestamp()+interval '1 hour' WHERE id=$1",[run.id,randomUUID()]);
    await assert.rejects(reconcileMassLabelingJevReceiptV1(input),/recovery_unavailable/);
    await q('ROLLBACK TO SAVEPOINT page_active_lease');await q('RELEASE SAVEPOINT page_active_lease');
    await q('SAVEPOINT page_queued_run');
    await q("UPDATE signal_labeling_runs SET status='queued' WHERE id=$1",[run.id]);
    await assert.rejects(reconcileMassLabelingJevReceiptV1(input),/recovery_unavailable/);
    await q('ROLLBACK TO SAVEPOINT page_queued_run');await q('RELEASE SAVEPOINT page_queued_run');
    await q('SAVEPOINT page_revoked_actor');
    await q("UPDATE users SET status='suspended' WHERE id=$1",[args.actor_user_id]);
    await assert.rejects(reconcileMassLabelingJevReceiptV1(input),/forbidden/);
    await q('ROLLBACK TO SAVEPOINT page_revoked_actor');await q('RELEASE SAVEPOINT page_revoked_actor');
    assert.equal((await q('SELECT status FROM signal_labeling_raw_pages WHERE id=$1',[page.page_id])).rows[0].status,'planned');
    assert.equal((await reconcileMassLabelingJevReceiptV1(input)).replayed,false);
    const before=(await q('SELECT to_jsonb(c) snapshot FROM signal_labeling_calls c WHERE id=$1',[call.id])).rows[0].snapshot;
    assert.equal((await q('SELECT status FROM signal_labeling_raw_pages WHERE id=$1',[page.page_id])).rows[0].status,'verified');
    assert.equal((await reconcileMassLabelingJevReceiptV1(input)).replayed,true);
    assert.deepEqual((await q('SELECT to_jsonb(c) snapshot FROM signal_labeling_calls c WHERE id=$1',[call.id])).rows[0].snapshot,before,
      'replaying the same page preserves every byte of the call, usage and cost');
  }finally{await q('ROLLBACK TO SAVEPOINT page_failed_recovery');await q('RELEASE SAVEPOINT page_failed_recovery');}
}
