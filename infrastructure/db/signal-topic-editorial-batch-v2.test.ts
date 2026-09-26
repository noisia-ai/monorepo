import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {signalTopicEditorialDigestV1} from '../../packages/query-engine/src/signal-topic-consolidation-editorial-v1';
import {admitSignalTopicEditorialBatchV2,signalTopicEditorialCanonicalBodyV2,releaseSignalTopicEditorialBatchLeaseV2,
 persistSignalTopicEditorialBatchItemV2,rejectSignalTopicEditorialBatchSubmissionV2,attachProviderSignalTopicEditorialBatchV2,
 type SignalTopicEditorialBatchDatabaseV2,type SignalTopicEditorialBatchLeaseV2} from './signal-topic-editorial-batch-v2';
const migration=readFileSync(new URL('./migrations/0193_signal_topic_editorial_message_batches_v2.sql',import.meta.url),'utf8');
const lease={batch_id:'00000000-0000-4000-8000-000000000001',lease_token:'00000000-0000-4000-8000-000000000002',submission_token:'00000000-0000-4000-8000-000000000003'} as SignalTopicEditorialBatchLeaseV2;
function database(value:unknown,failure?:Error){
 const queries:Array<{sql:string;values:unknown[]|undefined}>=[];let released=false;
 const db={async connect(){return{async query(sql:string,values?:unknown[]){queries.push({sql,values});if(sql.startsWith('SELECT ')){if(failure)throw failure;return{rows:[{value}]};}return{rows:[]};},release(){released=true;}};}} as unknown as SignalTopicEditorialBatchDatabaseV2;
 return{db,queries,get released(){return released;}};
}
test('V2 canonical bodies agree with the existing QE digest for floats, Unicode and numeric keys',()=>{
 const input={z:0.75,a:{'20':'veinte','3':'tres','á':'🦆'},roots:[{b:2,a:1},null]};
 const body=signalTopicEditorialCanonicalBodyV2(input);
 assert.equal(`sha256:${createHash('sha256').update(body).digest('hex')}`,signalTopicEditorialDigestV1(input));
 assert.deepEqual(JSON.parse(body),input);
});
test('release carries a safe failure code and null poll without interpolating SQL',async()=>{
 const d=database(true);assert.equal(await releaseSignalTopicEditorialBatchLeaseV2({database:d.db,lease,next_poll_at:null,error_code:'topic_editorial_v2_submission_unknown',submission_unknown:true}),true);
 assert.deepEqual(d.queries[2]!.values,[lease.batch_id,lease.lease_token,null,true,'topic_editorial_v2_submission_unknown']);
 assert.equal(d.queries.at(-1)!.sql,'COMMIT');assert.equal(d.released,true);
});
test('item receipt keeps exact bytes and storage identity on an independent transaction',async()=>{
 const d=database({outcome:'succeeded',settled_micro_usd:null,usage_pending:true,replayed:false});
 const raw_body='{"custom_id":"test","result":{"type":"succeeded","message":{"usage":"unknown"}}}';
 const result=await persistSignalTopicEditorialBatchItemV2({database:d.db,lease,custom_id:'test',raw_body,storage_key:'private/item.json'});
 assert.equal(result.usage_pending,true);assert.equal(result.settled_micro_usd,null);
 assert.equal(d.queries[2]!.values![3],raw_body);assert.equal(d.queries[2]!.values![4],`sha256:${createHash('sha256').update(raw_body).digest('hex')}`);
 assert.equal(d.queries.at(-1)!.sql,'COMMIT');
});
test('failed item persistence rolls back and releases before another item can run',async()=>{
 const failure=Error('topic_editorial_v2_receipt_immutable'),d=database(null,failure);
 await assert.rejects(persistSignalTopicEditorialBatchItemV2({database:d.db,lease,custom_id:'test',raw_body:'{}',storage_key:'private/item.json'}),failure);
 assert.equal(d.queries.at(-1)!.sql,'ROLLBACK');assert.equal(d.released,true);
});
test('late submission acknowledgment uses the stable submission token, not a renewed authority',async()=>{
 const d=database({provider_batch_id:'msgbatch_test',replayed:true});
 await attachProviderSignalTopicEditorialBatchV2({database:d.db,lease,receipt_body:'{"id":"msgbatch_test"}'});
 assert.deepEqual(d.queries[2]!.values!.slice(0,2),[lease.batch_id,lease.submission_token]);
 assert.equal(d.queries.filter(item=>item.sql.startsWith('SELECT ')).length,1);
});
test('HTTP rejection preserves raw HTTP receipt and completeness without a fabricated message',async()=>{
 const d=database({state:'rejected',replayed:false}),raw_body='upstream invalid request';
 await rejectSignalTopicEditorialBatchSubmissionV2({database:d.db,lease,http_status:400,raw_body,complete:true,storage_key:'private/rejection.txt'});
 assert.deepEqual(d.queries[2]!.values!.slice(0,4),[lease.batch_id,lease.submission_token,400,raw_body]);
 assert.equal(d.queries[2]!.values![5],true);
});
test('invalid sealed input fails before opening any database transaction',async()=>{
 const d=database(null);
 await assert.rejects(admitSignalTopicEditorialBatchV2({database:d.db,workspace_id:'x',actor_user_id:'x',plan:{} as never,idempotency_key:'test-key',policy_version_id:'x',execution_cap_micro_usd:'1',send_not_after:'never'}));
 assert.equal(d.queries.length,0);
});
test('0193 preserves historical functions, isolates trigger transport and revokes all new functions after definition',()=>{
 assert.doesNotMatch(migration,/CREATE OR REPLACE FUNCTION/u);
 assert.match(migration,/NEW\.transport_version=1 AND NOT signal_topic_editorial_known_rejection_v1/u);
 assert.match(migration,/NEW\.transport_version=1 AND signal_topic_editorial_known_rejection_v1/u);
 assert.match(migration,/NEW\.transport_version=2/u);
 assert.ok(migration.indexOf('ALTER TABLE signal_topic_editorial_reused_decisions_v2 ENABLE ROW LEVEL SECURITY')>migration.lastIndexOf('CREATE FUNCTION'));
 assert.match(migration,/NEW\.budget_date<>\(clock_timestamp\(\) AT TIME ZONE a\.budget_timezone\)::date/u);
 assert.match(migration,/source_call\.transport_version<>1/u);
 assert.doesNotMatch(migration,/CREATE TABLE.*(?:balance|cost|ledger)/u);
});
