import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {signalTopicEditorialDigestV1} from '../../packages/query-engine/src/signal-topic-consolidation-editorial-v1';
import {buildSignalTopicEditorialScreeningPlanV2,validateSignalTopicEditorialGroupOutputV2,
 type SignalTopicEditorialGroupOutputV2} from '../../packages/query-engine/src/signal-topic-consolidation-editorial-v2';
import {admitSignalTopicEditorialBatchV2,signalTopicEditorialCanonicalBodyV2,releaseSignalTopicEditorialBatchLeaseV2,
 persistSignalTopicEditorialBatchItemV2,rejectSignalTopicEditorialBatchSubmissionV2,attachProviderSignalTopicEditorialBatchV2,
 buildSignalTopicEditorialBatchCatalogV2,type SignalTopicEditorialBatchCatalogOutcomeV2,
 type SignalTopicEditorialBatchDatabaseV2,type SignalTopicEditorialBatchLeaseV2} from './signal-topic-editorial-batch-v2';
const migration=readFileSync(new URL('./migrations/0193_signal_topic_editorial_message_batches_v2.sql',import.meta.url),'utf8');
const sequencingMigration=readFileSync(new URL('./migrations/0196_signal_topic_editorial_batch_reuse_before_prepare.sql',import.meta.url),'utf8');
const lease={batch_id:'00000000-0000-4000-8000-000000000001',lease_token:'00000000-0000-4000-8000-000000000002',submission_token:'00000000-0000-4000-8000-000000000003'} as SignalTopicEditorialBatchLeaseV2;
const uuid=(i:number)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const context={brand_name:'Alexa+',default_locale:'es-MX',summary:'Asistente de voz.',audiences:['hogares'],categories:['asistentes de voz'],
 competitors:['Google Assistant'],positive_anchors:['rutinas'],negative_anchors:['Alexandra'],abstention_anchors:['ambiguo']};
