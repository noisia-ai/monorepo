import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareSignalTopicEditorialGrammarRetryV2,type SignalTopicEditorialBatchDatabaseV2}
  from './signal-topic-editorial-batch-v2';

function store(options:{lock?:boolean;blocked?:boolean;digests?:string[];fail?:boolean}={}){
 const statements:string[]=[],values:unknown[][]=[];
 const db={async connect(){return {async query(sql:string,params:unknown[]=[]){
  statements.push(sql);values.push(params);
  if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{locked:options.lock??true}]};
  if(sql.includes('SELECT EXISTS (')&&sql.includes('75 seconds'))return {rows:[{blocked:options.blocked??false}]};
  if(sql.includes('WITH available AS'))return {rows:options.digests?.length?[{
   execution_id:'00000000-0000-4000-8000-000000000001',request_digests:options.digests,
   submission_key:'v2-grammar-retry-test',
  }]:[]};
  if(sql.includes('SELECT prepare_signal_topic_editorial_batch_v2')){
   if(options.fail)throw new Error('private provider receipt');
   return {rows:[{value:{batch_id:'00000000-0000-4000-8000-000000000002',manifest_digest:'sha256:test',replayed:false}}]};
  }
  return {rows:[]};
 },release(){}};}} as unknown as SignalTopicEditorialBatchDatabaseV2;
 return {db,statements,values};
}

test('grammar retries require settled exact provider errors and a provider-wide cooldown',async()=>{
 const s=store({digests:['sha256:first','sha256:second']});
 const result=await prepareSignalTopicEditorialGrammarRetryV2({database:s.db});
 assert.equal(result?.provider_items,2);
 assert.equal(result?.batch_id,'00000000-0000-4000-8000-000000000002');
 const selection=s.statements.find(sql=>sql.includes('WITH available AS'))??'';
 assert.match(selection,/prior\.state='applied' AND latest\.status='settled'/u);
 assert.match(selection,/Grammar compilation rate limit exceeded%/u);
 assert.match(selection,/item\.validation->>'status'='invalid_message'/u);
 assert.match(selection,/LIMIT 15/u);
 assert.match(selection,/o\.send_not_after/u);
 assert.match(selection,/count\(\*\).*attempts/u);
 assert.deepEqual(s.values.at(-2),['00000000-0000-4000-8000-000000000001',
  ['sha256:first','sha256:second'],'v2-grammar-retry-test']);
 assert.equal(s.statements.at(-1),'COMMIT');
});

test('grammar retry does not reserve or send while locked, cooling down or without exact errors',async()=>{
 for(const options of [{lock:false},{blocked:true},{digests:[]}]){
  const s=store(options);
  assert.equal(await prepareSignalTopicEditorialGrammarRetryV2({database:s.db}),null);
  assert.ok(!s.statements.some(sql=>sql.includes('SELECT prepare_signal_topic_editorial_batch_v2')));
  assert.equal(s.statements.at(-1),'COMMIT');
 }
});

test('a failed preparation rolls back without leaking the provider receipt',async()=>{
 const s=store({digests:['sha256:first'],fail:true});
 await assert.rejects(prepareSignalTopicEditorialGrammarRetryV2({database:s.db}));
 assert.equal(s.statements.at(-1),'ROLLBACK');
});