function batchPlan(){
 const groups=Array.from({length:5},(_,index)=>{
  const text=`Mención de Alexa+ ${index}`,root_id=uuid(index+20),chunk_sha256=`sha256:${createHash('sha256').update(text).digest('hex')}`;
  const evidence=[{ref_id:signalTopicEditorialDigestV1({root_id,chunk_index:0,start:0,end:text.length,chunk_sha256}),root_id,chunk_index:0,start:0,end:text.length,chunk_sha256,text,
   locale:'es-MX',platform:'reddit',occurred_at:'2026-09-24T00:00:00.000Z'}];
  const scope_counts={brand:1,competitor:0,category:0,unknown:0},locale_counts=[{key:'es-MX',count:1}],platform_counts=[{key:'reddit',count:1}],month_counts=[{key:'2026-09',count:1}],
   brand_affinity={positive:[],negative:[],abstention:[]},neighbors:never[]=[],metrics={cohesion:null,outlier_ratio:null};
  const dossier={contract_version:'signal-topic-group-dossier-v1',scope_counts,locale_counts,platform_counts,month_counts,brand_affinity,neighbors,metrics,
   evidence:evidence.map(({text:_text,...item})=>item)};
  return {group_key:`open:cluster-${String(index).padStart(5,'0')}`,lane:'open' as const,group_digest:signalTopicEditorialDigestV1(['group',index]),source_dossier_digest:signalTopicEditorialDigestV1(dossier),
   dossier_digest:signalTopicEditorialDigestV1(dossier),community_key:`community-${index}`,root_count:1,chunk_count:1,terms:['Alexa+'],scope_counts,locale_counts,platform_counts,month_counts,
   brand_affinity,neighbors,metrics,evidence};
 });
 return buildSignalTopicEditorialScreeningPlanV2({workspace_id:uuid(700),run_id:uuid(701),expected_group_count:groups.length,
  source_context_digest:signalTopicEditorialDigestV1('source'),editorial_context_digest:signalTopicEditorialDigestV1(context),context,groups});
}
function editorialResult(request:ReturnType<typeof batchPlan>['requests'][number],disposition:SignalTopicEditorialGroupOutputV2['disposition']){
 const output:SignalTopicEditorialGroupOutputV2={contract_version:'signal-topic-editorial-group-output-v2',group_id:request.receipt.group_id,disposition,
  candidate:disposition==='topic'||disposition==='narrative'?{label:`Título ${disposition}`,definition:`Definición ${disposition}`,locale:'es-MX'}:null,
  confidence:0.8,rationale:'Decisión sustentada.',cited_evidence_ids:disposition==='unresolved'?[]:[request.receipt.evidence[0]!.evidence_id]};
 return validateSignalTopicEditorialGroupOutputV2(request,output);
}
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
test('0193 resolves the import stage from a local variable, not a phantom table alias',()=>{
 const start=migration.indexOf('CREATE FUNCTION finish_signal_topic_editorial_batch_import_v2(');
 const end=migration.indexOf('\nEND $$;',start);
 assert.ok(start>=0&&end>start);
 const body=migration.slice(start,end);
 assert.match(body,/\bv_stage\s+text;/u);
 assert.match(body,/SET stage=v_stage WHERE execution_id=b\.execution_id/u);
 assert.match(body,/\x27stage\x27,v_stage/u);
 assert.doesNotMatch(body,/finish_signal_topic_editorial_batch_import_v2\.stage/u);
});
test('V2 catalog counts all five outcomes separately and never materializes technical errors as Noise',()=>{
 const plan=batchPlan(),items:SignalTopicEditorialBatchCatalogOutcomeV2[]=plan.requests.map((request,index)=>
  index===4?{request,decision:null,technical_error_code:'topic_editorial_v2_output_invalid'}:
   {request,decision:editorialResult(request,(['topic','narrative','noise','unresolved'] as const)[index]!),technical_error_code:null});
 const partial=buildSignalTopicEditorialBatchCatalogV2({outcomes:items,revision:1});
 assert.equal(partial.revision,null);
 assert.deepEqual(partial.outcomes.map(item=>item.status),['topic','narrative','noise','insufficient_evidence','technical_error']);
 assert.equal(partial.outcomes.filter(item=>item.status==='noise').length,1);
 assert.equal(partial.outcomes.find(item=>item.status==='technical_error')!.concept_key,null);
 const complete=buildSignalTopicEditorialBatchCatalogV2({outcomes:items.slice(0,4),revision:1});
 assert.equal(complete.revision!.concepts.length,2);assert.equal(complete.revision!.decisions.length,4);
 assert.equal(complete.revision!.decisions.find(item=>item.disposition==='unresolved')!.concept_key,null);
 assert.ok(complete.outcomes.every(item=>item.cited_ref_ids.length===1||item.status==='insufficient_evidence'));
});
test('0195 relaxes legacy prose limits to the V2 transport envelope without truncation',()=>{
 const migration=readFileSync(new URL('./migrations/0195_signal_topic_editorial_v2_materialization_text.sql',import.meta.url),'utf8');
 assert.match(migration,/8388608/u);assert.match(migration,/DROP CONSTRAINT signal_topic_editorial_concepts_label_check/u);
 assert.match(migration,/DROP CONSTRAINT signal_topic_consolidation_decisions_rationale_check/u);
});
test('0196 makes admission replay-safe before reuse, then prepares only non-reused groups',()=>{
 assert.match(sequencingMigration,/CREATE FUNCTION request_signal_topic_editorial_batch_v2_unprepared/u);
 assert.match(sequencingMigration,/CREATE FUNCTION replay_signal_topic_editorial_batch_v2_unprepared/u);
 assert.doesNotMatch(sequencingMigration,/prepare_signal_topic_editorial_batch_v2\(/u);
 assert.match(sequencingMigration,/signal_topic_editorial_reused_decisions_v2/u);
 assert.match(sequencingMigration,/expected_manifest/u);
 assert.match(sequencingMigration,/REVOKE ALL ON FUNCTION request_signal_topic_editorial_batch_v2_unprepared/u);
});
